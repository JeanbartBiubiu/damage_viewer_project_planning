// 单次执行协调：组合私有子系统状态，借用根入口的唯一运行循环。
package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"encoding/json"
	"math"
	"strconv"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
	"tinygo_engine_v2/internal/scheduler"
)

const (
	defaultConditionRecheckMs = 100
	minConditionRecheckMs     = 10
	maxConditionRecheckMs     = 1000
)

type combatantRuntime struct {
	instances effectpkg.InstanceState
	numbers   actor.State

	cooldowns *actionpkg.CooldownLedger

	providerState effectpkg.BagState
}

// 实例列表可供帧读取；State与StatusContributions在列表内始终只读。

type damageRecord struct {
	timeMs    int64
	sourceKey string
	targetKey string
	amount    float64
}

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
	attributeMemos             [2][3]*attributeMemo
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
	nextCastInstanceID            uint64
	perCastThrottle               map[perCastThrottleKey]int64
	perCastThrottleCapacity       int
	perCastThrottleOverflowWarned bool
	perCastThrottleOverflowCount  int

	// Delayed repeat continuations (run-local; discarded with the run).
	continuations      map[uint64]*triggeredContinuationPayload
	nextContinuationID uint64

	skillUses               map[string]*skillUseRuntime
	skillHitFacts           map[string]model.SkillHitFact
	skillHitGroups          map[string]*skillHitGroup
	skillHitLedger          map[string]*frozenSkillHitContext
	skillHitOccurrenceCount uint64
	runtimeListeners        []planbundle.CompiledListener
	attackStartFacts        map[string]model.AttackStartFact
	useTriggerLedger        map[useTriggerKey]*useTriggerRecord
	useTriggerReserving     int
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
		perCastThrottle:            make(map[perCastThrottleKey]int64),
		perCastThrottleCapacity:    perCastThrottleCapacity(budget.MaxEvents),
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

