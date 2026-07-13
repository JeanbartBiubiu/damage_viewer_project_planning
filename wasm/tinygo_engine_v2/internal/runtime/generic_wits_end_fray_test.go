package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// item_3091 Wit's End — Fray / 喧争 (generic ABI).
// Source-owned on-hit: basic_attack_hit + source_owner deals constant magic 45
// (ValuePolicy add, CopyableOnHit true). Target must not mount Fray.
// Non-goals: MS buff, item stats, random crit, extra game effects beyond Fray.

const (
	witsEndProviderRef = "item:wits_end_fray"
	witsEndDamageOpRef = "op:wits_end_fray_damage"
	witsEndListenerKey = "listener_item_3091_fray"
	witsEndChampionRef = spellbladeChampionRef
	witsEndHitAbility  = spellbladeHitAbilityKey
	witsEndHitEvent    = spellbladeHitEvent
	witsEndAADamage    = 10.0
	witsEndFrayRaw     = 45.0
)

func witsEndFrayListener() model.ListenerDefinition {
	raw := witsEndFrayRaw
	return model.ListenerDefinition{
		ListenerKey:  witsEndListenerKey,
		EventMatcher: model.TypeMatcher{All: []string{witsEndHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           witsEndDamageOpRef,
				ValuePolicy:   "add",
				CopyableOnHit: true,
				Amount:        &model.GenericFormulaExpr{Op: "const", Value: &raw},
			},
		},
	}
}

func ensureWitsEndTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
}

func witsEndAAOps() []model.OperationDefinition {
	aa := witsEndAADamage
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
			EventType: witsEndHitEvent,
			Ref:       witsEndHitEvent,
		},
	}
}

func witsEndAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := witsEndAADamage
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
			EventType: witsEndHitEvent,
			Ref:       witsEndHitEvent,
		},
	}
}

func mountWitsEndFrayProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: witsEndProviderRef,
		Kind:        "item",
		StableID:    "item_3091",
		Listeners:   []model.ListenerDefinition{witsEndFrayListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: witsEndProviderRef, DefinitionRef: witsEndProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: witsEndProviderRef, DefinitionRef: witsEndProviderRef, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func configureWitsEndChampionAA(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: witsEndHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: witsEndAAOps(),
		},
	}
}

func witsEndAARef() string {
	return "source.provider[" + witsEndChampionRef + "].ability[" + witsEndHitAbility + "]"
}

func loadWitsEndFrayFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureWitsEndTypes(&compileReq)
	configureWitsEndChampionAA(&compileReq)
	mountWitsEndFrayProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func setWitsEndDriverHits(runReq *model.RunRequest, hits int) {
	ref := witsEndAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "wits_end_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
}

func runWitsEndFray(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func assertTargetLacksWitsEnd(t *testing.T, done model.DoneResult) {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		for _, p := range c.Providers {
			if p.ProviderRef == witsEndProviderRef || p.DefinitionRef == witsEndProviderRef {
				t.Fatalf("target must not mount Wit's End Fray provider: %+v", c.Providers)
			}
		}
		if raw, ok := c.ProviderState[witsEndProviderRef]; ok {
			t.Fatalf("target must not own Wit's End Fray providerState: %+v", raw)
		}
		return
	}
	t.Fatal("target combatant missing")
}

func frayDamageEvidence(done model.DoneResult, phantomOnly bool) (count int, rawSum, mitigatedSum float64) {
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != witsEndDamageOpRef {
			continue
		}
		isPhantom, _ := item.Data["phantom"].(bool)
		if phantomOnly && !isPhantom {
			continue
		}
		if !phantomOnly && isPhantom {
			continue
		}
		count++
		rawSum += evidenceDataFloat(item.Data, "rawAmount")
		mitigatedSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	return count, rawSum, mitigatedSum
}

