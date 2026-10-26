package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"strconv"

	"tinygo_engine_v2/internal/model"
)

type empoweredReservation struct {
	use     *skillUseRuntime
	process *actionpkg.ProcessView
	index   int
}

func (s *Engine) reserveEmpoweredAttackStart(useRef, target string) *model.EngineError {
	if s.actions.BasicAttack() == nil {
		return s.processErr("driverPlan.basicAttack", "counted attack consumption requires its actual native attack plan", useRef)
	}
	var selected *actionpkg.ProcessView
	for empoweredSlot := 0; empoweredSlot < s.actions.EmpoweredCount(); empoweredSlot++ {
		p := s.actions.EmpoweredAt(empoweredSlot)
		if !p.HasEmpoweredWindow() || p.Owner() != s.actions.BasicAttack().Plan().Source || p.Status() != "active" || !p.HasExpiry() || s.loop.TimeMs() >= p.Expiry() {
			continue
		}
		if selected != nil {
			return s.processErr("processInstances", "an actual attack cannot choose between simultaneous counted windows", useRef)
		}
		selected = p
	}
	if selected == nil {
		return nil
	}
	attack, use := s.actions.BasicAttack(), s.skillUses[useRef]
	if attack.Current() == nil || attack.Current().UseRef() != useRef || attack.Current().StartAtMs() != s.loop.TimeMs() || attack.Current().ReadyAtMs() == nil || attack.Current().Target() != target || use == nil || use.identity.Source() != attack.Plan().Source || use.identity.SkillKey() != attack.Plan().SkillKey || use.identity.EmpoweredReference().Present || !s.processMounted(selected.Owner(), selected.ProviderRef(), selected.Ability().ProviderIndex) {
		return s.processErr("attackStartFacts", "counted window consumption requires the actual accepted native attack start", useRef)
	}
	changes := actionpkg.StageProcess(selected)
	p := changes.View()
	index, allowed := changes.ReserveEmpowered(useRef, target, s.loop.TimeMs())
	if !allowed {
		return s.processErr("processInstances.empoweredAttackWindow", "attack window has no remaining charge", p.UseKey())
	}
	var frame Frame
	s.initExecutionFrame(&frame, p.Owner(), p.Target(), p.AbilityRef())
	frame.empowered = &empoweredFrame{}
	frame.empowered.mutations = append(frame.empowered.mutations, empoweredProcessMutation{selected, changes})
	frame.empowered.reservations = append(frame.empowered.reservations, empoweredReservation{use, selected, index})
	if p.WindowConsumed() == p.WindowMaximum() {
		if err := s.stageCountedEmpoweredCompletion(&frame, changes); err != nil {
			return err
		}
	}
	frame.recordEvidenceLazy("empowered_attack_consumed", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "empowered_attack_consumed", Ref: p.AbilityRef(),
			Data: map[string]interface{}{"owner": p.Owner(), "providerRef": p.ProviderRef(), "processKey": p.ProcessKey(), "activationUseRef": p.UseKey(), "useRef": useRef, "target": target, "consumptionIndex": p.WindowConsumed(), "remaining": p.WindowMaximum() - p.WindowConsumed()}}
	})
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	return s.publishProcessResolved(selected)
}

func (s *Engine) stageCountedEmpoweredCompletion(f *Frame, changes *actionpkg.ProcessChangeSet) *model.EngineError {
	p := changes.View()
	if err := f.withEmpoweredContext(changes, p.Target(), p.Ability(), nil, func() *model.EngineError {
		if err := s.applyProcessMoment(p, f, "STEP_COMPLETE", ""); err != nil {
			return err
		}
		changes.Finish("complete", "", s.loop.TimeMs())
		return s.applyProcessMoment(p, f, "PROCESS_COMPLETE", "")
	}); err != nil {
		return err
	}
	f.empowered.finished = append(f.empowered.finished, p)
	return nil
}

func (s *Engine) finishCountedEmpoweredWindow(original *actionpkg.ProcessView) *model.EngineError {
	if original.Status() != "active" {
		return nil
	}
	changes := actionpkg.StageProcess(original)
	p := changes.View()
	var frame Frame
	s.initExecutionFrame(&frame, p.Owner(), p.Target(), p.AbilityRef())
	frame.empowered = &empoweredFrame{mutations: []empoweredProcessMutation{{original, changes}}}
	if err := s.stageCountedEmpoweredCompletion(&frame, changes); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	return s.publishProcessResolved(original)
}

