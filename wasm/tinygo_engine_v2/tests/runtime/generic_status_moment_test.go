// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	reflect "reflect"
	strings "strings"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func momentSlowValue(late model.GenericFormulaExpr) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{
		{Op: "lt", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.elapsed_ms"}, statusConst(1000)}},
		statusConst(0), late,
	}}
}

func momentSlowProvider() model.ProviderDefinition {
	provider := slowProvider("landing_slow", "slow", "landing", 0, 2500)
	provider.StatusContributions[0].ValueReadMode = model.StatusValueReadMomentEvaluation
	provider.StatusContributions[0].Strength = momentSlowValue(statusConst(.6))
	return provider
}

func momentSlowInput(t *testing.T, endpoint int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	return withSlowProviders(t, []model.ProviderDefinition{momentSlowProvider()},
		[]model.AbilityDefinition{statusAbility("apply", nil, applyOp("landing_slow"))},
		[]model.DriverEntry{{EntryKey: "apply", AbilityRef: timedShieldRef("apply"), Source: "source", Target: "target", FirstAtMs: 1125}}, endpoint)
}

func momentTargetProvider(t *testing.T, done model.DoneResult, definition string) (model.CombatantProviderSnapshot, bool) {
	t.Helper()
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key == "target" {
			for _, instance := range actor.Providers {
				if instance.DefinitionRef == definition {
					return instance, true
				}
			}
		}
	}
	return model.CombatantProviderSnapshot{}, false
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func TestMomentSlowRefreshResetsActualTimeAndOldExpiryDoesNotRemove(t *testing.T) {
	for _, endpoint := range []int64{1999, 2000, 2499, 2500, 2999, 3000, 4499, 4500} {
		c, r := momentSlowInput(t, endpoint)
		r.DriverPlan.Entries[0].FirstAtMs = 0
		// Refresh strictly before the original expiry to exercise stale cleanup.
		r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "refresh", AbilityRef: timedShieldRef("apply"), Source: "source", Target: "target", FirstAtMs: 2000})
		done := c1Run(t, c, r)
		current := endpoint
		provider, present := momentTargetProvider(t, done, "landing_slow")
		if current < 2000 {
			continue
		}
		if current >= 4500 {
			if present {
				t.Fatal("refreshed provider remained at its actual expiry", current, provider)
			}
			continue
		}
		want := 0.0
		if current >= 3000 {
			want = .6
		}
		if !present || provider.AppliedAtMs == nil || *provider.AppliedAtMs != 2000 || *provider.ExpireAt != 4500 || effectiveSlow(t, done).Strength != want {
			t.Fatal("refresh failed to reset own elapsed or stale cleanup removed it", current, provider, effectiveSlow(t, done))
		}
		applies, refreshes := providerEvidence(done, model.EvidenceKindProviderApply), providerEvidence(done, model.EvidenceKindProviderRefresh)
		if len(applies) != 1 || len(refreshes) != 1 || applies[0].Ref != refreshes[0].Ref || provider.ProviderRef != applies[0].Ref {
			t.Fatal("source_target refresh changed identity", applies, refreshes, provider)
		}
	}
}

func TestMomentSlowMaxKeepsWeakerAndRestoresBothDirections(t *testing.T) {
	for _, endpoint := range []int64{999, 1000, 1499, 1500, 2499, 2500} {
		c, r := withSlowProviders(t,
			[]model.ProviderDefinition{momentSlowProvider(), slowProvider("strong", "strong", "strong", .8, 1500), slowProvider("weak", "weak", "weak", .3, 4000)},
			[]model.AbilityDefinition{statusAbility("apply", nil, applyOp("landing_slow"), applyOp("strong"), applyOp("weak"))},
			[]model.DriverEntry{{EntryKey: "apply", AbilityRef: timedShieldRef("apply"), Source: "source", Target: "target"}}, endpoint)
		done := c1Run(t, c, r)
		got := effectiveSlow(t, done)
		want, count := .8, 3
		if endpoint >= 1500 {
			want, count = .6, 2
		}
		if endpoint >= 2500 {
			want, count = .3, 1
		}
		if got.Strength != want || len(got.Contributions) != count {
			t.Fatal(endpoint, got, want, count)
		}
		if endpoint < 2500 {
			wantCurrent := 0.0
			if endpoint >= 1000 {
				wantCurrent = .6
			}
			for _, contribution := range got.Contributions {
				if contribution.ResultRef == "slow" && contribution.Strength != wantCurrent {
					t.Fatal("maximum hid the weaker instance's own current strength", endpoint, got)
				}
			}
		}
	}
}

