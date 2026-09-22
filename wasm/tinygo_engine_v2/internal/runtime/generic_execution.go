package runtime

import (
	"math"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/command"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/crit"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/resource"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
	"tinygo_engine_v2/internal/typeset"
)

type stagedProviderMutation struct {
	kind           string
	providerRef    string
	definitionRef  string
	targetKey      string
	sourceKey      string
	shieldAmount   float64
	shieldRef      string
	shieldPriority int16
	expireAt       int64
	hasExpireAt    bool
	strict         bool
	contributions  []status.StatusContribution
}

type stagedCombatant struct {
	attributes     map[string]model.AttributeSlotDef
	resources      map[string]model.ResourceSlotDef
	cooldowns      map[string]int64
	shields        []pipeline.ShieldInstance
	providers      []status.ProviderInstance
	resolver       pipeline.AttributeResolver
	damageResolver pipeline.DamageModifierResolver
	providerOps    []stagedProviderMutation
	providerState  map[string]*providerStateBag
	dirty          bool
}

// eventFormulaSnapshot 保存父 frame entry 快照与 emit 当点 staged 深拷贝。
// event 参与者始终是原始 emittedEvent source/target，不随 listener owner-relative 重映射。
type eventFormulaSnapshot struct {
	eventType            string
	eventSourceKey       string
	eventTargetKey       string
	entrySourceAttrs     map[string]model.AttributeSlotDef
	entryTargetAttrs     map[string]model.AttributeSlotDef
	entrySourceResources map[string]model.ResourceSlotDef
	entryTargetResources map[string]model.ResourceSlotDef
	sourceAttrs          map[string]model.AttributeSlotDef
	targetAttrs          map[string]model.AttributeSlotDef
	sourceResources      map[string]model.ResourceSlotDef
	targetResources      map[string]model.ResourceSlotDef
	hasDamageSnapshot    bool
	damageSnapshot       formula.EventDamageSnapshot
	damageTraits         []string
	damageTypeKey        string
	castInstanceID       uint64
	castOrigin           string
	hasSkillHit          bool
	skillHit             *frozenSkillHitContext
}

type executionFrame struct {
	run               *genericRunState
	frameID           uint64
	sourceKey         string
	targetKey         string
	abilityRef        string
	ownerCombatantKey string // mounted provider owner; distinct from event/op sourceKey
	ownerProviderRef  string

	// castInstanceID / castOrigin：同一次施放的身份与来源；多 op / delayed / listener ops 继承。
	castInstanceID uint64
	castOrigin     string

	staged map[string]*stagedCombatant

	// entry_*：本 frame 创建时、cost/CD/operations 前的不可变深拷贝（供本 frame 后续 emit 使用）。
	entrySourceAttrs     map[string]model.AttributeSlotDef
	entryTargetAttrs     map[string]model.AttributeSlotDef
	entrySourceResources map[string]model.ResourceSlotDef
	entryTargetResources map[string]model.ResourceSlotDef

	// eventCtx：listener / child ability 继承的原始 event 快照；nil 表示无 event context。
	eventCtx *eventFormulaSnapshot

	damageDealt  float64
	healingDone  float64
	commandCount int
	chainDepth   int
	fatal        bool
	fatalErr     *model.EngineError

	pendingEvents []emittedEvent

	// copyableCollector：单次 emitted event / dispatchListeners 局部上下文；禁止挂到 genericRunState。
	copyableCollector *eventCopyableCollector

	// linkedPhysical*：chainDepth==0 顶层 frame 内合格 physical damage 聚合（供自动 event/damage_dealt）。
	linkedPhysicalRaw       float64
	linkedPhysicalMitigated float64
	linkedPhysicalOpRefs    []string

	// consumedFirstPerCast tracks first_per_cast pipeline modifiers already applied in this cast/frame.
	// Key: ownerCombatantKey + "\x00" + providerRef + "\x00" + modifierKey.
	consumedFirstPerCast map[string]bool

	driverEntryKey       string
	skipBlockedWrites    bool
	skillHitCandidateKey string
	skillHitOccurrenceID uint64
}

// copyableDamageFrozen 冻结一次 CopyableOnHit damage 的 replay 输入（不做公式重算 / 不二次 crit 结算）。
type copyableDamageFrozen struct {
	rawAmount        float64
	damageType       string
	sourceKey        string
	targetKey        string
	providerRef      string
	originRef        string // abilityRef 或 listener:<key>
	operationRef     string // op.Ref；有则写入 evidence / replayedFrom
	entrySourceAttrs map[string]model.AttributeSlotDef
	entryTargetAttrs map[string]model.AttributeSlotDef
	eventSourceKey   string
	eventTargetKey   string
	crit             frozenCritEvidence
	ability          compilebundle.CompiledAbility
	operation        compilebundle.CompiledOperation
	castInstanceID   uint64
	castOrigin       string
}

// frozenCritEvidence 冻结真实命中时的 expected crit 证据；phantom 原样回放，不重读属性。
// chanceEffective 是 q（修饰后有效暴击率）；originalCritChance 是 p（属性 clamp 后、修饰前）。
// normalPart/critPart 在 outgoing 投影后、抗性前更新；critAdjustedRawAmount 保持 pre-outgoing 合并量。
type frozenCritEvidence struct {
	present               bool
	eligible              bool
	policy                string
	chanceRaw             float64
	originalCritChance    float64
	chanceEffective       float64
	multiplier            float64
	naturalWeight         float64
	forcedWeight          float64
	naturalMultiplier     float64
	forcedMultiplier      float64
	baseRawAmount         float64
	normalPart            float64
	critPart              float64
	critAdjustedRawAmount float64
}

// deferredRepeatRequest 登记 phantom replay 门槛；不立即执行。
type deferredRepeatRequest struct {
	ownerCombatantKey string
	ownerProviderRef  string
	triggerStateKey   string
	threshold         float64
	repeatCount       int
	repeatScope       string
	repeatTag         string
	repeatDelayMs     int
}

// triggeredContinuationPayload 是延迟 phantom replay 的 run-local 冻结载荷。
type triggeredContinuationPayload struct {
	damages      []copyableDamageFrozen
	req          deferredRepeatRequest
	commandCount int
}

// eventCopyableCollector 是单次真实 emitted event 的局部 collector（嵌套 emit 独立实例）。
type eventCopyableCollector struct {
	damages      []copyableDamageFrozen
	repeats      []deferredRepeatRequest
	phantomDepth int
	commandCount int
}

type emittedEvent struct {
	eventType      string
	ref            string
	sourceKey      string
	targetKey      string
	types          []string
	snapshot       eventFormulaSnapshot
	castInstanceID uint64
	castOrigin     string
	skillHit       *frozenSkillHitContext
}

func (s *genericRunState) newExecutionFrame(sourceKey, targetKey, abilityRef string) *executionFrame {
	s.nextFrameID++
	f := &executionFrame{
		run:        s,
		frameID:    s.nextFrameID,
		sourceKey:  sourceKey,
		targetKey:  targetKey,
		abilityRef: abilityRef,
		staged:     make(map[string]*stagedCombatant),
	}
	f.captureEntrySnapshots()
	return f
}

func (f *executionFrame) captureEntrySnapshots() {
	f.entrySourceAttrs, f.entrySourceResources = f.snapshotCombatantMaps(f.sourceKey)
	f.entryTargetAttrs, f.entryTargetResources = f.snapshotCombatantMaps(f.targetKey)
}

func (f *executionFrame) snapshotCombatantMaps(key string) (map[string]model.AttributeSlotDef, map[string]model.ResourceSlotDef) {
	c, ok := f.run.combatants[key]
	if !ok {
		return map[string]model.AttributeSlotDef{}, map[string]model.ResourceSlotDef{}
	}
	return cloneAttributeMap(c.attributes), cloneResourceMap(c.resources)
}

// entryMapsForKey 按 combatant key 选择本 frame 创建时对应参与者的 entry 快照。
// 未知 key 返回空 map，避免静默改用错误参与者。
func (f *executionFrame) entryMapsForKey(key string) (map[string]model.AttributeSlotDef, map[string]model.ResourceSlotDef) {
	switch key {
	case f.sourceKey:
		return f.entrySourceAttrs, f.entrySourceResources
	case f.targetKey:
		return f.entryTargetAttrs, f.entryTargetResources
	default:
		return map[string]model.AttributeSlotDef{}, map[string]model.ResourceSlotDef{}
	}
}

func (f *executionFrame) captureEmitSnapshot(eventType, eventSourceKey, eventTargetKey string) eventFormulaSnapshot {
	src := f.stageFor(eventSourceKey)
	tgt := f.stageFor(eventTargetKey)
	entrySrcAttrs, entrySrcRes := f.entryMapsForKey(eventSourceKey)
	entryTgtAttrs, entryTgtRes := f.entryMapsForKey(eventTargetKey)
	snap := eventFormulaSnapshot{
		eventType:            eventType,
		eventSourceKey:       eventSourceKey,
		eventTargetKey:       eventTargetKey,
		entrySourceAttrs:     cloneAttributeMap(entrySrcAttrs),
		entryTargetAttrs:     cloneAttributeMap(entryTgtAttrs),
		entrySourceResources: cloneResourceMap(entrySrcRes),
		entryTargetResources: cloneResourceMap(entryTgtRes),
		sourceAttrs:          cloneAttributeMap(src.attributes),
		targetAttrs:          cloneAttributeMap(tgt.attributes),
		sourceResources:      cloneResourceMap(src.resources),
		targetResources:      cloneResourceMap(tgt.resources),
		castInstanceID:       f.castInstanceID,
		castOrigin:           f.castOrigin,
	}
	if f.eventCtx != nil && f.eventCtx.hasSkillHit {
		snap.hasSkillHit = true
		snap.skillHit = f.eventCtx.skillHit
	}
	return snap
}

func cloneEventSnapshot(src *eventFormulaSnapshot) *eventFormulaSnapshot {
	if src == nil {
		return nil
	}
	cp := eventFormulaSnapshot{
		eventType:            src.eventType,
		eventSourceKey:       src.eventSourceKey,
		eventTargetKey:       src.eventTargetKey,
		entrySourceAttrs:     cloneAttributeMap(src.entrySourceAttrs),
		entryTargetAttrs:     cloneAttributeMap(src.entryTargetAttrs),
		entrySourceResources: cloneResourceMap(src.entrySourceResources),
		entryTargetResources: cloneResourceMap(src.entryTargetResources),
		sourceAttrs:          cloneAttributeMap(src.sourceAttrs),
		targetAttrs:          cloneAttributeMap(src.targetAttrs),
		sourceResources:      cloneResourceMap(src.sourceResources),
		targetResources:      cloneResourceMap(src.targetResources),
		hasDamageSnapshot:    src.hasDamageSnapshot,
		damageSnapshot:       src.damageSnapshot,
		damageTraits:         append([]string(nil), src.damageTraits...),
		damageTypeKey:        src.damageTypeKey,
		castInstanceID:       src.castInstanceID,
		castOrigin:           src.castOrigin,
		hasSkillHit:          src.hasSkillHit,
		skillHit:             src.skillHit,
	}
	return &cp
}

func (f *executionFrame) stageFor(key string) *stagedCombatant {
	if sc, ok := f.staged[key]; ok {
		return sc
	}
	base, ok := f.run.combatants[key]
	if !ok {
		sc := &stagedCombatant{
			attributes:    map[string]model.AttributeSlotDef{},
			resources:     map[string]model.ResourceSlotDef{},
			cooldowns:     map[string]int64{},
			providerState: map[string]*providerStateBag{},
		}
		f.staged[key] = sc
		return sc
	}
	sc := &stagedCombatant{
		attributes:     cloneAttributeMap(base.attributes),
		resources:      cloneResourceMap(base.resources),
		cooldowns:      cloneCooldownMap(base.cooldowns),
		shields:        pipeline.ShieldsFromRuntime(base.shields, f.run.nowMs),
		providers:      append([]status.ProviderInstance(nil), base.providers...),
		resolver:       base.resolver.Clone(),
		damageResolver: base.damageResolver.Clone(),
		providerState:  cloneProviderStateMap(base.providerState),
	}
	f.staged[key] = sc
	return sc
}

func (f *executionFrame) evalContext(ability compilebundle.CompiledAbility) formula.GenericEvalContext {
	ctx := formula.GenericEvalContext{
		SourceAttrs:     f.stageFor(f.sourceKey).attributes,
		TargetAttrs:     f.stageFor(f.targetKey).attributes,
		SourceResources: f.stageFor(f.sourceKey).resources,
		TargetResources: f.stageFor(f.targetKey).resources,
		AbilityParams:   ability.Params,
		StrictReads:     f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.hasSkillHit),
	}
	if f.ownerProviderRef != "" {
		ctx.HasProviderContext = true
		bag := f.providerStateBag(f.providerOwnerKey(), f.ownerProviderRef, false)
		if bag != nil {
			ctx.ProviderState = bag.state
			if bag.targetKey == f.targetKey {
				ctx.ProviderTargetState = bag.targetStateForFormula()
			} else {
				ctx.ProviderTargetState = map[string]float64{}
			}
		} else {
			ctx.ProviderState = map[string]float64{}
			ctx.ProviderTargetState = map[string]float64{}
		}
	}
	if f.eventCtx != nil {
		ctx.HasEventContext = true
		ctx.EventEntrySourceAttrs = f.eventCtx.entrySourceAttrs
		ctx.EventEntryTargetAttrs = f.eventCtx.entryTargetAttrs
		ctx.EventEntrySourceResources = f.eventCtx.entrySourceResources
		ctx.EventEntryTargetResources = f.eventCtx.entryTargetResources
		ctx.EventSourceAttrs = f.eventCtx.sourceAttrs
		ctx.EventTargetAttrs = f.eventCtx.targetAttrs
		ctx.EventSourceResources = f.eventCtx.sourceResources
		ctx.EventTargetResources = f.eventCtx.targetResources
		if f.eventCtx.hasDamageSnapshot {
			ctx.HasEventDamageSnapshot = true
			ctx.EventDamage = f.eventCtx.damageSnapshot
		}
		if f.eventCtx.hasSkillHit && f.eventCtx.skillHit != nil {
			ctx.HasEventSkillHit = true
			ctx.HasSkillHitBlocked = true
			ctx.SkillHitBlocked = f.eventCtx.skillHit.blocked
			if f.eventCtx.skillHit.hasFirstContact {
				ctx.HasSkillHitFirstContact = true
				ctx.SkillHitFirstContact = f.eventCtx.skillHit.firstContact
			}
		}
	}
	return ctx
}

