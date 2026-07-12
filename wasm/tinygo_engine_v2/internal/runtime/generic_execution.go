package runtime

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/command"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/resource"
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
}

type stagedCombatant struct {
	attributes    map[string]model.AttributeSlotDef
	resources     map[string]model.ResourceSlotDef
	cooldowns     map[string]int64
	shields       []pipeline.ShieldInstance
	providers     []status.ProviderInstance
	resolver      pipeline.AttributeResolver
	providerOps   []stagedProviderMutation
	providerState map[string]*providerStateBag
	dirty         bool
}

// eventFormulaSnapshot 保存父 frame entry 快照与 emit 当点 staged 深拷贝。
// event 参与者始终是原始 emittedEvent source/target，不随 listener owner-relative 重映射。
type eventFormulaSnapshot struct {
	entrySourceAttrs      map[string]model.AttributeSlotDef
	entryTargetAttrs      map[string]model.AttributeSlotDef
	entrySourceResources  map[string]model.ResourceSlotDef
	entryTargetResources  map[string]model.ResourceSlotDef
	sourceAttrs           map[string]model.AttributeSlotDef
	targetAttrs           map[string]model.AttributeSlotDef
	sourceResources       map[string]model.ResourceSlotDef
	targetResources       map[string]model.ResourceSlotDef
}

type executionFrame struct {
	run               *genericRunState
	frameID           uint64
	sourceKey         string
	targetKey         string
	abilityRef        string
	ownerCombatantKey string // mounted provider owner; distinct from event/op sourceKey
	ownerProviderRef  string

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
}