func (s *Engine) executeReservedEmpoweredAttack(ev emittedEvent, depth int) *model.EngineError {
	if ev.skillHit == nil {
		return nil
	}
	use := s.skillUses[ev.skillHit.useRef]
	if use == nil || !use.identity.EmpoweredReference().Present {
		return nil
	}
	original, index := s.actions.Process(use.identity.EmpoweredReference()), use.identity.EmpoweredConsumption()
	if original == nil {
		return s.processErr("skillUses", "native attack has an invalid process reference", use.identity.UseKey())
	}
	window := original
	if !window.HasEmpoweredWindow() || index < 0 || index >= window.ConsumptionCount() {
		return s.processErr("skillUses", "native attack has an invalid counted-window reservation", use.identity.UseKey())
	}
	reservation := window.Consumption(index)
	if reservation.ResolvedAtMs != nil {
		return nil
	}
	if reservation.UseRef != use.identity.UseKey() || reservation.Target != ev.targetKey || use.identity.Source() != original.Owner() || ev.sourceKey != original.Owner() || !ev.skillHit.ability.IsBasicAttack || ev.skillHit.hitSequence == nil || !s.processMounted(original.Owner(), original.ProviderRef(), original.Ability().ProviderIndex) {
		return s.processErr("skillHitFacts", "counted payload must retain its original actual attack identity", use.identity.UseKey())
	}
	activation := s.skillUses[original.UseKey()]
	if activation == nil || activation.identity.Source() != original.Owner() || activation.identity.SkillKey() != original.SkillKey() || activation.identity.HistoryState() != model.SkillHitHistoryComplete || len(activation.contacts)+len(activation.prior) >= maxSkillHistoryContacts {
		return s.processErr("skillUses", "counted window requires its actual activation history", original.UseKey())
	}
	changes := actionpkg.StageProcess(original)
	p := changes.View()

	hit, sequence := "hit:"+strconv.FormatUint(ev.skillHit.occurrenceID, 10), *ev.skillHit.hitSequence
	changes.ResolveEmpowered(index, s.loop.TimeMs(), hit, sequence)
	association := &model.ProcessEmpoweredAttack{UseRef: use.identity.UseKey(), HitRef: hit, Target: ev.targetKey}
	changes.SetEmpoweredAttack(association)
	var frame Frame
	s.initExecutionFrame(&frame, ev.sourceKey, ev.targetKey, ev.skillHit.abilityRef)
	frame.empowered = &empoweredFrame{}
	frame.chainDepth, frame.strictReads = depth, true
	if err := frame.withEmpoweredContext(changes, ev.targetKey, p.Ability(), association, func() *model.EngineError {
		// Payload executions do not advance the waiting step or invalidate its timer.
		frame.recordProcess(p, "process_moment", "STEP_EXECUTION")
		frame.empowered.moments = append(frame.empowered.moments, empoweredMoment{process: p.Freeze(), kind: "STEP_EXECUTION"})
		return frame.executeEmpoweredPayload(ev, p, s.compiled.Abilities[p.EmpoweredAbilityIndex()])
	}); err != nil {
		return err
	}
	frame.empowered.mutations = append(frame.empowered.mutations, empoweredProcessMutation{original, changes})
	frame.empowered.contacts = append(frame.empowered.contacts, empoweredContact{p, *association})
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	return s.publishProcessResolved(original)
}

// Only the native attack continuation may close a reserved use without a hit.
// Expiring/completing the empowerment window itself never guesses a miss.
func (s *Engine) finishReservedEmpoweredMiss(useRef string) *model.EngineError {
	use := s.skillUses[useRef]
	if use == nil || !use.identity.EmpoweredReference().Present {
		return nil
	}
	attack := s.actions.BasicAttack()
	if attack == nil || attack.Current() == nil || attack.Current().UseRef() != useRef || !attack.Current().Completed() || attack.Current().HitAtMs() != nil || use.identity.Source() != attack.Plan().Source || use.identity.SkillKey() != attack.Plan().SkillKey {
		return s.processErr("attackStartFacts", "a missed reservation requires its actual completed native attack", useRef)
	}
	p := s.actions.Process(use.identity.EmpoweredReference())
	if p == nil {
		return s.processErr("skillUses", "native attack has an invalid process reference", useRef)
	}
	if !s.actions.ResolveEmpoweredMiss(p, use.identity.EmpoweredConsumption(), s.loop.TimeMs()) {
		return nil
	}
	return s.publishProcessResolved(p)
}
