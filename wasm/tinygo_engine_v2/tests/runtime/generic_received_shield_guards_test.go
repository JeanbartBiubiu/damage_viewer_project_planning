// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func TestReceivedShieldRejectsIncompleteOrRestoredInitialIdentity(t *testing.T) {
	cases := []struct {
		name   string
		change func(*model.RunRequest)
	}{
		{"missing_parent", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers = r.InitialSnapshot.Combatants[0].Providers[:1]
		}},
		{"foreign_source", func(r *model.RunRequest) { r.InitialSnapshot.Combatants[0].Providers[1].Source = "target" }},
		{"wrong_owner", func(r *model.RunRequest) { r.InitialSnapshot.Combatants[0].Providers[1].Owner = "target" }},
		{"other_mount", func(r *model.RunRequest) { r.InitialSnapshot.Combatants[0].Providers[1].ProviderRef = "another_parent" }},
		{"duplicate_parent", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, r.InitialSnapshot.Combatants[0].Providers[1])
		}},
		{"stacked_parent", func(r *model.RunRequest) { r.InitialSnapshot.Combatants[0].Providers[1].Stacks = 2 }},
		{"finite_parent", func(r *model.RunRequest) {
			at := int64(1000)
			r.InitialSnapshot.Combatants[0].Providers[1].ExpireAt = &at
		}},
		{"changed_state", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers[1].State = map[string]interface{}{"wait": 1}
		}},
		{"resumed_time", func(r *model.RunRequest) { r.InitialSnapshot.TimeMs = 1 }},
		{"restored_child", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "old_shield_provider", DefinitionRef: "own_guard", Source: "source", Owner: "source", Stacks: 1})
		}},
		{"restored_shield", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Shields = []model.CombatantShieldSnapshot{{ShieldRef: "old_shield", DefinitionRef: "own_guard/value", Source: "source", Owner: "source", Remaining: 100}}
		}},
		{"missing_foreign_identity", func(r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Shields = []model.CombatantShieldSnapshot{{Owner: "source", Remaining: 100}}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, r := receivedShieldInput(4000, 20)
			compiled := authoringCompile(t, c)
			tc.change(&r)
			if _, err := runtimeengine.RunGeneric(compiled, r); err == nil {
				t.Fatal("incomplete or restored identity was accepted")
			}
		})
	}
}

func TestReceivedShieldOldNoReaderEvidenceAndCopyableMarkerStayUnchanged(t *testing.T) {
	c, r := receivedShieldInput(4000, 120)
	r.StopPolicy.DurationMs = 100
	newDone := authoringRun(t, c, r)
	c.SharedProviders[2].Listeners[1].Condition = authoringAmount(authoringBinary("gt", authoringRead("event.damage.actualHpLoss"), gfConst(0)))
	old := authoringCompile(t, c)
	if old.Features.Has(plan.FeatureReceivedShieldReads) {
		t.Fatal("a health-only listener enabled per-shield collection")
	}
	oldDone, err := runtimeengine.RunGeneric(old, r)
	if err != nil || !reflect.DeepEqual(newDone.FinalSnapshot, oldDone.FinalSnapshot) || !reflect.DeepEqual(newDone.Summary, oldDone.Summary) {
		t.Fatal("receipt collection changed old health/shield behavior", err)
	}
	for _, event := range receivedShieldEvents(oldDone, "source") {
		if _, present := event.Data["damageId"]; present {
			t.Fatal("old no-reader event acquired a new identity field", event)
		}
		if _, present := event.Data["shieldAbsorptions"]; present {
			t.Fatal("old no-reader event acquired a per-damage receipt", event)
		}
	}
	c, r = receivedShieldInput(4000, 20)
	c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].Operations[0].CopyableOnHit = true
	if done := authoringRun(t, c, r); ownShieldRemaining(done) != 80 {
		t.Fatal("a marker without repeat was mistaken for replay", done.FinalSnapshot)
	}
}

func TestReceivedShieldRunDriverCannotBorrowConditionReader(t *testing.T) {
	for _, reader := range []bool{false, true} {
		for _, mode := range []string{"condition", "interval"} {
			for _, hidden := range []bool{false, true} {
				c, r := receivedShieldInput(4000)
				if !reader {
					c.SharedProviders[2].Listeners[1].Condition = authoringAmount(authoringBinary("gt", authoringRead("event.damage.actualHpLoss"), gfConst(0)))
				}
				c.SharedProviders[3].Abilities = []model.AbilityDefinition{{AbilityKey: "incoming", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "driver_damage", DamageType: "damage/physics", Amount: timedShieldExpr(20)}}}}
				read := authoringRead(ownReceivedShieldPath)
				if hidden {
					read = model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{gfConst(0), read, gfConst(1000)}}
				}
				entry := model.DriverEntry{EntryKey: "incoming", AbilityRef: "target.provider[receiver].ability[incoming]", Source: "target", Target: "source", FirstAtMs: 0}
				if mode == "condition" {
					entry.Condition = &read
				} else {
					entry.Repeat = &model.DriverRepeat{IntervalFormula: &read, MaxAttempts: 2}
				}
				r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{entry}}
				r.StopPolicy.DurationMs = 1001
				if _, err := runtimeengine.RunGeneric(authoringCompile(t, c), r); err == nil || !strings.Contains(err.Message, "linked shield absorption is unavailable in a driver") || !strings.HasPrefix(err.Path, "driverPlan.entries[") {
					t.Fatal("run formula bypassed receiver-condition authorization", reader, mode, hidden)
				}
			}
		}
	}
}
