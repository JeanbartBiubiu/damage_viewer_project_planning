package execution

import (
	json "encoding/json"
	os "os"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

func timedShieldExpr(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func timedShieldLoad(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
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
	done, err := runForTest(result.Session, r)
	if err != nil {
		t.Fatalf("run: %+v", err)
	}
	return done
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
	for instanceIndex, instanceValues := 0, state.combatants[model.SelectorTarget].instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		sh := instanceValues.At(instanceIndex)
		if sh.ShieldRef != "eclipse#1" {
			newRef = sh.ShieldRef
			break
		}
	}
	if newRef == "" || newRef == "eclipse#1" {
		t.Fatalf("new timed ref missing: %+v", state.combatants[model.SelectorTarget].instances.Shields())
	}
	state.loop.Advance(0)
	replaceEffectTimePayloadsForTest(state, []effectpkg.ExpiryPayload{{
		CombatantKey: model.SelectorTarget,
		ShieldRef:    "eclipse#1",
		Kind:         "shield",
	}}, anchoredPayloadsForTest(state), true)
	state.handleExpireCleanup(scheduler.GenericEvent{
		TimeMs: 0, Category: scheduler.GenericCategoryExpireCleanup, Kind: scheduler.GenericEventExpireCleanup, DriverEntryIndex: 0,
	})
	foundRestored := false
	foundNew := false
	for instanceIndex, instanceValues := 0, state.combatants[model.SelectorTarget].instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		sh := instanceValues.At(instanceIndex)
		if sh.ShieldRef == "eclipse#1" {
			foundRestored = true
		}
		if sh.ShieldRef == newRef {
			foundNew = true
		}
	}
	if !foundRestored || !foundNew {
		t.Fatalf("stale cleanup removed live shields: %+v", state.combatants[model.SelectorTarget].instances.Shields())
	}

	replaceEffectTimePayloadsForTest(state, []effectpkg.ExpiryPayload{{
		CombatantKey: model.SelectorTarget,
		ShieldRef:    newRef,
		Kind:         "shield",
	}}, anchoredPayloadsForTest(state), true)
	state.handleExpireCleanup(scheduler.GenericEvent{
		TimeMs: 0, Category: scheduler.GenericCategoryExpireCleanup, Kind: scheduler.GenericEventExpireCleanup, DriverEntryIndex: 0,
	})
	for instanceIndex, instanceValues := 0, state.combatants[model.SelectorTarget].instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		sh := instanceValues.At(instanceIndex)
		if sh.ShieldRef == newRef {
			return
		}
	}
	t.Fatal("old expire event removed not-yet-expired new instance")
}
