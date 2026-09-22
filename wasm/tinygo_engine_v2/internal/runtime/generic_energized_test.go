package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// Energized (Rapid Firecannon) contract tests: express the loop with pure
// listener/state data — gate before hit, then on ready magic40 + override0,
// then unconditional charge (clamp max100).
//
// Fixture uses structured untimed capped schema (durationMs=0 == Backend duration_ms NULL).

const (
	energizedChargeKey   = "energized_charge"
	energizedProviderRef = "item:rapid_firecannon_energized"
	energizedDamageOpRef = "op:energized_damage"
	energizedChampionRef = spellbladeChampionRef
	energizedHitAbility  = spellbladeHitAbilityKey
	energizedHitEvent    = spellbladeHitEvent
	energizedAADamage    = 10.0
	energizedProcRaw     = 40.0
	energizedChargeGain  = 25.0
	energizedChargeMax   = 100.0
)

func energizedReadyCond() *model.GenericFormulaExpr {
	threshold := energizedChargeMax
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + energizedChargeKey},
			{Op: "const", Value: &threshold},
		},
	}
}

func energizedHitListener() model.ListenerDefinition {
	zero := 0.0
	raw := energizedProcRaw
	gain := energizedChargeGain
	ready := energizedReadyCond()
	return model.ListenerDefinition{
		ListenerKey:  "listener_item_3094_energized",
		EventMatcher: model.TypeMatcher{All: []string{energizedHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           energizedDamageOpRef,
				CopyableOnHit: false,
				Condition:     ready,
				Amount:        &model.GenericFormulaExpr{Op: "const", Value: &raw},
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         energizedChargeKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   ready,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         energizedChargeKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &gain},
			},
		},
	}
}

func energizedStructuredUntimedCappedSchema() map[string]interface{} {
	return map[string]interface{}{
		energizedChargeKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(energizedChargeMax),
			"durationMs":   float64(0),
		},
	}
}

func ensureEnergizedTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		}
	}
}

func energizedAAOps() []model.OperationDefinition {
	aa := energizedAADamage
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        "op:aa",
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: energizedHitEvent,
			Ref:       energizedHitEvent,
		},
	}
}

func energizedAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := energizedAADamage
	one := 1.0
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        "op:aa",
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
			EventType: energizedHitEvent,
			Ref:       energizedHitEvent,
		},
	}
}

func mountEnergizedProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        energizedProviderRef,
		Kind:               "item",
		StableID:           "rapid_firecannon_energized",
		InitialStateSchema: energizedStructuredUntimedCappedSchema(),
		Listeners:          []model.ListenerDefinition{energizedHitListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: energizedProviderRef, DefinitionRef: energizedProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: energizedProviderRef, DefinitionRef: energizedProviderRef, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func configureEnergizedChampionAA(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: energizedHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: energizedAAOps(),
		},
	}
}

func energizedAARef() string {
	return "source.provider[" + energizedChampionRef + "].ability[" + energizedHitAbility + "]"
}

func loadEnergizedFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureEnergizedTypes(&compileReq)
	configureEnergizedChampionAA(&compileReq)
	mountEnergizedProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func setEnergizedDriverHits(runReq *model.RunRequest, hits int) {
	ref := energizedAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "energized_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
}

func runEnergized(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func energizedChargeValue(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, energizedProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("energized state bag missing: %+v", bag)
	}
	v, _ := state[energizedChargeKey].(float64)
	return v
}

func expectedMitigatedMagic(raw, mr float64) float64 {
	if mr >= 0 {
		return raw * 100 / (100 + mr)
	}
	return raw * (2 - 100/(100-mr))
}

func seedEnergizedCharge(runReq *model.RunRequest, charge float64) {
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[energizedProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{energizedChargeKey: charge},
		}
	}
}

func countPhantomDamageByOpRef(done model.DoneResult, opRef string) int {
	return countDamageByOpRef(done, opRef, true)
}

