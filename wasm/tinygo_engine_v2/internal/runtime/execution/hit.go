// 命中输入准备、真实候选帧及命中事实发布。
package execution

import (
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/runtime/execution/hit"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	listenerpkg "tinygo_engine_v2/internal/runtime/execution/listener"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

type attachedListenerBinding struct {
	owner, provider, source, target, ability string
	context                                  *eventFormulaSnapshot
	beforeDamage, beforeHealing              float64
}

type skillUseRuntime struct {
	identity            *actionpkg.UseView
	providerStateBefore actionflow.AttackCapture
	ammoBefore          *ammoUseCapture
	history             hit.History
}

type frozenSkillHitContext = hit.Context

var _ listenerpkg.DispatchHost[emittedEvent, *eventCopyableCollector] = (*Engine)(nil)

var _ hit.CandidateHost[emittedEvent] = (*Engine)(nil)

var _ hit.OperationHost = (*Engine)(nil)

var _ hit.SelectionHost = (*Frame)(nil)

var _ hit.RuleFrameHost = (*Frame)(nil)

func (s *Engine) ListenerMountLive(definition planbundle.CompiledListener) bool {
	return s.listenerStillLive(definition)
}

func (s *Engine) ListenerCondition(event emittedEvent, definition planbundle.CompiledListener) (bool, *model.EngineError) {
	return s.evalListenerCondition(definition, event)
}

func (s *Engine) ReserveListenerUse(event emittedEvent, collector *eventCopyableCollector, definition planbundle.CompiledListener) (reserved, skip bool, err *model.EngineError) {
	token, skip, err := s.reserveOncePerUse(definition, event)
	reserved = token != (usage.Reservation{})
	if reserved {
		collector.SetReservation(token)
	}
	return
}

func (s *Engine) FinishListenerUse(collector *eventCopyableCollector, definition planbundle.CompiledListener, reserved, triggered bool) {
	listenerpkg.FinishUse(&s.useTriggerLedger, collector.Reservation(), reserved, triggered)
	collector.SetReservation(usage.Reservation{})
}

func (s *Engine) AcceptedListenerOrigin(event emittedEvent) bool {
	return s.isAcceptedPlannedCastStart(event)
}

func (s *Engine) ListenerOperations(event emittedEvent, collector *eventCopyableCollector, definition planbundle.CompiledListener, source, target string, chainDepth int) *model.EngineError {
	return s.dispatchListenerOperations(definition, source, target, chainDepth, &event.snapshot, collector)
}

func (s *Engine) ListenerAbility(event emittedEvent, collector *eventCopyableCollector, definition planbundle.CompiledListener, source, target string, chainDepth int) (bool, *model.EngineError) {
	prepared, err := s.skillActionFlowExecutor().PrepareListenerCast(actionflow.AbilityCastRequest{Source: source, Target: target, AbilityRef: definition.AbilityRef}, actionflow.AbilityCastDefinitions{References: s.compiled.AbilityRefIndex, Combatants: s.compiled.Combatants, Operations: s.compiled.Operations}, (*abilityCastReads)(s))
	if err != nil {
		return false, err
	}
	result, err := s.executePreparedCast(prepared, chainDepth, &event.snapshot, collector)
	return result.Accepted, err
}

func (s *Engine) ListenerSkipped(definition planbundle.CompiledListener, reason string) {
	s.recordEvidenceLazy(model.EvidenceKindListenerSkipped, func() model.EvidenceItem {
		data := map[string]interface{}{"reason": reason}
		if reason == "once_per_use" {
			data["groupKey"] = definition.OncePerUseGroup
		}
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: model.EvidenceKindListenerSkipped, Ref: definition.ListenerKey, Data: data}
	})
}

func (s *Engine) FinishListenerDispatch(collector *eventCopyableCollector) *model.EngineError {
	return s.flushDeferredPhantomReplay(collector)
}

func (s *Engine) ListenerDispatchError(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	return s.skillHitErr(code, message, path, ref)
}

func (s *Engine) HitExecutionError(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	return s.skillHitErr(code, message, path, ref)
}

func (f *Frame) HitExecutionError(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	return f.run.skillHitErr(code, message, path, ref)
}

func (f *Frame) HitParticipation(program formula.GenericProgramID, ability planbundle.CompiledAbility, provider string, definition uint16) (float64, bool, *model.EngineError) {
	if provider == "" {
		value, err := f.evalSkillHitParticipation(program, ability)
		return value, true, err
	}
	if !f.run.processMounted(f.sourceKey, provider, definition) {
		return 0, false, nil
	}
	savedOwner, savedProvider := f.ownerCombatantKey, f.ownerProviderRef
	f.ownerCombatantKey, f.ownerProviderRef = f.sourceKey, provider
	value, err := f.evalSkillHitParticipation(program, ability)
	f.ownerCombatantKey, f.ownerProviderRef = savedOwner, savedProvider
	return value, true, err
}