type emittedEvent struct {
	eventType string
	ref       string
	sourceKey string
	targetKey string
	types     []string
	snapshot  eventFormulaSnapshot
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

func (f *executionFrame) captureEmitSnapshot(eventSourceKey, eventTargetKey string) eventFormulaSnapshot {
	src := f.stageFor(eventSourceKey)
	tgt := f.stageFor(eventTargetKey)
	entrySrcAttrs, entrySrcRes := f.entryMapsForKey(eventSourceKey)
	entryTgtAttrs, entryTgtRes := f.entryMapsForKey(eventTargetKey)
	return eventFormulaSnapshot{
		entrySourceAttrs:     cloneAttributeMap(entrySrcAttrs),
		entryTargetAttrs:     cloneAttributeMap(entryTgtAttrs),
		entrySourceResources: cloneResourceMap(entrySrcRes),
		entryTargetResources: cloneResourceMap(entryTgtRes),
		sourceAttrs:          cloneAttributeMap(src.attributes),
		targetAttrs:          cloneAttributeMap(tgt.attributes),
		sourceResources:      cloneResourceMap(src.resources),
		targetResources:      cloneResourceMap(tgt.resources),
	}
}

func cloneEventSnapshot(src *eventFormulaSnapshot) *eventFormulaSnapshot {
	if src == nil {
		return nil
	}
	cp := eventFormulaSnapshot{
		entrySourceAttrs:     cloneAttributeMap(src.entrySourceAttrs),
		entryTargetAttrs:     cloneAttributeMap(src.entryTargetAttrs),
		entrySourceResources: cloneResourceMap(src.entrySourceResources),
		entryTargetResources: cloneResourceMap(src.entryTargetResources),
		sourceAttrs:          cloneAttributeMap(src.sourceAttrs),
		targetAttrs:          cloneAttributeMap(src.targetAttrs),
		sourceResources:      cloneResourceMap(src.sourceResources),
		targetResources:      cloneResourceMap(src.targetResources),
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
		attributes:    cloneAttributeMap(base.attributes),
		resources:     cloneResourceMap(base.resources),
		cooldowns:     cloneCooldownMap(base.cooldowns),
		shields:       pipeline.ShieldsFromRuntime(base.shields, f.run.nowMs),
		providers:     append([]status.ProviderInstance(nil), base.providers...),
		resolver:      base.resolver.Clone(),
		providerState: cloneProviderStateMap(base.providerState),
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
	}
	if f.ownerProviderRef != "" {
		ctx.HasProviderContext = true
		bag := f.providerStateBag(f.providerOwnerKey(), f.ownerProviderRef, false)
		if bag != nil {
			ctx.ProviderState = bag.state
			if bag.targetKey == f.targetKey {
				ctx.ProviderTargetState = bag.targetValues
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
	if ok {
		return bag
	}
	if !create {
		return nil
	}
	bag = &providerStateBag{state: map[string]float64{}, targetValues: map[string]float64{}}
	sc.providerState[providerRef] = bag
	return bag
}

func (f *executionFrame) evalAmount(programID formula.GenericProgramID, ability compilebundle.CompiledAbility) (float64, *model.EngineError) {
	value, err := f.run.compiled.Formulas.Eval(programID, f.evalContext(ability))
	if err != nil {
		return 0, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
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

func (f *executionFrame) executeOperation(ability compilebundle.CompiledAbility, op compilebundle.CompiledOperation) *model.EngineError {
	f.commandCount++
	if f.commandCount > f.run.budget.MaxCommandsPerEvent {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "max commands per event exceeded", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
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
		cmd := command.Command{
			Kind:       command.Kind(op.Operation),
			Source:     f.sourceKey,
			Target:     targetKey,
			Amount:     amount,
			DamageType: op.DamageType,
			Ref:        op.AttributeKey,
		}
		return f.applyCommand(cmd)
	case "resource_change":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		return f.applyResourceChange(targetKey, op.ResourceKey, amount)
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
		sc := f.stageFor(targetKey)
		sc.providerOps = append(sc.providerOps, stagedProviderMutation{
			kind:          "apply",
			definitionRef: op.ProviderDefinitionRef,
			targetKey:     targetKey,
			sourceKey:     f.sourceKey,
		})
		sc.dirty = true
		return nil
	case "refresh_provider":
		if op.ProviderRef == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "refresh_provider requires providerRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		sc := f.stageFor(targetKey)
		sc.providerOps = append(sc.providerOps, stagedProviderMutation{
			kind:        "refresh",
			providerRef: op.ProviderRef,
			targetKey:   targetKey,
			sourceKey:   f.sourceKey,
		})
		sc.dirty = true
		return nil
	case "expire_provider":
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
		ref := op.Ref
		if ref == "" {
			ref = eventType
		}
		if ref == "" {
			ref = "event:auto"
		}
		f.run.recordEvidence(model.EvidenceItem{
			TimeMs: f.run.nowMs,
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    ref,
			Data: map[string]interface{}{
				"source":    f.sourceKey,
				"target":    targetKey,
				"eventType": eventType,
			},
		})
		types := []string{}
		if eventType != "" {
			types = append(types, eventType)
		}
		f.pendingEvents = append(f.pendingEvents, emittedEvent{
			eventType: eventType,
			ref:       ref,
			sourceKey: f.sourceKey,
			targetKey: targetKey,
			types:     types,
			snapshot:  f.captureEmitSnapshot(f.sourceKey, targetKey),
		})
		return nil
	case "state_change":
		return f.applyStateChange(op, ability)
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unknown operation: "+op.Operation, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
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
		next, ok := applyStatePolicy(bag.state[op.Ref], amount, op.ValuePolicy)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unsupported state_change valuePolicy", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if !finiteState(next) {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite state result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		bag.state[op.Ref] = next
	case stateScopeProviderTarget:
		if bag.targetKey != "" && bag.targetKey != f.targetKey {
			// Pair-state switch: clear previous target values so stacks restart on return.
			bag.targetValues = map[string]float64{}
		}
		bag.targetKey = f.targetKey
		current := bag.targetValues[op.Ref]
		next, ok := applyStatePolicy(current, amount, op.ValuePolicy)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unsupported state_change valuePolicy", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if !finiteState(next) {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite state result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		bag.targetValues[op.Ref] = next
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "unsupported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	f.stageFor(ownerKey).dirty = true
	return nil
}

func (f *executionFrame) applyCommand(cmd command.Command) *model.EngineError {
	sc := f.stageFor(cmd.Target)
	view := pipeline.CombatantView{Attributes: sc.attributes, Shields: sc.shields}
	result, next := pipeline.ResolveCommand(cmd, view, f.run.nowMs)
	sc.attributes = next.Attributes
	sc.shields = next.Shields

	switch cmd.Kind {
	case command.KindDamage:
		// damageDealt / recordDamage use mitigated amount（抗性后、护盾前），HP clipping 不反向改变 summary。
		f.damageDealt += result.Amount
		f.run.recordDamage(cmd.Source, cmd.Target, result.Amount, f.run.nowMs)
		sc.attributes = syncHPResolved(sc.attributes)
	case command.KindHeal:
		f.healingDone += result.Amount
		overheal := cmd.Amount - result.Amount
		if overheal < 0 {
			overheal = 0
		}
		if overheal > 0 {
			f.run.recordOverheal(cmd.Source, overheal)
		}
		sc.attributes = syncHPResolved(sc.attributes)
	}
	return nil
}

func (f *executionFrame) applyResourceChange(targetKey, resourceKey string, amount float64) *model.EngineError {
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
	evalCtx := f.evalContext(ability)
	sc.attributes = sc.resolver.ResolveAttributes(sc.attributes, evalCtx, f.run.compiled.Formulas)
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
		if err := f.applyResourceChange(sourceKey, ability.Cost.ResourceKey, -amount); err != nil {
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
		c.providerState = cloneProviderStateMap(staged.providerState)
		f.run.combatants[key] = c
	}
	evalAbility := compilebundle.CompiledAbility{Params: map[string]float64{}}
	evalCtx := f.evalContext(evalAbility)
	for _, staged := range f.staged {
		for _, mut := range staged.providerOps {
			switch mut.kind {
			case "apply":
				if err := f.run.applyProviderInstance(mut.targetKey, mut.sourceKey, mut.definitionRef, evalCtx); err != nil {
					f.fatal = true
					f.fatalErr = err
					return
				}
			case "refresh":
				if err := f.run.refreshProviderInstance(mut.targetKey, mut.providerRef, evalCtx); err != nil {
					f.fatal = true
					f.fatalErr = err
					return
				}
			case "expire":
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
	return s.castAbilityAt(sourceKey, targetKey, entry.AbilityRef, 0, nil)
}

// castAbilityAt 在独立 execution frame 中施放 ability（driver cast 与 listener child ability 共用）。
// eventCtx 非 nil 时继承原始 emit 快照（listener abilityRef child cast）。
func (s *genericRunState) castAbilityAt(sourceKey, targetKey, abilityRef string, chainDepth int, eventCtx *eventFormulaSnapshot) *model.EngineError {
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

	frame := s.newExecutionFrame(sourceKey, targetKey, resolvedRef)
	frame.chainDepth = chainDepth
	frame.eventCtx = cloneEventSnapshot(eventCtx)
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
	if err := frame.executeOperations(ability, ops); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
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

func (f *executionFrame) dispatchPendingEvents() *model.EngineError {
	if len(f.pendingEvents) == 0 {
		return nil
	}
	events := append([]emittedEvent(nil), f.pendingEvents...)
	f.pendingEvents = nil
	for _, ev := range events {
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
	baseEventTypes := s.eventTypeSet(ev.types)
	for _, listener := range s.compiled.Listeners {
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
		sourceKey, targetKey := s.listenerFrameCombatants(ev, listener)
		eventCtx := cloneEventSnapshot(&ev.snapshot)
		for trigger := 0; trigger < maxTriggers; trigger++ {
			if hasOps {
				if err := s.dispatchListenerOperations(listener, sourceKey, targetKey, chainDepth, eventCtx); err != nil {
					return err
				}
			}
			if hasAbilityRef {
				if err := s.castAbilityAt(sourceKey, targetKey, listener.AbilityRef, chainDepth, eventCtx); err != nil {
					return err
				}
			}
		}
	}
	return nil
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

func (s *genericRunState) dispatchListenerOperations(listener compilebundle.CompiledListener, sourceKey, targetKey string, chainDepth int, eventCtx *eventFormulaSnapshot) *model.EngineError {
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
