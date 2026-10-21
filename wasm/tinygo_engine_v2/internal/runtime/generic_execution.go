package runtime

import (
	"math"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/crit"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/resource"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
	"tinygo_engine_v2/internal/typeset"
)

type stagedProviderMutation struct {
	projected       bool
	useRef          string
	definitionIndex uint16 // shield_apply is already bound by the compiler
	evidenceKind    model.EvidenceKind
	kind            string
	providerRef     string
	definitionRef   string
	targetKey       string
	sourceKey       string
	shieldAmount    float64
	shieldRef       string
	shieldPriority  int16
	expireAt        int64
	hasExpireAt     bool
	strict          bool
	contributions   []status.StatusContribution
}

type pendingShieldExpire struct {
	combatantKey string
	shieldRef    string
	expireAt     int64
}

type stagedCombatant struct {
	projectedProviders        bool
	baseProviders             []status.ProviderInstance
	resourceContributions     []resourceMaxContribution
	resourceBatchContributors []model.ResourceChangeContributor
	// 属性视图可供入口、事件和live读取；真正写入前才取得独占副本。
	resourcesShared     bool
	cooldownsShared     bool
	attributes          attribute.Table
	resources           map[string]model.ResourceSlotDef
	cooldowns           *genericCooldownLedger
	shields             []pipeline.ShieldInstance
	providers           []status.ProviderInstance
	resolver            pipeline.AttributeResolver
	damageResolver      pipeline.DamageModifierResolver
	providerOps         []stagedProviderMutation
	providerState       map[string]*providerStateBag
	providerStateShared bool
	dirty               bool
}

// eventFormulaSnapshot 保存父 frame entry 快照与 emit 当点 staged 深拷贝。
// event 参与者始终是原始 emittedEvent source/target，不随 listener owner-relative 重映射。
type eventFormulaSnapshot struct {
	shieldAbsorptions    *pipeline.ShieldAbsorptionSnapshot
	hasUse               bool
	useKey               string
	useSource            string
	useSkillKey          string
	hasUseContactCount   bool
	useContactCount      int
	hasLink              bool
	linkIndex            int
	linkCount            int
	eventType            string
	eventSourceKey       string
	eventTargetKey       string
	entrySourceAttrs     attribute.Table
	entryTargetAttrs     attribute.Table
	entrySourceResources map[string]model.ResourceSlotDef
	entryTargetResources map[string]model.ResourceSlotDef
	sourceAttrs          attribute.Table
	targetAttrs          attribute.Table
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
	projectedLifecycles            []projectedProviderLifecycle
	flushingDynamicProviders       bool
	dynamicProviderDirty           bool
	dynamicExpiryChecked           bool
	pendingResourceChanges         []model.ResourceChangeRecord
	empowered                      *empoweredFrame
	empoweredAttack                *model.ProcessEmpoweredAttack
	pendingAutomaticWake           bool
	pendingBasicAttackCooldownWake bool
	pendingCooldownAttempts        []pendingCooldownAttempt
	pendingAmmoWaits               []pendingAmmoRecovery
	pendingAmmoCapture             *ammoUseCapture
	pendingMechanicRecords         []model.MechanicRecord
	pendingBasicAttackWait         *basicAttackWait
	pendingActionWait              bool
	processUseKey                  string
	processUseSkillKey             string
	processUseSource               string
	damageDefenseContext           *formula.GenericEvalContext
	processActualCosts             map[string]float64
	processCostReadable            bool
	processMomentKind              string
	run                            *genericRunState
	frameID                        uint64
	sourceKey                      string
	targetKey                      string
	abilityRef                     string
	ownerCombatantKey              string // mounted provider owner; distinct from event/op sourceKey
	ownerProviderRef               string
	mountedListener                bool
	strictReads                    bool

	// castInstanceID / castOrigin：同一次施放的身份与来源；多 op / delayed / listener ops 继承。
	castInstanceID uint64
	castOrigin     string

	staged *frameStagedCollection

	// entry_*：本 frame 创建时、cost/CD/operations 前的不可变深拷贝（供本 frame 后续 emit 使用）。
	entrySourceAttrs     attribute.Table
	entryTargetAttrs     attribute.Table
	entrySourceResources map[string]model.ResourceSlotDef
	entryTargetResources map[string]model.ResourceSlotDef

	// eventCtx：listener / child ability 继承的原始 event 快照；nil 表示无 event context。
	eventCtx *eventFormulaSnapshot

	damageDealt  float64
	healingDone  float64
	commandCount int
	chainDepth   int
	// rootSkillHitDamage 仅由本次根 resolve_skill_hit 的候选继承，不能由监听或旧命中上下文推导。
	rootSkillHitDamage bool
	fatal              bool
	fatalErr           *model.EngineError

	pendingEvents []emittedEvent

	// copyableCollector：单次 emitted event / dispatchListeners 局部上下文；禁止挂到 genericRunState。
	copyableCollector *eventCopyableCollector

	// damageAggregation 收集本根帧或合格根命中候选的正数伤害，类型身份来自实际作者操作。
	damageAggregation frameDamageAggregation

	// consumedFirstPerCast tracks first_per_cast pipeline modifiers already applied in this cast/frame.
	// Key: ownerCombatantKey + "\x00" + providerRef + "\x00" + modifierKey.
	consumedFirstPerCast map[string]bool

	driverEntryKey        string
	skipBlockedWrites     bool
	skillHitCandidateKey  string
	skillHitOccurrenceID  uint64
	operationOutputs      map[string]formula.OperationOutputValues
	pendingShieldExpires  []pendingShieldExpire
	committed             bool
	pendingEvidence       []model.EvidenceItem
	pendingEvidenceKinds  []model.EvidenceKind
	pendingSkillHits      []committedSkillActionHit
	pendingDamage         []genericDamageEvidence
	pendingDirectHealing  []model.DirectHealingRecord
	pendingDamageHistory  []damageRecord
	pendingOverheal       map[string]float64
	pendingDamageIDs      uint64
	pendingCopyable       []copyableDamageFrozen
	pendingRepeats        []deferredRepeatRequest
	pendingStateExpiry    []pendingFrameStateExpiry
	pendingAnchoredTicks  []pendingFrameAnchoredTick
	pendingProviderTick   *pendingFrameProviderTick
	providerDefinitionRef string
	providerActivatedAtMs *int64
	damageOwnerKey        string
	pendingProcess        *processRuntime
	processOriginal       *processRuntime
	processIsNew          bool
	pendingProcessTimer   bool
	countCastOnCommit     bool
	castStatRef           string
	statRef               string
}

// copyableDamageFrozen 冻结一次 CopyableOnHit damage 的 replay 输入（不做公式重算 / 不二次 crit 结算）。
type copyableDamageFrozen struct {
	rawAmount            float64
	damageType           string
	sourceKey            string
	targetKey            string
	providerRef          string
	originRef            string // abilityRef 或 listener:<key>
	operationRef         string // op.Ref；有则写入 evidence / replayedFrom
	entrySourceAttrs     attribute.Table
	entryTargetAttrs     attribute.Table
	entrySourceResources map[string]model.ResourceSlotDef
	entryTargetResources map[string]model.ResourceSlotDef
	eventSourceKey       string
	eventTargetKey       string
	crit                 frozenCritEvidence
	ability              planbundle.CompiledAbility
	operation            planbundle.CompiledOperation
	castInstanceID       uint64
	castOrigin           string
	consumedFirstPerCast map[string]bool
	ownerCombatantKey    string
	eventCtx             *eventFormulaSnapshot
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
	reservation  *pendingUseReservation
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
	hasUse         bool
	useKey         string
	useSource      string
	useSkillKey    string
}

func (s *genericRunState) initExecutionFrame(f *executionFrame, sourceKey, targetKey, abilityRef string) {
	s.nextFrameID++
	*f = executionFrame{
		run:        s,
		frameID:    s.nextFrameID,
		sourceKey:  sourceKey,
		targetKey:  targetKey,
		abilityRef: abilityRef,
		staged:     &frameStagedCollection{},
	}
	f.captureEntrySnapshots()
}

func (f *executionFrame) captureEntrySnapshots() {
	f.entrySourceAttrs, f.entrySourceResources = f.snapshotCombatantMaps(f.sourceKey)
	f.entryTargetAttrs, f.entryTargetResources = f.snapshotCombatantMaps(f.targetKey)
}

func (f *executionFrame) snapshotCombatantMaps(key string) (attribute.Table, map[string]model.ResourceSlotDef) {
	c, ok := f.run.combatants[key]
	if !ok {
		return attribute.Table{}, map[string]model.ResourceSlotDef{}
	}
	return c.attributes, c.resources
}