func (f *Frame) HitConditionValue(condition planbundle.CompiledSkillHitValueCond, candidateKey string) (float64, *model.EngineError) {
	ctx, contextErr := f.evalContext(planbundle.CompiledAbility{Params: f.skillHitAbilityParams()})
	if contextErr != nil {
		return 0, contextErr
	}
	value, err := f.run.formulas.Evaluation.EvalContext(condition.ValueProg, &ctx)
	if err == nil {
		return value, nil
	}
	wrapped := f.run.skillHitErr(model.GenericErrFormulaTypeError, err.Error(), condition.Path+".value", candidateKey)
	if strings.HasPrefix(err.Error(), "event.skill_hit.") {
		wrapped.Path = err.Error()
	}
	return 0, f.preserveFormulaIssue(err, wrapped)
}

func (s *Engine) HitCandidate(event emittedEvent, context *hit.Context, candidate planbundle.CompiledSkillHitCandidate, blocked bool, depth int) *model.EngineError {
	return s.executeSkillHitCandidate(event, context, candidate, blocked, depth)
}

func (s *Engine) HitRuleGroup(event emittedEvent, context *hit.Context, group planbundle.CompiledSkillHitRuleGroup, depth int) *model.EngineError {
	return s.executeSkillHitRuleGroup(event, context, group, depth)
}

func (s *Engine) HitPrimaryReplacement(event emittedEvent, context *hit.Context, candidate int, depth int) (bool, *model.EngineError) {
	return s.executePrimaryReplacement(event, context, candidate, depth)
}

func (s *Engine) HitPersistentAttributeSlot(target, modifierTarget, key string) bool {
	combatant, found := s.combatants[modifierMountCombatantKey(target, modifierTarget)]
	if !found {
		return false
	}
	_, found = combatant.attributesView().Lookup(key)
	return found
}

func (f *Frame) HitRuleCandidate(context *hit.Context, candidate planbundle.CompiledSkillHitCandidate, blocked bool) *model.EngineError {
	operations, err := f.run.skillHitCandidateOperations(context, candidate, blocked)
	if err != nil {
		return err
	}
	f.numeric.SetOutputs(nil)
	f.skipBlockedWrites, f.skillHitCandidateKey = blocked, candidate.CandidateKey
	if err := f.executeOperations(context.Ability(), operations); err != nil {
		return err
	}
	f.maybeQueueDamageDealtEvent(context.Ability())
	f.numeric.ClearAggregation()
	return nil
}

func (f *Frame) CommitHitRule() *model.EngineError {
	f.commit()
	if f.fatal {
		return f.fatalErr
	}
	return f.dispatchPendingEvents()
}

func (f *Frame) AttachedHitCandidate(context *hit.Context, candidate planbundle.CompiledSkillHitCandidate, blocked, rootDamage bool) *model.EngineError {
	f.skillHitCandidateKey, f.skipBlockedWrites = candidate.CandidateKey, blocked
	savedRoot := f.rootSkillHitDamage
	f.rootSkillHitDamage = rootDamage
	err := f.executeOperations(context.Ability(), f.run.compiled.Operations[int(candidate.OperationStart):int(candidate.OperationStart)+int(candidate.OperationCount)])
	f.rootSkillHitDamage = savedRoot
	return err
}

func (f *Frame) AttachedSpellShields(target string) (effectpkg.ProviderList, *model.EngineError) {
	return f.empoweredSpellShields(target)
}

func (f *Frame) BindAttachedHit(context *hit.Context) {
	facts := context.View()
	f.eventCtx.HasSkillHit, f.eventCtx.SkillHit = true, context.FrozenFacts()
	f.eventCtx.HasUse, f.eventCtx.UseKey, f.eventCtx.UseSource, f.eventCtx.UseSkillKey = true, facts.UseRef, facts.SourceKey, facts.SkillKey
	f.skillHitOccurrenceID = facts.OccurrenceID
}

func (f *Frame) FinishAttachedHit() {
	f.skipBlockedWrites = false
}

func (f *Frame) AttachedBlocked(context *hit.Context, replacesPrimary bool) *model.EngineError {
	if replacesPrimary {
		f.empowered.MarkPrimaryBlocked()
	}
	return f.stageEmpoweredSpellShield(context)
}

func (f *Frame) BeginEmpoweredProcess(changes *actionpkg.ProcessChangeSet, target string, association *model.ProcessEmpoweredAttack) empoweredContextBinding {
	return f.bindEmpoweredContext(changes, target, changes.View().Ability(), association)
}

func (f *Frame) EmpoweredOwnerLive(owner, provider string, definition uint16) bool {
	return f.run.EmpoweredOwnerLive(owner, provider, definition)
}

func (f *Frame) EmpoweredActivationHistory(use string) hit.ActivationHistory {
	return f.run.empoweredActivationHistory(use)
}

