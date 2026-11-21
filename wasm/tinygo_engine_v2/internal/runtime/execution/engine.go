// 单场装配、唯一循环接线及运行预算。
package execution

import (
	"encoding/json"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/continuation"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
	"tinygo_engine_v2/internal/runtime/execution/hit"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	listenerpkg "tinygo_engine_v2/internal/runtime/execution/listener"
	"tinygo_engine_v2/internal/runtime/execution/operation"
	"tinygo_engine_v2/internal/runtime/execution/usage"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
	"tinygo_engine_v2/internal/scheduler"
)

type sameTimeSelectionRule uint8

const (
	sameTimeBeforeStateExpiry sameTimeSelectionRule = iota
	sameTimeAnchoredTerminal
)

// EngineAPI 定义单次执行协调的公开能力，调度仍借用根入口创建的唯一循环。
type EngineAPI interface {
	// AcceptedListenerOrigin 查询已有行动的真实接纳事实，不创建使用或改变冷却。
	AcceptedListenerOrigin(event emittedEvent) bool
	// RuleGroupOrigin 在范围核验通过后读取本次原父能力、实际挂载和真实使用。
	RuleGroupOrigin(ev emittedEvent, freeze *frozenSkillHitContext) hit.RuleOrigin
	// RuleGroupReservationFailure 在原额度容量失败点保留本场预算原因。
	RuleGroupReservationFailure(err *model.EngineError)
	// RunRuleGroupFrame 建立原共享帧并运输原凭据；候选仍共用该帧且在原事实点提交。
	RunRuleGroupFrame(ev emittedEvent, freeze *frozenSkillHitContext, group planbundle.CompiledSkillHitRuleGroup, grant hit.RuleGrant, token usage.Reservation, chainDepth int) *model.EngineError

	// DecideNext 在每轮前置位置核对本场业务结束及事件预算，不推进时钟或发布战斗状态。
	DecideNext(observation scheduler.LoopObservation) (scheduler.LoopDecision, *model.EngineError)
	// LoopDecisionError 为不符合循环交接契约的决定生成带本场身份的运行错误。
	LoopDecisionError(message string) *model.EngineError
	// ApplyCopy 创建并完整提交一笔原始复制伤害；失败保留已经发布的前序事实。
	ApplyCopy(c *eventCopyableCollector, d copyableDamageFrozen, tag string) *model.EngineError
	// CopiesStopped 返回唯一循环当前停止状态。
	CopiesStopped() bool
	// EmpoweredMountLive 查询实际拥有者的指定挂载，保留原开始时的资格范围。
	EmpoweredMountLive(owner, provider string, definition uint16) bool
	// EmpoweredOwnerLive 查询当前拥有者存活和实际挂载。
	EmpoweredOwnerLive(owner, provider string, definition uint16) bool
	// EmpoweredWindowAt 借用当前序号的过程视图，只在本次同步准备期间读取。
	EmpoweredWindowAt(index int) *actionpkg.ProcessView
	// EmpoweredWindowCount 返回当前强化等待数，不冻结或修改列表。
	EmpoweredWindowCount() int
	// EnsureLoopBudgetCause 在尚无预算原因时补记事件数预算。
	EnsureLoopBudgetCause()
	// Finish 仅终结活动过程；提交与命中成功后才发布成功完成事实。
	Finish() (model.DoneResult, *model.EngineError)
	// FinishListenerDispatch 执行本次派发完成后原有的复制收尾。
	FinishListenerDispatch(collector *eventCopyableCollector) *model.EngineError
	// FinishListenerUse 在真实触发成功后提交；失败只释放尚未提交的额度。
	FinishListenerUse(collector *eventCopyableCollector, definition planbundle.CompiledListener, reserved, triggered bool)
	// HandleLoopEvent 将已接纳的事件分派到既有门禁、执行帧及提交路径。
	HandleLoopEvent(event scheduler.GenericEvent) *model.EngineError
	// HitCandidate 同步执行一个已选候选的真实子帧及提交尾部。
	HitCandidate(event emittedEvent, context *hit.Context, candidate planbundle.CompiledSkillHitCandidate, blocked bool, depth int) *model.EngineError
	// HitExecutionError 生成归属本场的命中错误，不发布状态。
	HitExecutionError(code model.GenericErrCode, message, path, ref string) *model.EngineError
	// HitPersistentAttributeSlot 查询实际目标上修正落点的显式属性槽，不物化或发布状态。
	HitPersistentAttributeSlot(target, modifierTarget, key string) bool
	// HitPrimaryReplacement 同步尝试该原生主体的实际强化替换，返回是否已经替换。
	HitPrimaryReplacement(event emittedEvent, context *hit.Context, candidate int, depth int) (bool, *model.EngineError)
	// HitRuleGroup 同步进入一组共用真实帧及共同额度的候选。
	HitRuleGroup(event emittedEvent, context *hit.Context, group planbundle.CompiledSkillHitRuleGroup, depth int) *model.EngineError
	// ListenerAbility 同步尝试当前监听的真实子能力，返回是否实际施放。
	ListenerAbility(event emittedEvent, collector *eventCopyableCollector, definition planbundle.CompiledListener, source, target string, chainDepth int) (bool, *model.EngineError)
	// ListenerCondition 在任何监听写入之前求值一次条件。
	ListenerCondition(event emittedEvent, definition planbundle.CompiledListener) (bool, *model.EngineError)
	// ListenerDispatchError 为当前编译监听生成归属本场的错误。
	ListenerDispatchError(code model.GenericErrCode, message, path, ref string) *model.EngineError
	// ListenerMountLive 重新读取实际挂载资格，不沿用冻结前的结果。
	ListenerMountLive(definition planbundle.CompiledListener) bool
	// ListenerOperations 同步执行当前监听的真实操作子帧及既有提交、尾部。
	ListenerOperations(event emittedEvent, collector *eventCopyableCollector, definition planbundle.CompiledListener, source, target string, chainDepth int) *model.EngineError
	// ListenerSkipped 仅记录已经确定的跳过事实。
	ListenerSkipped(definition planbundle.CompiledListener, reason string)
	// LoopBudgetExceeded 保存预算原因及既有错误事实。
	LoopBudgetExceeded(cause model.BudgetCause, message string)
	// LoopState 提供事件处理后立即复核的失败、自动运行及普攻参与者事实。
	LoopState() scheduler.LoopState
	// LoopStopState 返回死亡与预算事实，由唯一循环核定停止原因。
	LoopStopState() scheduler.LoopStopState
	// ObserveBefore 补齐指定时刻之前的采样，只观察已提交数值。
	ObserveBefore(at int64)
	// ObserveFinal 按现有采样规则补记最终观察点。
	ObserveFinal()
	// ObserveThrough 补齐截至指定时刻的采样，只观察已提交数值。
	ObserveThrough(at int64)
	// PlannedPrimaryProvider 查询给定挂载的计划身份，不执行或改变行动。
	PlannedPrimaryProvider(owner, provider string) bool
	// PrimaryActivationHistory 返回选中过程实际激活使用的有限历史。
	PrimaryActivationHistory(use string) hit.ActivationHistory
	// PrimaryNativeBinding 只在已有替换等待时读取原生主体及其实际挂载，返回本次同步独占的身份值。
	PrimaryNativeBinding(source string, definition uint16) hit.PrimaryBinding
	// PublishLoopWait 将当前普攻等待投影写回行动状态，不建立独立时钟。
	PublishLoopWait()
	// QueueCopyContinuation 使用父层唯一队列写入已登记载荷的时间及身份；失败不保留载荷。
	QueueCopyContinuation(id uint64, delayMs int) *model.EngineError
	// ReadRepeatState 在原重复资格检查位置读取拥有者状态，读取可能准备到期状态。
	ReadRepeatState(owner, provider, key string) (float64, bool)
	// ReserveListenerUse 在唯一共同额度账预留，并将凭据绑定本次子帧收集范围。
	ReserveListenerUse(event emittedEvent, collector *eventCopyableCollector, definition planbundle.CompiledListener) (reserved, skip bool, err *model.EngineError)
	// SelectLoopEvent 保留状态到期、锚定终点与过程计时之间的同刻特殊顺序。
	SelectLoopEvent(event scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError)
	// SettleCopyDeaths 在原复制尾部判断死亡，不提前截断同步复制遍历。
	SettleCopyDeaths()
	// SettleLoopEnd 结算结束时仍需处理的资源上限到期，并返回实际执行失败。
	SettleLoopEnd() *model.EngineError
}

