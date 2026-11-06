// 真实过程时点帧、使用身份、恢复和计时交接。
package execution

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/scheduler"
)

type processFlowBridge struct{ engine *Engine }

type processAmountBridge struct{ frame *Frame }

type processRestoreBridge struct{ engine *Engine }

type processMomentBridge struct{ frame *Frame }

// processStartBridge 仅借用本次独立原过程帧，驱动和槽位由调用参数提供。
type processStartBridge Frame

type processControlBridge struct{ engine *Engine }

type skillEventsBridge struct{ engine *Engine }

var _ actionflow.ProcessPhases = processFlowBridge{}

var _ actionflow.ProcessAmounts = processAmountBridge{}

var _ actionflow.ProcessRestoreFacts = processRestoreBridge{}

var _ actionflow.ProcessCosts = processAmountBridge{}

var _ actionflow.ProcessMomentWork = processMomentBridge{}

var _ actionflow.ProcessStartWork = (*processStartBridge)(nil)

var _ actionflow.ProcessCosts = (*processStartBridge)(nil)

var _ actionflow.ProcessControlWork = processControlBridge{}

var _ actionflow.SkillActionObserver = skillEventsBridge{}

var _ actionflow.SkillUseRecords = skillEventsBridge{}

var _ actionflow.SkillHitPhases = skillEventsBridge{}

var _ actionflow.ProcessInitialChecks = processRestoreBridge{}

var _ actionflow.ProcessConditions = processAmountBridge{}

var _ actionflow.ProcessDeaths = processControlBridge{}

var _ actionflow.ProcessCompletion = processFlowBridge{}

var _ actionflow.PlannedCastUses = skillEventsBridge{}

func (bridge skillEventsBridge) PlannedCastUse(use string) *actionpkg.UseView {
	if value := bridge.engine.skillUses[use]; value != nil {
		return value.identity
	}
	return nil
}

func (bridge processFlowBridge) CommitProcessMoment(process *actionpkg.ProcessView, moment actionflow.ProcessMoment) *model.EngineError {
	s := bridge.engine
	var frameStorage Frame
	s.initProcessFrame(&frameStorage, process)
	f := &frameStorage
	if moment.EnterStep {
		timer, err := s.processFlowExecutor().PrepareStep(f.processChanges, moment.StepIndex, s.loop.TimeMs(), processAmountBridge{frame: f})
		if err != nil {
			return err
		}
		f.pendingProcessTimer = timer
	}
	if moment.FinishStatus != "" {
		f.countCastOnCommit, f.castStatRef = moment.CastRef != "", moment.CastRef
		f.processChanges.Finish(moment.FinishStatus, moment.Reason, s.loop.TimeMs())
	}
	if err := s.applyProcessMoment(process, f, moment.Kind, moment.Reason); err != nil {
		return err
	}
	err := s.commitProcessFrame(process, f)
	if moment.FinishStatus != "" && f.committed {
		s.publishSkillActionFinish(process)
	}
	if err != nil {
		return err
	}
	if moment.ResolveHits {
		return s.resolveSkillActionMoment(process, moment.Kind)
	}
	return nil
}

func (bridge processFlowBridge) PublishProcessResolved(process *actionpkg.ProcessView) *model.EngineError {
	return bridge.engine.publishProcessResolved(process)
}

func (bridge processFlowBridge) FinishEmpoweredWindow(process *actionpkg.ProcessView) *model.EngineError {
	return bridge.engine.finishCountedEmpoweredWindow(process)
}

func (bridge processFlowBridge) ResolvedProcessUse(use string) (*actionpkg.UseView, int) {
	value := bridge.engine.skillUses[use]
	if value == nil {
		return nil, 0
	}
	return value.identity, value.history.TotalCount()
}

