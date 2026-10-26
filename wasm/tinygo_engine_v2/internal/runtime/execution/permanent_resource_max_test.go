package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func permanentResourceMaxInput(t *testing.T, current, permanent float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, request := sourceInitializationInput()
	request.StopPolicy.DurationMs = 1
	addFixedEquipment(&input, &request, 0, "actual_health_item", "hp", 150)
	setCombatantAttr(&input, &request, "source", "hp", model.AttributeSlotDef{Base: 1000, Max: 1150 + permanent, Resolved: 1150 + permanent, Current: current})
	addPermanentSkillSource(&input, &request, 0, "natural_health", "character", model.ModifierDefinition{ModifierKey: "permanent_hp", Kind: "resource_max", Target: "self.attr.hp", ValuePolicy: "add", Value: authoringConst(permanent), CurrentValuePolicy: "preserve_initial_current"})
	for i := len(input.SharedProviders) - 2; i < len(input.SharedProviders); i++ {
		input.SharedProviders[i].SkillKey = "natural_health"
	}
	input.SharedProviders[len(input.SharedProviders)-1].Listeners[0].Operations[0].Ref = "actual_hp_result"
	return input, request
}

func TestPermanentResourceMaxFiniteCapacityUsesEquippedAnchorOnce(t *testing.T) {
	input, request := permanentResourceMaxInput(t, 655, 160)
	finite := hitFlatProvider("finite_health", "armor", 1)
	finite.Modifiers = []model.ModifierDefinition{{ModifierKey: "finite_hp", Kind: "resource_max", Target: "self.attr.hp", ValuePolicy: "add", Value: authoringConst(300), CurrentValuePolicy: "grant_positive_delta_clamp"}}
	input.SharedProviders = append(input.SharedProviders, finite)
	state := frameCommitState(t, input, request)
	var frame Frame
	state.initExecutionFrame(&frame, "source", "target", "finite_use")
	op := state.compiled.Operations[0]
	op.Operation, op.Target, op.ProviderDefinitionRef, op.ColdResourceMax = "apply_provider", "self", "finite_health", false
	if err := frame.executeOperations(state.compiled.Abilities[0], []planbundle.CompiledOperation{op}); err != nil {
		t.Fatal(err)
	}
	frame.commit()
	if frame.fatal {
		t.Fatal(frame.fatalErr)
	}
	hp := state.combatants["source"].attributesView().At("hp")
	if hp.Max != 1610 || hp.Current != 955 || state.combatants["source"].hpMaxAnchorValue() != 1150 || state.resourceSummaryOutput().Source.MaxIncrease != 300 || state.resourceSummaryOutput().Source.CurrentIncrease != 300 {
		t.Fatal(hp, state.resourceSummaryOutput())
	}
	state.loop.Advance(6000)
	state.settleLiveResourceExpiry()
	if hp := state.combatants["source"].attributesView().At("hp"); hp.Max != 1310 || hp.Current != 955 {
		t.Fatal("finite expiry discarded permanent contribution", hp)
	}
	permanentRef := ""
	for instanceIndex, instanceValues := 0, state.combatants["source"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		instance := instanceValues.At(instanceIndex)
		if instance.DefinitionRef == "natural_health_effect" {
			permanentRef = instance.ProviderRef
		}
	}
	var forbidden Frame
	state.initExecutionFrame(&forbidden, "source", "target", "illegal_expire")
	if err := forbidden.executeOperations(planbundle.CompiledAbility{}, []planbundle.CompiledOperation{{Operation: "expire_provider", Target: "self", ProviderRef: permanentRef}}); err != nil {
		t.Fatal(err)
	}
	forbidden.commit()
	if !forbidden.fatal || state.combatants["source"].attributesView().At("hp").Max != 1310 {
		t.Fatal("permanent instance was removed in combat", forbidden.fatalErr)
	}
}
