package runtime

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	gort "runtime"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func timedShieldExpr(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func timedShieldLoad(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	_, file, _, ok := gort.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.CompileRequest, fixture.RunRequest
}

func timedShieldRef(abilityKey string) string {
	return "source.provider[champion:source_demo].ability[" + abilityKey + "]"
}

func timedShieldAbility(key string, ops []model.OperationDefinition) model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: key,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: ops,
	}
}

func timedShieldMustRun(t *testing.T, c model.CompileRequest, r model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	r.ExpectedRulesHash = result.Session.RulesHash
	r.InitialSnapshot.SchemaHash = result.Session.SchemaHash
	r.InitialSnapshot.RulesHash = result.Session.RulesHash
	done, err := RunGeneric(result.Session, r)
	if err != nil {
		t.Fatalf("run: %+v", err)
	}
	return done
}

func timedShieldMustFail(t *testing.T, c model.CompileRequest, r model.RunRequest) (*model.EngineError, model.DoneResult) {
	t.Helper()
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	r.ExpectedRulesHash = result.Session.RulesHash
	r.InitialSnapshot.SchemaHash = result.Session.SchemaHash
	r.InitialSnapshot.RulesHash = result.Session.RulesHash
	done, err := RunGeneric(result.Session, r)
	if err == nil {
		t.Fatal("expected run failure")
	}
	return err, done
}

func timedTarget(t *testing.T, done model.DoneResult) model.CombatantSnapshot {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorTarget {
			return c
		}
	}
	t.Fatal("missing target snapshot")
	return model.CombatantSnapshot{}
}

func TestTimedShieldAbsorbsDuringWindowAndSameFrame(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply_shield", []model.OperationDefinition{{
			Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse",
			ShieldDurationMs: timedShieldExpr(200),
		}}),
		timedShieldAbility("deal_damage", []model.OperationDefinition{{
			Operation: "damage", Target: "target", Amount: timedShieldExpr(100), DamageType: "damage/physical",
		}}),
	}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "shield", AbilityRef: timedShieldRef("apply_shield"), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "hit", AbilityRef: timedShieldRef("deal_damage"), Source: "source", Target: "target", FirstAtMs: 50},
	}
	r.StopPolicy.DurationMs = 150
	done := timedShieldMustRun(t, c, r)
	if done.Summary.TargetFinalHp != 950 {
		t.Fatalf("targetFinalHp=%v want 950", done.Summary.TargetFinalHp)
	}
	if done.Summary.SourceDamageDealt != 100 {
		t.Fatalf("sourceDamageDealt=%v want 100", done.Summary.SourceDamageDealt)
	}
}

func TestTimedShieldSameFrameApplyCanAbsorb(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse", ShieldDurationMs: timedShieldExpr(2000)},
		{Operation: "damage", Target: "target", Amount: timedShieldExpr(100), DamageType: "damage/physical"},
	}
	r.StopPolicy.DurationMs = 100
	done := timedShieldMustRun(t, c, r)
	if done.Summary.TargetFinalHp != 950 {
		t.Fatalf("targetFinalHp=%v want 950", done.Summary.TargetFinalHp)
	}
}

func TestTimedShieldExpiredSameTickDoesNotAbsorb(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply_shield", []model.OperationDefinition{{
			Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse",
			ShieldDurationMs: timedShieldExpr(200),
		}}),
		timedShieldAbility("deal_damage", []model.OperationDefinition{{
			Operation: "damage", Target: "target", Amount: timedShieldExpr(100), DamageType: "damage/physical",
		}}),
	}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "shield", AbilityRef: timedShieldRef("apply_shield"), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "hit", AbilityRef: timedShieldRef("deal_damage"), Source: "source", Target: "target", FirstAtMs: 200},
	}
	r.StopPolicy.DurationMs = 250
	done := timedShieldMustRun(t, c, r)
	if done.Summary.TargetFinalHp != 900 {
		t.Fatalf("targetFinalHp=%v want 900", done.Summary.TargetFinalHp)
	}
	target := timedTarget(t, done)
	if len(target.Shields) != 0 {
		t.Fatalf("shields=%+v want empty after expiry", target.Shields)
	}
}

func TestTimedShieldUntimedStillPermanent(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse"},
	}
	r.StopPolicy.DurationMs = 100
	done := timedShieldMustRun(t, c, r)
	target := timedTarget(t, done)
	if len(target.Shields) != 1 || target.Shields[0].ShieldRef != "eclipse" || target.Shields[0].ExpireAt != nil {
		t.Fatalf("untimed shield=%+v", target.Shields)
	}
}

func TestTimedShieldPersistsExpireAt(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse",
		ShieldDurationMs: timedShieldExpr(2000),
	}}
	r.StopPolicy.DurationMs = 100
	done := timedShieldMustRun(t, c, r)
	target := timedTarget(t, done)
	if len(target.Shields) != 1 {
		t.Fatalf("shields=%+v", target.Shields)
	}
	if target.Shields[0].ShieldRef != "eclipse#1" {
		t.Fatalf("shieldRef=%q", target.Shields[0].ShieldRef)
	}
	if target.Shields[0].ExpireAt == nil || *target.Shields[0].ExpireAt != 2000 {
		t.Fatalf("expireAt=%v want 2000", target.Shields[0].ExpireAt)
	}
}

