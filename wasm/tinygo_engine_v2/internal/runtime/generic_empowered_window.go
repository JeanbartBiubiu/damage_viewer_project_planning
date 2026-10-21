package runtime

import (
	"strconv"

	"tinygo_engine_v2/internal/model"
)

type empoweredReservation struct {
	use     *skillUseRuntime
	process *processRuntime
	index   int
}

func (s *genericRunState) reserveEmpoweredAttackStart(useRef, target string) *model.EngineError {
	if s.basicAttack == nil {
		return s.processErr("driverPlan.basicAttack", "counted attack consumption requires its actual native attack plan", useRef)
	}
	var selected *processRuntime
	for _, p := range s.empoweredWaits {
		if p.EmpoweredAttackWindow == nil || p.Owner != s.basicAttack.plan.Source || p.Status != "active" || p.ExpiresAtMs == nil || s.nowMs >= *p.ExpiresAtMs {
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
	attack, use := s.basicAttack, s.skillUses[useRef]
	if attack.current == nil || attack.current.UseRef != useRef || attack.current.StartAtMs != s.nowMs || attack.current.ReadyAtMs == nil || attack.current.Target != target || use == nil || use.source != attack.plan.Source || use.skillKey != attack.plan.SkillKey || use.empoweredProcess != nil || !s.processMounted(selected.Owner, selected.ProviderRef, selected.ability.ProviderIndex) {
		return s.processErr("attackStartFacts", "counted window consumption requires the actual accepted native attack start", useRef)
	}
	p := cloneEmpoweredProcess(selected)
	window := p.EmpoweredAttackWindow
	if window.ConsumptionCount >= window.MaximumAttackCount {
		return s.processErr("processInstances.empoweredAttackWindow", "attack window has no remaining charge", p.UseKey)
	}
	window.ConsumptionCount++
	window.PendingHitCount++
	window.Consumptions = append(window.Consumptions, model.ProcessAttackConsumption{ConsumptionIndex: window.ConsumptionCount, UseRef: useRef, Target: target, StartedAtMs: s.nowMs})
	var frame executionFrame
	s.initExecutionFrame(&frame, p.Owner, p.Target, p.abilityRef)
	frame.empowered = &empoweredFrame{}
	frame.empowered.mutations = append(frame.empowered.mutations, empoweredProcessMutation{selected, p})
	frame.empowered.reservations = append(frame.empowered.reservations, empoweredReservation{use, selected, window.ConsumptionCount - 1})
	if window.ConsumptionCount == window.MaximumAttackCount {
		if err := s.stageCountedEmpoweredCompletion(&frame, p); err != nil {
			return err
		}
	}
	frame.recordEvidenceLazy("empowered_attack_consumed", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.nowMs, Kind: "empowered_attack_consumed", Ref: p.abilityRef,
			Data: map[string]interface{}{"owner": p.Owner, "providerRef": p.ProviderRef, "processKey": p.ProcessKey, "activationUseRef": p.UseKey, "useRef": useRef, "target": target, "consumptionIndex": window.ConsumptionCount, "remaining": window.MaximumAttackCount - window.ConsumptionCount}}
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

func (s *genericRunState) stageCountedEmpoweredCompletion(f *executionFrame, p *processRuntime) *model.EngineError {
	if err := f.withEmpoweredContext(p, p.Target, p.ability, nil, func() *model.EngineError {
		if err := s.applyProcessMoment(p, f, "STEP_COMPLETE", ""); err != nil {
			return err
		}
		at := s.nowMs
		p.Status, p.FinishedAtMs, p.FailureReason = "complete", &at, nil
		return s.applyProcessMoment(p, f, "PROCESS_COMPLETE", "")
	}); err != nil {
		return err
	}
	f.empowered.finished = append(f.empowered.finished, p)
	return nil
}

func (s *genericRunState) finishCountedEmpoweredWindow(original *processRuntime) *model.EngineError {
	if original.Status != "active" {
		return nil
	}
	p := cloneEmpoweredProcess(original)
	var frame executionFrame
	s.initExecutionFrame(&frame, p.Owner, p.Target, p.abilityRef)
	frame.empowered = &empoweredFrame{mutations: []empoweredProcessMutation{{original, p}}}
	if err := s.stageCountedEmpoweredCompletion(&frame, p); err != nil {
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

func (s *genericRunState) executeReservedEmpoweredAttack(ev emittedEvent, depth int) *model.EngineError {
	if ev.skillHit == nil {
		return nil
	}
	use := s.skillUses[ev.skillHit.useRef]
	if use == nil || use.empoweredProcess == nil {
		return nil
	}
	original, index := use.empoweredProcess, use.empoweredConsumption
	window := original.EmpoweredAttackWindow
	if window == nil || index < 0 || index >= len(window.Consumptions) {
		return s.processErr("skillUses", "native attack has an invalid counted-window reservation", use.useKey)
	}
	reservation := window.Consumptions[index]
	if reservation.ResolvedAtMs != nil {
		return nil
	}
	if reservation.UseRef != use.useKey || reservation.Target != ev.targetKey || use.source != original.Owner || ev.sourceKey != original.Owner || !ev.skillHit.ability.IsBasicAttack || ev.skillHit.hitSequence == nil || !s.processMounted(original.Owner, original.ProviderRef, original.ability.ProviderIndex) {
		return s.processErr("skillHitFacts", "counted payload must retain its original actual attack identity", use.useKey)
	}
	activation := s.skillUses[original.UseKey]
	if activation == nil || activation.source != original.Owner || activation.skillKey != original.SkillKey || activation.historyState != model.SkillHitHistoryComplete || len(activation.contacts)+len(activation.prior) >= maxSkillHistoryContacts {
		return s.processErr("skillUses", "counted window requires its actual activation history", original.UseKey)
	}
	p := cloneEmpoweredProcess(original)
	window = p.EmpoweredAttackWindow
	row := &window.Consumptions[index]
	at, hit, sequence := s.nowMs, "hit:"+strconv.FormatUint(ev.skillHit.occurrenceID, 10), *ev.skillHit.hitSequence
	row.ResolvedAtMs, row.HitRef, row.HitSequence = &at, &hit, &sequence
	window.PendingHitCount--
	association := &model.ProcessEmpoweredAttack{UseRef: use.useKey, HitRef: hit, Target: ev.targetKey}
	p.EmpoweredAttack = association
	var frame executionFrame
	s.initExecutionFrame(&frame, ev.sourceKey, ev.targetKey, ev.skillHit.abilityRef)
	frame.empowered = &empoweredFrame{}
	frame.chainDepth, frame.strictReads = depth, true
	if err := frame.withEmpoweredContext(p, ev.targetKey, p.ability, association, func() *model.EngineError {
		// Payload executions do not advance the waiting step or invalidate its timer.
		frame.recordProcess(p, "process_moment", "STEP_EXECUTION")
		frame.empowered.moments = append(frame.empowered.moments, empoweredMoment{process: *p, kind: "STEP_EXECUTION"})
		return frame.executeEmpoweredPayload(ev, p, s.compiled.Abilities[p.empoweredAbilityIndex])
	}); err != nil {
		return err
	}
	frame.empowered.mutations = append(frame.empowered.mutations, empoweredProcessMutation{original, p})
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
func (s *genericRunState) finishReservedEmpoweredMiss(useRef string) *model.EngineError {
	use := s.skillUses[useRef]
	if use == nil || use.empoweredProcess == nil {
		return nil
	}
	attack := s.basicAttack
	if attack == nil || attack.current == nil || attack.current.UseRef != useRef || !attack.current.Completed || attack.current.HitAtMs != nil || use.source != attack.plan.Source || use.skillKey != attack.plan.SkillKey {
		return s.processErr("attackStartFacts", "a missed reservation requires its actual completed native attack", useRef)
	}
	p := use.empoweredProcess
	row := &p.EmpoweredAttackWindow.Consumptions[use.empoweredConsumption]
	if row.ResolvedAtMs != nil {
		return nil
	}
	at := s.nowMs
	row.ResolvedAtMs = &at
	p.EmpoweredAttackWindow.PendingHitCount--
	return s.publishProcessResolved(p)
}