// entryMapsForKey 按 combatant key 选择本 frame 创建时对应参与者的 entry 快照。
// 未知 key 返回空 map，避免静默改用错误参与者。
func (f *executionFrame) entryMapsForKey(key string) (attribute.Table, map[string]model.ResourceSlotDef) {
	switch key {
	case f.sourceKey:
		return f.entrySourceAttrs, f.entrySourceResources
	case f.targetKey:
		return f.entryTargetAttrs, f.entryTargetResources
	default:
		return attribute.Table{}, map[string]model.ResourceSlotDef{}
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
		entrySourceAttrs:     entrySrcAttrs,
		entryTargetAttrs:     entryTgtAttrs,
		entrySourceResources: entrySrcRes,
		entryTargetResources: entryTgtRes,
		sourceAttrs:          src.attributes,
		targetAttrs:          tgt.attributes,
		sourceResources:      src.readonlyResources(),
		targetResources:      tgt.readonlyResources(),
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
		shieldAbsorptions:    src.shieldAbsorptions,
		hasUse:               src.hasUse,
		useKey:               src.useKey,
		useSource:            src.useSource,
		useSkillKey:          src.useSkillKey,
		hasUseContactCount:   src.hasUseContactCount,
		useContactCount:      src.useContactCount,
		hasLink:              src.hasLink,
		linkIndex:            src.linkIndex,
		linkCount:            src.linkCount,
		eventType:            src.eventType,
		eventSourceKey:       src.eventSourceKey,
		eventTargetKey:       src.eventTargetKey,
		entrySourceAttrs:     src.entrySourceAttrs,
		entryTargetAttrs:     src.entryTargetAttrs,
		entrySourceResources: src.entrySourceResources,
		entryTargetResources: src.entryTargetResources,
		sourceAttrs:          src.sourceAttrs,
		targetAttrs:          src.targetAttrs,
		sourceResources:      src.sourceResources,
		targetResources:      src.targetResources,
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
	if sc, ok := f.staged.Lookup(key); ok {
		return sc
	}
	base, ok := f.run.combatants[key]
	if !ok {
		sc := &stagedCombatant{
			attributes:    attribute.Table{},
			resources:     map[string]model.ResourceSlotDef{},
			cooldowns:     newGenericCooldownLedger(),
			providerState: map[string]*providerStateBag{},
		}
		f.staged.Set(key, sc)
		return sc
	}
	// 帧只读取已挂载列表；真正的挂载、刷新和移除由运行态写口取得独占列表。
	base.providersShared = true
	stateView := freezeProviderStateView(base.providerState)
	base.providerStateShared = true
	f.run.combatants[key] = base
	sc := &stagedCombatant{
		resourceContributions: base.resourceContributions,
		attributes:            base.attributes,
		resources:             base.resources,
		resourcesShared:       true,
		cooldowns:             base.cooldowns,
		cooldownsShared:       true,
		shields:               pipeline.ShieldsFromRuntime(base.shields, f.run.nowMs),
		providers:             base.providers,
		resolver:              base.resolver.Clone(),
		damageResolver:        base.damageResolver.Clone(),
		providerState:         stateView,
		providerStateShared:   true,
	}
	f.staged.Set(key, sc)
	return sc
}

func (s *stagedCombatant) writableResources() map[string]model.ResourceSlotDef {
	if s.resourcesShared {
		s.resources = cloneResourceMap(s.resources)
		s.resourcesShared = false
	}
	return s.resources
}

func (s *stagedCombatant) readonlyResources() map[string]model.ResourceSlotDef {
	s.resourcesShared = true
	return s.resources
}

func (s *stagedCombatant) writableCooldowns() *genericCooldownLedger {
	if s.cooldownsShared {
		s.cooldowns = s.cooldowns.clone()
		s.cooldownsShared = false
	} else if s.cooldowns == nil {
		s.cooldowns = newGenericCooldownLedger()
	}
	return s.cooldowns
}

func (s *stagedCombatant) readonlyCooldowns() *genericCooldownLedger {
	s.cooldownsShared = true
	return s.cooldowns
}

func (f *executionFrame) evalContext(ability planbundle.CompiledAbility) formula.GenericEvalContext {
	if f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange || f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasModifierSnapshots {
		f.flushDynamicProviders()
	}
	source, target := f.stageFor(f.sourceKey), f.stageFor(f.targetKey)
	ctx := formula.GenericEvalContext{
		RuntimeSkillKey:       ability.SkillKey,
		ProcessActualCosts:    f.processActualCosts,
		HasProcessActualCosts: f.processCostReadable,
		SourceAttrs:           source.attributes,
		TargetAttrs:           target.attributes,
		SourceResources:       source.resources,
		TargetResources:       target.resources,
		AbilityParams:         ability.Params,
		StrictReads:           f.strictReads || f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.hasSkillHit),
	}
	if f.run.compiled.HasLinkedShieldReads {
		ctx.LinkedShieldReader = f
	}
	if ctx.RuntimeSkillKey == "" {
		ctx.RuntimeSkillKey = f.processUseSkillKey
	}
	if p := f.pendingProcess; p != nil && p.hasEmpoweredAbility && f.processMomentKind == "STEP_EXECUTION" && f.processUseKey == p.UseKey && f.ownerProviderRef == p.ProviderRef && f.providerOwnerKey() == p.Owner && ctx.RuntimeSkillKey == p.SkillKey {
		ctx.ProcessStartStateValues = p.startStateValues
	}
	if ctx.RuntimeSkillKey == "" && f.ownerProviderRef != "" {
		if owner, ok := f.run.combatants[f.providerOwnerKey()]; ok {
			for _, instance := range owner.providers {
				if instance.ProviderRef == f.ownerProviderRef && int(instance.DefinitionIndex) < len(f.run.compiled.Providers) {
					ctx.RuntimeSkillKey = f.run.compiled.Providers[instance.DefinitionIndex].SkillKey
					break
				}
			}
		}
	}
	if process := f.pendingProcess; process != nil && f.processMomentKind == "STEP_EXECUTION" && process.stepIndex >= 0 && process.definition.Steps[process.stepIndex].StepType == "CHARGE" {
		ctx.HasUseChargeDuration, ctx.UseChargeDurationMs = true, f.run.nowMs-process.StepStartedAtMs
	} else if action := f.run.skillActionByUse[f.skillActionUseRef()]; action != nil && action.chargeDurationMs != nil {
		ctx.HasUseChargeDuration, ctx.UseChargeDurationMs = true, *action.chargeDurationMs
	}
	if f.ownerProviderRef != "" {
		ctx.HasProviderContext = true
		bag := f.providerStateBagForRead(f.providerOwnerKey(), f.ownerProviderRef, ctx.StrictReads,
			providerStateReadOptions{defaults: true, targetView: true, targetKey: f.targetKey})
		if bag != nil {
			ctx.ProviderStateDefaults = bag.defaultsForFormula()
			ctx.ProviderState = bag.state
			if bag.targetKey == f.targetKey {
				ctx.ProviderTargetState = bag.targetStateForFormula()
			} else {
				ctx.ProviderTargetState = nil
			}
		} else {
			ctx.ProviderState = nil
			ctx.ProviderTargetState = nil
		}
	}
	if f.eventCtx != nil {
		ctx.HasEventContext = true
		ctx.HasSkillUseContactCount = f.eventCtx.eventType == model.EventTypeProcessResolved && f.eventCtx.hasUseContactCount
		ctx.SkillUseContactCount = f.eventCtx.useContactCount
		ctx.HasEventLink = f.eventCtx.hasLink
		ctx.LinkIndex = f.eventCtx.linkIndex
		ctx.LinkCount = f.eventCtx.linkCount
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
		if f.eventCtx.hasSkillHit && f.eventCtx.skillHit != nil && f.eventCtx.eventType == model.EventTypeSkillHit {
			ctx.HasEventSkillHit = true
			ctx.HasSkillHitBlocked = true
			ctx.SkillHitBlocked = f.eventCtx.skillHit.blocked
			if f.eventCtx.skillHit.hasFirstContact {
				ctx.HasSkillHitFirstContact = true
				ctx.SkillHitFirstContact = f.eventCtx.skillHit.firstContact
			}
		}
	}
	if f.operationOutputs != nil {
		ctx.HasOperationOutputs = true
		ctx.OperationOutputs = f.operationOutputs
	}
	f.populateMechanicEvalContext(&ctx, ability)
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
	bag := writableProviderStateBag(sc.writableProviderStates(), providerRef, create)
	if bag == nil {
		return nil
	}
	bag.bindFieldDefs(f.resolveProviderStateFieldDefs(combatantKey, providerRef))
	bag.lazyExpireProviderState(f.run.nowMs)
	return bag
}

// 公式只读已准备的包；默认值或到期准备会改变包时，才取得独占头。
func (f *executionFrame) providerStateBagForRead(combatantKey, providerRef string, create bool, options providerStateReadOptions) *providerStateBag {
	if providerRef == "" {
		return nil
	}
	sc := f.stageFor(combatantKey)
	options.cooldowns = sc.readonlyCooldowns()
	options.ownerKey = combatantKey
	if sc.providerState == nil {
		sc.providerState = map[string]*providerStateBag{}
	}
	return readSharedProviderStateBag(&sc.providerState, &sc.providerStateShared, providerRef, create,
		f.resolveProviderStateFieldDefs(combatantKey, providerRef), f.run.nowMs, options)
}

func (f *executionFrame) resolveProviderStateFieldDefs(combatantKey, providerRef string) *providerStateFieldMetadata {
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
	strict := f.strictReads || f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.hasSkillHit)
	return f.providerFormulaContextForTarget(combatantKey, f.targetKey, strict)
}

func (f *executionFrame) providerFormulaContextForTarget(combatantKey, targetKey string, strict bool) pipeline.ProviderFormulaContextFunc {
	return func(ownerCombatantKey, providerRef string) pipeline.ProviderFormulaContext {
		bagOwner := ownerCombatantKey
		if bagOwner == "" {
			bagOwner = combatantKey
		}
		activeTarget := providerTargetActiveKey(combatantKey, ownerCombatantKey, targetKey)
		bag := f.providerStateBagForRead(bagOwner, providerRef, strict,
			providerStateReadOptions{expireTarget: true, defaults: true, targetView: activeTarget != "", targetKey: activeTarget})
		ctx := providerFormulaContextFromBag(bag, activeTarget)
		if f.run.compiled.HasProviderElapsedReads || f.run.compiled.HasFiniteModifierExpiry {
			ctx = withProviderElapsed(ctx, f.stageFor(bagOwner).providers, providerRef, f.run.nowMs, f.run.compiled.Providers)
		}
		return ctx
	}
}

func (f *executionFrame) resolveAttributesFor(combatantKey string, attrs attribute.Table, evalCtx formula.GenericEvalContext) attribute.Table {
	sc := f.stageFor(combatantKey)
	resolved, err := f.run.resolveOrdinaryAttributes(combatantKey,
		attrs,
		sc.resolver,
		evalCtx,
		f.providerFormulaContextFunc(combatantKey),
	)
	if err != nil {
		f.fatal = true
		f.fatalErr = f.preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+combatantKey+".attributes", "", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
		return attrs
	}
	if len(f.run.compiled.AttributeDerivations) == 0 {
		return resolved
	}
	sourceAttrs, targetAttrs := f.run.combatants["source"].attributes, f.run.combatants["target"].attributes
	if staged := f.staged.Get("source"); staged != nil {
		sourceAttrs = staged.attributes
	}
	if staged := f.staged.Get("target"); staged != nil {
		targetAttrs = staged.attributes
	}
	ordinary := map[string]attribute.Table{"source": sourceAttrs, "target": targetAttrs}
	for _, owner := range []string{"source", "target"} {
		host := f.stageFor(owner)
		dependencyContext := evalCtx
		dependencyContext.SourceAttrs, dependencyContext.TargetAttrs = sourceAttrs, targetAttrs
		ordinary[owner], err = f.run.resolveOrdinaryAttributes(owner, ordinary[owner], host.resolver, dependencyContext, f.providerFormulaContextFunc(owner))
		if err != nil {
			f.fatal = true
			f.fatalErr = f.preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+owner+".attributes", "", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
			return attrs
		}
	}
	ordinary[combatantKey] = resolved
	resolved, err = f.run.resolveDerivedAttributesCached(combatantKey, resolved, sc.resolver, ordinary["source"], ordinary["target"], f.providerFormulaContextFunc(combatantKey))
	if err != nil {
		f.fatal = true
		f.fatalErr = f.preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+combatantKey+".attributes", "", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
		return attrs
	}
	return resolved
}