func TestTimedShieldRefsDoNotCollideWithRestoredOrPrior(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply_shield", []model.OperationDefinition{{
			Operation: "shield", Target: "target", Amount: timedShieldExpr(40), ShieldRef: "eclipse",
			ShieldDurationMs: timedShieldExpr(2000),
		}}),
	}
	expire := int64(5000)
	r.InitialSnapshot.Combatants[1].Shields = []model.CombatantShieldSnapshot{{
		ShieldRef: "eclipse#1", Source: "source", Owner: "target", Remaining: 30, ExpireAt: &expire,
	}}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "s1", AbilityRef: timedShieldRef("apply_shield"), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "s2", AbilityRef: timedShieldRef("apply_shield"), Source: "source", Target: "target", FirstAtMs: 10},
	}
	r.StopPolicy.DurationMs = 50
	done := timedShieldMustRun(t, c, r)
	target := timedTarget(t, done)
	if len(target.Shields) != 3 {
		t.Fatalf("shields=%+v want 3", target.Shields)
	}
	seen := map[string]int{}
	for _, sh := range target.Shields {
		seen[sh.ShieldRef]++
	}
	if seen["eclipse#1"] != 1 || seen["eclipse#2"] != 1 || seen["eclipse#3"] != 1 {
		t.Fatalf("refs=%+v want eclipse#1,#2,#3", target.Shields)
	}
}

func TestTimedShieldRestoreCleanupAndStaleEvent(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation: "heal", Target: "target", Amount: timedShieldExpr(0),
	}}
	expire := int64(100)
	r.InitialSnapshot.Combatants[1].Shields = []model.CombatantShieldSnapshot{{
		ShieldRef: "eclipse#1", Source: "source", Owner: "target", Remaining: 40, ExpireAt: &expire,
	}}
	r.StopPolicy.DurationMs = 200
	done := timedShieldMustRun(t, c, r)
	target := timedTarget(t, done)
	if len(target.Shields) != 0 {
		t.Fatalf("restored shield should expire, got %+v", target.Shields)
	}

	c2, r2 := timedShieldLoad(t)
	c2.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation: "shield", Target: "target", Amount: timedShieldExpr(40), ShieldRef: "eclipse",
		ShieldDurationMs: timedShieldExpr(2000),
	}}
	later := int64(5000)
	r2.InitialSnapshot.Combatants[1].Shields = []model.CombatantShieldSnapshot{{
		ShieldRef: "eclipse#1", Source: "source", Owner: "target", Remaining: 40, ExpireAt: &later,
	}}
	r2.StopPolicy.DurationMs = 50
	result := compile.CompileGeneric(c2)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	r2.ExpectedRulesHash = result.Session.RulesHash
	r2.InitialSnapshot.SchemaHash = result.Session.SchemaHash
	r2.InitialSnapshot.RulesHash = result.Session.RulesHash
	state, err := newGenericRunState(result.Session, r2)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	newRef := ""
	for _, sh := range state.combatants[model.SelectorTarget].shields {
		if sh.ShieldRef != "eclipse#1" {
			newRef = sh.ShieldRef
			break
		}
	}
	if newRef == "" || newRef == "eclipse#1" {
		t.Fatalf("new timed ref missing: %+v", state.combatants[model.SelectorTarget].shields)
	}
	state.nowMs = 0
	state.expireCleanupPayloads = []expireCleanupPayload{{
		combatantKey: model.SelectorTarget,
		shieldRef:    "eclipse#1",
		kind:         "shield",
	}}
	state.handleExpireCleanup(scheduler.GenericEvent{
		TimeMs: 0, Category: scheduler.GenericCategoryExpireCleanup, Kind: scheduler.GenericEventExpireCleanup, DriverEntryIndex: 0,
	})
	foundRestored := false
	foundNew := false
	for _, sh := range state.combatants[model.SelectorTarget].shields {
		if sh.ShieldRef == "eclipse#1" {
			foundRestored = true
		}
		if sh.ShieldRef == newRef {
			foundNew = true
		}
	}
	if !foundRestored || !foundNew {
		t.Fatalf("stale cleanup removed live shields: %+v", state.combatants[model.SelectorTarget].shields)
	}

	state.expireCleanupPayloads = []expireCleanupPayload{{
		combatantKey: model.SelectorTarget,
		shieldRef:    newRef,
		kind:         "shield",
	}}
	state.handleExpireCleanup(scheduler.GenericEvent{
		TimeMs: 0, Category: scheduler.GenericCategoryExpireCleanup, Kind: scheduler.GenericEventExpireCleanup, DriverEntryIndex: 0,
	})
	for _, sh := range state.combatants[model.SelectorTarget].shields {
		if sh.ShieldRef == newRef {
			return
		}
	}
	t.Fatal("old expire event removed not-yet-expired new instance")
}