func (bridge processFlowBridge) DispatchResolvedProcess(process *actionpkg.ProcessView, contactCount int, types []string) *model.EngineError {
	s := bridge.engine
	var frame Frame
	s.initExecutionFrame(&frame, process.Owner(), process.Target(), process.AbilityRef())
	frame.castInstanceID, frame.castOrigin = process.CastID(), process.Ability().CastOrigin
	snapshot := frame.captureEmitSnapshot(model.EventTypeProcessResolved, process.Owner(), process.Target())
	snapshot.HasUseContactCount, snapshot.UseContactCount = true, contactCount
	event := emittedEvent{eventType: model.EventTypeProcessResolved, sourceKey: process.Owner(), targetKey: process.Target(), types: types,
		snapshot: snapshot, castInstanceID: process.CastID(), hasUse: true, useKey: process.UseKey(), useSource: process.Owner(), useSkillKey: process.SkillKey()}
	depth, _ := s.processExecution(process.UseKey())
	return s.dispatchListeners(event, depth+1)
}

func (bridge processAmountBridge) ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError) {
	return bridge.frame.evalAmount(program, bridge.frame.pendingProcess.Ability())
}

func (bridge processAmountBridge) ReadProcessCondition(program formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	return bridge.frame.evalAmount(program, ability)
}

func (bridge processRestoreBridge) ProcessActorExists(key string) bool {
	return bridge.engine.combatantExists(key)
}

func (bridge processRestoreBridge) ProcessActorHP(key string) (float64, bool) {
	return bridge.engine.combatantHp(key), bridge.engine.combatantHasHp(key)
}

func (bridge processRestoreBridge) ProcessMounted(owner, provider string, definition uint16) bool {
	return bridge.engine.processMounted(owner, provider, definition)
}

func (bridge processRestoreBridge) ProcessKnownUse(use string) (actionflow.RestoredUse, bool) {
	value, exists := bridge.engine.skillUses[use]
	if !exists {
		return actionflow.RestoredUse{}, false
	}
	return actionflow.RestoredUse{Source: value.identity.Source(), SkillKey: value.identity.SkillKey()}, true
}

func (bridge processRestoreBridge) NextProcessCast() uint64 {
	return bridge.engine.mintCastInstanceID()
}

func (bridge processRestoreBridge) InitialProcessAbility(entry model.DriverEntry) (planbundle.CompiledAbility, string, bool) {
	return bridge.engine.lookupDriverAbility(entry)
}

func (bridge processRestoreBridge) InitialProcessActor(selector, source string) (string, bool) {
	return bridge.engine.resolveDriverCombatantKey(selector, source)
}

func (bridge processRestoreBridge) QueueRestoredProcess(process *actionpkg.ProcessView) *model.EngineError {
	return bridge.engine.enqueueProcessTimer(process)
}

func (bridge processAmountBridge) ProcessResource(owner, resource string) (float64, bool) {
	value, present := bridge.frame.stageFor(owner).resourceView().Lookup(resource)
	return value.Current, present
}

func (bridge processAmountBridge) PayProcessResource(owner, resource string, amount float64) (float64, *model.EngineError) {
	frame := bridge.frame
	before := frame.stageFor(owner).resourceView().At(resource).Current
	if err := frame.applyResourceChange(owner, resource, -amount, frame.pendingProcess.Ability()); err != nil {
		return 0, err
	}
	return before - frame.stageFor(owner).resourceView().At(resource).Current, nil
}

func (bridge processMomentBridge) SetProcessMoment(kind string, costsReadable bool) {
	bridge.frame.processMomentKind, bridge.frame.processCostReadable = kind, costsReadable
}

func (bridge processMomentBridge) ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError) {
	return bridge.frame.evalAmount(program, bridge.frame.pendingProcess.Ability())
}

func (bridge processMomentBridge) ProcessCooldownFactor(process *actionpkg.ProcessView) (float64, *model.EngineError) {
	return bridge.frame.cooldownDurationFactor(process)
}

func (bridge processMomentBridge) ProcessFormulaError(program formula.GenericProgramID, message string) *model.EngineError {
	return bridge.frame.formulaError(program, message)
}

