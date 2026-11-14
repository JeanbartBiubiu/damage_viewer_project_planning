package execution

import (
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func ownSlowProcessInput(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := processBase(t, "CHARGE")
	parent := &c.SharedProviders[0]
	parent.SkillKey = "skill:q"
	process := &parent.Processes[0]
	process.Costs = nil
	process.Steps[0].MinimumChargeMs = timedShieldExpr(0)
	process.Steps[0].OccupiesAction = model.BoolPtr(true)
	process.Steps[0].ReleaseAtMaximum = model.BoolPtr(false)
	process.MomentOperations = []model.ProcessMomentOperations{
		{Moment: processMoment("PROCESS_START", "", ""), Operations: []model.OperationDefinition{
			{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "own_slow"},
			{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "other_slow"},
		}},
		{Moment: processMoment("PROCESS_COMPLETE", "", ""), Operations: []model.OperationDefinition{
			{Operation: "expire_provider", Target: "self", ProviderDefinitionRef: "own_slow"},
		}},
		{Moment: processMoment("PROCESS_FAILURE", "", ""), Operations: []model.OperationDefinition{
			{Operation: "expire_provider", Target: "self", ProviderDefinitionRef: "own_slow"},
		}},
	}
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "status/lab_slow", Domain: "status"})
	for _, key := range []string{"own_slow", "other_slow"} {
		c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: key, SkillKey: "skill:q", Kind: "status", StableID: key,
			Lifecycle:           &model.ProviderLifecycle{DurationMs: timedShieldExpr(500), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
			StatusContributions: []model.StatusContributionDefinition{{ResultRef: "slow", StatusKey: "lab_slow", StatusKind: model.StatusKindMovementSlow, Strength: authoringConst(.2)}}})
	}
	return c, r
}

func TestProcessOwnSlowSurvivesUntilReleaseAndCleansOnlyItsActualSource(t *testing.T) {
	for _, spec := range []struct {
		name, control string
		at, stop      int64
		active        bool
		sameFrame     bool
	}{
		{name: "active", stop: 100, active: true},
		{name: "early_release", control: "advance", at: 200, stop: 250},
		{name: "zero_release", control: "advance", at: 0, stop: 10},
		{name: "natural_timeout", stop: 500},
		{name: "explicit_control_failure", control: "interrupt", at: 200, stop: 250},
		{name: "same_frame_cleanup", stop: 100, sameFrame: true},
	} {
		t.Run(spec.name, func(t *testing.T) {
			c, r := ownSlowProcessInput(t)
			if spec.sameFrame {
				process := &c.SharedProviders[0].Processes[0]
				process.MomentOperations[0].Operations = append(process.MomentOperations[0].Operations,
					model.OperationDefinition{Operation: "expire_provider", Target: "self", ProviderDefinitionRef: "own_slow"})
			}
			r.StopPolicy.DurationMs = spec.stop
			if spec.control != "" {
				processEntry(&r, "finish", spec.control, "u1", spec.at)
				r.DriverPlan.Entries[len(r.DriverPlan.Entries)-1].Priority = 1
			}
			done := processRun(t, c, r)
			for _, actor := range done.FinalSnapshot.Combatants {
				want := spec.active && actor.Key == "source" || actor.Key == "target" && spec.stop < 500
				if (len(actor.EffectiveStatuses) == 1) != want {
					t.Fatalf("%s slow presence=%v want=%v snapshot=%+v", actor.Key, actor.EffectiveStatuses, want, actor)
				}
				if want && actor.EffectiveStatuses[0].Strength != .2 {
					t.Fatal("application contribution was lost during same-frame projection", actor.EffectiveStatuses)
				}
				for _, provider := range actor.Providers {
					if provider.DefinitionRef == "own_slow" && (actor.Key != "source" || !spec.active) {
						t.Fatal("own expiry left or removed the wrong instance", actor.Key, provider)
					}
				}
			}
		})
	}
}

func TestActualIncomingStunInterruptsChargeAndRemovesOwnSlow(t *testing.T) {
	for _, mixed := range []bool{false, true} {
		t.Run(map[bool]string{false: "stun", true: "same_frame_stun_and_slow"}[mixed], func(t *testing.T) {
			actualIncomingStun(t, mixed)
		})
	}
}

