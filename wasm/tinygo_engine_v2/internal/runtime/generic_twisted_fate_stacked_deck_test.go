package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_twistedfate E Stacked Deck / 卡牌骗术 (generic ABI, rank-5 only).
// Permanent attack_speed percent_add 0.50; every 4th source-owner basic_attack_hit
// deals magic raw = 165 + 0.20*(resolved AD - base AD) + 0.40*resolved AP;
// MR uses current pipeline; copyable_on_hit=false; hit counter is provider-scoped.
// Non-goals: building 50% DR, ranks 1-4, active Q/W/R.

const (
	tfStackedDeckProviderRef = "hero:twisted_fate_stacked_deck"
	tfStackedDeckDamageOpRef = "op:twisted_fate_stacked_deck_damage"
	tfStackedDeckListenerKey = "listener_hero_twistedfate_stacked_deck"
	tfStackedDeckHitsKey     = "stacked_deck_hits"
	tfStackedDeckASModKey    = "stacked_deck_attack_speed"
	tfStackedDeckChampionRef = spellbladeChampionRef
	tfStackedDeckHitAbility  = spellbladeHitAbilityKey
	tfStackedDeckHitEvent    = spellbladeHitEvent

	tfStackedDeckAADamage   = 10.0
	tfStackedDeckASBonus    = 0.50
	tfStackedDeckASBase     = 1.0
	tfStackedDeckFlat       = 165.0
	tfStackedDeckBonusADPct = 0.20
	tfStackedDeckAPPct      = 0.40
	tfStackedDeckADBase     = 52.0
	tfStackedDeckADResolved = 100.0
	tfStackedDeckAP         = 200.0
	tfStackedDeckMR         = 100.0
	tfStackedDeckEveryN     = 4.0
)

func tfStackedDeckExpectedRaw(resolvedAD, baseAD, resolvedAP float64) float64 {
	return tfStackedDeckFlat +
		tfStackedDeckBonusADPct*(resolvedAD-baseAD) +
		tfStackedDeckAPPct*resolvedAP
}

func tfStackedDeckExpectedMitigated(resolvedAD, baseAD, resolvedAP, mr float64) float64 {
	return expectedMitigatedMagic(tfStackedDeckExpectedRaw(resolvedAD, baseAD, resolvedAP), mr)
}

func tfStackedDeckHitCond() *model.GenericFormulaExpr {
	th := tfStackedDeckEveryN
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + tfStackedDeckHitsKey},
			{Op: "const", Value: &th},
		},
	}
}

func tfStackedDeckProcAmount() *model.GenericFormulaExpr {
	flat := tfStackedDeckFlat
	adRatio := tfStackedDeckBonusADPct
	apRatio := tfStackedDeckAPPct
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &flat},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &adRatio},
							{
								Op: "sub",
								Args: []model.GenericFormulaExpr{
									{Op: "read", Path: "event.entry_source.attr.ad.resolved"},
									{Op: "read", Path: "event.entry_source.attr.ad.base"},
								},
							},
						},
					},
				},
			},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &apRatio},
					{Op: "read", Path: "event.entry_source.attr.ap.resolved"},
				},
			},
		},
	}
}

func tfStackedDeckASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: tfStackedDeckASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value:       gfConst(tfStackedDeckASBonus),
	}
}

func tfStackedDeckHitsSchema() map[string]interface{} {
	return map[string]interface{}{
		tfStackedDeckHitsKey: float64(0),
	}
}

func tfStackedDeckHitListener() model.ListenerDefinition {
	one := 1.0
	zero := 0.0
	procCond := tfStackedDeckHitCond()
	return model.ListenerDefinition{
		ListenerKey:  tfStackedDeckListenerKey,
		EventMatcher: model.TypeMatcher{All: []string{tfStackedDeckHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         tfStackedDeckHitsKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           tfStackedDeckDamageOpRef,
				CopyableOnHit: false,
				Condition:     procCond,
				Amount:        tfStackedDeckProcAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         tfStackedDeckHitsKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   procCond,
			},
		},
	}
}

