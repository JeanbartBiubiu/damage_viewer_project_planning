package runtime

import "tinygo_engine_v2/internal/model"

type damageBreakdownKey struct{ owner, source, target, ability, operation, damageType, definition string }

// This hook sees only committed damage; retention limits never affect totals.
func (s *genericRunState) recordCommittedDamage(f *executionFrame, ev genericDamageEvidence) {
	if ev.outcome == nil {
		return
	}
	if s.damageBreakdownIndex == nil {
		s.damageBreakdownIndex = map[damageBreakdownKey]int{}
	}
	data := genericDamageEvidenceItem(ev, s.nowMs).Data
	data["owner"] = ev.owner
	if ev.providerDefinitionRef != "" {
		data["providerDefinitionRef"] = ev.providerDefinitionRef
		if ev.providerActivatedAtMs != nil {
			data["providerActivatedAtMs"] = *ev.providerActivatedAtMs
		}
	}
	data["operationPath"] = ev.operationPath
	data["hpBefore"] = ev.hpBefore
	data["hpAfter"] = ev.hpAfter
	data["sourceHpBefore"], data["sourceHpAfter"] = nil, nil
	if ev.hasSourceHp {
		data["sourceHpBefore"], data["sourceHpAfter"] = ev.sourceHpBefore, ev.sourceHpAfter
		if s.basicAttack != nil {
			if ev.source == s.basicAttack.plan.Source {
				s.sourceVampHealing += ev.sourceHpAfter - ev.sourceHpBefore
			} else if ev.source == s.basicAttack.plan.Target {
				s.targetVampHealing += ev.sourceHpAfter - ev.sourceHpBefore
			}
		}
	}
	data["castInstanceId"] = ev.castInstanceID
	data["abilityRef"] = ev.abilityRef
	data["operationRef"] = ev.operationRef
	data["useRef"] = ""
	data["attackIndex"] = 0
	data["timeMs"] = s.nowMs
	if s.basicAttack != nil && s.basicAttack.current != nil && s.basicAttackEventActive {
		row := s.basicAttack.current
		data["useRef"], data["attackIndex"] = row.UseRef, row.AttackIndex
		if ev.source == s.basicAttack.plan.Source && ev.target == s.basicAttack.plan.Target {
			row.PostDefenseDamage += ev.outcome.MitigatedAmount
			row.ActualHpLoss += ev.outcome.HPDamage
		}
	}
	if s.basicAttack != nil && ev.target == s.basicAttack.plan.Target && ev.hpBefore > 0 && ev.hpAfter <= 0 && s.basicAttack.targetKilledAt == nil {
		at := s.nowMs
		s.basicAttack.targetKilledAt = &at
	}
	if ev.target == model.SelectorSource {
		s.sourceHpLoss += ev.outcome.HPDamage
	}
	if ev.target == model.SelectorTarget {
		s.targetHpLoss += ev.outcome.HPDamage
	}
	overkill := data["overkillDamage"].(float64)
	key := damageBreakdownKey{ev.owner, ev.source, ev.target, ev.abilityRef, ev.operationRef, ev.damageType, ev.providerDefinitionRef}
	index, ok := s.damageBreakdownIndex[key]
	if !ok {
		index = len(s.damageBreakdown)
		s.damageBreakdownIndex[key] = index
		s.damageBreakdown = append(s.damageBreakdown, model.DamageBreakdown{Owner: ev.owner, Source: ev.source, Target: ev.target, AbilityRef: ev.abilityRef, OperationRef: ev.operationRef, DamageType: ev.damageType, ProviderDefinitionRef: ev.providerDefinitionRef})
	}
	group := &s.damageBreakdown[index]
	group.DamageCount++
	group.PostDefenseDamage += ev.outcome.MitigatedAmount
	group.ShieldAbsorbed += ev.outcome.ShieldAbsorbed
	group.ActualHpLoss += ev.outcome.HPDamage
	group.OverkillDamage += overkill
	s.damageRecordCount++
	if len(s.damageRecords) < s.maxDamageRecords {
		s.damageRecords = append(s.damageRecords, data)
	}
}

func (s *genericRunState) executionSummary() *model.RunExecutionSummary {
	if s.basicAttack == nil {
		return nil
	}
	b := s.basicAttack
	dead := s.combatantHp(b.plan.Source) <= 0 || s.combatantHp(b.plan.Target) <= 0
	complete := s.budgetCause == "" && !b.unfinishedTail && (dead || s.nowMs >= s.startMs+s.durationMs)
	result := &model.RunExecutionSummary{RequestedDurationMs: s.durationMs, Complete: complete, TargetKilled: b.targetKilledAt != nil, TargetKilledAtMs: b.targetKilledAt}
	if s.budgetCause != "" {
		cause := s.budgetCause
		result.BudgetCause = &cause
	}
	if !complete {
		reason := "unfinished_tail"
		if s.budgetCause != "" && (b.current == nil || b.current.HitAtMs == nil || b.current.Completed) {
			reason = "budget_exceeded"
		}
		result.IncompleteReason = &reason
	}
	return result
}

func (s *genericRunState) recordingSummary() model.RecordingSummary {
	attacks := 0
	if s.basicAttack != nil {
		attacks = s.basicAttack.summary.StartedCount
	}
	return model.RecordingSummary{MechanicRecordCount: s.mechanicRecordCount, ReturnedMechanicRecords: len(s.mechanicRecords), DroppedMechanicRecords: s.mechanicRecordCount - len(s.mechanicRecords), MechanicRecordsTruncated: s.mechanicRecordCount > len(s.mechanicRecords), AttackRecordCount: attacks, ReturnedAttackRecords: len(s.attackRecords), DroppedAttackRecords: attacks - len(s.attackRecords), AttackRecordsTruncated: attacks > len(s.attackRecords), DamageRecordCount: s.damageRecordCount, ReturnedDamageRecords: len(s.damageRecords), DroppedDamageRecords: s.damageRecordCount - len(s.damageRecords), DamageRecordsTruncated: s.damageRecordCount > len(s.damageRecords)}
}