func actualIncomingStun(t *testing.T, mixed bool) {
	t.Helper()
	c, r := ownSlowProcessInput(t)
	stun := stunProvider()
	operations := []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: stun.ProviderKey}}
	if mixed {
		operations = append(operations, model.OperationDefinition{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "other_slow"})
	}
	c.SharedProviders = append(c.SharedProviders, stun, model.ProviderDefinition{ProviderKey: "enemy_control", Kind: "champion", SkillKey: "enemy:control", StableID: "enemy_control",
		Abilities: []model.AbilityDefinition{{AbilityKey: "stun", Kind: "active", Operations: operations}}})
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: stun.Types[0], Domain: "provider"})
	c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "enemy_mount", DefinitionRef: "enemy_control"})
	r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "enemy_mount", DefinitionRef: "enemy_control", Source: "target", Owner: "target", Stacks: 1, State: map[string]interface{}{}})
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "real_stun", AbilityRef: "target.provider[enemy_mount].ability[stun]", Source: "target", Target: "source", FirstAtMs: 200})
	r.StopPolicy.DurationMs = 250
	done := processRun(t, c, r)
	process := done.FinalSnapshot.ProcessInstances[0]
	if process.Status != "failed" || process.FailureReason == nil || *process.FailureReason != "CONTROLLED" {
		t.Fatal("actual incoming control did not interrupt the original charge", process, done.FinalSnapshot.Combatants[0].Providers, done.Summary.AbilityStats)
	}
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key != "source" {
			continue
		}
		if len(actor.EffectiveStatuses) != map[bool]int{false: 0, true: 1}[mixed] {
			t.Fatal("failed charge retained own slow or removed incoming slow", actor.EffectiveStatuses)
		}
		if mixed && (actor.EffectiveStatuses[0].Strength != .2 || actor.EffectiveStatuses[0].Contributions[0].Source != "target") {
			t.Fatal("same-frame projection lost incoming status contribution", actor.EffectiveStatuses)
		}
		foundStun := false
		for _, instance := range actor.Providers {
			if instance.DefinitionRef == "own_slow" {
				t.Fatal("own slow survived controlled failure", instance)
			}
			foundStun = foundStun || instance.DefinitionRef == stun.ProviderKey
		}
		if !foundStun {
			t.Fatal("cleanup removed the actual opposing control")
		}
	}
}

func TestOwnSlowExpiryRejectsUnprovedDefinitionAndApplyingMounts(t *testing.T) {
	for _, kind := range []string{"instance_conflict", "amount", "condition", "target_application", "extra_unmounted_parent", "two_mounts", "outside_process", "mixed_provider"} {
		t.Run(kind, func(t *testing.T) {
			c, _ := ownSlowProcessInput(t)
			process := &c.SharedProviders[0].Processes[0]
			expiry := &process.MomentOperations[1].Operations[0]
			switch kind {
			case "instance_conflict":
				expiry.ProviderRef = "not_the_instance"
			case "amount":
				expiry.Amount = timedShieldExpr(0)
			case "condition":
				expiry.Condition = timedShieldExpr(1)
			case "target_application":
				process.MomentOperations[0].Operations[0].Target = "target"
			case "extra_unmounted_parent":
				c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "hidden_parent", Kind: "champion", SkillKey: "skill:q", StableID: "hidden",
					Abilities: []model.AbilityDefinition{{AbilityKey: "foreign_apply", Kind: "active", Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "own_slow"}}}}})
			case "two_mounts":
				c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "another_mount", DefinitionRef: c.SharedProviders[0].ProviderKey})
			case "outside_process":
				c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "expire_alias", Kind: "active", Operations: []model.OperationDefinition{*expiry}})
			case "mixed_provider":
				c.SharedProviders[1].Modifiers = []model.ModifierDefinition{{ModifierKey: "extra", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: authoringConst(1)}}
			}
			compiled := compile.CompileGeneric(c)
			if compiled.OK {
				t.Fatal("unproved lifecycle identity was accepted", kind)
			}
		})
	}
}