func (s *Engine) EmpoweredOwnerLive(owner, provider string, definition uint16) bool {
	return !s.actions.Dead(owner) && s.combatantHp(owner) > 0 && s.processMounted(owner, provider, definition)
}

func (s *Engine) empoweredActivationHistory(use string) hit.ActivationHistory {
	value := s.skillUses[use]
	if value == nil {
		return hit.ActivationHistory{}
	}
	return hit.ActivationHistory{Present: true, Source: value.identity.Source(), SkillKey: value.identity.SkillKey(),
		State: value.identity.HistoryState(), Contacts: value.history.TotalCount()}
}

func (f *Frame) EmpoweredProcessMoment(changes *actionpkg.ProcessChangeSet, target string, association *model.ProcessEmpoweredAttack, kind string) *model.EngineError {
	return f.applyProcessMoment(kind, "")
}

func (f *Frame) EmpoweredFailureMoment(changes *actionpkg.ProcessChangeSet, reason string) *model.EngineError {
	return f.applyProcessMoment("PROCESS_FAILURE", reason)
}

func (f *Frame) EmpoweredPayload(event emittedEvent, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload planbundle.CompiledAbility) *model.EngineError {
	return f.executeEmpoweredPayload(event, changes.View(), payload)
}

func (f *Frame) StageEmpoweredResult(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack) {
	p := changes.View()
	f.empowered.StageMutation(original, changes)
	f.empowered.StageContact(p, *association)
	f.empowered.StageFinished(p)
}

func (f *Frame) CommitEmpoweredGroup() *model.EngineError {
	f.pendingProcess = nil
	f.commit()
	if f.fatal {
		return f.fatalErr
	}
	return f.dispatchPendingEvents()
}

func (f *Frame) EmpoweredFinishedCount() int { return f.empowered.FinishedCount() }

func (f *Frame) EmpoweredFinishedAt(index int) *actionpkg.ProcessView {
	return f.empowered.FinishedAt(index)
}

func (f *Frame) ResolveEmpoweredProcess(process *actionpkg.ProcessView) *model.EngineError {
	return f.run.publishProcessResolved(process)
}

func (f *Frame) EmpoweredGroupFailure() *model.EngineError {
	return f.run.processFailure
}

func (f *Frame) EmpoweredExecutionError(path, message, use string) *model.EngineError {
	return f.run.processErr(path, message, use)
}

func (f *Frame) ListenerMountLive(definition planbundle.CompiledListener) bool {
	return f.run.listenerStillLive(definition)
}

func (f *Frame) BeginAttachedListener(snapshot *eventFormulaSnapshot, definition planbundle.CompiledListener, ability planbundle.CompiledAbility, source, target string) attachedListenerBinding {
	saved := attachedListenerBinding{owner: f.ownerCombatantKey, provider: f.ownerProviderRef, source: f.sourceKey, target: f.targetKey,
		ability: f.abilityRef, context: f.eventCtx, beforeDamage: f.numeric.Facts().Damage, beforeHealing: f.numeric.Facts().Healing}
	f.sourceKey, f.targetKey = source, target
	f.ownerCombatantKey, f.ownerProviderRef, f.eventCtx, f.abilityRef = definition.OwnerCombatantKey, definition.OwnerProviderRef, snapshot, "listener:"+definition.ListenerKey
	return saved
}

func (f *Frame) EndAttachedListener(binding attachedListenerBinding, executed bool) {
	if executed {
		f.empowered.RecordOutput(f.abilityRef, f.numeric.Facts().Damage-binding.beforeDamage, f.numeric.Facts().Healing-binding.beforeHealing)
		f.numeric.SetTotals(binding.beforeDamage, binding.beforeHealing)
	}
	f.ownerCombatantKey, f.ownerProviderRef, f.eventCtx, f.abilityRef = binding.owner, binding.provider, binding.context, binding.ability
	f.sourceKey, f.targetKey = binding.source, binding.target
}

func (f *Frame) AttachedListenerCondition(definition planbundle.CompiledListener, ability planbundle.CompiledAbility) (bool, *model.EngineError) {
	ctx, contextErr := f.evalContext(ability)
	if contextErr != nil {
		return false, contextErr
	}
	value, err := f.run.formulas.Evaluation.EvalContext(definition.ConditionProgram, &ctx)
	if err != nil {
		return false, f.formulaError(definition.ConditionProgram, err.Error())
	}
	if !effectpkg.FiniteState(value) {
		return false, f.formulaError(definition.ConditionProgram, "spell shield condition must be finite")
	}
	return value != 0, nil
}

func (f *Frame) AttachedListenerOperations(ability planbundle.CompiledAbility, operations []planbundle.CompiledOperation) *model.EngineError {
	return f.executeOperations(ability, operations)
}

