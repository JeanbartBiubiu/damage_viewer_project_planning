// 驱动、自动和手动行动接线，以及来源与冷却的同步读取。
package execution

import (
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	contractpkg "tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/scheduler"
)

type automaticChoiceBridge struct{ engine *Engine }

type manualActionBridge struct{ engine *Engine }

type skillAdmissionBridge struct{ engine *Engine }

type recastBridge struct{ engine *Engine }

type plannedSourceBridge struct{ engine *Engine }

type attemptGateBridge struct{ engine *Engine }

type driverAttemptBridge struct{ engine *Engine }

// abilityCastReads 只从原执行器指针借用当前施放的有限冷却与原生过程资格读取。
type abilityCastReads Engine

// abilityFrameBridge 直接借用本次原能力帧的有限工作能力，不另建接口适配对象。
type abilityFrameBridge Frame

type cooldownRefundBridge struct{ frame *Frame }

type gateConditionBridge struct {
	engine         *Engine
	source, target string
	ability        planbundle.CompiledAbility
	ref            string
}

type pendingCooldownAttempt = actionflow.CooldownAttempt

type gateCheckResult struct {
	err        *model.EngineError
	skipped    bool
	reason     model.AttemptSkipReason
	readyAtMs  int64
	ability    planbundle.CompiledAbility
	sourceKey  string
	hasAbility bool
}

type committedSkillActionHit struct {
	useRef        string
	occurrenceID  uint64
	evidenceIndex int
}

const (
	defaultConditionRecheckMs = 100
	minConditionRecheckMs     = 10
	maxConditionRecheckMs     = 1000
)

var _ actionflow.AutomaticCandidates = automaticChoiceBridge{}

var _ actionflow.ManualActionPhases = manualActionBridge{}

var _ actionflow.AutomaticReads = automaticChoiceBridge{}

var _ actionflow.SkillAdmissionChecks = skillAdmissionBridge{}

var _ actionflow.RecastReads = recastBridge{}

var _ actionflow.RecastPhases = recastBridge{}

var _ actionflow.PlannedSourceChecks = plannedSourceBridge{}

var _ actionflow.AutomaticDispatch = automaticChoiceBridge{}

var _ actionflow.GateReads = attemptGateBridge{}

var _ actionflow.GateFormulaErrors = attemptGateBridge{}

var _ actionflow.DriverAttemptPhases = driverAttemptBridge{}

var _ actionflow.DriverSchedules = driverAttemptBridge{}

var _ actionflow.AbilityCastReads = (*abilityCastReads)(nil)

var _ actionflow.AbilityFrameWork = (*abilityFrameBridge)(nil)

var _ actionflow.NativeProcessReads = (*abilityCastReads)(nil)

var _ actionflow.CooldownRefundWork = cooldownRefundBridge{}

var _ actionflow.GateConditions = gateConditionBridge{}

var _ actionflow.CooldownOperationWork = cooldownRefundBridge{}

func (s *Engine) executeAbilityCast(entry model.DriverEntry) *model.EngineError {
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
func (s *Engine) castAbilityAt(source, target, ref string, depth int, event *eventFormulaSnapshot, collector *eventCopyableCollector, entry string) *model.EngineError {
	prepared, err := s.skillActionFlowExecutor().PrepareCast(actionflow.AbilityCastRequest{Source: source, Target: target, AbilityRef: ref, EntryKey: entry}, actionflow.AbilityCastDefinitions{References: s.compiled.AbilityRefIndex, Combatants: s.compiled.Combatants, Operations: s.compiled.Operations}, (*abilityCastReads)(s))
	if err != nil || prepared.Kind == actionflow.AbilityCastSkipped {
		return err
	}
	if prepared.Kind == actionflow.AbilityCastNativeProcess {
		return s.startProcessFromEvent(source, target, prepared.Request.AbilityRef, prepared.Ability, depth, event, entry, collector)
	}
	return s.executePreparedAbility(prepared, depth, event, collector)
}

func (state *Engine) actionOccupied(owner string) bool { return state.actions.Occupied(owner) }

func (state *Engine) actionReadyAt(owner string) int64 {
	return state.actions.ReadyAt(owner, state.loop.TimeMs())
}

func (frame *Frame) prepareActionWait() *model.EngineError {
	if frame.pendingProcess == nil {
		return nil
	}
	changed, err := frame.run.processFlowExecutor().PrepareOccupancy(frame.processChanges, frame.processOriginal, frame.run.loop.TimeMs())
	frame.pendingActionWait = changed
	return err
}

func (state *Engine) actionContribution(start, end int64) *int64 {
	return state.basicAttackFlowExecutor().Contribution(start, end)
}

func (state *Engine) refreshActionContributions() {
	state.basicAttackFlowExecutor().RefreshContributions(state.loop.TimeMs(), basicAttackBridge{engine: state})
}

func (frame *Frame) validatePlannedProcessDeadline() *model.EngineError {
	ready := int64(0)
	if process := frame.pendingProcess; process != nil {
		if staged := frame.staged.Get(process.Owner()); staged != nil {
			ready = staged.cooldowns.AbilityReadyAt(process.Owner(), process.AbilityRef())
		}
	}
	return frame.run.skillActionFlowExecutor().ValidateDeadline(frame.pendingProcess, ready)
}

func (state *Engine) freezeActionDeaths() {
	if !state.automatedRun() {
		return
	}
	for _, owner := range []string{model.SelectorSource, model.SelectorTarget} {
		if state.combatantHasHp(owner) && state.combatantHp(owner) <= 0 {
			state.actions.MarkDead(owner)
		}
	}
}

func (s *Engine) plannedSkillProvider(owner, provider string) bool {
	return s.skillActionFlowExecutor().PlannedProvider(owner, provider)
}

func (s *Engine) plannedSkillOperation(index int) bool {
	return s.skillActionFlowExecutor().PlannedOperation(index)
}

func (s *Engine) validatePlannedSkillProvider(owner, provider string, index uint16) *model.EngineError {
	return s.skillActionFlowExecutor().ValidateSource(owner, provider, index, s.compiled.Listeners, s.compiled.Operations, s.compiled.RuntimeTypes.AbilityStarted, plannedSourceBridge{engine: s})
}

func (s *Engine) plannedAttributeOperationPosition(provider planbundle.CompiledProvider, index int) bool {
	return s.skillActionFlowExecutor().AttributeOperationPosition(provider, index, s.compiled.Operations)
}

func (state *Engine) plannedSkillBindings() []planbundle.CompiledSkillActionBinding {
	sources := state.skillActionFlowExecutor().PlannedSources()
	bindings := make([]planbundle.CompiledSkillActionBinding, len(sources))
	for index, source := range sources {
		bindings[index] = source.Binding()
	}
	return bindings
}

func (s *Engine) processFlowExecutor() actionflow.ProcessExecutor {
	return actionflow.NewProcessExecutor(&s.actions, actionflow.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID})
}

