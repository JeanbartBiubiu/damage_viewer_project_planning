package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	guinsooProviderRef = "champion:source_demo"
	guinsooStackKey    = "guinsoos_seething_strike"
	guinsooHitAbility  = "basic_attack_hit"
	guinsooHitEvent    = "event:basic_attack_hit"
)

func guinsooASIntervalFormula() *model.GenericFormulaExpr {
	e := model.GenericFormulaExpr{
		Op: "div",
		Args: []model.GenericFormulaExpr{
			gfConst(1000),
			{Op: "read", Path: "source.attr.attack_speed.resolved"},
		},
	}
	return &e
}

func guinsooPerStackASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: "guinsoo_seething_as",
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(0.08),
				{Op: "read", Path: "provider.state." + guinsooStackKey},
			},
		},
	}
}

func guinsooStackSchema() map[string]interface{} {
	return map[string]interface{}{
		guinsooStackKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(3000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func guinsooBasicAttackHitOps() []model.OperationDefinition {
	one := 1.0
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         guinsooStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation: "emit_event",
			Target:    "target",
			Ref:       guinsooHitEvent,
		},
	}
}

func loadGuinsooHFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)

	compileReq.SharedProviders[0].InitialStateSchema = guinsooStackSchema()
	compileReq.SharedProviders[0].Modifiers = []model.ModifierDefinition{guinsooPerStackASModifier()}
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = guinsooHitAbility
	compileReq.SharedProviders[0].Abilities[0].Operations = guinsooBasicAttackHitOps()

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: 1, Current: 1, Max: 3, Resolved: 1,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	abilityRef := "source.provider[" + guinsooProviderRef + "].ability[" + guinsooHitAbility + "]"
	runReq.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey:   "guinsoo_aa",
		AbilityRef: abilityRef,
		Source:     model.SelectorSource,
		Target:     model.SelectorTarget,
		FirstAtMs:  0,
		Repeat: &model.DriverRepeat{
			IntervalFormula: guinsooASIntervalFormula(),
		},
	}}
	runReq.StopPolicy.DurationMs = 6000
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 10000
	return compileReq, runReq
}

func sourceAttrResolved(t *testing.T, snap model.Snapshot, attr string) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes[attr]
		if !ok {
			t.Fatalf("source missing attr %s", attr)
		}
		if slot.Resolved != 0 {
			return slot.Resolved
		}
		return slot.Current
	}
	t.Fatal("source combatant missing")
	return 0
}

func expectedGuinsooIntervals(stacksAfterHit int) int64 {
	as := 1 + 0.08*float64(stacksAfterHit)
	return int64(math.Round(1000 / as))
}

func TestGenericRunGuinsooHCadenceIntervals(t *testing.T) {
	compileReq, runReq := loadGuinsooHFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}

	times := emittedEventTimes(done, guinsooHitEvent)
	if len(times) < 6 {
		t.Fatalf("hit times=%v want >=6 samples", times)
	}

	// Adjacent intervals for first five attacks use post-hit stacks 1..4 (then capped).
	wantGaps := []int64{
		expectedGuinsooIntervals(1), // 926
		expectedGuinsooIntervals(2), // 862
		expectedGuinsooIntervals(3), // 806
		expectedGuinsooIntervals(4), // 758
	}
	if wantGaps[0] != 926 || wantGaps[1] != 862 || wantGaps[2] != 806 || wantGaps[3] != 758 {
		t.Fatalf("formula check gaps=%v want [926 862 806 758]", wantGaps)
	}
	for i, want := range wantGaps {
		got := times[i+1] - times[i]
		if got != want {
			t.Fatalf("gap[%d]=%d want %d (times=%v)", i, got, want, times[:6])
		}
	}
	// 5th hit still capped; subsequent interval stays 758.
	gapAfterFifth := times[5] - times[4]
	if gapAfterFifth != 758 {
		t.Fatalf("gap after 5th hit=%d want 758 (still capped)", gapAfterFifth)
	}

	state := sourceProviderState(t, done.FinalSnapshot, guinsooProviderRef)["state"].(map[string]interface{})
	if stacks, _ := state[guinsooStackKey].(float64); stacks != 4 {
		t.Fatalf("final stacks=%v want 4", stacks)
	}
	as := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")
	if math.Abs(as-1.32) > 1e-9 {
		t.Fatalf("final attack_speed.resolved=%v want 1.32", as)
	}
}

func TestGenericRunGuinsooHExpireRestoresCadenceAndSnapshotShape(t *testing.T) {
	compileReq, runReq := loadGuinsooHFixture(t)
	abilityRef := runReq.DriverPlan.Entries[0].AbilityRef

	stacking := compileReq.SharedProviders[0].Abilities[0]
	one := 1.0
	probe := model.AbilityDefinition{
		AbilityKey: "as_probe",
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
			{
				Operation: "emit_event",
				Target:    "target",
				Ref:       "event:as_probe",
			},
		},
	}
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{stacking, probe}

	probeRef := "source.provider[" + guinsooProviderRef + "].ability[as_probe]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{
			EntryKey:   "stack_once",
			AbilityRef: abilityRef,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  0,
			Repeat:     &model.DriverRepeat{IntervalFormula: guinsooASIntervalFormula(), MaxAttempts: 1},
		},
		{
			EntryKey:   "after_expire",
			AbilityRef: probeRef,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  3500, // past expireAt=3000; lazy-expire restores AS=1
			Repeat:     &model.DriverRepeat{IntervalFormula: guinsooASIntervalFormula(), MaxAttempts: 2},
		},
	}
	runReq.StopPolicy.DurationMs = 5000
	runReq.Sampling.SampleEveryMs = 10000

	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}

	probeTimes := emittedEventTimes(done, "event:as_probe")
	if len(probeTimes) != 2 {
		t.Fatalf("probe times=%v want 2", probeTimes)
	}
	if probeTimes[0] != 3500 {
		t.Fatalf("first probe at %d want 3500", probeTimes[0])
	}
	gap := probeTimes[1] - probeTimes[0]
	if gap != 1000 {
		t.Fatalf("post-expire dynamic interval=%d want 1000 (AS restored to 1)", gap)
	}

	as := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")
	if math.Abs(as-1.0) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want 1 after expire (probe does not re-stack)", as)
	}
	bag := sourceProviderState(t, done.FinalSnapshot, guinsooProviderRef)
	state, _ := bag["state"].(map[string]interface{})
	if state == nil {
		t.Fatalf("state missing: %+v", bag)
	}
	if _, has := state["expireAt"]; has {
		t.Fatalf("state must stay numeric shape: %+v", state)
	}
	expireAt, _ := bag["expireAt"].(map[string]interface{})
	if expireAt == nil {
		t.Fatalf("snapshot must emit expireAt map: %+v", bag)
	}
	if stacksExp, has := expireAt[guinsooStackKey]; has && stacksExp != nil && stacksExp != 0.0 {
		t.Fatalf("expired default stacks must not keep positive expireAt: %+v", expireAt)
	}
	if stacks, _ := state[guinsooStackKey].(float64); stacks != 0 {
		t.Fatalf("stacks after expire=%v want 0", stacks)
	}
}
