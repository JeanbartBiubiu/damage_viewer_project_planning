package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// item_3087 Statikk Shiv — primary-target Energized contract (generic ABI).
// Each basic attack gains total +15 Energize (9 bonus included), capped at 100.
// When fully energized, the next basic attack deals exactly 60 bonus magic damage
// to the primary target. Ready-hit ordering: damage -> consume(0) -> +15 (ends at 15).
// Non-goals: movement charge, non-champion 90, bounce/secondary, slow, shared pool.

const (
	statikkChargeKey   = "energized_charge"
	statikkProviderRef = "item:statikk_shiv_energized"
	statikkDamageOpRef = "op:statikk_shiv_energized_damage"
	statikkChampionRef = spellbladeChampionRef
	statikkHitAbility  = spellbladeHitAbilityKey
	statikkHitEvent    = spellbladeHitEvent
	statikkAADamage    = 10.0
	statikkProcRaw     = 60.0
	statikkChargeGain  = 15.0
	statikkChargeMax   = 100.0
)

func statikkReadyCond() *model.GenericFormulaExpr {
	threshold := statikkChargeMax
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + statikkChargeKey},
			{Op: "const", Value: &threshold},
		},
	}
}

func statikkHitListener() model.ListenerDefinition {
	zero := 0.0
	raw := statikkProcRaw
	gain := statikkChargeGain
	ready := statikkReadyCond()
	return model.ListenerDefinition{
		ListenerKey:  "listener_item_3087_energized",
		EventMatcher: model.TypeMatcher{All: []string{statikkHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           statikkDamageOpRef,
				CopyableOnHit: false,
				Condition:     ready,
				Amount:        &model.GenericFormulaExpr{Op: "const", Value: &raw},
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         statikkChargeKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   ready,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         statikkChargeKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &gain},
			},
		},
	}
}

func statikkStructuredUntimedCappedSchema() map[string]interface{} {
	return map[string]interface{}{
		statikkChargeKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(statikkChargeMax),
			"durationMs":   float64(0),
		},
	}
}

func ensureStatikkTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
}

func statikkAAOps() []model.OperationDefinition {
	aa := statikkAADamage
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
			EventType: statikkHitEvent,
			Ref:       statikkHitEvent,
		},
	}
}

func statikkAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := statikkAADamage
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
			EventType: statikkHitEvent,
			Ref:       statikkHitEvent,
		},
	}
}

func mountStatikkProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        statikkProviderRef,
		Kind:               "item",
		StableID:           "item_3087",
		InitialStateSchema: statikkStructuredUntimedCappedSchema(),
		Listeners:          []model.ListenerDefinition{statikkHitListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: statikkProviderRef, DefinitionRef: statikkProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: statikkProviderRef, DefinitionRef: statikkProviderRef, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func configureStatikkChampionAA(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: statikkHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: statikkAAOps(),
		},
	}
}

func statikkAARef() string {
	return "source.provider[" + statikkChampionRef + "].ability[" + statikkHitAbility + "]"
}

func loadStatikkFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureStatikkTypes(&compileReq)
	configureStatikkChampionAA(&compileReq)
	mountStatikkProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func setStatikkDriverHits(runReq *model.RunRequest, hits int) {
	ref := statikkAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "statikk_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
}

func runStatikkShiv(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func statikkChargeValue(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, statikkProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("statikk state bag missing: %+v", bag)
	}
	v, _ := state[statikkChargeKey].(float64)
	return v
}

func seedStatikkCharge(runReq *model.RunRequest, charge float64) {
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[statikkProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{statikkChargeKey: charge},
		}
	}
}