func (f *Frame) AttachedListenerError(path, message, provider string) *model.EngineError {
	return f.run.processErr(path, message, provider)
}

func (f *Frame) PrimaryDamageStart() int { return len(f.numeric.Facts().Damages) }

func (f *Frame) StagePrimaryPayload(process *actionpkg.ProcessView, payload planbundle.CompiledAbility, association *model.ProcessEmpoweredAttack, start int) *model.EngineError {
	return f.stagePrimaryReplacement(process, payload, association, start)
}

func (s *Engine) PlannedPrimaryProvider(owner, provider string) bool {
	return s.plannedSkillProvider(owner, provider)
}

func (s *Engine) PrimaryNativeBinding(source string, definition uint16) hit.PrimaryBinding {
	b := s.actions.BasicAttack()
	if b == nil || !b.HasPrimary() {
		return hit.PrimaryBinding{}
	}
	native, identity := b.Plan(), b.Primary()
	return hit.PrimaryBinding{Present: true, Mounted: s.processMounted(source, identity.ProviderRef, definition),
		Plan: b.PrimaryHitPlan(), Candidate: b.PrimaryCandidate(), HitAbilityRef: native.HitAbilityRef,
		Source: native.Source, Target: native.Target, Skill: native.SkillKey, Identity: identity}
}

func (s *Engine) PrimaryActivationHistory(use string) hit.ActivationHistory {
	return s.empoweredActivationHistory(use)
}

func (f *Frame) QueuePrimaryDamage(event emittedEvent, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload, parent planbundle.CompiledAbility, rootDamage bool) {
	p := changes.View()
	saved := f.bindEmpoweredContext(changes, association.Target, payload, association)
	f.eventCtx = cloneEventSnapshot(&event.snapshot)
	f.eventCtx.HasUse, f.eventCtx.UseKey, f.eventCtx.UseSource, f.eventCtx.UseSkillKey = true, p.UseKey(), p.Owner(), p.SkillKey()
	f.rootSkillHitDamage = rootDamage
	f.maybeQueueDamageDealtEvent(parent)
	f.rootSkillHitDamage = false
	f.EndEmpoweredProcess(saved)
}

func (s *Engine) hitIdentity() hit.Identity {
	return hit.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID}
}

func (s *Engine) EmpoweredWindowCount() int { return s.actions.EmpoweredCount() }

func (s *Engine) EmpoweredWindowAt(index int) *actionpkg.ProcessView {
	return s.actions.EmpoweredAt(index)
}

func (s *Engine) EmpoweredMountLive(owner, provider string, definition uint16) bool {
	return s.processMounted(owner, provider, definition)
}

func (f *Frame) RecordCountedExecution(process *actionpkg.ProcessView) {
	f.recordProcess(process, "process_moment", "STEP_EXECUTION")
	f.empowered.RecordMoment(process.Freeze(), "STEP_EXECUTION")
}

func (f *Frame) HitSpellShields(target string) effectpkg.ProviderList {
	return f.activeSpellShields(target)
}

func (f *Frame) FreezeHitEmpoweredWaits(owner string) []hit.EmpoweredWait {
	if f.run.actions.EmpoweredCount() == 0 {
		return nil
	}
	return f.run.freezeEmpoweredWaits(owner)
}

func (f *Frame) PublishEmpoweredMutation(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, clearAttack bool) {
	changes.Publish(original)
	if clearAttack {
		f.run.actions.ClearEmpoweredAttack(original)
	}
	f.run.updateEmpoweredWait(original)
}

func (f *Frame) PublishEmpoweredReservation(use *actionpkg.UseView, process *actionpkg.ProcessView, index int) {
	f.run.actions.ReserveUseEmpowerment(use, process.Reference(), index)
}

func (f *Frame) PublishEmpoweredPrimary(row model.BasicAttackPrimaryReplacement, binding uint16) {
	f.run.commitPrimaryReplacement(row, binding)
}

func (f *Frame) PublishEmpoweredMoment(process *actionpkg.ProcessView, kind string) {
	f.run.publishSkillActionMoment(process, kind)
}

func (f *Frame) PublishEmpoweredContact(process *actionpkg.ProcessView, association model.ProcessEmpoweredAttack) {
	s := f.run
	use := s.skillUses[process.UseKey()]
	use.history.Append(association.Target)
	if action := s.actions.ActionForUse(process.UseKey()); action != nil {
		s.actions.RecordUse(action, "HIT")
		hit := association.HitRef
		s.recordSkillUse(process, "HIT", &hit, nil)
	}
}

func (f *Frame) PublishEmpoweredFinish(process *actionpkg.ProcessView) {
	f.run.publishSkillActionFinish(process)
}

func (f *Frame) PublishEmpoweredOutput(ref string, damage, healing float64) {
	f.run.report.AbilityOutput(ref, damage, healing)
}

