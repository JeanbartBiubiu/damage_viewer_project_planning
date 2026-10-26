package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func (s *Engine) LoopState() scheduler.LoopState {
	basic := s.actions.BasicAttack()
	hasSkillPlan := s.hasSkillPlan()
	skillDead := false
	if hasSkillPlan {
		skillDead = s.actions.Dead(model.SelectorSource) || s.actions.Dead(model.SelectorTarget) || s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0
	}
	return scheduler.LoopState{
		Failure: s.processFailure, Automated: s.automatedRun(),
		HasSkillPlan: hasSkillPlan, HasActions: s.actions.ManualCount() > 0,
		SkillPlanDead:         skillDead,
		BasicWindowSettled:    basic != nil && !basic.UnfinishedTail() && basic.WindowSettled(),
		HasBasicAttack:        basic != nil,
		BasicParticipantsDead: basic != nil && (s.combatantHp(basic.Plan().Source) <= 0 || s.combatantHp(basic.Plan().Target) <= 0),
		MaxEvents:             s.budget.MaxEvents,
	}
}

func (s *Engine) LoopStopState() scheduler.LoopStopState {
	return scheduler.LoopStopState{
		SourceDead:  s.actions.Dead(model.SelectorSource) || s.combatantHasHp(model.SelectorSource) && s.combatantHp(model.SelectorSource) <= 0,
		TargetDead:  s.actions.Dead(model.SelectorTarget) || s.combatantHasHp(model.SelectorTarget) && s.combatantHp(model.SelectorTarget) <= 0,
		BudgetCause: s.budgetCause,
	}
}

func (s *Engine) SelectLoopEvent(event scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError) {
	var err *model.EngineError
	if s.compiled.HasStateOnExpire && s.currentStateOnExpire(event) {
		event, err = s.selectCombatBeforeStateOnExpire(event)
		if err != nil {
			return event, err
		}
	}
	if event.Kind == scheduler.GenericEventProcessTimer && s.effectTimers.HasTerminals() {
		event, err = s.selectAnchoredTerminalBeforeProcessTimer(event)
	}
	return event, err
}

func (s *Engine) HandleLoopEvent(event scheduler.GenericEvent) *model.EngineError {
	if s.hasSkillPlan() || s.currentStateOnExpire(event) || s.compiled.HasTargetTiming {
		s.currentEventCommands = 0
	}
	switch event.Kind {
	case scheduler.GenericEventSourceInitialized:
		return s.handleSourceInitialized(event)
	case scheduler.GenericEventProcessTimer:
		return s.handleProcessTimer(event)
	case scheduler.GenericEventAnchoredTick:
		return s.handleAnchoredTick(event)
	case scheduler.GenericEventExpireCleanup:
		s.handleExpireCleanup(event)
	case scheduler.GenericEventProviderTick:
		return s.handleProviderTick(event)
	case scheduler.GenericEventAbilityAttempt:
		return s.handleAbilityAttempt(event)
	case scheduler.GenericEventSkillAction:
		return s.handleSkillAction(event.SkillActionIndex)
	case scheduler.GenericEventAutomaticSkill:
		return s.handleAutomaticSkills(event)
	case scheduler.GenericEventTriggeredContinuation:
		return s.handleTriggeredContinuation(event)
	case scheduler.GenericEventBasicAttack:
		if s.basicAttackEventCurrent(event) {
			return s.handleBasicAttack()
		}
	case scheduler.GenericEventAmmoRecovery:
		return s.handleAmmoRecovery(event)
	case scheduler.GenericEventAmmoAdmission:
		return s.initializeDrivenAmmo()
	}
	return nil
}

func (s *Engine) ObserveBefore(at int64)  { s.flushSamplesBefore(at) }
func (s *Engine) ObserveThrough(at int64) { s.flushSamplesThrough(at) }
func (s *Engine) ObserveFinal()           { s.appendFinalSample() }
func (s *Engine) PublishLoopWait()        { s.publishBasicAttackWait() }
func (s *Engine) SettleLoopEnd() *model.EngineError {
	if s.compiled.HasResourceMax {
		s.settleLiveResourceExpiry()
		if s.processFailure != nil && s.processFailure.BudgetCause == "" {
			return s.processFailure
		}
	}
	return nil
}
func (s *Engine) LoopBudgetExceeded(cause model.BudgetCause, message string) {
	s.budgetError(cause, message)
}
func (s *Engine) EnsureLoopBudgetCause() {
	if s.budgetCause == "" {
		s.budgetCause = model.BudgetCauseMaxEvents
	}
}
