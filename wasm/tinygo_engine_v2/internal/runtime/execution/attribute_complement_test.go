package execution

import (
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func complementRuntimeModifier(key string, value model.GenericFormulaExpr) model.ModifierDefinition {
	return model.ModifierDefinition{ModifierKey: "configured_complement", Kind: "attribute", Target: "self.attr." + key, Stage: "total", ValuePolicy: "complement_multiply", Value: value}
}

func complementDynamicInput(t *testing.T, key string, value model.GenericFormulaExpr) (model.CompileRequest, model.RunRequest, string) {
	t.Helper()
	input, request := triggeredSourceInput(100)
	input.Combatants[0].Attributes[key] = authoringSlot(.4)
	request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(.4)
	root := addTriggeredSkillSource(&input, &request, 0, "configured_fraction_source", "character", model.ProviderDefinition{})
	definition := root + ":temporary"
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: definition, StableID: root, Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(2000), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{complementRuntimeModifier(key, value)}})
	for index := range input.SharedProviders {
		if input.SharedProviders[index].ProviderKey == root {
			input.SharedProviders[index].Listeners = []model.ListenerDefinition{{ListenerKey: "configured_mount", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, eventSourceOwner}}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: definition}}}}
		}
	}
	return input, request, definition
}

func TestAttributeComplementDynamicSourceAdmittedRestoredAndRemoved(t *testing.T) {
	for _, key := range []string{"configured_ratio", "other_reduction"} {
		t.Run(key, func(t *testing.T) {
			input, request, definition := complementDynamicInput(t, key, authoringConst(.1))
			done := authoringRun(t, input, request)
			if got := done.FinalSnapshot.Combatants[0].Attributes[key].Resolved; math.Abs(got-.46) > 1e-12 {
				t.Fatal(got)
			}
			var ref string
			for _, provider := range done.FinalSnapshot.Combatants[0].Providers {
				if provider.DefinitionRef == definition {
					ref = provider.ProviderRef
				}
			}
			if ref == "" {
				t.Fatal("dynamic complement missing")
			}
			restored := request
			restored.DriverPlan.BasicAttack = nil
			restored.InitialSnapshot = cloneSnapshot(done.FinalSnapshot)
			restored.StopPolicy.DurationMs = 100
			restored.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
			resumed := authoringRun(t, input, restored)
			if got := resumed.FinalSnapshot.Combatants[0].Attributes[key].Resolved; math.Abs(got-.46) > 1e-12 {
				t.Fatal("restore compounded current value", got)
			}
			state := frameCommitState(t, input, restored)
			state.removeProviderInstance("source", ref, state.evalContextForCombatants("source", "target"), model.EvidenceKindProviderRemove)
			if got := state.combatants["source"].attributesView().At(key).Resolved; got != .4 {
				t.Fatal("unmount retained complement", got)
			}
		})
	}
}