func (s *Engine) initSkillHitState() *model.EngineError {
	s.skillUses = map[string]*skillUseRuntime{}
	s.listeners.ResetDynamic()
	bindings := make([]hit.DriverBinding, len(s.req.DriverPlan.Entries))
	for index, entry := range s.req.DriverPlan.Entries {
		ability, _, ok := s.lookupDriverAbility(entry)
		bindings[index] = hit.DriverBinding{HasSkillHit: ok && ability.HasSkillHit, SkillKey: ability.SkillHitSkillKey, WhileReady: s.isWhileReady(entry)}
	}
	if err := s.hits.Initialize(s.req.SkillUses, s.req.SkillHitFacts, s.req.DriverPlan.Entries, bindings, hit.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID}); err != nil {
		return err
	}
	for _, use := range s.req.SkillUses {
		s.skillUses[use.UseKey] = &skillUseRuntime{
			identity: s.actions.NewUse(actionpkg.UseSeed{UseKey: use.UseKey, Source: use.Source, SkillKey: use.SkillKey, HistoryState: use.HistoryState}),
			history:  hit.NewHistory(use.PriorQualifiedContacts),
		}
	}
	return s.bindDynamicProviderListeners()
}

func (s *Engine) lookupDriverAbility(entry model.DriverEntry) (planbundle.CompiledAbility, string, bool) {
	sourceKey, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, _ := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	resolved := normalizeAbilityRef(entry.AbilityRef, sourceKey, targetKey)
	ref, ok := s.compiled.AbilityRefIndex[resolved]
	if !ok || int(ref.AbilityIndex) >= len(s.compiled.Abilities) {
		return planbundle.CompiledAbility{}, resolved, false
	}
	if s.compiled.Abilities[ref.AbilityIndex].TargetExpirySpec != nil {
		return planbundle.CompiledAbility{}, resolved, false
	}
	return s.compiled.Abilities[ref.AbilityIndex], resolved, true
}

