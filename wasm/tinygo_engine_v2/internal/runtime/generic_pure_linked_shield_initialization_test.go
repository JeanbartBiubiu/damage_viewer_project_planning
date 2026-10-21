package runtime

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func addPureInitializedShield(c *model.CompileRequest, r *model.RunRequest, actor, mode string, amount float64) (int, int) {
	op := model.OperationDefinition{Operation: "shield", Target: "self", Ref: "external_shield", ShieldRef: "a_external/value", ShieldLifecycleProviderDefinitionRef: "a_external/lifecycle", Amount: timedShieldExpr(amount)}
	listener := model.ListenerDefinition{ListenerKey: "external_initialize", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}}, Operations: []model.OperationDefinition{op}}
	parent := model.ProviderDefinition{ProviderKey: "external_initializer", Kind: "character", StableID: "external_initializer", SkillKey: "lab_external"}
	if mode == "direct" {
		parent.Listeners = []model.ListenerDefinition{listener}
	} else {
		ability := model.AbilityDefinition{AbilityKey: "external_initialize", Kind: "passive_listener", SkillKey: "lab_external", ListenerSpec: &listener}
		if mode == "ability_operations" {
			ability.Operations, listener.Operations = listener.Operations, nil
		}
		parent.Abilities = []model.AbilityDefinition{ability}
	}
	parentIndex := len(c.SharedProviders)
	c.SharedProviders = append(c.SharedProviders, parent, model.ProviderDefinition{ProviderKey: "a_external/lifecycle", StableID: "external_initializer", SkillKey: "lab_external", Kind: "status", LinkedShieldDefinitionRef: "a_external/value", Lifecycle: &model.ProviderLifecycle{MaxStacks: float64(1), RefreshPolicy: "replace"}})
	for i := range c.Combatants {
		if c.Combatants[i].Key == actor {
			c.Combatants[i].Providers = append(c.Combatants[i].Providers, model.CombatantProviderMount{ProviderRef: "external_initializer", DefinitionRef: "external_initializer"})
		}
	}
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key == actor {
			r.InitialSnapshot.Combatants[i].Providers = append(r.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{ProviderRef: "external_initializer", DefinitionRef: "external_initializer", Source: actor, Owner: actor, Stacks: 1})
		}
	}
	return parentIndex, parentIndex + 1
}

func pureInitializedShieldInput(mode string) (model.CompileRequest, model.RunRequest, int, int) {
	c, r := sourceInitializationInput()
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeDamageTaken, Domain: "event"}, model.TypeCatalogEntry{Key: "event/target_owner", Domain: "event"})
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "damage/physics", Formula: formuladefinition.ConstantDefense("1")}}
	setCombatantAttr(&c, &r, "source", "attack_damage", authoringSlot(20))
	parent, child := addPureInitializedShield(&c, &r, "target", mode, 50)
	return c, r, parent, child
}

func TestPureLinkedShieldInitializationPrecedesRealBackgroundAttack(t *testing.T) {
	for _, mode := range []string{"direct", "listener_spec_operations", "ability_operations"} {
		for _, kind := range []string{"character", "build"} {
			c, r, parent, _ := pureInitializedShieldInput(mode)
			c.SharedProviders[parent].Kind = kind
			compiled := authoringCompile(t, c)
			if compiled.HasStateOnExpire || compiled.HasReceivedShieldReads {
				t.Fatal("a pure initializer invented wait state or capture")
			}
			done, err := RunGeneric(compiled, r)
			if err != nil || !done.Summary.Execution.Complete || done.Summary.BasicAttack.CompletedCount != 2 || done.Summary.TargetFinalHp != 1000 {
				t.Fatal("complete pure initialization was not admitted to the real attack plan", mode, kind, err, done.Summary)
			}
			shields := done.FinalSnapshot.Combatants[1].Shields
			if len(shields) != 1 || shields[0].Remaining != 10 || shields[0].Source != "target" || shields[0].Owner != "target" || shields[0].DefinitionRef != "a_external/value" || shields[0].LifecycleProviderRef == "" {
				t.Fatal("50 shield did not absorb the first two independent 20 attacks", shields)
			}
			events := receivedShieldEvents(done, "target")
			if len(events) != 2 || events[0].TimeMs != 0 || events[1].TimeMs != 1000 || events[0].Data["shieldAbsorbed"] != float64(20) || events[1].Data["shieldAbsorbed"] != float64(20) {
				t.Fatal("initializer did not complete before the first real hit", events)
			}
			for _, event := range events {
				if _, exists := event.Data["shieldAbsorptions"]; exists {
					t.Fatal("no-reader initializer enabled capture", event)
				}
				if _, exists := event.Data["damageId"]; exists {
					t.Fatal("no-reader event acquired a new field", event)
				}
			}
			again, err := RunGeneric(compiled, r)
			if err != nil || !reflect.DeepEqual(done, again) {
				t.Fatal("pure initializer leaked across runs", err)
			}
		}
	}
}