// Engine 私有组合各子系统状态，拥有执行因果及统一提交协调。
type Engine struct {
	operations                 operation.Executor
	report                     reportpkg.State
	nextHealthOrder            uint64
	abilityTypeKeyCache        map[typeset.TypeSet][]string
	evaluation                 evaluation.State
	providerDefinitionFields   effectpkg.DefinitionCache
	actions                    actionpkg.State
	processFailure             *model.EngineError
	settlingProcessDeaths      bool
	settlingProcessStun        bool
	compiled                   planbundle.CompiledSession
	formulas                   formula.Library
	req                        model.RunRequest
	loop                       *scheduler.Loop
	conditionRecheckIntervalMs int64

	combatants map[string]combatantRuntime

	budget               model.SafetyBudget
	currentEventCommands int
	effectInitialization lifecycle.Initialization
	budgetCause          model.BudgetCause

	abilityCastCount int

	nextFrameID  uint64
	nextDamageID uint64

	effectTimers     effectpkg.TimeState
	effectIdentities effectpkg.IdentityRegistry

	// Cast-instance identity (Focused Will / per-cast throttle). Monotonic from 1; discarded after run.
	nextCastInstanceID uint64
	listeners          listenerpkg.State

	// Delayed repeat continuations (run-local; discarded with the run).
	continuations continuation.Executor

	hits             hit.State
	skillUses        map[string]*skillUseRuntime
	attackStartFacts map[string]model.AttackStartFact
	useTriggerLedger usage.Ledger
}

