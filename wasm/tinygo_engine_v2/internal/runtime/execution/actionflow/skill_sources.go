package actionflow

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

func (state SkillActionExecutor) PlannedSources() []*actionpkg.SkillActionView {
	out := make([]*actionpkg.SkillActionView, 0, state.actions.ManualCount()+state.actions.AutomaticCount())
	if !state.actions.HasAutomatic() {
		for index := 0; index < state.actions.ManualCount(); index++ {
			out = append(out, state.actions.ManualAt(index))
		}
		return out
	}
	for index := 0; index < state.actions.AutomaticCount(); index++ {
		rule := state.actions.AutomaticAt(index)
		out = append(out, actionpkg.NewSkillAction(actionpkg.SkillActionSeed{Binding: rule.Binding(), Plan: model.SkillActionPlan{Source: rule.Binding().Source, Target: rule.Plan().Target()}}))
	}
	return out
}
