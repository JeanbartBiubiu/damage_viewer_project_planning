package runtime

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

type basicAttackWait struct {
	anchor     int64
	period     int64
	remaining  float64
	speed      float64
	ready      int64
	generation uint64
}

func basicAttackRemainingDelay(remaining float64, period int64) float64 {
	if remaining <= 0 {
		return 0
	}
	value := remaining * float64(period)
	nearest := math.Round(value)
	spacing := math.Nextafter(value, math.Inf(1)) - value
	if nearest >= 1 && math.Abs(value-nearest) <= math.Min(1e-9, 4*spacing) {
		value = nearest
	}
	return math.Max(1, math.Ceil(value))
}

func (s *genericRunState) beginBasicAttackWait(ready int64, speed float64) *model.EngineError {
	if !s.heap.CanPush(1) {
		return s.budgetError(model.BudgetCauseMaxQueueEvents, "basic attack waiting queue overflow")
	}
	s.basicAttack.waitGeneration++
	s.basicAttack.wait = &basicAttackWait{anchor: s.nowMs, period: ready - s.nowMs, remaining: 1, speed: speed, ready: ready, generation: s.basicAttack.waitGeneration}
	wait := s.basicAttack.wait
	if !s.pushCombatEvent(scheduler.GenericEvent{TimeMs: ready, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1, BasicAttackGeneration: wait.generation}) {
		return s.processFailure
	}
	s.publishBasicAttackWait()
	return nil
}

func (f *executionFrame) prepareBasicAttackWait() (int, *model.EngineError) {
	attack := f.run.basicAttack
	if attack == nil || attack.wait == nil {
		return 0, nil
	}
	staged := f.staged[attack.plan.Source]
	if staged == nil {
		return 0, nil
	}
	speed := staged.attributes[attack.plan.AttackSpeedAttributeKey].Resolved
	if speed == attack.wait.speed {
		return 0, nil
	}
	if math.IsNaN(speed) || math.IsInf(speed, 0) || speed <= 0 || speed > attack.plan.AttackSpeedInputMax {
		return 0, f.run.basicAttackErr("modified attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	if err := f.consumeCommands(1); err != nil {
		return 0, err
	}
	process := f.run.compiled.Providers[attack.initialAbility.ProviderIndex].Processes[attack.initialAbility.ProcessControl.ProcessIndex]
	context := f.run.newExecutionFrame(attack.plan.Source, attack.plan.Target, attack.plan.InitialControlAbilityRef)
	context.staged = f.staged
	context.strictReads = true
	periodValue, err := context.evalAmount(process.Cooldown.DurationProgram, attack.initialAbility)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(periodValue) || math.IsInf(periodValue, 0) || periodValue <= 0 || periodValue > float64(maxJSONSafeInteger) {
		return 0, f.run.basicAttackErr("adjusted attack period must be finite, positive and safe", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	period := int64(math.Max(1, math.Round(periodValue)))
	wait := *attack.wait
	wait.remaining = math.Max(0, wait.remaining-float64(f.run.nowMs-wait.anchor)/float64(wait.period))
	delay := basicAttackRemainingDelay(wait.remaining, period)
	if delay > float64(maxJSONSafeInteger-f.run.nowMs) {
		return 0, f.run.basicAttackErr("adjusted attack time exceeds safe integer range", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	wait.anchor, wait.period, wait.speed = f.run.nowMs, period, speed
	wait.ready = f.run.nowMs + int64(delay)
	wait.generation++
	f.pendingBasicAttackWait = &wait
	staged.cooldowns[attack.plan.InitialControlAbilityRef] = wait.ready
	if !f.run.heap.HasBasicAttack() {
		return 1, nil
	}
	return 0, nil
}

func (f *executionFrame) commitBasicAttackWait() {
	if f.pendingBasicAttackWait == nil {
		return
	}
	wait := f.pendingBasicAttackWait
	f.run.basicAttack.wait = wait
	f.run.basicAttack.waitGeneration = wait.generation
	if !f.run.heap.RescheduleBasicAttack(wait.ready, wait.generation) {
		f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: wait.ready, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1, BasicAttackGeneration: wait.generation})
	}
	f.run.publishBasicAttackWait()
	f.recordEvidence(model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "basic_attack_wait_adjusted", Ref: f.run.basicAttack.plan.InitialControlAbilityRef,
		Data: map[string]interface{}{"periodMs": wait.period, "remainingRatio": wait.remaining, "readyAtMs": wait.ready, "generation": wait.generation}})
}

func (s *genericRunState) publishBasicAttackWait() {
	attack := s.basicAttack
	if attack == nil || attack.current == nil {
		return
	}
	if s.stopReasonSet && (s.stopReason == model.StopReasonBudgetExceeded || s.stopReason == model.StopReasonSourceDead || s.stopReason == model.StopReasonTargetDead || s.stopReason == model.StopReasonBothDead) {
		attack.current.NextStartAtMs = nil
		if attack.currentRecordIndex >= 0 {
			s.attackRecords[attack.currentRecordIndex] = *attack.current
		}
		return
	}
	if attack.wait == nil {
		return
	}
	ready := attack.wait.ready
	attack.current.FinalReadyAtMs = &ready
	attack.current.NextStartAtMs = nil
	attack.windowSettled = ready > s.startMs+s.durationMs
	if !attack.windowSettled && s.combatantHp(attack.plan.Source) > 0 && s.combatantHp(attack.plan.Target) > 0 && s.budgetCause == "" {
		attack.current.NextStartAtMs = &ready
	}
	if attack.currentRecordIndex >= 0 {
		s.attackRecords[attack.currentRecordIndex] = *attack.current
	}
}

func (s *genericRunState) basicAttackEventCurrent(event scheduler.GenericEvent) bool {
	if s.basicAttack == nil {
		return false
	}
	if s.basicAttack.wait == nil {
		return event.BasicAttackGeneration == 0
	}
	wait := s.basicAttack.wait
	return event.BasicAttackGeneration == wait.generation && event.TimeMs == wait.ready && s.combatants[s.basicAttack.plan.Source].cooldowns[s.basicAttack.plan.InitialControlAbilityRef] == wait.ready
}