func (bridge processMomentBridge) StageProcessCooldown(process *actionpkg.ProcessView, ready int64) *model.EngineError {
	frame := bridge.frame
	if err := frame.applyCooldownChange(process.Owner(), process.AbilityRef(), ready); err != nil {
		return err
	}
	frame.stageFor(process.Owner()).writableCooldowns().CommitOrdinary(actionpkg.AbilityCooldownIdentity(process.Owner(), process.AbilityRef()), ready, frame.run.loop.TimeMs())
	return frame.stageInitialBasicAttackWait(process, ready)
}

func (bridge processMomentBridge) RecordProcessMoment(process *actionpkg.ProcessView, kind string) {
	bridge.frame.recordProcess(process, "process_moment", kind)
}

func (bridge processMomentBridge) ResetProcessOutputs() {
	bridge.frame.numeric.SetOutputs(nil)
}

func (bridge processMomentBridge) IsProcessAttackReset(process *actionpkg.ProcessView, kind string, operation planbundle.CompiledOperation) bool {
	return bridge.frame.run.isProcessBasicAttackReset(process, kind, operation)
}

func (bridge processMomentBridge) ExecuteProcessOperations(ability planbundle.CompiledAbility, operations []planbundle.CompiledOperation) *model.EngineError {
	return bridge.frame.executeOperations(ability, operations)
}

func (bridge processMomentBridge) CaptureEmpoweredMoment(process *actionpkg.ProcessView, kind string) {
	if bridge.frame.empowered != nil {
		bridge.frame.empowered.RecordMoment(process.Freeze(), kind)
	}
}

func (bridge *processStartBridge) StartCondition(entryIndex int) (bool, *model.EngineError) {
	return (*Frame)(bridge).run.evalProcessCondition(entryIndex, (*Frame)(bridge), (*Frame)(bridge).processOriginal.Ability())
}

func (bridge *processStartBridge) StartAmmo() (bool, *model.EngineError) {
	ability := (*Frame)(bridge).processOriginal.Ability()
	if ability.IsBasicAttack || (*Frame)(bridge).run.compiled.Providers[ability.ProviderIndex].AmmoBinding == nil {
		return true, nil
	}
	ready, _, err := (*Frame)(bridge).plannedAmmoReady(ability)
	return ready, err
}

func (bridge *processStartBridge) StartCosts() actionflow.ProcessCosts {
	return bridge
}

func (bridge *processStartBridge) ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError) {
	frame := (*Frame)(bridge)
	return frame.evalAmount(program, frame.pendingProcess.Ability())
}

func (bridge *processStartBridge) ProcessResource(owner, resource string) (float64, bool) {
	value, present := (*Frame)(bridge).stageFor(owner).resourceView().Lookup(resource)
	return value.Current, present
}

func (bridge *processStartBridge) PayProcessResource(owner, resource string, amount float64) (float64, *model.EngineError) {
	frame := (*Frame)(bridge)
	before := frame.stageFor(owner).resourceView().At(resource).Current
	if err := frame.applyResourceChange(owner, resource, -amount, frame.pendingProcess.Ability()); err != nil {
		return 0, err
	}
	return before - frame.stageFor(owner).resourceView().At(resource).Current, nil
}

func (bridge *processStartBridge) PrepareAcceptedStart(replaced *actionpkg.ProcessView) *model.EngineError {
	frame := (*Frame)(bridge)
	frame.processChanges.SetCast(frame.run.mintCastInstanceID(), frame.pendingProcess.CastUseKey())
	frame.castInstanceID = frame.pendingProcess.CastID()
	if replaced != nil {
		return frame.run.stageEmpoweredFailure(frame, replaced)
	}
	return nil
}

func (bridge *processStartBridge) RunStartMoment() *model.EngineError {
	f, process := (*Frame)(bridge), (*Frame)(bridge).processOriginal
	before := f.numeric.Facts()
	if err := f.run.applyProcessMoment(process, f, "PROCESS_START", ""); err != nil {
		return err
	}
	if err := f.captureProcessStartState(); err != nil {
		return err
	}
	if f.empowered != nil {
		if err := f.run.stageEmpoweredEntry(f); err != nil {
			return err
		}
		after := f.numeric.Facts()
		f.empowered.RecordOutput(process.AbilityRef(), after.Damage-before.Damage, after.Healing-before.Healing)
	}
	return nil
}

