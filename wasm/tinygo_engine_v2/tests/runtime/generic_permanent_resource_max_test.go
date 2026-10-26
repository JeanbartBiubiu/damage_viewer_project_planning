// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
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

func TestPermanentResourceMaxSameRealPlannedSourceKeepsOtherInitializationAndMaxMinusBase(t *testing.T) {
	input, request := permanentResourceMaxInput(t, 655, 160)
	request.StopPolicy.DurationMs = 1000
	setCombatantAttr(&input, &request, "source", "attack_damage", authoringSlot(10))
	ensureC1CatalogTypes(&input, model.TypeCatalogEntry{Key: "hp", Domain: "attribute"})
	oldParentIndex := len(input.SharedProviders) - 1
	initializer := input.SharedProviders[oldParentIndex].Listeners[0]
	input.SharedProviders[oldParentIndex].Listeners = nil
	input.Combatants[0].Providers = input.Combatants[0].Providers[:len(input.Combatants[0].Providers)-1]
	request.InitialSnapshot.Combatants[0].Providers = request.InitialSnapshot.Combatants[0].Providers[:len(request.InitialSnapshot.Combatants[0].Providers)-1]
	addMixedSpell(&input, &request, "real_r", 100, 250, false)
	parentIndex := len(input.SharedProviders) - 1
	input.SharedProviders[parentIndex].SkillKey = "real_r"
	input.SharedProviders[parentIndex].Listeners = []model.ListenerDefinition{initializer}
	input.SharedProviders[oldParentIndex-1].SkillKey = "real_r"
	permanent := formuladefinition.FromExpr("prebattle_hp", "real_r", authoringBinary("mul", authoringRead("ability.param.feast"), authoringConst(80)), nil)
	permanent.Parameters[0].ValueType = "INTEGER"
	permanent.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: model.Float64Ptr(2)}
	input.Formulas = append(input.Formulas, permanent)
	input.SharedProviders[oldParentIndex-1].Modifiers[0].Value = model.GenericFormulaExpr{Op: "ref", Ref: "prebattle_hp"}
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "attack_range", Domain: "attribute"})
	setCombatantAttr(&input, &request, "source", "attack_range", authoringSlot(125))
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: "actual_range_gain", StableID: "actual_range_gain", SkillKey: "real_r", Kind: "status", Modifiers: []model.ModifierDefinition{{ModifierKey: "range_gain", Kind: "attribute", Target: "self.attr.attack_range", ValuePolicy: "add", Value: authoringConst(25)}}})
	input.SharedProviders[parentIndex].Listeners[0].Operations = append(input.SharedProviders[parentIndex].Listeners[0].Operations, model.OperationDefinition{Operation: "apply_provider", Target: "self", ProviderRef: "actual_range_gain", ProviderDefinitionRef: "actual_range_gain"})
	damage := authoringBinary("add", authoringConst(300), authoringBinary("mul", authoringConst(.1), authoringBinary("sub", authoringRead("source.attr.hp.max"), authoringRead("source.attr.hp.base"))))
	input.Formulas = append(input.Formulas, formuladefinition.FromExpr("r_max_minus_base", "real_r", damage, nil))
	input.SharedProviders[parentIndex].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "ref", Ref: "r_max_minus_base"}
	done := authoringRun(t, input, request)
	hp := done.FinalSnapshot.Combatants[0].Attributes["hp"]
	if hp.Base != 1000 || hp.Max != 1310 || hp.Current != 655 || hp.Resolved != 655 || done.FinalSnapshot.Combatants[0].Attributes["attack_range"].Resolved != 150 || done.Summary.SourceDamageDealt != 351 {
		t.Fatal(hp, done.Summary, done.DamageRecords)
	}
	instances := map[string]int{}
	for _, instance := range done.FinalSnapshot.Combatants[0].Providers {
		instances[instance.DefinitionRef]++
	}
	if instances["natural_health_effect"] != 1 || instances["actual_range_gain"] != 1 || done.ResourceChangeSummary.ChangeCount != 0 {
		t.Fatal(instances, done.ResourceChangeSummary)
	}
	for _, fact := range recoveryEvidence(done, "resource_max_initialized") {
		for _, item := range fact.Data["contributions"].([]map[string]interface{}) {
			if item["sourceProviderRef"] != "real_r" || item["sourceDefinitionRef"] != "real_r_definition" {
				t.Fatal(item)
			}
		}
	}
}