// TestEnergizedFourToFiveHitChargeCycle: hits 1-3 charge only; hit4 reaches 100 without proc;
// hit5 procs once for raw40 and ends at charge 25.
func TestEnergizedFourToFiveHitChargeCycle(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	setEnergizedDriverHits(&runReq, 5)
	done := runEnergized(t, compileReq, runReq)

	if countEmittedEvents(done, energizedHitEvent) != 5 {
		t.Fatalf("basic_attack_hit count=%d want 5", countEmittedEvents(done, energizedHitEvent))
	}
	if n := countDamageByOpRef(done, energizedDamageOpRef, false); n != 1 {
		t.Fatalf("energized proc count=%d want 1", n)
	}
	if got := sumDamageRawByOpRef(done, energizedDamageOpRef); math.Abs(got-energizedProcRaw) > 1e-6 {
		t.Fatalf("energized raw=%v want %v", got, energizedProcRaw)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-25) > 1e-6 {
		t.Fatalf("energized_charge after hit5=%v want 25", got)
	}
	// Non-ready hits do not proc; only hit5 procs once.
	wantDealt := energizedAADamage*5 + energizedProcRaw
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestEnergizedFourthHitReachesMaxWithoutProc: hit4 goes 75->100 with no Energized damage.
func TestEnergizedFourthHitReachesMaxWithoutProc(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	setEnergizedDriverHits(&runReq, 4)
	done := runEnergized(t, compileReq, runReq)
	if n := countDamageByOpRef(done, energizedDamageOpRef, false); n != 0 {
		t.Fatalf("energized proc on hit4=%d want 0", n)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-100) > 1e-6 {
		t.Fatalf("energized_charge after hit4=%v want 100", got)
	}
}

// TestEnergizedSecondCycleProcOnNinthHit: hit9 procs the second cycle; charge ends at 25.
func TestEnergizedSecondCycleProcOnNinthHit(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	setEnergizedDriverHits(&runReq, 9)
	done := runEnergized(t, compileReq, runReq)
	if n := countDamageByOpRef(done, energizedDamageOpRef, false); n != 2 {
		t.Fatalf("energized proc count=%d want 2 (hit5+hit9)", n)
	}
	if got := sumDamageRawByOpRef(done, energizedDamageOpRef); math.Abs(got-2*energizedProcRaw) > 1e-6 {
		t.Fatalf("energized raw sum=%v want %v", got, 2*energizedProcRaw)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-25) > 1e-6 {
		t.Fatalf("energized_charge after hit9=%v want 25", got)
	}
}

// TestEnergizedMagicResistExactSettlement: with non-zero MR, raw stays 40; final uses exact MR formula.
func TestEnergizedMagicResistExactSettlement(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	mr := 100.0
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: mr, Current: mr, Max: mr, Resolved: mr,
	})
	seedEnergizedCharge(&runReq, 100)
	setEnergizedDriverHits(&runReq, 1)
	done := runEnergized(t, compileReq, runReq)

	if got := sumDamageRawByOpRef(done, energizedDamageOpRef); math.Abs(got-energizedProcRaw) > 1e-6 {
		t.Fatalf("raw=%v want %v", got, energizedProcRaw)
	}
	wantMitigated := expectedMitigatedMagic(energizedProcRaw, mr)
	var gotMitigated float64
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != energizedDamageOpRef {
			continue
		}
		if phantom, _ := item.Data["phantom"].(bool); phantom {
			continue
		}
		gotMitigated += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	if math.Abs(gotMitigated-wantMitigated) > 1e-6 {
		t.Fatalf("mitigated=%v want %v (MR=%v)", gotMitigated, wantMitigated, mr)
	}
	wantDealt := energizedAADamage + wantMitigated // AA physical; MR does not affect physical (default armor 0)
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-25) > 1e-6 {
		t.Fatalf("charge after proc=%v want 25", got)
	}
}

// TestEnergizedDamageCopyableFalseAndNonReadyNoProc: copyable=false; non-ready second hit does not proc.
func TestEnergizedDamageCopyableFalseAndNonReadyNoProc(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	seedEnergizedCharge(&runReq, 100)
	setEnergizedDriverHits(&runReq, 2)
	done := runEnergized(t, compileReq, runReq)

	if n := countDamageByOpRef(done, energizedDamageOpRef, false); n != 1 {
		t.Fatalf("energized proc count=%d want 1 (only ready first hit)", n)
	}
	if n := countPhantomDamageByOpRef(done, energizedDamageOpRef); n != 0 {
		t.Fatalf("phantom energized count=%d want 0 (copyable=false)", n)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-50) > 1e-6 {
		// hit1: 100->proc->0->25; hit2: 25->50
		t.Fatalf("charge after two hits=%v want 50", got)
	}
}

// TestEnergizedGuinsooPhantomDoesNotTriggerConsumeOrCharge: phantom must not trigger/consume/charge;
// evidence must not carry energized operationRef.
func TestEnergizedGuinsooPhantomDoesNotTriggerConsumeOrCharge(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	// Champion owns AA + Guinsoo stack/repeat; Energized lives on a separate item provider.
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = energizedAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{energizedHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/magic",
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &copyableAmt},
					CopyableOnHit: true,
					Ref:           "op:guinsoo_copyable",
				},
			},
		},
		{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{energizedHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	// Pre-seed Guinsoo 3 stacks + Energized ready so this hit procs Energized and a phantom.
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			energizedChampionRef: map[string]interface{}{
				"state":    map[string]interface{}{guinsooStackKey: float64(3)},
				"expireAt": map[string]interface{}{guinsooStackKey: float64(10000)},
			},
			energizedProviderRef: map[string]interface{}{
				"state": map[string]interface{}{energizedChargeKey: float64(100)},
			},
		}
	}
	setEnergizedDriverHits(&runReq, 1)
	done := runEnergized(t, compileReq, runReq)

	if n := countDamageByOpRef(done, energizedDamageOpRef, false); n != 1 {
		t.Fatalf("original energized proc=%d want 1", n)
	}
	if n := countPhantomDamageByOpRef(done, energizedDamageOpRef); n != 0 {
		t.Fatalf("phantom energized damage=%d want 0", n)
	}
	for _, item := range damageEvidenceItems(done) {
		isPhantom, _ := item.Data["phantom"].(bool)
		if !isPhantom {
			continue
		}
		if evidenceDataString(item.Data, "operationRef") == energizedDamageOpRef {
			t.Fatalf("phantom evidence must not carry energized operationRef: %+v", item.Data)
		}
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1", n)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-25) > 1e-6 {
		t.Fatalf("charge=%v want 25 (phantom must not re-consume or re-charge)", got)
	}
}