func (bridge *processStartBridge) CommitStart() *model.EngineError {
	return (*Frame)(bridge).run.commitProcessFrame((*Frame)(bridge).processOriginal, (*Frame)(bridge))
}

func (bridge *processStartBridge) DispatchAcceptedStart() *model.EngineError {
	return (*Frame)(bridge).maybeDispatchAbilityStartedEvent((*Frame)(bridge).processOriginal.Ability())
}

func (bridge *processStartBridge) RejectStart(entry model.DriverEntry, reason string) *model.EngineError {
	return (*Frame)(bridge).run.rejectProcessUse(entry, (*Frame)(bridge).processOriginal.AbilityRef(), (*Frame)(bridge).processOriginal.UseKey(), reason)
}

func (bridge processControlBridge) ResolveProcessActor(selector, source string) (string, bool) {
	return bridge.engine.resolveDriverCombatantKey(selector, source)
}

func (bridge processControlBridge) RejectProcessControl(entry model.DriverEntry, reason string) *model.EngineError {
	return bridge.engine.rejectProcess(entry, reason)
}

func (bridge processControlBridge) ControlMounted(owner, provider string, definition uint16) bool {
	return bridge.engine.processMounted(owner, provider, definition)
}

func (bridge processControlBridge) ControlSourceDead(owner string) bool {
	return bridge.engine.combatantHasHp(owner) && bridge.engine.combatantHp(owner) <= 0
}

func (bridge processControlBridge) ControlCooldown(owner, ref string) (int64, bool) {
	return bridge.engine.cooldownGate(owner, ref)
}

func (bridge processControlBridge) ControlCondition(process *actionpkg.ProcessView, index int, ability planbundle.CompiledAbility) (bool, *model.EngineError) {
	var frame Frame
	bridge.engine.initProcessFrame(&frame, process)
	return bridge.engine.evalProcessCondition(index, &frame, ability)
}

func (bridge processControlBridge) StartControlledProcess(entry model.DriverEntry, index int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, replaced *actionpkg.ProcessView) *model.EngineError {
	if actionpkg.IsEmpoweredProcess(definition) {
		return bridge.engine.startEmpoweredProcess(entry, index, owner, target, provider, ref, ability, definition, use, replaced)
	}
	return bridge.engine.startProcess(entry, index, owner, target, provider, ref, ability, definition, use, 0, nil)
}

func (bridge processControlBridge) AcceptControlledRecast(entry model.DriverEntry, process *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref string) *model.EngineError {
	return bridge.engine.acceptRecast(entry, process, ability, ref)
}

func (bridge processControlBridge) ReleaseControlledCharge(process *actionpkg.ProcessView, ref string) *model.EngineError {
	s := bridge.engine
	var frame Frame
	s.initProcessFrame(&frame, process)
	frame.countCastOnCommit, frame.castStatRef = true, ref
	frame.recordProcess(frame.pendingProcess, "process_use", "CHARGE_RELEASE")
	if err := s.applyProcessMoment(process, &frame, "STEP_EXECUTION", ""); err != nil {
		return err
	}
	if err := s.commitProcessFrame(process, &frame); err != nil {
		return err
	}
	if err := s.resolveSkillActionMoment(process, "STEP_EXECUTION"); err != nil {
		return err
	}
	return s.completeProcessStep(process)
}

func (bridge processControlBridge) HasDeadProcessActor() bool {
	for owner := range bridge.engine.combatants {
		if bridge.engine.combatantHasHp(owner) && bridge.engine.combatantHp(owner) <= 0 {
			return true
		}
	}
	return false
}

func (bridge processControlBridge) ProcessOwnerDead(owner string) bool {
	return bridge.engine.combatantHasHp(owner) && bridge.engine.combatantHp(owner) <= 0
}

func (bridge processControlBridge) SettlingProcessDeaths() bool {
	return bridge.engine.settlingProcessDeaths
}

