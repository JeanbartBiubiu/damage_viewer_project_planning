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
	"tinygo_engine_v2/internal/runtime/execution/continuation"
	"tinygo_engine_v2/internal/runtime/execution/hit"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	"tinygo_engine_v2/internal/runtime/execution/operation"
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

// FrameAPI 只向公式求值暴露已获准的战斗事实读取能力。
type FrameAPI interface {
	// SetHitAttemptOccurrence 在取得序号后立即记入原帧，后续失败也保留该尝试身份。
	SetHitAttemptOccurrence(id uint64)
	// RequireHitAttackProcess 在原序号取得后检查实际普攻过程资格。
	RequireHitAttackProcess(ability planbundle.CompiledAbility, skill, use string) *model.EngineError
	// MarkHitAttack 在首接触与历史核对之前登记原行动的真实命中。
	MarkHitAttack(use string)
	// HitAttemptUse 只在原使用查询点借用现有身份和所属历史，调用期间不得替换历史。
	HitAttemptUse(reference string) hit.AttemptUse
	// HitAttemptBudgetError 保存唯一预算原因并返回原命中次数错误。
	HitAttemptBudgetError() *model.EngineError
	// CopyFirstPerCast 只在资格及首轮预算通过后取得原共享集合。
	CopyFirstPerCast() map[string]bool
	// CopyCollectionBudgetError 保存原唯一预算原因，返回本次收集失败。
	CopyCollectionBudgetError() *model.EngineError

	// AttachedBlocked 在同一帧认领原盾，并由根层同步交接原盾自己的消费监听。
	AttachedBlocked(context *hit.Context, replacesPrimary bool) *model.EngineError
	// AttachedHitCandidate 复用当前强化暂存及输出，保留该候选的根伤害资格。
	AttachedHitCandidate(context *hit.Context, candidate planbundle.CompiledSkillHitCandidate, blocked, rootDamage bool) *model.EngineError
	// AttachedListenerCondition 在当前共享暂存中求值条件并核对有限结果。
	AttachedListenerCondition(definition planbundle.CompiledListener, ability planbundle.CompiledAbility) (bool, *model.EngineError)
	// AttachedListenerError 返回原过程错误，不发布状态。
	AttachedListenerError(path, message, provider string) *model.EngineError
	// AttachedListenerOperations 在当前共享帧执行已核定操作，不自行提交。
	AttachedListenerOperations(ability planbundle.CompiledAbility, operations []planbundle.CompiledOperation) *model.EngineError
	// AttachedSpellShields 读取当前共享暂存内仍可消费且未被此前负载认领的盾。
	AttachedSpellShields(target string) (effectpkg.ProviderList, *model.EngineError)
	// BeginAttachedListener 暂时绑定该监听的实际双方及原阻挡事实，返回当前调用的恢复凭据。
	BeginAttachedListener(snapshot *eventFormulaSnapshot, definition planbundle.CompiledListener, ability planbundle.CompiledAbility, source, target string) attachedListenerBinding
	// BeginEmpoweredProcess 绑定本次独占暂存，返回当前调用的恢复凭据。
	BeginEmpoweredProcess(changes *actionpkg.ProcessChangeSet, target string, association *model.ProcessEmpoweredAttack) empoweredContextBinding
	// BindAttachedHit 将本负载有限事实与真实使用绑定当前同步求值范围，不发布事件。
	BindAttachedHit(context *hit.Context)
	// CommitEmpoweredGroup 统一发布共享强化帧及其尾部；未暂存过程时不提交空帧。
	CommitEmpoweredGroup() *model.EngineError
	// CommitHitRule 发布整个规则组，再同步处理已经生成的事实。
	CommitHitRule() *model.EngineError
	// EmpoweredActivationHistory 返回原激活使用的真实登记身份和已发生接触数。
	EmpoweredActivationHistory(use string) hit.ActivationHistory
	// EmpoweredExecutionError 返回原过程错误，不修改状态。
	EmpoweredExecutionError(path, message, use string) *model.EngineError
	// EmpoweredFailureMoment 在原位置执行已经确定的失败时点和原因。
	EmpoweredFailureMoment(changes *actionpkg.ProcessChangeSet, reason string) *model.EngineError
	// EmpoweredFinishedAt 借用本组指定完成过程，只用于当前同步尾部。
	EmpoweredFinishedAt(index int) *actionpkg.ProcessView
	// EmpoweredFinishedCount 返回当前组已暂存完成的过程数。
	EmpoweredFinishedCount() int
	// EmpoweredGroupFailure 在原有全部解决事实发布之后返回本场已经保留的过程错误。
	EmpoweredGroupFailure() *model.EngineError
	// EmpoweredOwnerLive 查询当前拥有者存活和实际挂载。
	EmpoweredOwnerLive(owner, provider string, definition uint16) bool
	// EmpoweredPayload 在同一共享帧执行本次负载。
	EmpoweredPayload(event emittedEvent, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload planbundle.CompiledAbility) *model.EngineError
	// EmpoweredProcessMoment 在共享暂存中同步执行指定原过程时点。
	EmpoweredProcessMoment(changes *actionpkg.ProcessChangeSet, target string, association *model.ProcessEmpoweredAttack, kind string) *model.EngineError
	// EndAttachedListener 恢复原求值范围；executed表示已执行操作，需要单独归属实际输出。
	EndAttachedListener(binding attachedListenerBinding, executed bool)
	// EndEmpoweredProcess 恢复原绑定并登记本范围实际产生的输出，不撤销共享暂存。
	EndEmpoweredProcess(saved empoweredContextBinding)
	// FinishAttachedHit 清除当前候选阻挡写入标记，不恢复或发布其他状态。
	FinishAttachedHit()
	// FreezeHitEmpoweredWaits 仅在原生普攻命中入口冻结当前合格等待身份。
	FreezeHitEmpoweredWaits(owner string) []hit.EmpoweredWait
	// HitConditionValue 在本帧原有参数及事件上下文中读取右值，保留公式错误归属。
	HitConditionValue(condition planbundle.CompiledSkillHitValueCond, candidateKey string) (float64, *model.EngineError)
	// HitExecutionError 生成归属本场的命中错误，不发布状态。
	HitExecutionError(code model.GenericErrCode, message, path, ref string) *model.EngineError
	// HitParticipation 在给定实际挂载上求值；live=false表示挂载已经失效。
	HitParticipation(program formula.GenericProgramID, ability planbundle.CompiledAbility, provider string, definition uint16) (float64, bool, *model.EngineError)
	// HitRuleCandidate 清理上一候选输出，在共享暂存中执行本候选并暂存其伤害事实。
	HitRuleCandidate(context *hit.Context, candidate planbundle.CompiledSkillHitCandidate, blocked bool) *model.EngineError
	// HitSpellShields 返回实际命中目标当前仍活动的法术盾，不应用或移除盾。
	HitSpellShields(target string) effectpkg.ProviderList
	// ListenerMountLive 重新读取实际挂载资格，不沿用冻结前的结果。
	ListenerMountLive(definition planbundle.CompiledListener) bool
	// ListenerRecoveryError 返回原恢复资格错误，不读取或修改其他状态。
	ListenerRecoveryError(message, path, target string) *model.EngineError
	// ListenerRecoveryHP 返回指定实际拥有者在本帧的当前暂存生命，不提交。
	ListenerRecoveryHP(owner string) float64
	// PrimaryDamageStart 返回执行负载前已有伤害事实数，不从数值汇总反推。
	PrimaryDamageStart() int
	// PublishEmpoweredContact 登记实际目标接触及原激活使用的报告事实。
	PublishEmpoweredContact(process *actionpkg.ProcessView, association model.ProcessEmpoweredAttack)
	// PublishEmpoweredFinish 发布已经完成的过程，不再执行负载。
	PublishEmpoweredFinish(process *actionpkg.ProcessView)
	// PublishEmpoweredMoment 发布已经在本帧发生的过程时点。
	PublishEmpoweredMoment(process *actionpkg.ProcessView, kind string)
	// PublishEmpoweredMutation 发布原过程的暂存并更新等待索引，clearAttack只清除计数窗口的临时关联。
	PublishEmpoweredMutation(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, clearAttack bool)
	// PublishEmpoweredOutput 将实际能力输出归入已有报告累计。
	PublishEmpoweredOutput(ref string, damage, healing float64)
	// PublishEmpoweredPrimary 发布本帧根据真实负载生成的主体替换累计。
	PublishEmpoweredPrimary(row model.BasicAttackPrimaryReplacement, binding uint16)
	// PublishEmpoweredReservation 将真实原生使用关联原窗口的既有消耗位置。
	PublishEmpoweredReservation(use *actionpkg.UseView, process *actionpkg.ProcessView, index int)
	// QueuePrimaryDamage 在原帧重新绑定真实负载并追加已确定资格的伤害事实，返回前恢复外层求值范围。
	QueuePrimaryDamage(event emittedEvent, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload, parent planbundle.CompiledAbility, rootDamage bool)
	// RecordCountedExecution 暂存原有执行时点事实，不执行步骤转移。
	RecordCountedExecution(process *actionpkg.ProcessView)
	// ResolveEmpoweredProcess 发布该过程真实目标的解决事实，并保留过程失败。
	ResolveEmpoweredProcess(process *actionpkg.ProcessView) *model.EngineError
	// StageEmpoweredResult 追加本次已完成过程的提交事实，不立即发布。
	StageEmpoweredResult(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack)
	// StagePrimaryPayload 只依据该次负载实际产生的事实暂存主体替换统计。
	StagePrimaryPayload(process *actionpkg.ProcessView, payload planbundle.CompiledAbility, association *model.ProcessEmpoweredAttack, start int) *model.EngineError
}

