// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func TestContinuousAttackRejectsDynamicOrUnfreshInputs(t *testing.T) {
	for _, kind := range []string{"dynamic_speed", "resource_cost", "mixed_listener", "extra_origin_listener", "temporary_mount", "provider_state", "unknown_target_mount", "changed_numeric_snapshot", "negative_sampling", "global_modifier"} {
		t.Run(kind, func(t *testing.T) {
			c, r := continuousAttackInput(1, 10000, 100, 0, 0, 2000)
			switch kind {
			case "dynamic_speed":
				c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates = append(c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates, model.SkillHitCandidate{CandidateKey: "speed", EffectOccurrenceKey: "speed", EffectKey: "speed", ResultKey: "speed", Semantic: model.SkillHitSemantic{ResultType: model.SkillHitResultDamage, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentInstant}, Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "source", AttributeKey: "attack_speed", ValuePolicy: "set", Amount: authoringAmount(authoringConst(2))}}})
			case "resource_cost":
				c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 10, Max: 10}
				r.InitialSnapshot.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 10, Max: 10}
				c.SharedProviders[0].Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "mana", Amount: authoringConst(1)}}
			case "mixed_listener":
				c.SharedProviders[0].Listeners[0].Operations = []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(10))}}
			case "extra_origin_listener":
				c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "cast_origin/champion", Domain: "cast_origin"})
				c.SharedProviders[0].Abilities[0].CastOrigin = "champion"
				c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: "origin", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackStart, "cast_origin/champion"}}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(10))}}})
			case "temporary_mount":
				at := int64(1)
				r.InitialSnapshot.Combatants[0].Providers[0].ExpireAt = &at
			case "provider_state":
				r.InitialSnapshot.Combatants[0].Providers[0].State = map[string]interface{}{"x": 1}
			case "unknown_target_mount":
				r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "missing", DefinitionRef: "missing", Owner: "target", Source: "target", Stacks: 1}}
			case "changed_numeric_snapshot":
				r.InitialSnapshot.Combatants[0].Attributes["attack_speed"] = authoringSlot(2)
			case "negative_sampling":
				r.Sampling = model.SamplingConfig{SampleEveryMs: -1, DpsWindowMs: 1000, MaxSeriesPoints: 10}
			case "global_modifier":
				c.Rules.Modifiers = []model.ModifierDefinition{{ModifierKey: "unselected", Kind: "pipeline", Command: "damage", Channel: "all_damage", Stage: "outgoing_pre_mitigation", Bucket: "all_instances", ValuePolicy: "multiply", Value: authoringConst(1.1)}}
			}
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				if kind == "global_modifier" {
					t.Fatalf("global modifier fixture must compile before runtime admission: %+v", compiled.Result.Errors)
				}
				t.Logf("rejected at compile: %+v", compiled.Result.Errors)
				return
			}
			_, err := runtimeengine.RunGeneric(compiled.Session, r)
			if err == nil || err.BudgetCause != "" {
				t.Fatalf("invalid configuration accepted or misclassified as budget: %+v", err)
			}
		})
	}
}

func TestRunQueueActuallyConsumesCompiledCapacity(t *testing.T) {
	c, r := authoringInput()
	c.Settings.MaxQueueEvents = 1
	compiled := authoringCompile(t, c)
	_, err := runtimeengine.RunGeneric(compiled, r)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		t.Fatalf("compile queue capacity ignored: %+v", err)
	}
}
