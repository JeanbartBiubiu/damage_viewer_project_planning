// 真实帧、所属暂存对象借用、命令预算及角色读取。
package execution

import (
	"strings"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/runtime/execution/continuation"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	"tinygo_engine_v2/internal/runtime/execution/operation"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

type combatantRuntime struct {
	instances effectpkg.InstanceState
	numbers   actor.State

	cooldowns *actionpkg.CooldownLedger

	providerState effectpkg.BagState
}

type stagedProviderMutation = lifecycle.Mutation

type stagedCombatant struct {
	instances effectpkg.InstanceChangeSet
	numbers   actor.ChangeSet

	resourceBatchContributors []model.ResourceChangeContributor
	// 属性视图可供入口、事件和live读取；真正写入前才取得独占副本。

	cooldownsShared bool

	cooldowns *actionpkg.CooldownLedger

	providerOps   []stagedProviderMutation
	providerState effectpkg.BagChangeSet

	dirty bool
}

// evalScope 保存当前同步执行的身份及只读输入，独立于帧级暂存。
type evalScope struct {
	sourceKey                string
	targetKey                string
	abilityRef               string
	ownerCombatantKey        string // 实际挂载拥有者，可以与事件或操作来源不同。
	ownerProviderRef         string
	mountedListener          bool
	strictReads              bool
	borrowedOperationOutputs bool

	// 入口视图在真实帧或强化负载入口冻结。
	entrySourceAttrs     attribute.Table
	entryTargetAttrs     attribute.Table
	entrySourceResources model.ResourceView
	entryTargetResources model.ResourceView
	eventCtx             *eventFormulaSnapshot
	skillHitCandidateKey string
	skillHitOccurrenceID uint64
	skipBlockedWrites    bool
	rootSkillHitDamage   bool // 仅由本次根命中候选继承。

	// 同次施放的身份及来源由多操作、延迟和监听执行继承。
	castInstanceID uint64
	castOrigin     string

	processUseKey         string
	processUseSource      string
	processUseSkillKey    string
	processCastPhase      string
	processMomentKind     string
	activeProcess         *actionpkg.ProcessView
	activeProcessOriginal *actionpkg.ProcessView
	activeProcessChanges  *actionpkg.ProcessChangeSet
	processActualCosts    model.NumericView
	processCostReadable   bool
	empoweredAttack       *model.ProcessEmpoweredAttack

	damageDefenseContext *formula.GenericEvalContext
}

// Frame 拥有单次操作的暂存投影与待提交事实，提交仍由执行协调统一完成。
type Frame struct {
	evalScope
	actionFrame            actionflow.Frame
	pendingAmountBudgets   []usage.AmountReservation
	numeric                operation.Frame
	readsDamageStateBefore bool
	pendingTargetMark      model.TargetMarkSummary
	effectProjection       lifecycle.Projection
	empowered              *empoweredFrame
	pendingMechanicRecords []model.MechanicRecord
	run                    *Engine
	frameID                uint64

	staged *frameStagedCollection

	commandCount int
	chainDepth   int

	fatal    bool
	fatalErr *model.EngineError

	pendingEvents []emittedEvent

	// copyableCollector：单次 emitted event / dispatchListeners 局部上下文；禁止挂到 Engine。
	copyableCollector *eventCopyableCollector
	driverEntryKey    string

	pendingShieldExpires []pendingShieldExpire
	committed            bool
	pendingEvidence      []model.EvidenceItem
	pendingEvidenceKinds []model.EvidenceKind
	pendingSkillHits     []committedSkillActionHit

	pendingContinuation   continuation.Pending
	pendingStateExpiry    []pendingFrameStateExpiry
	pendingAnchoredTicks  []pendingFrameAnchoredTick
	pendingProviderTick   *pendingFrameProviderTick
	providerDefinitionRef string
	providerActivatedAtMs *int64
	damageOwnerKey        string
	countCastOnCommit     bool
	castStatRef           string
	statRef               string
}

type frameStagedEntry struct {
	key   string
	value *stagedCombatant
}

// 常见双方条目保存在独立集合中，等待预检可共享集合而不持有父帧地址。
type frameStagedCollection struct {
	inline [2]frameStagedEntry
	count  int
	extra  map[string]*stagedCombatant
}

func (s *Engine) combatantHp(key string) float64 {
	c, ok := s.combatants[key]
	if !ok {
		return 0
	}
	if slot, ok := c.attributesView().LookupIndex(c.attributesView().Layout().HPIndex()); ok {
		return slot.Current
	}
	return 0
}

func (s *Engine) combatantHasHp(key string) bool {
	c, ok := s.combatants[key]
	if !ok {
		return false
	}
	_, ok = c.attributesView().LookupIndex(c.attributesView().Layout().HPIndex())
	return ok
}

func combatantPrefixFromAbilityRef(abilityRef string) string {
	if idx := strings.Index(abilityRef, "."); idx > 0 {
		return abilityRef[:idx]
	}
	return abilityRef
}

func (s *Engine) resolveOperationTarget(selector, entrySource, entryTarget string) (string, bool) {
	key, ok := s.resolveCombatantKey(selector, entrySource, entryTarget)
	return key, ok
}

func (s *Engine) resolveCombatantKey(selector, entrySource, entryTarget string) (string, bool) {
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

func (s *Engine) combatantExists(key string) bool {
	_, ok := s.combatants[key]
	return ok
}

func (c combatantRuntime) attributesView() attribute.Table { return c.numbers.Attributes() }

func (c combatantRuntime) resourceView() model.ResourceView { return c.numbers.Resources() }

func (c combatantRuntime) hpMaxAnchorValue() float64 { return c.numbers.HPMaxAnchor() }

func (c *combatantRuntime) setAttributes(value attribute.Table) {
	c.numbers = c.numbers.WithAttributes(value)
}

func (c *combatantRuntime) setHPMaxAnchor(value float64) {
	c.numbers = c.numbers.WithHPMaxAnchor(value)
}

func (c *stagedCombatant) attributesView() attribute.Table { return c.numbers.Attributes() }

func (c *stagedCombatant) resourceView() model.ResourceView { return c.numbers.Resources() }

func (c *stagedCombatant) setAttributes(value attribute.Table) { c.numbers.SetAttributes(value) }

func (c *stagedCombatant) readonlyResources() model.ResourceView { return c.numbers.FreezeResources() }

func parseFrameAbilityOwner(ref string) (string, bool) {
	parsed, ok := planbundle.ParseAbilityRef(ref)
	return parsed.Combatant, ok
}

func (f *Frame) commandsSpent() int {
	if f.run.actions.AttackActive() || f.run.effectInitialization.Active() || f.run.hasSkillPlan() || f.run.compiled.Features.Has(planbundle.FeatureTargetTiming) {
		return f.run.currentEventCommands
	}
	if f.copyableCollector != nil {
		return f.copyableCollector.Commands()
	}
	return f.commandCount
}

// 整批联动在分配事件前消费额度；失败帧也不退回已经消费的额度。
func (f *Frame) consumeCommands(count int) *model.EngineError {
	if f.run.actions.AttackActive() || f.run.effectInitialization.Active() || f.run.hasSkillPlan() || f.run.compiled.Features.Has(planbundle.FeatureTargetTiming) {
		return f.run.consumeEventCommands(count)
	}
	remaining := f.run.budget.MaxCommandsPerEvent - f.commandsSpent()
	if count > remaining {
		if f.copyableCollector != nil {
			f.copyableCollector.SetCommands(f.run.budget.MaxCommandsPerEvent + 1)
		} else {
			f.commandCount = f.run.budget.MaxCommandsPerEvent + 1
		}
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	if f.copyableCollector != nil {
		f.copyableCollector.SetCommands(f.copyableCollector.Commands() + count)
	} else {
		f.commandCount += count
	}
	return nil
}

func (s *Engine) initExecutionFrame(f *Frame, sourceKey, targetKey, abilityRef string) {
	s.operations = operation.New(&s.compiled, &s.formulas, s.req.SessionID, s.detailedOutput())
	s.nextFrameID++
	*f = Frame{
		run:       s,
		frameID:   s.nextFrameID,
		evalScope: evalScope{sourceKey: sourceKey, targetKey: targetKey, abilityRef: abilityRef},
		staged:    &frameStagedCollection{},
	}
	f.captureEntrySnapshots()
}

func (f *Frame) stageFor(key string) *stagedCombatant {
	if sc, ok := f.staged.Lookup(key); ok {
		return sc
	}
	base, ok := f.run.combatants[key]
	if !ok {
		sc := &stagedCombatant{numbers: actor.Stage(actor.New(key, attribute.Table{},
			nil)), cooldowns: actionpkg.NewCooldownLedger(),
		}
		f.staged.Set(key, sc)
		return sc
	}
	// 帧只读取已挂载列表；真正的挂载、刷新和移除由运行态写口取得独占列表。

	stateView := effectpkg.StageBags(&base.providerState)

	f.run.combatants[key] = base
	sc := &stagedCombatant{instances: effectpkg.StageInstances(base.instances, f.run.loop.TimeMs()), numbers: actor.Stage(base.numbers),

		cooldowns:       base.cooldowns,
		cooldownsShared: true,

		providerState: stateView,
	}
	f.staged.Set(key, sc)
	return sc
}

func (s *stagedCombatant) writableCooldowns() *actionpkg.CooldownLedger {
	if s.cooldownsShared {
		s.cooldowns = s.cooldowns.Clone()
		s.cooldownsShared = false
	} else if s.cooldowns == nil {
		s.cooldowns = actionpkg.NewCooldownLedger()
	}
	return s.cooldowns
}

func (s *stagedCombatant) readonlyCooldowns() *actionpkg.CooldownLedger {
	s.cooldownsShared = true
	return s.cooldowns
}

func (staged *frameStagedCollection) Lookup(key string) (*stagedCombatant, bool) {
	if staged == nil {
		return nil, false
	}
	for index := 0; index < staged.count; index++ {
		entry := staged.inline[index]
		if entry.key == key {
			return entry.value, true
		}
	}
	value, found := staged.extra[key]
	return value, found
}

func (staged *frameStagedCollection) Get(key string) *stagedCombatant {
	value, _ := staged.Lookup(key)
	return value
}

func (staged *frameStagedCollection) Set(key string, value *stagedCombatant) {
	for index := 0; index < staged.count; index++ {
		if staged.inline[index].key == key {
			staged.inline[index].value = value
			return
		}
	}
	if staged.count < len(staged.inline) {
		staged.inline[staged.count] = frameStagedEntry{key: key, value: value}
		staged.count++
		return
	}
	if staged.extra == nil {
		staged.extra = make(map[string]*stagedCombatant)
	}
	staged.extra[key] = value
}

func (staged *frameStagedCollection) Len() int {
	if staged == nil {
		return 0
	}
	return staged.count + len(staged.extra)
}

// 同步遍历；尚未访问的条目被替换时读取新值，不返回条目地址。
func (staged *frameStagedCollection) Range(visit func(string, *stagedCombatant)) {
	if staged == nil {
		return
	}
	for index := 0; index < staged.count; index++ {
		entry := staged.inline[index]
		visit(entry.key, entry.value)
	}
	for key, value := range staged.extra {
		visit(key, value)
	}
}
