package runtime

import (
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func modeAugmentsFrom(ids []string) map[string]bool {
	if len(ids) == 0 {
		return nil
	}
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id != "" {
			set[id] = true
		}
	}
	return set
}

func actionInputsFrom(bundle compilebundle.CompiledBundle, template compilebundle.CompiledActor, overrides map[string]model.ActionRunInput) []ActionInputState {
	inputs := make([]ActionInputState, len(bundle.Actions))
	for _, actionID := range template.Actions {
		if int(actionID) >= len(bundle.Actions) {
			continue
		}
		action := bundle.Actions[actionID]
		inputs[actionID] = ActionInputState{
			SkillLevel:  defaultSkillLevel(action.SkillLevel),
			PanelInputs: copyFloatMap(action.PanelInputs),
		}
		if override, ok := overrides[action.ID]; ok {
			if override.SkillLevel > 0 {
				inputs[actionID].SkillLevel = override.SkillLevel
			}
			if len(override.PanelInputs) > 0 {
				inputs[actionID].PanelInputs = mergeFloatMaps(inputs[actionID].PanelInputs, override.PanelInputs)
			}
		}
	}
	return inputs
}

func defaultSkillLevel(value int) int {
	if value > 0 {
		return value
	}
	return 1
}

func (ctx *RunContext) actionSkillLevel(actor uint8, action uint16) int {
	if int(actor) >= len(ctx.Actors) || int(action) >= len(ctx.Actors[actor].ActionInputs) {
		return 1
	}
	return defaultSkillLevel(ctx.Actors[actor].ActionInputs[action].SkillLevel)
}

func (ctx *RunContext) actionPanelInputs(actor uint8, action uint16) map[string]float64 {
	if int(actor) >= len(ctx.Actors) || int(action) >= len(ctx.Actors[actor].ActionInputs) {
		return nil
	}
	return copyFloatMap(ctx.Actors[actor].ActionInputs[action].PanelInputs)
}

func copyFloatMap(input map[string]float64) map[string]float64 {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]float64, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func mergeFloatMaps(base map[string]float64, overrides map[string]float64) map[string]float64 {
	merged := copyFloatMap(base)
	if len(merged) == 0 {
		merged = make(map[string]float64, len(overrides))
	}
	for key, value := range overrides {
		merged[key] = value
	}
	return merged
}