func (s *Engine) skillHitErr(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, code, message, path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (f *Frame) resolveSkillHit(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	freeze, err := hit.PrepareAttempt(&f.run.hits, hit.AttemptInput{
		Ability: ability, Plan: op.SkillHit, AbilityRef: f.abilityRef, EntryKey: f.driverEntryKey,
		SourceKey: f.sourceKey, TargetKey: f.targetKey, RootDamageEvent: f.chainDepth == 0,
		MaxEvents: f.run.budget.MaxEvents, Entries: f.run.req.DriverPlan.Entries, Identity: f.run.hitIdentity(),
	}, f)
	if err != nil {
		return err
	}

	eventType := model.EventTypeSkillHit
	if ability.IsBasicAttack {
		eventType = model.EventTypeBasicAttackHit
		if _, ok := f.run.compiled.RuntimeTypes.BasicAttackHit.Lookup(); !ok {
			return f.run.skillHitErr(model.GenericErrUnknownTypeKey, "basic attack resolve requires event/basic_attack_hit in typeCatalog", f.abilityRef, "")
		}
	} else if _, ok := f.run.compiled.RuntimeTypes.SkillHit.Lookup(); !ok {
		return f.run.skillHitErr(model.GenericErrUnknownTypeKey, "resolve_skill_hit requires event/skill_hit in typeCatalog", f.abilityRef, "")
	}
	snap := f.captureEmitSnapshot(eventType, f.sourceKey, f.targetKey)
	if eventType == model.EventTypeSkillHit {
		snap.HasSkillHit = true
		snap.SkillHit = freeze.FrozenFacts()
	}
	f.recordSkillActionHit(freeze.View().UseRef, freeze.View().OccurrenceID, freeze.View().HitSequence, freeze.View().Blocked)
	if f.run.detailedOutput() {
		f.recordEvidence(model.EvidenceItem{
			TimeMs: f.run.loop.TimeMs(),
			Kind:   model.EvidenceKindSkillHit,
			Ref:    f.abilityRef,
			Path:   "driverPlan.entries[" + f.driverEntryKey + "]",
			Data:   skillHitEvidenceData(freeze),
		})
		emitData := skillHitEvidenceData(freeze)
		emitData["eventType"] = eventType
		f.recordEvidence(model.EvidenceItem{
			TimeMs: f.run.loop.TimeMs(),
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    eventType,
			Data:   emitData,
		})
	} else {
		f.recordEvidenceKind(model.EvidenceKindSkillHit)
		f.recordEvidenceKind(model.EvidenceKindEmittedEvent)
	}
	eventTypes := []string{eventType}
	if eventType == model.EventTypeSkillHit {
		eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	}
	ev := emittedEvent{
		eventType:      eventType,
		ref:            eventType,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          f.appendCastOriginEventType(eventTypes),
		snapshot:       snap,
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
		skillHit:       freeze,
	}
	if freeze.View().UseRef != "" {
		ev.hasUse = true
		ev.useKey = freeze.View().UseRef
		ev.useSource = freeze.View().SourceKey
		ev.useSkillKey = freeze.View().SkillKey
	}
	f.pendingEvents = append(f.pendingEvents, ev)
	return nil
}

func skillHitEvidenceData(freeze *frozenSkillHitContext) map[string]interface{} {
	data := map[string]interface{}{
		"occurrenceId": float64(freeze.View().OccurrenceID),
		"skillKey":     freeze.View().SkillKey,
		"source":       freeze.View().SourceKey,
		"target":       freeze.View().TargetKey,
		"blocked":      freeze.View().Blocked,
		"reused":       freeze.View().ReusedSkillUnit,
	}
	if freeze.View().UseRef != "" {
		data["useRef"] = freeze.View().UseRef
	}
	if freeze.View().HasFirstContact {
		data["firstContact"] = freeze.View().FirstContact
	}
	if freeze.View().UnitScope != "" {
		data["blockScope"] = freeze.View().UnitScope
		data["candidateKey"] = freeze.View().CandidateKey
		data["effectOccurrenceKey"] = freeze.View().EffectOccurrenceKey
		data["resultKey"] = freeze.View().ResultKey
	}
	if freeze.View().ShieldProviderRef != "" {
		data["shieldProviderRef"] = freeze.View().ShieldProviderRef
		data["shieldOwner"] = freeze.View().ShieldOwner
		data["shieldDefinitionRef"] = freeze.View().ShieldDefinitionRef
	}
	return data
}

func (f *Frame) SetHitAttemptOccurrence(id uint64) { f.skillHitOccurrenceID = id }

func (f *Frame) RequireHitAttackProcess(ability planbundle.CompiledAbility, skill, use string) *model.EngineError {
	return f.requireAttackProcess(ability, skill, use)
}

func (f *Frame) MarkHitAttack(use string) { f.run.markBasicAttackHit(use) }

func (f *Frame) HitAttemptUse(reference string) hit.AttemptUse {
	use := f.run.skillUses[reference]
	if use == nil {
		return hit.AttemptUse{}
	}
	return hit.AttemptUse{Present: true, HistoryState: use.identity.HistoryState(), History: &use.history}
}

func (f *Frame) HitAttemptBudgetError() *model.EngineError {
	return f.run.budgetError(model.BudgetCauseMaxSkillHits, "skill hit occurrences exceeded run budget")
}

func (f *Frame) evalSkillHitParticipation(programID formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	ctx, err := f.evalContext(ability)
	if err != nil {
		return 0, err
	}
	if f.ownerProviderRef != "" {
		bag := f.stageFor(f.providerOwnerKey()).providerState.Lookup(f.ownerProviderRef)
		if bag.Present() && bag.TargetKey() == f.targetKey {
			ctx.ProviderTargetState = bag.TargetStateForParticipation(f.run.loop.TimeMs())
		}
	}
	return f.evalAmountWithContext(programID, &ctx)
}

func (f *Frame) skillHitAbilityParams() map[string]float64 {
	if f.abilityRef == "" {
		return map[string]float64{}
	}
	ref, ok := f.run.compiled.AbilityRefIndex[f.abilityRef]
	if !ok {
		return map[string]float64{}
	}
	return f.run.compiled.Abilities[ref.AbilityIndex].Params
}

func (f *Frame) activeSpellShields(ownerKey string) effectpkg.ProviderList {
	c, found := f.run.combatants[ownerKey]
	if !found {
		return effectpkg.ProviderList{}
	}
	id, declared := f.run.compiled.RuntimeTypes.SpellShield.Lookup()
	return hit.ActiveSpellShields(c.instances.Providers(), f.run.compiled.Providers, id, declared, f.run.loop.TimeMs())
}

func (s *Engine) refreshEmittedEventLiveSnapshot(ev *emittedEvent) {
	if s == nil || ev == nil {
		return
	}
	if src, ok := s.combatants[ev.sourceKey]; ok {
		ev.snapshot.SourceAttrs = src.attributesView()
		ev.snapshot.SourceResources = src.resourceView()
	}
	if tgt, ok := s.combatants[ev.targetKey]; ok {
		ev.snapshot.TargetAttrs = tgt.attributesView()
		ev.snapshot.TargetResources = tgt.resourceView()
	}
	ev.snapshot.EventType = ev.eventType
	ev.snapshot.EventSourceKey = ev.sourceKey
	ev.snapshot.EventTargetKey = ev.targetKey
}

func (s *Engine) dispatchSkillHitEvent(ev emittedEvent, chainDepth int) *model.EngineError {
	attachUseToSnapshot(&ev)
	freeze := ev.skillHit
	if freeze == nil || freeze.Plan() == nil {
		return s.dispatchListeners(ev, chainDepth)
	}
	if ev.eventType == model.EventTypeBasicAttackHit {
		if err := s.dispatchBasicAttackReceived(ev, chainDepth); err != nil {
			return err
		}
	}
	if err := hit.ExecuteCandidates(freeze, ev, chainDepth, s); err != nil {
		return err
	}
	s.refreshEmittedEventLiveSnapshot(&ev)
	if s.compiled.Features.Has(planbundle.FeatureTargetMarkConsumption) && ev.eventType == model.EventTypeBasicAttackHit {
		// Retain the native contact for the new operation without authorizing
		// public event.skill_hit formula reads on ordinary attack listeners.
		ev.snapshot.SkillHit = freeze.FrozenFacts()
	}
	if err := s.dispatchListeners(ev, chainDepth); err != nil {
		return err
	}
	if freeze.View().Blocked == 1 && !freeze.View().ReusedSkillUnit {
		if err := s.dispatchSpellShieldBlocked(ev, freeze, chainDepth); err != nil {
			return err
		}
	}
	if ev.eventType == model.EventTypeBasicAttackHit && len(freeze.Waits()) != 0 {
		if err := s.executeEmpoweredGroup(ev, freeze.Waits(), chainDepth); err != nil {
			return err
		}
	}
	if ev.eventType == model.EventTypeBasicAttackHit {
		return s.executeReservedEmpoweredAttack(ev, chainDepth)
	}
	return nil
}

func (s *Engine) executeSkillHitCandidate(ev emittedEvent, freeze *frozenSkillHitContext, cand planbundle.CompiledSkillHitCandidate, skipWrites bool, chainDepth int) *model.EngineError {
	ops, err := s.skillHitCandidateOperations(freeze, cand, skipWrites)
	if err != nil {
		return err
	}
	var frameStorage Frame
	s.initSkillHitCandidateFrame(&frameStorage, ev, freeze, chainDepth)
	frame := &frameStorage
	frame.skipBlockedWrites = skipWrites
	frame.skillHitCandidateKey = cand.CandidateKey
	if err := frame.executeOperations(freeze.Ability(), ops); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	frame.maybeQueueDamageDealtEvent(freeze.Ability())
	return frame.dispatchPendingEvents()
}

func (s *Engine) skillHitCandidateOperations(freeze *frozenSkillHitContext, cand planbundle.CompiledSkillHitCandidate, skipWrites bool) ([]planbundle.CompiledOperation, *model.EngineError) {
	return hit.CandidateOperations(freeze, cand, skipWrites, s.compiled.Operations, s.compiled.Providers, s)
}

func (s *Engine) initSkillHitCandidateFrame(frame *Frame, ev emittedEvent, freeze *frozenSkillHitContext, chainDepth int) {
	s.initExecutionFrame(frame, freeze.View().SourceKey, freeze.View().TargetKey, freeze.AbilityRef())
	frame.chainDepth = chainDepth
	frame.rootSkillHitDamage = freeze.View().RootDamageEvent
	frame.eventCtx = cloneEventSnapshot(&ev.snapshot)
	if frame.eventCtx != nil && ev.eventType == model.EventTypeSkillHit {
		frame.eventCtx.HasSkillHit = true
		frame.eventCtx.SkillHit = freeze.FrozenFacts()
	}
	frame.castInstanceID = ev.castInstanceID
	frame.castOrigin = ev.castOrigin
	frame.skillHitOccurrenceID = freeze.View().OccurrenceID
}

func (s *Engine) dispatchSpellShieldBlocked(parent emittedEvent, freeze *frozenSkillHitContext, chainDepth int) *model.EngineError {
	snap := parent.snapshot
	snap.EventType = model.EventTypeSpellShieldBlocked
	snap.HasSkillHit = true
	snap.SkillHit = freeze.FrozenFacts()
	ev := emittedEvent{
		eventType:      model.EventTypeSpellShieldBlocked,
		ref:            model.EventTypeSpellShieldBlocked,
		sourceKey:      freeze.View().SourceKey,
		targetKey:      freeze.View().TargetKey,
		types:          []string{model.EventTypeSpellShieldBlocked},
		snapshot:       snap,
		castInstanceID: parent.castInstanceID,
		castOrigin:     parent.castOrigin,
		skillHit:       freeze,
	}
	s.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{
			TimeMs: s.loop.TimeMs(),
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    model.EventTypeSpellShieldBlocked,
			Data:   skillHitEvidenceData(freeze),
		}
	})
	return s.dispatchListeners(ev, chainDepth)
}

