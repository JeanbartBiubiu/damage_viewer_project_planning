// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	strconv "strconv"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

const targetRemainingProvider = "target_marks"

func targetRemainingStateOperation(value float64) model.OperationDefinition {
	return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "mark", Types: []string{"state_scope/provider_target"}, ValuePolicy: "set", Amount: authoringAmount(authoringConst(value))}
}

func targetRemainingProtectCondition() *model.GenericFormulaExpr {
	read := authoringRead("provider.target_state_remaining_ms.mark")
	return authoringAmount(authoringBinary("min", authoringBinary("gt", read, authoringConst(0)), authoringBinary("lt", read, authoringConst(1000))))
}

func targetRemainingInput() (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, 10000, 0, 0, 0, 8000)
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{}}
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"}, model.TypeCatalogEntry{Key: "state_scope/provider_target", Domain: "state_scope"})
	ensure := model.OperationDefinition{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: "mark", Types: []string{"state_scope/provider_target"},
		ValuePolicy: "ensure_remaining", Amount: authoringAmount(authoringConst(1250))}
	protect := ensure
	protect.Condition = targetRemainingProtectCondition()
	probe := model.OperationDefinition{Operation: "damage", Target: "target", Ref: "live_mark_probe", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(10)),
		Condition: authoringAmount(authoringBinary("gt", authoringRead("provider.target_state_remaining_ms.mark"), authoringConst(0)))}
	ability := func(key string, operations ...model.OperationDefinition) model.AbilityDefinition {
		return model.AbilityDefinition{AbilityKey: key, SkillKey: "test_mark", Kind: "active", Operations: operations}
	}
	p := model.ProviderDefinition{ProviderKey: targetRemainingProvider, StableID: "test_mark", SkillKey: "test_mark", Kind: "character",
		InitialStateSchema: map[string]any{"mark": map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 1, "durationMs": 6000, "refreshPolicy": "refresh_on_write"}},
		Abilities: []model.AbilityDefinition{ability("arm", targetRemainingStateOperation(1)), ability("clear", targetRemainingStateOperation(0)), ability("ensure", ensure), ability("protect", protect), ability("probe", probe),
			ability("fail", ensure, model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "failing_tail", Amount: authoringAmount(authoringBinary("div", authoringConst(1), authoringRead("source.attr.attack_damage.resolved")))})}}
	c.SharedProviders = append(c.SharedProviders, p)
	targetRemainingMount(&c, &r, "source", targetRemainingProvider)
	return c, r
}

func targetRemainingMount(c *model.CompileRequest, r *model.RunRequest, owner, ref string) {
	for i := range c.Combatants {
		if c.Combatants[i].Key == owner {
			c.Combatants[i].Providers = append(c.Combatants[i].Providers, model.CombatantProviderMount{ProviderRef: ref, DefinitionRef: targetRemainingProvider})
		}
	}
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key == owner {
			r.InitialSnapshot.Combatants[i].Providers = append(r.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{ProviderRef: ref, DefinitionRef: targetRemainingProvider, Source: owner, Owner: owner, Stacks: 1})
		}
	}
}

func targetRemainingEntry(key, ability string, at int64) model.DriverEntry {
	return model.DriverEntry{EntryKey: key, AbilityRef: "source.provider[" + targetRemainingProvider + "].ability[" + ability + "]", Source: "source", Target: "target", FirstAtMs: at}
}

func targetRemainingSnapshot(t *testing.T, d model.DoneResult) (float64, float64) {
	t.Helper()
	bag := sourceProviderState(t, d.FinalSnapshot, targetRemainingProvider)
	target, _ := bag["targetState"].(map[string]any)
	values, _ := target["values"].(map[string]any)
	expires, _ := target["expireAt"].(map[string]any)
	v, _ := values["mark"].(float64)
	e, _ := expires["mark"].(float64)
	return v, e
}

