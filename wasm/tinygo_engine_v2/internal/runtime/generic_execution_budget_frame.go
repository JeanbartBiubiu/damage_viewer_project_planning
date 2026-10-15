package runtime

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func parseFrameAbilityOwner(ref string) (string, bool) {
	parsed, ok := planbundle.ParseAbilityRef(ref)
	return parsed.Combatant, ok
}

func (f *executionFrame) commandsSpent() int {
	if f.run.basicAttackEventActive || f.run.initializationEventActive || f.run.hasSkillPlan() {
		return f.run.currentEventCommands
	}
	if f.copyableCollector != nil {
		return f.copyableCollector.commandCount
	}
	return f.commandCount
}

// 整批联动在分配事件前消费额度；失败帧也不退回已经消费的额度。
func (f *executionFrame) consumeCommands(count int) *model.EngineError {
	if f.run.basicAttackEventActive || f.run.initializationEventActive || f.run.hasSkillPlan() {
		return f.run.consumeEventCommands(count)
	}
	remaining := f.run.budget.MaxCommandsPerEvent - f.commandsSpent()
	if count > remaining {
		if f.copyableCollector != nil {
			f.copyableCollector.commandCount = f.run.budget.MaxCommandsPerEvent + 1
		} else {
			f.commandCount = f.run.budget.MaxCommandsPerEvent + 1
		}
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	if f.copyableCollector != nil {
		f.copyableCollector.commandCount += count
	} else {
		f.commandCount += count
	}
	return nil
}