func (f *executionFrame) evalAmount(programID formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	ctx := f.evalContext(ability)
	value, err := f.run.formulas.EvalContext(programID, &ctx)
	if err != nil {
		msg := err.Error()
		out := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, msg, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		if f.skillHitOccurrenceID != 0 && int(programID) < len(f.run.formulas.Programs) {
			out.Path = f.run.formulas.Programs[programID].Key
			out.Ref = f.abilityRef
		}
		if strings.HasPrefix(msg, "event.skill_hit.") {
			out.Path = msg
			out.Ref = f.abilityRef
		}
		return 0, f.preserveFormulaIssue(err, out)
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite formula result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return value, nil
}

func (f *executionFrame) executeOperations(ability planbundle.CompiledAbility, ops []planbundle.CompiledOperation) *model.EngineError {
	if f.chainDepth > f.run.budget.MaxChainDepth {
		f.fatal = true
		f.fatalErr = f.run.budgetError(model.BudgetCauseMaxChainDepth, "max chain depth exceeded")
		return f.fatalErr
	}
	for index := range ops {
		op := &ops[index]
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
	if f.run.basicAttackEventActive || f.run.initializationEventActive || f.run.hasSkillPlan() {
		return f.run.consumeEventCommands(1)
	}
	if f.copyableCollector != nil {
		f.copyableCollector.commandCount++
		if f.copyableCollector.commandCount > f.run.budget.MaxCommandsPerEvent {
			return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
		}
		return nil
	}
	f.commandCount++
	if f.commandCount > f.run.budget.MaxCommandsPerEvent {
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	return nil
}

func (f *executionFrame) executeOperation(ability planbundle.CompiledAbility, op *planbundle.CompiledOperation) *model.EngineError {
	if err := f.bumpCommandBudget(); err != nil {
		return err
	}
	if op.ColdResourceMax {
		return f.skipInstalledPermanentResourceMax(*op)
	}
	if (f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange || f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasModifierSnapshots) && op.Operation != "apply_provider" && op.Operation != "refresh_provider" && op.Operation != "expire_provider" {
		f.flushDynamicProviders()
		if f.fatal {
			return f.fatalErr
		}
	}

	if f.skipBlockedWrites && isSkillHitBlockedWrite(op.Operation) {
		f.recordEvidenceLazy(model.EvidenceKindSkillHitSkip, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: f.run.nowMs,
				Kind:   model.EvidenceKindSkillHitSkip,
				Ref:    f.skillHitCandidateKey,
				Path:   f.abilityRef,
				Data: map[string]interface{}{
					"occurrenceId": float64(f.skillHitOccurrenceID),
					"candidateKey": f.skillHitCandidateKey,
					"operation":    op.Operation,
				},
			}
		})
		return nil
	}

	// repeat：允许空 target；仅登记 deferred request，不解析 combatant target。
	if op.Operation == model.OperationKindRepeat {
		return f.registerDeferredRepeat(*op)
	}

	targetKey, ok := f.run.resolveOperationTarget(op.Target, f.sourceKey, f.targetKey)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}

	switch op.Operation {
	case model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		return f.applyLink(ability, *op, targetKey)
	case "damage", "heal", "shield":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, op.Operation+" requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		if op.Operation == "shield" {
			amount, err = f.applyReceivedShieldModifiers(targetKey, amount, ability)
			if err != nil {
				return err
			}
			if op.HasShieldLifecycleProvider {
				return f.stageLifecycleShield(*op, ability, targetKey, amount)
			}
			sc := f.stageFor(targetKey)
			ref := op.ShieldRef
			if ref == "" {
				ref = "shield:auto"
			}
			expireAt := int64(0)
			if op.HasShieldDuration {
				var err *model.EngineError
				expireAt, err = f.evalShieldDuration(*op, ability)
				if err != nil {
					return err
				}
				ref = f.run.nextShieldRef(ref)
			}
			f.run.reserveShieldRef(ref)
			sc.shields = append(sc.shields, pipeline.ShieldInstance{
				ShieldRef: ref,
				Source:    f.sourceKey,
				Owner:     targetKey,
				Remaining: amount,
				Priority:  0,
				ExpireAt:  expireAt,
				State:     map[string]interface{}{},
			})
			if expireAt > 0 {
				f.pendingShieldExpires = append(f.pendingShieldExpires, pendingShieldExpire{
					combatantKey: targetKey,
					shieldRef:    ref,
					expireAt:     expireAt,
				})
			}
			sc.dirty = true
			return nil
		}
		if op.Operation == "damage" {
			// Ordering: expected crit (branch pipeline) → outgoing_pre_mitigation →
			// resistance → incoming_crit_part_post_mitigation → incoming_post_mitigation →
			// shields/HP. CopyableOnHit freezes the post-crit / pre-outgoing amount.
			critEv, amount, critMods, err := f.settleExpectedCrit(*op, ability, amount, targetKey)
			if err != nil {
				return err
			}
			if err := f.maybeCollectCopyableDamage(*op, ability, amount, targetKey, critEv); err != nil {
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
			return f.applyDamageCommand(cmd, *op, critEv, ability, critMods)
		}
		operationRef := op.Ref
		if operationRef == "" {
			operationRef = op.Path
		}
		cmd := command.Command{
			Kind:       command.Kind(op.Operation),
			Source:     f.sourceKey,
			Target:     targetKey,
			Amount:     amount,
			DamageType: op.DamageType,
			Ref:        operationRef,
		}
		return f.applyCommand(cmd, *op, ability)
	case "resource_change":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		return f.applyResourceOperation(targetKey, amount, *op, ability)
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
		ownerKey, ok := ownerPrefix, f.run.combatantExists(ownerPrefix)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		existing := f.run.nowMs
		sc := f.stageFor(ownerKey)
		if readyAt := sc.cooldowns.abilityReadyAt(ownerKey, cooldownKey); readyAt > 0 {
			existing = readyAt
		}
		readyAt := f.run.nowMs
		switch op.ValuePolicy {
		case "set_remaining":
			if !op.HasAmount {
				return f.run.processErr("operation.cooldown_change.amount", "set_remaining requires amount", cooldownKey)
			}
			duration, err := f.evalAmount(op.AmountProgram, ability)
			if err != nil {
				return err
			}
			var valid bool
			readyAt, valid = processTimeAfter(f.run.nowMs, duration, true)
			if !valid {
				return f.run.processErr("operation.cooldown_change.amount", "set_remaining requires finite non-negative integer milliseconds and safe timestamp addition", cooldownKey)
			}
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
			useRef:        f.skillActionUseRef(),
			definitionRef: op.ProviderDefinitionRef,
			targetKey:     targetKey,
			sourceKey:     f.sourceKey,
			expireAt:      prepared.expireAt,
			hasExpireAt:   prepared.hasExpireAt,
			contributions: cloneStatusContributions(prepared.contributions),
		})
		f.dynamicProviderDirty = true
		sc.dirty = true
		return nil
	case "provider_duration_change":
		return f.applyProviderEnsureRemaining(*op)
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
			useRef:        f.skillActionUseRef(),
			providerRef:   op.ProviderRef,
			targetKey:     targetKey,
			sourceKey:     f.sourceKey,
			expireAt:      prepared.expireAt,
			hasExpireAt:   prepared.hasExpireAt,
			contributions: cloneStatusContributions(prepared.contributions),
		})
		f.dynamicProviderDirty = true
		sc.dirty = true
		return nil
	case "expire_provider":
		if op.ProviderRefFromEvent {
			return f.expireProviderFromEvent(*op)
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
		f.dynamicProviderDirty = true
		sc.dirty = true
		return nil
	case "emit_event":
		eventType := op.EventType
		if eventType == "" {
			eventType = op.Ref
		}
		if model.IsEngineProducedEvent(eventType) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "emit_event cannot forge engine-produced skill hit events", "eventType", eventType, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		ref := op.Ref
		if ref == "" {
			ref = eventType
		}
		if ref == "" {
			ref = "event:auto"
		}
		f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
			emitData := map[string]interface{}{
				"source": f.sourceKey, "target": targetKey, "eventType": eventType,
			}
			attachCastProvenance(emitData, f.castInstanceID, f.castOrigin)
			return model.EvidenceItem{
				TimeMs: f.run.nowMs,
				Kind:   model.EvidenceKindEmittedEvent,
				Ref:    ref,
				Data:   emitData,
			}
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
		return f.applyStateChange(*op, ability)
	case model.OperationKindStateDurationChange:
		return f.applyStateDurationChange(*op, ability)
	case model.OperationKindExecuteThreshold:
		return f.applyExecuteThreshold(*op, targetKey, ability)
	case model.OperationKindResolveSkillHit:
		return f.resolveSkillHit(*op, ability)
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unknown operation: "+op.Operation, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
}

func isSkillHitBlockedWrite(op string) bool {
	switch op {
	case "damage", "apply_provider", "refresh_provider", "provider_duration_change", "attribute_change", "resource_change", "cooldown_change", "heal", "shield", model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		return true
	default:
		return false
	}
}

func (f *executionFrame) applyStateChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
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
	if field, exists := bag.fieldDefs[op.Ref]; exists && field.stateKind == model.ProviderStateKindCooldown {
		return f.applyInternalCooldownStateChange(op, ability, amount)
	}
	switch scope {
	case stateScopeProvider:
		bag.lazyExpireProviderState(f.run.nowMs)
		before := bag.state[op.Ref]
		next, message := bag.nextStateValue(op.Ref, bag.state[op.Ref], amount, op.ValuePolicy)
		if message != "" {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		bag.writableState()[op.Ref] = next
		ammoField := op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(f.run.compiled.Providers) && f.run.compiled.Providers[op.OwnerProviderIndex].StateFields[op.Ref].StateKind == model.ProviderStateKindAmmo
		if ammoField {
			if err := f.stageAmmoConsumption(op, ability, before, next); err != nil {
				return err
			}
		}
		if !bag.refreshExpireAtOnWrite(op.Ref, f.run.nowMs) {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "provider state duration overflow", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		generation := uint64(0)
		if bag.fieldDefs[op.Ref].hasOnExpire {
			generation = bag.rearmSourceExpiry(op.Ref, bag.expireAt[op.Ref])
		}
		if expires := bag.expireAt[op.Ref]; expires > 0 && (f.run.automatedRun() || generation > 0) {
			f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: expires, payload: expireCleanupPayload{
				kind: "provider_source_state", combatantKey: ownerKey, providerRef: f.ownerProviderRef, stateKey: op.Ref, expectedExpireAt: expires, stateGeneration: generation,
			}})
		}
		// Provider-scope write must immediately re-resolve owner attributes with provider-aware context.
		sc := f.stageFor(ownerKey)
		sc.attributes = f.resolveAttributesFor(ownerKey, sc.attributes, f.evalContext(ability))
		f.reResolveStagedAttributesTwoPass(ability)
		if ammoField {
			if f.fatal {
				return f.fatalErr
			}
			ammo := f.run.findAmmo(ownerKey, f.ownerProviderRef, op.Ref)
			if ammo != nil && (next == 0 || ammo.definition.StateFields[op.Ref].AmmoRecovery.OneByOne) {
				if err := f.stageAmmoRecoveryFor(ammo, ability, -1); err != nil {
					return err
				}
			}
		}
	case stateScopeProviderTarget:
		// Order: lazy-expire -> activate -> seed this key's default -> policy -> cap -> refresh.
		bag.lazyExpireProviderTargetState(f.run.nowMs)
		f.activateProviderTarget(bag, ownerKey, f.ownerProviderRef, f.targetKey)
		bag.seedTargetValueIfAbsent(op.Ref)
		current := bag.readTargetValue(op.Ref)
		next, message := bag.nextStateValue(op.Ref, current, amount, op.ValuePolicy)
		if message != "" {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		bag.writableTargetValues()[op.Ref] = next
		exp, ok := bag.refreshTargetExpireAtOnWrite(op.Ref, f.run.nowMs)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "provider target state duration overflow", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if exp > 0 {
			f.stageProviderTargetStateExpiry(ownerKey, f.ownerProviderRef, f.targetKey, op.Ref, exp)
			if err := f.stageAnchoredTicksOnTargetWrite(ownerKey, f.ownerProviderRef, f.sourceKey, f.targetKey, op.Ref, exp, bag); err != nil {
				return err
			}
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

func (f *executionFrame) applyStateDurationChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
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
	if op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(f.run.compiled.Providers) && f.run.compiled.Providers[op.OwnerProviderIndex].StateFields[op.Ref].StateKind == model.ProviderStateKindAmmo {
		return f.applyAmmoDurationChange(op, ability)
	}
	if field, exists := bag.fieldDefs[op.Ref]; exists && field.stateKind == model.ProviderStateKindCooldown {
		return f.applyInternalCooldownDurationChange(op, ability)
	}
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
			bag.writableState()[op.Ref] = defaultValue
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
			bag.writableTargetValues()[op.Ref] = defaultValue
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
			f.stageProviderTargetStateExpiry(ownerKey, f.ownerProviderRef, bag.targetKey, op.Ref, newExp)
		}
	}
	f.stageFor(ownerKey).dirty = true
	return nil
}

