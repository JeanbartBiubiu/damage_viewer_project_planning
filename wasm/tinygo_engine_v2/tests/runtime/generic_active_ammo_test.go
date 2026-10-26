// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	reflect "reflect"
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func activeAmmoInput(initial float64, remaining *float64, automatic bool, duration int64) (model.CompileRequest, model.RunRequest) {
	c, r := singleSkillInput(false)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"}, model.TypeCatalogEntry{Key: model.EventTypeBasicAttackHit, Domain: "event"}, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	p := &c.SharedProviders[0]
	recovery := map[string]any{"intervalMs": authoringConst(2500), "mode": model.AmmoRecoveryOneByOne, "startCondition": model.AmmoRecoveryAfterConsume}
	if remaining != nil {
		recovery["initialRemainingMs"] = *remaining
	}
	p.InitialStateSchema = map[string]any{
		"rounds": map[string]any{"valueType": model.ProviderStateValueInteger, "defaultValue": initial, "maxValue": 4, "stateKind": model.ProviderStateKindAmmo, "ammoRecovery": recovery},
		"fired":  map[string]any{"valueType": model.ProviderStateValueInteger, "defaultValue": 0, "maxValue": 100, "durationMs": 0},
	}
	p.Processes[0].Steps[0].DelayMs = timedShieldExpr(1)
	p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{
		{Operation: "state_change", Target: "self", Ref: "rounds", Types: []string{"state_scope/provider"}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(-1))},
		{Operation: "state_change", Target: "self", Ref: "fired", Types: []string{"state_scope/provider"}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))},
	}}}
	for i := range c.Combatants {
		hp := c.Combatants[i].Attributes["hp"]
		hp.Base, hp.Current, hp.Max, hp.Resolved = 1e6, 1e6, 1e6, 1e6
		c.Combatants[i].Attributes["hp"] = hp
	}
	r.DriverPlan.SkillActions[0].FirstAtMs = 0
	if automatic {
		r.DriverPlan.SkillActions = []model.SkillActionPlan{}
		r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{{RuleKey: "rounds", BindingKey: "bound_spell", SortOrder: 0, Target: "target", HitBindings: []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "TARGET_HIT"}}, WaitForCooldowns: []string{}}}}
	}
	r.StopPolicy.DurationMs = duration
	max := 200
	r.RecordBudget = &model.RecordBudget{MaxMechanicRecords: &max}
	return c, r
}

func activeAmmoStarts(done model.DoneResult) []int64 {
	out := []int64{}
	for _, row := range done.AutomaticSkillRecords {
		if row.Kind == model.AutomaticRecordStarted {
			out = append(out, row.TimeMs)
		}
	}
	for _, row := range done.SkillActionRecords {
		if row.Outcome == "ACCEPTED" {
			out = append(out, row.ActualAtMs)
		}
	}
	return out
}

func TestActiveAmmoInitialExplicitZeroAndPartialInventory(t *testing.T) {
	for _, test := range []struct {
		initial, remaining float64
		starts             []int64
	}{
		{0, 0, []int64{0, 2500, 5000}}, {0, 500, []int64{500, 3000}}, {1, 500, []int64{0, 1000, 3000}}, {3, 2500, []int64{0, 1000, 2000, 3000, 5000}},
	} {
		c, r := activeAmmoInput(test.initial, &test.remaining, true, 5000)
		d := authoringRun(t, c, r)
		if got := activeAmmoStarts(d); !reflect.DeepEqual(got, test.starts) {
			t.Fatalf("initial=%v remaining=%v got=%v want=%v", test.initial, test.remaining, got, test.starts)
		}
		if test.remaining == 0 && (len(d.MechanicRecords) < 3 || d.MechanicRecords[1].Kind != model.MechanicStateChanged || d.MechanicRecords[1].TimeMs != 0) {
			t.Fatal("explicit zero did not settle a real recovery before the action", d.MechanicRecords)
		}
	}
}