func (bridge processControlBridge) BeginProcessDeaths() {
	bridge.engine.settlingProcessDeaths = true
}

func (bridge processControlBridge) EndProcessDeaths() {
	bridge.engine.settlingProcessDeaths = false
}

func (bridge skillEventsBridge) RegisterActionUse(use *actionpkg.UseView) {
	bridge.engine.skillUses[use.UseKey()] = &skillUseRuntime{identity: use}
}

func (bridge skillEventsBridge) ActionUseExists(use string) bool {
	return bridge.engine.skillUses[use] != nil
}

func (bridge skillEventsBridge) ObserveActionUse(process *actionpkg.ProcessView, kind string, hit, reason *string) {
	bridge.engine.recordSkillUse(process, kind, hit, reason)
}

func (bridge skillEventsBridge) ObserveAutomaticStart(action *actionpkg.SkillActionView, process *actionpkg.ProcessView) {
	bridge.engine.publishAutomaticSkillStart(action, process)
}

func (bridge skillEventsBridge) ObserveAutomaticFinish(action *actionpkg.SkillActionView, process *actionpkg.ProcessView) {
	bridge.engine.publishAutomaticSkillFinish(action, process)
}

func (bridge skillEventsBridge) BeginActionUseRecord() bool {
	return bridge.engine.report.BeginSkillUse(bridge.engine.detailedOutput())
}

func (bridge skillEventsBridge) ActionForKnownUse(use string) *actionpkg.SkillActionView {
	return bridge.engine.skillActionForUse(use)
}

func (bridge skillEventsBridge) AppendActionUseRecord(record model.SkillUseRecord) {
	bridge.engine.report.AppendSkillUse(record)
}

func (bridge skillEventsBridge) SkillHitActorsAlive(owner, target string) bool {
	return !(bridge.engine.combatantHp(owner) <= 0 || bridge.engine.combatantHp(target) <= 0)
}

func (bridge skillEventsBridge) ExecutePlannedHit(process *actionpkg.ProcessView, action *actionpkg.SkillActionView, hit model.SkillActionHitBinding, sequence int) *model.EngineError {
	return bridge.engine.executeSkillActionHit(process, action, hit, sequence)
}

func (s *Engine) processErr(path, message, ref string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (s *Engine) processMounted(owner, provider string, definition uint16) bool {
	c, ok := s.combatants[owner]
	if !ok {
		return false
	}
	for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		p := instanceValues.At(instanceIndex)
		if p.ProviderRef == provider && p.DefinitionRef == s.compiled.Providers[definition].ProviderKey && (p.ExpireAt == 0 || p.ExpireAt > s.loop.TimeMs()) {
			return true
		}
	}
	return false
}

func (s *Engine) handleProcessCommand(entry model.DriverEntry, entryIndex int, ability planbundle.CompiledAbility, ref string) *model.EngineError {
	return s.processFlowExecutor().Control(entry, entryIndex, ability, ref, s.loop.TimeMs(), s.compiled.Providers, processControlBridge{engine: s}, processFlowBridge{engine: s})
}

func (s *Engine) countProcessCast(ref string) {
	s.abilityCastCount++
	s.report.Cast(ref)
}

func (s *Engine) rejectProcess(entry model.DriverEntry, reason string) *model.EngineError {
	_, ref, _ := s.lookupDriverAbility(entry)
	return s.rejectProcessUse(entry, ref, s.actions.ProcessFact(entry.EntryKey).UseRef, reason)
}

func (s *Engine) rejectProcessUse(entry model.DriverEntry, ref, use, reason string) *model.EngineError {
	if s.actions.CurrentAction() != nil && entry.EntryKey == s.actions.CurrentAction().Plan().InstructionKey() {
		s.actions.Reject(s.actions.CurrentAction(), reason)
	}
	s.report.Skip(ref)
	s.recordEvidenceLazy("process_rejected", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "process_rejected", Ref: ref, Path: "driverPlan.entries[" + entry.EntryKey + "]", Data: map[string]interface{}{"entryKey": entry.EntryKey, "useKey": use, "reason": reason}}
	})
	return nil
}

