package runtime

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func targetWindowAdmissionInput(kind string, speed float64) (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(speed, 10000, 0, 0, 0, 4000)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"},
		model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"})
	state := func(key, scope, policy string, amount model.GenericFormulaExpr) model.OperationDefinition {
		return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: key, Types: []string{scope}, ValuePolicy: policy, Amount: authoringAmount(amount)}
	}
	read := authoringRead
	eq := func(a, b model.GenericFormulaExpr) model.GenericFormulaExpr {
		return model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{a, b}}
	}
	damage := model.OperationDefinition{Operation: "damage", Target: "target", Ref: "window_settlement", DamageType: "damage/physics",
		Amount: authoringAmount(model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{
			gfConst(120), {Op: "add", Args: []model.GenericFormulaExpr{gfConst(1), {Op: "mul", Args: []model.GenericFormulaExpr{gfConst(.25), read("provider.target_state.count")}}}},
		}}), Condition: authoringAmount(read("provider.state.settle"))}
	clear := state("window", stateScopeProviderTarget, "override", gfConst(0))
	clear.Condition = authoringAmount(read("provider.state.settle"))
	provider := model.ProviderDefinition{ProviderKey: "window_source", StableID: "window_source", Kind: kind,
		InitialStateSchema: map[string]interface{}{
			"count": anchoredTimedSlot(0, 4, 0), "window": anchoredTimedSlot(0, 1, 4000),
			"opened": anchoredTimedSlot(0, 1, 0), "settle": anchoredTimedSlot(0, 1, 0),
		},
		Abilities: []model.AbilityDefinition{{AbilityKey: "settle_expiry", Kind: "tick", TickSpec: &model.TickSpec{
			IntervalMs: 4000, AnchorScope: stateScopeProviderTarget, AnchorStateKey: "window",
			OnTick: []model.OperationDefinition{state("settle", stateScopeProvider, "override", gfConst(1)), damage},
		}}},
		Listeners: []model.ListenerDefinition{
			{ListenerKey: "open_once", MaxTriggersPerEvent: 1,
				EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackStart, "event/source_owner"}},
				Condition:    authoringAmount(eq(read("provider.state.opened"), gfConst(0))),
				Operations:   []model.OperationDefinition{state("opened", stateScopeProvider, "override", gfConst(1)), state("window", stateScopeProviderTarget, "override", gfConst(1))}},
			{ListenerKey: "actual_stack", MaxTriggersPerEvent: 1,
				EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
				Condition:    authoringAmount(eq(read("provider.target_state.window"), gfConst(1))),
				Operations:   []model.OperationDefinition{state("count", stateScopeProviderTarget, "add", gfConst(1)), state("settle", stateScopeProvider, "override", eq(read("provider.target_state.count"), gfConst(4))), damage, clear}},
		},
	}
	for _, key := range []string{"count", "opened", "settle"} {
		delete(provider.InitialStateSchema[key].(map[string]interface{}), "refreshPolicy")
	}
	c.SharedProviders = append(c.SharedProviders, provider)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "window_mount", DefinitionRef: "window_source"})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "window_mount", DefinitionRef: "window_source", Source: "source", Owner: "source", Stacks: 1})
	return c, r
}

func TestTargetWindowAdmissionActualBasicHitsAndNaturalExpiry(t *testing.T) {
	for _, kind := range []string{"character", "build"} {
		for _, speed := range []float64{1, .5} {
			t.Run(kind+map[float64]string{1: "_four_early", .5: "_two_expiry"}[speed], func(t *testing.T) {
				c, r := targetWindowAdmissionInput(kind, speed)
				compiled := compile.CompileGeneric(c)
				if !compiled.OK {
					t.Fatal(compiled.Result.Errors)
				}
				var first model.DoneResult
				for run := 0; run < 2; run++ {
					done, err := RunGeneric(compiled.Session, r)
					if err != nil {
						t.Fatal(err)
					}
					amount, at, hits := float64(240), int64(3000), 5
					if speed == .5 {
						amount, at, hits = 180, 4000, 3
					}
					if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != amount || done.Summary.TargetFinalHp != 10000-amount || done.Summary.BasicAttack.HitCount != hits {
						t.Fatal(done.Summary)
					}
					settlements := 0
					for _, row := range done.DamageRecords {
						if row["operationRef"] == "window_settlement" {
							settlements++
							if row["timeMs"] != at || row["rawAmount"] != amount {
								t.Fatal(row)
							}
						}
					}
					if settlements != 1 {
						t.Fatalf("got %d settlements", settlements)
					}
					target := sourceProviderState(t, done.FinalSnapshot, "window_mount")["targetState"].(map[string]interface{})
					expiry, hasExpiry := target["expireAt"].(map[string]interface{})["window"]
					if target["values"].(map[string]interface{})["window"] != float64(0) || hasExpiry && expiry != float64(0) {
						t.Fatal(target)
					}
					if run == 0 {
						first = done
					} else if !reflect.DeepEqual(first, done) {
						t.Fatal("compiled session did not repeat deterministically")
					}
				}
			})
		}
	}
}

