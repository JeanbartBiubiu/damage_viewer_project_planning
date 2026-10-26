package execution

import (
	model "tinygo_engine_v2/internal/model"
)

// setCombatantAttr writes attr on both compile definition and run snapshot so materialize keeps it.
func setCombatantAttr(compileReq *model.CompileRequest, runReq *model.RunRequest, key, attr string, slot model.AttributeSlotDef) {
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != key {
			continue
		}
		if compileReq.Combatants[i].Attributes == nil {
			compileReq.Combatants[i].Attributes = map[string]model.AttributeSlotDef{}
		}
		compileReq.Combatants[i].Attributes[attr] = slot
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != key {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].Attributes == nil {
			runReq.InitialSnapshot.Combatants[i].Attributes = map[string]model.AttributeSlotDef{}
		}
		runReq.InitialSnapshot.Combatants[i].Attributes[attr] = slot
	}
}