var _ EngineAPI = (*Engine)(nil)

func (s *Engine) Finish() (model.DoneResult, *model.EngineError) {
	if s.compiled.Features.Has(planbundle.FeatureProviderElapsedReads) && s.budgetCause == "" {
		s.refreshProviderAwareAttributes(model.SelectorSource, model.SelectorTarget)
		if s.processFailure != nil {
			return model.DoneResult{}, s.processFailure
		}
	}
	done := s.buildDoneResult(true)
	if s.processFailure != nil {
		return model.DoneResult{}, s.processFailure
	}
	return done, nil
}

// New 为一次运行装配私有状态并借用传入的唯一循环；输入不合法时返回实际准入错误。
// 运行时间范围由上层公开运行入口在创建循环前统一校验。
func New(compiled planbundle.CompiledSession, req model.RunRequest, loop *scheduler.Loop) (*Engine, *model.EngineError) {
	if len(req.InitialSnapshot.UseAmountBudgets) != 0 {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "cumulative refund budgets are output facts and cannot be restored", "initialSnapshot.useAmountBudgets", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if compiled.Features.Has(planbundle.FeatureImmediatePeriodic) || compiled.Features.Has(planbundle.FeatureTotalCooldownRefund) {
		if err := validateImmediatePeriodicRefundFreshSnapshot(compiled, req); err != nil {
			return nil, err
		}
	}
	// TinyGo在函数入口为错误闭包捕获的参数分配；特性门须放在调用点。
	if compiled.Features.Has(planbundle.FeatureReceivedShieldReads) {
		if err := validateReceivedShieldInitialSnapshot(compiled, req); err != nil {
			return nil, err
		}
	}
	if req.OutputMode != "" && req.OutputMode != model.RunOutputDetailed && req.OutputMode != model.RunOutputSummary {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "outputMode must be detailed or summary", "outputMode", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if (req.DriverPlan.BasicAttack != nil || len(req.DriverPlan.SkillActions) > 0 || req.DriverPlan.AutomaticSkills != nil) && len(compiled.RuleModifiers) != 0 {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "continuous basic attack does not admit unselected global modifiers", "rules.modifiers", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	recheck := normalizeConditionRecheckInterval(req.DriverPlan.ConditionRecheckIntervalMs)

	sampling := req.Sampling
	if sampling.SampleEveryMs < 0 || sampling.DpsWindowMs < 0 || sampling.MaxSeriesPoints < 0 || sampling.MaxSeriesPoints == 1 || sampling.MaxSeriesPoints > 5000 {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "invalid sampling interval or point limit", "sampling", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	defaults := model.DefaultSamplingConfig()
	if sampling.SampleEveryMs <= 0 {
		sampling.SampleEveryMs = defaults.SampleEveryMs
	}
	if sampling.DpsWindowMs <= 0 {
		sampling.DpsWindowMs = defaults.DpsWindowMs
	}
	if sampling.MaxSeriesPoints <= 0 {
		sampling.MaxSeriesPoints = defaults.MaxSeriesPoints
	}

	budget := model.DefaultSafetyBudget()
	compileMaxEvents := 0
	if compiled.Settings.MaxEvents > 0 {
		compileMaxEvents = compiled.Settings.MaxEvents
		budget.MaxEvents = compileMaxEvents
	}
	if compiled.Settings.MaxCommandsPerEvent > 0 {
		budget.MaxCommandsPerEvent = compiled.Settings.MaxCommandsPerEvent
	}
	if compiled.Settings.MaxChainDepth > 0 {
		budget.MaxChainDepth = compiled.Settings.MaxChainDepth
	}
	if req.SafetyBudget != nil {
		sb := req.SafetyBudget
		if sb.MaxProcessInstances < 0 || sb.MaxProcessInstances > 100000 {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "maxProcessInstances must be a positive integer at most 100000", "safetyBudget.maxProcessInstances", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
		}
		if sb.MaxBasicAttacks < 0 || sb.MaxBasicAttacks > 4096 {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "maxBasicAttacks must be at most 4096", "safetyBudget.maxBasicAttacks", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
		}
		if sb.MaxBasicAttacks > 0 {
			budget.MaxBasicAttacks = sb.MaxBasicAttacks
		}
		if (req.DriverPlan.BasicAttack != nil || len(req.DriverPlan.SkillActions) > 0 || req.DriverPlan.AutomaticSkills != nil) && ((sb.MaxEvents > compiled.Settings.MaxEvents && compiled.Settings.MaxEvents > 0) || (sb.MaxCommandsPerEvent > compiled.Settings.MaxCommandsPerEvent && compiled.Settings.MaxCommandsPerEvent > 0) || (sb.MaxChainDepth > compiled.Settings.MaxChainDepth && compiled.Settings.MaxChainDepth > 0)) {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "run safety budget exceeds compiled limits", "safetyBudget", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
		}
		if sb.MaxProcessInstances > 0 {
			budget.MaxProcessInstances = sb.MaxProcessInstances
		}
		if sb.MaxChainDepth > 0 {
			budget.MaxChainDepth = sb.MaxChainDepth
		}
		if sb.MaxCommandsPerEvent > 0 {
			budget.MaxCommandsPerEvent = sb.MaxCommandsPerEvent
		}
		if sb.MaxEvents > 0 {
			if compileMaxEvents > 0 && sb.MaxEvents > compileMaxEvents {
				budget.MaxEvents = compileMaxEvents
			} else {
				budget.MaxEvents = sb.MaxEvents
			}
		}
	}
	validateRuntimeOptions(req.RuntimeOptions)

	formulas := compiled.Formulas
	combatants, err := materializeCombatants(req.InitialSnapshot, compiled, formulas, req.SessionID)
	if err != nil {
		return nil, err
	}
	effectIdentities := effectpkg.NewIdentityRegistry()
	for _, c := range combatants {
		for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			inst := instanceValues.At(instanceIndex)
			effectIdentities.ReserveProvider(inst.ProviderRef)
		}
		for instanceIndex, instanceValues := 0, c.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			sh := instanceValues.At(instanceIndex)
			if sh.ShieldRef != "" {
				effectIdentities.ReserveShield(sh.ShieldRef)
			}
		}
	}

	state := &Engine{
		compiled:                   compiled,
		formulas:                   formulas,
		req:                        req,
		loop:                       loop,
		conditionRecheckIntervalMs: recheck,
		combatants:                 combatants,
		effectIdentities:           effectIdentities,
		budget:                     budget,
		listeners:                  listenerpkg.New(budget.MaxEvents),
	}
	if err := state.initResourceMaxState(); err != nil {
		return nil, err
	}
	if err := validateFixedEquipmentHealth(compiled, state.combatants, req.SessionID); err != nil {
		return nil, err
	}

	state.loop.SetQueueLimit(compiled.Settings.MaxQueueEvents)
	if !state.report.InitBasicRecords(req.RecordBudget) {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "invalid record retention budget", "recordBudget", "", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if err := state.initSamplingCursor(sampling); err != nil {
		return nil, err
	}
	if err := state.compileDriverConditions(); err != nil {
		return nil, err
	}
	if err := state.initStateOnExpireSources(); err != nil {
		return nil, err
	}
	if err := state.initSkillHitState(); err != nil {
		return nil, err
	}
	if err := state.validateTargetTimingFresh(); err != nil {
		return nil, err
	}
	if err := state.restoreProviderStateTimers(req.InitialSnapshot); err != nil {
		return nil, err
	}
	if err := state.initUseTriggerState(); err != nil {
		return nil, err
	}
	if err := state.initProcessState(); err != nil {
		return nil, err
	}
	if err := state.initSkillAction(); err != nil {
		return nil, err
	}
	if err := state.initAutomaticSkills(); err != nil {
		return nil, err
	}
	if err := state.initCooldownStateExpirySources(); err != nil {
		return nil, err
	}
	if err := state.initBasicAttack(); err != nil {
		return nil, err
	}
	if err := state.initIncomingCappedFlatSources(); err != nil {
		return nil, err
	}
	if compiled.Features.Has(planbundle.FeaturePermanentCharacterPeriod) {
		if err := state.initPermanentCharacterPeriods(); err != nil {
			return nil, err
		}
	}
	if err := state.initTargetMarkSources(); err != nil {
		return nil, err
	}
	state.initPlannedAmmo()
	if err := state.seedSourceInitialization(); err != nil {
		return nil, err
	}
	// Fresh-scene admission above still compares the authored equipped maximum
	// with Resolved. Only after all admission checks may runtime HP reads switch
	// to Current; half-health scenes must pass the same untouched input checks.
	if compiled.Features.Has(planbundle.FeatureResourceMax) {
		for key, c := range state.combatants {

			c.setAttributes(operation.SyncHPResolved(c.attributesView()))
			state.combatants[key] = c
		}
	}
	state.seedDriverAttempts()
	state.seedSkillAction()
	state.queueAutomaticSkills(state.loop.StartMs())
	state.seedExpireCleanups()
	state.seedProviderTicks()
	if state.actions.AmmoCount() > 0 {
		state.pushCombatEvent(scheduler.GenericEvent{TimeMs: state.loop.StartMs(), Category: scheduler.GenericCategoryAmmoRecovery, Kind: scheduler.GenericEventAmmoAdmission, DriverEntryIndex: -1})
	}
	if state.actions.BasicAttack() != nil {
		if state.actions.BasicAttack().Ammo() != nil && state.hasSkillPlan() && state.actions.AmmoCount() == 0 {
			state.pushCombatEvent(scheduler.GenericEvent{TimeMs: state.loop.StartMs(), Category: scheduler.GenericCategoryAmmoRecovery, Kind: scheduler.GenericEventAmmoAdmission, DriverEntryIndex: -1})
		}
		state.pushCombatEvent(scheduler.GenericEvent{TimeMs: state.loop.StartMs(), Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1})
	}
	if compiled.Features.Has(planbundle.FeatureActionStun) && state.actions.ProcessCount() != 0 {
		// 恢复输入已经带控制事实时，先按同一死亡/控制顺序收敛，
		// 不能等待下一个过程时点提交后才阻止其负载。
		state.checkDeathStopReason()
		if state.processFailure != nil {
			return nil, state.processFailure
		}
	}
	return state, nil
}

func engineErrorPtr(phase model.GenericErrorPhase, code model.GenericErrCode, message, schemaHash, rulesHash, sessionID string) *model.EngineError {
	err := model.NewEngineError(phase, code, message)
	err.SchemaHash = schemaHash
	err.RulesHash = rulesHash
	err.SessionID = sessionID
	return &err
}

func engineErrorPtrAt(phase model.GenericErrorPhase, code model.GenericErrCode, message, path, ref, schemaHash, rulesHash, sessionID string) *model.EngineError {
	err := engineErrorPtr(phase, code, message, schemaHash, rulesHash, sessionID)
	err.Path = path
	err.Ref = ref
	return err
}

func validateRuntimeOptions(raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var probe interface{}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return
	}
	if _, ok := probe.(map[string]interface{}); !ok {
		// P0: non-object runtimeOptions are ignored.
	}
}

func (s *Engine) budgetError(cause model.BudgetCause, message string) *model.EngineError {
	if s.budgetCause == "" {
		s.budgetCause = cause
	}
	err := engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	err.BudgetCause = cause
	return err
}

func (s *Engine) consumeEventCommands(count int) *model.EngineError {
	if count < 0 || s.currentEventCommands > s.budget.MaxCommandsPerEvent-count {
		s.currentEventCommands = s.budget.MaxCommandsPerEvent + 1
		return s.budgetError(model.BudgetCauseMaxCommandsPerEvent, "event command budget exceeded")
	}
	s.currentEventCommands += count
	return nil
}

func (s *Engine) recordFirstProcessFailure(err *model.EngineError) {
	if s.processFailure == nil && err != nil {
		s.processFailure = err
	}
}

func (s *Engine) pushCombatEvent(ev scheduler.GenericEvent) bool {
	if s.loop.Enqueue(ev) == model.ErrOK {
		return true
	}
	if s.processFailure == nil {
		s.recordFirstProcessFailure(s.budgetError(model.BudgetCauseMaxQueueEvents, "event queue capacity exceeded"))
	}
	return false
}

func (s *Engine) setStopReason(reason model.StopReason) { s.loop.Stop(reason) }

func (s *Engine) finalizeStopReason() { s.loop.Finalize(s.LoopStopState()) }

func (s *Engine) checkDeathStopReason() {
	if !s.settlingProcessDeaths && s.processFailure == nil {
		s.recordFirstProcessFailure(s.failDeadProcesses())
	}
	if s.processFailure == nil {
		s.recordFirstProcessFailure(s.failStunnedProcesses())
	}
	if s.loop.Stopped() {
		return
	}
	sourceDead := s.actions.Dead(model.SelectorSource) || s.combatantHasHp(model.SelectorSource) && s.combatantHp(model.SelectorSource) <= 0
	targetDead := s.actions.Dead(model.SelectorTarget) || s.combatantHasHp(model.SelectorTarget) && s.combatantHp(model.SelectorTarget) <= 0
	if sourceDead && targetDead {
		s.setStopReason(model.StopReasonBothDead)
	} else if sourceDead {
		s.setStopReason(model.StopReasonSourceDead)
	} else if targetDead && s.req.StopPolicy.StopOnTargetDeathOrDefault() {
		s.setStopReason(model.StopReasonTargetDead)
	}
}

func (s *Engine) LoopState() scheduler.LoopState {
	basic := s.actions.BasicAttack()
	return scheduler.LoopState{
		Failure: s.processFailure, Automated: s.automatedRun(),
		HasBasicAttack:        basic != nil,
		BasicParticipantsDead: basic != nil && (s.combatantHp(basic.Plan().Source) <= 0 || s.combatantHp(basic.Plan().Target) <= 0),
	}
}

func (s *Engine) DecideNext(observation scheduler.LoopObservation) (scheduler.LoopDecision, *model.EngineError) {
	if s.processFailure != nil {
		if !s.automatedRun() || s.processFailure.BudgetCause == "" {
			return scheduler.LoopDecision{}, s.processFailure
		}
		return scheduler.LoopDecision{Kind: scheduler.LoopStopNow, StopReason: model.StopReasonBudgetExceeded}, nil
	}
	if s.hasSkillPlan() && (s.actions.Dead(model.SelectorSource) || s.actions.Dead(model.SelectorTarget) || s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0) {
		return scheduler.LoopDecision{Kind: scheduler.LoopFinalizeNow}, nil
	}
	outsideWindow := !observation.HasNextEvent || observation.NextEventAtMs > observation.EndMs
	if s.actions.ManualCount() > 0 && outsideWindow {
		return scheduler.LoopDecision{Kind: scheduler.LoopEndAtLimit}, nil
	}
	if basic := s.actions.BasicAttack(); basic != nil && !basic.UnfinishedTail() && basic.WindowSettled() && outsideWindow {
		return scheduler.LoopDecision{Kind: scheduler.LoopEndAtLimit}, nil
	}
	if observation.ProcessedEvents >= s.budget.MaxEvents {
		return scheduler.LoopDecision{Kind: scheduler.LoopStopNow, StopReason: model.StopReasonBudgetExceeded,
			BudgetCause: model.BudgetCauseMaxEvents, BudgetMessage: "event budget exceeded"}, nil
	}
	return scheduler.LoopDecision{Kind: scheduler.LoopHandleNext}, nil
}

func (s *Engine) LoopDecisionError(message string) *model.EngineError {
	return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (s *Engine) LoopStopState() scheduler.LoopStopState {
	return scheduler.LoopStopState{
		SourceDead:  s.actions.Dead(model.SelectorSource) || s.combatantHasHp(model.SelectorSource) && s.combatantHp(model.SelectorSource) <= 0,
		TargetDead:  s.actions.Dead(model.SelectorTarget) || s.combatantHasHp(model.SelectorTarget) && s.combatantHp(model.SelectorTarget) <= 0,
		BudgetCause: s.budgetCause,
	}
}

func (s *Engine) SelectLoopEvent(event scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError) {
	var err *model.EngineError
	if s.compiled.Features.Has(planbundle.FeatureStateOnExpire) && event.Category != scheduler.GenericCategoryStateCooldownExpiry && s.currentStateOnExpire(event) {
		event, err = s.selectCombatBeforeStateOnExpire(event)
		if err != nil {
			return event, err
		}
	}
	if event.Kind == scheduler.GenericEventProcessTimer && s.effectTimers.HasTerminals() {
		event, err = s.selectAnchoredTerminalBeforeProcessTimer(event)
	}
	return event, err
}

// 两条既有同刻规则共用取还流程，不在前瞻期间执行战斗或改变事件计数。
func (s *Engine) selectSameTimeEvent(first scheduler.GenericEvent, rule sameTimeSelectionRule) (scheduler.GenericEvent, bool) {
	held := []scheduler.GenericEvent{first}
	selected, found := first, false
	for {
		event, exists := s.loop.TakeAt(first.TimeMs)
		if !exists {
			break
		}
		matches := false
		switch rule {
		case sameTimeBeforeStateExpiry:
			matches = event.Kind != scheduler.GenericEventSample && !s.currentStateOnExpire(event)
		case sameTimeAnchoredTerminal:
			matches = s.currentAnchoredTerminal(event)
		}
		if matches {
			selected, found = event, true
			break
		}
		held = append(held, event)
		if rule == sameTimeAnchoredTerminal && event.Category > scheduler.GenericCategoryAnchoredTick {
			break
		}
	}
	if !found {
		held = held[1:]
		if rule == sameTimeAnchoredTerminal {
			// 所有旧终点已失效时仍在恢复之前清理计数，不改变原失败边界。
			s.effectTimers.ClearTerminal(first.TimeMs)
		}
	}
	return selected, s.restoreSameTimeCandidates(held)
}

func (s *Engine) restoreSameTimeCandidates(events []scheduler.GenericEvent) bool {
	for _, event := range events {
		if s.loop.RestoreCandidate(event) != model.ErrOK {
			return false
		}
	}
	return true
}

func (s *Engine) HandleLoopEvent(event scheduler.GenericEvent) *model.EngineError {
	if s.hasSkillPlan() || s.currentStateOnExpire(event) || s.compiled.Features.Has(planbundle.FeatureTargetTiming) {
		s.currentEventCommands = 0
	}
	switch event.Kind {
	case scheduler.GenericEventSourceInitialized:
		return s.handleSourceInitialized(event)
	case scheduler.GenericEventProcessTimer:
		return s.handleProcessTimer(event)
	case scheduler.GenericEventAnchoredTick:
		return s.handleAnchoredTick(event)
	case scheduler.GenericEventExpireCleanup:
		s.handleExpireCleanup(event)
	case scheduler.GenericEventProviderTick:
		return s.handleProviderTick(event)
	case scheduler.GenericEventAbilityAttempt:
		return s.handleAbilityAttempt(event)
	case scheduler.GenericEventSkillAction:
		return s.handleSkillAction(event.SkillActionIndex)
	case scheduler.GenericEventAutomaticSkill:
		return s.handleAutomaticSkills(event)
	case scheduler.GenericEventTriggeredContinuation:
		return s.handleTriggeredContinuation(event)
	case scheduler.GenericEventBasicAttack:
		if s.basicAttackEventCurrent(event) {
			return s.handleBasicAttack()
		}
	case scheduler.GenericEventAmmoRecovery:
		return s.handleAmmoRecovery(event)
	case scheduler.GenericEventAmmoAdmission:
		return s.initializeDrivenAmmo()
	}
	return nil
}

func (s *Engine) ObserveBefore(at int64) { s.flushSamplesBefore(at) }

func (s *Engine) ObserveThrough(at int64) { s.flushSamplesThrough(at) }

func (s *Engine) ObserveFinal() { s.appendFinalSample() }

func (s *Engine) PublishLoopWait() { s.publishBasicAttackWait() }

func (s *Engine) SettleLoopEnd() *model.EngineError {
	if s.compiled.Features.Has(planbundle.FeatureResourceMax) {
		s.settleLiveResourceExpiry()
		if s.processFailure != nil && s.processFailure.BudgetCause == "" {
			return s.processFailure
		}
	}
	return nil
}

func (s *Engine) LoopBudgetExceeded(cause model.BudgetCause, message string) {
	s.budgetError(cause, message)
}

func (s *Engine) EnsureLoopBudgetCause() {
	if s.budgetCause == "" {
		s.budgetCause = model.BudgetCauseMaxEvents
	}
}