// applyExecuteThreshold 仅在真实 event/basic_attack_hit 的 emit snapshot 上判定；
// 命中后经 command/pipeline 置零 live HP，不写 damage summary/evidence，不 emit。
func (f *executionFrame) applyExecuteThreshold(op planbundle.CompiledOperation, targetKey string, ability planbundle.CompiledAbility) *model.EngineError {
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

	f.recordGenericExecuteEvidence(genericExecuteEvidence{
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
	s.recordEvidenceLazy(model.EvidenceKindExecute, func() model.EvidenceItem { return genericExecuteEvidenceItem(ev, s.nowMs) })
}

func genericExecuteEvidenceItem(ev genericExecuteEvidence, timeMs int64) model.EvidenceItem {
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
	return model.EvidenceItem{
		TimeMs: timeMs,
		Kind:   model.EvidenceKindExecute,
		Ref:    ref,
		Data:   data,
	}
}

func (f *executionFrame) recordOperationOutput(op planbundle.CompiledOperation, outcome pipeline.DamageOutcome) {
	if op.OutputRef == "" {
		return
	}
	if f.operationOutputs == nil {
		f.operationOutputs = map[string]formula.OperationOutputValues{}
	}
	f.operationOutputs[op.OutputRef] = formula.OperationOutputValues{
		PostDefenseDamage: outcome.MitigatedAmount,
		ShieldAbsorbed:    outcome.ShieldAbsorbed,
		ActualHPLoss:      outcome.HPDamage,
	}
}

func (f *executionFrame) applyCommand(cmd command.Command, op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	if cmd.Kind == command.KindDamage {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "damage command bypassed authored defense settlement", op.Path+".damageType", cmd.DamageType, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if cmd.Kind == command.KindHeal {
		return f.applyDirectHeal(cmd, op, ability)
	}
	sc := f.stageFor(cmd.Target)
	view := pipeline.CombatantView{Attributes: sc.attributes, Shields: sc.shields}
	result, next := pipeline.ResolveCommand(cmd, view, f.run.nowMs)
	sc.attributes = next.Attributes
	sc.shields = next.Shields

	switch cmd.Kind {
	case command.KindHeal:
		f.healingDone += result.Amount
		overheal := cmd.Amount - result.Amount
		if overheal < 0 {
			overheal = 0
		}
		if overheal > 0 {
			f.recordOverheal(cmd.Source, overheal)
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
func (f *executionFrame) applyDamageCommand(cmd command.Command, op planbundle.CompiledOperation, critEv frozenCritEvidence, ability planbundle.CompiledAbility, modEvidence []map[string]interface{}) *model.EngineError {
	operationRef := op.Ref
	sourceHealthBefore, sourceHasHealth := f.stageFor(cmd.Source).attributes.Lookup("hp")
	traits := append([]string(nil), op.Types...)
	baseRawAmount := cmd.Amount
	if critEv.present {
		baseRawAmount = critEv.baseRawAmount
	}
	sc := f.stageFor(cmd.Target)
	view := pipeline.CombatantView{Attributes: sc.attributes, Shields: sc.shields}

	numbers, err := f.resolveDamageNumbers(cmd, op, critEv, ability, modEvidence)
	if err != nil {
		return err
	}
	cmd.Amount, critEv, modEvidence = numbers.rawAmount, numbers.crit, numbers.modifiers
	rawForEvidence := numbers.rawAmount
	if numbers.failClosed {
		result := command.Result{Kind: cmd.Kind, Applied: false, Amount: 0}
		f.applyDamageResult(cmd, result, sc)
		f.recordGenericDamageEvidence(genericDamageEvidence{
			source: cmd.Source, target: cmd.Target, damageType: cmd.DamageType,
			rawAmount: rawForEvidence, mitigatedAmount: 0,
			providerRef: f.ownerProviderRef, abilityRef: f.abilityRef,
			operationRef: operationRef, operationPath: op.Path, phantom: false, crit: critEv,
			modifiers: modEvidence, traits: traits,
		})
		return nil
	}
	mitigated := numbers.mitigatedAmount
	targetHPBefore := attribute.ReadHP(view.Attributes)
	outcome, next := pipeline.ApplyMitigatedDamage(rawForEvidence, mitigated, view, f.run.nowMs, f.run.compiled.HasReceivedShieldReads)
	if f.run.compiled.HasReceivedShieldReads {
		if err := f.bindReceivedShieldAbsorptions(outcome.ShieldAbsorptions, cmd.Target, outcome.ShieldAbsorbed); err != nil {
			return err
		}
	}
	killed := float64(0)
	if targetHPBefore > 0 && attribute.ReadHP(next.Attributes) <= 0 {
		killed = 1
	}
	f.recordOperationOutput(op, outcome)
	damageID := f.nextDamageID()
	result := command.Result{
		Kind:    cmd.Kind,
		Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0,
		Amount:  outcome.MitigatedAmount,
	}
	sc.attributes = next.Attributes
	sc.shields = next.Shields
	f.applyDamageResult(cmd, result, sc)
	if err := f.settleDepletedShieldAttributes(); err != nil {
		return err
	}
	f.reResolveStagedAttributesTwoPass(ability)
	damageRecordIndex := len(f.pendingDamage)
	f.recordGenericDamageEvidence(genericDamageEvidence{
		source:                    cmd.Source,
		target:                    cmd.Target,
		damageType:                cmd.DamageType,
		rawAmount:                 rawForEvidence,
		mitigatedAmount:           result.Amount,
		providerRef:               f.ownerProviderRef,
		abilityRef:                f.abilityRef,
		operationRef:              operationRef,
		operationPath:             op.Path,
		hpBefore:                  targetHPBefore,
		hpAfter:                   attribute.ReadHP(next.Attributes),
		hasSourceHp:               sourceHasHealth,
		sourceHpBefore:            sourceHealthBefore.Current,
		phantom:                   false,
		crit:                      critEv,
		modifiers:                 modEvidence,
		traits:                    traits,
		castInstanceID:            f.castInstanceID,
		castOrigin:                f.castOrigin,
		hasPostResistanceEvidence: true,
		resistanceFactor:          numbers.resistanceFactor,
		normalPartPostResistance:  numbers.normalPartPostResistance,
		critPartPostResistance:    numbers.critPartPostResistance,
		damageID:                  damageID,
		outcome:                   &outcome,
	})
	if err := f.settleDamageVamp(cmd, op, ability, outcome, targetHPBefore, damageID, false); err != nil {
		return err
	}
	f.pendingDamage[damageRecordIndex].sourceHpAfter = f.stageFor(cmd.Source).attributes.At("hp").Current
	f.queueDamageTaken(cmd, op, ability, critEv, baseRawAmount, rawForEvidence, outcome, killed, damageID)
	if err := f.recordDamageContribution(cmd, result, operationRef, op.Path); err != nil {
		return err
	}
	f.maybeQueueDamageInstanceEvent(cmd, op, ability, critEv, baseRawAmount, rawForEvidence, result.Amount, killed)
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

func (f *executionFrame) matchesBasicDamageChannel(ability planbundle.CompiledAbility) bool {
	basicAttackID, ok := f.run.compiled.RuntimeTypes.BasicAttack.Lookup()
	if !ok {
		return false
	}
	return ability.TypeSet.Contains(basicAttackID)
}

func (f *executionFrame) matchingDamagePipelineChannels(ability planbundle.CompiledAbility) []string {
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
	hostKey, sourceKey, targetKey, command, stage string,
	amount float64,
	ability planbundle.CompiledAbility,
	damageType string,
	traits []string,
	evidence []map[string]interface{},
) (float64, []map[string]interface{}, *model.EngineError) {
	host := f.stageFor(hostKey)
	if !host.damageResolver.HasCommandStage(command, stage) {
		return amount, evidence, nil
	}
	channels := f.matchingDamagePipelineChannels(ability)
	mods := host.damageResolver.CollectForCommandChannelsWithMatches(command, channels, stage)
	if len(mods) == 0 {
		return amount, evidence, nil
	}
	baseCtx := f.evalContext(ability)
	baseCtx.StrictReads = true
	// 伤害命令可以重定向目标；条件和金额必须读取同一笔实际参与者。
	baseCtx.SourceAttrs = f.stageFor(sourceKey).attributes
	baseCtx.TargetAttrs = f.stageFor(targetKey).attributes
	baseCtx.SourceResources = f.stageFor(sourceKey).resources
	baseCtx.TargetResources = f.stageFor(targetKey).resources
	baseCtx.HasDamageParticipants = true
	baseCtx.DamageSelf = sourceKey == targetKey
	providerCtxFn := f.providerFormulaContextForTarget(hostKey, targetKey, true)
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
			modCtx.ProviderStateDefaults = pctx.ProviderStateDefaults
		}
		if mod.HasCondition {
			cond, err := f.run.formulas.EvalContext(mod.ConditionProg, &modCtx)
			if err != nil {
				return 0, evidence, f.preserveFormulaIssue(err, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
			}
			if cond == 0 {
				continue
			}
		}
		if !mod.HasValue {
			continue
		}
		value, err := f.run.formulas.EvalContext(mod.ValueProgram, &modCtx)
		if err != nil {
			return 0, evidence, f.preserveFormulaIssue(err, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
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
		if f.run.detailedOutput() {
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
	}
	return amount, evidence, nil
}

func (f *executionFrame) applyDamageResult(cmd command.Command, result command.Result, sc *stagedCombatant) {
	// damageDealt / recordDamage use mitigated amount（抗性后、护盾前），HP clipping 不反向改变 summary。
	f.damageDealt += result.Amount
	f.recordDamage(cmd.Source, cmd.Target, result.Amount)
	sc.attributes = syncHPResolved(sc.attributes)
}

// genericDamageEvidence 是 damage evidence Data 的构造输入（不新增顶层 DTO）。
type genericDamageEvidence struct {
	healthOrder           uint64
	empoweredAttack       *model.ProcessEmpoweredAttack
	activationUseRef      string
	providerDefinitionRef string
	providerActivatedAtMs *int64
	source                string
	target                string
	damageType            string
	rawAmount             float64
	mitigatedAmount       float64
	providerRef           string
	abilityRef            string
	operationRef          string
	operationPath         string
	owner                 string
	hpBefore              float64
	hpAfter               float64
	hasSourceHp           bool
	sourceHpBefore        float64
	sourceHpAfter         float64
	phantom               bool
	repeatTag             string
	replayedFrom          map[string]interface{}
	crit                  frozenCritEvidence
	modifiers             []map[string]interface{}
	traits                []string
	castInstanceID        uint64
	castOrigin            string
	damageID              uint64
	outcome               *pipeline.DamageOutcome
	// 成功的普通与复制结算都记录真实共同倍率和防御后两部分。
	// 金额无效的结算不伪造这些数值。
	hasPostResistanceEvidence bool
	resistanceFactor          float64
	normalPartPostResistance  float64
	critPartPostResistance    float64
}

func (s *genericRunState) recordGenericDamageEvidence(ev genericDamageEvidence) {
	s.recordEvidenceLazy(model.EvidenceKindDamage, func() model.EvidenceItem { return genericDamageEvidenceItem(ev, s.nowMs) })
}

func genericDamageEvidenceItem(ev genericDamageEvidence, timeMs int64) model.EvidenceItem {
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
	if ev.empoweredAttack != nil {
		data["empoweredAttack"], data["useRef"] = ev.empoweredAttack, ev.activationUseRef
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
	}
	if len(ev.modifiers) > 0 {
		data["modifiers"] = ev.modifiers
	}
	ref := ev.abilityRef
	if ref == "" {
		ref = ev.operationRef
	}
	return model.EvidenceItem{
		TimeMs: timeMs,
		Kind:   model.EvidenceKindDamage,
		Ref:    ref,
		Data:   data,
	}
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
func (f *executionFrame) settleExpectedCrit(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, baseRawAmount float64, targetKey string) (frozenCritEvidence, float64, []map[string]interface{}, *model.EngineError) {
	if !op.CritEligible {
		return frozenCritEvidence{}, baseRawAmount, nil, nil
	}
	var chanceRaw, critDamageRaw float64
	var err *model.EngineError
	if op.HasCritFormula && int(op.CritChanceProgram) < len(f.run.formulas.Programs) && int(op.CritMultiplierProgram) < len(f.run.formulas.Programs) &&
		f.run.formulas.Programs[op.CritChanceProgram].Key == op.Path+".critChance" &&
		f.run.formulas.Programs[op.CritMultiplierProgram].Key == op.Path+".critMultiplier" &&
		(!op.HasCritMultiplierMin || (!math.IsNaN(op.CritMultiplierMin) && !math.IsInf(op.CritMultiplierMin, 0) && op.CritMultiplierMin >= 0)) {
		chanceRaw, err = f.evalResultFormula(op.CritChanceProgram, ability, targetKey)
		if err == nil {
			critDamageRaw, err = f.evalResultFormula(op.CritMultiplierProgram, ability, targetKey)
		}
	} else {
		return frozenCritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"eligible damage requires compiled critical formulas", op.Path+".critChance", op.Ref,
			f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	p, _ := crit.ClampValue("critical_probability", "source", chanceRaw, crit.ProbabilityBounds())
	traits := append([]string(nil), op.Types...)
	var modEvidence []map[string]interface{}

	q := p
	q, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, f.sourceKey, targetKey, "crit", "crit_chance_pre_settlement", q, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	q, _ = crit.ClampValue("critical_probability", "source", q, crit.ProbabilityBounds())

	mForced := critDamageRaw
	if op.HasCritMultiplierMin && mForced < op.CritMultiplierMin {
		mForced = op.CritMultiplierMin
	}
	mForced, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, f.sourceKey, targetKey, "crit", "crit_multiplier_forced_branch", mForced, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	if op.HasCritMultiplierMin && mForced < op.CritMultiplierMin {
		mForced = op.CritMultiplierMin
	}

	mNatural := critDamageRaw
	if op.HasCritMultiplierMin && mNatural < op.CritMultiplierMin {
		mNatural = op.CritMultiplierMin
	}
	mNatural, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, f.sourceKey, targetKey, "crit", "crit_multiplier_natural_branch", mNatural, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	if op.HasCritMultiplierMin && mNatural < op.CritMultiplierMin {
		mNatural = op.CritMultiplierMin
	}
	if math.IsNaN(mNatural) || math.IsInf(mNatural, 0) || mNatural < 0 || math.IsNaN(mForced) || math.IsInf(mForced, 0) || mForced < 0 {
		return frozenCritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"critical branch multipliers must remain finite and nonnegative", op.Path+".critMultiplier", op.Ref,
			f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
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
	if math.IsNaN(normalPart) || math.IsInf(normalPart, 0) || normalPart < 0 ||
		math.IsNaN(critPart) || math.IsInf(critPart, 0) || critPart < 0 ||
		math.IsNaN(critAdjusted) || math.IsInf(critAdjusted, 0) || critAdjusted < 0 {
		return frozenCritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"critical expected amounts must remain finite and nonnegative", op.Path+".critMultiplier", op.Ref,
			f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}

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

func (f *executionFrame) applyResourceChange(targetKey, resourceKey string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	if resourceKey == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires resourceKey", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	sc := f.stageFor(targetKey)
	if _, ok := sc.resources[resourceKey]; !ok && f.strictReads {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires an explicit resource slot", "combatants."+targetKey+".resources."+resourceKey, resourceKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if amount >= 0 {
		sc.resources = resource.Refund(sc.writableResources(), resourceKey, amount)
	} else {
		var ok bool
		sc.resources, ok = resource.Spend(sc.writableResources(), resourceKey, -amount)
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
	if ref, valid := planbundle.ParseAbilityRef(abilityRef); valid && f.run.combatantExists(ref.Combatant) {
		targetKey = ref.Combatant
	}
	sc := f.stageFor(targetKey)
	sc.writableCooldowns().set(genericAbilityCooldownIdentity(targetKey, abilityRef), readyAt, f.run.nowMs)
	return nil
}

func (f *executionFrame) applyAttributeChange(targetKey, attributeKey, valuePolicy string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	sc := f.stageFor(targetKey)
	slot, ok := sc.attributes.Lookup(attributeKey)
	if !ok {
		if f.strictReads {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "attribute_change requires an explicit attribute slot", "combatants."+targetKey+".attributes."+attributeKey, attributeKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		slot = model.AttributeSlotDef{}
	}
	base0 := slot.Base
	nextBase := applyAttributeBasePolicy(slot.Base, base0, valuePolicy, amount)
	if math.IsNaN(nextBase) || math.IsInf(nextBase, 0) {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"attribute change result must remain finite", "combatants."+targetKey+".attributes."+attributeKey+".base", attributeKey,
			f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	slot.Base = nextBase
	if slot.Max > 0 {
		if slot.Base < 0 {
			slot.Base = 0
		}
		if slot.Base > slot.Max {
			slot.Base = slot.Max
		}
	}
	sc.attributes = sc.attributes.With(attributeKey, slot)
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

func (f *executionFrame) stageLifecycleCostCooldown(ability planbundle.CompiledAbility, sourceKey string) *model.EngineError {
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
	if f.fatal || f.committed {
		return
	}
	if f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange || f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasModifierSnapshots {
		f.flushDynamicProviders()
		if f.fatal {
			return
		}
	}
	if f.run.compiled.HasShieldLifecycle {
		f.prepareShieldLifecycleRemovals()
		if f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasProviderDurationChange && !f.run.compiled.HasResourceMax && !f.run.compiled.HasCooldownDuration {
			// Depletion can append a removal after the first projection pass.
			f.flushDynamicProviders()
			if f.fatal {
				return
			}
		}
	}
	var keyBuffer [2]string
	keys, err := f.commitKeysAndPreflight(keyBuffer[:0])
	if err != nil {
		f.fatal, f.fatalErr = true, err
		return
	}
	for _, key := range keys {
		staged := f.staged.Get(key)
		c, ok := f.run.combatants[key]
		if !ok {
			c = combatantRuntime{key: key, cooldowns: newGenericCooldownLedger(), providerState: map[string]*providerStateBag{}}
		}
		c.attributes = staged.attributes
		c.resources = staged.resources
		staged.resourcesShared = true
		c.cooldowns = staged.cooldowns
		staged.cooldownsShared = true
		c.shields = pipeline.RuntimeShieldsFromView(staged.shields, key, f.sourceKey)
		c.providers = staged.providers
		c.resourceContributions = staged.resourceContributions
		c.providersShared = true
		c.resolver = staged.resolver.Clone()
		c.damageResolver = staged.damageResolver.Clone()
		c.providerState = staged.readonlyProviderStates()
		c.providerStateShared = true
		f.run.combatants[key] = c
	}
	evalAbility := planbundle.CompiledAbility{}
	evalCtx := f.evalContext(evalAbility)
	for _, key := range keys {
		staged := f.staged.Get(key)
		for _, mut := range staged.providerOps {
			if mut.projected {
				continue
			}
			switch mut.kind {
			case "shield_apply":
				f.run.mountFreshProviderInstance(mut.targetKey, mut.sourceKey, mut.definitionIndex, mut.providerRef, mut.expireAt, mut.contributions)
			case "apply":
				if err := f.run.applyProviderInstanceWithRef(mut.targetKey, mut.sourceKey, mut.definitionRef, mut.providerRef, mut.expireAt, mut.hasExpireAt, mut.contributions); err != nil {
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
				kind := mut.evidenceKind
				if kind == "" {
					kind = model.EvidenceKindProviderRemove
				}
				f.run.removeProviderInstance(mut.targetKey, mut.providerRef, evalCtx, kind)
			}
		}
	}
	f.commitProjectedProviderLifecycles()
	if f.run.compiled.HasResourceMax {
		for _, key := range keys {
			c := f.run.combatants[key]
			c.attributes = syncHPResolved(c.attributes)
			f.run.combatants[key] = c
		}
	}
	if f.fatal {
		return
	}
	if f.pendingProcess != nil {
		*f.processOriginal = *f.pendingProcess
		if f.processIsNew {
			f.run.processInstances = append(f.run.processInstances, f.processOriginal)
		}
		f.run.updateEmpoweredWait(f.processOriginal)
	}
	if f.empowered != nil {
		f.commitEmpoweredProcesses()
	}
	f.run.freezeActionDeaths()
	f.commitFrameQueues()
	if f.run.processFailure != nil {
		f.fatal, f.fatalErr = true, f.run.processFailure
		return
	}
	f.commitFrameFacts()
	if !f.run.settlingProcessDeaths && f.run.processFailure == nil {
		f.run.processFailure = f.run.failDeadProcesses()
		if f.run.processFailure != nil {
			f.fatal = true
			f.fatalErr = f.run.processFailure
		}
	}
}

func (f *executionFrame) evalShieldDuration(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) (int64, *model.EngineError) {
	wasStrict := f.strictReads
	f.strictReads = true
	ctx := f.evalContext(ability)
	f.strictReads = wasStrict
	path := "shieldDurationMs"
	if int(op.ShieldDurationProgram) < len(f.run.formulas.Programs) {
		path = f.run.formulas.Programs[op.ShieldDurationProgram].Key
	}
	value, err := f.run.formulas.EvalContext(op.ShieldDurationProgram, &ctx)
	if err != nil {
		return 0, f.preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), path, op.ShieldRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
	}
	if !formula.ValidPositiveInt64DurationMs(value) {
		return 0, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "shieldDurationMs must be a positive integer within the timestamp range", path, op.ShieldRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	delta := int64(value)
	expireAt, ok := addDuration(f.run.nowMs, delta)
	if !ok || expireAt <= f.run.nowMs {
		return 0, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "shieldDurationMs expiry overflows the timestamp range", path, op.ShieldRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return expireAt, nil
}

func (f *executionFrame) enqueueCommittedTimedShields() {
	for _, pending := range f.pendingShieldExpires {
		if pending.expireAt <= 0 || pending.shieldRef == "" {
			continue
		}
		c, ok := f.run.combatants[pending.combatantKey]
		if !ok {
			continue
		}
		for _, sh := range c.shields {
			if sh.ShieldRef != pending.shieldRef {
				continue
			}
			if sh.ExpireAt > 0 {
				f.run.enqueueExpireCleanup(pending.expireAt, expireCleanupPayload{
					combatantKey: pending.combatantKey,
					shieldRef:    pending.shieldRef,
					kind:         "shield",
				})
			}
			break
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
	sourceKey, ok := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "source unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	targetKey, ok := s.resolveDriverCombatantKey(entry.Target, sourceKey)
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
	if s.compiled.Providers[ability.ProviderIndex].HasStateOnExpire {
		return s.basicAttackErr("state expiry source abilities require their actual initialization or received-damage listener", "abilityRef")
	}
	if _, blocked := s.cooldownGate(sourceKey, resolvedRef); blocked {
		return nil
	}
	if ability.ProcessControl != nil {
		if ability.ProcessControl.UseRefFromEvent {
			return s.startProcessFromEvent(sourceKey, targetKey, resolvedRef, ability, chainDepth, eventCtx, driverEntryKey, collector)
		}
		return s.processErr("abilityRef", "process control can only execute through its single-shot driver fact", resolvedRef)
	}
	start := ability.OperationStart
	end := start + ability.OperationCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "operation range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]

	// Lazy-expire provider timed state and refresh resolved attrs before staging entry snapshots.
	s.refreshProviderAwareAttributes(sourceKey, targetKey)

	var frameStorage executionFrame
	s.initExecutionFrame(&frameStorage, sourceKey, targetKey, resolvedRef)
	frame := &frameStorage
	frame.chainDepth = chainDepth
	frame.eventCtx = cloneEventSnapshot(eventCtx)
	frame.copyableCollector = collector
	frame.driverEntryKey = driverEntryKey
	if int(ref.CombatantIndex) < len(s.compiled.Combatants) {
		frame.ownerCombatantKey = s.compiled.Combatants[ref.CombatantIndex].Key
	}
	if parsed, ok := planbundle.ParseAbilityRef(resolvedRef); ok {
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
	if s.hasSkillPlan() {
		if fact, exists := s.skillHitFacts[driverEntryKey]; exists && fact.UseRef != nil && s.skillActionByUse[*fact.UseRef] != nil {
			for _, process := range s.processInstances {
				if process.UseKey == *fact.UseRef {
					frame.castInstanceID = process.castID
					break
				}
			}
		}
	}
	frame.castOrigin = ability.CastOrigin
	frame.countCastOnCommit = !isNativeHitFollowUp(frame.driverEntryKey)
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
	if err := frame.maybeDispatchBasicAttackStart(ability); err != nil {
		return err
	}
	if err := frame.maybeDispatchBasicAttackHit(ability); err != nil {
		return err
	}

	s.checkDeathStopReason()
	return nil
}

const (
	abilityTypeBasicAttack          = "ability/basic_attack"
	eventTypeAbilityStarted         = "event/ability_started"
	eventTypeBasicAttackHit         = "event/basic_attack_hit"
	eventTypeDamageDealt            = "event/damage_dealt"
	eventTypeDamageDealtBasicAttack = "event/damage_dealt/basic_attack"
	eventTypeDamageInstance         = "event/damage_instance"
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
	data := map[string]interface{}{
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
	if snap.HasKilled {
		data["killed"] = snap.Killed
	}
	return data
}

func (f *executionFrame) abilityTypeKeys(ability planbundle.CompiledAbility) []string {
	if keys, exists := f.run.abilityTypeKeyCache[ability.TypeSet]; exists {
		return keys
	}
	keys := make([]string, 0)
	for i, key := range f.run.compiled.Types.Registry.Keys {
		if ability.TypeSet.Contains(typeset.TypeID(i)) {
			keys = append(keys, key)
		}
	}
	// 固定内存下只保留常见集合；额外集合继续按原目录求值。
	if len(f.run.abilityTypeKeyCache) >= 64 {
		return keys
	}
	if f.run.abilityTypeKeyCache == nil {
		f.run.abilityTypeKeyCache = make(map[typeset.TypeSet][]string)
	}
	f.run.abilityTypeKeyCache[ability.TypeSet] = keys
	return keys
}

// maybeQueueDamageInstanceEvent emits event/damage_instance once after a non-phantom damage
// operation completes settlement without structural failure (including zero amounts).
func (f *executionFrame) maybeQueueDamageInstanceEvent(
	cmd command.Command,
	op planbundle.CompiledOperation,
	ability planbundle.CompiledAbility,
	critEv frozenCritEvidence,
	baseRawAmount, preMitigationAmount, mitigatedAmount, killed float64,
) {
	if f.copyableCollector != nil && f.copyableCollector.phantomDepth > 0 {
		return
	}
	if _, ok := f.run.compiled.RuntimeTypes.DamageInstance.Lookup(); !ok {
		return
	}
	traits := append([]string(nil), op.Types...)
	snap := buildDamageInstanceSnapshot(critEv, baseRawAmount, preMitigationAmount, mitigatedAmount)
	snap.HasKilled, snap.Killed = true, killed
	eventTypes := []string{eventTypeDamageInstance}
	if cmd.DamageType != "" {
		if _, ok := f.run.compiled.Types.Registry.LookupDomain("damage", cmd.DamageType); ok {
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
	event := emittedEvent{
		eventType: eventTypeDamageInstance, ref: eventTypeDamageInstance,
		sourceKey: cmd.Source, targetKey: cmd.Target, types: eventTypes, snapshot: snapshot,
		castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
		useKey: f.processUseKey, useSource: f.processUseSource, useSkillKey: f.processUseSkillKey,
	}
	if event.useKey == "" && f.eventCtx != nil && f.eventCtx.hasUse {
		event.useKey, event.useSource, event.useSkillKey = f.eventCtx.useKey, f.eventCtx.useSource, f.eventCtx.useSkillKey
	}
	event.hasUse = event.useKey != ""
	attachUseToSnapshot(&event)

	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
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
		if event.hasUse {
			data["useRef"], data["skillKey"] = event.useKey, event.useSkillKey
		}
		if op.Ref != "" {
			data["operationRef"] = op.Ref
		}
		attachCastProvenance(data, f.castInstanceID, f.castOrigin)
		return model.EvidenceItem{
			TimeMs: f.run.nowMs,
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    eventTypeDamageInstance,
			Data:   data,
		}
	})
	f.pendingEvents = append(f.pendingEvents, event)
}

// maybeDispatchAbilityStartedEvent 在顶层成功 cast 后自动合成 event/ability_started（reserved 20205）。
// 条件：chainDepth==0，且 ability TypeSet 不含 ability/basic_attack（经 type catalog Lookup，禁止 abilityKey 启发式）。
// gate/cost/cooldown 失败不会进入本路径；listener child cast（chainDepth>0）不合成。
// TypeSet includes event/ability_started plus the source ability TypeSet keys.
func (f *executionFrame) maybeDispatchAbilityStartedEvent(ability planbundle.CompiledAbility) *model.EngineError {
	if f.chainDepth != 0 {
		return nil
	}
	if ability.HasSkillHit {
		if fact, ok := f.run.skillHitFacts[f.driverEntryKey]; ok && fact.UseRef != nil {
			for _, p := range f.run.processInstances {
				if p.UseKey == *fact.UseRef && p.Owner == f.sourceKey && p.SkillKey == ability.SkillKey {
					return nil
				}
			}
		}
	}
	basicAttackID, ok := f.run.compiled.RuntimeTypes.BasicAttack.Lookup()
	if ability.IsBasicAttack || (ok && ability.TypeSet.Contains(basicAttackID)) {
		return nil
	}
	if _, ok := f.run.compiled.RuntimeTypes.AbilityStarted.Lookup(); !ok {
		// Event type absent from catalog: cannot participate in type-set matching; do not invent it.
		return nil
	}
	eventTypes := []string{eventTypeAbilityStarted}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = f.appendCastOriginEventType(eventTypes)
	useRef := f.processUseKey
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		startedData := map[string]interface{}{
			"source":    f.sourceKey,
			"target":    f.targetKey,
			"eventType": eventTypeAbilityStarted,
		}
		if useRef != "" {
			startedData["useRef"], startedData["skillKey"], startedData["phaseKind"] = useRef, f.processUseSkillKey, "INITIAL"
			startedData["owner"], startedData["providerRef"] = f.ownerCombatantKey, f.ownerProviderRef
			if action := f.run.skillActionByUse[useRef]; action != nil {
				startedData["instructionKey"] = action.plan.InstructionKey
				startedData["providerDefinitionRef"] = action.binding.ProviderDefinitionRef
			}
		}
		attachCastProvenance(startedData, f.castInstanceID, f.castOrigin)
		return model.EvidenceItem{
			TimeMs: f.run.nowMs,
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    eventTypeAbilityStarted,
			Data:   startedData,
		}
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
	if useRef != "" {
		ev.hasUse, ev.useKey, ev.useSource, ev.useSkillKey = true, useRef, f.processUseSource, f.processUseSkillKey
		ev.snapshot.hasUse, ev.snapshot.useKey, ev.snapshot.useSource, ev.snapshot.useSkillKey = true, useRef, f.processUseSource, f.processUseSkillKey
	}
	return f.run.dispatchListeners(ev, f.chainDepth+1)
}

func (f *executionFrame) maybeDispatchBasicAttackHit(ability planbundle.CompiledAbility) *model.EngineError {
	if f.chainDepth != 0 || f.driverEntryKey == "" {
		return nil
	}
	if !ability.IsBasicAttack || ability.HasSkillHit || ability.OperationCount == 0 {
		return nil
	}
	if strings.TrimSpace(ability.SkillKey) == "" {
		return nil
	}
	if _, isStart := f.run.attackStartFacts[f.driverEntryKey]; isStart {
		return nil
	}
	if _, ok := f.run.compiled.RuntimeTypes.BasicAttackHit.Lookup(); !ok {
		return nil
	}
	eventTypes := []string{model.EventTypeBasicAttackHit}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = f.appendCastOriginEventType(eventTypes)
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		data := map[string]interface{}{
			"source":    f.sourceKey,
			"target":    f.targetKey,
			"eventType": model.EventTypeBasicAttackHit,
		}
		attachCastProvenance(data, f.castInstanceID, f.castOrigin)
		if fact, ok := f.run.skillHitFacts[f.driverEntryKey]; ok && fact.UseRef != nil && *fact.UseRef != "" {
			if use, found := f.run.skillUses[*fact.UseRef]; found {
				data["useRef"], data["skillKey"] = use.useKey, use.skillKey
			}
		}
		return model.EvidenceItem{
			TimeMs: f.run.nowMs,
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    model.EventTypeBasicAttackHit,
			Data:   data,
		}
	})
	ev := emittedEvent{
		eventType:      model.EventTypeBasicAttackHit,
		ref:            model.EventTypeBasicAttackHit,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          eventTypes,
		snapshot:       f.captureEmitSnapshot(model.EventTypeBasicAttackHit, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
	}
	if fact, ok := f.run.skillHitFacts[f.driverEntryKey]; ok && fact.UseRef != nil && *fact.UseRef != "" {
		if use, found := f.run.skillUses[*fact.UseRef]; found {
			ev.hasUse = true
			ev.useKey = use.useKey
			ev.useSource = use.source
			ev.useSkillKey = use.skillKey
		}
	}
	return f.run.dispatchListeners(ev, f.chainDepth+1)
}

func (f *executionFrame) maybeDispatchBasicAttackStart(ability planbundle.CompiledAbility) *model.EngineError {
	if f.chainDepth != 0 || f.driverEntryKey == "" {
		return nil
	}
	fact, ok := f.run.attackStartFacts[f.driverEntryKey]
	if !ok {
		return nil
	}
	if !ability.IsBasicAttack || ability.HasSkillHit || ability.OperationCount != 0 {
		return f.run.skillHitErr(model.GenericErrUnknownRef, "attack start driver must be an empty-operations basic_attack ability", "attackStartFacts", f.driverEntryKey)
	}
	if _, ok := f.run.compiled.RuntimeTypes.BasicAttackStart.Lookup(); !ok {
		return f.run.skillHitErr(model.GenericErrUnknownTypeKey, "attack start requires event/basic_attack_start in typeCatalog", "attackStartFacts", f.driverEntryKey)
	}
	use, found := f.run.skillUses[fact.UseRef]
	if !found {
		return f.run.skillHitErr(model.GenericErrUnknownRef, "attack start useRef is missing", "attackStartFacts.useRef", fact.UseRef)
	}
	if err := f.captureAttackStartState(use); err != nil {
		return err
	}
	eventTypes := []string{model.EventTypeBasicAttackStart}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = f.appendCastOriginEventType(eventTypes)
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		data := map[string]interface{}{
			"source":    f.sourceKey,
			"target":    f.targetKey,
			"eventType": model.EventTypeBasicAttackStart,
			"useRef":    fact.UseRef,
			"skillKey":  use.skillKey,
		}
		attachCastProvenance(data, f.castInstanceID, f.castOrigin)
		return model.EvidenceItem{
			TimeMs: f.run.nowMs,
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    model.EventTypeBasicAttackStart,
			Data:   data,
		}
	})
	ev := emittedEvent{
		eventType:      model.EventTypeBasicAttackStart,
		ref:            model.EventTypeBasicAttackStart,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          eventTypes,
		snapshot:       f.captureEmitSnapshot(model.EventTypeBasicAttackStart, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
		hasUse:         true,
		useKey:         use.useKey,
		useSource:      use.source,
		useSkillKey:    use.skillKey,
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
		if ev.skillHit != nil && (ev.eventType == model.EventTypeSkillHit || ev.eventType == model.EventTypeBasicAttackHit) {
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
	attachUseToSnapshot(&ev)
	if chainDepth > s.budget.MaxChainDepth {
		return s.budgetError(model.BudgetCauseMaxChainDepth, "max chain depth exceeded")
	}
	s.lazyExpireAllProviderState()
	collector := &eventCopyableCollector{}
	baseEventTypes := s.eventTypeSet(ev.types)
	// 编译监听器只读；动态监听器会在递归触发期间原地移除，仍需冻结副本。
	compiledListeners := s.compiled.Listeners
	runtimeListeners := append([]planbundle.CompiledListener(nil), s.runtimeListeners...)
	compiledCount := len(compiledListeners)
	listenerCount := compiledCount + len(runtimeListeners)
	listenerAt := func(index int) planbundle.CompiledListener {
		if index < compiledCount {
			return compiledListeners[index]
		}
		return runtimeListeners[index-compiledCount]
	}
	// 0表示没有冻结条件，1表示条件通过，2表示条件拒绝。
	var inlineConditions [16]uint8
	frozen := inlineConditions[:]
	if listenerCount > len(frozen) {
		frozen = make([]uint8, listenerCount)
	}
	for i := 0; i < listenerCount; i++ {
		listener := listenerAt(i)
		if !listener.HasCondition || !s.listenerMatchesEvent(listener, ev, baseEventTypes) {
			continue
		}
		ok, err := s.evalListenerCondition(listener, ev)
		if err != nil {
			return err
		}
		frozen[i] = 2
		if ok {
			frozen[i] = 1
		}
	}
	for listenerIndex := 0; listenerIndex < listenerCount; listenerIndex++ {
		listener := listenerAt(listenerIndex)
		if !s.listenerMatchesEvent(listener, ev, baseEventTypes) {
			continue
		}
		if frozen[listenerIndex] == 2 {
			s.recordEvidenceLazy(model.EvidenceKindListenerSkipped, func() model.EvidenceItem {
				return model.EvidenceItem{
					TimeMs: s.nowMs,
					Kind:   model.EvidenceKindListenerSkipped,
					Ref:    listener.ListenerKey,
					Data:   map[string]interface{}{"reason": "condition_false"},
				}
			})
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
		if listener.HasOncePerUse && listenerIndex >= compiledCount {
			return s.skillHitErr(model.GenericErrUnknownRef, "dynamic listeners do not support oncePerUse", "listeners["+listener.ListenerKey+"].oncePerUse", listener.OncePerUseGroup)
		}
		oncePerUse := listener.HasOncePerUse
		reserved := false
		if oncePerUse {
			didReserve, skip, err := s.reserveOncePerUse(listener, ev)
			if err != nil {
				return err
			}
			if skip {
				s.recordEvidenceLazy(model.EvidenceKindListenerSkipped, func() model.EvidenceItem {
					return model.EvidenceItem{
						TimeMs: s.nowMs,
						Kind:   model.EvidenceKindListenerSkipped,
						Ref:    listener.ListenerKey,
						Data: map[string]interface{}{
							"reason":   "once_per_use",
							"groupKey": listener.OncePerUseGroup,
						},
					}
				})
				continue
			}
			reserved = didReserve
		}
		sourceKey, targetKey := s.listenerFrameCombatants(ev, listener)
		// 子帧入口会各自冻结快照；这里仅补齐标量，不先重复复制一份相同快照。
		eventCtx := ev.snapshot
		if eventCtx.castInstanceID == 0 {
			eventCtx.castInstanceID = castID
		}
		if eventCtx.castOrigin == "" {
			eventCtx.castOrigin = ev.castOrigin
		}
		triggered := false
		if reserved {
			collector.reservation = &pendingUseReservation{listener: listener, event: ev}
		}
		for trigger := 0; trigger < maxTriggers; trigger++ {
			if hasOps {
				if err := s.dispatchListenerOperations(listener, sourceKey, targetKey, chainDepth, &eventCtx, collector); err != nil {
					s.releaseUncommittedUseReservation(collector.reservation)
					return err
				}
				triggered = true
			}
			if hasAbilityRef {
				resolvedChildRef := normalizeAbilityRef(listener.AbilityRef, sourceKey, targetKey)
				if _, blocked := s.cooldownGate(sourceKey, resolvedChildRef); blocked {
					continue
				}
				beforeCasts := s.abilityCastCount
				if err := s.castAbilityAt(sourceKey, targetKey, listener.AbilityRef, chainDepth, &eventCtx, collector, ""); err != nil {
					s.releaseUncommittedUseReservation(collector.reservation)
					return err
				}
				triggered = triggered || s.abilityCastCount > beforeCasts
			}
		}
		if reserved && triggered {
			s.commitOncePerUse(listener, ev)
		} else if reserved {
			s.releaseUncommittedUseReservation(collector.reservation)
		}
		collector.reservation = nil
		if triggered && listener.PerCastThrottleMs > 0 {
			s.notePerCastThrottleTrigger(listenerIndex, listener.OwnerCombatantKey, listener.OwnerProviderRef, castID)
		}
	}
	return s.flushDeferredPhantomReplay(collector)
}

const (
	eventSourceOwner    = "event/source_owner"
	eventSourceOpponent = "event/source_opponent"
	eventTargetOwner    = "event/target_owner"
)

func (s *genericRunState) listenerMatchesEvent(listener planbundle.CompiledListener, ev emittedEvent, baseEventTypes typeset.TypeSet) bool {
	if !s.listenerStillLive(listener) {
		return false
	}
	if ev.eventType == model.EventTypeSpellShieldBlocked && ev.skillHit != nil && listener.OwnerProviderRef != "" &&
		(listener.OwnerCombatantKey != ev.skillHit.shieldOwner || listener.OwnerProviderRef != ev.skillHit.shieldProviderRef) {
		return false
	}
	eventTypes := baseEventTypes
	if listener.OwnerCombatantKey != "" {
		eventTypes = s.augmentOwnerRelativeEventTypes(baseEventTypes, ev.sourceKey, listener.OwnerCombatantKey)
		if ev.targetKey == listener.OwnerCombatantKey {
			if identity, declared := s.compiled.RuntimeTypes.TargetOwner.Lookup(); declared {
				eventTypes.Add(identity)
			}
		}
	}
	return listener.EventMatcher.Match(eventTypes)
}

// augmentOwnerRelativeEventTypes adds a catalog-backed owner-relative relation key for provider listeners.
func (s *genericRunState) augmentOwnerRelativeEventTypes(base typeset.TypeSet, eventSourceKey, ownerKey string) typeset.TypeSet {
	out := base
	relation := s.compiled.RuntimeTypes.SourceOpponent
	if eventSourceKey == ownerKey {
		relation = s.compiled.RuntimeTypes.SourceOwner
	}
	if id, ok := relation.Lookup(); ok {
		out.Add(id)
	}
	return out
}

func (s *genericRunState) listenerFrameCombatants(ev emittedEvent, listener planbundle.CompiledListener) (sourceKey, targetKey string) {
	sourceKey = ev.sourceKey
	targetKey = ev.targetKey
	if ev.eventType == model.EventTypeSourceInitialized {
		return sourceKey, targetKey
	}
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

func (s *genericRunState) dispatchListenerOperations(listener planbundle.CompiledListener, sourceKey, targetKey string, chainDepth int, eventCtx *eventFormulaSnapshot, collector *eventCopyableCollector) *model.EngineError {
	start := listener.OperationStart
	end := start + listener.OperationCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "listener operation range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]
	ability := planbundle.CompiledAbility{}
	if listener.SourceAbilityIndex >= 0 && listener.SourceAbilityIndex < len(s.compiled.Abilities) {
		ability = s.compiled.Abilities[listener.SourceAbilityIndex]
	}
	var frameStorage executionFrame
	s.initExecutionFrame(&frameStorage, sourceKey, targetKey, "listener:"+listener.ListenerKey)
	frame := &frameStorage
	if listener.SourceAbilityIndex >= 0 && listener.SourceAbilityIndex < len(s.compiled.Abilities) {
		frame.abilityRef = listener.OwnerCombatantKey + ".provider[" + listener.OwnerProviderRef + "].ability[" + ability.AbilityKey + "]"
	}
	frame.strictReads = s.automatedRun() || listener.HasCondition || listener.HasOncePerUse
	frame.chainDepth = chainDepth
	frame.ownerCombatantKey = listener.OwnerCombatantKey
	frame.ownerProviderRef = listener.OwnerProviderRef
	frame.mountedListener = listener.OwnerCombatantKey != "" && listener.OwnerProviderRef != ""
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
		if id, ok := s.compiled.Types.LookupForEntity(key, typeset.EntityListener); ok {
			set.Add(id)
		}
	}
	return set
}

func syncHPResolved(attrs attribute.Table) attribute.Table {
	slot, ok := attrs.Lookup("hp")
	if !ok {
		return attrs
	}
	if math.Float64bits(slot.Resolved) == math.Float64bits(slot.Current) {
		return attrs
	}
	slot.Resolved = slot.Current
	attrs = attrs.With("hp", slot)
	return attrs
}

// reResolveStagedAttributesTwoPass 在 live HP/resource/attribute 变更后，确定性两遍
// 重算 Resolved（每遍先 source 后 target）。只改 Resolved；保留 Current/Max；
// 每遍结束后强制 hp.Resolved=hp.Current。不改 Base（attribute_change 的 Base 策略除外）。
func (f *executionFrame) reResolveStagedAttributesTwoPass(ability planbundle.CompiledAbility) {
	memos, inputs, unchanged := f.refreshMemo(f.evalContext(ability))
	if unchanged {
		for _, key := range []string{f.sourceKey, f.targetKey} {
			host := f.stageFor(key)
			host.attributes = syncHPResolved(host.attributes)
		}
		return
	}
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
	for index, memo := range memos {
		if memo != nil && !f.fatal {
			memo.remember(inputs[index], f.stageFor([]string{f.sourceKey, f.targetKey}[index]).attributes, f.evalContext(ability).StrictReads)
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
			resolved := s.resolveAttributesFor(key, c.attributes, evalCtx, targetKey)
			c = s.combatants[key]
			c.attributes = resolved
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

func (f *executionFrame) registerDeferredRepeat(op planbundle.CompiledOperation) *model.EngineError {
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
	f.pendingRepeats = append(f.pendingRepeats, deferredRepeatRequest{
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

func (f *executionFrame) maybeCollectCopyableDamage(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, rawAmount float64, targetKey string, critEv frozenCritEvidence) *model.EngineError {
	collector := f.copyableCollector
	if collector == nil || collector.phantomDepth > 0 || !op.CopyableOnHit || op.Operation != "damage" {
		return nil
	}
	if f.commandsSpent() > f.run.budget.MaxCommandsPerEvent {
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	if f.consumedFirstPerCast == nil {
		f.consumedFirstPerCast = map[string]bool{}
	}
	rec := copyableDamageFrozen{
		rawAmount:            rawAmount,
		damageType:           op.DamageType,
		sourceKey:            f.sourceKey,
		targetKey:            targetKey,
		providerRef:          f.ownerProviderRef,
		originRef:            f.abilityRef,
		operationRef:         op.Ref,
		crit:                 critEv,
		ability:              ability,
		operation:            op,
		castInstanceID:       f.castInstanceID,
		castOrigin:           f.castOrigin,
		consumedFirstPerCast: f.consumedFirstPerCast,
		ownerCombatantKey:    f.providerOwnerKey(),
		eventCtx:             cloneEventSnapshot(f.eventCtx),
	}
	if f.eventCtx != nil {
		rec.eventSourceKey = f.eventCtx.eventSourceKey
		rec.eventTargetKey = f.eventCtx.eventTargetKey
		rec.entrySourceAttrs = f.eventCtx.entrySourceAttrs
		rec.entryTargetAttrs = f.eventCtx.entryTargetAttrs
		rec.entrySourceResources = f.eventCtx.entrySourceResources
		rec.entryTargetResources = f.eventCtx.entryTargetResources
	} else {
		rec.eventSourceKey = f.sourceKey
		rec.eventTargetKey = f.targetKey
		rec.entrySourceAttrs = f.entrySourceAttrs
		rec.entryTargetAttrs = f.entryTargetAttrs
		rec.entrySourceResources = f.entrySourceResources
		rec.entryTargetResources = f.entryTargetResources
	}
	f.pendingCopyable = append(f.pendingCopyable, rec)
	if len(collector.damages)+len(collector.repeats)+len(f.pendingCopyable)+len(f.pendingRepeats) > f.run.budget.MaxCommandsPerEvent {
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
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
		return s.budgetError(model.BudgetCauseMaxQueueEvents, "triggered continuation queue overflow")
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
	bag := readSharedProviderStateBag(&c.providerState, &c.providerStateShared, req.ownerProviderRef, false,
		s.resolveProviderStateFieldDefs(req.ownerCombatantKey, req.ownerProviderRef, c.providers), s.nowMs, providerStateReadOptions{cooldowns: c.cooldowns, ownerKey: req.ownerCombatantKey})
	if bag == nil {
		return false
	}
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
	if _, ok := s.combatants[dmg.targetKey]; !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	var frameStorage executionFrame
	s.initExecutionFrame(&frameStorage, dmg.sourceKey, dmg.targetKey, dmg.originRef)
	frame := &frameStorage
	frame.copyableCollector = collector
	if err := frame.bumpCommandBudget(); err != nil {
		return err
	}
	frame.ownerCombatantKey = dmg.ownerCombatantKey
	frame.ownerProviderRef = dmg.providerRef
	frame.castInstanceID, frame.castOrigin = dmg.castInstanceID, dmg.castOrigin
	frame.consumedFirstPerCast = dmg.consumedFirstPerCast
	frame.eventCtx = cloneEventSnapshot(dmg.eventCtx)
	targetStage := frame.stageFor(dmg.targetKey)
	view := pipeline.CombatantView{Attributes: targetStage.attributes, Shields: targetStage.shields}
	cmd := command.Command{
		Kind:       command.KindDamage,
		Source:     dmg.sourceKey,
		Target:     dmg.targetKey,
		Amount:     dmg.rawAmount,
		DamageType: dmg.damageType,
	}
	// 共同防御读取原事件入口完整冻结视图；提交仍使用当前护盾和生命。
	frame.damageDefenseContext = &formula.GenericEvalContext{
		SourceAttrs:     dmg.entryAttrsForCombatant(dmg.sourceKey),
		TargetAttrs:     dmg.entryAttrsForCombatant(dmg.targetKey),
		SourceResources: dmg.entryResourcesForCombatant(dmg.sourceKey),
		TargetResources: dmg.entryResourcesForCombatant(dmg.targetKey),
		StrictReads:     true,
	}
	// 暴击分支已冻结在 dmg.crit；本笔 modifiers 只登记重新执行的伤害修正。
	numbers, err := frame.resolveDamageNumbers(cmd, dmg.operation, dmg.crit, dmg.ability, nil)
	if err != nil {
		return err
	}
	var replayedFrom map[string]interface{}
	if s.detailedOutput() {
		replayedFrom = stableDamageReplayedFrom(dmg.providerRef, dmg.originRef, dmg.operationRef)
	}
	if numbers.failClosed {
		frame.recordGenericDamageEvidence(genericDamageEvidence{
			source: dmg.sourceKey, target: dmg.targetKey, damageType: dmg.damageType,
			rawAmount: numbers.rawAmount, mitigatedAmount: 0,
			providerRef: dmg.providerRef, abilityRef: dmg.originRef, operationRef: dmg.operationRef, operationPath: dmg.operation.Path,
			phantom: true, repeatTag: repeatTag,
			replayedFrom: replayedFrom,
			crit:         numbers.crit, modifiers: numbers.modifiers, traits: dmg.operation.Types,
		})
		frame.commit()
		return frame.fatalErr
	}
	targetHPBefore := attribute.ReadHP(view.Attributes)
	outcome, next := pipeline.ApplyMitigatedDamage(numbers.rawAmount, numbers.mitigatedAmount, view, s.nowMs, false)
	sourceHealthBefore, sourceHasHealth := frame.stageFor(dmg.sourceKey).attributes.Lookup("hp")
	result := command.Result{Kind: cmd.Kind, Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0, Amount: outcome.MitigatedAmount}
	damageID := frame.nextDamageID()
	targetStage.attributes = next.Attributes
	targetStage.shields = next.Shields
	if err := frame.settleDepletedShieldAttributes(); err != nil {
		return err
	}
	frame.reResolveStagedAttributesTwoPass(dmg.ability)
	frame.damageDealt += result.Amount
	frame.recordDamage(dmg.sourceKey, dmg.targetKey, result.Amount)
	damageRecordIndex := len(frame.pendingDamage)
	frame.recordGenericDamageEvidence(genericDamageEvidence{
		source:                    dmg.sourceKey,
		target:                    dmg.targetKey,
		damageType:                dmg.damageType,
		rawAmount:                 numbers.rawAmount,
		mitigatedAmount:           result.Amount,
		providerRef:               dmg.providerRef,
		abilityRef:                dmg.originRef,
		operationRef:              dmg.operationRef,
		operationPath:             dmg.operation.Path,
		hpBefore:                  targetHPBefore,
		hpAfter:                   attribute.ReadHP(next.Attributes),
		hasSourceHp:               sourceHasHealth,
		sourceHpBefore:            sourceHealthBefore.Current,
		phantom:                   true,
		repeatTag:                 repeatTag,
		replayedFrom:              replayedFrom,
		crit:                      numbers.crit,
		modifiers:                 numbers.modifiers,
		traits:                    dmg.operation.Types,
		castInstanceID:            dmg.castInstanceID,
		castOrigin:                dmg.castOrigin,
		damageID:                  damageID,
		outcome:                   &outcome,
		hasPostResistanceEvidence: true,
		resistanceFactor:          numbers.resistanceFactor,
		normalPartPostResistance:  numbers.normalPartPostResistance,
		critPartPostResistance:    numbers.critPartPostResistance,
	})
	if err := frame.settleDamageVamp(cmd, dmg.operation, dmg.ability, outcome, targetHPBefore, damageID, true); err != nil {
		return err
	}
	frame.pendingDamage[damageRecordIndex].sourceHpAfter = frame.stageFor(dmg.sourceKey).attributes.At("hp").Current
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	return nil
}

func (d copyableDamageFrozen) entryAttrsForCombatant(combatantKey string) attribute.Table {
	// entry_* 对应原始 emitted event 的 source/target；damage target 可能经 owner remap。
	// 优先按 damage target 与 frame event keys 对齐；若无匹配则回退 entryTarget（常见 on-hit 受害方）。
	if combatantKey == d.eventTargetKey {
		return d.entryTargetAttrs
	}
	if combatantKey == d.eventSourceKey {
		return d.entrySourceAttrs
	}
	if d.entryTargetAttrs.Len() > 0 {
		return d.entryTargetAttrs
	}
	return d.entrySourceAttrs
}

func (s *genericRunState) recordDamage(sourceKey, targetKey string, amount float64, timeMs int64) {
	if amount <= 0 {
		return
	}
	if !s.sampling.Disabled {
		s.damageHistory = append(s.damageHistory, damageRecord{
			timeMs:    timeMs,
			sourceKey: sourceKey,
			targetKey: targetKey,
			amount:    amount,
		})
	}
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
	if !s.settlingProcessDeaths && s.processFailure == nil {
		s.processFailure = s.failDeadProcesses()
	}
	if s.stopReasonSet {
		return
	}
	sourceDead := s.actionDeaths[model.SelectorSource] || s.combatantHasHp(model.SelectorSource) && s.combatantHp(model.SelectorSource) <= 0
	targetDead := s.actionDeaths[model.SelectorTarget] || s.combatantHasHp(model.SelectorTarget) && s.combatantHp(model.SelectorTarget) <= 0
	if sourceDead && targetDead {
		s.setStopReason(model.StopReasonBothDead)
	} else if sourceDead {
		s.setStopReason(model.StopReasonSourceDead)
	} else if targetDead && s.req.StopPolicy.StopOnTargetDeathOrDefault() {
		s.setStopReason(model.StopReasonTargetDead)
	}
}