func (s *Engine) initProcessFrame(f *Frame, p *actionpkg.ProcessView) {
	s.initExecutionFrame(f, p.Owner(), p.Target(), p.AbilityRef())
	f.processChanges = actionpkg.StageProcess(p)
	f.pendingProcess, f.processOriginal = f.processChanges.View(), p
	f.ownerCombatantKey = p.Owner()
	f.ownerProviderRef = p.ProviderRef()
	f.strictReads = true
	f.castInstanceID = p.CastID()
	f.castOrigin = p.Ability().CastOrigin
	f.chainDepth, f.copyableCollector = s.processExecution(p.UseKey())
	f.processActualCosts = f.pendingProcess.Costs()
	f.processUseKey, f.processUseSkillKey, f.processUseSource = p.UseKey(), p.SkillKey(), p.Owner()
	if p.CastUseKey() != "" {
		f.processUseKey = p.CastUseKey()
	}
}

// Condition false is represented by a normal process rejection; formula failures remain errors.
func (s *Engine) evalProcessCondition(index int, frame *Frame, ability planbundle.CompiledAbility) (bool, *model.EngineError) {
	return s.processFlowExecutor().Condition(index, ability, processAmountBridge{frame: frame})
}

func (s *Engine) startProcess(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, depth int, collector *eventCopyableCollector) *model.EngineError {
	return s.startProcessReplacing(entry, entryIndex, owner, target, provider, ref, ability, definition, use, depth, collector, nil)
}

func (s *Engine) startProcessReplacing(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, depth int, collector *eventCopyableCollector, replaced *actionpkg.ProcessView) *model.EngineError {
	if planbundle.FiniteRecastProcess(definition) && !s.isBoundFiniteRecastInitial(entry, owner, target, provider, ref, ability, definition, use) {
		return s.processErr(definition.Path, "finite recast requires its current bound INITIAL skill plan", use)
	}
	if s.actions.ProcessCount() >= s.budget.MaxProcessInstances {
		err := s.budgetError(model.BudgetCauseMaxProcessInstances, "process instance budget exceeded")
		err.Path, err.Ref = "safetyBudget.maxProcessInstances", use
		return err
	}
	s.refreshProviderAwareAttributes(owner, target)
	p := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: owner, ProviderRef: provider, ProcessKey: definition.ProcessKey, SkillKey: definition.SkillKey, UseKey: use, Target: target, StartedAtMs: s.loop.TimeMs(), StepStartedAtMs: s.loop.TimeMs(), AdvanceAtMs: s.loop.TimeMs(), ActualCosts: map[string]float64{}, ActionOccupancies: []model.ProcessActionOccupancy{}, Status: "active"}, Definition: definition, Ability: ability, AbilityRef: ref, StepIndex: -1, CastUseKey: use})
	s.continuations.Push(use, depth, collector)
	defer s.continuations.Pop()
	var frameStorage Frame
	s.initProcessFrame(&frameStorage, p)
	f := &frameStorage
	f.processIsNew, f.countCastOnCommit = true, true
	if actionpkg.IsEmpoweredProcess(definition) {
		binding, found := s.empoweredBinding(owner, provider, definition.ProcessKey)
		if !found {
			return s.processErr(definition.Path, "empowered attack requires its actual compiled payload binding", use)
		}
		f.processChanges.BindEmpowered(binding.EmpoweredAbilityIndex, binding.ReplacesPrimary, binding.Slot)
		f.empowered = &empoweredFrame{}
	}
	return s.processFlowExecutor().StartPrepared(entry, entryIndex, p, f.processChanges, replaced, s.loop.TimeMs(), (*processStartBridge)(f), processFlowBridge{engine: s})
}

func (s *Engine) applyProcessMoment(p *actionpkg.ProcessView, f *Frame, kind, reason string) *model.EngineError {
	timer, err := s.processFlowExecutor().ApplyMoment(f.processChanges, kind, reason, s.loop.TimeMs(), f.recastExecutionCommitted, s.compiled.Operations, processMomentBridge{frame: f})
	if err != nil {
		return err
	}
	if kind == "STEP_EXECUTION" && f.pendingProcess.HasRepeat() {
		f.pendingProcessTimer = timer
	}
	return nil
}