// providerOwnerKey returns the combatant that owns mounted provider state for this frame.
func (f *executionFrame) providerOwnerKey() string {
	if f.ownerCombatantKey != "" {
		return f.ownerCombatantKey
	}
	return f.sourceKey
}

func (f *executionFrame) providerStateBag(combatantKey, providerRef string, create bool) *providerStateBag {
	if providerRef == "" {
		return nil
	}
	sc := f.stageFor(combatantKey)
	if sc.providerState == nil {
		sc.providerState = map[string]*providerStateBag{}
	}
	bag, ok := sc.providerState[providerRef]
	if !ok {
		if !create {
			return nil
		}
		bag = &providerStateBag{
			state:        map[string]float64{},
			expireAt:     map[string]int64{},
			fieldDefs:    map[string]providerStateFieldDef{},
			targetValues: map[string]float64{},
		}
		sc.providerState[providerRef] = bag
	}
	bag.bindFieldDefs(f.resolveProviderStateFieldDefs(combatantKey, providerRef))
	bag.lazyExpireProviderState(f.run.nowMs)
	return bag
}

func (f *executionFrame) resolveProviderStateFieldDefs(combatantKey, providerRef string) map[string]providerStateFieldDef {
	if f.run == nil {
		return nil
	}
	return f.run.resolveProviderStateFieldDefs(combatantKey, providerRef, f.stageFor(combatantKey).providers)
}

// providerFormulaContextFunc returns H2a per-modifier provider overlay.
// Cross-combatant mounts pass OwnerCombatantKey so provider.state / target_state read the
// owner bag. For provider_target visibility: same-combatant mounts use the cast target;
// mounts hosted on another combatant use that mount host as the pair-state target key.
// Callback only sets HasProviderContext / ProviderState / ProviderTargetState.
func (f *executionFrame) providerFormulaContextFunc(combatantKey string) pipeline.ProviderFormulaContextFunc {
	return func(ownerCombatantKey, providerRef string) formula.GenericEvalContext {
		bagOwner := ownerCombatantKey
		if bagOwner == "" {
			bagOwner = combatantKey
		}
		bag := f.providerStateBag(bagOwner, providerRef, false)
		if bag != nil {
			bag.lazyExpireProviderTargetState(f.run.nowMs)
		}
		return providerFormulaContextFromBag(bag, providerTargetActiveKey(combatantKey, ownerCombatantKey, f.targetKey))
	}
}

func (f *executionFrame) resolveAttributesFor(combatantKey string, attrs map[string]model.AttributeSlotDef, evalCtx formula.GenericEvalContext) map[string]model.AttributeSlotDef {
	sc := f.stageFor(combatantKey)
	return sc.resolver.ResolveAttributesWithProviderContext(
		attrs,
		evalCtx,
		f.run.compiled.Formulas,
		f.providerFormulaContextFunc(combatantKey),
	)
}

