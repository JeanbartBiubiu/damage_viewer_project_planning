// 单次执行协调：组合私有子系统状态，借用根入口的唯一运行循环。
package execution

import (
	"encoding/json"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
	"tinygo_engine_v2/internal/runtime/execution/hit"
	listenerpkg "tinygo_engine_v2/internal/runtime/execution/listener"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
	"tinygo_engine_v2/internal/scheduler"
)

// EngineAPI 定义单次执行协调的公开能力，调度仍借用根入口创建的唯一循环。
type EngineAPI interface {
	// LoopState 返回当前驱动资格、失败与事件预算所需的已提交事实。
	LoopState() scheduler.LoopState
	// LoopStopState 返回死亡与预算事实，由唯一循环核定停止原因。
	LoopStopState() scheduler.LoopStopState
	// SelectLoopEvent 保留状态到期、锚定终点与过程计时之间的同刻特殊顺序。
	SelectLoopEvent(event scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError)
	// HandleLoopEvent 将已接纳的事件分派到既有门禁、执行帧及提交路径。
	HandleLoopEvent(event scheduler.GenericEvent) *model.EngineError
	// ObserveBefore 补齐指定时刻之前的采样，只观察已提交数值。
	ObserveBefore(at int64)
	// ObserveThrough 补齐截至指定时刻的采样，只观察已提交数值。
	ObserveThrough(at int64)
	// ObserveFinal 按现有采样规则补记最终观察点。
	ObserveFinal()
	// PublishLoopWait 将当前普攻等待投影写回行动状态，不建立独立时钟。
	PublishLoopWait()
	// SettleLoopEnd 结算结束时仍需处理的资源上限到期，并返回实际执行失败。
	SettleLoopEnd() *model.EngineError
	// LoopBudgetExceeded 保存预算原因及既有错误事实。
	LoopBudgetExceeded(cause model.BudgetCause, message string)
	// EnsureLoopBudgetCause 在尚无预算原因时补记事件数预算。
	EnsureLoopBudgetCause()
	// Finish 在唯一循环结束后刷新既有末态并转移报告容器；失败时返回执行错误。
	Finish() (model.DoneResult, *model.EngineError)
}

// Engine 私有组合各子系统状态，拥有执行因果及统一提交协调。
type Engine struct {
	report                     reportpkg.State
	nextHealthOrder            uint64
	abilityTypeKeyCache        map[typeset.TypeSet][]string
	evaluation                 evaluation.State
	providerDefinitionFields   effectpkg.DefinitionCache
	actions                    actionpkg.State
	processFailure             *model.EngineError
	processExecutions          processExecutionStack
	settlingProcessDeaths      bool
	compiled                   planbundle.CompiledSession
	formulas                   formula.GenericRegistry
	req                        model.RunRequest
	loop                       *scheduler.Loop
	conditionRecheckIntervalMs int64

	combatants map[string]combatantRuntime

	budget                    model.SafetyBudget
	currentEventCommands      int
	initializationEventActive bool
	initializationPending     int
	budgetCause               model.BudgetCause

	abilityCastCount int

	nextFrameID  uint64
	nextDamageID uint64

	effectTimers     effectpkg.TimeState
	effectIdentities effectpkg.IdentityRegistry

	// Cast-instance identity (Focused Will / per-cast throttle). Monotonic from 1; discarded after run.
	nextCastInstanceID uint64
	listeners          listenerpkg.State

	// Delayed repeat continuations (run-local; discarded with the run).
	continuations      map[uint64]*triggeredContinuationPayload
	nextContinuationID uint64

	hits                hit.State
	skillUses           map[string]*skillUseRuntime
	attackStartFacts    map[string]model.AttackStartFact
	useTriggerLedger    map[useTriggerKey]*useTriggerRecord
	useTriggerReserving int
}

var _ EngineAPI = (*Engine)(nil)

func (s *Engine) Finish() (model.DoneResult, *model.EngineError) {
	if s.compiled.HasProviderElapsedReads && s.budgetCause == "" {
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
func New(compiled planbundle.CompiledSession, req model.RunRequest, loop *scheduler.Loop) (*Engine, *model.EngineError) {
	if compiled.HasImmediatePeriodic || compiled.HasTotalCooldownRefund {
		if err := validateImmediatePeriodicRefundFreshSnapshot(compiled, req); err != nil {
			return nil, err
		}
	}
	// TinyGo在函数入口为错误闭包捕获的参数分配；特性门须放在调用点。
	if compiled.HasReceivedShieldReads {
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

	formulas := *compiled.Formulas.CloneForRun()
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
		continuations:              make(map[uint64]*triggeredContinuationPayload),
	}
	if err := state.initResourceMaxState(); err != nil {
		return nil, err
	}
	if err := validateFixedEquipmentHealth(compiled, state.combatants, req.SessionID); err != nil {
		return nil, err
	}

	state.loop.Queue().SetLimit(compiled.Settings.MaxQueueEvents)
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
	if err := state.initBasicAttack(); err != nil {
		return nil, err
	}
	if err := state.initIncomingCappedFlatSources(); err != nil {
		return nil, err
	}
	if compiled.HasPermanentCharacterPeriod {
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
	if compiled.HasResourceMax {
		for key, c := range state.combatants {

			c.setAttributes(syncHPResolved(c.attributesView()))
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