func TestPureLinkedShieldOtherSourceDoesNotBorrowOwnWait(t *testing.T) {
	for _, amount := range []float64{50, 30} {
		incoming := []float64{20, 20}
		if amount == 30 {
			incoming = append(incoming, 20)
		}
		c, r := receivedShieldInput(4000, incoming...)
		addPureInitializedShield(&c, &r, "source", "ability_operations", amount)
		s, done := runReceivedShieldState(t, c, r)
		events := receivedShieldEvents(done, "source")
		if len(events) != len(incoming) || s.combatantHp("source") != 1000 {
			t.Fatal("other natural source changed health or damage count", done.Summary)
		}
		if receivedRows(t, events[0])[0].DefinitionRef != "a_external/value" {
			t.Fatal("other shield was not settled first", events)
		}
		bag := s.combatants["source"].providerState["own_recharge"]
		fact := sourceStateExpiryFact{}
		if bag != nil {
			fact = bag.sourceExpiryFacts["wait"]
		}
		if amount == 50 {
			if fact != (sourceStateExpiryFact{}) || ownShieldRemaining(done) != 110 {
				t.Fatal("different definition's two pure shield hits armed own P", fact, done.FinalSnapshot)
			}
		} else {
			if fact != (sourceStateExpiryFact{generation: 1, deadline: 5000}) || ownShieldRemaining(done) != 70 {
				t.Fatal("crossing into own P did not start once at 1000ms", fact, done.FinalSnapshot)
			}
			rows := receivedRows(t, events[1])
			if len(rows) != 2 || rows[0].DefinitionRef != "a_external/value" || rows[0].Absorbed != 10 || rows[1].DefinitionRef != "own_guard/value" || rows[1].Absorbed != 10 {
				t.Fatal("cross-shield facts lost actual attribution", rows)
			}
		}
	}
}

func TestPureLinkedShieldInitializationKeepsExistingStaticAttributeGate(t *testing.T) {
	c, r, _, child := pureInitializedShieldInput("ability_operations")
	c.SharedProviders[child].Modifiers = []model.ModifierDefinition{{ModifierKey: "armor", Kind: "attribute", Target: "self.attr.armor", ValuePolicy: "add", Value: gfConst(10)}}
	done := authoringRun(t, c, r)
	if done.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != 10 || done.FinalSnapshot.Combatants[1].Shields[0].Remaining != 10 {
		t.Fatal("existing linked non-HP attribute did not follow its real shield", done.FinalSnapshot)
	}
}

func TestPureLinkedShieldZeroAmountCreatesNoRuntimeInstance(t *testing.T) {
	c, r, parent, _ := pureInitializedShieldInput("ability_operations")
	c.SharedProviders[parent].Abilities[0].Operations[0].Amount = timedShieldExpr(0)
	done := authoringRun(t, c, r)
	if done.Summary.TargetFinalHp != 960 || len(done.FinalSnapshot.Combatants[1].Shields) != 0 || len(done.FinalSnapshot.Combatants[1].Providers) != 1 {
		t.Fatal("zero shield invented an instance or changed the two real hits", done.FinalSnapshot)
	}
}

