package runtime

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
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

func TestMomentSlowQuietEndpointAndInclusiveExpiry(t *testing.T) {
	for _, endpoint := range []int64{1124, 1125, 2124, 2125, 3624, 3625} {
		t.Run(itoa(uint32(endpoint)), func(t *testing.T) {
			c, r := momentSlowInput(t, endpoint)
			done := c1Run(t, c, r)
			got := effectiveSlow(t, done)
			provider, present := momentTargetProvider(t, done, "landing_slow")
			wantPresent := endpoint >= 1125 && endpoint < 3625
			if present != wantPresent || len(got.Contributions) != boolInt(wantPresent) || done.FinalSnapshot.TimeMs != endpoint {
				t.Fatal(endpoint, provider, present, got, done.FinalSnapshot.TimeMs)
			}
			if !present {
				return
			}
			want := 0.0
			if endpoint >= 2125 {
				want = .6
			}
			if provider.AppliedAtMs == nil || *provider.AppliedAtMs != 1125 || provider.ExpireAt == nil || *provider.ExpireAt != 3625 || len(provider.StatusContributions) != 1 || provider.StatusContributions[0].Strength == nil || *provider.StatusContributions[0].Strength != want || got.Strength != want || got.Contributions[0].Strength != want {
				t.Fatal("current output and max contribution diverged", endpoint, provider, got)
			}
			applied := providerEvidence(done, model.EvidenceKindProviderApply)
			if len(applied) != 1 || applied[0].TimeMs != 1125 || applied[0].Data["statusContributions"].([]map[string]interface{})[0]["strength"] != 0.0 {
				t.Fatal("observation rewrote the true application snapshot", applied)
			}
		})
	}
	// There is only the original apply and its existing expiry, no landing tick.
	c, r := momentSlowInput(t, 3625)
	s := frameCommitState(t, c, r)
	if err := s.runLoop(); err != nil || s.processedEvents != 2 {
		t.Fatal("elapsed slow added an event", s.processedEvents, err)
	}
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
		if before, err := RunGeneric(compiled.Session, r); err != nil || !before.OK || effectiveSlow(t, before).Strength != 0 {
			t.Fatal("unselected future arithmetic failed early", err, before.Summary)
		}
		r.StopPolicy.DurationMs = 2125
		if done, err := RunGeneric(compiled.Session, r); err == nil || done.OK || !strings.Contains(err.Path, ".strength") {
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

func TestMomentSlowSnapshotRequiresAppliedAtAndObservationsDoNotMutate(t *testing.T) {
	c, r := momentSlowInput(t, 3624)
	r.DriverPlan.Entries[0].FirstAtMs = 0
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	before, _ := json.Marshal(s.combatants["target"].providers)
	s.nowMs = 999
	first := s.buildFinalSnapshot()
	s.nowMs = 1000
	second := s.buildFinalSnapshot()
	after, _ := json.Marshal(s.combatants["target"].providers)
	if string(before) != string(after) || effectiveSlow(t, model.DoneResult{FinalSnapshot: first}).Strength != 0 || effectiveSlow(t, model.DoneResult{FinalSnapshot: second}).Strength != .6 {
		t.Fatal("observation changed live application data or an older view", string(before), string(after), first, second)
	}
	compiled := compile.CompileGeneric(c)
	r.InitialSnapshot = second
	r.DriverPlan.Entries = nil
	r.StopPolicy.DurationMs = 1
	for _, applied := range []*int64{nil, int64PtrForElapsed(-1), int64PtrForElapsed(1001)} {
		bad := r
		bad.InitialSnapshot = model.Snapshot{}
		raw, _ := json.Marshal(second)
		if err := json.Unmarshal(raw, &bad.InitialSnapshot); err != nil {
			t.Fatal(err)
		}
		bad.InitialSnapshot.Combatants[1].Providers[0].AppliedAtMs = applied
		if done, err := RunGeneric(compiled.Session, bad); err == nil || done.OK || !strings.Contains(err.Path, "appliedAtMs") {
			t.Fatal("snapshot invented actual elapsed context", applied, err)
		}
	}
	if done, err := RunGeneric(compiled.Session, r); err != nil || !done.OK || effectiveSlow(t, done).Strength != .6 {
		t.Fatal("valid zero application time could not restore", err, done.Summary)
	}
	actor := s.combatants["target"]
	actor.providers[0].HasAppliedAt = false
	s.combatants["target"] = actor
	if done := s.buildDoneResult(); done.OK || s.processFailure == nil {
		t.Fatal("internal observation fabricated missing instance context", done.OK, s.processFailure)
	}
}

func TestMomentSlowConstantStillRequiresAnActualInstance(t *testing.T) {
	c, r := momentSlowInput(t, 2125)
	c.SharedProviders[1].StatusContributions[0].Strength = statusConst(.6)
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	actor := s.combatants["target"]
	actor.providers[0].HasAppliedAt = false
	s.combatants["target"] = actor
	if done := s.buildDoneResult(); done.OK || s.processFailure == nil {
		t.Fatal("constant MOMENT_EVALUATION bypassed the instance gate")
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
	if done, err := RunGeneric(compiled.Session, r); err != nil || effectiveSlow(t, done).Strength != .6 {
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
	done, err := RunGeneric(compiled.Session, r)
	if err != nil || effectiveSlow(t, done).Strength != .6 {
		t.Fatal(done.Summary, err)
	}
	if again, err := RunGeneric(compiled.Session, r); err != nil || !reflect.DeepEqual(done, again) {
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

func TestMomentSlowExpireAirborneKeepsIndependentSlow(t *testing.T) {
	c, r := momentSlowInput(t, 2125)
	airborne := stunProvider()
	airborne.ProviderKey, airborne.StableID = "airborne", "airborne"
	airborne.Types = []string{model.ClosedStatusKindProviderType[model.StatusKindAirborne]}
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: airborne.Types[0], Domain: "provider"})
	c.SharedProviders = append(c.SharedProviders, airborne)
	c.SharedProviders[0].Abilities[0].Operations = append(c.SharedProviders[0].Abilities[0].Operations, applyOp("airborne"))
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	s.nowMs = 500
	airRef := ""
	for _, instance := range s.combatants["target"].providers {
		if instance.DefinitionRef == "airborne" {
			airRef = instance.ProviderRef
		}
	}
	if airRef == "" {
		t.Fatal("no actual airborne instance")
	}
	f := s.newExecutionFrame("source", "target", "")
	if err := f.executeOperations(planbundle.CompiledAbility{}, []planbundle.CompiledOperation{{Operation: "expire_provider", Target: "target", ProviderRef: airRef}}); err != nil {
		t.Fatal(err)
	}
	f.commit()
	if f.fatal || !f.committed {
		t.Fatal("existing expire operation failed", f.fatalErr)
	}
	s.nowMs = 1000
	done := s.buildDoneResult()
	if _, airbornePresent := momentTargetProvider(t, done, "airborne"); airbornePresent || effectiveSlow(t, done).Strength != .6 {
		t.Fatal("clearing the independent airborne removed the slow", done.FinalSnapshot)
	}
}