func TestActiveAmmoManualEmptyRejectsWithoutCostsOrAuthorWrites(t *testing.T) {
	remaining := float64(500)
	c, r := activeAmmoInput(0, &remaining, false, 100)
	c.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 10, Max: 10}
	c.SharedProviders[0].Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "energy", Amount: authoringConst(3)}}
	d := authoringRun(t, c, r)
	if d.Summary.SkillActions.RejectedCount != 1 || d.Summary.SkillActions.AcceptedCount != 0 || len(d.SkillActionRecords) != 1 || d.SkillActionRecords[0].Reason == nil || *d.SkillActionRecords[0].Reason != "ammo_empty" {
		t.Fatal(d.SkillActionRecords, d.Summary)
	}
	for _, actor := range d.FinalSnapshot.Combatants {
		if actor.Key == "source" {
			if actor.Resources["energy"].Current != 10 || len(actor.Cooldowns) != 0 {
				t.Fatal("rejection paid partial costs", actor)
			}
		}
	}
}

func appendActiveAmmo(t *testing.T, c *model.CompileRequest, r *model.RunRequest, name string, initial float64, remaining *float64) {
	t.Helper()
	extra, run := activeAmmoInput(initial, remaining, true, r.StopPolicy.DurationMs)
	raw, _ := json.Marshal(extra.SharedProviders[0])
	raw = []byte(strings.NewReplacer("skill_source", name+"_definition", "configured_spell", name, "damage/physical", "damage/physics").Replace(string(raw)))
	var p model.ProviderDefinition
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: name, DefinitionRef: p.ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: name, DefinitionRef: p.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	for _, entry := range extra.TypeCatalog.Types {
		if entry.Key == "damage/physical" {
			continue
		}
		found := false
		for _, current := range c.TypeCatalog.Types {
			found = found || current.Key == entry.Key
		}
		if !found {
			c.TypeCatalog.Types = append(c.TypeCatalog.Types, entry)
		}
	}
	binding := extra.Rules.SkillActionBindings[0]
	binding.BindingKey, binding.SkillKey, binding.ProviderRef, binding.ProviderDefinitionRef = name+"_binding", name, name, p.ProviderKey
	binding.Controls[0].AbilityRef = "source.provider[" + name + "].ability[initial]"
	binding.HitBindings[0].HitAbilityRef = "source.provider[" + name + "].ability[hit]"
	c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, binding)
	if r.DriverPlan.AutomaticSkills == nil {
		r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{}}
	}
	rule := run.DriverPlan.AutomaticSkills.Rules[0]
	rule.RuleKey, rule.BindingKey, rule.SortOrder = name, binding.BindingKey, len(r.DriverPlan.AutomaticSkills.Rules)
	r.DriverPlan.AutomaticSkills.Rules = append(r.DriverPlan.AutomaticSkills.Rules, rule)
	max := 300
	r.RecordBudget = &model.RecordBudget{MaxMechanicRecords: &max}
}

func TestActiveAmmoRealHitRefundWakesAndDoesNotDelayOrdinaryAttacks(t *testing.T) {
	c, r := continuousAttackInput(1, 100000, 10, 0, 0, 5000)
	remaining := float64(2000)
	appendActiveAmmo(t, &c, &r, "charged", 0, &remaining)
	p := &c.SharedProviders[1]
	p.Listeners = []model.ListenerDefinition{{ListenerKey: "refund", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}}, MaxTriggersPerEvent: 1, Operations: []model.OperationDefinition{{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: "rounds", Types: []string{"state_scope/provider"}, ValuePolicy: "subtract", Amount: timedShieldExpr(1000)}}}}
	d := authoringRun(t, c, r)
	if got := activeAmmoStarts(d); !reflect.DeepEqual(got, []int64{1000, 2000, 3500, 5000}) {
		t.Fatal("real refund did not wake exact deadline", got, d.AutomaticSkillSummary)
	}
	if len(d.AttackRecords) != 6 {
		t.Fatal("active ammo prevented basic attacks", d.AttackRecords)
	}
	for i, row := range d.AttackRecords {
		if row.StartAtMs != int64(i*1000) {
			t.Fatal("active ammo changed native attack cadence", d.AttackRecords)
		}
	}
}

