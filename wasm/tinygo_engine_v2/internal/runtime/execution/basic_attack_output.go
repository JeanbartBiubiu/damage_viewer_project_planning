package execution

import (
	"tinygo_engine_v2/internal/model"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
)

// This hook sees only committed damage; retention limits never affect totals.
func (s *Engine) recordCommittedDamage(f *Frame, ev genericDamageEvidence) {
	if ev.outcome == nil {
		return
	}
	s.actions.ObserveAttackDamage(ev.source, ev.target, ev.outcome.MitigatedAmount, ev.outcome.HPDamage, ev.hpBefore, ev.hpAfter, s.loop.TimeMs())
	if s.hasSkillPlan() && ev.target == model.SelectorTarget && ev.hpBefore > 0 && ev.hpAfter <= 0 {
		s.actions.RecordSkillTargetKilled(s.loop.TimeMs())
	}
	vampHealing := 0.0
	if ev.hasSourceHp && s.automatedRun() {
		vampHealing = ev.sourceHpAfter - ev.sourceHpBefore
	}
	if !s.report.RecordCommittedDamage(reportpkg.DamageFact{Owner: ev.owner, Source: ev.source, Target: ev.target, AbilityRef: ev.abilityRef, OperationRef: ev.operationRef, DamageType: ev.damageType, ProviderDefinitionRef: ev.providerDefinitionRef, MitigatedAmount: ev.outcome.MitigatedAmount, ShieldAbsorbed: ev.outcome.ShieldAbsorbed, HPLoss: ev.outcome.HPDamage, VampHealing: vampHealing}, s.detailedOutput()) {
		return
	}
	data := genericDamageEvidenceItem(ev, s.loop.TimeMs()).Data
	if ev.healthOrder != 0 {
		data["healthOrder"] = ev.healthOrder
	}
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
	}
	data["castInstanceId"] = ev.castInstanceID
	data["abilityRef"] = ev.abilityRef
	data["operationRef"] = ev.operationRef
	data["useRef"] = ""
	data["attackIndex"] = 0
	if s.hasSkillPlan() {
		data["attackIndex"] = nil
		data["hitRef"] = nil
		hit := f.skillHitOccurrenceID
		if hit == 0 && f.eventCtx != nil && f.eventCtx.skillHit != nil {
			hit = f.eventCtx.skillHit.occurrenceID
		}
		if hit != 0 {
			data["hitRef"] = "hit:" + itoa(uint32(hit))
		}
	}
	if use := f.skillActionUseRef(); use != "" {
		data["useRef"] = use
		if action := s.skillActionForUse(use); action != nil {
			data["instructionKey"] = action.Plan().InstructionKey()
		}
	}
	data["timeMs"] = s.loop.TimeMs()
	if s.actions.BasicAttack() != nil && s.actions.BasicAttack().Current() != nil && s.actions.AttackActive() {
		row := s.actions.BasicAttack().Current()
		data["useRef"], data["attackIndex"] = row.UseRef(), row.AttackIndex()
	}
	if ev.empoweredAttack != nil {
		data["useRef"], data["hitRef"], data["empoweredAttack"] = ev.activationUseRef, ev.empoweredAttack.HitRef, ev.empoweredAttack
		if action := s.actions.ActionForUse(ev.activationUseRef); action != nil {
			data["instructionKey"] = action.Plan().InstructionKey()
		}
	}
	s.report.AppendDamageDetails(data)
}

func (s *Engine) executionSummary() *model.RunExecutionSummary {
	if s.hasSkillPlan() && s.actions.BasicAttack() == nil {
		killedAt, killed := s.actions.SkillTargetKilledAt()
		var killedAtPtr *int64
		if killed {
			killedAtPtr = &killedAt
		}
		result := &model.RunExecutionSummary{RequestedDurationMs: s.loop.DurationMs(), Complete: s.budgetCause == "" && (s.loop.TimeMs() >= s.loop.StartMs()+s.loop.DurationMs() || s.loop.Reason() == model.StopReasonNoEvents || s.actions.Dead(model.SelectorSource) || s.actions.Dead(model.SelectorTarget) || s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0), TargetKilled: killed, TargetKilledAtMs: killedAtPtr}
		if s.budgetCause != "" {
			cause := s.budgetCause
			result.BudgetCause = &cause
			reason := "budget_exceeded"
			result.IncompleteReason = &reason
		}
		return result
	}
	if s.actions.BasicAttack() == nil {
		return nil
	}
	b := s.actions.BasicAttack()
	dead := s.actions.Dead(b.Plan().Source) || s.actions.Dead(b.Plan().Target) || s.combatantHp(b.Plan().Source) <= 0 || s.combatantHp(b.Plan().Target) <= 0
	complete := s.budgetCause == "" && !b.UnfinishedTail() && (dead || s.loop.TimeMs() >= s.loop.StartMs()+s.loop.DurationMs())
	result := &model.RunExecutionSummary{RequestedDurationMs: s.loop.DurationMs(), Complete: complete, TargetKilled: b.TargetKilledAt() != nil, TargetKilledAtMs: b.TargetKilledAt()}
	if s.budgetCause != "" {
		cause := s.budgetCause
		result.BudgetCause = &cause
	}
	if !complete {
		reason := "unfinished_tail"
		if s.budgetCause != "" && (b.Current() == nil || b.Current().HitAtMs() == nil || b.Current().Completed()) {
			reason = "budget_exceeded"
		}
		result.IncompleteReason = &reason
	}
	return result
}

func (s *Engine) recordingSummary() model.RecordingSummary {
	attacks := 0
	if s.actions.BasicAttack() != nil {
		attacks = s.actions.BasicAttack().StartedCount()
	}
	return s.report.Recording(attacks, s.detailedOutput())
}