// TestStatikkShivSevenHitsReachMaxWithoutProc: hits 1-7 from zero reach charge 100 (clamp) with no Statikk damage.
func TestStatikkShivSevenHitsReachMaxWithoutProc(t *testing.T) {
	compileReq, runReq := loadStatikkFixture(t)
	setStatikkDriverHits(&runReq, 7)
	done := runStatikkShiv(t, compileReq, runReq)

	if countEmittedEvents(done, statikkHitEvent) != 7 {
		t.Fatalf("basic_attack_hit count=%d want 7", countEmittedEvents(done, statikkHitEvent))
	}
	if n := countDamageByOpRef(done, statikkDamageOpRef, false); n != 0 {
		t.Fatalf("statikk proc on hits1-7=%d want 0", n)
	}
	if got := statikkChargeValue(t, done); math.Abs(got-statikkChargeMax) > 1e-6 {
		t.Fatalf("energized_charge after hit7=%v want 100", got)
	}
	wantDealt := statikkAADamage * 7
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v (AA only)", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestStatikkShivSevenToEightHitChargeCycle: hits 1-7 charge to 100 without proc;
// hit8 procs once for raw60 and ends at charge 15.
func TestStatikkShivSevenToEightHitChargeCycle(t *testing.T) {
	compileReq, runReq := loadStatikkFixture(t)
	setStatikkDriverHits(&runReq, 8)
	done := runStatikkShiv(t, compileReq, runReq)

	if countEmittedEvents(done, statikkHitEvent) != 8 {
		t.Fatalf("basic_attack_hit count=%d want 8", countEmittedEvents(done, statikkHitEvent))
	}
	if n := countDamageByOpRef(done, statikkDamageOpRef, false); n != 1 {
		t.Fatalf("statikk proc count=%d want 1", n)
	}
	if got := sumDamageRawByOpRef(done, statikkDamageOpRef); math.Abs(got-statikkProcRaw) > 1e-6 {
		t.Fatalf("statikk raw=%v want %v", got, statikkProcRaw)
	}
	if got := statikkChargeValue(t, done); math.Abs(got-statikkChargeGain) > 1e-6 {
		t.Fatalf("energized_charge after hit8=%v want 15", got)
	}
	wantDealt := statikkAADamage*8 + statikkProcRaw
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestStatikkShivMagicResistExactSettlement: raw stays 60; MR=100 mitigates to exactly 30.
func TestStatikkShivMagicResistExactSettlement(t *testing.T) {
	compileReq, runReq := loadStatikkFixture(t)
	mr := 100.0
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: mr, Current: mr, Max: mr, Resolved: mr,
	})
	seedStatikkCharge(&runReq, 100)
	setStatikkDriverHits(&runReq, 1)
	done := runStatikkShiv(t, compileReq, runReq)

	if got := sumDamageRawByOpRef(done, statikkDamageOpRef); math.Abs(got-statikkProcRaw) > 1e-6 {
		t.Fatalf("raw=%v want %v", got, statikkProcRaw)
	}
	wantMitigated := expectedMitigatedMagic(statikkProcRaw, mr) // 60 * 100/(100+100) = 30
	if math.Abs(wantMitigated-30) > 1e-9 {
		t.Fatalf("helper mitigated=%v want 30", wantMitigated)
	}
	var gotMitigated float64
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != statikkDamageOpRef {
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
	wantDealt := statikkAADamage + wantMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if got := statikkChargeValue(t, done); math.Abs(got-statikkChargeGain) > 1e-6 {
		t.Fatalf("charge after proc=%v want 15", got)
	}
}

// TestStatikkShivDamageCopyableFalseAndNonReadyNoProc: copyable=false; non-ready second hit does not damage.
func TestStatikkShivDamageCopyableFalseAndNonReadyNoProc(t *testing.T) {
	compileReq, runReq := loadStatikkFixture(t)
	seedStatikkCharge(&runReq, 100)
	setStatikkDriverHits(&runReq, 2)
	done := runStatikkShiv(t, compileReq, runReq)

	if n := countDamageByOpRef(done, statikkDamageOpRef, false); n != 1 {
		t.Fatalf("statikk proc count=%d want 1 (only ready first hit)", n)
	}
	if n := countPhantomDamageByOpRef(done, statikkDamageOpRef); n != 0 {
		t.Fatalf("phantom statikk count=%d want 0 (copyable=false)", n)
	}
	if got := statikkChargeValue(t, done); math.Abs(got-30) > 1e-6 {
		// hit1: 100->proc->0->15; hit2: 15->30 (non-ready, no damage)
		t.Fatalf("charge after two hits=%v want 30", got)
	}
}

// TestStatikkShivGuinsooPhantomDoesNotTriggerConsumeOrCharge: phantom must not proc/consume/charge Statikk.
func TestStatikkShivGuinsooPhantomDoesNotTriggerConsumeOrCharge(t *testing.T) {
	compileReq, runReq := loadStatikkFixture(t)
	// Champion owns AA + Guinsoo stack/repeat; Statikk lives on a separate item provider (source only).
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = statikkAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{statikkHitEvent, "event/source_owner"}},
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
			EventMatcher: model.TypeMatcher{All: []string{statikkHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			statikkChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
			statikkProviderRef: map[string]interface{}{
				"state": map[string]interface{}{statikkChargeKey: float64(100)},
			},
		}
	}
	setStatikkDriverHits(&runReq, 1)
	done := runStatikkShiv(t, compileReq, runReq)

	if n := countDamageByOpRef(done, statikkDamageOpRef, false); n != 1 {
		t.Fatalf("original statikk proc=%d want 1", n)
	}
	if n := countPhantomDamageByOpRef(done, statikkDamageOpRef); n != 0 {
		t.Fatalf("phantom statikk damage=%d want 0", n)
	}
	for _, item := range damageEvidenceItems(done) {
		isPhantom, _ := item.Data["phantom"].(bool)
		if !isPhantom {
			continue
		}
		if evidenceDataString(item.Data, "operationRef") == statikkDamageOpRef {
			t.Fatalf("phantom evidence must not carry statikk operationRef: %+v", item.Data)
		}
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1", n)
	}
	if got := statikkChargeValue(t, done); math.Abs(got-statikkChargeGain) > 1e-6 {
		t.Fatalf("charge=%v want 15 (phantom must not re-consume or re-charge)", got)
	}
}