func (f *Frame) expireProviderFromEvent(op planbundle.CompiledOperation) *model.EngineError {
	input := lifecycle.FrozenShieldRemoval{Event: f.eventCtx, AbilityRef: f.abilityRef,
		ListenerOwner: f.ownerCombatantKey, ListenerRef: f.ownerProviderRef, Source: f.sourceKey,
		SchemaHash: f.run.compiled.SchemaHash, RulesHash: f.run.compiled.RulesHash, SessionID: f.run.req.SessionID}
	if f.eventCtx != nil && f.eventCtx.SkillHit != nil {
		owner, present := f.run.combatants[f.eventCtx.SkillHit.ShieldOwner]
		input.OwnerPresent, input.Providers = present, owner.instances.Providers()
	}
	mutation, err := lifecycle.PrepareFrozenShieldRemoval(input)
	if err != nil {
		return err
	}
	staged := f.stageFor(mutation.TargetKey)
	staged.providerOps = append(staged.providerOps, mutation)
	staged.dirty = true
	return nil
}

func (s *Engine) bindDynamicProviderListeners() *model.EngineError {
	static := map[string]bool{}
	for _, combatant := range s.compiled.Combatants {
		for _, mount := range combatant.ProviderMounts {
			static[combatant.Key+"\x00"+mount.ProviderRef] = true
		}
	}
	for _, c := range s.combatants {
		for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			inst := instanceValues.At(instanceIndex)
			if static[c.numbers.Key()+"\x00"+inst.ProviderRef] {
				continue
			}
			if err := s.bindProviderInstanceListeners(inst); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) bindProviderInstanceListeners(inst effectpkg.Provider) *model.EngineError {
	if int(inst.DefinitionIndex) >= len(s.compiled.Providers) {
		return nil
	}
	provider := s.compiled.Providers[inst.DefinitionIndex]
	if !s.listeners.Bind(provider.Listeners, inst.Owner, inst.ProviderRef) {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "dynamic listener identity space exhausted", "providers["+inst.ProviderRef+"].listeners", inst.ProviderRef)
	}
	return nil
}