func (s *Engine) compileDriverConditions() *model.EngineError {
	n := len(s.req.DriverPlan.Entries)
	s.actions.InitDriverEntries(n)
	var compileErrors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		err := model.NewEngineError(model.GenericPhaseRun, code, message)
		err.Path = path
		err.Ref = ref
		err.SchemaHash = s.compiled.SchemaHash
		err.RulesHash = s.compiled.RulesHash
		err.SessionID = s.req.SessionID
		compileErrors = append(compileErrors, err)
	}
	for i, entry := range s.req.DriverPlan.Entries {
		refs := s.formulas.DeclaredReferences()
		skill := ""
		source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
		target, _ := s.resolveDriverCombatantKey(entry.Target, source)
		if ref, ok := s.compiled.AbilityRefIndex[normalizeAbilityRef(entry.AbilityRef, source, target)]; ok {
			skill = s.compiled.Abilities[ref.AbilityIndex].SkillKey
		}
		if entry.Condition != nil {
			path := "driverPlan.entries[" + entry.EntryKey + "].condition"
			instr := formula.CompileGenericFormula(*entry.Condition, path, refs, map[string]bool{}, addError)
			if !s.formulas.ValidDeclaredScope(instr, skill) {
				addError(model.GenericErrUnknownRef, path, "driver common formula requires its actual ability skill", entry.AbilityRef)
				continue
			}
			for _, in := range s.formulas.InstructionDependencies(instr, nil) {
				if in.ReadKind == formula.ReadEventProviderTargetStateBefore {
					addError(model.GenericErrFormulaTypeError, path, "damage state before is unavailable in driver conditions", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProviderTargetStateRemainingMs {
					addError(model.GenericErrFormulaTypeError, path, "target state remaining time is unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadReceivedLinkedShieldAbsorbed {
					addError(model.GenericErrFormulaTypeError, path, "linked shield absorption is unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadAuthoredRuntimeParameter || in.ReadKind == formula.ReadAuthoredAbilityParameter || in.ReadKind == formula.ReadUseChargeDuration || in.ReadKind == formula.ReadProcessStartState {
					addError(model.GenericErrFormulaTypeError, path, "runtime parameters unavailable in driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProcessActualCost {
					addError(model.GenericErrFormulaTypeError, path, "process actual costs are unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadUseAmmoBefore {
					addError(model.GenericErrFormulaTypeError, path, "use.ammo.before is unavailable before native attack admission", "use.ammo.before")
				}
			}
			if len(instr) > 0 {
				key := "run:" + path
				id, err := s.formulas.Register(formula.GenericProgram{Key: key, Instr: instr})
				if err != nil {
					addError(model.GenericErrFormulaTypeError, path, err.Error(), key)
				} else {
					s.actions.SetDriverCondition(i, id)
				}
			}
		}
		if entry.Repeat == nil {
			continue
		}
		repeatPath := "driverPlan.entries[" + entry.EntryKey + "].repeat"
		hasFixed := entry.Repeat.IntervalMs > 0
		hasFormula := entry.Repeat.IntervalFormula != nil
		switch {
		case hasFixed && hasFormula:
			addError(model.GenericErrFormulaTypeError, repeatPath, "repeat must have exactly one of intervalMs or intervalFormula", entry.AbilityRef)
		case !hasFixed && !hasFormula:
			addError(model.GenericErrMissingRequiredField, repeatPath, "repeat requires intervalMs or intervalFormula", entry.AbilityRef)
		case hasFormula:
			path := repeatPath + ".intervalFormula"
			instr := formula.CompileGenericFormula(*entry.Repeat.IntervalFormula, path, refs, map[string]bool{}, addError)
			if !s.formulas.ValidDeclaredScope(instr, skill) {
				addError(model.GenericErrUnknownRef, path, "driver common formula requires its actual ability skill", entry.AbilityRef)
				continue
			}
			for _, in := range s.formulas.InstructionDependencies(instr, nil) {
				if in.ReadKind == formula.ReadEventProviderTargetStateBefore {
					addError(model.GenericErrFormulaTypeError, path, "damage state before is unavailable in driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProviderTargetStateRemainingMs {
					addError(model.GenericErrFormulaTypeError, path, "target state remaining time is unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadReceivedLinkedShieldAbsorbed {
					addError(model.GenericErrFormulaTypeError, path, "linked shield absorption is unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadAuthoredRuntimeParameter || in.ReadKind == formula.ReadAuthoredAbilityParameter || in.ReadKind == formula.ReadUseChargeDuration || in.ReadKind == formula.ReadProcessStartState {
					addError(model.GenericErrFormulaTypeError, path, "runtime parameters unavailable in driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProcessActualCost {
					addError(model.GenericErrFormulaTypeError, path, "process actual costs are unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadUseAmmoBefore {
					addError(model.GenericErrFormulaTypeError, path, "use.ammo.before is unavailable in a driver repeat", "use.ammo.before")
				}
			}
			if len(instr) == 0 {
				continue
			}
			key := "run:" + path
			id, err := s.formulas.Register(formula.GenericProgram{Key: key, Instr: instr})
			if err != nil {
				addError(model.GenericErrFormulaTypeError, path, err.Error(), key)
			} else {
				s.actions.SetDriverInterval(i, id)
			}
		}
	}
	if len(compileErrors) > 0 {
		return &compileErrors[0]
	}
	return nil
}

func normalizeConditionRecheckInterval(raw int64) int64 {
	if raw <= 0 {
		return defaultConditionRecheckMs
	}
	if raw < minConditionRecheckMs {
		return minConditionRecheckMs
	}
	if raw > maxConditionRecheckMs {
		return maxConditionRecheckMs
	}
	return raw
}

func materializeCombatants(snapshot model.Snapshot, compiled planbundle.CompiledSession, formulas formula.GenericRegistry, sessionID string) (map[string]combatantRuntime, *model.EngineError) {
	if err := validateShieldLifecycleSnapshot(snapshot, compiled, sessionID); err != nil {
		return nil, err
	}
	if err := validateProviderElapsedSnapshot(snapshot, compiled, sessionID); err != nil {
		return nil, err
	}
	out := make(map[string]combatantRuntime, len(snapshot.Combatants))
	layout := compiled.AttributeLayout
	var additional []string
	for _, c := range snapshot.Combatants {
		for key := range c.Attributes {
			additional = append(additional, key)
		}
	}
	if layout == nil {
		layout = attribute.NewLayout(additional)
	} else {
		layout = layout.Extend(additional)
	}
	combatantKeys := make(map[string]bool, len(snapshot.Combatants))
	for _, c := range snapshot.Combatants {
		combatantKeys[c.Key] = true
	}
	for i, c := range snapshot.Combatants {
		attrs := c.Attributes
		resources := c.Resources
		if resources == nil {
			resources = map[string]model.ResourceSlotDef{}
		}
		path := "initialSnapshot.combatants[" + itoa(uint32(i)) + "]"
		providers, resolver, err := materializeProviders(c.Providers, c.Key, compiled, combatantKeys, path, compiled.SchemaHash, compiled.RulesHash, sessionID)
		if err != nil {
			return nil, err
		}
		shields := materializeShields(c.Shields, c.Key)
		out[c.Key] = combatantRuntime{
			instances:     effectpkg.NewInstances(providers, shields, resolver, effectpkg.DamageResolver{}, effectpkg.ResourceContributions{}),
			numbers:       actor.New(c.Key, attribute.FromMap(attrs, layout), resources),
			cooldowns:     materializeCooldowns(c.Cooldowns, c.Key),
			providerState: effectpkg.RestoreBags(c.ProviderState),
		}
	}

	remountAllProviderModifiers(out, compiled)
	for key, c := range out {
		resolver := c.instances.Attributes()
		damageResolver := c.instances.Damage()
		mountRuleModifiers(&resolver, &damageResolver, key, compiled)
		c.instances.SetAttributes(resolver)
		c.instances.SetDamage(damageResolver)
		out[key] = c
	}
	// Resolve with same-combatant eval first, then cross-combatant context.
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: c.attributesView(),
			TargetAttrs: c.attributesView(),
		}
		resolvedAttributes, resolveErr := c.instances.Attributes().ResolveAttributesWithProviderContext(
			c.attributesView(), evalCtx, formulas,
			materializedProviderFormulaContext(out, compiled, key, "", snapshot.TimeMs),
		)
		c.setAttributes(resolvedAttributes)

		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		out[key] = c
	}
	// Re-resolve with cross-combatant eval context after both sides exist.
	sourceAttrs := attribute.Table{}
	targetAttrs := attribute.Table{}
	if src, ok := out[model.SelectorSource]; ok {
		sourceAttrs = src.attributesView()
	}
	if tgt, ok := out[model.SelectorTarget]; ok {
		targetAttrs = tgt.attributesView()
	}
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: sourceAttrs,
			TargetAttrs: targetAttrs,
		}
		// Same-combatant cast-proxy default remains target (historical materialize semantics).
		castProxy := model.SelectorTarget
		resolvedAttributes, resolveErr := c.instances.Attributes().ResolveAttributesWithProviderContext(
			c.attributesView(), evalCtx, formulas,
			materializedProviderFormulaContext(out, compiled, key, castProxy, snapshot.TimeMs),
		)
		c.setAttributes(resolvedAttributes)

		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		out[key] = c
	}
	for _, key := range []string{"source", "target"} {
		actor, exists := out[key]
		if !exists {
			continue
		}
		var providerContext pipeline.ProviderFormulaContextFunc
		if compiled.HasProviderElapsedReads || compiled.HasFiniteModifierExpiry {
			providerContext = materializedProviderFormulaContext(out, compiled, key, model.SelectorTarget, snapshot.TimeMs)
		}
		resolved, resolveErr := resolveDerivedAttributes(compiled, formulas, key, actor.attributesView(), actor.instances.Attributes(), out["source"].attributesView(), out["target"].attributesView(), providerContext)
		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}

		actor.setAttributes(resolved)
		out[key] = actor
	}
	return out, nil
}

func mountRuleModifiers(resolver *effectpkg.AttributeResolver, damageResolver *effectpkg.DamageResolver, combatantKey string, compiled planbundle.CompiledSession) {
	for _, mod := range compiled.RuleModifiers {
		if mod.Kind == "pipeline" {
			mountRulePipelineModifier(damageResolver, combatantKey, mod)
			continue
		}
		if mod.Kind != "attribute" && mod.Kind != "" {
			continue
		}
		selector := pipeline.ModifierTargetCombatantSelector(mod.Target)
		switch selector {
		case "":
			// Bare attribute key: apply to both combatants is too broad; skip unless path is explicit.
			// Provider-mounted bare keys remain supported via MountProviderModifiers.
			continue
		case model.SelectorSource:
			if combatantKey != model.SelectorSource {
				continue
			}
		case model.SelectorTarget:
			if combatantKey != model.SelectorTarget {
				continue
			}
		case model.SelectorSelf, model.SelectorOpponent:
			// Rule-level self/opponent has no entry context; treat as source/target aliases.
			if selector == model.SelectorSelf && combatantKey != model.SelectorSource {
				continue
			}
			if selector == model.SelectorOpponent && combatantKey != model.SelectorTarget {
				continue
			}
		default:
			if combatantKey != selector {
				continue
			}
		}
		resolver.MountCompiledModifier("rules", mod)
	}
}

// mountRulePipelineModifier mounts rules pipeline modifiers by stage ownership:
// command=crit + outgoing_pre_mitigation → source;
// incoming_crit_part_post_mitigation + incoming_post_mitigation → target.
func mountRulePipelineModifier(damageResolver *effectpkg.DamageResolver, combatantKey string, mod planbundle.CompiledModifier) {
	if damageResolver == nil {
		return
	}
	switch mod.Command {
	case "crit":
		switch mod.Stage {
		case "crit_chance_pre_settlement", "crit_multiplier_forced_branch", "crit_multiplier_natural_branch":
			if combatantKey != model.SelectorSource {
				return
			}
		default:
			return
		}
	case "damage":
		switch mod.Stage {
		case "outgoing_pre_mitigation":
			if combatantKey != model.SelectorSource {
				return
			}
		case "incoming_crit_part_post_mitigation", "incoming_post_mitigation":
			if combatantKey != model.SelectorTarget {
				return
			}
		default:
			return
		}
	case "heal":
	default:
		return
	}
	damageResolver.MountCompiledModifierOwned("", "rules", mod)
}

func cloneAttributeMap(src map[string]model.AttributeSlotDef) map[string]model.AttributeSlotDef {
	dst := make(map[string]model.AttributeSlotDef, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func cloneResourceMap(src map[string]model.ResourceSlotDef) map[string]model.ResourceSlotDef {
	dst := make(map[string]model.ResourceSlotDef, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
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

func (s *Engine) seedDriverAttempts() {
	for i, entry := range s.req.DriverPlan.Entries {
		s.enqueueAttempt(entry.FirstAtMs, i, 0)
		// Fixed interval: pre-schedule future attempts. Dynamic (intervalFormula): seed first only.
		if entry.Repeat != nil && entry.Repeat.IntervalMs > 0 {
			maxAttempts := entry.Repeat.MaxAttempts
			if maxAttempts <= 0 {
				maxAttempts = s.estimateRepeatAttempts(entry)
			}
			for n := 1; n < maxAttempts; n++ {
				at := entry.FirstAtMs + int64(n)*entry.Repeat.IntervalMs
				if at > s.loop.StartMs()+s.loop.DurationMs() {
					break
				}
				s.enqueueAttempt(at, i, n)
			}
		}
	}
}

func (s *Engine) estimateRepeatAttempts(entry model.DriverEntry) int {
	if entry.Repeat == nil || entry.Repeat.IntervalMs <= 0 {
		return 1
	}
	span := s.loop.DurationMs()
	if span <= 0 {
		return 1
	}
	firstOffset := entry.FirstAtMs - s.loop.StartMs()
	if firstOffset < 0 {
		firstOffset = 0
	}
	remaining := span - firstOffset
	if remaining < 0 {
		return 1
	}
	count := int(remaining/entry.Repeat.IntervalMs) + 1
	if count > s.budget.MaxEvents {
		count = s.budget.MaxEvents
	}
	return count
}

func (s *Engine) enqueueAttempt(timeMs int64, entryIndex, attemptIndex int) {
	entry := s.req.DriverPlan.Entries[entryIndex]
	s.pushCombatEvent(scheduler.GenericEvent{
		TimeMs:           timeMs,
		Category:         scheduler.GenericCategoryAbilityAttempt,
		Priority:         int16(entry.Priority),
		Kind:             scheduler.GenericEventAbilityAttempt,
		DriverEntryIndex: entryIndex,
		AttemptIndex:     attemptIndex,
	})
}

func (s *Engine) setStopReason(reason model.StopReason) { s.loop.Stop(reason) }
func (s *Engine) finalizeStopReason()                   { s.loop.Finalize(s.LoopStopState()) }

func (s *Engine) handleAbilityAttempt(ev scheduler.GenericEvent) *model.EngineError {
	entry := s.req.DriverPlan.Entries[ev.DriverEntryIndex]
	waitOwner, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	waitTarget, _ := s.resolveDriverCombatantKey(entry.Target, waitOwner)
	waitOwner = actionpkg.AbilityCooldownOwner(waitOwner, normalizeAbilityRef(entry.AbilityRef, waitOwner, waitTarget))
	waitKey := whileReadyCooldownWaitKey(waitOwner, entry.EntryKey)
	if ev.CooldownWaitVersion != 0 {
		c := s.combatants[waitOwner]
		if !c.cooldowns.WaitCurrent(waitKey, ev.TimeMs, ev.CooldownWaitVersion) {
			return nil
		}
	}
	if s.isWhileReady(entry) {
		c := s.combatants[waitOwner]
		c.cooldowns = c.cooldowns.Clone()
		c.cooldowns.CancelWait(waitKey)
		s.combatants[waitOwner] = c
	}
	if !isNativeHitFollowUp(entry.EntryKey) {
		s.actions.RecordDriverAttempt(ev.DriverEntryIndex)
	}

	sourceKey, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, _ := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	statRef := normalizeAbilityRef(entry.AbilityRef, sourceKey, targetKey)
	s.report.EnsureAbility(statRef)
	if !isNativeHitFollowUp(entry.EntryKey) {
		s.report.Attempt(statRef)
	}

	if ability, _, ok := s.lookupDriverAbility(entry); ok && ability.ProcessControl != nil {
		return s.handleProcessCommand(entry, ev.DriverEntryIndex, ability, statRef)
	}
	gate := s.checkAttemptGate(entry, ev.DriverEntryIndex)
	if gate.err != nil {
		return gate.err
	}
	if gate.skipped {
		s.report.Skip(statRef)
		s.recordAttemptSkipped(entry, gate.reason, gate.readyAtMs)
		if s.isWhileReady(entry) {
			nextAt := s.nextWhileReadyTime(entry, gate)
			if nextAt > s.loop.TimeMs() {
				if gate.reason == model.AttemptSkipCooldownNotReady {
					s.enqueueCooldownAttempt(nextAt, ev.DriverEntryIndex, ev.AttemptIndex+1, actionpkg.AbilityCooldownOwner(sourceKey, statRef), statRef)
				} else {
					s.enqueueAttempt(nextAt, ev.DriverEntryIndex, ev.AttemptIndex+1)
				}
			}
			// whileReady owns reschedule; do not also schedule dynamic interval.
			return nil
		}
		return s.scheduleDynamicRepeatNext(entry, ev.DriverEntryIndex, ev.AttemptIndex)
	}
	if err := s.executeAbilityCast(entry); err != nil {
		return err
	}
	return s.scheduleDynamicRepeatNext(entry, ev.DriverEntryIndex, ev.AttemptIndex)
}

// scheduleDynamicRepeatNext 在 dynamic DriverRepeat 每次 attempt 处理后按最新 attrs/resources 排下一发。
func (s *Engine) scheduleDynamicRepeatNext(entry model.DriverEntry, entryIndex, attemptIndex int) *model.EngineError {
	if entry.Repeat == nil || entry.Repeat.IntervalFormula == nil {
		return nil
	}
	programID, present := s.actions.DriverInterval(entryIndex)
	if !present {
		return nil
	}
	nextAttempt := attemptIndex + 1
	if entry.Repeat.MaxAttempts > 0 && nextAttempt >= entry.Repeat.MaxAttempts {
		return nil
	}

	sourceKey, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, _ := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	src := s.combatants[sourceKey]
	tgt := s.combatants[targetKey]
	evalCtx := formula.GenericEvalContext{
		SourceAttrs:     src.attributesView(),
		TargetAttrs:     tgt.attributesView(),
		SourceResources: src.resourceView(),
		TargetResources: tgt.resourceView(),
	}
	path := "driverPlan.entries[" + entry.EntryKey + "].repeat.intervalFormula"
	raw, evalErr := s.formulas.EvalContext(programID, &evalCtx)
	if evalErr != nil {
		return s.evalFormulaError(programID, evalErr, entry.AbilityRef)
	}
	if math.IsNaN(raw) || math.IsInf(raw, 0) || raw <= 0 {
		err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "intervalFormula must evaluate to a finite value > 0")
		err.Path = path
		err.Ref = entry.AbilityRef
		err.SchemaHash = s.compiled.SchemaHash
		err.RulesHash = s.compiled.RulesHash
		err.SessionID = s.req.SessionID
		return &err
	}
	intervalMs := int64(math.Round(raw))
	if intervalMs < 1 {
		intervalMs = 1
	}
	nextAt := s.loop.TimeMs() + intervalMs
	if nextAt > s.loop.StartMs()+s.loop.DurationMs() {
		return nil
	}
	s.enqueueAttempt(nextAt, entryIndex, nextAttempt)
	return nil
}

func (s *Engine) isWhileReady(entry model.DriverEntry) bool {
	switch v := entry.WhileReady.(type) {
	case bool:
		return v
	case nil:
		return false
	default:
		return true
	}
}

func (s *Engine) recordAttemptSkipped(entry model.DriverEntry, reason model.AttemptSkipReason, readyAtMs int64) {
	s.recordEvidenceLazy(model.EvidenceKindAttemptSkipped, func() model.EvidenceItem {
		data := map[string]interface{}{
			"entryKey":   entry.EntryKey,
			"source":     entry.Source,
			"target":     entry.Target,
			"skipReason": string(reason),
		}
		if readyAtMs > 0 {
			data["readyAtMs"] = readyAtMs
		}
		return model.EvidenceItem{
			TimeMs:  s.loop.TimeMs(),
			Kind:    model.EvidenceKindAttemptSkipped,
			Ref:     entry.AbilityRef,
			Path:    "driverPlan.entries[" + entry.EntryKey + "]",
			Message: string(reason),
			Data:    data,
		}
	})
}

func (s *Engine) recordEvidence(item model.EvidenceItem) {
	s.report.RecordEvidence(item, s.detailedOutput(), s.budget.MaxEvidenceItems)
}

func (s *Engine) handleSample() { s.report.AppendSample(s.buildSeriesPoint(s.loop.TimeMs())) }

func (s *Engine) buildSeriesPoint(timeMs int64) model.SeriesPoint {
	if s.compiled.HasResourceMax && timeMs == s.loop.TimeMs() {
		s.settleLiveResourceExpiry()
	}
	return s.report.SeriesPoint(timeMs, s.combatantHp(model.SelectorSource), s.combatantHp(model.SelectorTarget))
}

func (s *Engine) buildDoneResult(final bool) model.DoneResult {
	s.refreshActionContributions()
	finalSnapshot := s.buildFinalSnapshot()
	if s.processFailure != nil {
		return model.DoneResult{}
	}

	rawSeriesCount := s.report.SeriesCount()
	sampling := s.report.Sampling()
	effectiveSampleEveryMs := s.report.EffectiveSampleEveryMs()
	totals := s.report.Totals()
	series, downsampled := s.report.FinalizeSeries(final)
	if series == nil {
		series = []model.SeriesPoint{}
	}
	droppedSeriesPoints := 0
	if downsampled && rawSeriesCount > len(series) {
		droppedSeriesPoints = rawSeriesCount - len(series)
	}

	abilityStats := s.report.AbilityStats()

	requestedPoints := 0
	method := "disabled"
	if !sampling.Disabled {
		method = "uniform_time"
		span := s.loop.TimeMs() - s.loop.StartMs()
		requestedPoints = int(span/int64(sampling.SampleEveryMs)) + 1
		if span%int64(sampling.SampleEveryMs) != 0 {
			requestedPoints++
		}
		downsampled = effectiveSampleEveryMs > int64(sampling.SampleEveryMs)
		droppedSeriesPoints = requestedPoints - len(series)
	}
	var basicSummary *model.BasicAttackSummary
	var sourceVampHealing, targetVampHealing *float64
	var actionSummary *model.SkillActionSummary
	var useSummary *model.SkillUseSummary
	var sourceDirectHealing, targetDirectHealing *float64
	if s.actions.ManualCount() > 0 {
		actions, uses := s.skillSummaries()
		actionSummary, useSummary = &actions, &uses
	}
	automaticSummary, automaticRecords, automaticRecording, automaticUses := s.automaticSkillResults()
	if automaticUses != nil {
		useSummary = automaticUses
	}
	if s.automatedRun() {
		sourceDirectHealing, targetDirectHealing = &totals.SourceDirectHealing, &totals.TargetDirectHealing
		sourceVampHealing, targetVampHealing = &totals.SourceVampHealing, &totals.TargetVampHealing
	}
	if s.actions.BasicAttack() != nil {
		summary := s.actions.BasicAttack().Summary()
		basicSummary = &summary
		sourceVampHealing, targetVampHealing = &totals.SourceVampHealing, &totals.TargetVampHealing
	}

	s.appendTerminalEvidence(downsampled, requestedPoints, len(series))

	warnings, warningCount := s.buildWarnings(downsampled, droppedSeriesPoints)
	recording := s.recordingSummary()
	targetMarkSummary := s.targetMarkSummaryOutput()
	resourceChangeSummary := s.resourceSummaryOutput()
	var output reportpkg.Output
	if final {
		output = s.report.Finish()
	} else {
		output = s.report.Snapshot()
	}
	if automaticSummary != nil {
		automaticRecords = output.AutomaticRecords
	}
	var resourceRecords *[]model.ResourceChangeRecord
	if s.compiled.HasResourceMax {
		resourceRecords = &output.ResourceChangeRecords
	}

	return model.DoneResult{
		TargetMarkSummary:       targetMarkSummary,
		ResourceChangeRecords:   resourceRecords,
		ResourceChangeSummary:   resourceChangeSummary,
		AutomaticSkillSummary:   automaticSummary,
		AutomaticSkillRecords:   automaticRecords,
		AutomaticSkillRecording: automaticRecording,
		OutputMode:              s.resultOutputMode(),
		SkillActionRecords:      output.SkillActionRecords,
		SkillUseRecords:         output.SkillUseRecords,
		HealingRecords:          output.HealingRecords,
		OK:                      true,
		AttackRecords:           output.AttackRecords,
		DamageRecords:           output.DamageRecords,
		MechanicRecords:         output.MechanicRecords,
		Recording:               recording,
		Summary: model.RunSummary{
			SkillActions:        actionSummary,
			SkillUses:           useSummary,
			SourceDirectHealing: sourceDirectHealing,
			TargetDirectHealing: targetDirectHealing,
			BasicAttack:         basicSummary,
			Execution:           s.executionSummary(),
			SourceHpLoss:        totals.SourceHpLoss,
			TargetHpLoss:        totals.TargetHpLoss,
			SourceVampHealing:   sourceVampHealing,
			TargetVampHealing:   targetVampHealing,
			DamageBreakdown:     output.DamageBreakdown,
			DurationMs:          s.loop.TimeMs() - s.loop.StartMs(),
			StopReason:          s.loop.Reason(),
			SourceFinalHp:       s.combatantHp(model.SelectorSource),
			TargetFinalHp:       s.combatantHp(model.SelectorTarget),
			SourceDamageDealt:   totals.SourceDamageDealt,
			SourceDamageTaken:   totals.SourceDamageTaken,
			TargetDamageDealt:   totals.TargetDamageDealt,
			TargetDamageTaken:   totals.TargetDamageTaken,
			SourceOverheal:      totals.SourceOverheal,
			TargetOverheal:      totals.TargetOverheal,
			AbilityAttemptCount: totals.AbilityAttemptCount,
			AbilityCastCount:    s.abilityCastCount,
			AttemptSkippedCount: totals.AttemptSkippedCount,
			WarningCount:        warningCount,
			EvidenceTruncated:   output.Evidence.Truncated,
			SeriesDownsampled:   downsampled,
			AbilityStats:        abilityStats,
		},
		FinalSnapshot: finalSnapshot,
		Series:        series,
		Warnings:      warnings,
		Evidence:      output.Evidence,
		SeriesSamplingEvidence: model.SeriesSamplingEvidence{
			RequestedSampleEveryMs: sampling.SampleEveryMs,
			EffectiveSampleEveryMs: int(effectiveSampleEveryMs),
			RequestedPointCount:    requestedPoints,
			FinalPointCount:        len(series),
			MaxSeriesPoints:        sampling.MaxSeriesPoints,
			Downsampled:            downsampled,
			Method:                 method,
		},
	}
}

func (s *Engine) buildFinalSnapshot() model.Snapshot {
	snapshot := cloneSnapshot(s.req.InitialSnapshot)
	snapshot.TimeMs = s.loop.TimeMs()
	snapshot.SchemaHash = s.compiled.SchemaHash
	snapshot.RulesHash = s.compiled.RulesHash
	for i, c := range snapshot.Combatants {
		rt, ok := s.combatants[c.Key]
		if !ok {
			continue
		}
		snapshot.Combatants[i].Attributes = rt.attributesView().ToMap()
		snapshot.Combatants[i].Resources = rt.resourceView().ToMap()
		snapshot.Combatants[i].Cooldowns = cooldownsToSnapshot(rt.cooldowns, s.loop.TimeMs())
		snapshot.Combatants[i].Providers = providersToSnapshot(rt.instances.Providers())
		if err := s.observeMomentStatusContributions(rt.instances.Providers(), snapshot.Combatants[i].Providers); err != nil {
			s.processFailure = err
			return model.Snapshot{}
		}
		snapshot.Combatants[i].Shields = shieldsToSnapshot(rt.instances.Shields())
		snapshot.Combatants[i].ProviderState = rt.providerState.Snapshot(rt.cooldowns.View(), rt.numbers.Key(), s.loop.TimeMs())
		snapshot.Combatants[i].EffectiveStatuses = s.buildEffectiveStatuses(snapshot.Combatants[i].Providers)
		if snapshot.Combatants[i].EffectiveStatuses == nil {
			snapshot.Combatants[i].EffectiveStatuses = []model.EffectiveStatusSnapshot{}
		}
		if snapshot.Combatants[i].AbilityState == nil {
			snapshot.Combatants[i].AbilityState = map[string]interface{}{}
		}
		if snapshot.Combatants[i].ProviderState == nil {
			snapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		if snapshot.Combatants[i].Vars == nil {
			snapshot.Combatants[i].Vars = map[string]interface{}{}
		}
	}
	if !s.automatedRun() || s.budgetCause == "" {
		s.lazyExpireAllProviderState()
	}
	for i, c := range snapshot.Combatants {
		rt, ok := s.combatants[c.Key]
		if !ok {
			continue
		}
		snapshot.Combatants[i].ProviderState = rt.providerState.Snapshot(rt.cooldowns.View(), rt.numbers.Key(), s.loop.TimeMs())
	}
	snapshot.UseTriggerLedger = s.snapshotUseTriggerLedger()
	snapshot.ProcessInstances = s.snapshotProcesses()
	if snapshot.UseTriggerLedger == nil {
		snapshot.UseTriggerLedger = []model.UseTriggerLedgerEntry{}
	}
	return snapshot
}

func (s *Engine) appendTerminalEvidence(downsampled bool, requestedPoints, finalPointCount int) {
	if downsampled {
		s.recordEvidenceLazy(model.EvidenceKindDownsampled, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: s.loop.TimeMs(),
				Kind:   model.EvidenceKindDownsampled,
				Data: map[string]interface{}{
					"requestedPointCount": requestedPoints,
					"finalPointCount":     finalPointCount,
					"maxSeriesPoints":     s.report.Sampling().MaxSeriesPoints,
					"method":              "uniform_time",
				},
			}
		})
	}
	if s.loop.Reason() == model.StopReasonBudgetExceeded {
		s.recordEvidenceLazy(model.EvidenceKindBudgetExceeded, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: s.loop.TimeMs(),
				Kind:   model.EvidenceKindBudgetExceeded,
				Data: map[string]interface{}{
					"processedEvents": s.loop.ProcessedEvents(),
					"maxEvents":       s.budget.MaxEvents,
				},
			}
		})
	}
}

func (s *Engine) truncatedEvidenceKinds() []string {
	return s.report.TruncatedEvidenceKinds(s.detailedOutput())
}

func (s *Engine) buildWarnings(seriesDownsampled bool, droppedSeriesPoints int) ([]model.WarningItem, int) {
	var candidates []model.WarningItem
	if len(s.continuations) > 0 {
		pendingCopies := 0
		for _, payload := range s.continuations {
			if payload == nil {
				continue
			}
			times := payload.req.repeatCount
			if times <= 0 {
				times = 1
			}
			pendingCopies += times * len(payload.damages)
		}
		candidates = append(candidates, model.WarningItem{
			Code:     "pending_continuations_not_in_snapshot",
			Message:  "finalSnapshot omits " + strconv.Itoa(pendingCopies) + " pending delayed damage copies across " + strconv.Itoa(len(s.continuations)) + " continuations; restoring it will not replay them",
			Severity: model.WarningSeverityWarning,
			Refs:     []string{"finalSnapshot"},
			Count:    pendingCopies,
		})
	}

	if truncated, count := s.report.EvidenceTruncation(); truncated {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeEvidenceTruncated),
			Message:      "evidence items truncated by safety budget",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: s.truncatedEvidenceKinds(),
			Count:        count,
		})
	}
	if seriesDownsampled && droppedSeriesPoints > 0 {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeSeriesDownsampled),
			Message:      "series points downsampled by maxSeriesPoints",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: []string{string(model.EvidenceKindDownsampled)},
			Count:        droppedSeriesPoints,
		})
	}
	if s.loop.Reason() == model.StopReasonBudgetExceeded {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeBudgetExceeded),
			Message:      "run stopped because event budget was exceeded",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: []string{string(model.EvidenceKindBudgetExceeded)},
			Count:        1,
		})
	}
	if w := s.perCastThrottleOverflowWarning(); w != nil {
		candidates = append(candidates, *w)
	}

	totalProduced := len(candidates)
	maxWarnings := s.budget.MaxWarnings
	if maxWarnings <= 0 {
		maxWarnings = model.DefaultSafetyBudget().MaxWarnings
	}
	warnings := candidates
	if len(warnings) > maxWarnings {
		warnings = warnings[:maxWarnings]
	}
	if warnings == nil {
		warnings = []model.WarningItem{}
	}
	return warnings, totalProduced
}

func cooldownsToSnapshot(cooldowns *actionpkg.CooldownLedger, nowMs int64) map[string]interface{} {
	return cooldowns.Snapshot(nowMs)
}

func cloneSnapshot(src model.Snapshot) model.Snapshot {
	dst := src
	dst.Combatants = make([]model.CombatantSnapshot, len(src.Combatants))
	for i, c := range src.Combatants {
		dst.Combatants[i] = c
		if c.Attributes != nil {
			dst.Combatants[i].Attributes = cloneAttributeMap(c.Attributes)
		}
		if c.Resources != nil {
			dst.Combatants[i].Resources = cloneResourceMap(c.Resources)
		}
	}
	if src.UseTriggerLedger != nil {
		dst.UseTriggerLedger = append([]model.UseTriggerLedgerEntry(nil), src.UseTriggerLedger...)
	} else {
		dst.UseTriggerLedger = []model.UseTriggerLedgerEntry{}
	}
	return dst
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