func (s *Engine) skillActionFlowExecutor() actionflow.SkillActionExecutor {
	return actionflow.NewSkillActionExecutor(&s.actions, s.compiled.Abilities, s.compiled.Providers, actionflow.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID})
}

func (s *Engine) basicAttackFlowExecutor() actionflow.BasicAttackExecutor {
	return actionflow.NewBasicAttackExecutor(&s.actions, actionflow.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID})
}

func (bridge cooldownRefundBridge) RefundCooldown(owner string) *actionpkg.CooldownLedger {
	return bridge.frame.stageFor(owner).cooldowns
}

func (bridge cooldownRefundBridge) StageCooldownRefund(owner, ref string, ready int64) *model.EngineError {
	return bridge.frame.applyCooldownChange(owner, ref, ready)
}

func (bridge cooldownRefundBridge) CooldownOwnerPresent(owner string) bool {
	return bridge.frame.run.combatantExists(owner)
}

func (bridge cooldownRefundBridge) CooldownAmount(program formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	return bridge.frame.evalAmount(program, ability)
}

func (bridge gateConditionBridge) DriverGateCondition(program formula.GenericProgramID) (float64, *model.EngineError) {
	s := bridge.engine
	source, target := s.combatants[bridge.source], s.combatants[bridge.target]
	context := formula.GenericEvalContext{StrictReads: s.automatedRun(), SourceAttrs: source.attributesView(), TargetAttrs: target.attributesView(), SourceResources: source.resourceView(), TargetResources: target.resourceView(), AbilityParams: bridge.ability.Params}
	value, err := s.formulas.EvalContext(program, &context)
	if err != nil {
		return 0, s.evalFormulaError(program, err, bridge.ref)
	}
	return value, nil
}

func (bridge gateConditionBridge) AbilityGateCondition() (bool, *model.EngineError) {
	return bridge.engine.castConditionBlocked(bridge.source, bridge.target, bridge.ability, bridge.ref)
}

func (bridge automaticChoiceBridge) EvaluateAutomatic(rule *actionpkg.AutomaticRuleView) (string, []string, int64, *model.EngineError) {
	return bridge.engine.automaticCandidate(rule)
}

func (bridge automaticChoiceBridge) ObserveAutomaticWait(rule *actionpkg.AutomaticRuleView, reason string, related []string, at int64) {
	bridge.engine.automaticWait(rule, reason, related, at)
}

func (bridge automaticChoiceBridge) RecastCandidate(rule *actionpkg.AutomaticRuleView, process *actionpkg.ProcessView) (string, []string, int64, *model.EngineError) {
	return bridge.engine.automaticRecastCandidate(rule, process)
}

func (bridge automaticChoiceBridge) CandidateMounted(owner, provider string, definition uint16) bool {
	return bridge.engine.processMounted(owner, provider, definition)
}

func (bridge automaticChoiceBridge) CandidateAmmo(rule *actionpkg.AutomaticRuleView, ability planbundle.CompiledAbility) (bool, int64, *model.EngineError) {
	var frame Frame
	bridge.engine.initExecutionFrame(&frame, model.SelectorSource, rule.Plan().Target(), rule.AbilityRef())
	frame.ownerCombatantKey, frame.ownerProviderRef = model.SelectorSource, rule.Binding().ProviderRef
	return frame.plannedAmmoReady(ability)
}

func (bridge automaticChoiceBridge) CandidateProcessChecks(rule *actionpkg.AutomaticRuleView, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess) (bool, bool, *model.EngineError) {
	s := bridge.engine
	s.refreshProviderAwareAttributes(model.SelectorSource, rule.Plan().Target())
	process := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: model.SelectorSource, ProviderRef: rule.Binding().ProviderRef, ProcessKey: definition.ProcessKey, SkillKey: definition.SkillKey, Target: rule.Plan().Target(), Status: "active"}, Definition: definition, Ability: ability, AbilityRef: rule.AbilityRef(), StepIndex: -1})
	var frame Frame
	s.initProcessFrame(&frame, process)
	allowed, err := s.evalProcessCondition(-1, &frame, ability)
	if err != nil || !allowed {
		return allowed, false, err
	}
	affordable, err := s.processFlowExecutor().PrepareCosts(frame.processChanges, processAmountBridge{frame: &frame}, false)
	return true, affordable, err
}

func (bridge automaticChoiceBridge) AutomaticActorsAlive() bool {
	return !(bridge.engine.combatantHp(model.SelectorSource) <= 0 || bridge.engine.combatantHp(model.SelectorTarget) <= 0)
}

func (bridge automaticChoiceBridge) PrepareAutomaticLedger() *actionpkg.CooldownLedger {
	owner := bridge.engine.combatants[model.SelectorSource]
	owner.cooldowns = owner.cooldowns.Clone()
	bridge.engine.combatants[model.SelectorSource] = owner
	return owner.cooldowns
}

func (bridge automaticChoiceBridge) RecordAutomaticAttempt(ref string) {
	bridge.engine.report.Attempt(ref)
}

func (bridge automaticChoiceBridge) ExecuteAutomaticControl(entry model.DriverEntry, ability planbundle.CompiledAbility, ref string) *model.EngineError {
	return bridge.engine.handleProcessCommand(entry, -1, ability, ref)
}

func (bridge automaticChoiceBridge) RecordAutomaticResult(record model.AutomaticSkillRecord) {
	bridge.engine.recordAutomatic(record)
}

func (bridge automaticChoiceBridge) QueueAutomaticCandidate(at int64, onlyMissing bool) {
	if !onlyMissing || !bridge.engine.loop.HasAutomaticSkill() {
		bridge.engine.queueAutomaticSkills(at)
	}
}

func (bridge manualActionBridge) BeginManualAttempt(action *actionpkg.SkillActionView) {
	bridge.engine.currentEventCommands = 0
	bridge.engine.report.Attempt(action.Plan().AbilityRef())
}

func (bridge manualActionBridge) ManualTargetAlive(target string) bool {
	return !(bridge.engine.combatantHp(target) <= 0)
}

func (bridge manualActionBridge) RunManualControl(entry model.DriverEntry, ability planbundle.CompiledAbility) *model.EngineError {
	return bridge.engine.handleProcessCommand(entry, -1, ability, entry.AbilityRef)
}

func (bridge manualActionBridge) FinishManualAttempt(err *model.EngineError) {
	bridge.engine.finishSkillActionAttempt(err)
}

func (s *Engine) processRestorePlan() actionflow.ProcessRestorePlan {
	return actionflow.ProcessRestorePlan{Combatants: s.compiled.Combatants, Providers: s.compiled.Providers, Abilities: s.compiled.Abilities, SkillActionBindings: s.compiled.SkillActionBindings}
}