func TestTargetStateRemainingProtectionBoundaries(t *testing.T) {
	for _, remaining := range []int64{0, 1, 999, 1000, 1249, 1250} {
		t.Run(strconv.FormatInt(remaining, 10), func(t *testing.T) {
			c, r := targetRemainingInput()
			at := 6000 - remaining
			r.DriverPlan.Entries = []model.DriverEntry{targetRemainingEntry("mark", "arm", 0), targetRemainingEntry("r_start", "protect", at)}
			r.StopPolicy.DurationMs = at
			d := authoringRun(t, c, r)
			wantValue, wantExpiry := 1.0, 6000.0
			if remaining == 0 {
				wantValue, wantExpiry = 0, 0
			} else if remaining < 1000 {
				wantExpiry = float64(at + 1250)
			}
			value, expiry := targetRemainingSnapshot(t, d)
			if value != wantValue || expiry != wantExpiry {
				t.Fatal("independent protection boundary", remaining, value, expiry, wantValue, wantExpiry)
			}
		})
	}
}

func TestTargetStateRemainingPublicExpiryAndRepeat(t *testing.T) {
	for _, end := range []int64{6000, 6749, 6750} {
		c, r := targetRemainingInput()
		r.DriverPlan.Entries = []model.DriverEntry{targetRemainingEntry("mark", "arm", 0), targetRemainingEntry("first", "protect", 5500), targetRemainingEntry("duplicate", "protect", 5500), targetRemainingEntry("later", "protect", 5600)}
		r.StopPolicy.DurationMs = end
		d := authoringRun(t, c, r)
		value, expiry := targetRemainingSnapshot(t, d)
		wantValue, wantExpiry := 1.0, 6750.0
		if end == 6750 {
			wantValue, wantExpiry = 0, 0
		}
		if value != wantValue || expiry != wantExpiry {
			t.Fatal("old cutoff or redundant protection changed window", end, value, expiry)
		}
		for _, item := range d.Evidence.Items {
			if item.Kind == "provider_target_state_expired" && item.Ref == targetRemainingProvider && item.TimeMs != 6750 {
				t.Fatal("old cutoff published expiry", item)
			}
		}
	}
	for _, mode := range []string{"detailed", "summary"} {
		c, r := targetRemainingInput()
		r.OutputMode = model.RunOutputMode(mode)
		zero := 0
		r.RecordBudget = &model.RecordBudget{MaxDamageRecords: &zero, MaxMechanicRecords: &zero, MaxSkillUseRecords: &zero, MaxHealingRecords: &zero}
		r.DriverPlan.Entries = []model.DriverEntry{targetRemainingEntry("mark", "arm", 0), targetRemainingEntry("protect", "protect", 5500), targetRemainingEntry("probe", "probe", 6100)}
		r.StopPolicy.DurationMs = 6100
		session := authoringCompile(t, c)
		var first model.DoneResult
		for i := 0; i < 3; i++ {
			d, err := runtimeengine.RunGeneric(session, r)
			if err != nil {
				t.Fatal(err)
			}
			if i == 0 {
				first = d
			} else if !reflect.DeepEqual(d, first) {
				t.Fatal("repeat changed a cold run")
			}
		}
		if first.Summary.SourceDamageDealt != 10 {
			t.Fatal("quiet old cutoff lost active mark", first.Summary)
		}
	}
}

func TestTargetStateRemainingBasicAttackAdmission(t *testing.T) {
	c, r := continuousAttackInput(.19, 10000, 0, 0, 0, 6000)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"}, model.TypeCatalogEntry{Key: "state_scope/provider_target", Domain: "state_scope"})
	first := targetRemainingStateOperation(1)
	opened := model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "opened", Types: []string{"state_scope/provider"}, ValuePolicy: "set", Amount: authoringAmount(authoringConst(1))}
	ensure := model.OperationDefinition{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: "mark", Types: []string{"state_scope/provider_target"}, ValuePolicy: "ensure_remaining", Amount: authoringAmount(authoringConst(1250))}
	p := model.ProviderDefinition{ProviderKey: targetRemainingProvider, StableID: "test_mark", Kind: "character", SkillKey: "test_mark", InitialStateSchema: map[string]any{
		"mark":   map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 1, "durationMs": 6000, "refreshPolicy": "refresh_on_write"},
		"opened": map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 1, "durationMs": 0}}, Listeners: []model.ListenerDefinition{
		{ListenerKey: "open_once", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackStart, "event/source_owner"}}, Condition: authoringAmount(authoringBinary("eq", authoringRead("provider.state.opened"), authoringConst(0))), Operations: []model.OperationDefinition{opened, first}},
		{ListenerKey: "protect_short_timer", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackStart, "event/source_owner"}}, Condition: targetRemainingProtectCondition(), Operations: []model.OperationDefinition{ensure}}}}
	c.SharedProviders = append(c.SharedProviders, p)
	targetRemainingMount(&c, &r, "source", targetRemainingProvider)
	d := authoringRun(t, c, r)
	value, expiry := targetRemainingSnapshot(t, d)
	if value != 1 || expiry != 6513 || d.Summary.BasicAttack.StartedCount != 2 {
		t.Fatal("real background plan rejected or lost delayed protection", value, expiry, d.Summary)
	}
}

