package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func complementRuntimeModifier(key string, value model.GenericFormulaExpr) model.ModifierDefinition {
	return model.ModifierDefinition{ModifierKey: "configured_complement", Kind: "attribute", Target: "self.attr." + key, Stage: "total", ValuePolicy: "complement_multiply", Value: value}
}

func TestAttributeComplementPermanentSourceAdmittedAndRepeatedRunsStable(t *testing.T) {
	for _, key := range []string{"configured_ratio", "other_reduction"} {
		t.Run(key, func(t *testing.T) {
			input, request := sourceInitializationInput()
			for actor := range input.Combatants {
				input.Combatants[actor].Attributes[key] = authoringSlot(.4)
				request.InitialSnapshot.Combatants[actor].Attributes[key] = authoringSlot(.4)
				modifier := complementRuntimeModifier(key, authoringConst(.1))
				if actor == 0 {
					addPermanentInitializer(&input, &request, actor, modifier)
				} else {
					second := modifier
					second.ModifierKey = "second"
					addPermanentInitializer(&input, &request, actor, modifier, second)
				}
			}
			for repeat := 0; repeat < 3; repeat++ {
				done := authoringRun(t, input, request)
				if !done.Summary.Execution.Complete || len(done.AttackRecords) == 0 {
					t.Fatal(done.Summary)
				}
				for actor, want := range []float64{.46, .514} {
					if got := done.FinalSnapshot.Combatants[actor].Attributes[key].Resolved; math.Abs(got-want) > 1e-12 {
						t.Fatal(repeat, actor, got, want)
					}
				}
			}
		})
	}
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
			if got := state.combatants["source"].attributes.At(key).Resolved; got != .4 {
				t.Fatal("unmount retained complement", got)
			}
		})
	}
}

func TestAttributeComplementDynamicRatioRejectsInvalidReadValues(t *testing.T) {
	for _, value := range []float64{-.1, 1.1, math.NaN(), math.Inf(1)} {
		input, request, _ := complementDynamicInput(t, "configured_ratio", model.GenericFormulaExpr{Op: "read", Path: "source.attr.configured_input.resolved"})
		input.Combatants[0].Attributes["configured_input"] = authoringSlot(value)
		request.InitialSnapshot.Combatants[0].Attributes["configured_input"] = authoringSlot(value)
		if done, err := RunGeneric(authoringCompile(t, input), request); err == nil || done.OK {
			t.Fatal("invalid dynamic complement ratio accepted", value, done.Summary)
		}
	}
}

func TestAttributeComplementDirectAndPeriodicSourcesAdmitOnlyNewPolicy(t *testing.T) {
	for _, periodic := range []bool{false, true} {
		t.Run(map[bool]string{false: "direct_source", true: "periodic_source"}[periodic], func(t *testing.T) {
			input, request := triggeredSourceInput(100)
			const key = "configured_owned_ratio"
			input.Combatants[0].Attributes[key] = authoringSlot(.4)
			request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(.4)
			definition := sourceCounterDefinition(model.EventTypeBasicAttackHit, eventSourceOwner, stateScopeProvider, "counter", 2, 0)
			definition.Modifiers = []model.ModifierDefinition{complementRuntimeModifier(key, authoringConst(.1))}
			if periodic {
				definition = periodicEquipmentDefinition(0, 50, 1000)
				definition.Modifiers = []model.ModifierDefinition{complementRuntimeModifier(key, authoringConst(.1))}
				addCadenceEquipment(&input, &request, 0, "complement_period", definition)
			} else {
				addTriggeredSkillSource(&input, &request, 0, "complement_owned", "character", definition)
			}
			done := authoringRun(t, input, request)
			if !done.Summary.Execution.Complete || math.Abs(done.FinalSnapshot.Combatants[0].Attributes[key].Resolved-.46) > 1e-12 {
				t.Fatal(done.Summary, done.FinalSnapshot)
			}
		})
	}
}