// TestWitsEndFrayMagicResistExactSettlement: original Fray raw 45; MR=100 mitigates to 22.5.
func TestWitsEndFrayMagicResistExactSettlement(t *testing.T) {
	compileReq, runReq := loadWitsEndFrayFixture(t)
	mr := 100.0
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: mr, Current: mr, Max: mr, Resolved: mr,
	})
	setWitsEndDriverHits(&runReq, 1)
	done := runWitsEndFray(t, compileReq, runReq)

	if countEmittedEvents(done, witsEndHitEvent) != 1 {
		t.Fatalf("basic_attack_hit count=%d want 1", countEmittedEvents(done, witsEndHitEvent))
	}
	origCount, origRaw, origMitigated := frayDamageEvidence(done, false)
	if origCount != 1 {
		t.Fatalf("original Fray damage count=%d want 1", origCount)
	}
	if math.Abs(origRaw-witsEndFrayRaw) > 1e-6 {
		t.Fatalf("original Fray raw=%v want %v", origRaw, witsEndFrayRaw)
	}
	wantMitigated := expectedMitigatedMagic(witsEndFrayRaw, mr) // 45 * 100/(100+100) = 22.5
	if math.Abs(origMitigated-wantMitigated) > 1e-6 {
		t.Fatalf("original Fray mitigated=%v want %v (MR=%v)", origMitigated, wantMitigated, mr)
	}
	if phantomCount, _, _ := frayDamageEvidence(done, true); phantomCount != 0 {
		t.Fatalf("phantom Fray count=%d want 0 (no Guinsoo)", phantomCount)
	}
	wantDealt := witsEndAADamage + wantMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	assertTargetLacksWitsEnd(t, done)
}

// TestWitsEndFrayGuinsooPhantomCopiesOnce: Guinsoo phantom copies Fray exactly once;
// preserves raw/mitigated; no recursion or extra listener/event effects.
func TestWitsEndFrayGuinsooPhantomCopiesOnce(t *testing.T) {
	compileReq, runReq := loadWitsEndFrayFixture(t)
	mr := 100.0
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: mr, Current: mr, Max: mr, Resolved: mr,
	})

	// Champion owns AA + Guinsoo stack/repeat; Fray lives on a separate item provider (source only).
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = witsEndAAOpsWithGuinsooStack()
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{witsEndHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			witsEndChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
		}
	}
	setWitsEndDriverHits(&runReq, 1)
	done := runWitsEndFray(t, compileReq, runReq)

	if countEmittedEvents(done, witsEndHitEvent) != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1 (phantom must not re-emit / recurse)", countEmittedEvents(done, witsEndHitEvent))
	}

	wantMitigated := expectedMitigatedMagic(witsEndFrayRaw, mr) // 22.5
	origCount, origRaw, origMitigated := frayDamageEvidence(done, false)
	if origCount != 1 {
		t.Fatalf("original Fray damage count=%d want 1", origCount)
	}
	if math.Abs(origRaw-witsEndFrayRaw) > 1e-6 {
		t.Fatalf("original Fray raw=%v want %v", origRaw, witsEndFrayRaw)
	}
	if math.Abs(origMitigated-wantMitigated) > 1e-6 {
		t.Fatalf("original Fray mitigated=%v want %v", origMitigated, wantMitigated)
	}

	phantomCount, phantomRaw, phantomMitigated := frayDamageEvidence(done, true)
	if phantomCount != 1 {
		t.Fatalf("phantom Fray damage count=%d want 1 (copy exactly once)", phantomCount)
	}
	if math.Abs(phantomRaw-witsEndFrayRaw) > 1e-6 {
		t.Fatalf("phantom Fray raw=%v want %v", phantomRaw, witsEndFrayRaw)
	}
	if math.Abs(phantomMitigated-wantMitigated) > 1e-6 {
		t.Fatalf("phantom Fray mitigated=%v want %v", phantomMitigated, wantMitigated)
	}

	// AA physical once + Fray original + Fray phantom; no extra listener damage.
	wantDealt := witsEndAADamage + wantMitigated + wantMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	assertTargetLacksWitsEnd(t, done)
}