func TestTargetStateRemainingRealActiveStartAndHit(t *testing.T) {
	c, r := singleSkillInput(false)
	c.SharedProviders[0].Processes[0].Steps[0].DelayMs = authoringAmount(authoringConst(1000))
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider_target", Domain: "state_scope"}, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	ensure := model.OperationDefinition{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: "mark", Types: []string{"state_scope/provider_target"}, ValuePolicy: "ensure_remaining", Amount: authoringAmount(authoringConst(1250))}
	bonus := model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/physical", Ref: "consumed_mark", Amount: authoringAmount(authoringConst(5)),
		Condition: authoringAmount(authoringRead("provider.target_state.mark"))}
	p := model.ProviderDefinition{ProviderKey: targetRemainingProvider, StableID: "test_mark", Kind: "character", SkillKey: "test_mark", InitialStateSchema: map[string]any{
		"mark": map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 1, "durationMs": 6000, "refreshPolicy": "refresh_on_write"}},
		Listeners: []model.ListenerDefinition{
			{ListenerKey: "real_active_start", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{"event/ability_started", "event/source_owner", "ability/spell"}}, Condition: targetRemainingProtectCondition(), Operations: []model.OperationDefinition{ensure}},
			{ListenerKey: "consume_then_remark", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{"event/skill_hit", "event/source_owner", "ability/spell"}}, Operations: []model.OperationDefinition{bonus, targetRemainingStateOperation(0), targetRemainingStateOperation(1)}}}}
	c.SharedProviders = append(c.SharedProviders, p)
	targetRemainingMount(&c, &r, "source", targetRemainingProvider)
	first := r.DriverPlan.SkillActions[0]
	first.InstructionKey, first.FirstAtMs = "first", 0
	second := first
	second.InstructionKey, second.FirstAtMs, second.SortOrder = "protected", 6500, 1
	r.DriverPlan.SkillActions = []model.SkillActionPlan{first, second}
	r.StopPolicy.DurationMs = 8000
	d := timedShieldMustRun(t, c, r)
	value, expiry := targetRemainingSnapshot(t, d)
	if d.Summary.SourceDamageDealt != 205 || d.Summary.SkillActions.AcceptedCount != 2 || value != 1 || expiry != 13500 {
		t.Fatal("real start failed to keep old mark through the 1s process", d.Summary, value, expiry)
	}
	if len(d.DamageRecords) != 3 || d.DamageRecords[0]["timeMs"] != int64(1000) || d.DamageRecords[1]["timeMs"] != int64(7500) || d.DamageRecords[2]["timeMs"] != int64(7500) {
		t.Fatal("damage did not follow actual process hits", d.DamageRecords)
	}
}

func TestTargetStateRemainingDriverConditionsAndRepeatFailEarly(t *testing.T) {
	for _, place := range []string{"condition", "repeat"} {
		for _, hidden := range []bool{false, true} {
			c, r := targetRemainingInput()
			read := authoringRead("provider.target_state_remaining_ms.mark")
			if hidden {
				read = model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(1), read}}
			}
			entry := targetRemainingEntry("attempt", "arm", 0)
			if place == "condition" {
				entry.Condition = &read
			} else {
				entry.Repeat = &model.DriverRepeat{IntervalFormula: &read, MaxAttempts: 2}
			}
			r.DriverPlan.Entries = []model.DriverEntry{entry}
			_, err := runtimeengine.RunGeneric(authoringCompile(t, c), r)
			if err == nil || !strings.Contains(err.Message, "target state remaining time is unavailable") {
				t.Fatal("driver accepted unbound timer in a selected or hidden branch", place, hidden, err)
			}
		}
	}
}