// The only cross-process set_remaining admitted here is an authored initial
// reset of this owner's actual selected native basic-attack clock.
func (s *Engine) isProcessBasicAttackReset(process *actionpkg.ProcessView, kind string, operation planbundle.CompiledOperation) bool {
	return s.processFlowExecutor().IsAttackReset(process, kind, operation, &s.formulas, s.compiled.AbilityRefIndex, s.compiled.Abilities)
}

func (s *Engine) commitProcessFrame(p *actionpkg.ProcessView, f *Frame) *model.EngineError {
	f.commit()
	if f.fatal {
		return f.fatalErr
	}
	if s.processFailure != nil {
		return s.processFailure
	}
	f.maybeQueueDamageDealtEvent(p.Ability())
	if err := f.dispatchPendingEvents(); err != nil {
		return err
	}
	s.checkDeathStopReason()
	return s.processFailure
}

func (s *Engine) runProcessMoment(p *actionpkg.ProcessView, kind, reason string) *model.EngineError {
	return s.processFlowExecutor().Moment(p, kind, reason, processFlowBridge{engine: s})
}

func (s *Engine) enterProcessStep(p *actionpkg.ProcessView, index int) *model.EngineError {
	return s.processFlowExecutor().EnterStep(p, index, s.loop.TimeMs(), processFlowBridge{engine: s})
}

func (s *Engine) completeProcessStep(p *actionpkg.ProcessView) *model.EngineError {
	return s.processFlowExecutor().CompleteStep(p, s.loop.TimeMs(), processFlowBridge{engine: s})
}

func (s *Engine) finishProcess(p *actionpkg.ProcessView, status, reason string) *model.EngineError {
	return s.finishProcessWithCast(p, status, reason, "")
}

func (s *Engine) finishProcessWithCast(p *actionpkg.ProcessView, status, reason, castRef string) *model.EngineError {
	return s.processFlowExecutor().Finish(p, status, reason, castRef, processFlowBridge{engine: s})
}

func (s *Engine) enqueueProcessTimer(p *actionpkg.ProcessView) *model.EngineError {
	if !p.HasExpiry() && p.StepVersion() != 0 && (p.StepIndex() < 0 || p.Definition().Steps[p.StepIndex()].StepType != "IMMEDIATE") {
		return s.processErr("processInstances.expiresAtMs", "active timed process requires expiration", p.UseKey())
	}
	index := -1
	for i := 0; i < s.actions.ProcessCount(); i++ {
		v := s.actions.ProcessAt(i)
		if v == p {
			index = i
			break
		}
	}
	if s.loop.Enqueue(scheduler.GenericEvent{TimeMs: p.TimerAt(), Category: scheduler.GenericCategoryProcessTimer, Kind: scheduler.GenericEventProcessTimer, ProcessIndex: index, ProcessStepVersion: p.StepVersion(), ProcessExecutionIndex: p.StepExecutionIndex(), ProcessSortKey: p.StableKey(), DriverEntryIndex: -1}) != model.ErrOK {
		return s.budgetError(model.BudgetCauseMaxQueueEvents, "process timer queue overflow")
	}
	return nil
}

func (s *Engine) handleProcessTimer(ev scheduler.GenericEvent) *model.EngineError {
	return s.processFlowExecutor().HandleTimer(actionflow.ProcessTimer{Index: ev.ProcessIndex, StepVersion: ev.ProcessStepVersion, ExecutionIndex: ev.ProcessExecutionIndex}, s.loop.TimeMs(), processFlowBridge{engine: s})
}

func (s *Engine) failDeadProcesses() *model.EngineError {
	return s.processFlowExecutor().FailDeadProcesses(processControlBridge{engine: s}, processFlowBridge{engine: s})
}

