package runtime

import (
	"strconv"

	"tinygo_engine_v2/internal/model"
)

// The driver currently resolves the hit immediately. Keeping the actual start
// boundary separate lets a reservation outlive its empowerment process without
// inventing a second attack or accepting caller-produced start events.
func (s *genericRunState) beginNativeBasicAttackUse() (string, string, *model.EngineError) {
	b := s.basicAttack
	if b == nil || s.initializationPending != 0 || s.combatantHp(b.plan.Source) <= 0 || s.combatantHp(b.plan.Target) <= 0 || s.actionOccupied(b.plan.Source) {
		return "", "", s.basicAttackErr("native attack start is unavailable", "driverPlan.basicAttack")
	}
	b.wait = nil
	b.summary.StartedCount++
	index := b.summary.StartedCount
	useRef := "basic:" + b.plan.PlanKey + ":" + strconv.Itoa(index)
	startKey, hitKey := useRef+":start", useRef+":hit"
	b.current = &model.BasicAttackRecord{PlanKey: b.plan.PlanKey, AttackIndex: index, UseRef: useRef, Source: b.plan.Source, Target: b.plan.Target, SkillKey: b.plan.SkillKey, StartAtMs: s.nowMs, AttackSpeed: s.combatants[b.plan.Source].attributes.At(b.plan.AttackSpeedAttributeKey).Resolved}
	b.currentRecordIndex = -1
	if s.detailedOutput() && len(s.attackRecords) < s.maxAttackRecords {
		b.currentRecordIndex = len(s.attackRecords)
		s.attackRecords = append(s.attackRecords, *b.current)
	}
	b.unfinishedTail = true
	s.skillUses[useRef] = &skillUseRuntime{useKey: useRef, source: b.plan.Source, skillKey: b.plan.SkillKey, historyState: model.SkillHitHistoryComplete}
	s.attackStartFacts[startKey] = model.AttackStartFact{DriverEntryKey: startKey, UseRef: useRef}
	sequence := 1
	s.skillHitFacts[hitKey] = model.SkillHitFact{DriverEntryKey: hitKey, UseRef: &useRef, Sequence: &sequence}
	startEntry := model.DriverEntry{EntryKey: startKey, AbilityRef: b.plan.StartAbilityRef, Source: b.plan.Source, Target: b.plan.Target, FirstAtMs: s.nowMs}
	s.abilityAttemptCount++
	s.statFor(b.plan.StartAbilityRef).attemptCount++
	if err := s.executeAbilityCast(startEntry); err != nil {
		return "", "", err
	}
	if s.processFailure != nil {
		return "", "", s.processFailure
	}
	found := false
	for _, p := range s.processInstances {
		if p.UseKey == useRef && p.abilityRef == b.plan.InitialControlAbilityRef && p.Owner == b.plan.Source && p.Target == b.plan.Target && p.SkillKey == b.plan.SkillKey && p.Status == "complete" {
			found = true
			break
		}
	}
	if !found {
		return "", "", s.basicAttackErr("native start did not complete its actual attack process", b.plan.InitialControlAbilityRef)
	}
	ready := s.combatants[b.plan.Source].cooldowns.abilityReadyAt(b.plan.Source, b.plan.InitialControlAbilityRef)
	if ready <= s.nowMs || ready > maxJSONSafeInteger || b.wait == nil || s.basicAttackReadyAt() != ready || b.current.ReadyAtMs == nil {
		return "", "", s.basicAttackErr("attack process did not commit its unique valid cooldown waiting node", b.plan.InitialControlAbilityRef)
	}
	if s.combatantHp(b.plan.Source) <= 0 || s.combatantHp(b.plan.Target) <= 0 {
		return "", "", s.basicAttackErr("combatant died before native hit", "driverPlan.basicAttack")
	}
	if err := s.reserveEmpoweredAttackStart(useRef, b.plan.Target); err != nil {
		return "", "", err
	}
	return useRef, hitKey, nil
}