func (s *Engine) skillAdmissionInput() actionflow.SkillAdmission {
	return actionflow.SkillAdmission{Manual: s.req.DriverPlan.SkillActions, Automatic: s.req.DriverPlan.AutomaticSkills, BasicAttack: s.req.DriverPlan.BasicAttack, Entries: s.req.DriverPlan.Entries,
		ExternalFacts: len(s.req.SkillUses) + len(s.req.SkillHitFacts) + len(s.req.AttackStartFacts) + len(s.req.ProcessCommandFacts),
		Snapshot:      s.req.InitialSnapshot, RecordBudget: s.req.RecordBudget, Start: s.loop.StartMs(), Duration: s.loop.DurationMs()}
}

func (bridge skillAdmissionBridge) InitSkillRecords(budget *model.RecordBudget) bool {
	return bridge.engine.report.InitSkillRecords(budget)
}

func (bridge skillAdmissionBridge) InitAutomaticRecords(budget *model.RecordBudget) bool {
	return bridge.engine.report.InitAutomaticRecords(budget)
}

func (bridge skillAdmissionBridge) ValidateInitialSkillSnapshot() *model.EngineError {
	return bridge.engine.validateBasicAttackInitialSnapshot()
}

func (bridge skillAdmissionBridge) ValidateSkillSource(owner, provider string, definition uint16) *model.EngineError {
	return bridge.engine.validatePlannedSkillProvider(owner, provider, definition)
}

func (bridge recastBridge) RecastMounted(owner, provider string, definition uint16) bool {
	return bridge.engine.processMounted(owner, provider, definition)
}

func (bridge recastBridge) RecastCondition(process *actionpkg.ProcessView, ability planbundle.CompiledAbility) (bool, *model.EngineError) {
	s := bridge.engine
	s.refreshProviderAwareAttributes(process.Owner(), process.Target())
	var frame Frame
	s.initProcessFrame(&frame, process)
	return s.evalProcessCondition(-1, &frame, ability)
}

func (bridge recastBridge) RejectRecast(entry model.DriverEntry, reason string) *model.EngineError {
	return bridge.engine.rejectProcess(entry, reason)
}

func (bridge recastBridge) RecastUseExists(use string) bool {
	return bridge.engine.skillUses[use] != nil
}

func (bridge recastBridge) CommitRecastAcceptance(process *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref, use string, advance int64) *model.EngineError {
	s := bridge.engine
	step := process.Definition().Steps[process.StepIndex()]
	var frame Frame
	s.initProcessFrame(&frame, process)
	staged := frame.pendingProcess
	frame.processChanges.AcceptRecast(advance, s.loop.TimeMs(), s.mintCastInstanceID(), use)
	frame.castInstanceID, frame.processUseKey, frame.processCastPhase = staged.CastID(), staged.CastUseKey(), "RECAST"
	frame.abilityRef, frame.castOrigin = ref, ability.CastOrigin
	frame.countCastOnCommit, frame.castStatRef, frame.processMomentKind = true, ref, "STEP_EXECUTION"
	frame.pendingProcessTimer = staged.StepExecutionIndex() < step.MaximumRecastCount
	frame.recordProcess(staged, "process_use", "RECAST")
	if err := s.commitProcessFrame(process, &frame); err != nil {
		return err
	}
	return frame.maybeDispatchAbilityStartedEvent(ability)
}

func (bridge recastBridge) CommitRecastExecution(process *actionpkg.ProcessView) *model.EngineError {
	s := bridge.engine
	var frame Frame
	s.initProcessFrame(&frame, process)
	frame.recastExecutionCommitted = true
	if err := s.applyProcessMoment(process, &frame, "STEP_EXECUTION", ""); err != nil {
		return err
	}
	frame.processMomentKind = ""
	if err := s.commitProcessFrame(process, &frame); err != nil {
		return err
	}
	return s.resolveSkillActionMoment(process, "STEP_EXECUTION")
}

func (bridge plannedSourceBridge) StaticSourceListener(listener planbundle.CompiledListener) *model.EngineError {
	return bridge.engine.validateStaticInitializationListener(listener)
}

func (bridge plannedSourceBridge) HitSourceListener(listener planbundle.CompiledListener) *model.EngineError {
	return bridge.engine.validateEquipmentHitListener(listener)
}

func (bridge plannedSourceBridge) PlannedAttributeSlot(selector, source, target, key string) (bool, bool) {
	owner, present := bridge.engine.resolveCombatantKey(selector, source, target)
	if !present {
		return false, false
	}
	_, slot := bridge.engine.combatants[owner].attributesView().Lookup(key)
	return true, slot
}

func (bridge attemptGateBridge) GateActor(selector, source string) (string, bool) {
	return bridge.engine.resolveDriverCombatantKey(selector, source)
}

func (bridge attemptGateBridge) GateAbility(ref string) (planbundle.CompiledAbility, bool) {
	value, present := bridge.engine.compiled.AbilityRefIndex[ref]
	if !present {
		return planbundle.CompiledAbility{}, false
	}
	return bridge.engine.compiled.Abilities[value.AbilityIndex], true
}

func (bridge attemptGateBridge) GateCooldown(owner, ref string) (int64, bool) {
	return bridge.engine.cooldownGate(owner, ref)
}

func (bridge attemptGateBridge) GateResource(source, target string, ability planbundle.CompiledAbility, ref string, entry model.DriverEntry) (int64, bool, *model.EngineError) {
	return bridge.engine.resourceGate(source, target, ability, ref, entry)
}

func (bridge attemptGateBridge) GateCondition(entry model.DriverEntry, index int, source, target string, ability planbundle.CompiledAbility, ref string) (bool, *model.EngineError) {
	return bridge.engine.conditionGate(entry, index, source, target, ability, ref)
}

func (bridge attemptGateBridge) GateEvaluationError(program formula.GenericProgramID, issue error, ref string) *model.EngineError {
	return bridge.engine.evalFormulaError(program, issue, ref)
}

func (bridge attemptGateBridge) GateAmountError(program formula.GenericProgramID, message, ref string) *model.EngineError {
	return bridge.engine.gateFormulaError(program, message, ref)
}

func (s *Engine) driverTiming() actionflow.DriverTiming {
	return actionflow.DriverTiming{Now: s.loop.TimeMs(), Start: s.loop.StartMs(), Duration: s.loop.DurationMs(), Recheck: s.conditionRecheckIntervalMs}
}

func (bridge driverAttemptBridge) ResolveAttemptActor(selector, source string) (string, bool) {
	return bridge.engine.resolveDriverCombatantKey(selector, source)
}

func (bridge driverAttemptBridge) AttemptCooldowns(owner string, writable bool) *actionpkg.CooldownLedger {
	value := bridge.engine.combatants[owner]
	if writable {
		value.cooldowns = value.cooldowns.Clone()
		bridge.engine.combatants[owner] = value
	}
	return value.cooldowns
}