// TestEnergizedChargeClampAtMax: misaligned charge clamps to 100 (max contract).
func TestEnergizedChargeClampAtMax(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	seedEnergizedCharge(&runReq, 90)
	setEnergizedDriverHits(&runReq, 1)
	done := runEnergized(t, compileReq, runReq)
	if n := countDamageByOpRef(done, energizedDamageOpRef, false); n != 0 {
		t.Fatalf("proc at charge90=%d want 0", n)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-100) > 1e-6 {
		t.Fatalf("charge after +25 from 90=%v want 100 (clamped)", got)
	}
}

// TestEnergizedMissingStateSchemaFailsClosed: missing/invalid structured schema fails compile (no silent success).
func TestEnergizedMissingStateSchemaFailsClosed(t *testing.T) {
	t.Run("invalid_structured_schema", func(t *testing.T) {
		compileReq, _ := loadEnergizedFixture(t)
		for i := range compileReq.SharedProviders {
			if compileReq.SharedProviders[i].ProviderKey != energizedProviderRef {
				continue
			}
			compileReq.SharedProviders[i].InitialStateSchema = map[string]interface{}{
				energizedChargeKey: map[string]interface{}{
					"defaultValue": float64(10),
					"maxValue":     float64(5), // max < default
					"durationMs":   float64(1000),
				},
			}
		}
		result := compile.CompileGeneric(compileReq)
		if result.OK {
			t.Fatal("expected compile failure for invalid state schema")
		}
	})
	t.Run("state_change_missing_scope", func(t *testing.T) {
		compileReq, _ := loadEnergizedFixture(t)
		for i := range compileReq.SharedProviders {
			if compileReq.SharedProviders[i].ProviderKey != energizedProviderRef {
				continue
			}
			one := 1.0
			compileReq.SharedProviders[i].Listeners = []model.ListenerDefinition{{
				ListenerKey:  "bad_scope",
				EventMatcher: model.TypeMatcher{All: []string{energizedHitEvent, "event/source_owner"}},
				Operations: []model.OperationDefinition{{
					Operation:   "state_change",
					Target:      "source",
					Ref:         energizedChargeKey,
					ValuePolicy: "add",
					Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
					// Types intentionally omit state_scope/*
				}},
			}}
		}
		result := compile.CompileGeneric(compileReq)
		if result.OK {
			t.Fatal("expected compile failure for state_change without state scope")
		}
	})
}

// TestEnergizedNoBasicAttackHitNoPanic: without basic_attack_hit emit, no proc and no panic.
func TestEnergizedNoBasicAttackHitNoPanic(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	aa := energizedAADamage
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        "op:aa",
		},
		// Intentionally omit emit of event/basic_attack_hit
	}
	seedEnergizedCharge(&runReq, 100)
	setEnergizedDriverHits(&runReq, 1)
	done := runEnergized(t, compileReq, runReq)
	if countEmittedEvents(done, energizedHitEvent) != 0 {
		t.Fatalf("hit events=%d want 0", countEmittedEvents(done, energizedHitEvent))
	}
	if n := countDamageByOpRef(done, energizedDamageOpRef, false); n != 0 {
		t.Fatalf("energized proc without hit event=%d want 0", n)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-100) > 1e-6 {
		t.Fatalf("charge=%v want 100 unchanged", got)
	}
}

// TestEnergizedUntimedCappedStructuredSchemaCompileSuccess: durationMs=0 capped schema compiles;
// runtime behavior proves max clamp.
func TestEnergizedUntimedCappedStructuredSchemaCompileSuccess(t *testing.T) {
	compileReq, runReq := loadEnergizedFixture(t)
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	var field compile.CompiledProviderStateField
	found := false
	for _, p := range result.Session.Providers {
		if p.ProviderKey != energizedProviderRef {
			continue
		}
		field, found = p.StateFields[energizedChargeKey]
		break
	}
	if !found {
		t.Fatal("missing energized_charge state field")
	}
	if field.DefaultValue != 0 || field.MaxValue != energizedChargeMax || !field.HasCap || field.DurationMs != 0 || field.RefreshPolicy != "" {
		t.Fatalf("field=%+v", field)
	}
	seedEnergizedCharge(&runReq, 90)
	setEnergizedDriverHits(&runReq, 1)
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if got := energizedChargeValue(t, done); math.Abs(got-energizedChargeMax) > 1e-6 {
		t.Fatalf("charge=%v want %v (schema max clamp)", got, energizedChargeMax)
	}
}