func TestPureLinkedShieldInitializationRejectsIncompleteClosure(t *testing.T) {
	cases := []struct {
		name   string
		change func(*model.CompileRequest, *model.RunRequest, int, int)
	}{
		{"wrong_parent_kind", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) { c.SharedProviders[p].Kind = "item" }},
		{"wrong_owner", func(_ *model.CompileRequest, r *model.RunRequest, _, _ int) {
			r.InitialSnapshot.Combatants[1].Providers[0].Owner = "source"
		}},
		{"wrong_source", func(_ *model.CompileRequest, r *model.RunRequest, _, _ int) {
			r.InitialSnapshot.Combatants[1].Providers[0].Source = "source"
		}},
		{"wrong_mount_ref", func(c *model.CompileRequest, _ *model.RunRequest, _, _ int) {
			c.Combatants[1].Providers[0].ProviderRef = "another_mount"
		}},
		{"duplicate_mount", func(c *model.CompileRequest, r *model.RunRequest, _, _ int) {
			c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "duplicate", DefinitionRef: "external_initializer"})
			r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "duplicate", DefinitionRef: "external_initializer", Source: "target", Owner: "target", Stacks: 1})
		}},
		{"different_skill", func(c *model.CompileRequest, _ *model.RunRequest, _, child int) {
			c.SharedProviders[child].SkillKey = "other_skill"
		}},
		{"unbound_shield", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].Operations[0].ShieldLifecycleProviderDefinitionRef = ""
		}},
		{"wrong_shield_ref", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].Operations[0].ShieldRef = "another/value"
		}},
		{"opponent_target", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].Operations[0].Target = "target"
		}},
		{"dynamic_amount", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].Operations[0].Amount = authoringAmount(authoringRead("source.attr.hp.max"))
		}},
		{"negative_amount", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].Operations[0].Amount = timedShieldExpr(-1)
		}},
		{"operation_condition", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].Operations[0].Condition = timedShieldExpr(1)
		}},
		{"extra_operation", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].Operations = append(c.SharedProviders[p].Abilities[0].Operations, c.SharedProviders[p].Abilities[0].Operations[0])
		}},
		{"listener_condition", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].ListenerSpec.Condition = timedShieldExpr(1)
		}},
		{"ability_reference", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].ListenerSpec.AbilityRef = authoringRef("native_start")
		}},
		{"once_per_use", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].ListenerSpec.OncePerUse = &model.OncePerUseLimit{GroupKey: "init", Scope: "provider"}
		}},
		{"throttle", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].ListenerSpec.PerCastThrottleMs = 100
		}},
		{"any_only", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].ListenerSpec.EventMatcher = model.TypeMatcher{Any: []string{model.EventTypeSourceInitialized, "event/source_owner"}}
		}},
		{"none_blocks_owner", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].ListenerSpec.EventMatcher.None = []string{"event/source_owner"}
		}},
		{"impossible_all", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].ListenerSpec.EventMatcher.All = append(c.SharedProviders[p].Abilities[0].ListenerSpec.EventMatcher.All, model.EventTypeBasicAttackHit)
		}},
		{"impossible_any", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities[0].ListenerSpec.EventMatcher.Any = []string{model.EventTypeBasicAttackHit}
		}},
		{"extra_active", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].Abilities = append(c.SharedProviders[p].Abilities, model.AbilityDefinition{AbilityKey: "hidden", Kind: "active", SkillKey: "lab_external"})
		}},
		{"parent_state", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			c.SharedProviders[p].InitialStateSchema = map[string]interface{}{"hidden": float64(0)}
		}},
		{"child_state", func(c *model.CompileRequest, _ *model.RunRequest, _, child int) {
			c.SharedProviders[child].InitialStateSchema = map[string]interface{}{"hidden": float64(0)}
		}},
		{"child_periodic", func(c *model.CompileRequest, _ *model.RunRequest, _, child int) {
			c.SharedProviders[child].Lifecycle.TickIntervalMs = 1000
		}},
		{"finite_shield", func(c *model.CompileRequest, _ *model.RunRequest, p, child int) {
			c.SharedProviders[p].Abilities[0].Operations[0].ShieldDurationMs = timedShieldExpr(1000)
			c.SharedProviders[child].Lifecycle.DurationMs = timedShieldExpr(1000)
		}},
		{"missing_attribute_slot", func(c *model.CompileRequest, _ *model.RunRequest, _, child int) {
			c.SharedProviders[child].Modifiers = []model.ModifierDefinition{{ModifierKey: "missing", Kind: "attribute", Target: "self.attr.absent_slot", ValuePolicy: "add", Value: gfConst(1)}}
		}},
		{"foreign_creator", func(c *model.CompileRequest, _ *model.RunRequest, p, _ int) {
			op := c.SharedProviders[p].Abilities[0].Operations[0]
			c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "foreign_creator", StableID: "foreign_creator", SkillKey: "lab_external", Kind: "character", Abilities: []model.AbilityDefinition{{AbilityKey: "create_same_shield", SkillKey: "lab_external", Kind: "active", Operations: []model.OperationDefinition{op}}}})
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, r, parent, child := pureInitializedShieldInput("ability_operations")
			tc.change(&c, &r, parent, child)
			compiled := compile.CompileGeneric(c)
			if compiled.OK {
				if _, err := RunGeneric(compiled.Session, r); err == nil {
					t.Fatal("incomplete pure initializer entered real background attacks")
				}
			}
		})
	}
}