func tfStackedDeckAAOps() []model.OperationDefinition {
	aa := tfStackedDeckAADamage
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
			EventType: tfStackedDeckHitEvent,
			Ref:       tfStackedDeckHitEvent,
		},
	}
}

func ensureTFStackedDeckTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
}

func mountTFStackedDeckProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        tfStackedDeckProviderRef,
		Kind:               "passive",
		StableID:           "hero_twistedfate_e_stacked_deck",
		InitialStateSchema: tfStackedDeckHitsSchema(),
		Modifiers:          []model.ModifierDefinition{tfStackedDeckASModifier()},
		Listeners:          []model.ListenerDefinition{tfStackedDeckHitListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: tfStackedDeckProviderRef, DefinitionRef: tfStackedDeckProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: tfStackedDeckProviderRef, DefinitionRef: tfStackedDeckProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func configureTFStackedDeckChampionAA(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: tfStackedDeckHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: tfStackedDeckAAOps(),
		},
	}
	// Fixture-only flat AD so ad.base stays 52 while ad.resolved becomes 100
	// (attribute resolve overwrites a hand-set Resolved that differs from Base).
	bonusAD := tfStackedDeckADResolved - tfStackedDeckADBase
	compileReq.SharedProviders[0].Modifiers = append(compileReq.SharedProviders[0].Modifiers, model.ModifierDefinition{
		ModifierKey: "fixture_tf_bonus_ad",
		Kind:        "attribute",
		Target:      "ad",
		ValuePolicy: "add",
		Value:       gfConst(bonusAD),
	})
}

func tfStackedDeckAARef() string {
	return "source.provider[" + tfStackedDeckChampionRef + "].ability[" + tfStackedDeckHitAbility + "]"
}

func loadTFStackedDeckFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureTFStackedDeckTypes(&compileReq)
	configureTFStackedDeckChampionAA(&compileReq)
	mountTFStackedDeckProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: tfStackedDeckASBase, Current: tfStackedDeckASBase, Max: tfStackedDeckASBase, Resolved: tfStackedDeckASBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: tfStackedDeckADBase, Current: tfStackedDeckADBase, Max: tfStackedDeckADBase, Resolved: tfStackedDeckADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: tfStackedDeckAP, Current: tfStackedDeckAP, Max: tfStackedDeckAP, Resolved: tfStackedDeckAP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: tfStackedDeckMR, Current: tfStackedDeckMR, Max: tfStackedDeckMR, Resolved: tfStackedDeckMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func setTFStackedDeckDriverHits(runReq *model.RunRequest, hits int) {
	ref := tfStackedDeckAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "tf_stacked_deck_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
}

func runTFStackedDeck(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func tfStackedDeckDamageEvidence(done model.DoneResult) (count int, rawSum, mitigatedSum float64) {
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != tfStackedDeckDamageOpRef {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			continue
		}
		count++
		rawSum += evidenceDataFloat(item.Data, "rawAmount")
		mitigatedSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	return count, rawSum, mitigatedSum
}

func tfStackedDeckHitsState(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[tfStackedDeckProviderRef].(map[string]interface{})
		if !ok {
			t.Fatalf("providerState missing for %s: %+v", tfStackedDeckProviderRef, c.ProviderState)
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			t.Fatalf("provider state bag missing: %+v", bag)
		}
		hits, _ := state[tfStackedDeckHitsKey].(float64)
		return hits
	}
	t.Fatal("source combatant missing")
	return 0
}