func (f *executionFrame) evalAmount(programID formula.GenericProgramID, ability compilebundle.CompiledAbility) (float64, *model.EngineError) {
	value, err := f.run.compiled.Formulas.Eval(programID, f.evalContext(ability))
	if err != nil {
		msg := err.Error()
		out := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, msg, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		if f.skillHitOccurrenceID != 0 && int(programID) < len(f.run.compiled.Formulas.Programs) {
			out.Path = f.run.compiled.Formulas.Programs[programID].Key
			out.Ref = f.abilityRef
		}
		if strings.HasPrefix(msg, "event.skill_hit.") {
			out.Path = msg
			out.Ref = f.abilityRef
		}
		return 0, out
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite formula result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return value, nil
}

func (f *executionFrame) executeOperations(ability compilebundle.CompiledAbility, ops []compilebundle.CompiledOperation) *model.EngineError {
	for _, op := range ops {
		if f.fatal {
			return f.fatalErr
		}
		if op.HasCondition {
			cond, err := f.evalAmount(op.ConditionProgram, ability)
			if err != nil {
				f.fatal = true
				f.fatalErr = err
				return err
			}
			if cond == 0 {
				continue
			}
		}
		if err := f.executeOperation(ability, op); err != nil {
			f.fatal = true
			f.fatalErr = err
			return err
		}
	}
	return nil
}

func (f *executionFrame) bumpCommandBudget() *model.EngineError {
	if f.copyableCollector != nil {
		f.copyableCollector.commandCount++
		if f.copyableCollector.commandCount > f.run.budget.MaxCommandsPerEvent {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "max commands per event exceeded", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		return nil
	}
	f.commandCount++
	if f.commandCount > f.run.budget.MaxCommandsPerEvent {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "max commands per event exceeded", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return nil
}

func (f *executionFrame) executeOperation(ability compilebundle.CompiledAbility, op compilebundle.CompiledOperation) *model.EngineError {
	if err := f.bumpCommandBudget(); err != nil {
		return err
	}

	if f.skipBlockedWrites && isSkillHitBlockedWrite(op.Operation) {
		f.run.recordEvidence(model.EvidenceItem{
			TimeMs: f.run.nowMs,
			Kind:   model.EvidenceKindSkillHitSkip,
			Ref:    f.skillHitCandidateKey,
			Path:   f.abilityRef,
			Data: map[string]interface{}{
				"occurrenceId": float64(f.skillHitOccurrenceID),
				"candidateKey": f.skillHitCandidateKey,
				"operation":    op.Operation,
			},
		})
		return nil
	}

	// repeat：允许空 target；仅登记 deferred request，不解析 combatant target。
	if op.Operation == model.OperationKindRepeat {
		return f.registerDeferredRepeat(op)
	}

	targetKey, ok := f.run.resolveOperationTarget(op.Target, f.sourceKey, f.targetKey)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}

	switch op.Operation {
	case "damage", "heal", "shield":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, op.Operation+" requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		if op.Operation == "shield" {
			sc := f.stageFor(targetKey)
			ref := op.ShieldRef
			if ref == "" {
				ref = "shield:auto"
			}
			sc.shields = append(sc.shields, pipeline.ShieldInstance{
				ShieldRef: ref,
				Source:    f.sourceKey,
				Owner:     targetKey,
				Remaining: amount,
				Priority:  0,
				ExpireAt:  0,
				State:     map[string]interface{}{},
			})
			sc.dirty = true
			return nil
		}
		if op.Operation == "damage" {
			// Ordering: expected crit (branch pipeline) → outgoing_pre_mitigation →
			// resistance → incoming_crit_part_post_mitigation → incoming_post_mitigation →
			// shields/HP. CopyableOnHit freezes the post-crit / pre-outgoing amount.
			critEv, amount, critMods, err := f.settleExpectedCrit(op, ability, amount)
			if err != nil {
				return err
			}
			if err := f.maybeCollectCopyableDamage(op, ability, amount, targetKey, critEv); err != nil {
				return err
			}
			cmd := command.Command{
				Kind:       command.KindDamage,
				Source:     f.sourceKey,
				Target:     targetKey,
				Amount:     amount,
				DamageType: op.DamageType,
				Ref:        op.AttributeKey,
			}
			return f.applyDamageCommand(cmd, op, critEv, ability, critMods)
		}
		cmd := command.Command{
			Kind:       command.Kind(op.Operation),
			Source:     f.sourceKey,
			Target:     targetKey,
			Amount:     amount,
			DamageType: op.DamageType,
			Ref:        op.AttributeKey,
		}
		return f.applyCommand(cmd, ability)
	case "resource_change":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		return f.applyResourceChange(targetKey, op.ResourceKey, amount, ability)
	case "attribute_change":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "attribute_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if op.AttributeKey == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "attribute_change requires attributeKey", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		return f.applyAttributeChange(targetKey, op.AttributeKey, op.ValuePolicy, amount, ability)
	case "cooldown_change":
		cooldownKey := f.abilityRef
		if op.HasAbilityRef && op.AbilityRefStr != "" {
			cooldownKey = normalizeAbilityRef(op.AbilityRefStr, f.sourceKey, f.targetKey)
		}
		ownerPrefix := combatantPrefixFromAbilityRef(cooldownKey)
		ownerKey, ok := f.run.resolveCombatantKey(ownerPrefix, f.sourceKey, f.targetKey)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		existing := f.run.nowMs
		sc := f.stageFor(ownerKey)
		if readyAt, exists := sc.cooldowns[cooldownKey]; exists {
			existing = readyAt
		}
		readyAt := f.run.nowMs
		switch op.ValuePolicy {
		case "reset":
			readyAt = f.run.nowMs
		case "reduce", "refund":
			if !op.HasAmount {
				return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "cooldown_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
			}
			duration, err := f.evalAmount(op.AmountProgram, ability)
			if err != nil {
				return err
			}
			readyAt = existing - int64(duration)
			if readyAt < f.run.nowMs {
				readyAt = f.run.nowMs
			}
		case "extend":
			if !op.HasAmount {
				return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "cooldown_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
			}
			duration, err := f.evalAmount(op.AmountProgram, ability)
			if err != nil {
				return err
			}
			base := existing
			if base < f.run.nowMs {
				base = f.run.nowMs
			}
			readyAt = base + int64(duration)
		default:
			if op.HasAmount {
				duration, err := f.evalAmount(op.AmountProgram, ability)
				if err != nil {
					return err
				}
				readyAt = f.run.nowMs + int64(duration)
			} else {
				readyAt = f.run.nowMs
			}
		}
		if readyAt < f.run.nowMs {
			readyAt = f.run.nowMs
		}
		return f.applyCooldownChange(ownerKey, cooldownKey, readyAt)
	case "apply_provider":
		if op.ProviderDefinitionRef == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "apply_provider requires providerDefinitionRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		prepared, err := f.prepareProviderMutation(op.ProviderDefinitionRef, "", f.sourceKey, targetKey, ability)
		if err != nil {
			return err
		}
		sc := f.stageFor(targetKey)
		sc.providerOps = append(sc.providerOps, stagedProviderMutation{
			kind:          "apply",
			definitionRef: op.ProviderDefinitionRef,
			targetKey:     targetKey,
			sourceKey:     f.sourceKey,
			expireAt:      prepared.expireAt,
			hasExpireAt:   prepared.hasExpireAt,
			contributions: cloneStatusContributions(prepared.contributions),
		})
		sc.dirty = true
		return nil
	case "refresh_provider":
		if op.ProviderRef == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "refresh_provider requires providerRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		prepared, err := f.prepareProviderMutation("", op.ProviderRef, f.sourceKey, targetKey, ability)
		if err != nil {
			return err
		}
		sc := f.stageFor(targetKey)
		sc.providerOps = append(sc.providerOps, stagedProviderMutation{
			kind:          "refresh",
			providerRef:   op.ProviderRef,
			targetKey:     targetKey,
			sourceKey:     f.sourceKey,
			expireAt:      prepared.expireAt,
			hasExpireAt:   prepared.hasExpireAt,
			contributions: cloneStatusContributions(prepared.contributions),
		})
		sc.dirty = true
		return nil
	case "expire_provider":
		if op.ProviderRefFromEvent {
			return f.expireProviderFromEvent(op)
		}
		if op.ProviderRef == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "expire_provider requires providerRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		sc := f.stageFor(targetKey)
		sc.providerOps = append(sc.providerOps, stagedProviderMutation{
			kind:        "expire",
			providerRef: op.ProviderRef,
			targetKey:   targetKey,
			sourceKey:   f.sourceKey,
		})
		sc.dirty = true
		return nil
	case "emit_event":
		eventType := op.EventType
		if eventType == "" {
			eventType = op.Ref
		}
		if eventType == model.EventTypeSkillHit || eventType == model.EventTypeSpellShieldBlocked {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "emit_event cannot forge engine-produced skill hit events", "eventType", eventType, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		ref := op.Ref
		if ref == "" {
			ref = eventType
		}
		if ref == "" {
			ref = "event:auto"
		}
		emitData := map[string]interface{}{
			"source":    f.sourceKey,
			"target":    targetKey,
			"eventType": eventType,
		}
		attachCastProvenance(emitData, f.castInstanceID, f.castOrigin)
		f.run.recordEvidence(model.EvidenceItem{
			TimeMs: f.run.nowMs,
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    ref,
			Data:   emitData,
		})
		types := []string{}
		if eventType != "" {
			types = append(types, eventType)
		}
		types = f.appendCastOriginEventType(types)
		f.pendingEvents = append(f.pendingEvents, emittedEvent{
			eventType:      eventType,
			ref:            ref,
			sourceKey:      f.sourceKey,
			targetKey:      targetKey,
			types:          types,
			snapshot:       f.captureEmitSnapshot(eventType, f.sourceKey, targetKey),
			castInstanceID: f.castInstanceID,
			castOrigin:     f.castOrigin,
		})
		return nil
	case "state_change":
		return f.applyStateChange(op, ability)
	case model.OperationKindStateDurationChange:
		return f.applyStateDurationChange(op, ability)
	case model.OperationKindExecuteThreshold:
		return f.applyExecuteThreshold(op, targetKey, ability)
	case model.OperationKindResolveSkillHit:
		return f.resolveSkillHit(op, ability)
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unknown operation: "+op.Operation, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
}

func isSkillHitBlockedWrite(op string) bool {
	switch op {
	case "damage", "apply_provider", "refresh_provider", "attribute_change", "resource_change", "cooldown_change", "heal", "shield":
		return true
	default:
		return false
	}
}

func (f *executionFrame) applyStateChange(op compilebundle.CompiledOperation, ability compilebundle.CompiledAbility) *model.EngineError {
	if f.ownerProviderRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "state_change requires provider context", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.Ref == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "state_change requires ref state key", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if !op.HasAmount {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "state_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	scope := op.StateScope
	if scope == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "state_change requires supported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !finiteState(amount) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite state result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	ownerKey := f.providerOwnerKey()
	bag := f.providerStateBag(ownerKey, f.ownerProviderRef, true)
	bag.ensure()
	switch scope {
	case stateScopeProvider:
		bag.lazyExpireProviderState(f.run.nowMs)
		next, ok := applyStatePolicy(bag.state[op.Ref], amount, op.ValuePolicy)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unsupported state_change valuePolicy", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if !finiteState(next) {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite state result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		next = bag.clampProviderStateValue(op.Ref, next)
		bag.state[op.Ref] = next
		bag.refreshExpireAtOnWrite(op.Ref, f.run.nowMs)
		// Provider-scope write must immediately re-resolve owner attributes with provider-aware context.
		sc := f.stageFor(ownerKey)
		sc.attributes = f.resolveAttributesFor(ownerKey, sc.attributes, f.evalContext(ability))
	case stateScopeProviderTarget:
		// Order: lazy-expire -> activate -> seed this key's default -> policy -> cap -> refresh.
		bag.lazyExpireProviderTargetState(f.run.nowMs)
		bag.activateProviderTarget(f.targetKey)
		bag.seedTargetValueIfAbsent(op.Ref)
		current := bag.readTargetValue(op.Ref)
		next, ok := applyStatePolicy(current, amount, op.ValuePolicy)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unsupported state_change valuePolicy", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if !finiteState(next) {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite state result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		next = bag.clampProviderStateValue(op.Ref, next)
		bag.targetValues[op.Ref] = next
		if exp := bag.refreshTargetExpireAtOnWrite(op.Ref, f.run.nowMs); exp > 0 {
			f.run.scheduleProviderTargetStateExpiry(ownerKey, f.ownerProviderRef, f.targetKey, op.Ref, exp)
			f.run.scheduleAnchoredTicksOnTargetWrite(ownerKey, f.ownerProviderRef, f.sourceKey, f.targetKey, op.Ref, exp, bag)
		}
		// Re-resolve host of opponent-mounted modifiers (carve target) and owner if needed.
		evalCtx := f.evalContext(ability)
		if f.targetKey != "" {
			tsc := f.stageFor(f.targetKey)
			tsc.attributes = f.resolveAttributesFor(f.targetKey, tsc.attributes, evalCtx)
			tsc.dirty = true
		}
		if ownerKey != f.targetKey {
			osc := f.stageFor(ownerKey)
			osc.attributes = f.resolveAttributesFor(ownerKey, osc.attributes, evalCtx)
		}
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "unsupported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	f.stageFor(ownerKey).dirty = true
	return nil
}

func (f *executionFrame) applyStateDurationChange(op compilebundle.CompiledOperation, ability compilebundle.CompiledAbility) *model.EngineError {
	if f.ownerProviderRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "state_duration_change requires provider context", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.Ref == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "state_duration_change requires ref state key", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if !op.HasAmount {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "state_duration_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.ValuePolicy != "subtract" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "state_duration_change requires valuePolicy=subtract", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.Target != model.SelectorSource && op.Target != model.SelectorSelf {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "state_duration_change target must be source or self", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	scope := op.StateScope
	if scope == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "state_duration_change requires supported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	// Frozen order: lazy-expire -> inactive timer no-op -> evaluate amount -> validate -> round/subtract.
	// Inactive / exactly-expired timers must not evaluate a failing amount formula.
	ownerKey := f.providerOwnerKey()
	bag := f.providerStateBag(ownerKey, f.ownerProviderRef, true)
	bag.ensure()
	nowMs := f.run.nowMs
	switch scope {
	case stateScopeProvider:
		bag.lazyExpireProviderState(nowMs)
		exp, ok := bag.expireAt[op.Ref]
		if !ok || exp <= 0 {
			return nil
		}
	case stateScopeProviderTarget:
		bag.lazyExpireProviderTargetState(nowMs)
		if bag.targetKey == "" {
			return nil
		}
		exp, ok := bag.targetExpireAt[op.Ref]
		if !ok || exp <= 0 {
			return nil
		}
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "unsupported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !finiteState(amount) || amount < 0 {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "state_duration_change amount must be finite and non-negative", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	deltaMs := int64(math.Round(amount))
	switch scope {
	case stateScopeProvider:
		applied, expired, newExp := bag.subtractProviderExpireAt(op.Ref, nowMs, deltaMs)
		if !applied {
			return nil
		}
		if expired {
			def, hasDef := bag.fieldDefs[op.Ref]
			defaultValue := 0.0
			if hasDef {
				defaultValue = def.defaultValue
			}
			bag.state[op.Ref] = defaultValue
			sc := f.stageFor(ownerKey)
			sc.attributes = f.resolveAttributesFor(ownerKey, sc.attributes, f.evalContext(ability))
		}
		_ = newExp
	case stateScopeProviderTarget:
		applied, expired, newExp := bag.subtractTargetExpireAt(op.Ref, nowMs, deltaMs)
		if !applied {
			return nil
		}
		evalCtx := f.evalContext(ability)
		if expired {
			def, hasDef := bag.fieldDefs[op.Ref]
			defaultValue := 0.0
			if hasDef {
				defaultValue = def.defaultValue
			}
			bag.targetValues[op.Ref] = defaultValue
			if f.targetKey != "" {
				tsc := f.stageFor(f.targetKey)
				tsc.attributes = f.resolveAttributesFor(f.targetKey, tsc.attributes, evalCtx)
				tsc.dirty = true
			}
			if ownerKey != f.targetKey {
				osc := f.stageFor(ownerKey)
				osc.attributes = f.resolveAttributesFor(ownerKey, osc.attributes, evalCtx)
			}
		} else if newExp > 0 {
			f.run.scheduleProviderTargetStateExpiry(ownerKey, f.ownerProviderRef, bag.targetKey, op.Ref, newExp)
		}
	}
	f.stageFor(ownerKey).dirty = true
	return nil
}

// applyExecuteThreshold 仅在真实 event/basic_attack_hit 的 emit snapshot 上判定；
// 命中后经 command/pipeline 置零 live HP，不写 damage summary/evidence，不 emit。
func (f *executionFrame) applyExecuteThreshold(op compilebundle.CompiledOperation, targetKey string, ability compilebundle.CompiledAbility) *model.EngineError {
	// Fail closed：无 event context 或非 basic_attack_hit 不触发。
	if f.eventCtx == nil || f.eventCtx.eventType != eventTypeBasicAttackHit {
		return nil
	}
	snapCurrent := attribute.ReadAttr(f.eventCtx.targetAttrs, "hp.current")
	snapMax := attribute.ReadAttr(f.eventCtx.targetAttrs, "hp.max")
	if snapMax <= 0 {
		snapMax = attribute.ReadHPMax(f.eventCtx.targetAttrs)
	}
	if snapMax <= 0 || math.IsNaN(snapMax) || math.IsInf(snapMax, 0) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "execute_threshold requires positive snapshot max HP", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	ratio := snapCurrent / snapMax
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || !(ratio < op.Threshold) {
		return nil
	}

	sc := f.stageFor(targetKey)
	liveHP := attribute.ReadAttr(sc.attributes, "hp.current")
	if liveHP <= 0 || math.IsNaN(liveHP) || math.IsInf(liveHP, 0) {
		return nil
	}

	cmd := command.Command{
		Kind:          command.KindExecuteThreshold,
		Source:        f.sourceKey,
		Target:        targetKey,
		Ref:           op.Ref,
		Threshold:     op.Threshold,
		SnapshotHP:    snapCurrent,
		SnapshotMaxHP: snapMax,
	}
	if !command.Validate(cmd) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "execute_threshold target unavailable", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}

	view := pipeline.CombatantView{Attributes: sc.attributes, Shields: sc.shields}
	outcome, next := pipeline.ResolveExecuteThreshold(cmd, view)
	sc.attributes = next.Attributes
	sc.shields = next.Shields
	if !outcome.Applied {
		return nil
	}
	f.reResolveStagedAttributesTwoPass(ability)
	sc.dirty = true

	f.run.recordGenericExecuteEvidence(genericExecuteEvidence{
		source:       cmd.Source,
		target:       cmd.Target,
		providerRef:  f.ownerProviderRef,
		abilityRef:   f.abilityRef,
		operationRef: op.Ref,
		hpBefore:     outcome.HPBefore,
		maxHp:        snapMax,
		hpRatio:      ratio,
		threshold:    op.Threshold,
		killed:       outcome.Killed,
		shieldBypass: outcome.ShieldBypassed,
	})
	return nil
}

type genericExecuteEvidence struct {
	source       string
	target       string
	providerRef  string
	abilityRef   string
	operationRef string
	hpBefore     float64
	maxHp        float64
	hpRatio      float64
	threshold    float64
	killed       bool
	shieldBypass bool
}

func (s *genericRunState) recordGenericExecuteEvidence(ev genericExecuteEvidence) {
	data := map[string]interface{}{
		"source":         ev.source,
		"target":         ev.target,
		"operationRef":   ev.operationRef,
		"hpBefore":       ev.hpBefore,
		"maxHp":          ev.maxHp,
		"hpRatio":        ev.hpRatio,
		"threshold":      ev.threshold,
		"thresholdType":  executeThresholdTypeRatio,
		"comparison":     executeThresholdComparison,
		"killed":         ev.killed,
		"shieldBypassed": ev.shieldBypass,
		"phantom":        false,
	}
	if ev.providerRef != "" {
		data["providerRef"] = ev.providerRef
	}
	if ev.abilityRef != "" {
		data["abilityRef"] = ev.abilityRef
	}
	ref := ev.operationRef
	if ref == "" {
		ref = ev.abilityRef
	}
	s.recordEvidence(model.EvidenceItem{
		TimeMs: s.nowMs,
		Kind:   model.EvidenceKindExecute,
		Ref:    ref,
		Data:   data,
	})
}

func (f *executionFrame) applyCommand(cmd command.Command, ability compilebundle.CompiledAbility) *model.EngineError {
	if cmd.Kind == command.KindHeal {
		return f.applyDirectHeal(cmd, ability)
	}
	sc := f.stageFor(cmd.Target)
	view := pipeline.CombatantView{Attributes: sc.attributes, Shields: sc.shields}
	result, next := pipeline.ResolveCommand(cmd, view, f.run.nowMs)
	sc.attributes = next.Attributes
	sc.shields = next.Shields

	switch cmd.Kind {
	case command.KindDamage:
		// 正常 damage 走 applyDamageCommand；此分支仅兜底，仍写 evidence。
		f.applyDamageResult(cmd, result, sc)
		f.reResolveStagedAttributesTwoPass(ability)
		f.run.recordGenericDamageEvidence(genericDamageEvidence{
			source:          cmd.Source,
			target:          cmd.Target,
			damageType:      cmd.DamageType,
			rawAmount:       cmd.Amount,
			mitigatedAmount: result.Amount,
			providerRef:     f.ownerProviderRef,
			abilityRef:      f.abilityRef,
			phantom:         false,
		})
	case command.KindHeal:
		f.healingDone += result.Amount
		overheal := cmd.Amount - result.Amount
		if overheal < 0 {
			overheal = 0
		}
		if overheal > 0 {
			f.run.recordOverheal(cmd.Source, overheal)
		}
		f.reResolveStagedAttributesTwoPass(ability)
	}
	return nil
}

// applyDamageCommand 走实际结算，并用同一结果写入 summary 与 damage evidence。
// Ordering: expected crit (already applied to cmd.Amount) → outgoing_pre_mitigation
// (once on merged, then proportional part projection) → one resistance factor on both
// parts → incoming_crit_part_post_mitigation (crit part only) → merge →
// incoming_post_mitigation → shields/HP.
func (f *executionFrame) applyDamageCommand(cmd command.Command, op compilebundle.CompiledOperation, critEv frozenCritEvidence, ability compilebundle.CompiledAbility, modEvidence []map[string]interface{}) *model.EngineError {
	operationRef := op.Ref
	traits := append([]string(nil), op.Types...)
	baseRawAmount := cmd.Amount
	if critEv.present {
		baseRawAmount = critEv.baseRawAmount
	}
	sc := f.stageFor(cmd.Target)
	view := pipeline.CombatantView{Attributes: sc.attributes, Shields: sc.shields}

	var err *model.EngineError
	preOutgoingMerged := cmd.Amount
	normalPart := 0.0
	critPart := 0.0
	if critEv.present && critEv.eligible {
		normalPart = critEv.normalPart
		critPart = critEv.critPart
	}

	cmd.Amount, modEvidence, err = f.applyPipelineDamageModifiers(
		cmd.Source, "damage", "outgoing_pre_mitigation", cmd.Amount, ability, cmd.DamageType, traits, modEvidence)
	if err != nil {
		return err
	}

	if critEv.present && critEv.eligible {
		normalPart, critPart = projectCritPartsAfterOutgoing(preOutgoingMerged, normalPart, critPart, cmd.Amount)
		critEv.normalPart = normalPart
		critEv.critPart = critPart
	}

	rawForEvidence := cmd.Amount
	if math.IsNaN(cmd.Amount) || math.IsInf(cmd.Amount, 0) || cmd.Amount < 0 {
		// Non-finite / negative after outgoing mods: fail closed, no damage_instance.
		result := command.Result{Kind: cmd.Kind, Applied: false, Amount: 0}
		f.applyDamageResult(cmd, result, sc)
		f.run.recordGenericDamageEvidence(genericDamageEvidence{
			source:          cmd.Source,
			target:          cmd.Target,
			damageType:      cmd.DamageType,
			rawAmount:       rawForEvidence,
			mitigatedAmount: 0,
			providerRef:     f.ownerProviderRef,
			abilityRef:      f.abilityRef,
			operationRef:    operationRef,
			phantom:         false,
			crit:            critEv,
			modifiers:       modEvidence,
			traits:          traits,
		})
		return nil
	}

	// Post-resistance part evidence is captured before incoming modifiers; only written
	// on successful settlement (not fail-closed non-finite / unknown-type paths).
	var (
		resistanceFactor            float64
		normalPartPostResistance    float64
		critPartPostResistance      float64
		resistanceBeforePenetration float64
		penetrationPercent          float64
		penetrationFlat             float64
		effectiveResistance         float64
		mitigationDetail            pipeline.MitigationResult
	)

	var mitigated float64
	sourceAttrs := f.stageFor(cmd.Source).attributes
	if cmd.Amount == 0 {
		// Successful zero pre-mitigation: factor 1, both parts zero before incoming mods.
		resistanceFactor = 1
		normalPartPostResistance = 0
		critPartPostResistance = 0
		mitigatedNormal := 0.0
		mitigatedCrit := 0.0
		if critEv.present && critEv.eligible {
			mitigatedCrit, modEvidence, err = f.applyPipelineDamageModifiers(
				cmd.Target, "damage", "incoming_crit_part_post_mitigation", mitigatedCrit, ability, cmd.DamageType, traits, modEvidence)
			if err != nil {
				return err
			}
		}
		mitigated = mitigatedNormal + mitigatedCrit
		mitigated, modEvidence, err = f.applyPipelineDamageModifiers(
			cmd.Target, "damage", "incoming_post_mitigation", mitigated, ability, cmd.DamageType, traits, modEvidence)
		if err != nil {
			return err
		}
	} else {
		var ok bool
		mitigationDetail, ok = pipeline.MitigateRawDamageWithSource(cmd.Amount, cmd.DamageType, view.Attributes, sourceAttrs)
		if !ok {
			// Fail closed (unknown type / non-finite mitigation): no shield/HP mutation; no damage_instance.
			result := command.Result{Kind: cmd.Kind, Applied: false, Amount: 0}
			f.applyDamageResult(cmd, result, sc)
			f.run.recordGenericDamageEvidence(genericDamageEvidence{
				source:          cmd.Source,
				target:          cmd.Target,
				damageType:      cmd.DamageType,
				rawAmount:       rawForEvidence,
				mitigatedAmount: 0,
				providerRef:     f.ownerProviderRef,
				abilityRef:      f.abilityRef,
				operationRef:    operationRef,
				phantom:         false,
				crit:            critEv,
				modifiers:       modEvidence,
				traits:          traits,
			})
			return nil
		}
		mitigatedMerged := mitigationDetail.Amount
		resistFactor := mitigationDetail.ResistanceFactor
		resistanceBeforePenetration = mitigationDetail.ResistanceBeforePenetration
		penetrationPercent = mitigationDetail.PenetrationPercent
		penetrationFlat = mitigationDetail.PenetrationFlat
		effectiveResistance = mitigationDetail.EffectiveResistance
		mitigatedNormal := mitigatedMerged
		mitigatedCrit := 0.0
		if critEv.present && critEv.eligible {
			mitigatedNormal = normalPart * resistFactor
			mitigatedCrit = critPart * resistFactor
		}
		resistanceFactor = resistFactor
		normalPartPostResistance = mitigatedNormal
		critPartPostResistance = mitigatedCrit
		if critEv.present && critEv.eligible {
			mitigatedCrit, modEvidence, err = f.applyPipelineDamageModifiers(
				cmd.Target, "damage", "incoming_crit_part_post_mitigation", mitigatedCrit, ability, cmd.DamageType, traits, modEvidence)
			if err != nil {
				return err
			}
		}
		mitigated = mitigatedNormal + mitigatedCrit
		mitigated, modEvidence, err = f.applyPipelineDamageModifiers(
			cmd.Target, "damage", "incoming_post_mitigation", mitigated, ability, cmd.DamageType, traits, modEvidence)
		if err != nil {
			return err
		}
	}
	if math.IsNaN(mitigated) || math.IsInf(mitigated, 0) || mitigated < 0 {
		result := command.Result{Kind: cmd.Kind, Applied: false, Amount: 0}
		f.applyDamageResult(cmd, result, sc)
		f.run.recordGenericDamageEvidence(genericDamageEvidence{
			source:          cmd.Source,
			target:          cmd.Target,
			damageType:      cmd.DamageType,
			rawAmount:       rawForEvidence,
			mitigatedAmount: 0,
			providerRef:     f.ownerProviderRef,
			abilityRef:      f.abilityRef,
			operationRef:    operationRef,
			phantom:         false,
			crit:            critEv,
			modifiers:       modEvidence,
			traits:          traits,
		})
		return nil
	}

	targetHPBefore := attribute.ReadHP(view.Attributes)
	outcome, next := pipeline.ApplyMitigatedDamage(rawForEvidence, mitigated, view, f.run.nowMs)
	f.run.nextDamageID++
	damageID := f.run.nextDamageID
	result := command.Result{
		Kind:    cmd.Kind,
		Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0,
		Amount:  outcome.MitigatedAmount,
	}
	sc.attributes = next.Attributes
	sc.shields = next.Shields
	f.applyDamageResult(cmd, result, sc)
	f.reResolveStagedAttributesTwoPass(ability)
	f.run.recordGenericDamageEvidence(genericDamageEvidence{
		source:                      cmd.Source,
		target:                      cmd.Target,
		damageType:                  cmd.DamageType,
		rawAmount:                   rawForEvidence,
		mitigatedAmount:             result.Amount,
		providerRef:                 f.ownerProviderRef,
		abilityRef:                  f.abilityRef,
		operationRef:                operationRef,
		phantom:                     false,
		crit:                        critEv,
		modifiers:                   modEvidence,
		traits:                      traits,
		castInstanceID:              f.castInstanceID,
		castOrigin:                  f.castOrigin,
		hasPostResistanceEvidence:   true,
		resistanceFactor:            resistanceFactor,
		normalPartPostResistance:    normalPartPostResistance,
		critPartPostResistance:      critPartPostResistance,
		resistanceBeforePenetration: resistanceBeforePenetration,
		penetrationPercent:          penetrationPercent,
		penetrationFlat:             penetrationFlat,
		effectiveResistance:         effectiveResistance,
		damageID:                    damageID,
		outcome:                     &outcome,
	})
	if err := f.settleDamageVamp(cmd, op, ability, outcome, targetHPBefore, damageID, false); err != nil {
		return err
	}
	f.recordLinkedPhysicalDamage(cmd, result, operationRef)
	f.maybeQueueDamageInstanceEvent(cmd, op, ability, critEv, baseRawAmount, rawForEvidence, result.Amount)
	return nil
}

// projectCritPartsAfterOutgoing projects a non-negative merged outgoing result back onto
// normal/crit parts proportionally to their pre-outgoing weights.
func projectCritPartsAfterOutgoing(preOutgoingMerged, normalPart, critPart, postOutgoingMerged float64) (float64, float64) {
	if preOutgoingMerged > 0 {
		return postOutgoingMerged * (normalPart / preOutgoingMerged), postOutgoingMerged * (critPart / preOutgoingMerged)
	}
	// Pre-outgoing merged was zero: keep both parts at zero under multiply; if an override
	// created a positive merged amount, assign it entirely to the normal part.
	if postOutgoingMerged == 0 {
		return 0, 0
	}
	return postOutgoingMerged, 0
}

func (f *executionFrame) matchesBasicDamageChannel(ability compilebundle.CompiledAbility) bool {
	basicAttackID, ok := f.run.compiled.Types.Registry.Lookup(abilityTypeBasicAttack)
	if !ok {
		return false
	}
	return ability.TypeSet.Contains(basicAttackID)
}

func (f *executionFrame) matchingDamagePipelineChannels(ability compilebundle.CompiledAbility) []string {
	channels := []string{"all_damage"}
	if f.matchesBasicDamageChannel(ability) {
		channels = append(channels, "basic_damage")
	}
	return channels
}

func pipelineModifierIdentity(mod pipeline.MountedDamageModifier) string {
	return mod.OwnerCombatantKey + "\x00" + mod.ProviderRef + "\x00" + mod.ModifierKey
}

// applyPipelineDamageModifiers evaluates mounted pipeline modifiers for one command+stage.
// hostKey is the combatant whose damageResolver is consulted (source for crit/outgoing, target for incoming).
// Channel matching is the union of all_damage plus every qualifying specific channel.
func (f *executionFrame) applyPipelineDamageModifiers(
	hostKey, command, stage string,
	amount float64,
	ability compilebundle.CompiledAbility,
	damageType string,
	traits []string,
	evidence []map[string]interface{},
) (float64, []map[string]interface{}, *model.EngineError) {
	host := f.stageFor(hostKey)
	channels := f.matchingDamagePipelineChannels(ability)
	mods := host.damageResolver.CollectForCommandChannelsWithMatches(command, channels, stage)
	if len(mods) == 0 {
		return amount, evidence, nil
	}
	baseCtx := f.evalContext(ability)
	providerCtxFn := f.providerFormulaContextFunc(hostKey)
	for _, collected := range mods {
		mod := collected.Modifier
		if mod.Bucket == "first_per_cast" {
			id := pipelineModifierIdentity(mod)
			if f.consumedFirstPerCast != nil && f.consumedFirstPerCast[id] {
				continue
			}
		}
		modCtx := baseCtx
		modCtx.HasDamageContext = true
		modCtx.DamageAmount = amount
		modCtx.DamageTraits = traits
		modCtx.DamageTypeKey = damageType
		modCtx.DamageCastOrigin = f.castOrigin
		modCtx.DamageAbilityTypes = f.abilityTypeKeys(ability)
		if providerCtxFn != nil {
			pctx := providerCtxFn(mod.OwnerCombatantKey, mod.ProviderRef)
			modCtx.HasProviderContext = pctx.HasProviderContext
			modCtx.ProviderState = pctx.ProviderState
			modCtx.ProviderTargetState = pctx.ProviderTargetState
		}
		if mod.HasCondition {
			cond, err := f.run.compiled.Formulas.Eval(mod.ConditionProg, modCtx)
			if err != nil {
				return 0, evidence, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
			}
			if cond == 0 {
				continue
			}
		}
		if !mod.HasValue {
			continue
		}
		value, err := f.run.compiled.Formulas.Eval(mod.ValueProgram, modCtx)
		if err != nil {
			return 0, evidence, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, evidence, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite pipeline modifier value", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		before := amount
		amount = pipeline.ApplyDamageValuePolicy(amount, mod.ValuePolicy, value)
		if math.IsNaN(amount) || math.IsInf(amount, 0) {
			return 0, evidence, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite pipeline modifier result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		// Zero remains valid; negative must not fall through mitigation as silent zero damage.
		if amount < 0 {
			return 0, evidence, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "negative pipeline modifier result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if mod.Bucket == "first_per_cast" {
			if f.consumedFirstPerCast == nil {
				f.consumedFirstPerCast = map[string]bool{}
			}
			f.consumedFirstPerCast[pipelineModifierIdentity(mod)] = true
		}
		evidence = append(evidence, map[string]interface{}{
			"stage":           stage,
			"command":         command,
			"modifierKey":     mod.ModifierKey,
			"before":          before,
			"value":           value,
			"after":           amount,
			"matchedChannels": append([]string(nil), collected.MatchedChannels...),
			"matchedTraits":   append([]string(nil), traits...),
			"collectionHost":  hostKey,
			"providerOwner":   mod.OwnerCombatantKey,
		})
	}
	return amount, evidence, nil
}

// recordLinkedPhysicalDamage 仅记录顶层真实 physical damage（result.Amount>0）供自动 damage_dealt 合成。
// 不重算伤害；phantom / listener child（chainDepth>0）不记录。
func (f *executionFrame) recordLinkedPhysicalDamage(cmd command.Command, result command.Result, operationRef string) {
	if f.chainDepth != 0 {
		return
	}
	if cmd.DamageType != damageTypePhysical {
		return
	}
	if result.Amount <= 0 {
		return
	}
	f.linkedPhysicalRaw += cmd.Amount
	f.linkedPhysicalMitigated += result.Amount
	f.linkedPhysicalOpRefs = append(f.linkedPhysicalOpRefs, operationRef)
}

func (f *executionFrame) applyDamageResult(cmd command.Command, result command.Result, sc *stagedCombatant) {
	// damageDealt / recordDamage use mitigated amount（抗性后、护盾前），HP clipping 不反向改变 summary。
	f.damageDealt += result.Amount
	f.run.recordDamage(cmd.Source, cmd.Target, result.Amount, f.run.nowMs)
	sc.attributes = syncHPResolved(sc.attributes)
}

// genericDamageEvidence 是 damage evidence Data 的构造输入（不新增顶层 DTO）。
type genericDamageEvidence struct {
	source          string
	target          string
	damageType      string
	rawAmount       float64
	mitigatedAmount float64
	providerRef     string
	abilityRef      string
	operationRef    string
	phantom         bool
	repeatTag       string
	replayedFrom    map[string]interface{}
	crit            frozenCritEvidence
	modifiers       []map[string]interface{}
	traits          []string
	castInstanceID  uint64
	castOrigin      string
	damageID        uint64
	outcome         *pipeline.DamageOutcome
	// hasPostResistanceEvidence gates additive resistance/part fields for successful
	// settlements only; fail-closed and phantom replay omit them.
	hasPostResistanceEvidence   bool
	resistanceFactor            float64
	normalPartPostResistance    float64
	critPartPostResistance      float64
	resistanceBeforePenetration float64
	penetrationPercent          float64
	penetrationFlat             float64
	effectiveResistance         float64
}

func (s *genericRunState) recordGenericDamageEvidence(ev genericDamageEvidence) {
	if s.evidenceCountsByKind == nil {
		s.evidenceCountsByKind = make(map[string]int)
	}
	phase := "original"
	if ev.phantom {
		phase = "phantom"
	}
	data := map[string]interface{}{
		"phase":           phase,
		"phantom":         ev.phantom,
		"source":          ev.source,
		"target":          ev.target,
		"damageType":      ev.damageType,
		"rawAmount":       ev.rawAmount,
		"mitigatedAmount": ev.mitigatedAmount,
	}
	if ev.outcome != nil {
		data["damageId"] = ev.damageID
		data["postDefenseDamage"] = ev.outcome.MitigatedAmount
		data["shieldAbsorbed"] = ev.outcome.ShieldAbsorbed
		data["actualHpLoss"] = ev.outcome.HPDamage
		data["overkillDamage"] = math.Max(0, ev.outcome.MitigatedAmount-ev.outcome.ShieldAbsorbed-ev.outcome.HPDamage)
	}
	if ev.providerRef != "" {
		data["providerRef"] = ev.providerRef
	}
	if ev.abilityRef != "" {
		data["abilityRef"] = ev.abilityRef
	}
	if ev.operationRef != "" {
		data["operationRef"] = ev.operationRef
	}
	if len(ev.traits) > 0 {
		data["traits"] = append([]string(nil), ev.traits...)
	}
	attachCastProvenance(data, ev.castInstanceID, ev.castOrigin)
	if ev.phantom {
		if ev.repeatTag != "" {
			data["repeatTag"] = ev.repeatTag
		}
		if len(ev.replayedFrom) > 0 {
			data["replayedFrom"] = ev.replayedFrom
		}
	}
	writeCritEvidenceFields(data, ev.crit)
	if ev.hasPostResistanceEvidence {
		data["resistanceFactor"] = ev.resistanceFactor
		data["normalPartPostResistance"] = ev.normalPartPostResistance
		data["critPartPostResistance"] = ev.critPartPostResistance
		data["resistanceBeforePenetration"] = ev.resistanceBeforePenetration
		data["penetrationPercent"] = ev.penetrationPercent
		data["penetrationFlat"] = ev.penetrationFlat
		data["effectiveResistance"] = ev.effectiveResistance
	}
	if len(ev.modifiers) > 0 {
		data["modifiers"] = ev.modifiers
	}
	ref := ev.abilityRef
	if ref == "" {
		ref = ev.operationRef
	}
	s.recordEvidence(model.EvidenceItem{
		TimeMs: s.nowMs,
		Kind:   model.EvidenceKindDamage,
		Ref:    ref,
		Data:   data,
	})
}

func writeCritEvidenceFields(data map[string]interface{}, critEv frozenCritEvidence) {
	if !critEv.present {
		return
	}
	data["eligible"] = critEv.eligible
	if critEv.policy != "" {
		data["policy"] = critEv.policy
	}
	data["baseRawAmount"] = critEv.baseRawAmount
	if !critEv.eligible {
		return
	}
	data["chanceRaw"] = critEv.chanceRaw
	data["chanceEffective"] = critEv.chanceEffective
	data["originalCritChance"] = critEv.originalCritChance
	data["effectiveCritChance"] = critEv.chanceEffective
	data["multiplier"] = critEv.multiplier
	data["naturalCritWeight"] = critEv.naturalWeight
	data["forcedCritWeight"] = critEv.forcedWeight
	data["naturalCritMultiplier"] = critEv.naturalMultiplier
	data["forcedCritMultiplier"] = critEv.forcedMultiplier
	data["normalPart"] = critEv.normalPart
	data["critPart"] = critEv.critPart
	data["critAdjustedRawAmount"] = critEv.critAdjustedRawAmount
}

// settleExpectedCrit applies the unified deterministic expected-crit branch pipeline
// before outgoing modifiers / resistance. Only CritEligible damage settles; otherwise
// amount is unchanged. No command-budget cost. No RNG.
func (f *executionFrame) settleExpectedCrit(op compilebundle.CompiledOperation, ability compilebundle.CompiledAbility, baseRawAmount float64) (frozenCritEvidence, float64, []map[string]interface{}, *model.EngineError) {
	if !op.CritEligible {
		return frozenCritEvidence{}, baseRawAmount, nil, nil
	}
	src := f.stageFor(f.sourceKey)
	chanceRaw, err := readRequiredResolvedAttr(src.attributes, "crit_chance", f)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	critDamageRaw, err := readRequiredResolvedAttr(src.attributes, "crit_damage", f)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	p, _ := crit.ClampValue("crit_chance", "source", chanceRaw, crit.ProbabilityBounds())
	traits := append([]string(nil), op.Types...)
	var modEvidence []map[string]interface{}

	q := p
	q, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, "crit", "crit_chance_pre_settlement", q, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	q, _ = crit.ClampValue("crit_chance", "source", q, crit.ProbabilityBounds())

	mForced := critDamageRaw
	if mForced < 1 {
		mForced = 1
	}
	mForced, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, "crit", "crit_multiplier_forced_branch", mForced, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	if mForced < 1 {
		mForced = 1
	}

	mNatural := critDamageRaw
	if mNatural < 1 {
		mNatural = 1
	}
	mNatural, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, "crit", "crit_multiplier_natural_branch", mNatural, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	if mNatural < 1 {
		mNatural = 1
	}

	naturalWeight := p
	if q < naturalWeight {
		naturalWeight = q
	}
	forcedWeight := q - p
	if forcedWeight < 0 {
		forcedWeight = 0
	}
	normalWeight := 1 - q
	normalPart := baseRawAmount * normalWeight
	critPart := baseRawAmount * (naturalWeight*mNatural + forcedWeight*mForced)
	critAdjusted := normalPart + critPart

	// Legacy single multiplier field: prefer natural; when branches equal it matches the old scalar.
	legacyMult := mNatural
	if mForced == mNatural {
		legacyMult = mNatural
	}

	return frozenCritEvidence{
		present:               true,
		eligible:              true,
		policy:                "expected",
		chanceRaw:             chanceRaw,
		originalCritChance:    p,
		chanceEffective:       q,
		multiplier:            legacyMult,
		naturalWeight:         naturalWeight,
		forcedWeight:          forcedWeight,
		naturalMultiplier:     mNatural,
		forcedMultiplier:      mForced,
		baseRawAmount:         baseRawAmount,
		normalPart:            normalPart,
		critPart:              critPart,
		critAdjustedRawAmount: critAdjusted,
	}, critAdjusted, modEvidence, nil
}

func readRequiredResolvedAttr(attrs map[string]model.AttributeSlotDef, key string, f *executionFrame) (float64, *model.EngineError) {
	slot, ok := attrs[key]
	if !ok {
		return 0, engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "missing required attribute: "+key, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	value := slot.Resolved
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite attribute: "+key, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return value, nil
}

// stableDamageReplayedFrom 用 providerRef + ability/listener ref + operationRef 构造稳定 provenance。
// 禁止 slice index、指针地址或随机 ID。
func stableDamageReplayedFrom(providerRef, abilityRef, operationRef string) map[string]interface{} {
	from := map[string]interface{}{}
	if providerRef != "" {
		from["providerRef"] = providerRef
	}
	if abilityRef != "" {
		from["abilityRef"] = abilityRef
	}
	if operationRef != "" {
		from["operationRef"] = operationRef
	}
	return from
}

func (f *executionFrame) applyResourceChange(targetKey, resourceKey string, amount float64, ability compilebundle.CompiledAbility) *model.EngineError {
	if resourceKey == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires resourceKey", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	sc := f.stageFor(targetKey)
	if amount >= 0 {
		sc.resources = resource.Refund(sc.resources, resourceKey, amount)
	} else {
		var ok bool
		sc.resources, ok = resource.Spend(sc.resources, resourceKey, -amount)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "resource spend failed", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
	}
	f.reResolveStagedAttributesTwoPass(ability)
	return nil
}

func (f *executionFrame) applyCooldownChange(targetKey, abilityRef string, readyAt int64) *model.EngineError {
	if abilityRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "cooldown_change requires abilityRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	sc := f.stageFor(targetKey)
	sc.cooldowns[abilityRef] = readyAt
	return nil
}

func (f *executionFrame) applyAttributeChange(targetKey, attributeKey, valuePolicy string, amount float64, ability compilebundle.CompiledAbility) *model.EngineError {
	sc := f.stageFor(targetKey)
	slot, ok := sc.attributes[attributeKey]
	if !ok {
		slot = model.AttributeSlotDef{}
	}
	base0 := slot.Base
	slot.Base = applyAttributeBasePolicy(slot.Base, base0, valuePolicy, amount)
	if slot.Max > 0 {
		if slot.Base < 0 {
			slot.Base = 0
		}
		if slot.Base > slot.Max {
			slot.Base = slot.Max
		}
	}
	sc.attributes[attributeKey] = slot
	f.reResolveStagedAttributesTwoPass(ability)
	sc.dirty = true
	return nil
}

func applyAttributeBasePolicy(current, base0 float64, policy string, amount float64) float64 {
	switch policy {
	case "set", "override_base":
		return amount
	case "multiply":
		return current * amount
	case "percent_add":
		return current + base0*amount
	case "min":
		return math.Min(current, amount)
	case "max":
		return math.Max(current, amount)
	case "add", "":
		return current + amount
	default:
		return current + amount
	}
}

func combatantPrefixFromAbilityRef(abilityRef string) string {
	if idx := strings.Index(abilityRef, "."); idx > 0 {
		return abilityRef[:idx]
	}
	return abilityRef
}

func (f *executionFrame) stageLifecycleCostCooldown(ability compilebundle.CompiledAbility, sourceKey string) *model.EngineError {
	if ability.Cost != nil && ability.Cost.HasAmount {
		amount, err := f.evalAmount(ability.Cost.AmountProgram, ability)
		if err != nil {
			return err
		}
		if err := f.applyResourceChange(sourceKey, ability.Cost.ResourceKey, -amount, ability); err != nil {
			return err
		}
	}
	if ability.Cooldown != nil && ability.Cooldown.HasDuration {
		duration, err := f.evalAmount(ability.Cooldown.DurationProgram, ability)
		if err != nil {
			return err
		}
		readyAt := f.run.nowMs + int64(duration)
		return f.applyCooldownChange(sourceKey, f.abilityRef, readyAt)
	}
	return nil
}

func (f *executionFrame) commit() {
	if f.fatal {
		return
	}
	for key, staged := range f.staged {
		c, ok := f.run.combatants[key]
		if !ok {
			c = combatantRuntime{key: key, cooldowns: map[string]int64{}, providerState: map[string]*providerStateBag{}}
		}
		c.attributes = cloneAttributeMap(staged.attributes)
		c.resources = cloneResourceMap(staged.resources)
		c.cooldowns = cloneCooldownMap(staged.cooldowns)
		c.shields = pipeline.RuntimeShieldsFromView(staged.shields, key, f.sourceKey)
		c.providers = append([]status.ProviderInstance(nil), staged.providers...)
		c.resolver = staged.resolver.Clone()
		c.damageResolver = staged.damageResolver.Clone()
		c.providerState = cloneProviderStateMap(staged.providerState)
		f.run.combatants[key] = c
	}
	evalAbility := compilebundle.CompiledAbility{Params: map[string]float64{}}
	evalCtx := f.evalContext(evalAbility)
	for _, staged := range f.staged {
		for _, mut := range staged.providerOps {
			switch mut.kind {
			case "apply":
				if err := f.run.applyProviderInstance(mut.targetKey, mut.sourceKey, mut.definitionRef, mut.expireAt, mut.hasExpireAt, mut.contributions); err != nil {
					f.fatal = true
					f.fatalErr = err
					return
				}
			case "refresh":
				if err := f.run.refreshProviderInstance(mut.targetKey, mut.providerRef, mut.expireAt, mut.hasExpireAt, mut.contributions); err != nil {
					f.fatal = true
					f.fatalErr = err
					return
				}
			case "expire":
				if mut.strict {
					if err := f.run.removeProviderInstanceStrict(mut.targetKey, mut.providerRef, mut.definitionRef, evalCtx); err != nil {
						f.fatal = true
						f.fatalErr = err
						return
					}
					continue
				}
				f.run.expireProviderInstance(mut.targetKey, mut.providerRef, evalCtx)
			}
		}
	}
}

func (s *genericRunState) resolveOperationTarget(selector, entrySource, entryTarget string) (string, bool) {
	key, ok := s.resolveCombatantKey(selector, entrySource, entryTarget)
	return key, ok
}

func (s *genericRunState) resolveCombatantKey(selector, entrySource, entryTarget string) (string, bool) {
	switch selector {
	case model.SelectorSource:
		return entrySource, s.combatantExists(entrySource)
	case model.SelectorTarget:
		return entryTarget, s.combatantExists(entryTarget)
	case model.SelectorSelf:
		return entrySource, s.combatantExists(entrySource)
	case model.SelectorOpponent:
		if entrySource == model.SelectorSource {
			return model.SelectorTarget, s.combatantExists(model.SelectorTarget)
		}
		if entrySource == model.SelectorTarget {
			return model.SelectorSource, s.combatantExists(model.SelectorSource)
		}
		return entryTarget, s.combatantExists(entryTarget)
	default:
		if s.combatantExists(selector) {
			return selector, true
		}
		return "", false
	}
}

func (s *genericRunState) combatantExists(key string) bool {
	_, ok := s.combatants[key]
	return ok
}

func (s *genericRunState) executeAbilityCast(entry model.DriverEntry) *model.EngineError {
	sourceKey, ok := s.resolveCombatantKey(entry.Source, entry.Source, entry.Target)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "source unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	targetKey, ok := s.resolveCombatantKey(entry.Target, entry.Source, entry.Target)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "target unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	return s.castAbilityAt(sourceKey, targetKey, entry.AbilityRef, 0, nil, nil, entry.EntryKey)
}

// castAbilityAt 在独立 execution frame 中施放 ability（driver cast 与 listener child ability 共用）。
// eventCtx 非 nil 时继承原始 emit 快照（listener abilityRef child cast）。
// collector 非 nil 时表示处于某次真实 emitted event 的 listener/child 路径，共享 event-local collector。
//
// Cast-instance 规则：
//   - 顶层 driver / TickSpec / Listener AbilityRef 完整 child ability：总是 mint 新 ID，使用本 ability 的 CastOrigin。
//   - 同 frame 多 op / delayed 继承 frame 上的 ID+origin（本函数内一次 mint）。
func (s *genericRunState) castAbilityAt(sourceKey, targetKey, abilityRef string, chainDepth int, eventCtx *eventFormulaSnapshot, collector *eventCopyableCollector, driverEntryKey string) *model.EngineError {
	resolvedRef := normalizeAbilityRef(abilityRef, sourceKey, targetKey)
	ref, ok := s.compiled.AbilityRefIndex[resolvedRef]
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown abilityRef", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ability := s.compiled.Abilities[ref.AbilityIndex]
	start := ability.OperationStart
	end := start + ability.OperationCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "operation range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]

	// Lazy-expire provider timed state and refresh resolved attrs before staging entry snapshots.
	s.refreshProviderAwareAttributes(sourceKey, targetKey)

	frame := s.newExecutionFrame(sourceKey, targetKey, resolvedRef)
	frame.chainDepth = chainDepth
	frame.eventCtx = cloneEventSnapshot(eventCtx)
	frame.copyableCollector = collector
	frame.driverEntryKey = driverEntryKey
	if int(ref.CombatantIndex) < len(s.compiled.Combatants) {
		frame.ownerCombatantKey = s.compiled.Combatants[ref.CombatantIndex].Key
	}
	if parsed, ok := compilebundle.ParseAbilityRef(resolvedRef); ok {
		frame.ownerProviderRef = parsed.ProviderRef
		if frame.ownerCombatantKey == "" {
			frame.ownerCombatantKey = parsed.Combatant
		}
	}
	if err := frame.stageLifecycleCostCooldown(ability, sourceKey); err != nil {
		return err
	}
	// Mint after successful gate (driver) / lifecycle staging; Listener AbilityRef always new ID.
	frame.castInstanceID = s.mintCastInstanceID()
	frame.castOrigin = ability.CastOrigin
	if err := frame.executeOperations(ability, ops); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	// 自动 damage_dealt：commit 后、pending/listener dispatch 前追加到 pendingEvents 尾部。
	frame.maybeQueueDamageDealtEvent(ability)
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	if err := frame.maybeDispatchAbilityStartedEvent(ability); err != nil {
		return err
	}

	s.abilityCastCount++
	acc := s.statFor(resolvedRef)
	acc.castCount++
	if frame.damageDealt > 0 {
		if acc.damageDealt == nil {
			v := frame.damageDealt
			acc.damageDealt = &v
		} else {
			*acc.damageDealt += frame.damageDealt
		}
	}
	if frame.healingDone > 0 {
		if acc.healingDone == nil {
			v := frame.healingDone
			acc.healingDone = &v
		} else {
			*acc.healingDone += frame.healingDone
		}
	}

	s.checkDeathStopReason()
	return nil
}

const (
	abilityTypeBasicAttack          = "ability/basic_attack"
	eventTypeAbilityStarted         = "event/ability_started"
	eventTypeBasicAttackHit         = "event/basic_attack_hit"
	eventTypeDamageDealt            = "event/damage_dealt"
	eventTypeDamageDealtPhysical    = "event/damage_dealt/physical"
	eventTypeDamageDealtBasicAttack = "event/damage_dealt/basic_attack"
	eventTypeDamageInstance         = "event/damage_instance"
	damageTypePhysical              = "damage/physical"
	executeThresholdTypeRatio       = "current_hp_ratio"
	executeThresholdComparison      = "strict_below"
)

// buildDamageInstanceSnapshot freezes event.damage.* from current expected-crit settlement evidence.
// originalCritChance is p; effectiveCritChance is q. Weights follow min(p,q) / max(0,q-p).
//
// naturalBranchRawAmount is the unweighted natural critical branch after the same outgoing
// projection applied to the merged amount, before resistance — not the expected merged amount
// and not the probability-weighted crit part. normalPart/critPart remain expected weighted
// parts after outgoing projection and before resistance (already projected into critEv).
func buildDamageInstanceSnapshot(critEv frozenCritEvidence, baseRawAmount, preMitigationAmount, mitigatedAmount float64) formula.EventDamageSnapshot {
	snap := formula.EventDamageSnapshot{
		BaseRawAmount:       baseRawAmount,
		PreMitigationAmount: preMitigationAmount,
		MitigatedAmount:     mitigatedAmount,
	}
	if !critEv.present || !critEv.eligible {
		return snap
	}
	snap.OriginalCritChance = critEv.originalCritChance
	snap.EffectiveCritChance = critEv.chanceEffective
	snap.ForcedCritWeight = critEv.forcedWeight
	snap.NaturalCritWeight = critEv.naturalWeight
	snap.ForcedCritMultiplier = critEv.forcedMultiplier
	snap.NaturalCritMultiplier = critEv.naturalMultiplier
	snap.NormalPart = critEv.normalPart
	snap.CritPart = critEv.critPart
	// Unweighted natural branch: base * naturalCritMultiplier * outgoingFactor.
	outgoingFactor := 0.0
	if critEv.critAdjustedRawAmount != 0 {
		outgoingFactor = preMitigationAmount / critEv.critAdjustedRawAmount
	}
	snap.NaturalBranchRawAmount = baseRawAmount * critEv.naturalMultiplier * outgoingFactor
	return snap
}

func damageSnapshotEvidenceData(snap formula.EventDamageSnapshot) map[string]interface{} {
	return map[string]interface{}{
		"baseRawAmount":          snap.BaseRawAmount,
		"preMitigationAmount":    snap.PreMitigationAmount,
		"mitigatedAmount":        snap.MitigatedAmount,
		"originalCritChance":     snap.OriginalCritChance,
		"effectiveCritChance":    snap.EffectiveCritChance,
		"forcedCritWeight":       snap.ForcedCritWeight,
		"naturalCritWeight":      snap.NaturalCritWeight,
		"forcedCritMultiplier":   snap.ForcedCritMultiplier,
		"naturalCritMultiplier":  snap.NaturalCritMultiplier,
		"normalPart":             snap.NormalPart,
		"critPart":               snap.CritPart,
		"naturalBranchRawAmount": snap.NaturalBranchRawAmount,
	}
}

func (f *executionFrame) abilityTypeKeys(ability compilebundle.CompiledAbility) []string {
	keys := make([]string, 0)
	for i, key := range f.run.compiled.Types.Registry.Keys {
		if ability.TypeSet.Contains(typeset.TypeID(i)) {
			keys = append(keys, key)
		}
	}
	return keys
}

// maybeQueueDamageInstanceEvent emits event/damage_instance once after a non-phantom damage
// operation completes settlement without structural failure (including zero amounts).
func (f *executionFrame) maybeQueueDamageInstanceEvent(
	cmd command.Command,
	op compilebundle.CompiledOperation,
	ability compilebundle.CompiledAbility,
	critEv frozenCritEvidence,
	baseRawAmount, preMitigationAmount, mitigatedAmount float64,
) {
	if f.copyableCollector != nil && f.copyableCollector.phantomDepth > 0 {
		return
	}
	if _, ok := f.run.compiled.Types.Registry.Lookup(eventTypeDamageInstance); !ok {
		return
	}
	traits := append([]string(nil), op.Types...)
	snap := buildDamageInstanceSnapshot(critEv, baseRawAmount, preMitigationAmount, mitigatedAmount)
	eventTypes := []string{eventTypeDamageInstance}
	if cmd.DamageType != "" {
		if _, ok := f.run.compiled.Types.Registry.Lookup(cmd.DamageType); ok {
			eventTypes = append(eventTypes, cmd.DamageType)
		}
	}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = append(eventTypes, traits...)
	eventTypes = f.appendCastOriginEventType(eventTypes)

	snapshot := f.captureEmitSnapshot(eventTypeDamageInstance, cmd.Source, cmd.Target)
	snapshot.hasDamageSnapshot = true
	snapshot.damageSnapshot = snap
	snapshot.damageTraits = traits
	snapshot.damageTypeKey = cmd.DamageType

	data := map[string]interface{}{
		"source":     cmd.Source,
		"target":     cmd.Target,
		"eventType":  eventTypeDamageInstance,
		"damageType": cmd.DamageType,
		"abilityRef": f.abilityRef,
		"phantom":    false,
		"traits":     traits,
		"damage":     damageSnapshotEvidenceData(snap),
	}
	if op.Ref != "" {
		data["operationRef"] = op.Ref
	}
	attachCastProvenance(data, f.castInstanceID, f.castOrigin)
	f.run.recordEvidence(model.EvidenceItem{
		TimeMs: f.run.nowMs,
		Kind:   model.EvidenceKindEmittedEvent,
		Ref:    eventTypeDamageInstance,
		Data:   data,
	})
	f.pendingEvents = append(f.pendingEvents, emittedEvent{
		eventType:      eventTypeDamageInstance,
		ref:            eventTypeDamageInstance,
		sourceKey:      cmd.Source,
		targetKey:      cmd.Target,
		types:          eventTypes,
		snapshot:       snapshot,
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
	})
}

// maybeQueueDamageDealtEvent 在顶层真实 physical 伤害 commit 后合成 event/damage_dealt（追加 pending 尾部）。
// 条件：chainDepth==0；本 frame 至少一次 damage/physical 经 pipeline 后 result.Amount>0。
// 基本与非基本 root physical frame 均 emit event/damage_dealt + event/damage_dealt/physical；
// 仅 ability TypeSet 含 ability/basic_attack 时附加 event/damage_dealt/basic_attack。
// catalog 缺合成所需 type 时 fail closed（不 emit、不 fatal）。
// phantom replay 与 listener child（chainDepth>0）不走此路径；同一 frame 多个合格 physical op 只合成一次。
func (f *executionFrame) maybeQueueDamageDealtEvent(ability compilebundle.CompiledAbility) {
	if f.chainDepth != 0 {
		return
	}
	if f.linkedPhysicalMitigated <= 0 {
		return
	}
	required := []string{
		damageTypePhysical,
		eventTypeDamageDealt,
		eventTypeDamageDealtPhysical,
	}
	for _, key := range required {
		if _, ok := f.run.compiled.Types.Registry.Lookup(key); !ok {
			return
		}
	}

	eventTypes := []string{
		eventTypeDamageDealt,
		eventTypeDamageDealtPhysical,
	}
	basicAttackID, hasBasicType := f.run.compiled.Types.Registry.Lookup(abilityTypeBasicAttack)
	isBasicAttack := hasBasicType && ability.TypeSet.Contains(basicAttackID)
	// Optional qualifier: missing event/damage_dealt/basic_attack must not block core emit.
	if isBasicAttack {
		if _, ok := f.run.compiled.Types.Registry.Lookup(eventTypeDamageDealtBasicAttack); ok {
			eventTypes = append(eventTypes, eventTypeDamageDealtBasicAttack)
		}
	}

	data := map[string]interface{}{
		"source":          f.sourceKey,
		"target":          f.targetKey,
		"eventType":       eventTypeDamageDealt,
		"damageType":      damageTypePhysical,
		"abilityRef":      f.abilityRef,
		"rawAmount":       f.linkedPhysicalRaw,
		"mitigatedAmount": f.linkedPhysicalMitigated,
		"phantom":         false,
	}
	attachCastProvenance(data, f.castInstanceID, f.castOrigin)
	switch len(f.linkedPhysicalOpRefs) {
	case 0:
		// unreachable when mitigated>0, but keep provenance deterministic
	case 1:
		if f.linkedPhysicalOpRefs[0] != "" {
			data["operationRef"] = f.linkedPhysicalOpRefs[0]
		}
	default:
		refs := make([]string, len(f.linkedPhysicalOpRefs))
		copy(refs, f.linkedPhysicalOpRefs)
		data["operationRefs"] = refs
	}

	eventTypes = f.appendCastOriginEventType(eventTypes)

	f.run.recordEvidence(model.EvidenceItem{
		TimeMs: f.run.nowMs,
		Kind:   model.EvidenceKindEmittedEvent,
		Ref:    eventTypeDamageDealt,
		Data:   data,
	})
	f.pendingEvents = append(f.pendingEvents, emittedEvent{
		eventType:      eventTypeDamageDealt,
		ref:            eventTypeDamageDealt,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          eventTypes,
		snapshot:       f.captureEmitSnapshot(eventTypeDamageDealt, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
	})
}

// maybeDispatchAbilityStartedEvent 在顶层成功 cast 后自动合成 event/ability_started（reserved 20205）。
// 条件：chainDepth==0，且 ability TypeSet 不含 ability/basic_attack（经 type catalog Lookup，禁止 abilityKey 启发式）。
// catalog 缺 ability/basic_attack 时 fail closed（不合成）；缺 event/ability_started 时同样不合成。
// gate/cost/cooldown 失败不会进入本路径；listener child cast（chainDepth>0）不合成。
// TypeSet includes event/ability_started plus the source ability TypeSet keys.
func (f *executionFrame) maybeDispatchAbilityStartedEvent(ability compilebundle.CompiledAbility) *model.EngineError {
	if f.chainDepth != 0 {
		return nil
	}
	basicAttackID, ok := f.run.compiled.Types.Registry.Lookup(abilityTypeBasicAttack)
	if !ok {
		// Fail closed: without the classifier type, never treat all abilities as non-basic-attack.
		return nil
	}
	if ability.TypeSet.Contains(basicAttackID) {
		return nil
	}
	if _, ok := f.run.compiled.Types.Registry.Lookup(eventTypeAbilityStarted); !ok {
		// Event type absent from catalog: cannot participate in type-set matching; do not invent it.
		return nil
	}
	eventTypes := []string{eventTypeAbilityStarted}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = f.appendCastOriginEventType(eventTypes)
	startedData := map[string]interface{}{
		"source":    f.sourceKey,
		"target":    f.targetKey,
		"eventType": eventTypeAbilityStarted,
	}
	attachCastProvenance(startedData, f.castInstanceID, f.castOrigin)
	f.run.recordEvidence(model.EvidenceItem{
		TimeMs: f.run.nowMs,
		Kind:   model.EvidenceKindEmittedEvent,
		Ref:    eventTypeAbilityStarted,
		Data:   startedData,
	})
	ev := emittedEvent{
		eventType:      eventTypeAbilityStarted,
		ref:            eventTypeAbilityStarted,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          eventTypes,
		snapshot:       f.captureEmitSnapshot(eventTypeAbilityStarted, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
	}
	return f.run.dispatchListeners(ev, f.chainDepth+1)
}

func (f *executionFrame) dispatchPendingEvents() *model.EngineError {
	if len(f.pendingEvents) == 0 {
		return nil
	}
	events := append([]emittedEvent(nil), f.pendingEvents...)
	f.pendingEvents = nil
	for _, ev := range events {
		if ev.eventType == model.EventTypeSkillHit && ev.skillHit != nil {
			if err := f.run.dispatchSkillHitEvent(ev, f.chainDepth+1); err != nil {
				return err
			}
			continue
		}
		if err := f.run.dispatchListeners(ev, f.chainDepth+1); err != nil {
			return err
		}
	}
	return nil
}

func (s *genericRunState) dispatchListeners(ev emittedEvent, chainDepth int) *model.EngineError {
	if chainDepth > s.budget.MaxChainDepth {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "max chain depth exceeded", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	collector := &eventCopyableCollector{}
	baseEventTypes := s.eventTypeSet(ev.types)
	listeners := append(append([]compilebundle.CompiledListener{}, s.compiled.Listeners...), s.runtimeListeners...)
	for listenerIndex, listener := range listeners {
		if !s.listenerStillLive(listener) {
			continue
		}
		if ev.eventType == model.EventTypeSpellShieldBlocked && ev.skillHit != nil && listener.OwnerProviderRef != "" &&
			(listener.OwnerCombatantKey != ev.skillHit.shieldOwner || listener.OwnerProviderRef != ev.skillHit.shieldProviderRef) {
			continue
		}
		eventTypes := baseEventTypes
		if listener.OwnerCombatantKey != "" {
			eventTypes = s.augmentOwnerRelativeEventTypes(baseEventTypes, ev.sourceKey, listener.OwnerCombatantKey)
		}
		if !listener.EventMatcher.Match(eventTypes) {
			continue
		}
		maxTriggers := listener.MaxTriggersPerEvent
		if maxTriggers <= 0 {
			maxTriggers = 1
		}
		if maxTriggers < 1 {
			continue
		}
		hasOps := listener.OperationCount > 0
		hasAbilityRef := listener.HasAbilityRef && listener.AbilityRef != ""
		if !hasOps && !hasAbilityRef {
			continue
		}
		castID := ev.castInstanceID
		if castID == 0 {
			castID = ev.snapshot.castInstanceID
		}
		if !s.allowPerCastThrottle(listenerIndex, listener.OwnerCombatantKey, listener.OwnerProviderRef, castID, listener.PerCastThrottleMs) {
			continue
		}
		sourceKey, targetKey := s.listenerFrameCombatants(ev, listener)
		eventCtx := cloneEventSnapshot(&ev.snapshot)
		if eventCtx != nil {
			if eventCtx.castInstanceID == 0 {
				eventCtx.castInstanceID = castID
			}
			if eventCtx.castOrigin == "" {
				eventCtx.castOrigin = ev.castOrigin
			}
		}
		triggered := false
		for trigger := 0; trigger < maxTriggers; trigger++ {
			if hasOps {
				if err := s.dispatchListenerOperations(listener, sourceKey, targetKey, chainDepth, eventCtx, collector); err != nil {
					return err
				}
				triggered = true
			}
			if hasAbilityRef {
				if err := s.castAbilityAt(sourceKey, targetKey, listener.AbilityRef, chainDepth, eventCtx, collector, ""); err != nil {
					return err
				}
				triggered = true
			}
		}
		if triggered && listener.PerCastThrottleMs > 0 {
			s.notePerCastThrottleTrigger(listenerIndex, listener.OwnerCombatantKey, listener.OwnerProviderRef, castID)
		}
	}
	return s.flushDeferredPhantomReplay(collector)
}

const (
	eventSourceOwner    = "event/source_owner"
	eventSourceOpponent = "event/source_opponent"
)

// augmentOwnerRelativeEventTypes adds a catalog-backed owner-relative relation key for provider listeners.
func (s *genericRunState) augmentOwnerRelativeEventTypes(base typeset.TypeSet, eventSourceKey, ownerKey string) typeset.TypeSet {
	out := base
	relKey := eventSourceOpponent
	if eventSourceKey == ownerKey {
		relKey = eventSourceOwner
	}
	if id, ok := s.compiled.Types.Registry.Lookup(relKey); ok {
		out.Add(id)
	}
	return out
}

func (s *genericRunState) listenerFrameCombatants(ev emittedEvent, listener compilebundle.CompiledListener) (sourceKey, targetKey string) {
	sourceKey = ev.sourceKey
	targetKey = ev.targetKey
	if listener.OwnerCombatantKey != "" {
		sourceKey = listener.OwnerCombatantKey
		if targetKey == sourceKey {
			if sourceKey == model.SelectorSource {
				targetKey = model.SelectorTarget
			} else {
				targetKey = model.SelectorSource
			}
		}
	}
	return sourceKey, targetKey
}

func (s *genericRunState) dispatchListenerOperations(listener compilebundle.CompiledListener, sourceKey, targetKey string, chainDepth int, eventCtx *eventFormulaSnapshot, collector *eventCopyableCollector) *model.EngineError {
	start := listener.OperationStart
	end := start + listener.OperationCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "listener operation range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]
	ability := compilebundle.CompiledAbility{Params: map[string]float64{}}
	if listener.SourceAbilityIndex >= 0 && listener.SourceAbilityIndex < len(s.compiled.Abilities) {
		ability = s.compiled.Abilities[listener.SourceAbilityIndex]
	}
	frame := s.newExecutionFrame(sourceKey, targetKey, "listener:"+listener.ListenerKey)
	frame.chainDepth = chainDepth
	frame.ownerCombatantKey = listener.OwnerCombatantKey
	frame.ownerProviderRef = listener.OwnerProviderRef
	frame.eventCtx = cloneEventSnapshot(eventCtx)
	frame.copyableCollector = collector
	// Listener Operations inherit triggering cast identity (do not mint).
	if eventCtx != nil {
		frame.castInstanceID = eventCtx.castInstanceID
		frame.castOrigin = eventCtx.castOrigin
	}
	if err := frame.executeOperations(ability, ops); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	return frame.dispatchPendingEvents()
}

func (s *genericRunState) eventTypeSet(keys []string) typeset.TypeSet {
	var set typeset.TypeSet
	for _, key := range keys {
		if key == "" {
			continue
		}
		if id, ok := s.compiled.Types.Registry.Lookup(key); ok {
			set.Add(id)
		}
	}
	return set
}

func syncHPResolved(attrs map[string]model.AttributeSlotDef) map[string]model.AttributeSlotDef {
	slot, ok := attrs["hp"]
	if !ok {
		return attrs
	}
	slot.Resolved = slot.Current
	attrs["hp"] = slot
	return attrs
}

// reResolveStagedAttributesTwoPass 在 live HP/resource/attribute 变更后，确定性两遍
// 重算 Resolved（每遍先 source 后 target）。只改 Resolved；保留 Current/Max；
// 每遍结束后强制 hp.Resolved=hp.Current。不改 Base（attribute_change 的 Base 策略除外）。
func (f *executionFrame) reResolveStagedAttributesTwoPass(ability compilebundle.CompiledAbility) {
	for pass := 0; pass < 2; pass++ {
		for _, key := range []string{f.sourceKey, f.targetKey} {
			if key == "" {
				continue
			}
			sc := f.stageFor(key)
			evalCtx := f.evalContext(ability)
			sc.attributes = f.resolveAttributesFor(key, sc.attributes, evalCtx)
			sc.attributes = syncHPResolved(sc.attributes)
		}
	}
}

// reResolveLiveAttributesTwoPass 对 live combatants 做与 executionFrame 相同的确定性两遍
// source→target Resolved 重算（provider-aware）。只改 Resolved；保留 Current/Max；
// 每遍结束后强制 hp.Resolved=hp.Current。不遍历 map；不派发事件、不重跑 crit。
func (s *genericRunState) reResolveLiveAttributesTwoPass(sourceKey, targetKey string) {
	for pass := 0; pass < 2; pass++ {
		for _, key := range []string{sourceKey, targetKey} {
			if key == "" {
				continue
			}
			c, ok := s.combatants[key]
			if !ok {
				continue
			}
			evalCtx := s.evalContextForCombatants(sourceKey, targetKey)
			c.attributes = s.resolveAttributesFor(key, c.attributes, evalCtx, targetKey)
			c.attributes = syncHPResolved(c.attributes)
			s.combatants[key] = c
		}
	}
}

func (s *genericRunState) recordOverheal(sourceKey string, amount float64) {
	if amount <= 0 {
		return
	}
	if sourceKey == model.SelectorSource {
		s.sourceOverheal += amount
	}
	if sourceKey == model.SelectorTarget {
		s.targetOverheal += amount
	}
}

func (f *executionFrame) registerDeferredRepeat(op compilebundle.CompiledOperation) *model.EngineError {
	collector := f.copyableCollector
	if collector == nil || collector.phantomDepth > 0 {
		return nil
	}
	if op.RepeatScope != model.RepeatScopeCopyableOnHit {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "repeat requires repeatScope="+model.RepeatScopeCopyableOnHit, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if f.ownerProviderRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "repeat requires owning provider context", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	repeatCount := op.RepeatCount
	if repeatCount <= 0 {
		repeatCount = 1
	}
	collector.repeats = append(collector.repeats, deferredRepeatRequest{
		ownerCombatantKey: f.providerOwnerKey(),
		ownerProviderRef:  f.ownerProviderRef,
		triggerStateKey:   op.TriggerStateKey,
		threshold:         op.Threshold,
		repeatCount:       repeatCount,
		repeatScope:       op.RepeatScope,
		repeatTag:         op.RepeatTag,
		repeatDelayMs:     op.RepeatDelayMs,
	})
	return nil
}

func (f *executionFrame) maybeCollectCopyableDamage(op compilebundle.CompiledOperation, ability compilebundle.CompiledAbility, rawAmount float64, targetKey string, critEv frozenCritEvidence) *model.EngineError {
	collector := f.copyableCollector
	if collector == nil || collector.phantomDepth > 0 || !op.CopyableOnHit || op.Operation != "damage" {
		return nil
	}
	if collector.commandCount > f.run.budget.MaxCommandsPerEvent {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "max commands per event exceeded", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	rec := copyableDamageFrozen{
		rawAmount:      rawAmount,
		damageType:     op.DamageType,
		sourceKey:      f.sourceKey,
		targetKey:      targetKey,
		providerRef:    f.ownerProviderRef,
		originRef:      f.abilityRef,
		operationRef:   op.Ref,
		crit:           critEv,
		ability:        ability,
		operation:      op,
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
	}
	if f.eventCtx != nil {
		rec.eventSourceKey = f.eventCtx.eventSourceKey
		rec.eventTargetKey = f.eventCtx.eventTargetKey
		rec.entrySourceAttrs = cloneAttributeMap(f.eventCtx.entrySourceAttrs)
		rec.entryTargetAttrs = cloneAttributeMap(f.eventCtx.entryTargetAttrs)
	} else {
		rec.eventSourceKey = f.sourceKey
		rec.eventTargetKey = f.targetKey
		rec.entrySourceAttrs = cloneAttributeMap(f.entrySourceAttrs)
		rec.entryTargetAttrs = cloneAttributeMap(f.entryTargetAttrs)
	}
	collector.damages = append(collector.damages, rec)
	if len(collector.damages)+len(collector.repeats) > f.run.budget.MaxCommandsPerEvent {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "max commands per event exceeded", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return nil
}

// sortCopyableDamagesStable 按 provenance 升序稳定排序；完全相同项保持原始相对顺序。
// 键：providerRef、originRef、sourceKey、targetKey、damageType。不依赖 map 遍历。
func sortCopyableDamagesStable(damages []copyableDamageFrozen) {
	sort.SliceStable(damages, func(i, j int) bool {
		a, b := damages[i], damages[j]
		if a.providerRef != b.providerRef {
			return a.providerRef < b.providerRef
		}
		if a.originRef != b.originRef {
			return a.originRef < b.originRef
		}
		if a.sourceKey != b.sourceKey {
			return a.sourceKey < b.sourceKey
		}
		if a.targetKey != b.targetKey {
			return a.targetKey < b.targetKey
		}
		return a.damageType < b.damageType
	})
}

// sortDeferredRepeatsStable 按 provenance 升序稳定排序；完全相同项保持原始相对顺序。
// 键：ownerProviderRef、ownerCombatantKey、repeatTag、triggerStateKey、repeatScope、threshold、repeatCount。
func sortDeferredRepeatsStable(repeats []deferredRepeatRequest) {
	sort.SliceStable(repeats, func(i, j int) bool {
		a, b := repeats[i], repeats[j]
		if a.ownerProviderRef != b.ownerProviderRef {
			return a.ownerProviderRef < b.ownerProviderRef
		}
		if a.ownerCombatantKey != b.ownerCombatantKey {
			return a.ownerCombatantKey < b.ownerCombatantKey
		}
		if a.repeatTag != b.repeatTag {
			return a.repeatTag < b.repeatTag
		}
		if a.triggerStateKey != b.triggerStateKey {
			return a.triggerStateKey < b.triggerStateKey
		}
		if a.repeatScope != b.repeatScope {
			return a.repeatScope < b.repeatScope
		}
		if a.threshold != b.threshold {
			return a.threshold < b.threshold
		}
		return a.repeatCount < b.repeatCount
	})
}

// sortEventCopyableProvenanceStable 对 collector 内切片原地稳定排序（测试 helper）。
// flush 路径必须使用 cloneAndSortEventCopyableProvenance，避免破坏 collector 原始 append 顺序。
func sortEventCopyableProvenanceStable(collector *eventCopyableCollector) {
	if collector == nil {
		return
	}
	sortCopyableDamagesStable(collector.damages)
	sortDeferredRepeatsStable(collector.repeats)
}

// cloneAndSortEventCopyableProvenance 复制 damages/repeats 后做稳定 provenance 排序。
// 返回的切片供 phantom replay 遍历；不修改 collector 原切片。
func cloneAndSortEventCopyableProvenance(collector *eventCopyableCollector) (damages []copyableDamageFrozen, repeats []deferredRepeatRequest) {
	if collector == nil {
		return nil, nil
	}
	damages = append([]copyableDamageFrozen(nil), collector.damages...)
	repeats = append([]deferredRepeatRequest(nil), collector.repeats...)
	sortCopyableDamagesStable(damages)
	sortDeferredRepeatsStable(repeats)
	return damages, repeats
}

func (s *genericRunState) flushDeferredPhantomReplay(collector *eventCopyableCollector) *model.EngineError {
	if collector == nil || len(collector.repeats) == 0 || collector.phantomDepth > 0 {
		return nil
	}
	damages, repeats := cloneAndSortEventCopyableProvenance(collector)
	immediate := make([]deferredRepeatRequest, 0, len(repeats))
	delayed := make([]deferredRepeatRequest, 0, len(repeats))
	for _, req := range repeats {
		if req.repeatDelayMs > 0 {
			delayed = append(delayed, req)
		} else {
			immediate = append(immediate, req)
		}
	}

	collector.phantomDepth = 1
	defer func() { collector.phantomDepth = 0 }()

	for _, req := range immediate {
		if req.repeatScope != model.RepeatScopeCopyableOnHit {
			continue
		}
		if !s.repeatTriggerMet(req) {
			continue
		}
		times := req.repeatCount
		if times <= 0 {
			times = 1
		}
		for i := 0; i < times; i++ {
			for _, dmg := range damages {
				if err := s.applyPhantomCopyableDamage(collector, dmg, req.repeatTag); err != nil {
					return err
				}
			}
		}
	}
	s.checkDeathStopReason()

	if !s.stopReasonSet {
		for _, req := range delayed {
			if req.repeatScope != model.RepeatScopeCopyableOnHit {
				continue
			}
			if !s.repeatTriggerMet(req) {
				continue
			}
			if err := s.enqueueTriggeredContinuation(damages, req); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *genericRunState) enqueueTriggeredContinuation(damages []copyableDamageFrozen, req deferredRepeatRequest) *model.EngineError {
	s.nextContinuationID++
	id := s.nextContinuationID
	frozen := append([]copyableDamageFrozen(nil), damages...)
	s.continuations[id] = &triggeredContinuationPayload{
		damages:      frozen,
		req:          req,
		commandCount: 0,
	}
	code := s.heap.Push(scheduler.GenericEvent{
		TimeMs:         s.nowMs + int64(req.repeatDelayMs),
		Category:       scheduler.GenericCategoryTriggeredContinuation,
		Kind:           scheduler.GenericEventTriggeredContinuation,
		ContinuationID: id,
	})
	if code != model.ErrOK {
		delete(s.continuations, id)
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "triggered continuation queue overflow", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	return nil
}

func (s *genericRunState) handleTriggeredContinuation(ev scheduler.GenericEvent) *model.EngineError {
	payload, ok := s.continuations[ev.ContinuationID]
	if !ok || payload == nil {
		return nil
	}
	delete(s.continuations, ev.ContinuationID)
	if s.stopReasonSet {
		return nil
	}
	req := payload.req
	if req.repeatScope != model.RepeatScopeCopyableOnHit {
		return nil
	}
	collector := &eventCopyableCollector{
		phantomDepth: 1,
		commandCount: payload.commandCount,
	}
	times := req.repeatCount
	if times <= 0 {
		times = 1
	}
	for i := 0; i < times; i++ {
		for _, dmg := range payload.damages {
			if err := s.applyPhantomCopyableDamage(collector, dmg, req.repeatTag); err != nil {
				return err
			}
		}
	}
	s.checkDeathStopReason()
	return nil
}

func (s *genericRunState) repeatTriggerMet(req deferredRepeatRequest) bool {
	if req.ownerCombatantKey == "" || req.ownerProviderRef == "" || req.triggerStateKey == "" {
		return false
	}
	c, ok := s.combatants[req.ownerCombatantKey]
	if !ok {
		return false
	}
	bag := c.providerState[req.ownerProviderRef]
	if bag == nil {
		return false
	}
	bag.bindFieldDefs(s.resolveProviderStateFieldDefs(req.ownerCombatantKey, req.ownerProviderRef, c.providers))
	bag.lazyExpireProviderState(s.nowMs)
	s.combatants[req.ownerCombatantKey] = c
	value, ok := bag.state[req.triggerStateKey]
	if !ok {
		return false
	}
	return value >= req.threshold
}

func (s *genericRunState) applyPhantomCopyableDamage(collector *eventCopyableCollector, dmg copyableDamageFrozen, repeatTag string) *model.EngineError {
	if collector == nil {
		return nil
	}
	collector.commandCount++
	if collector.commandCount > s.budget.MaxCommandsPerEvent {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "max commands per event exceeded", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	target, ok := s.combatants[dmg.targetKey]
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}

	attrs := cloneAttributeMap(target.attributes)
	// Live HP must follow Current; Resolved may have been reset to Base by attribute resolve.
	if hp, ok := attrs["hp"]; ok {
		hp.Resolved = hp.Current
		attrs["hp"] = hp
	}
	overlayEntryResistance(attrs, dmg.entryAttrsForCombatant(dmg.targetKey))
	view := pipeline.CombatantView{
		Attributes: attrs,
		Shields:    pipeline.ShieldsFromRuntime(target.shields, s.nowMs),
	}
	cmd := command.Command{
		Kind:       command.KindDamage,
		Source:     dmg.sourceKey,
		Target:     dmg.targetKey,
		Amount:     dmg.rawAmount,
		DamageType: dmg.damageType,
	}
	// Phantom uses frozen event-entry source attrs for penetration; target resistance already overlaid.
	sourcePenAttrs := dmg.entryAttrsForCombatant(dmg.sourceKey)
	targetHPBefore := attribute.ReadHP(view.Attributes)
	outcome, next := pipeline.ResolveDamageWithSource(cmd, view, sourcePenAttrs, s.nowMs)
	result := command.Result{Kind: cmd.Kind, Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0, Amount: outcome.MitigatedAmount}
	s.nextDamageID++
	damageID := s.nextDamageID
	target.attributes = next.Attributes
	target.shields = pipeline.RuntimeShieldsFromView(next.Shields, dmg.targetKey, dmg.sourceKey)
	s.combatants[dmg.targetKey] = target
	s.reResolveLiveAttributesTwoPass(dmg.sourceKey, dmg.targetKey)
	s.recordDamage(dmg.sourceKey, dmg.targetKey, result.Amount, s.nowMs)
	s.recordGenericDamageEvidence(genericDamageEvidence{
		source:          dmg.sourceKey,
		target:          dmg.targetKey,
		damageType:      dmg.damageType,
		rawAmount:       dmg.rawAmount,
		mitigatedAmount: result.Amount,
		providerRef:     dmg.providerRef,
		abilityRef:      dmg.originRef,
		operationRef:    dmg.operationRef,
		phantom:         true,
		repeatTag:       repeatTag,
		replayedFrom:    stableDamageReplayedFrom(dmg.providerRef, dmg.originRef, dmg.operationRef),
		crit:            dmg.crit,
		traits:          dmg.operation.Types,
		castInstanceID:  dmg.castInstanceID,
		castOrigin:      dmg.castOrigin,
		damageID:        damageID,
		outcome:         &outcome,
	})
	frame := s.newExecutionFrame(dmg.sourceKey, dmg.targetKey, dmg.originRef)
	frame.ownerProviderRef = dmg.providerRef
	frame.castInstanceID, frame.castOrigin = dmg.castInstanceID, dmg.castOrigin
	if err := frame.settleDamageVamp(cmd, dmg.operation, dmg.ability, outcome, targetHPBefore, damageID, true); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if frame.healingDone > 0 {
		acc := s.statFor(dmg.originRef)
		if acc.healingDone == nil {
			v := frame.healingDone
			acc.healingDone = &v
		} else {
			*acc.healingDone += frame.healingDone
		}
	}
	return nil
}

func (d copyableDamageFrozen) entryAttrsForCombatant(combatantKey string) map[string]model.AttributeSlotDef {
	// entry_* 对应原始 emitted event 的 source/target；damage target 可能经 owner remap。
	// 优先按 damage target 与 frame event keys 对齐；若无匹配则回退 entryTarget（常见 on-hit 受害方）。
	if combatantKey == d.eventTargetKey {
		return d.entryTargetAttrs
	}
	if combatantKey == d.eventSourceKey {
		return d.entrySourceAttrs
	}
	if len(d.entryTargetAttrs) > 0 {
		return d.entryTargetAttrs
	}
	return d.entrySourceAttrs
}

func overlayEntryResistance(dst, entry map[string]model.AttributeSlotDef) {
	if dst == nil || len(entry) == 0 {
		return
	}
	for _, key := range []string{"armor", "magic_resist"} {
		if slot, ok := entry[key]; ok {
			dst[key] = slot
		}
	}
}

func (s *genericRunState) recordDamage(sourceKey, targetKey string, amount float64, timeMs int64) {
	if amount <= 0 {
		return
	}
	s.damageHistory = append(s.damageHistory, damageRecord{
		timeMs:    timeMs,
		sourceKey: sourceKey,
		targetKey: targetKey,
		amount:    amount,
	})
	if sourceKey == model.SelectorSource {
		s.sourceDamageDealt += amount
	}
	if sourceKey == model.SelectorTarget {
		s.targetDamageDealt += amount
	}
	if targetKey == model.SelectorSource {
		s.sourceDamageTaken += amount
	}
	if targetKey == model.SelectorTarget {
		s.targetDamageTaken += amount
	}
}

func (s *genericRunState) checkDeathStopReason() {
	if s.stopReasonSet {
		return
	}
	sourceDead := s.combatantHasHp(model.SelectorSource) && s.combatantHp(model.SelectorSource) <= 0
	targetDead := s.combatantHasHp(model.SelectorTarget) && s.combatantHp(model.SelectorTarget) <= 0
	if sourceDead && targetDead {
		s.setStopReason(model.StopReasonBothDead)
	} else if sourceDead {
		s.setStopReason(model.StopReasonSourceDead)
	} else if targetDead && s.req.StopPolicy.StopOnTargetDeathOrDefault() {
		s.setStopReason(model.StopReasonTargetDead)
	}
}