// Frame 拥有单次操作的暂存投影与待提交事实，提交仍由执行协调统一完成。
type Frame struct {
	numeric                        operation.Frame
	readsDamageStateBefore         bool
	pendingTargetMark              model.TargetMarkSummary
	effectProjection               lifecycle.Projection
	empowered                      *empoweredFrame
	empoweredAttack                *model.ProcessEmpoweredAttack
	pendingAutomaticWake           bool
	pendingBasicAttackCooldownWake bool
	pendingCooldownAttempts        []pendingCooldownAttempt
	pendingAmmoWaits               []pendingAmmoRecovery
	pendingAmmoCapture             *ammoUseCapture
	pendingMechanicRecords         []model.MechanicRecord
	pendingBasicAttackWait         *actionpkg.AttackWaitView
	pendingActionWait              bool
	processUseKey                  string
	processCastPhase               string
	recastExecutionCommitted       bool
	processUseSkillKey             string
	processUseSource               string
	damageDefenseContext           *formula.GenericEvalContext
	processActualCosts             model.NumericView
	processCostReadable            bool
	processMomentKind              string
	run                            *Engine
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
	entrySourceResources model.ResourceView
	entryTargetResources model.ResourceView

	// eventCtx：listener / child ability 继承的原始 event 快照；nil 表示无 event context。
	eventCtx *eventFormulaSnapshot

	commandCount int
	chainDepth   int
	// rootSkillHitDamage 仅由本次根 resolve_skill_hit 的候选继承，不能由监听或旧命中上下文推导。
	rootSkillHitDamage bool
	fatal              bool
	fatalErr           *model.EngineError

	pendingEvents []emittedEvent

	// copyableCollector：单次 emitted event / dispatchListeners 局部上下文；禁止挂到 Engine。
	copyableCollector    *eventCopyableCollector
	driverEntryKey       string
	skipBlockedWrites    bool
	skillHitCandidateKey string
	skillHitOccurrenceID uint64

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
	pendingProcess        *actionpkg.ProcessView
	processChanges        *actionpkg.ProcessChangeSet
	processOriginal       *actionpkg.ProcessView
	processIsNew          bool
	pendingProcessTimer   bool
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

var _ FrameAPI = (*Frame)(nil)

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
	if f.run.actions.AttackActive() || f.run.effectInitialization.Active() || f.run.hasSkillPlan() || f.run.compiled.HasTargetTiming {
		return f.run.currentEventCommands
	}
	if f.copyableCollector != nil {
		return f.copyableCollector.Commands()
	}
	return f.commandCount
}

// 整批联动在分配事件前消费额度；失败帧也不退回已经消费的额度。
func (f *Frame) consumeCommands(count int) *model.EngineError {
	if f.run.actions.AttackActive() || f.run.effectInitialization.Active() || f.run.hasSkillPlan() || f.run.compiled.HasTargetTiming {
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
		run:        s,
		frameID:    s.nextFrameID,
		sourceKey:  sourceKey,
		targetKey:  targetKey,
		abilityRef: abilityRef,
		staged:     &frameStagedCollection{},
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