func TestTimedShieldMissingStrictReadFails(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse",
		ShieldDurationMs: &model.GenericFormulaExpr{Op: "read", Path: "ability.param.shield_duration_ms"},
	}}
	err, done := timedShieldMustFail(t, c, r)
	if err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want formula_type_error message=%q", err.Code, err.Message)
	}
	if !strings.Contains(err.Message, "missing ability parameter") {
		t.Fatalf("message=%q", err.Message)
	}
	if done.OK || len(done.FinalSnapshot.Combatants) != 0 {
		t.Fatalf("failed run leaked snapshot: %+v", done)
	}
}

func TestTimedShieldDynamicIllegalAndOverflowFail(t *testing.T) {
	cases := []struct {
		name   string
		param  float64
		timeMs int64
		durMs  int64
		needle string
	}{
		{"zero", 0, 0, 100, "positive integer"},
		{"fraction", 1.5, 0, 100, "positive integer"},
		{"negative", -5, 0, 100, "positive integer"},
		{"overflow", 100, math.MaxInt64 - 50, 10, "overflows"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, r := timedShieldLoad(t)
			c.SharedProviders[0].Abilities[0].Params = map[string]float64{"baseDamage": 100, "shield_duration_ms": tc.param}
			c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
				Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse",
				ShieldDurationMs: &model.GenericFormulaExpr{Op: "read", Path: "ability.param.shield_duration_ms"},
			}}
			r.InitialSnapshot.TimeMs = tc.timeMs
			r.DriverPlan.Entries[0].FirstAtMs = tc.timeMs
			r.StopPolicy.DurationMs = tc.durMs
			if tc.timeMs > math.MaxInt64/2 {
				r.Sampling.SampleEveryMs = int(tc.durMs) + 5
				r.Sampling.MaxSeriesPoints = 2
			}
			err, done := timedShieldMustFail(t, c, r)
			if err.Code != model.GenericErrFormulaTypeError {
				t.Fatalf("code=%q message=%q", err.Code, err.Message)
			}
			if !strings.Contains(err.Message, tc.needle) {
				t.Fatalf("message=%q want %q", err.Message, tc.needle)
			}
			if done.OK {
				t.Fatal("failed run returned ok snapshot")
			}
		})
	}
}

func TestTimedShieldFailedFrameDoesNotCommit(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse", ShieldDurationMs: timedShieldExpr(2000)},
		{Operation: "refresh_provider", Target: "target", ProviderRef: "missing"},
	}
	err, done := timedShieldMustFail(t, c, r)
	if err == nil {
		t.Fatal("expected failure")
	}
	if done.OK || len(done.FinalSnapshot.Combatants) != 0 {
		t.Fatalf("partial snapshot leaked: ok=%v combatants=%d", done.OK, len(done.FinalSnapshot.Combatants))
	}
}

func TestTimedShieldFailedLaterAbilityDoesNotReturnPartialSnapshot(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply_shield", []model.OperationDefinition{{
			Operation: "shield", Target: "target", Amount: timedShieldExpr(50), ShieldRef: "eclipse",
			ShieldDurationMs: timedShieldExpr(2000),
		}}),
		timedShieldAbility("bad", []model.OperationDefinition{{
			Operation: "refresh_provider", Target: "target", ProviderRef: "missing",
		}}),
	}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "s", AbilityRef: timedShieldRef("apply_shield"), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "b", AbilityRef: timedShieldRef("bad"), Source: "source", Target: "target", FirstAtMs: 10},
	}
	r.StopPolicy.DurationMs = 50
	_, done := timedShieldMustFail(t, c, r)
	if done.OK {
		t.Fatal("failed run returned usable snapshot")
	}
}

func TestTimedShieldDoesNotCollideWithUntimedCreatedInRun(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "shield", Target: "target", Amount: timedShieldExpr(30), ShieldRef: "eclipse#1"},
		{Operation: "shield", Target: "target", Amount: timedShieldExpr(40), ShieldRef: "eclipse", ShieldDurationMs: timedShieldExpr(100)},
	}
	r.StopPolicy.DurationMs = 50
	target := timedTarget(t, timedShieldMustRun(t, c, r))
	if len(target.Shields) != 2 || target.Shields[0].ShieldRef == target.Shields[1].ShieldRef {
		t.Fatalf("new timed reference collides with in-frame untimed shield: %+v", target.Shields)
	}
}

func TestTimedShieldCleanupPreservesUntimedNamesake(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "shield", Target: "target", Amount: timedShieldExpr(40), ShieldRef: "eclipse", ShieldDurationMs: timedShieldExpr(100)},
		{Operation: "shield", Target: "target", Amount: timedShieldExpr(30), ShieldRef: "eclipse#1"},
	}
	r.StopPolicy.DurationMs = 150
	target := timedTarget(t, timedShieldMustRun(t, c, r))
	if len(target.Shields) != 1 || target.Shields[0].Remaining != 30 || target.Shields[0].ExpireAt != nil {
		t.Fatalf("expiry must preserve unexpired shield with same explicit name: %+v", target.Shields)
	}
}