func TestPermanentResourceMaxPreservesFullHalfAndZeroWithoutCombatGrant(t *testing.T) {
	for _, current := range []float64{0, 655, 1310} {
		input, request := permanentResourceMaxInput(t, current, 160)
		// A dead source cannot drive ordinary attacks, but still has its explicit cold capacity.
		if current == 0 {
			request.DriverPlan.BasicAttack = nil
		}
		compiled := authoringCompile(t, input)
		first, err := runtimeengine.RunGeneric(compiled, request)
		if err != nil {
			t.Fatal(current, err)
		}
		second, err := runtimeengine.RunGeneric(compiled, request)
		if err != nil || !reflect.DeepEqual(first, second) {
			t.Fatal("independent runs changed cold state", err)
		}
		hp := first.FinalSnapshot.Combatants[0].Attributes["hp"]
		if hp.Base != 1000 || hp.Max != 1310 || hp.Current != current || hp.Resolved != current || first.ResourceChangeSummary.ChangeCount != 0 || first.ResourceChangeSummary.Source.MaxIncrease != 0 || first.ResourceChangeSummary.Source.CurrentIncrease != 0 || len(*first.ResourceChangeRecords) != 0 {
			t.Fatal(hp, first.ResourceChangeSummary, first.ResourceChangeRecords)
		}
		facts := recoveryEvidence(first, "resource_max_initialized")
		if len(facts) != 1 || facts[0].Data["anchorMax"] != float64(1150) || facts[0].Data["permanentIncrease"] != float64(160) || facts[0].Data["current"] != current {
			t.Fatal(facts)
		}
		contributions := facts[0].Data["contributions"].([]map[string]interface{})
		if len(contributions) != 1 || contributions[0]["sourceProviderRef"] != "natural_health" || contributions[0]["sourceDefinitionRef"] != "natural_health" || contributions[0]["opRef"] != "actual_hp_result" || contributions[0]["abilityRef"] != nil || contributions[0]["useRef"] != nil || contributions[0]["providerRef"] == "" {
			t.Fatal(contributions)
		}
		count := 0
		for _, p := range first.FinalSnapshot.Combatants[0].Providers {
			if p.DefinitionRef == "natural_health_effect" {
				count++
				if p.ExpireAt != nil || p.Stacks != 1 || p.Source != "source" || p.Owner != "source" || p.ProviderRef != contributions[0]["providerRef"] {
					t.Fatal(p)
				}
			}
		}
		if count != 1 {
			t.Fatal("ordinary source initialization duplicated permanent instance", first.FinalSnapshot)
		}
		request.OutputMode = model.RunOutputSummary
		zero := 0
		request.RecordBudget = &model.RecordBudget{MaxResourceChangeRecords: &zero, MaxDamageRecords: &zero}
		summary, err := runtimeengine.RunGeneric(compiled, request)
		if err != nil || !reflect.DeepEqual(summary.Summary, first.Summary) || !reflect.DeepEqual(summary.FinalSnapshot, first.FinalSnapshot) || !reflect.DeepEqual(summary.ResourceChangeSummary, first.ResourceChangeSummary) {
			t.Fatal("retention changed permanent HP", err)
		}
	}
}

func TestPermanentResourceMaxExplicitZeroStillHasRealInitializationProvenance(t *testing.T) {
	input, request := permanentResourceMaxInput(t, 655, 0)
	done := authoringRun(t, input, request)
	facts := recoveryEvidence(done, "resource_max_initialized")
	if len(facts) != 1 || facts[0].Data["permanentIncrease"] != float64(0) || len(facts[0].Data["contributions"].([]map[string]interface{})) != 1 || done.FinalSnapshot.Combatants[0].Attributes["hp"].Max != 1150 || done.Summary.SourceFinalHp != 655 || done.ResourceChangeSummary.ChangeCount != 0 {
		t.Fatal(facts, done.Summary, done.ResourceChangeSummary)
	}
}

func TestPermanentResourceMaxRejectsForeignDynamicDuplicateAndForgedInitialState(t *testing.T) {
	for _, change := range []string{"negative", "duration", "build", "item", "wrong_event", "any_event", "unreachable_any", "none_event", "condition", "foreign", "dynamic", "ability_reference", "preinstalled", "maximum", "current", "run_attributes", "resume"} {
		t.Run(change, func(t *testing.T) {
			input, request := permanentResourceMaxInput(t, 655, 160)
			parent, effect := &input.SharedProviders[len(input.SharedProviders)-1], &input.SharedProviders[len(input.SharedProviders)-2]
			switch change {
			case "negative":
				effect.Modifiers[0].Value = authoringConst(-1)
			case "duration":
				effect.Lifecycle = &model.ProviderLifecycle{DurationMs: timedShieldExpr(1000)}
			case "build", "item":
				parent.Kind = change
			case "wrong_event":
				parent.Listeners[0].EventMatcher.All = []string{model.EventTypeBasicAttackHit, "event/source_owner"}
			case "any_event":
				parent.Listeners[0].EventMatcher.Any = parent.Listeners[0].EventMatcher.All
				parent.Listeners[0].EventMatcher.All = nil
			case "unreachable_any":
				parent.Listeners[0].EventMatcher.Any = []string{model.EventTypeBasicAttackHit}
			case "none_event":
				parent.Listeners[0].EventMatcher.None = []string{model.EventTypeSourceInitialized}
			case "condition":
				parent.Listeners[0].Condition = timedShieldExpr(1)
			case "foreign":
				parent.Listeners[0].Operations[0].Target = "target"
			case "dynamic":
				effect.Modifiers[0].Value = authoringRead("source.attr.attack_damage")
			case "ability_reference":
				input.SharedProviders[0].Abilities[0].Operations = append(input.SharedProviders[0].Abilities[0].Operations, parent.Listeners[0].Operations[0])
			case "preinstalled":
				request.InitialSnapshot.Combatants[0].Providers = append(request.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "forged", DefinitionRef: effect.ProviderKey, Owner: "source", Source: "source", Stacks: 1})
			case "maximum":
				hp := input.Combatants[0].Attributes["hp"]
				hp.Max++
				hp.Resolved++
				setCombatantAttr(&input, &request, "source", "hp", hp)
			case "current":
				hp := input.Combatants[0].Attributes["hp"]
				hp.Current = 1311
				setCombatantAttr(&input, &request, "source", "hp", hp)
			case "run_attributes":
				attributes := map[string]model.AttributeSlotDef{}
				for key, value := range request.InitialSnapshot.Combatants[0].Attributes {
					attributes[key] = value
				}
				hp := attributes["hp"]
				hp.Current++
				attributes["hp"] = hp
				request.InitialSnapshot.Combatants[0].Attributes = attributes
			case "resume":
				request.InitialSnapshot.TimeMs = 1
			}
			compiled := compilebundle.CompileGeneric(input)
			if !compiled.OK {
				return
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, request); err == nil {
				t.Fatal("unsupported permanent HP admitted", change)
			}
		})
	}
}
