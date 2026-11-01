package execution

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// The driver currently resolves the hit immediately. Keeping the actual start
// boundary separate lets a reservation outlive its empowerment process without
// inventing a second attack or accepting caller-produced start events.
func (s *Engine) beginNativeBasicAttackUse() (string, string, *model.EngineError) {
	b := s.actions.BasicAttack()
	if b == nil || s.initializationPending != 0 || s.combatantHp(b.Plan().Source) <= 0 || s.combatantHp(b.Plan().Target) <= 0 || s.actionOccupied(b.Plan().Source) {
		return "", "", s.basicAttackErr("native attack start is unavailable", "driverPlan.basicAttack")
	}
	useRef, startKey, hitKey := s.actions.BeginAttack(s.loop.TimeMs(), s.combatants[b.Plan().Source].attributesView().At(b.Plan().AttackSpeedAttributeKey).Resolved)
	s.actions.SetAttackRecordIndex(s.report.AppendAttack(b.Current().Snapshot(), s.detailedOutput()))
	s.skillUses[useRef] = &skillUseRuntime{identity: s.actions.NewUse(actionpkg.UseSeed{UseKey: useRef, Source: b.Plan().Source, SkillKey: b.Plan().SkillKey, HistoryState: model.SkillHitHistoryComplete})}
	s.attackStartFacts[startKey] = model.AttackStartFact{DriverEntryKey: startKey, UseRef: useRef}
	sequence := 1
	s.hits.PutFact(hitKey, model.SkillHitFact{DriverEntryKey: hitKey, UseRef: &useRef, Sequence: &sequence})
	startEntry := model.DriverEntry{EntryKey: startKey, AbilityRef: b.Plan().StartAbilityRef, Source: b.Plan().Source, Target: b.Plan().Target, FirstAtMs: s.loop.TimeMs()}
	s.report.Attempt(b.Plan().StartAbilityRef)
	if err := s.executeAbilityCast(startEntry); err != nil {
		return "", "", err
	}
	if s.processFailure != nil {
		return "", "", s.processFailure
	}
	found := false
	for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
		p := s.actions.ProcessAt(processSlot)
		if p.UseKey() == useRef && p.AbilityRef() == b.Plan().InitialControlAbilityRef && p.Owner() == b.Plan().Source && p.Target() == b.Plan().Target && p.SkillKey() == b.Plan().SkillKey && p.Status() == "complete" {
			found = true
			break
		}
	}
	if !found {
		return "", "", s.basicAttackErr("native start did not complete its actual attack process", b.Plan().InitialControlAbilityRef)
	}
	ready := s.combatants[b.Plan().Source].cooldowns.AbilityReadyAt(b.Plan().Source, b.Plan().InitialControlAbilityRef)
	if ready <= s.loop.TimeMs() || ready > maxJSONSafeInteger || b.Wait() == nil || s.basicAttackReadyAt() != ready || b.Current().ReadyAtMs() == nil {
		return "", "", s.basicAttackErr("attack process did not commit its unique valid cooldown waiting node", b.Plan().InitialControlAbilityRef)
	}
	if s.combatantHp(b.Plan().Source) <= 0 || s.combatantHp(b.Plan().Target) <= 0 {
		return "", "", s.basicAttackErr("combatant died before native hit", "driverPlan.basicAttack")
	}
	if err := s.reserveEmpoweredAttackStart(useRef, b.Plan().Target); err != nil {
		return "", "", err
	}
	return useRef, hitKey, nil
}
