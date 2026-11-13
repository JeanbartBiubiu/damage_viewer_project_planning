package execution

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
)

func (f *Frame) stagePassiveProcess(ability planbundle.CompiledAbility, operation planbundle.CompiledOperation) *model.EngineError {
	var origin planbundle.CompiledAbility
	if f.eventCtx != nil && f.eventCtx.SkillHit != nil {
		bound, found := f.run.compiled.AbilityRefIndex[f.eventCtx.SkillHit.AbilityRef]
		if found && int(bound.AbilityIndex) < len(f.run.compiled.Abilities) {
			origin = f.run.compiled.Abilities[bound.AbilityIndex]
		}
	}
	input := actionflow.PassiveProcessStart{Owner: f.ownerCombatantKey, Target: f.targetKey, Provider: f.ownerProviderRef,
		AbilityRef: f.abilityRef, Now: f.run.loop.TimeMs(), Ordinal: f.plannedProcessCount(),
		MountedListener: f.mountedListener, Event: f.eventCtx, OriginAbility: origin}
	process, err := f.run.processFlowExecutor().PreparePassiveProcess(input, ability, operation, f.run.compiled.Providers, (*abilityCastReads)(f.run))
	if err != nil || process == nil {
		return err
	}
	if f.plannedProcessCount() >= f.run.budget.MaxProcessInstances {
		return f.run.budgetError(model.BudgetCauseMaxProcessInstances, "passive process instance budget exceeded")
	}
	f.pendingPassiveProcesses.Append(process)
	return nil
}

func (f *Frame) plannedProcessCount() int {
	count := f.run.actions.ProcessCount() + f.pendingPassiveProcesses.Len()
	if f.processIsNew && f.pendingProcess != nil && f.processOriginal != nil {
		count++
	}
	return count
}