func (f *Frame) recordProcess(p *actionpkg.ProcessView, kind, value string) {
	f.recordEvidenceLazy(model.EvidenceKind(kind), func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKind(kind), Ref: p.AbilityRef(), Data: map[string]interface{}{"owner": p.Owner(), "providerRef": p.ProviderRef(), "processKey": p.ProcessKey(), "skillKey": p.SkillKey(), "useKey": p.UseKey(), "target": p.Target(), "stepKey": p.StepKey(), "stepVersion": p.StepVersion(), "moment": value, "status": p.Status(), "failureReason": p.FailureReason()}}
	})
}

func (s *Engine) snapshotProcesses() []model.ProcessInstanceSnapshot {
	return s.actions.ExportProcesses()
}

func (state *Engine) enterProcessRepeat(frame *Frame, step planbundle.CompiledProcessStep) *model.EngineError {
	return state.processFlowExecutor().PrepareRepeat(frame.processChanges, step, state.loop.TimeMs(), processAmountBridge{frame: frame})
}

func (state *Engine) stageProcessRepeatExecution(frame *Frame) *model.EngineError {
	timer, err := state.processFlowExecutor().AdvanceRepeat(frame.processChanges, state.loop.TimeMs())
	if err != nil {
		return err
	}
	frame.pendingProcessTimer = timer
	return nil
}

func (state *Engine) executeProcessRepeat(process *actionpkg.ProcessView) *model.EngineError {
	return state.processFlowExecutor().RunRepeat(process, state.loop.TimeMs(), processFlowBridge{engine: state})
}

func (s *Engine) publishProcessResolved(process *actionpkg.ProcessView) *model.EngineError {
	return s.processFlowExecutor().PublishResolved(process, s.compiled.RuntimeTypes.ProcessResolved.Declared, processFlowBridge{engine: s})
}

func (s *Engine) initProcessState() *model.EngineError {
	return s.processFlowExecutor().Initialize(actionflow.ProcessInitialInput{Rows: s.req.InitialSnapshot.ProcessInstances, Entries: s.req.DriverPlan.Entries, Commands: s.req.ProcessCommandFacts, Now: s.loop.TimeMs(), MaxInstances: s.budget.MaxProcessInstances}, s.processRestorePlan(), processRestoreBridge{engine: s}, processRestoreBridge{engine: s})
}

func (s *Engine) restoreProcess(row model.ProcessInstanceSnapshot, path string) (*actionpkg.ProcessView, *model.EngineError) {
	return s.processFlowExecutor().Restore(row, path, s.loop.TimeMs(), s.processRestorePlan(), processRestoreBridge{engine: s})
}

func (s *Engine) validateRestoredStepProgress(row model.ProcessInstanceSnapshot, definition *planbundle.CompiledProcess, stepIndex int, path string) *model.EngineError {
	return s.processFlowExecutor().ValidateRestoredProgress(row, definition, stepIndex, path, s.loop.TimeMs())
}

func (s *Engine) validateRestoredProcessRepeat(row model.ProcessInstanceSnapshot, step planbundle.CompiledProcessStep, path string) *model.EngineError {
	return s.processFlowExecutor().ValidateRestoredRepeat(row, step, path, s.loop.TimeMs())
}

func (s *Engine) validateRestoredActionOccupancies(process *actionpkg.ProcessView, path string) *model.EngineError {
	return s.processFlowExecutor().ValidateRestoredOccupancies(process, path, s.loop.TimeMs())
}

func cloneProcessCosts(costs map[string]float64) map[string]float64 {
	return actionflow.CloneProcessCosts(costs)
}

func validRestoredProcessCooldown(row model.ProcessInstanceSnapshot, definition *planbundle.CompiledProcess, stepIndex int) bool {
	return actionflow.ValidRestoredCooldown(row, definition, stepIndex)
}

func (f *Frame) captureProcessStartState() *model.EngineError {
	values, err := f.run.processFlowExecutor().CaptureStartState(f.pendingProcess, f.providerOwnerKey(), f.ownerProviderRef, startStateBridge{frame: f})
	if err != nil {
		return err
	}
	if values != nil {
		f.processChanges.SetStartStateValues(values)
	}
	return nil
}