func (bridge driverAttemptBridge) ObserveDriverAttempt(ref string, nativeFollowUp bool) {
	bridge.engine.report.EnsureAbility(ref)
	if !nativeFollowUp {
		bridge.engine.report.Attempt(ref)
	}
}

func (bridge driverAttemptBridge) DriverControlAbility(entry model.DriverEntry) (planbundle.CompiledAbility, bool) {
	ability, _, found := bridge.engine.lookupDriverAbility(entry)
	return ability, found
}

func (bridge driverAttemptBridge) RunDriverControl(entry model.DriverEntry, index int, ability planbundle.CompiledAbility, ref string) *model.EngineError {
	return bridge.engine.handleProcessCommand(entry, index, ability, ref)
}

func (bridge driverAttemptBridge) CheckDriverGate(entry model.DriverEntry, index int) actionflow.GateResult {
	value := bridge.engine.checkAttemptGate(entry, index)
	return actionflow.GateResult{Error: value.err, Skipped: value.skipped, Reason: value.reason, ReadyAt: value.readyAtMs, Ability: value.ability, Source: value.sourceKey, HasAbility: value.hasAbility}
}

func (bridge driverAttemptBridge) ObserveDriverSkip(entry model.DriverEntry, ref string, reason model.AttemptSkipReason, ready int64) {
	bridge.engine.report.Skip(ref)
	bridge.engine.recordAttemptSkipped(entry, reason, ready)
}

func (bridge driverAttemptBridge) ExecuteDriverCast(entry model.DriverEntry) *model.EngineError {
	return bridge.engine.executeAbilityCast(entry)
}

func (bridge driverAttemptBridge) QueueDriverAttempt(at int64, entry, attempt int) {
	bridge.engine.enqueueAttempt(at, entry, attempt)
}

func (bridge driverAttemptBridge) QueueDriverCooldown(at int64, entry, attempt int, owner, ref string) {
	bridge.engine.enqueueCooldownAttempt(at, entry, attempt, owner, ref)
}

func (bridge driverAttemptBridge) ReadDriverInterval(program formula.GenericProgramID, entry model.DriverEntry) (float64, *model.EngineError) {
	s := bridge.engine
	source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	target, _ := s.resolveDriverCombatantKey(entry.Target, source)
	owner, other := s.combatants[source], s.combatants[target]
	context := formula.GenericEvalContext{SourceAttrs: owner.attributesView(), TargetAttrs: other.attributesView(), SourceResources: owner.resourceView(), TargetResources: other.resourceView()}
	value, err := s.formulas.EvalContext(program, &context)
	if err != nil {
		return 0, s.evalFormulaError(program, err, entry.AbilityRef)
	}
	return value, nil
}

func (reads *abilityCastReads) AbilityCastCooldown(owner, ref string) bool {
	_, blocked := (*Engine)(reads).cooldownGate(owner, ref)
	return blocked
}

func (reads *abilityCastReads) NativeProcessUse(use string) *actionpkg.UseView {
	if value := (*Engine)(reads).skillUses[use]; value != nil {
		return value.identity
	}
	return nil
}

func (reads *abilityCastReads) NativeProcessMounted(owner, provider string, definition uint16) bool {
	return (*Engine)(reads).processMounted(owner, provider, definition)
}

func (reads *abilityCastReads) NativeProcessDead(owner string) bool {
	return (*Engine)(reads).combatantHasHp(owner) && (*Engine)(reads).combatantHp(owner) <= 0
}

func (reads *abilityCastReads) NativeProcessCooldown(owner, ref string) bool {
	_, blocked := (*Engine)(reads).cooldownGate(owner, ref)
	return blocked
}

func (s *Engine) executePreparedAbility(prepared actionflow.PreparedAbility, depth int, event *eventFormulaSnapshot, collector *eventCopyableCollector) *model.EngineError {
	request := prepared.Request
	s.refreshProviderAwareAttributes(request.Source, request.Target)
	var storage Frame
	s.initExecutionFrame(&storage, request.Source, request.Target, request.AbilityRef)
	frame := &storage
	frame.chainDepth, frame.eventCtx = depth, cloneEventSnapshot(event)
	frame.copyableCollector, frame.driverEntryKey = collector, request.EntryKey
	frame.ownerCombatantKey, frame.ownerProviderRef = prepared.Owner, prepared.ProviderRef
	if err := s.skillActionFlowExecutor().ExecuteAbilityFrame(prepared, (*abilityFrameBridge)(frame)); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	frame.maybeQueueDamageDealtEvent(prepared.Ability)
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	if err := frame.maybeDispatchAbilityStartedEvent(prepared.Ability); err != nil {
		return err
	}
	if err := frame.maybeDispatchBasicAttackStart(prepared.Ability); err != nil {
		return err
	}
	if err := frame.maybeDispatchBasicAttackHit(prepared.Ability); err != nil {
		return err
	}
	s.checkDeathStopReason()
	return nil
}

func (bridge *abilityFrameBridge) StageAbilityLifecycle(ability planbundle.CompiledAbility, source string) *model.EngineError {
	return (*Frame)(bridge).stageLifecycleCostCooldown(ability, source)
}

func (bridge *abilityFrameBridge) KnownAbilityUse(entry string) *actionpkg.UseView {
	if fact, exists := (*Frame)(bridge).run.hits.Fact(entry); exists && fact.UseRef != nil {
		if use := (*Frame)(bridge).run.skillUses[*fact.UseRef]; use != nil {
			return use.identity
		}
	}
	return nil
}

func (bridge *abilityFrameBridge) NextAbilityCast() uint64 {
	return (*Frame)(bridge).run.mintCastInstanceID()
}

func (bridge *abilityFrameBridge) BindAbilityCast(id uint64, origin string, count bool) {
	(*Frame)(bridge).castInstanceID, (*Frame)(bridge).castOrigin, (*Frame)(bridge).countCastOnCommit = id, origin, count
}

func (bridge *abilityFrameBridge) ExecuteAbilityOperations(ability planbundle.CompiledAbility, operations []planbundle.CompiledOperation) *model.EngineError {
	return (*Frame)(bridge).executeOperations(ability, operations)
}

func (f *Frame) formulaError(id formula.GenericProgramID, message string) *model.EngineError {
	path := "formula"
	if int(id) < len(f.run.formulas.Programs) {
		path = f.run.formulas.Programs[id].Key
	}
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, path, f.abilityRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
}

func attachUseToSnapshot(ev *emittedEvent) {
	if ev == nil || !ev.hasUse {
		return
	}
	ev.snapshot.HasUse = true
	ev.snapshot.UseKey, ev.snapshot.UseSource, ev.snapshot.UseSkillKey = ev.useKey, ev.useSource, ev.useSkillKey
}