func TestActiveAmmoStaticSceneRemainingAndDynamicIntervalValidation(t *testing.T) {
	for _, scenario := range []string{"zero", "positive", "missing", "foreign", "dynamic_interval"} {
		t.Run(scenario, func(t *testing.T) {
			remaining := float64(0)
			if scenario != "zero" {
				remaining = 500
			}
			c, r := activeAmmoInput(0, &remaining, true, 3000)
			p := &c.SharedProviders[0]
			p.SkillKey = "configured_spell"
			f := formuladefinition.FromExpr("initial_recharge", "configured_spell", authoringRead("ability.param.remaining"), nil)
			f.Parameters[0].ValueType = "INTEGER"
			f.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: model.Float64Ptr(remaining)}
			if scenario == "missing" {
				f.Parameters[0].RuntimeSource = nil
			}
			if scenario == "foreign" {
				f.SkillKey = "foreign"
			}
			c.Formulas = append(c.Formulas, f)
			recovery := p.InitialStateSchema["rounds"].(map[string]any)["ammoRecovery"].(map[string]any)
			recovery["initialRemainingMs"] = map[string]any{"op": "ref", "ref": "initial_recharge"}
			if scenario == "dynamic_interval" {
				recovery["intervalMs"] = authoringRead("source.attr.reload_ms.resolved")
				c.Combatants[0].Attributes["reload_ms"] = authoringSlot(499)
			}
			result := compilebundle.CompileGeneric(c)
			if scenario == "missing" || scenario == "foreign" {
				if result.OK {
					t.Fatal("invalid static source compiled")
				}
				return
			}
			if !result.OK {
				t.Fatal(result.Result.Errors)
			}
			done, err := runtimeengine.RunGeneric(result.Session, r)
			if scenario == "dynamic_interval" {
				if err == nil {
					t.Fatal("initial remaining exceeded runtime interval", done)
				}
				return
			}
			if err != nil || activeAmmoStarts(done)[0] != int64(remaining) {
				t.Fatal("strict scene ref was not frozen", err, done.AutomaticSkillSummary)
			}
		})
	}
}

func TestActiveAmmoOrdinaryIntegerFreezeAndCycleCommitWithMiss(t *testing.T) {
	c, r := activeAmmoInput(4, nil, true, 3000)
	p := &c.SharedProviders[0]
	p.InitialStateSchema["frozen"] = map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 2, "durationMs": 0}
	p.InitialStateSchema["next"] = map[string]any{"valueType": "integer", "defaultValue": 1, "maxValue": 2, "durationMs": 0}
	ops := p.Processes[0].MomentOperations[0].Operations[:1]
	ops = append(ops, model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "frozen", Types: []string{"state_scope/provider"}, ValuePolicy: "set", Amount: authoringAmount(authoringRead("provider.state.next"))}, model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "next", Types: []string{"state_scope/provider"}, ValuePolicy: "set", Amount: authoringAmount(model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringBinary("eq", authoringRead("provider.state.next"), authoringConst(2)), authoringConst(0), authoringBinary("add", authoringRead("provider.state.next"), authoringConst(1))}})})
	p.Processes[0].MomentOperations[0].Operations = ops
	r.DriverPlan.AutomaticSkills.Rules[0].HitBindings[0].Preset = "MISS"
	d := authoringRun(t, c, r)
	if d.Summary.SkillUses.HitCount != 0 || d.AutomaticSkillSummary.StartedCount != 4 || cadenceStateValue(t, d, 0, "caster", "frozen") != 1 || cadenceStateValue(t, d, 0, "caster", "next") != 2 || cadenceStateValue(t, d, 0, "caster", "rounds") != 1 {
		t.Fatal("miss rolled back author cycle or ammo", d.Summary, d.FinalSnapshot)
	}
}