// TestTwistedFateStackedDeckFormulaCrossCheck: independent raw/mitigated cross-check
// for AD100/base52/AP200 @ MR100 → raw 254.6 / mitigated 127.3.
func TestTwistedFateStackedDeckFormulaCrossCheck(t *testing.T) {
	raw := tfStackedDeckExpectedRaw(tfStackedDeckADResolved, tfStackedDeckADBase, tfStackedDeckAP)
	if math.Abs(raw-254.6) > 1e-9 {
		t.Fatalf("raw=%v want 254.6", raw)
	}
	mitigated := tfStackedDeckExpectedMitigated(tfStackedDeckADResolved, tfStackedDeckADBase, tfStackedDeckAP, tfStackedDeckMR)
	if math.Abs(mitigated-127.3) > 1e-9 {
		t.Fatalf("mitigated=%v want 127.3", mitigated)
	}
	// Zero bonus AD → flat + 40% AP only.
	rawNoBonus := tfStackedDeckExpectedRaw(tfStackedDeckADBase, tfStackedDeckADBase, tfStackedDeckAP)
	if math.Abs(rawNoBonus-(165+80)) > 1e-9 {
		t.Fatalf("rawNoBonusAD=%v want 245", rawNoBonus)
	}
}

// TestTwistedFateStackedDeckCompileRunRank5: +50% AS; hits 1-3 no proc; hit 4 raw/mitigated;
// after reset hit 8 procs again.
func TestTwistedFateStackedDeckCompileRunRank5(t *testing.T) {
	compileReq, runReq := loadTFStackedDeckFixture(t)
	setTFStackedDeckDriverHits(&runReq, 8)
	done := runTFStackedDeck(t, compileReq, runReq)

	wantAS := tfStackedDeckASBase * (1 + tfStackedDeckASBonus)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-wantAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v (+50%% percent_add)", got, wantAS)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-tfStackedDeckADResolved) > 1e-9 {
		t.Fatalf("ad.resolved=%v want %v (base %v + fixture bonus)", got, tfStackedDeckADResolved, tfStackedDeckADBase)
	}

	if countEmittedEvents(done, tfStackedDeckHitEvent) != 8 {
		t.Fatalf("basic_attack_hit emits=%d want 8", countEmittedEvents(done, tfStackedDeckHitEvent))
	}

	wantRaw := tfStackedDeckExpectedRaw(tfStackedDeckADResolved, tfStackedDeckADBase, tfStackedDeckAP)
	wantMitigated := tfStackedDeckExpectedMitigated(tfStackedDeckADResolved, tfStackedDeckADBase, tfStackedDeckAP, tfStackedDeckMR)
	if math.Abs(wantRaw-254.6) > 1e-9 || math.Abs(wantMitigated-127.3) > 1e-9 {
		t.Fatalf("fixture expectations drifted: raw=%v mitigated=%v", wantRaw, wantMitigated)
	}

	procCount, procRaw, procMitigated := tfStackedDeckDamageEvidence(done)
	if procCount != 2 {
		t.Fatalf("Stacked Deck proc count=%d want 2 (hit4 + hit8)", procCount)
	}
	if math.Abs(procRaw-2*wantRaw) > 1e-6 {
		t.Fatalf("proc raw sum=%v want %v", procRaw, 2*wantRaw)
	}
	if math.Abs(procMitigated-2*wantMitigated) > 1e-6 {
		t.Fatalf("proc mitigated sum=%v want %v", procMitigated, 2*wantMitigated)
	}

	if hits := tfStackedDeckHitsState(t, done); hits != 0 {
		t.Fatalf("after hit8 stacked_deck_hits=%v want 0 (reset on proc)", hits)
	}

	wantDealt := 8*tfStackedDeckAADamage + 2*wantMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestTwistedFateStackedDeckFirstThreeHitsNoProc: isolate pre-threshold path.
func TestTwistedFateStackedDeckFirstThreeHitsNoProc(t *testing.T) {
	compileReq, runReq := loadTFStackedDeckFixture(t)
	setTFStackedDeckDriverHits(&runReq, 3)
	done := runTFStackedDeck(t, compileReq, runReq)

	if procCount, _, _ := tfStackedDeckDamageEvidence(done); procCount != 0 {
		t.Fatalf("proc count=%d want 0 on first 3 hits", procCount)
	}
	if hits := tfStackedDeckHitsState(t, done); hits != 3 {
		t.Fatalf("stacked_deck_hits=%v want 3", hits)
	}
	if math.Abs(done.Summary.SourceDamageDealt-3*tfStackedDeckAADamage) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v (AA only)", done.Summary.SourceDamageDealt, 3*tfStackedDeckAADamage)
	}
}