func (s *Engine) startProcessFromEvent(source, target, ref string, ability planbundle.CompiledAbility, depth int, event *eventFormulaSnapshot, driverKey string, collector *eventCopyableCollector) *model.EngineError {
	prepared, err := s.processFlowExecutor().PrepareNativeProcess(actionflow.NativeProcessStart{Source: source, Target: target, AbilityRef: ref, DriverKey: driverKey, Depth: depth, Now: s.loop.TimeMs(), Event: event}, ability, s.compiled.Providers, (*abilityCastReads)(s))
	if err != nil {
		return err
	}
	if prepared.Rejection != "" {
		return s.rejectProcessUse(prepared.Entry, ref, prepared.Use, prepared.Rejection)
	}
	return s.startProcess(prepared.Entry, -1, source, target, prepared.Provider, ref, ability, prepared.Definition, prepared.Use, depth, collector)
}

func (f *Frame) requireAttackProcess(ability planbundle.CompiledAbility, skill, use string) *model.EngineError {
	return f.run.processFlowExecutor().RequireAttackProcess(ability, skill, use, f.abilityRef, f.sourceKey, f.targetKey, f.driverEntryKey, f.run.loop.TimeMs(), f.run.compiled.Providers, f.run.compiled.Abilities)
}

func (s *Engine) initAutomaticSkills() *model.EngineError {
	return s.skillActionFlowExecutor().InitializeAutomatic(s.skillAdmissionInput(), s.compiled.SkillActionBindings, skillAdmissionBridge{engine: s})
}

func (s *Engine) queueAutomaticSkills(at int64) {
	if !s.actions.HasAutomatic() || at < s.loop.TimeMs() {
		return
	}
	generation := s.actions.NextAutomaticGeneration()
	if s.loop.RescheduleAutomaticSkill(at, generation) {
		return
	}
	s.pushCombatEvent(scheduler.GenericEvent{TimeMs: at, Category: scheduler.GenericCategorySkillAction, Kind: scheduler.GenericEventAutomaticSkill, AutomaticGeneration: generation, DriverEntryIndex: -1})
}

func (s *Engine) automaticWait(rule *actionpkg.AutomaticRuleView, reason string, related []string, at int64) {
	if record, changed := s.actions.AutomaticWaiting(rule, reason, related, at, s.loop.TimeMs()); changed {
		s.recordAutomatic(record)
	}
}

func (s *Engine) automaticCandidate(rule *actionpkg.AutomaticRuleView) (string, []string, int64, *model.EngineError) {
	return s.skillActionFlowExecutor().Candidate(rule, s.loop.TimeMs(), s.combatants[model.SelectorSource].cooldowns, automaticChoiceBridge{engine: s})
}

func (s *Engine) handleAutomaticSkills(event scheduler.GenericEvent) *model.EngineError {
	return s.skillActionFlowExecutor().RunAutomatic(event.AutomaticGeneration, s.loop.TimeMs(), automaticChoiceBridge{engine: s}, automaticChoiceBridge{engine: s})
}

func (s *Engine) recordAutomatic(record model.AutomaticSkillRecord) {
	if !s.actions.HasAutomatic() {
		return
	}
	s.report.RecordAutomatic(record, s.loop.TimeMs(), s.detailedOutput())
}

func (s *Engine) publishAutomaticSkillStart(action *actionpkg.SkillActionView, process *actionpkg.ProcessView) {
	records := s.actions.AutomaticStarted(action, process)
	if rule := action.AutomaticRule(); rule != nil {
		s.automaticWait(rule, "", nil, 0)
	}
	for _, record := range records {
		s.recordAutomatic(record)
	}
}

func (s *Engine) publishAutomaticSkillFinish(action *actionpkg.SkillActionView, process *actionpkg.ProcessView) {
	for _, record := range s.actions.AutomaticFinished(action, process) {
		s.recordAutomatic(record)
	}
}

func (s *Engine) automaticSkillResults() (*model.AutomaticSkillSummary, []model.AutomaticSkillRecord, *model.AutomaticSkillRecording, *model.SkillUseSummary) {
	summary, uses := s.actions.AutomaticSummary()
	if summary == nil {
		return nil, nil, nil, nil
	}
	return summary, nil, s.report.AutomaticRecording(s.detailedOutput()), uses
}

func whileReadyCooldownWaitKey(owner, entry string) actionpkg.CooldownWaitKey {
	return actionpkg.CooldownWaitKey{Kind: "while_ready", Owner: owner, Key: entry}
}

// 冷却改期与自动候选在状态发布前预留容量，发布后只执行已通过预检的队列修改。
func (f *Frame) prepareCooldownWakeups() (int, *model.EngineError) {
	executor := f.run.skillActionFlowExecutor()
	plan, err := executor.PrepareCooldownWake(f.pendingProcess, f.processIsNew)
	if err == nil && f.staged != nil {
		attackHandled := f.pendingBasicAttackWait != nil || f.hasPendingBasicAttackAmmo() || f.pendingActionWait
		actorsAlive := f.continuousCombatantsLive()
		// 保留原Range的内联插入顺序，再遍历额外拥有者；不创建每帧回调或适配对象。
		for index := 0; index < f.staged.count; index++ {
			entry := f.staged.inline[index]
			plan = executor.AccumulateCooldownWake(plan, entry.value.cooldowns.ChangedWaits(f.run.combatants[entry.key].cooldowns), attackHandled, actorsAlive, f.run.req.DriverPlan.Entries)
		}
		for owner, staged := range f.staged.extra {
			plan = executor.AccumulateCooldownWake(plan, staged.cooldowns.ChangedWaits(f.run.combatants[owner].cooldowns), attackHandled, actorsAlive, f.run.req.DriverPlan.Entries)
		}
	}
	f.pendingAutomaticWake, f.pendingBasicAttackCooldownWake, f.pendingCooldownAttempts = plan.Automatic, plan.BasicAttack, plan.Attempts
	if err != nil {
		return 0, err
	}
	count := 0
	if plan.Automatic && !f.run.loop.HasAutomaticSkill() {
		count++
	}
	if plan.BasicAttack && !f.run.loop.HasBasicAttack() {
		count++
	}
	for _, attempt := range plan.Attempts {
		if !f.run.loop.HasCooldownAttempt(attempt.Entry) {
			count++
		}
	}
	return count, nil
}

func (f *Frame) commitCooldownWakeups() {
	if f.pendingBasicAttackCooldownWake && f.continuousCombatantsLive() {
		attack := f.run.actions.BasicAttack()
		if wait, exists := f.run.combatants[attack.Plan().Source].cooldowns.Wait(basicAttackCooldownWaitKey(attack)); exists {
			if !f.run.loop.RescheduleBasicAttack(wait.ReadyAt, wait.Version) {
				f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: wait.ReadyAt, Category: scheduler.GenericCategoryAbilityAttempt,
					Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1, BasicAttackGeneration: wait.Version})
			}
		}
	}
	for _, pending := range f.pendingCooldownAttempts {
		if f.run.loop.RescheduleCooldownAttempt(pending.Entry, pending.Wait.ReadyAt, pending.Wait.Version) {
			continue
		}
		f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: pending.Wait.ReadyAt, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventAbilityAttempt, DriverEntryIndex: pending.Entry, CooldownWaitVersion: pending.Wait.Version})
	}
	if f.pendingAutomaticWake {
		f.run.queueAutomaticSkills(f.run.loop.TimeMs())
	}
}