func TestMomentSlowQuietEvaluationErrorsFailFormalRun(t *testing.T) {
	for _, late := range []model.GenericFormulaExpr{
		statusConst(-.1), statusConst(1.01),
		{Op: "mul", Args: []model.GenericFormulaExpr{statusConst(.6), statusConst(2)}},
		{Op: "div", Args: []model.GenericFormulaExpr{statusConst(1), statusConst(0)}},
		{Op: "mul", Args: []model.GenericFormulaExpr{statusConst(math.MaxFloat64), statusConst(2)}},
	} {
		c, r := momentSlowInput(t, 2125)
		c.SharedProviders[1].StatusContributions[0].Strength = momentSlowValue(late)
		compiled := compile.CompileGeneric(c)
		if !compiled.OK {
			t.Fatal("future branch must be verified by the actual runtime observation", compiled.Result.Errors)
		}
		r.StopPolicy.DurationMs = 2124
		if before, err := runtimeengine.RunGeneric(compiled.Session, r); err != nil || !before.OK || effectiveSlow(t, before).Strength != 0 {
			t.Fatal("unselected future arithmetic failed early", err, before.Summary)
		}
		r.StopPolicy.DurationMs = 2125
		if done, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil || done.OK || !strings.Contains(err.Path, ".strength") {
			t.Fatal("invalid current strength escaped formal run error channel", late, done.OK, err)
		}
	}
}

func TestMomentSlowExplicitClampAndOldSnapshotClampKeepFormulaMeaning(t *testing.T) {
	for _, mode := range []string{model.StatusValueReadMomentEvaluation, "", model.StatusValueReadApplicationSnapshot} {
		c, r := momentSlowInput(t, 2125)
		contribution := &c.SharedProviders[1].StatusContributions[0]
		contribution.ValueReadMode = mode
		value := model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{statusConst(.6), statusConst(2)}}
		contribution.Strength = model.GenericFormulaExpr{Op: "clamp", Expr: &value, Min: statusDuration(0), Max: statusDuration(1)}
		if mode == model.StatusValueReadMomentEvaluation {
			contribution.Strength = momentSlowValue(contribution.Strength)
		}
		done := c1Run(t, c, r)
		if got := effectiveSlow(t, done); got.Strength != 1 {
			t.Fatal("explicit formula clamp changed or was forbidden", mode, got)
		}
	}
}

func TestMomentSlowFrozenCommonParameterNeedsNoLiveAbilityContext(t *testing.T) {
	c, r := momentSlowInput(t, 2125)
	c.SharedProviders[1].SkillKey = "configured_skill"
	c.Formulas = append(c.Formulas, formuladefinition.FromExpr("selected_strength", "configured_skill", model.GenericFormulaExpr{Op: "read", Path: "ability.param.strength"}, map[string]float64{"strength": .6}))
	c.SharedProviders[1].StatusContributions[0].Strength = momentSlowValue(model.GenericFormulaExpr{Op: "ref", Ref: "selected_strength"})
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	*c.Formulas[len(c.Formulas)-1].Parameters[0].Value = .9
	if done, err := runtimeengine.RunGeneric(compiled.Session, r); err != nil || effectiveSlow(t, done).Strength != .6 {
		t.Fatal("observation borrowed live ability parameters or caller-owned values", err, done.Summary)
	}
}

func TestMomentSlowCommonFormulaAndLegacySnapshotRemainIsolated(t *testing.T) {
	c, r := momentSlowInput(t, 2125)
	c.SharedProviders[1].SkillKey = "configured_skill"
	definition := model.NamedFormula{Key: "landing", Scope: "skill", SkillKey: "configured_skill", Parameters: []model.FormulaParameter{},
		Expression: formuladefinition.Definition([]any{map[string]any{"key": "elapsed", "binding": map[string]any{"kind": "context", "contextKey": "effect_elapsed_ms"}}},
			[]any{formuladefinition.Stage("value", map[string]any{"op": "if", "args": []any{
				map[string]any{"op": "lt", "args": []any{map[string]any{"op": "read", "inputKey": "elapsed"}, formuladefinition.Const(1000)}}, formuladefinition.Const(0), formuladefinition.Const(.6),
			}})}, "value")}
	c.Formulas = append(c.Formulas, definition)
	c.SharedProviders[1].StatusContributions[0].Strength = model.GenericFormulaExpr{Op: "ref", Ref: definition.Key}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	done, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err != nil || effectiveSlow(t, done).Strength != .6 {
		t.Fatal(done.Summary, err)
	}
	if again, err := runtimeengine.RunGeneric(compiled.Session, r); err != nil || !reflect.DeepEqual(done, again) {
		t.Fatal("same session reused mutable observation state", err)
	}
	for _, mode := range []string{"", model.StatusValueReadApplicationSnapshot} {
		old, request := momentSlowInput(t, 2125)
		old.SharedProviders[1].StatusContributions[0].ValueReadMode = mode
		old.SharedProviders[1].StatusContributions[0].Strength = model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{{Op: "read", Path: "source.attr.attack_damage.resolved"}, statusConst(1000)}}
		old.SharedProviders[0].Abilities = append(old.SharedProviders[0].Abilities, statusAbility("change", nil, model.OperationDefinition{Operation: "attribute_change", Target: "source", AttributeKey: "attack_damage", ValuePolicy: "set", Amount: statusDuration(900)}))
		request.DriverPlan.Entries = append(request.DriverPlan.Entries, model.DriverEntry{EntryKey: "change", AbilityRef: timedShieldRef("change"), Source: "source", Target: "target", FirstAtMs: 1200})
		result := c1Run(t, old, request)
		initial := old.Combatants[0].Attributes["attack_damage"].Resolved / 1000
		if got := effectiveSlow(t, result); got.Strength != initial {
			t.Fatal("old snapshot mode started reading a live attribute", mode, got, initial)
		}
	}
}
