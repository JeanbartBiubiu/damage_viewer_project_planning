package execution

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

// An otherwise dormant ensure-remaining capability opens dynamic projection for
// the session. A different ability still keeps its original shield/attribute order.
func durationLinkedShieldMixInput(t *testing.T, reverse bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := providerDurationInput(t)
	c.SharedProviders[2].Lifecycle.DurationMs = timedShieldExpr(5000)
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "plain_linked_shield", StableID: "plain_linked_shield", Kind: "status",
		LinkedShieldDefinitionRef: "plain_linked_shield/value", Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(2500), MaxStacks: 1, RefreshPolicy: "replace"}})
	shield := model.OperationDefinition{Operation: "shield", Target: "self", ShieldRef: "plain_linked_shield/value",
		ShieldLifecycleProviderDefinitionRef: "plain_linked_shield", ShieldDurationMs: timedShieldExpr(2500), Amount: authoringAmount(authoringRead("source.attr.attack_damage.resolved"))}
	attribute := model.OperationDefinition{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "other_window"}
	ops := []model.OperationDefinition{shield, attribute}
	if reverse {
		ops = []model.OperationDefinition{attribute, shield}
	}
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, timedShieldAbility("mixed", ops))
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "mixed", AbilityRef: timedShieldRef("mixed"), Source: "source", Target: "target"}}
	return c, r
}

func TestDurationLinkedShieldMixedFramePreservesOperationOrder(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		c, r := durationLinkedShieldMixInput(t, reverse)
		s := frameCommitState(t, c, r)
		linkedShieldExecute(t, s, "mixed", "source", "target")
		actor := s.combatants["source"]
		want := 100.0
		if reverse {
			want = 120
		}
		if actor.instances.Shields().Len() != 1 || actor.instances.Shields().At(0).Remaining != want || actor.instances.Providers().Len() != 3 || actor.attributesView().At("attack_damage").Resolved != 120 {
			t.Fatal("mixed projection changed authored operation order", reverse, actor.instances.Shields(), actor.instances.Providers(), actor.attributesView().At("attack_damage"))
		}
		if actor.instances.Shields().At(0).LifecycleProviderRef == "" {
			t.Fatal("shield association is missing")
		}
	}
}

func TestDurationLinkedShieldMixedReplacementKeepsFreshPairAndStaleExpiry(t *testing.T) {
	c, r := durationLinkedShieldMixInput(t, false)
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "mixed", "source", "target")
	old := s.combatants["source"].instances.Shields().At(0)
	s.loop.Advance(500)
	linkedShieldExecute(t, s, "mixed", "source", "target")
	current := s.combatants["source"].instances.Shields().At(0)
	if old.ShieldRef == current.ShieldRef || old.LifecycleProviderRef == current.LifecycleProviderRef || current.ExpireAt != 3000 {
		t.Fatal("replacement reused a linked identity or expiry", old, current)
	}
	s.loop.Advance(2500)
	s.removeExpiredShieldInstance("source", old.ShieldRef)
	if !reflect.DeepEqual(current, s.combatants["source"].instances.Shields().At(0)) {
		t.Fatal("stale expiry removed fresh pair")
	}
	s.loop.Advance(3000)
	s.removeExpiredShieldInstance("source", current.ShieldRef)
	if s.combatants["source"].instances.Shields().Len() != 0 || s.combatants["source"].instances.Providers().Len() != 2 || s.combatants["source"].attributesView().At("attack_damage").Resolved != 120 {
		t.Fatal("shield expiry removed independent attribute or retained its provider", s.combatants["source"])
	}
}

func TestDurationLinkedShieldMixedQueueFailureRollsBackBothSides(t *testing.T) {
	for _, preexisting := range []bool{false, true} {
		t.Run(itoa(uint32(boolCount(preexisting))), func(t *testing.T) {
			c, r := durationLinkedShieldMixInput(t, false)
			s := frameCommitState(t, c, r)
			if preexisting {
				linkedShieldExecute(t, s, "mixed", "source", "target")
			}
			s.loop.Advance(500)
			before := s.buildDoneResult(false)
			*s.loop.Queue() = scheduler.NewGenericHeap(1)
			s.loop.Queue().SetLimit(1)
			s.loop.Queue().Push(scheduler.GenericEvent{Kind: scheduler.GenericEventSample, TimeMs: 6000})
			ability, ref, _ := s.lookupDriverAbility(model.DriverEntry{AbilityRef: timedShieldRef("mixed"), Source: "source", Target: "target"})
			f := s.newExecutionFrame("source", "target", ref)
			f.ownerCombatantKey, f.ownerProviderRef = "source", "champion:source_demo"
			if err := f.executeOperations(ability, s.compiled.Operations[int(ability.OperationStart):int(ability.OperationStart)+int(ability.OperationCount)]); err != nil {
				t.Fatal(err)
			}
			f.commit()
			if !f.fatal || f.fatalErr == nil || f.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || f.committed {
				t.Fatal("expected whole-frame queue rejection", f.fatalErr)
			}
			after := s.buildDoneResult(false)
			if !reflect.DeepEqual(before.FinalSnapshot, after.FinalSnapshot) || !reflect.DeepEqual(before.Evidence, after.Evidence) || !reflect.DeepEqual(before.Summary, after.Summary) {
				t.Fatal("failed mixed frame published shield, attribute, lifecycle or summary")
			}
		})
	}
}

