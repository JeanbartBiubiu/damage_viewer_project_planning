package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func (s *Engine) budgetError(cause model.BudgetCause, message string) *model.EngineError {
	if s.budgetCause == "" {
		s.budgetCause = cause
	}
	err := engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	err.BudgetCause = cause
	return err
}

func (s *Engine) consumeEventCommands(count int) *model.EngineError {
	if count < 0 || s.currentEventCommands > s.budget.MaxCommandsPerEvent-count {
		s.currentEventCommands = s.budget.MaxCommandsPerEvent + 1
		return s.budgetError(model.BudgetCauseMaxCommandsPerEvent, "event command budget exceeded")
	}
	s.currentEventCommands += count
	return nil
}

func (s *Engine) pushCombatEvent(ev scheduler.GenericEvent) bool {
	if s.loop.Queue().Push(ev) == model.ErrOK {
		return true
	}
	if s.processFailure == nil {
		s.processFailure = s.budgetError(model.BudgetCauseMaxQueueEvents, "event queue capacity exceeded")
	}
	return false
}