func (s *Engine) enqueueCooldownAttempt(at int64, index, attempt int, owner, ability string) {
	entry := s.req.DriverPlan.Entries[index]
	c := s.combatants[owner]
	c.cooldowns = c.cooldowns.Clone()
	wait := c.cooldowns.RegisterWait(whileReadyCooldownWaitKey(owner, entry.EntryKey), []contractpkg.CooldownIdentity{actionpkg.AbilityCooldownIdentity(owner, ability)}, 0, s.loop.TimeMs())
	s.combatants[owner] = c
	if s.loop.RescheduleCooldownAttempt(index, wait.ReadyAt, wait.Version) {
		return
	}
	s.pushCombatEvent(scheduler.GenericEvent{TimeMs: wait.ReadyAt, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventAbilityAttempt, DriverEntryIndex: index, AttemptIndex: attempt, CooldownWaitVersion: wait.Version})
}

func (s *Engine) resolveDriverCombatantKey(selector, sourceKey string) (string, bool) {
	key, valid := actionflow.ResolveDriverCombatant(selector, sourceKey)
	return key, valid && s.combatantExists(key)
}

func (s *Engine) compileDriverConditions() *model.EngineError {
	return s.skillActionFlowExecutor().CompileDriverConditions(s.req.DriverPlan.Entries, &s.formulas, s.compiled.AbilityRefIndex)
}

func normalizeConditionRecheckInterval(raw int64) int64 {
	return actionflow.NormalizeConditionRecheckInterval(raw)
}

func (s *Engine) seedDriverAttempts() {
	s.skillActionFlowExecutor().SeedDrivers(s.req.DriverPlan.Entries, s.driverTiming(), s.budget.MaxEvents, driverAttemptBridge{engine: s})
}