func TestTargetWindowAdmissionRejectsUnsupportedGraphs(t *testing.T) {
	for _, invalid := range []string{"item_anchor", "temporary", "process", "active", "cost", "cooldown", "cast_condition", "extra_tick", "fixed_tick", "hidden_tick", "outer_operations", "self_damage", "target_guard", "target_scope_guard", "undeclared_guard", "emit_event", "target_owner_listener", "foreign_listener_field", "hp_modifier"} {
		t.Run(invalid, func(t *testing.T) {
			c, r := targetWindowAdmissionInput("character", 1)
			provider := &c.SharedProviders[len(c.SharedProviders)-1]
			tick := &provider.Abilities[0]
			switch invalid {
			case "item_anchor":
				provider.Kind = "item"
			case "temporary":
				provider.Lifecycle = &model.ProviderLifecycle{DurationMs: authoringAmount(gfConst(5000)), MaxStacks: 1}
			case "process":
				provider.Processes = []model.ProcessDefinition{{ProcessKey: "hidden_process", SkillKey: "hidden", Steps: []model.ProcessStepDefinition{{StepKey: "instant", StepType: "IMMEDIATE"}}}}
			case "active":
				provider.Abilities = append(provider.Abilities, model.AbilityDefinition{AbilityKey: "hidden_active", Kind: "active"})
			case "cost":
				tick.Cost = &model.AbilityCost{ResourceKey: "hp", Amount: gfConst(1)}
			case "cooldown":
				tick.Cooldown = &model.AbilityCooldown{DurationMs: gfConst(1000)}
			case "cast_condition":
				tick.CastCondition = authoringAmount(gfConst(1))
			case "extra_tick":
				second := *tick
				second.AbilityKey = "hidden_tick"
				provider.Abilities = append(provider.Abilities, second)
			case "fixed_tick":
				tick.TickSpec.AnchorScope, tick.TickSpec.AnchorStateKey = "", ""
			case "hidden_tick":
				tick.Kind = "passive_listener"
				tick.ListenerSpec = &provider.Listeners[0]
			case "outer_operations":
				tick.Operations = []model.OperationDefinition{tick.TickSpec.OnTick[1]}
			case "self_damage":
				tick.TickSpec.OnTick[1].Target = "self"
			case "target_guard":
				tick.TickSpec.OnTick[0].Target = "target"
			case "target_scope_guard":
				tick.TickSpec.OnTick[0].Types = []string{stateScopeProviderTarget}
			case "undeclared_guard":
				tick.TickSpec.OnTick[0].Ref = "foreign_state"
			case "emit_event":
				tick.TickSpec.OnTick = append(tick.TickSpec.OnTick, model.OperationDefinition{Operation: "emit_event", EventType: model.EventTypeBasicAttackHit, Target: "target"})
			case "target_owner_listener":
				provider.Listeners[0].EventMatcher.All = []string{model.EventTypeBasicAttackHit, "event/target_owner"}
			case "foreign_listener_field":
				provider.Listeners[0].Operations[0].Ref = "foreign_state"
			case "hp_modifier":
				provider.Modifiers = []model.ModifierDefinition{{ModifierKey: "hp", Kind: "attribute", Target: "self.attr.hp", ValuePolicy: "add", Value: gfConst(1)}}
			}
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				return
			}
			if _, err := RunGeneric(compiled.Session, r); err == nil {
				t.Fatalf("accepted unsupported graph %s", invalid)
			}
		})
	}
}