func TestDurationLinkedShieldMixedDepletionZeroAndRemoval(t *testing.T) {
	for _, mode := range []string{"deplete", "zero", "zero_rollback", "remove", "remove_rollback"} {
		t.Run(mode, func(t *testing.T) {
			c, r := durationLinkedShieldMixInput(t, false)
			shield := c.SharedProviders[0].Abilities[len(c.SharedProviders[0].Abilities)-1].Operations[0]
			shield.Amount = timedShieldExpr(0)
			c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, timedShieldAbility("zero", []model.OperationDefinition{shield,
				{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "other_window"}}))
			s := frameCommitState(t, c, r)
			linkedShieldExecute(t, s, "mixed", "source", "target")
			s.loop.Advance(500)
			before := s.buildDoneResult(false)
			ability, ref, _ := s.lookupDriverAbility(model.DriverEntry{AbilityRef: timedShieldRef("mixed"), Source: "source", Target: "target"})
			if mode == "zero" || mode == "zero_rollback" {
				ability, ref, _ = s.lookupDriverAbility(model.DriverEntry{AbilityRef: timedShieldRef("zero"), Source: "source", Target: "target"})
			}
			f := s.newExecutionFrame("source", "target", ref)
			f.ownerCombatantKey, f.ownerProviderRef = "source", "champion:source_demo"
			if mode == "deplete" || mode == "zero" || mode == "zero_rollback" {
				// The shield and its attribute are created, then the last damage
				// depletes it; the final removal is appended during commit.
				if err := f.executeOperations(ability, s.compiled.Operations[int(ability.OperationStart):int(ability.OperationStart)+int(ability.OperationCount)]); err != nil {
					t.Fatal(err)
				}
				if mode == "deplete" {
					sample, _, _ := s.lookupDriverAbility(model.DriverEntry{AbilityRef: timedShieldRef("sample"), Source: "source", Target: "target"})
					if err := f.executeOperation(ability, &plan.CompiledOperation{Operation: "damage", Target: "self",
						DamageType: "damage/physical", HasAmount: true, AmountProgram: s.compiled.Operations[sample.OperationStart].AmountProgram}); err != nil {
						t.Fatal(err)
					}
				}
				// The sample is AD120, equal to the replacement shield120.
			} else {
				shieldRef := s.combatants["source"].instances.Shields().At(0).LifecycleProviderRef
				if err := f.executeOperations(ability, []plan.CompiledOperation{{Operation: "expire_provider", Target: "self", ProviderRef: shieldRef},
					{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "other_window"}}); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "remove_rollback" || mode == "zero_rollback" {
				s.loop.Queue().SetLimit(s.loop.Queue().Len())
			}
			f.commit()
			if mode == "remove_rollback" || mode == "zero_rollback" {
				if !f.fatal || f.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || !reflect.DeepEqual(before.FinalSnapshot, s.buildDoneResult(false).FinalSnapshot) || !reflect.DeepEqual(before.Evidence, s.buildDoneResult(false).Evidence) {
					t.Fatal("forced removal escaped failed frame", f.fatalErr)
				}
				return
			}
			if f.fatal {
				t.Fatal(f.fatalErr)
			}
			if s.combatants["source"].instances.Shields().Len() != 0 || s.combatants["source"].instances.Providers().Len() != 2 || s.combatants["source"].attributesView().At("attack_damage").Resolved != 120 {
				t.Fatal("shield removal must preserve the independent attribute", mode, s.combatants["source"])
			}
		})
	}
}

func TestDurationLinkedShieldMixedKeepsComplexShieldAndResourceGuard(t *testing.T) {
	for _, mode := range []string{"stateful_shield", "resource_max", "cooldown_duration"} {
		t.Run(mode, func(t *testing.T) {
			c, r := durationLinkedShieldMixInput(t, false)
			if mode == "stateful_shield" {
				c.SharedProviders[3].InitialStateSchema = map[string]interface{}{"quota": 0.0}
			} else if mode == "resource_max" {
				c.SharedProviders[2].Modifiers = append(c.SharedProviders[2].Modifiers, model.ModifierDefinition{ModifierKey: "hp", Kind: "resource_max",
					Target: "self.attr.hp", ValuePolicy: "add", Value: authoringConst(100), CurrentValuePolicy: "grant_positive_delta_clamp"})
			} else {
				emptyRefs := []string{}
				c.SharedProviders[2].Modifiers = append(c.SharedProviders[2].Modifiers, model.ModifierDefinition{ModifierKey: "cooldown", Kind: "cooldown_duration",
					Target: "self", ValuePolicy: "multiply", Value: authoringConst(.5), AffectedAbilityRefs: &emptyRefs})
			}
			s := frameCommitState(t, c, r)
			before := s.buildDoneResult(false)
			ability, ref, _ := s.lookupDriverAbility(model.DriverEntry{AbilityRef: timedShieldRef("mixed"), Source: "source", Target: "target"})
			f := s.newExecutionFrame("source", "target", ref)
			f.ownerCombatantKey, f.ownerProviderRef = "source", "champion:source_demo"
			if err := f.executeOperations(ability, s.compiled.Operations[int(ability.OperationStart):int(ability.OperationStart)+int(ability.OperationCount)]); err != nil {
				t.Fatal(err)
			}
			f.commit()
			if !f.fatal || f.fatalErr.Code != model.GenericErrRuntimeInvariantFailed || !reflect.DeepEqual(before.FinalSnapshot, s.buildDoneResult(false).FinalSnapshot) {
				t.Fatal("unsupported mixed lifecycle bypassed old guard", f.fatalErr)
			}
		})
	}
}