func (s *Engine) estimateRepeatAttempts(entry model.DriverEntry) int {
	return actionflow.EstimateDriverAttempts(entry, s.loop.StartMs(), s.loop.DurationMs(), s.budget.MaxEvents)
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

func (s *Engine) handleAbilityAttempt(event scheduler.GenericEvent) *model.EngineError {
	return s.skillActionFlowExecutor().Attempt(actionflow.DriverAttempt{Entry: event.DriverEntryIndex, Attempt: event.AttemptIndex, TimeMs: event.TimeMs, WaitVersion: event.CooldownWaitVersion}, s.req.DriverPlan.Entries, s.driverTiming(), driverAttemptBridge{engine: s}, driverAttemptBridge{engine: s})
}

func (s *Engine) scheduleDynamicRepeatNext(entry model.DriverEntry, index, attempt int) *model.EngineError {
	return s.skillActionFlowExecutor().ScheduleDynamicRepeat(entry, index, attempt, s.driverTiming(), driverAttemptBridge{engine: s})
}

func (s *Engine) isWhileReady(entry model.DriverEntry) bool { return actionflow.IsWhileReady(entry) }

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

func isValidSelector(sel string) bool {
	_, ok := model.ValidCombatantSelectors[sel]
	return ok
}

func (s *Engine) checkAttemptGate(entry model.DriverEntry, index int) gateCheckResult {
	result := s.skillActionFlowExecutor().AttemptGate(entry, index, s.loop.TimeMs(), s.conditionRecheckIntervalMs, attemptGateBridge{engine: s})
	return gateCheckResult{err: result.Error, skipped: result.Skipped, reason: result.Reason, readyAtMs: result.ReadyAt, ability: result.Ability, sourceKey: result.Source, hasAbility: result.HasAbility}
}

func (s *Engine) cooldownGate(sourceKey, abilityRef string) (readyAtMs int64, blocked bool) {
	sourceKey = actionpkg.AbilityCooldownOwner(sourceKey, abilityRef)
	c, ok := s.combatants[sourceKey]
	if !ok {
		return 0, false
	}
	id := actionpkg.AbilityCooldownIdentity(sourceKey, abilityRef)
	if c.cooldowns.Remaining(id, s.loop.TimeMs()) > 0 {
		return c.cooldowns.ReadyAt(id), true
	}
	return 0, false
}

func (s *Engine) resourceGate(sourceKey, targetKey string, ability planbundle.CompiledAbility, abilityRef string, entry model.DriverEntry) (readyAtMs int64, blocked bool, formulaErr *model.EngineError) {
	if ability.Cost == nil || !ability.Cost.HasAmount {
		return 0, false, nil
	}
	c, ok := s.combatants[sourceKey]
	if !ok {
		return s.loop.TimeMs() + s.conditionRecheckIntervalMs, true, nil
	}
	target := s.combatants[targetKey]
	ctx := formula.GenericEvalContext{
		RuntimeSkillKey: ability.SkillKey,
		SourceAttrs:     c.attributesView(),
		TargetAttrs:     target.attributesView(),
		SourceResources: c.resourceView(),
		TargetResources: target.resourceView(),
		AbilityParams:   ability.Params,
	}
	// Provider-aware cost preflight: only a valid parsed provider ability ref binds
	// HasProviderContext + lazy-expired provider state (mirrors lifecycle charging).
	// Unparseable refs stay fail-closed (no context → provider.state eval error → MaxFloat64).
	if ownerKey, providerRef, ok := actionflow.GateProviderOwner(abilityRef, sourceKey, targetKey); ok {
		ctx.HasProviderContext = true
		ctx.ProviderState = model.NumericView{}
		ctx.ProviderTargetState = model.NumericView{}
		if owner, ok := s.combatants[ownerKey]; ok && providerRef != "" {
			if bag := owner.providerState.PrepareRead(providerRef, false,
				s.resolveProviderStateFieldDefs(ownerKey, providerRef, owner.instances.Providers()), s.loop.TimeMs(), effectpkg.ReadOptions{Cooldowns: owner.cooldowns.View(), OwnerKey: ownerKey, TargetView: true, TargetKey: targetKey}); bag.Present() {
				ctx.ProviderState = bag.State()
				if bag.TargetKey() == targetKey {
					ctx.ProviderTargetState = bag.TargetStateForFormula()
				}
				s.combatants[ownerKey] = owner
			}
		}
	}
	_ = entry
	return s.skillActionFlowExecutor().ResourceGate(ability, abilityRef, s.loop.TimeMs(), s.conditionRecheckIntervalMs, c.resourceView().At(ability.Cost.ResourceKey).Current, ctx, &s.formulas, attemptGateBridge{engine: s})
}

func (s *Engine) conditionGate(entry model.DriverEntry, entryIndex int, sourceKey, targetKey string, ability planbundle.CompiledAbility, abilityRef string) (bool, *model.EngineError) {
	return s.skillActionFlowExecutor().ConditionGate(entryIndex, ability, gateConditionBridge{engine: s, source: sourceKey, target: targetKey, ability: ability, ref: abilityRef})
}

func (s *Engine) castConditionBlocked(sourceKey, targetKey string, ability planbundle.CompiledAbility, abilityRef string) (bool, *model.EngineError) {
	ownerKey, providerRef, _ := actionflow.GateProviderOwner(abilityRef, sourceKey, targetKey)
	source := s.combatants[sourceKey]
	target := s.combatants[targetKey]
	ctx := formula.GenericEvalContext{
		StrictReads:        s.automatedRun(),
		SourceAttrs:        source.attributesView(),
		TargetAttrs:        target.attributesView(),
		SourceResources:    source.resourceView(),
		TargetResources:    target.resourceView(),
		AbilityParams:      ability.Params,
		HasProviderContext: true,
		ProviderState:      model.NumericView{},
	}
	if owner, ok := s.combatants[ownerKey]; ok && providerRef != "" {

		bag := owner.providerState.PrepareRead(providerRef, true,
			s.resolveProviderStateFieldDefs(ownerKey, providerRef, owner.instances.Providers()), s.loop.TimeMs(), effectpkg.ReadOptions{Cooldowns: owner.cooldowns.View(), OwnerKey: ownerKey, TargetView: true, TargetKey: targetKey})
		s.combatants[ownerKey] = owner
		ctx.ProviderState = bag.State()
		if bag.TargetKey() == targetKey {
			ctx.ProviderTargetState = bag.TargetStateForFormula()
		}
	}
	value, err := s.formulas.EvalContext(ability.CastConditionProgram, &ctx)
	if err != nil {
		return false, s.evalFormulaError(ability.CastConditionProgram, err, abilityRef)
	}
	return value == 0, nil
}

func (s *Engine) gateFormulaError(program formula.GenericProgramID, message, ref string) *model.EngineError {
	path := ref + ".condition"
	if int(program) < len(s.formulas.Programs) {
		path = s.formulas.Programs[program].Key
	}
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (s *Engine) nextWhileReadyTime(entry model.DriverEntry, result gateCheckResult) int64 {
	return actionflow.NextWhileReadyTime(result.reason, result.readyAtMs, s.loop.TimeMs(), s.conditionRecheckIntervalMs)
}

func materializeCooldowns(raw map[string]interface{}, owner string) *actionpkg.CooldownLedger {
	return actionflow.MaterializeCooldowns(raw, owner)
}

func parseCooldownReadyAtMs(value interface{}) int64 {
	return actionflow.ParseCooldownReadyAt(value)
}

// normalizeAbilityRef 将 self/opponent abilityRef 归一为 source/target concrete ref。
func normalizeAbilityRef(abilityRef, sourceKey, targetKey string) string {
	return actionflow.NormalizeAbilityRef(abilityRef, sourceKey, targetKey)
}

// The same process constructor also serves externally supplied and event-bound
// uses. Only the real current planned INITIAL may establish this new graph.
func (s *Engine) isBoundFiniteRecastInitial(entry model.DriverEntry, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string) bool {
	return s.processFlowExecutor().BoundFiniteRecastInitial(entry, owner, target, provider, ref, ability, definition, use, s.loop.TimeMs(), s.compiled.SkillActionBindings, s.compiled.Abilities, s.compiled.Providers)
}

func (s *Engine) automaticRecastCandidate(rule *actionpkg.AutomaticRuleView, process *actionpkg.ProcessView) (string, []string, int64, *model.EngineError) {
	return s.skillActionFlowExecutor().RecastCandidate(rule, process, s.loop.TimeMs(), recastBridge{engine: s})
}

func (s *Engine) runAutomaticRecast(rule *actionpkg.AutomaticRuleView, process *actionpkg.ProcessView) *model.EngineError {
	return s.skillActionFlowExecutor().RunAutomaticRecast(rule, process, s.loop.TimeMs(), automaticChoiceBridge{engine: s})
}

func recastUseKey(window string, index int) string { return actionflow.RecastUseKey(window, index) }

func (s *Engine) skillActionForUse(use string) *actionpkg.SkillActionView {
	if action := s.actions.ActionForUse(use); action != nil {
		return action
	}
	if strings.HasPrefix(use, "recast:") {
		if actual := s.skillUses[use]; actual != nil && actual.identity.ActionReference().Present {
			return s.actions.Action(actual.identity.ActionReference())
		}
	}
	return nil
}

// Acceptance commits its quota and original-deadline timer before the real cast
// event. The execution payload then reads any changes caused by that event.
func (s *Engine) acceptRecast(entry model.DriverEntry, process *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref string) *model.EngineError {
	return s.processFlowExecutor().AcceptRecast(entry, process, ability, ref, s.loop.TimeMs(), recastBridge{engine: s}, processFlowBridge{engine: s})
}

func resourceReadyTimeMs(now int64, current, required float64, fallback int64) int64 {
	return actionflow.ResourceReadyTimeMs(now, current, required, fallback)
}

// 编译已确认依赖位于同一绑定的更早步骤；旧绑定无依赖时不增加查找。
func hasSimpleStepHits(definition *planbundle.CompiledProcess, binding planbundle.CompiledSkillActionBinding) bool {
	return actionflow.HasSimpleStepHits(definition, binding)
}

func (state *Engine) automatedRun() bool {
	return state.actions.BasicAttack() != nil || state.hasSkillPlan()
}

func (state *Engine) hasSkillPlan() bool {
	return state.actions.ManualCount() > 0 || state.actions.HasAutomatic()
}

func (state *Engine) initSkillAction() *model.EngineError {
	return state.skillActionFlowExecutor().InitializeManual(state.skillAdmissionInput(), state.compiled.SkillActionBindings, skillAdmissionBridge{engine: state})
}

func validSkillActionControl(action string) bool { return actionflow.ValidSkillActionControl(action) }

func (state *Engine) handleSkillAction(index int) *model.EngineError {
	return state.skillActionFlowExecutor().RunManual(index, state.loop.TimeMs(), manualActionBridge{engine: state})
}

func (state *Engine) finishSkillActionAttempt(err *model.EngineError) {
	action := state.actions.CurrentAction()
	record := state.actions.FinishAttempt(action, state.loop.TimeMs(), err)
	state.report.RecordSkillAction(record, state.detailedOutput())
	state.actions.RemoveProcessFact(action.Plan().InstructionKey())
}

func (state *Engine) publishSkillActionStart(process *actionpkg.ProcessView) {
	state.skillActionFlowExecutor().PublishStart(process, skillEventsBridge{engine: state})
}

func (state *Engine) publishSkillActionFinish(process *actionpkg.ProcessView) {
	state.skillActionFlowExecutor().PublishFinish(process, skillEventsBridge{engine: state})
}

func (state *Engine) publishSkillActionControl(process *actionpkg.ProcessView, ref string) {
	state.skillActionFlowExecutor().PublishControl(process, ref, skillEventsBridge{engine: state})
}

func (state *Engine) publishSkillActionMoment(process *actionpkg.ProcessView, kind string) {
	state.skillActionFlowExecutor().PublishMoment(process, kind, state.loop.TimeMs(), skillEventsBridge{engine: state})
}

func (state *Engine) recordSkillUse(process *actionpkg.ProcessView, kind string, hit, reason *string) {
	state.skillActionFlowExecutor().RecordUse(process, kind, hit, reason, state.loop.TimeMs(), skillEventsBridge{engine: state})
}

func (state *Engine) resolveSkillActionMoment(process *actionpkg.ProcessView, kind string) *model.EngineError {
	return state.skillActionFlowExecutor().ResolveMoment(process, kind, skillEventsBridge{engine: state})
}

func (state *Engine) executeSkillActionHit(process *actionpkg.ProcessView, action *actionpkg.SkillActionView, hit model.SkillActionHitBinding, sequence int) *model.EngineError {
	use := process.UseKey()
	if process.CastUseKey() != "" {
		use = process.CastUseKey()
	}
	instruction := action.Plan().InstructionKey()
	if actual := state.skillActionForUse(use); actual != nil {
		instruction = actual.Plan().InstructionKey()
	}
	key := instruction + ":" + hit.HitBindingKey + ":" + strconv.Itoa(sequence) + nativeHitFollowUpSuffix
	state.hits.PutFact(key, model.SkillHitFact{DriverEntryKey: key, UseRef: &use, Sequence: &sequence})
	entry := model.DriverEntry{EntryKey: key, AbilityRef: hit.HitAbilityRef, Source: process.Owner(), Target: process.Target(), FirstAtMs: state.loop.TimeMs()}
	defer state.hits.RemoveFact(key)
	gate := state.checkAttemptGate(entry, -1)
	if gate.err != nil {
		return gate.err
	}
	if gate.skipped {
		state.recordAttemptSkipped(entry, gate.reason, gate.readyAtMs)
		return nil
	}
	return state.executeAbilityCast(entry)
}

func (frame *Frame) skillActionUseRef() string {
	if frame.processUseKey != "" {
		return frame.processUseKey
	}
	if frame.eventCtx != nil {
		if frame.eventCtx.HasUse {
			return frame.eventCtx.UseKey
		}
		if frame.eventCtx.SkillHit != nil {
			return frame.eventCtx.SkillHit.UseRef
		}
	}
	if fact, exists := frame.run.hits.Fact(frame.driverEntryKey); exists && fact.UseRef != nil {
		return *fact.UseRef
	}
	return ""
}

// 与对应命中证据一起暂存，只有成功提交后发布使用记录与命中统计。
func (frame *Frame) recordSkillActionHit(useRef string, occurrenceID uint64) {
	fact := committedSkillActionHit{useRef: useRef, occurrenceID: occurrenceID, evidenceIndex: frame.pendingEvidenceIndex()}
	if frame.committed {
		frame.run.recordSkillActionHit(fact)
		return
	}
	frame.pendingSkillHits = append(frame.pendingSkillHits, fact)
}

func (state *Engine) recordSkillActionHit(fact committedSkillActionHit) {
	var actual *actionpkg.UseView
	if use := state.skillUses[fact.useRef]; use != nil {
		actual = use.identity
	}
	state.skillActionFlowExecutor().RecordCommittedHit(fact.useRef, actual, state.hits.OccurrenceCount(), skillEventsBridge{engine: state})
}

func (state *Engine) recordDirectHealing(record model.DirectHealingRecord) {
	state.report.RecordDirectHealing(record, state.detailedOutput())
}

func (state *Engine) seedSkillAction() {
	for index := 0; index < state.actions.ManualCount(); index++ {
		action := state.actions.ManualAt(index)
		state.pushCombatEvent(scheduler.GenericEvent{TimeMs: action.Plan().FirstAtMs(), Category: scheduler.GenericCategorySkillAction, Kind: scheduler.GenericEventSkillAction, SkillActionIndex: index, DriverEntryIndex: -1})
	}
}

func (state *Engine) skillSummaries() (model.SkillActionSummary, model.SkillUseSummary) {
	return state.actions.SkillSummaries()
}

func validateImmediatePeriodicRefundFreshSnapshot(compiled planbundle.CompiledSession, request model.RunRequest) *model.EngineError {
	executor := actionflow.NewSkillActionExecutor(nil, compiled.Abilities, compiled.Providers, actionflow.Identity{SchemaHash: compiled.SchemaHash, RulesHash: compiled.RulesHash, SessionID: request.SessionID})
	return executor.ValidateRefundSnapshot(request.InitialSnapshot, compiled.HasTotalCooldownRefund)
}

func (f *Frame) validateImmediatePeriodicApplication(operation planbundle.CompiledOperation) *model.EngineError {
	expectedTarget := ""
	if f.pendingProcess != nil {
		expectedTarget = opponentCombatantKey(f.pendingProcess.Owner())
	}
	return f.run.skillActionFlowExecutor().ValidateImmediatePeriod(operation, f.pendingProcess, f.processMomentKind, f.ownerCombatantKey, f.ownerProviderRef, expectedTarget, f.run.compiled.HasImmediatePeriodic)
}

func (s *Engine) bindImmediatePeriodicUse(owner, source, definition, use string) {
	actor := s.combatants[owner]
	instance, index, found := s.skillActionFlowExecutor().BindImmediatePeriod(owner, source, definition, use, s.loop.TimeMs(), actor.instances.Providers())
	if found {
		actor.instances.ReplaceProvider(index, instance)
		s.combatants[owner] = actor
	}
}

func (f *Frame) applyTotalCooldownRatioRefund(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	return f.run.skillActionFlowExecutor().ApplyTotalCooldownRefund(operation, ability, f.mountedListener, f.eventCtx, f.ownerCombatantKey, f.run.loop.TimeMs(), cooldownRefundBridge{frame: f})
}

func (f *Frame) applyActionCooldown(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	return f.run.skillActionFlowExecutor().ApplyCooldown(actionflow.CooldownOperationInput{Source: f.sourceKey, Target: f.targetKey, AbilityRef: f.abilityRef, Owner: f.ownerCombatantKey, Mounted: f.mountedListener, Event: f.eventCtx}, operation, ability, f.run.loop.TimeMs(), cooldownRefundBridge{frame: f})
}