func (s *Engine) unbindProviderInstanceListeners(ownerKey, providerRef string) {
	s.listeners.Unbind(ownerKey, providerRef)
}

func (s *Engine) listenerStillLive(listener planbundle.CompiledListener) bool {
	if listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" {
		return true
	}
	c, ok := s.combatants[listener.OwnerCombatantKey]
	if !ok {
		return false
	}
	inst, _, found := c.instances.Providers().Find(listener.OwnerProviderRef)
	if !found {
		return false
	}
	return !inst.Expired(s.loop.TimeMs())
}

func (s *Engine) RuleGroupOrigin(ev emittedEvent, freeze *frozenSkillHitContext) hit.RuleOrigin {
	ref, exists := s.compiled.AbilityRefIndex[freeze.AbilityRef()]
	origin := hit.RuleOrigin{Reference: ref, HasReference: exists, Combatants: s.compiled.Combatants,
		Abilities: s.compiled.Abilities, Providers: s.compiled.Providers, Operations: s.compiled.Operations,
		EventType: ev.eventType, HasUse: ev.hasUse, UseKey: ev.useKey, UseSource: ev.useSource, UseSkillKey: ev.useSkillKey, TargetKey: ev.targetKey}
	if owner, found := s.combatants[freeze.View().SourceKey]; found {
		origin.LiveProviders = owner.instances.Providers()
	}
	if use := s.skillUses[freeze.View().UseRef]; use != nil {
		origin.KnownUse = true
		origin.RegisteredUseSource, origin.RegisteredSkillKey = use.identity.Source(), use.identity.SkillKey()
	}
	return origin
}

func (s *Engine) RuleGroupReservationFailure(err *model.EngineError) {
	if err != nil && err.BudgetCause != "" {
		s.budgetCause = err.BudgetCause
	}
}

func (s *Engine) RunRuleGroupFrame(ev emittedEvent, freeze *frozenSkillHitContext, group planbundle.CompiledSkillHitRuleGroup, grant hit.RuleGrant, token usage.Reservation, chainDepth int) *model.EngineError {
	collector := eventCopyableCollector{}
	collector.SetReservation(token)
	var frameStorage Frame
	s.initSkillHitCandidateFrame(&frameStorage, ev, freeze, chainDepth)
	frame := &frameStorage
	frame.ownerCombatantKey, frame.ownerProviderRef = grant.Key.Owner, grant.Key.ProviderRef
	frame.strictReads = true
	frame.copyableCollector = &collector
	return hit.ExecuteRuleGroup(freeze, group, frame)
}

func (s *Engine) executeSkillHitRuleGroup(ev emittedEvent, freeze *frozenSkillHitContext, group planbundle.CompiledSkillHitRuleGroup, chainDepth int) *model.EngineError {
	return hit.ExecuteAdmittedGroup(freeze, group, ev, chainDepth, s.hitIdentity(), &s.useTriggerLedger, s)
}

func (s *Engine) skillHitGroupMountLive(owner, provider string, definition uint16) bool {
	actor, found := s.combatants[owner]
	return found && hit.RuleMountLive(owner, provider, definition, s.compiled.Providers, actor.instances.Providers())
}
