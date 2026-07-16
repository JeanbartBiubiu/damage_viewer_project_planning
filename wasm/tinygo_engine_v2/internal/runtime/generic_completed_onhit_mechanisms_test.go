package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// generic_completed_onhit_mechanisms_test.go
//
// Real CompileGeneric + RunGeneric proofs for nine unified-inventory
// "completed" on-hit candidates that previously lacked mechanism-level Wasm
// evidence (not single_attacker_dps; not formula-only unit checks), plus the
// shared primary-target on-hit boundary that backs two item_3748 Cleave
// partial components.
//
// Candidate keys → Backend source:
//  1. hero_skill|hero_kogmaw|W|生化弹幕
//     → db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql
//  2. hero_skill|hero_teemo|E|毒性射击
//     → db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql
//  3. item_passive|3115|item_passive|艾卡西亚之咬
//     → db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql
//  4. item_passive|3181|item_passive|船长
//     → db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql
//     (seed display: 破舰者远程近似；only remote approx 0.84/0.035口径)
//  5. item_passive|3302|item_passive|晦影
//     → db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql
//     (seed display: 界弓 flat 30 magic；no light/dark/penetration)
//  6. item_passive|3124|item_passive|怨怒
//     → db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql
//     + copyable_on_hit=true via lol_guinsoo_hk_seed.sql
//  7. item_passive|3153|item_passive|雾之锋
//     → db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql
//     + copyable_on_hit=true via lol_guinsoo_hk_seed.sql
//     (seed口径: 6% entry current HP only；no melee/ranged split / non-hero cap)
//  8. item_passive|6672|item_passive|放倒它
//     → db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql
//     (copyable_on_hit defaults false; not opened by guinsoo_hk)
//  9. hero_skill|hero_vayne|W|圣银弩箭
//     → db/game_manage/seeds/lol_vayne_silver_bolts_seed.sql
//     (max(6% target maxHP, 50) true；no non-hero cap in seed;
//      Backend $opponent.attr.hp.max projects to target.attr.hp.max;
//      multi-opponent provider_target clear-on-switch cannot be exercised in the
//      two-combatant compile fixture — see HitSequenceResetAndIsolation note)
// 10. item_passive|3748|item_passive|顺劈|…|71fa0f0c
// 11. item_passive|3748|item_passive|顺劈|…|020f8b5a
//     → db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql
//     (two Cleave source-fragment partials; only the shared 远程主目标 on-hit
//      boundary is proven here: physical = source.hp.max * 0.005;
//      no cone/cleave/active; copyable_on_hit defaults false)

const (
	gcohChampionRef = spellbladeChampionRef
	gcohHitAbility  = spellbladeHitAbilityKey
	gcohHitEvent    = spellbladeHitEvent
	gcohAADamage    = 10.0
)

func gcohConst(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func gcohEnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	ensureDamageTrueType(req)
}

func gcohAAOps() []model.OperationDefinition {
	aa := gcohAADamage
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
			EventType: gcohHitEvent,
			Ref:       gcohHitEvent,
		},
	}
}

func gcohAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := gcohAADamage
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
			EventType: gcohHitEvent,
			Ref:       gcohHitEvent,
		},
	}
}

func gcohConfigureChampionAA(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: gcohHitAbility,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: gcohAAOps(),
		},
	}
}

func gcohAARef() string {
	return "source.provider[" + gcohChampionRef + "].ability[" + gcohHitAbility + "]"
}

func gcohSetDriverHits(runReq *model.RunRequest, hits int, prefix string) {
	ref := gcohAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   prefix + "_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
}

func gcohRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func gcohMountPassive(
	compileReq *model.CompileRequest,
	runReq *model.RunRequest,
	providerRef, stableID string,
	schema map[string]interface{},
	listeners []model.ListenerDefinition,
) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        providerRef,
		Kind:               "passive",
		StableID:           stableID,
		InitialStateSchema: schema,
		Listeners:          listeners,
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: providerRef, DefinitionRef: providerRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: providerRef, DefinitionRef: providerRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func gcohBaseFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	gcohEnsureTypes(&compileReq)
	gcohConfigureChampionAA(&compileReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func gcohDamageEvidence(done model.DoneResult, opRef string, phantomOnly bool) (count int, rawSum, mitigatedSum float64) {
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != opRef {
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

func gcohTargetStateHits(t *testing.T, done model.DoneResult, providerRef, stateKey string) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, providerRef)
	ts, ok := bag["targetState"].(map[string]interface{})
	if !ok {
		return 0
	}
	values, ok := ts["values"].(map[string]interface{})
	if !ok {
		return 0
	}
	v, _ := values[stateKey].(float64)
	return v
}

func gcohAttachGuinsooPhantomAt3(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = gcohAAOpsWithGuinsooStack()
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "gcoh_guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{gcohHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			gcohChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
		}
	}
}

func gcohSimpleOnHitListener(listenerKey, opRef, damageType string, copyable bool, amount *model.GenericFormulaExpr) model.ListenerDefinition {
	return model.ListenerDefinition{
		ListenerKey:  listenerKey,
		EventMatcher: model.TypeMatcher{All: []string{gcohHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    damageType,
				Ref:           opRef,
				ValuePolicy:   "add",
				CopyableOnHit: copyable,
				Amount:        amount,
			},
		},
	}
}

func gcohEveryNListener(
	listenerKey, hitsKey, damageOpRef, damageType string,
	everyN float64,
	copyable bool,
	amount *model.GenericFormulaExpr,
) model.ListenerDefinition {
	one := 1.0
	zero := 0.0
	cond := &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.target_state." + hitsKey},
			{Op: "const", Value: &everyN},
		},
	}
	return model.ListenerDefinition{
		ListenerKey:  listenerKey,
		EventMatcher: model.TypeMatcher{All: []string{gcohHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         hitsKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    damageType,
				Ref:           damageOpRef,
				ValuePolicy:   "add",
				CopyableOnHit: copyable,
				Condition:     cond,
				Amount:        amount,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         hitsKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   cond,
			},
		},
	}
}

// ---------------------------------------------------------------------------
// 1. Kog'Maw W — magic = event.entry_target.attr.hp.max * 0.06
// ---------------------------------------------------------------------------

const (
	gcohKogProviderRef = "hero:kogmaw_bio_arcane_barrage"
	gcohKogOpRef       = "op:kogmaw_bio_arcane_barrage"
	gcohKogRatio       = 0.06
)

func gcohKogAmount() *model.GenericFormulaExpr {
	ratio := gcohKogRatio
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "event.entry_target.attr.hp.max"},
			{Op: "const", Value: &ratio},
		},
	}
}

func TestGenericCompletedOnHitMechanismsKogMawWTwoMaxHPScenarios(t *testing.T) {
	type scenario struct {
		name      string
		maxHP, mr float64
		wantRaw   float64
	}
	cases := []scenario{
		{name: "maxHP1000_MR100", maxHP: 1000, mr: 100, wantRaw: 60},
		{name: "maxHP2500_MR50", maxHP: 2500, mr: 50, wantRaw: 150},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohKogProviderRef, "provider_hero_kogmaw_bio_arcane_barrage", nil,
				[]model.ListenerDefinition{gcohSimpleOnHitListener(
					"listener_hero_kogmaw_bio_arcane_barrage", gcohKogOpRef, "damage/magic", false, gcohKogAmount(),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
				Base: tc.maxHP, Current: tc.maxHP, Max: tc.maxHP, Resolved: tc.maxHP,
			})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
				Base: tc.mr, Current: tc.mr, Max: tc.mr, Resolved: tc.mr,
			})
			gcohSetDriverHits(&runReq, 1, "kog_w")
			done := gcohRun(t, compileReq, runReq)

			if countEmittedEvents(done, gcohHitEvent) != 1 {
				t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, gcohHitEvent))
			}
			n, raw, mit := gcohDamageEvidence(done, gcohKogOpRef, false)
			if n != 1 {
				t.Fatalf("kog on-hit count=%d want 1", n)
			}
			if math.Abs(raw-tc.wantRaw) > 1e-6 {
				t.Fatalf("kog raw=%v want %v", raw, tc.wantRaw)
			}
			wantMit := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("kog mitigated=%v want %v (MR=%v)", mit, wantMit, tc.mr)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 2. Teemo E — magic const 65 (impact only; no DoT/AP)
// ---------------------------------------------------------------------------

const (
	gcohTeemoProviderRef = "hero:teemo_toxic_shot"
	gcohTeemoOpRef       = "op:teemo_toxic_shot"
	gcohTeemoRaw         = 65.0
)

func TestGenericCompletedOnHitMechanismsTeemoETwoMRScenarios(t *testing.T) {
	cases := []struct {
		name string
		mr   float64
	}{
		{name: "MR100", mr: 100},
		{name: "MR0", mr: 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohTeemoProviderRef, "provider_hero_teemo_toxic_shot", nil,
				[]model.ListenerDefinition{gcohSimpleOnHitListener(
					"listener_hero_teemo_toxic_shot", gcohTeemoOpRef, "damage/magic", false, gcohConst(gcohTeemoRaw),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
				Base: tc.mr, Current: tc.mr, Max: tc.mr, Resolved: tc.mr,
			})
			gcohSetDriverHits(&runReq, 1, "teemo_e")
			done := gcohRun(t, compileReq, runReq)

			n, raw, mit := gcohDamageEvidence(done, gcohTeemoOpRef, false)
			if n != 1 || math.Abs(raw-gcohTeemoRaw) > 1e-6 {
				t.Fatalf("teemo count=%d raw=%v want 1 / %v", n, raw, gcohTeemoRaw)
			}
			wantMit := expectedMitigatedMagic(gcohTeemoRaw, tc.mr)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("teemo mitigated=%v want %v", mit, wantMit)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 3. item 3115 Nashor's — magic = 15 + 0.15 * ap.resolved
// ---------------------------------------------------------------------------

const (
	gcohNashProviderRef = "item:3115_nashors"
	gcohNashOpRef       = "op:nashors_on_hit"
	gcohNashFlat        = 15.0
	gcohNashAPRatio     = 0.15
)

func gcohNashAmount() *model.GenericFormulaExpr {
	flat := gcohNashFlat
	ratio := gcohNashAPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &flat},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "event.entry_source.attr.ap.resolved"},
					{Op: "const", Value: &ratio},
				},
			},
		},
	}
}

func TestGenericCompletedOnHitMechanismsNashorsTwoAPScenarios(t *testing.T) {
	cases := []struct {
		name    string
		ap, mr  float64
		wantRaw float64
	}{
		{name: "AP100_MR100", ap: 100, mr: 100, wantRaw: 30},
		{name: "AP200_MR50", ap: 200, mr: 50, wantRaw: 45},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohNashProviderRef, "provider_item_3115_nashors", nil,
				[]model.ListenerDefinition{gcohSimpleOnHitListener(
					"listener_item_3115_nashors", gcohNashOpRef, "damage/magic", true, gcohNashAmount(),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
				Base: tc.ap, Current: tc.ap, Max: tc.ap, Resolved: tc.ap,
			})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
				Base: tc.mr, Current: tc.mr, Max: tc.mr, Resolved: tc.mr,
			})
			gcohSetDriverHits(&runReq, 1, "nashors")
			done := gcohRun(t, compileReq, runReq)

			n, raw, mit := gcohDamageEvidence(done, gcohNashOpRef, false)
			if n != 1 || math.Abs(raw-tc.wantRaw) > 1e-6 {
				t.Fatalf("nashors count=%d raw=%v want 1 / %v", n, raw, tc.wantRaw)
			}
			wantMit := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("nashors mitigated=%v want %v", mit, wantMit)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 4. item 3181 Hullbreaker / 船长 — every 5th; remote approx physical
//    damage = ad.base*0.84 + source.hp.max*0.035
// ---------------------------------------------------------------------------

const (
	gcohHullProviderRef = "item:3181_hullbreaker"
	gcohHullOpRef       = "op:hullbreaker_proc"
	gcohHullHitsKey     = "hullbreaker_hits"
	gcohHullADRatio     = 0.84
	gcohHullHPRatio     = 0.035
)

func gcohHullAmount() *model.GenericFormulaExpr {
	adR := gcohHullADRatio
	hpR := gcohHullHPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "event.entry_source.attr.ad.base"},
					{Op: "const", Value: &adR},
				},
			},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "event.entry_source.attr.hp.max"},
					{Op: "const", Value: &hpR},
				},
			},
		},
	}
}

func TestGenericCompletedOnHitMechanismsHullbreakerEveryFifthTwoStatScenarios(t *testing.T) {
	// Seed口径: 远程近似 only（0.84/0.035）；不宣称 melee / DataDragon 精确值。
	cases := []struct {
		name          string
		adBase, srcHP float64
		armor         float64
		wantRaw       float64
	}{
		{name: "AD100_HP1000_armor100", adBase: 100, srcHP: 1000, armor: 100, wantRaw: 119},
		{name: "AD80_HP2000_armor50", adBase: 80, srcHP: 2000, armor: 50, wantRaw: 137.2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohHullProviderRef, "provider_item_3181_hullbreaker",
				map[string]interface{}{gcohHullHitsKey: float64(0)},
				[]model.ListenerDefinition{gcohEveryNListener(
					"listener_item_3181_hullbreaker", gcohHullHitsKey, gcohHullOpRef,
					"damage/physical", 5, false, gcohHullAmount(),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
				Base: tc.adBase, Current: tc.adBase, Max: tc.adBase, Resolved: tc.adBase,
			})
			setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
				Base: tc.srcHP, Current: tc.srcHP, Max: tc.srcHP, Resolved: tc.srcHP,
			})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
				Base: tc.armor, Current: tc.armor, Max: tc.armor, Resolved: tc.armor,
			})
			gcohSetDriverHits(&runReq, 5, "hull")
			done := gcohRun(t, compileReq, runReq)

			if countEmittedEvents(done, gcohHitEvent) != 5 {
				t.Fatalf("hits=%d want 5", countEmittedEvents(done, gcohHitEvent))
			}
			n, raw, mit := gcohDamageEvidence(done, gcohHullOpRef, false)
			if n != 1 {
				t.Fatalf("hull proc count=%d want 1 (every 5th)", n)
			}
			if math.Abs(raw-tc.wantRaw) > 1e-6 {
				t.Fatalf("hull raw=%v want %v", raw, tc.wantRaw)
			}
			wantMit := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("hull mitigated=%v want %v", mit, wantMit)
			}
			if hits := gcohTargetStateHits(t, done, gcohHullProviderRef, gcohHullHitsKey); hits != 0 {
				t.Fatalf("hullbreaker_hits after proc=%v want 0 (reset)", hits)
			}
		})
	}
}

func TestGenericCompletedOnHitMechanismsHullbreakerHits1to4NoProc(t *testing.T) {
	compileReq, runReq := gcohBaseFixture(t)
	gcohMountPassive(&compileReq, &runReq, gcohHullProviderRef, "provider_item_3181_hullbreaker",
		map[string]interface{}{gcohHullHitsKey: float64(0)},
		[]model.ListenerDefinition{gcohEveryNListener(
			"listener_item_3181_hullbreaker", gcohHullHitsKey, gcohHullOpRef,
			"damage/physical", 5, false, gcohHullAmount(),
		)})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 1000, Max: 1000, Resolved: 1000,
	})
	gcohSetDriverHits(&runReq, 4, "hull_pre")
	done := gcohRun(t, compileReq, runReq)
	if n, _, _ := gcohDamageEvidence(done, gcohHullOpRef, false); n != 0 {
		t.Fatalf("hull early proc=%d want 0", n)
	}
	if hits := gcohTargetStateHits(t, done, gcohHullProviderRef, gcohHullHitsKey); hits != 4 {
		t.Fatalf("hullbreaker_hits=%v want 4", hits)
	}
}

// ---------------------------------------------------------------------------
// 5. item 3302 Terminus / 晦影 — magic const 30
// ---------------------------------------------------------------------------

const (
	gcohTermProviderRef = "item:3302_terminus"
	gcohTermOpRef       = "op:terminus_on_hit"
	gcohTermRaw         = 30.0
)

func TestGenericCompletedOnHitMechanismsTerminusTwoMRScenarios(t *testing.T) {
	// Seed口径: flat 30 magic only；不含光暗交替 / 穿透。
	cases := []struct {
		name string
		mr   float64
	}{
		{name: "MR100", mr: 100},
		{name: "MR25", mr: 25},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohTermProviderRef, "provider_item_3302_terminus", nil,
				[]model.ListenerDefinition{gcohSimpleOnHitListener(
					"listener_item_3302_terminus", gcohTermOpRef, "damage/magic", true, gcohConst(gcohTermRaw),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
				Base: tc.mr, Current: tc.mr, Max: tc.mr, Resolved: tc.mr,
			})
			gcohSetDriverHits(&runReq, 1, "terminus")
			done := gcohRun(t, compileReq, runReq)

			n, raw, mit := gcohDamageEvidence(done, gcohTermOpRef, false)
			if n != 1 || math.Abs(raw-gcohTermRaw) > 1e-6 {
				t.Fatalf("terminus count=%d raw=%v want 1 / 30", n, raw)
			}
			wantMit := expectedMitigatedMagic(gcohTermRaw, tc.mr)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("terminus mitigated=%v want %v", mit, wantMit)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 6. item 3124 Guinsoo Wrath / 怨怒 — magic const 30; copyable_on_hit=true
// ---------------------------------------------------------------------------

const (
	gcohWrathProviderRef = "item:3124_guinsoos_wrath"
	gcohWrathOpRef       = "op:guinsoos_wrath"
	gcohWrathRaw         = 30.0
)

func TestGenericCompletedOnHitMechanismsGuinsooWrathTwoMRScenarios(t *testing.T) {
	cases := []struct {
		name string
		mr   float64
	}{
		{name: "MR100", mr: 100},
		{name: "MR0", mr: 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohWrathProviderRef, "provider_item_3124_guinsoos", nil,
				[]model.ListenerDefinition{gcohSimpleOnHitListener(
					"listener_item_3124_guinsoos", gcohWrathOpRef, "damage/magic", true, gcohConst(gcohWrathRaw),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
				Base: tc.mr, Current: tc.mr, Max: tc.mr, Resolved: tc.mr,
			})
			gcohSetDriverHits(&runReq, 1, "wrath")
			done := gcohRun(t, compileReq, runReq)

			n, raw, mit := gcohDamageEvidence(done, gcohWrathOpRef, false)
			if n != 1 || math.Abs(raw-gcohWrathRaw) > 1e-6 {
				t.Fatalf("wrath count=%d raw=%v want 1 / 30", n, raw)
			}
			wantMit := expectedMitigatedMagic(gcohWrathRaw, tc.mr)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("wrath mitigated=%v want %v", mit, wantMit)
			}
		})
	}
}

func TestGenericCompletedOnHitMechanismsGuinsooWrathPhantomCopiesOnce(t *testing.T) {
	// copyable_on_hit=true (lol_guinsoo_hk_seed.sql UPDATE step_item_3124_guinsoos_damage).
	compileReq, runReq := gcohBaseFixture(t)
	mr := 100.0
	gcohMountPassive(&compileReq, &runReq, gcohWrathProviderRef, "provider_item_3124_guinsoos", nil,
		[]model.ListenerDefinition{gcohSimpleOnHitListener(
			"listener_item_3124_guinsoos", gcohWrathOpRef, "damage/magic", true, gcohConst(gcohWrathRaw),
		)})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: mr, Current: mr, Max: mr, Resolved: mr,
	})
	gcohAttachGuinsooPhantomAt3(&compileReq, &runReq)
	gcohSetDriverHits(&runReq, 1, "wrath_ph")
	done := gcohRun(t, compileReq, runReq)

	if countEmittedEvents(done, gcohHitEvent) != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1 (phantom must not re-emit)", countEmittedEvents(done, gcohHitEvent))
	}
	origN, origRaw, origMit := gcohDamageEvidence(done, gcohWrathOpRef, false)
	phN, phRaw, phMit := gcohDamageEvidence(done, gcohWrathOpRef, true)
	if origN != 1 || phN != 1 {
		t.Fatalf("wrath orig=%d phantom=%d want 1/1", origN, phN)
	}
	wantMit := expectedMitigatedMagic(gcohWrathRaw, mr)
	if math.Abs(origRaw-gcohWrathRaw) > 1e-6 || math.Abs(phRaw-gcohWrathRaw) > 1e-6 {
		t.Fatalf("wrath raw orig=%v phantom=%v want %v", origRaw, phRaw, gcohWrathRaw)
	}
	if math.Abs(origMit-wantMit) > 1e-6 || math.Abs(phMit-wantMit) > 1e-6 {
		t.Fatalf("wrath mit orig=%v phantom=%v want %v", origMit, phMit, wantMit)
	}
}

// ---------------------------------------------------------------------------
// 7. item 3153 BoRK / 雾之锋 — physical 6% entry current HP; copyable=true
// ---------------------------------------------------------------------------

const (
	gcohBorkProviderRef = "item:3153_ruined_king"
	gcohBorkOpRef       = "op:ruined_king_on_hit"
	gcohBorkRatio       = 0.06
)

func gcohBorkAmount() *model.GenericFormulaExpr {
	ratio := gcohBorkRatio
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "event.entry_target.attr.hp.current"},
			{Op: "const", Value: &ratio},
		},
	}
}

func TestGenericCompletedOnHitMechanismsBoRKTwoCurrentHPScenarios(t *testing.T) {
	// Seed口径: 单一 6% entry current HP；无近战12%/远程9% 分裂、无非英雄cap。
	cases := []struct {
		name         string
		curHP, armor float64
		wantRaw      float64
	}{
		{name: "curHP1000_armor100", curHP: 1000, armor: 100, wantRaw: 60},
		{name: "curHP500_armor50", curHP: 500, armor: 50, wantRaw: 30},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohBorkProviderRef, "provider_item_3153_ruined_king", nil,
				[]model.ListenerDefinition{gcohSimpleOnHitListener(
					"listener_item_3153_ruined_king", gcohBorkOpRef, "damage/physical", true, gcohBorkAmount(),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
				Base: tc.curHP, Current: tc.curHP, Max: tc.curHP, Resolved: tc.curHP,
			})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
				Base: tc.armor, Current: tc.armor, Max: tc.armor, Resolved: tc.armor,
			})
			gcohSetDriverHits(&runReq, 1, "bork")
			done := gcohRun(t, compileReq, runReq)

			n, raw, mit := gcohDamageEvidence(done, gcohBorkOpRef, false)
			if n != 1 || math.Abs(raw-tc.wantRaw) > 1e-6 {
				t.Fatalf("bork count=%d raw=%v want 1 / %v (entry snapshot before AA)", n, raw, tc.wantRaw)
			}
			wantMit := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("bork mitigated=%v want %v", mit, wantMit)
			}
		})
	}
}

func TestGenericCompletedOnHitMechanismsBoRKPhantomCopiesOnce(t *testing.T) {
	compileReq, runReq := gcohBaseFixture(t)
	armor := 100.0
	curHP := 1000.0
	wantRaw := 60.0
	gcohMountPassive(&compileReq, &runReq, gcohBorkProviderRef, "provider_item_3153_ruined_king", nil,
		[]model.ListenerDefinition{gcohSimpleOnHitListener(
			"listener_item_3153_ruined_king", gcohBorkOpRef, "damage/physical", true, gcohBorkAmount(),
		)})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: curHP, Current: curHP, Max: curHP, Resolved: curHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: armor, Current: armor, Max: armor, Resolved: armor,
	})
	gcohAttachGuinsooPhantomAt3(&compileReq, &runReq)
	gcohSetDriverHits(&runReq, 1, "bork_ph")
	done := gcohRun(t, compileReq, runReq)

	if countEmittedEvents(done, gcohHitEvent) != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1", countEmittedEvents(done, gcohHitEvent))
	}
	origN, origRaw, origMit := gcohDamageEvidence(done, gcohBorkOpRef, false)
	phN, phRaw, phMit := gcohDamageEvidence(done, gcohBorkOpRef, true)
	if origN != 1 || phN != 1 {
		t.Fatalf("bork orig=%d phantom=%d want 1/1 (copyable_on_hit=true)", origN, phN)
	}
	wantMit := expectedMitigatedPhysical(wantRaw, armor)
	if math.Abs(origRaw-wantRaw) > 1e-6 || math.Abs(phRaw-wantRaw) > 1e-6 {
		t.Fatalf("bork raw orig=%v phantom=%v want %v", origRaw, phRaw, wantRaw)
	}
	if math.Abs(origMit-wantMit) > 1e-6 || math.Abs(phMit-wantMit) > 1e-6 {
		t.Fatalf("bork mit orig=%v phantom=%v want %v", origMit, phMit, wantMit)
	}
}

// ---------------------------------------------------------------------------
// 8. item 6672 Kraken / 放倒它 — every 3rd; missing-HP amp; copyable=false
// ---------------------------------------------------------------------------

const (
	gcohKrakenProviderRef = "item:6672_kraken"
	gcohKrakenOpRef       = "op:kraken_proc"
	gcohKrakenHitsKey     = "kraken_hits"
	gcohKrakenFlat        = 120.0
	gcohKrakenMissingAmp  = 0.75
)

func gcohKrakenAmount() *model.GenericFormulaExpr {
	flat := gcohKrakenFlat
	amp := gcohKrakenMissingAmp
	zero := 0.0
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &flat},
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &one},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{
								Op: "clamp",
								Expr: &model.GenericFormulaExpr{
									Op: "div",
									Args: []model.GenericFormulaExpr{
										{
											Op: "sub",
											Args: []model.GenericFormulaExpr{
												{Op: "read", Path: "event.entry_target.attr.hp.max"},
												{Op: "read", Path: "event.entry_target.attr.hp.current"},
											},
										},
										{
											Op: "max",
											Args: []model.GenericFormulaExpr{
												{Op: "read", Path: "event.entry_target.attr.hp.max"},
												{Op: "const", Value: &one},
											},
										},
									},
								},
								Min: &model.GenericFormulaExpr{Op: "const", Value: &zero},
								Max: &model.GenericFormulaExpr{Op: "const", Value: &one},
							},
							{Op: "const", Value: &amp},
						},
					},
				},
			},
		},
	}
}

func TestGenericCompletedOnHitMechanismsKrakenTwoMissingHPScenarios(t *testing.T) {
	cases := []struct {
		name         string
		maxHP, curHP float64
		armor        float64
		wantRaw      float64
	}{
		// missing=0 → 120*(1+0)=120
		{name: "fullHP_armor100", maxHP: 1000, curHP: 1000, armor: 100, wantRaw: 120},
		// missing=0.5 → 120*(1+0.375)=165
		{name: "halfHP_armor50", maxHP: 1000, curHP: 500, armor: 50, wantRaw: 165},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohKrakenProviderRef, "provider_item_6672_kraken",
				map[string]interface{}{gcohKrakenHitsKey: float64(0)},
				[]model.ListenerDefinition{gcohEveryNListener(
					"listener_item_6672_kraken", gcohKrakenHitsKey, gcohKrakenOpRef,
					"damage/physical", 3, false, gcohKrakenAmount(),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
				Base: tc.maxHP, Current: tc.curHP, Max: tc.maxHP, Resolved: tc.maxHP,
			})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
				Base: tc.armor, Current: tc.armor, Max: tc.armor, Resolved: tc.armor,
			})
			// Pre-seed 2 hits so a single AA is the proc hit: entry HP stays at configured
			// curHP (no prior AA chip damage skewing missingHpRatio).
			for i := range runReq.InitialSnapshot.Combatants {
				if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
					continue
				}
				runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
					gcohKrakenProviderRef: map[string]interface{}{
						"targetState": map[string]interface{}{
							"target": model.SelectorTarget,
							"values": map[string]interface{}{gcohKrakenHitsKey: float64(2)},
						},
					},
				}
			}
			gcohSetDriverHits(&runReq, 1, "kraken")
			done := gcohRun(t, compileReq, runReq)

			n, raw, mit := gcohDamageEvidence(done, gcohKrakenOpRef, false)
			if n != 1 {
				t.Fatalf("kraken proc count=%d want 1", n)
			}
			if math.Abs(raw-tc.wantRaw) > 1e-6 {
				t.Fatalf("kraken raw=%v want %v", raw, tc.wantRaw)
			}
			wantMit := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("kraken mitigated=%v want %v", mit, wantMit)
			}
			if hits := gcohTargetStateHits(t, done, gcohKrakenProviderRef, gcohKrakenHitsKey); hits != 0 {
				t.Fatalf("kraken_hits after proc=%v want 0", hits)
			}
		})
	}
}

func TestGenericCompletedOnHitMechanismsKrakenPhantomDoesNotCopy(t *testing.T) {
	// copyable_on_hit defaults false; guinsoo_hk does not open 6672.
	compileReq, runReq := gcohBaseFixture(t)
	gcohMountPassive(&compileReq, &runReq, gcohKrakenProviderRef, "provider_item_6672_kraken",
		map[string]interface{}{gcohKrakenHitsKey: float64(0)},
		[]model.ListenerDefinition{gcohEveryNListener(
			"listener_item_6672_kraken", gcohKrakenHitsKey, gcohKrakenOpRef,
			"damage/physical", 3, false, gcohKrakenAmount(),
		)})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 1000, Max: 1000, Resolved: 1000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	gcohAttachGuinsooPhantomAt3(&compileReq, &runReq)
	// AttachGuinsoo overwrites ProviderState; merge kraken pre-hits (2→3rd proc) + guinsoo stacks.
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			gcohChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
			gcohKrakenProviderRef: map[string]interface{}{
				"targetState": map[string]interface{}{
					"target": model.SelectorTarget,
					"values": map[string]interface{}{gcohKrakenHitsKey: float64(2)},
				},
			},
		}
	}
	gcohSetDriverHits(&runReq, 1, "kraken_ph")
	done := gcohRun(t, compileReq, runReq)

	if countEmittedEvents(done, gcohHitEvent) != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1", countEmittedEvents(done, gcohHitEvent))
	}
	origN, origRaw, _ := gcohDamageEvidence(done, gcohKrakenOpRef, false)
	phN, _, _ := gcohDamageEvidence(done, gcohKrakenOpRef, true)
	if origN != 1 || math.Abs(origRaw-120) > 1e-6 {
		t.Fatalf("kraken original count=%d raw=%v want 1 / 120", origN, origRaw)
	}
	if phN != 0 {
		t.Fatalf("kraken phantom copies=%d want 0 (copyable_on_hit=false)", phN)
	}
	// Phantom fixture armed: Guinsoo stacks advance 3→4 even though Kraken is not copied.
	bag := sourceProviderState(t, done.FinalSnapshot, gcohChampionRef)
	state, _ := bag["state"].(map[string]interface{})
	if stacks, _ := state[guinsooStackKey].(float64); stacks != 4 {
		t.Fatalf("guinsoo stacks=%v want 4 (phantom fixture armed)", stacks)
	}
}

// ---------------------------------------------------------------------------
// 9. Vayne W Silver Bolts — every 3rd true; max(6% maxHP, 50)
// ---------------------------------------------------------------------------

const (
	gcohVayneProviderRef = "hero:vayne_silver_bolts"
	gcohVayneOpRef       = "op:vayne_silver_bolts"
	gcohVayneHitsKey     = "silver_bolts_hits"
	gcohVayneRatio       = 0.06
	gcohVayneFloor       = 50.0
)

func gcohVayneAmount() *model.GenericFormulaExpr {
	// Backend seed uses $opponent.attr.hp.max; Web assembler rewrites to target.attr.hp.max.
	ratio := gcohVayneRatio
	floor := gcohVayneFloor
	return &model.GenericFormulaExpr{
		Op: "max",
		Args: []model.GenericFormulaExpr{
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "target.attr.hp.max"},
					{Op: "const", Value: &ratio},
				},
			},
			{Op: "const", Value: &floor},
		},
	}
}

func TestGenericCompletedOnHitMechanismsVayneWTwoDamageScenarios(t *testing.T) {
	// Seed口径: max(6% maxHP, 50) true；无非英雄上限 / 无 cap 扩写。
	cases := []struct {
		name    string
		maxHP   float64
		wantRaw float64 // floor vs percent
	}{
		{name: "floor_maxHP500", maxHP: 500, wantRaw: 50},      // 6%=30 → floor 50
		{name: "percent_maxHP2000", maxHP: 2000, wantRaw: 120}, // 6%=120
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohVayneProviderRef, "provider_hero_vayne_silver_bolts",
				map[string]interface{}{gcohVayneHitsKey: float64(0)},
				[]model.ListenerDefinition{gcohEveryNListener(
					"listener_hero_vayne_silver_bolts", gcohVayneHitsKey, gcohVayneOpRef,
					"damage/true", 3, false, gcohVayneAmount(),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
				Base: tc.maxHP, Current: tc.maxHP, Max: tc.maxHP, Resolved: tc.maxHP,
			})
			// Armor/MR must not affect true damage.
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
				Base: 200, Current: 200, Max: 200, Resolved: 200,
			})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
				Base: 200, Current: 200, Max: 200, Resolved: 200,
			})
			gcohSetDriverHits(&runReq, 3, "vayne_w")
			done := gcohRun(t, compileReq, runReq)

			n, raw, mit := gcohDamageEvidence(done, gcohVayneOpRef, false)
			if n != 1 {
				t.Fatalf("vayne proc count=%d want 1", n)
			}
			if math.Abs(raw-tc.wantRaw) > 1e-6 || math.Abs(mit-tc.wantRaw) > 1e-6 {
				t.Fatalf("vayne raw/mitigated=%v/%v want exact true %v", raw, mit, tc.wantRaw)
			}
			if hits := gcohTargetStateHits(t, done, gcohVayneProviderRef, gcohVayneHitsKey); hits != 0 {
				t.Fatalf("silver_bolts_hits after proc=%v want 0", hits)
			}
		})
	}
}

func TestGenericCompletedOnHitMechanismsVayneWHitSequenceResetAndIsolation(t *testing.T) {
	compileReq, runReq := gcohBaseFixture(t)
	gcohMountPassive(&compileReq, &runReq, gcohVayneProviderRef, "provider_hero_vayne_silver_bolts",
		map[string]interface{}{gcohVayneHitsKey: float64(0)},
		[]model.ListenerDefinition{gcohEveryNListener(
			"listener_hero_vayne_silver_bolts", gcohVayneHitsKey, gcohVayneOpRef,
			"damage/true", 3, false, gcohVayneAmount(),
		)})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 2000, Current: 2000, Max: 2000, Resolved: 2000,
	})

	// Hits 1-2: no proc; provider_target bound to "target".
	gcohSetDriverHits(&runReq, 2, "vayne_pre")
	done2 := gcohRun(t, compileReq, runReq)
	if n, _, _ := gcohDamageEvidence(done2, gcohVayneOpRef, false); n != 0 {
		t.Fatalf("hits 1-2 must not proc: count=%d", n)
	}
	if hits := gcohTargetStateHits(t, done2, gcohVayneProviderRef, gcohVayneHitsKey); hits != 2 {
		t.Fatalf("silver_bolts_hits after 2=%v want 2", hits)
	}
	bag := sourceProviderState(t, done2.FinalSnapshot, gcohVayneProviderRef)
	ts, _ := bag["targetState"].(map[string]interface{})
	if tgt, _ := ts["target"].(string); tgt != model.SelectorTarget {
		t.Fatalf("provider_target active=%q want %q (per-target binding)", tgt, model.SelectorTarget)
	}

	// Hits 1-3: proc on 3rd then reset; hit 4 restarts at 1.
	compileReq, runReq = gcohBaseFixture(t)
	gcohMountPassive(&compileReq, &runReq, gcohVayneProviderRef, "provider_hero_vayne_silver_bolts",
		map[string]interface{}{gcohVayneHitsKey: float64(0)},
		[]model.ListenerDefinition{gcohEveryNListener(
			"listener_hero_vayne_silver_bolts", gcohVayneHitsKey, gcohVayneOpRef,
			"damage/true", 3, false, gcohVayneAmount(),
		)})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 2000, Current: 2000, Max: 2000, Resolved: 2000,
	})
	gcohSetDriverHits(&runReq, 4, "vayne_seq")
	done := gcohRun(t, compileReq, runReq)
	n, raw, _ := gcohDamageEvidence(done, gcohVayneOpRef, false)
	if n != 1 || math.Abs(raw-120) > 1e-6 {
		t.Fatalf("after 4 hits: proc count=%d raw=%v want 1 / 120", n, raw)
	}
	if hits := gcohTargetStateHits(t, done, gcohVayneProviderRef, gcohVayneHitsKey); hits != 1 {
		t.Fatalf("silver_bolts_hits after hit4=%v want 1 (reset then +1)", hits)
	}

	// Target-state isolation note (seed uses provider_target / state_scope 20252):
	// Compile ABI only allows combatant keys source|target, and owner-mounted listeners
	// remap self-hit frame target → opponent (listenerFrameCombatants). Multi-opponent
	// clear-on-switch therefore cannot be exercised in this two-combatant fixture; the
	// same provider_target clear-on-switch contract is covered by
	// TestGenericRunProviderTargetStateSwitchClearsPreviousTarget. Here we assert the
	// seed shape: hits live under provider_target bound to the active event target.
}

func TestGenericCompletedOnHitMechanismsVayneWPhantomDoesNotStackOrProc(t *testing.T) {
	compileReq, runReq := gcohBaseFixture(t)
	gcohMountPassive(&compileReq, &runReq, gcohVayneProviderRef, "provider_hero_vayne_silver_bolts",
		map[string]interface{}{gcohVayneHitsKey: float64(0)},
		[]model.ListenerDefinition{gcohEveryNListener(
			"listener_hero_vayne_silver_bolts", gcohVayneHitsKey, gcohVayneOpRef,
			"damage/true", 3, false, gcohVayneAmount(),
		)})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 2000, Current: 2000, Max: 2000, Resolved: 2000,
	})
	// Pre-seed 2 silver bolts hits so original AA would be the 3rd (proc) if counted;
	// phantom must not add a 4th stack or extra proc. With copyable=false, phantom
	// also must not replay the true damage.
	gcohAttachGuinsooPhantomAt3(&compileReq, &runReq)
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			gcohChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
			gcohVayneProviderRef: map[string]interface{}{
				"targetState": map[string]interface{}{
					"target": model.SelectorTarget,
					"values": map[string]interface{}{gcohVayneHitsKey: float64(2)},
				},
			},
		}
	}
	gcohSetDriverHits(&runReq, 1, "vayne_ph")
	done := gcohRun(t, compileReq, runReq)

	if countEmittedEvents(done, gcohHitEvent) != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1 (phantom must not re-emit)", countEmittedEvents(done, gcohHitEvent))
	}
	origN, origRaw, _ := gcohDamageEvidence(done, gcohVayneOpRef, false)
	phN, _, _ := gcohDamageEvidence(done, gcohVayneOpRef, true)
	if origN != 1 || math.Abs(origRaw-120) > 1e-6 {
		t.Fatalf("vayne original proc count=%d raw=%v want 1 / 120", origN, origRaw)
	}
	if phN != 0 {
		t.Fatalf("vayne phantom proc/copy=%d want 0", phN)
	}
	// After original proc+reset, hits should be 0 — phantom must not have added another stack.
	if hits := gcohTargetStateHits(t, done, gcohVayneProviderRef, gcohVayneHitsKey); hits != 0 {
		t.Fatalf("silver_bolts_hits after phantom AA=%v want 0 (no phantom stack)", hits)
	}
}

// ---------------------------------------------------------------------------
// 10–11. item 3748 Titanic Hydra / 巨型九头蛇 — primary-target on-hit only
//     physical = event.entry_source.attr.hp.max * 0.005 (远程近似)
//     Shared boundary for both Cleave components; no cone/active/other targets.
// ---------------------------------------------------------------------------

const (
	gcohTitanicProviderRef = "item:3748_titanic_hydra"
	gcohTitanicOpRef       = "op:titanic_hydra_primary"
	gcohTitanicHPRatio     = 0.005
)

func gcohTitanicAmount() *model.GenericFormulaExpr {
	ratio := gcohTitanicHPRatio
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "event.entry_source.attr.hp.max"},
			{Op: "const", Value: &ratio},
		},
	}
}

func TestGenericCompletedOnHitMechanismsTitanicHydraTwoMaxHPScenarios(t *testing.T) {
	// Seed口径: 远程主目标 only（source.hp.max * 0.005）；不宣称 melee 1% / cone / active。
	// SQL 输入仅为 max HP（无 AD）；两场景覆盖不同 source maxHP + armor mitigation。
	cases := []struct {
		name     string
		srcMaxHP float64
		armor    float64
		wantRaw  float64
	}{
		{name: "srcHP1000_armor100", srcMaxHP: 1000, armor: 100, wantRaw: 5},
		{name: "srcHP2000_armor50", srcMaxHP: 2000, armor: 50, wantRaw: 10},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := gcohBaseFixture(t)
			gcohMountPassive(&compileReq, &runReq, gcohTitanicProviderRef, "provider_item_3748_titanic_hydra", nil,
				[]model.ListenerDefinition{gcohSimpleOnHitListener(
					"listener_item_3748_titanic_hydra", gcohTitanicOpRef, "damage/physical", false, gcohTitanicAmount(),
				)})
			setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
				Base: tc.srcMaxHP, Current: tc.srcMaxHP, Max: tc.srcMaxHP, Resolved: tc.srcMaxHP,
			})
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
				Base: tc.armor, Current: tc.armor, Max: tc.armor, Resolved: tc.armor,
			})
			gcohSetDriverHits(&runReq, 1, "titanic")
			done := gcohRun(t, compileReq, runReq)

			if countEmittedEvents(done, gcohHitEvent) != 1 {
				t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, gcohHitEvent))
			}
			n, raw, mit := gcohDamageEvidence(done, gcohTitanicOpRef, false)
			if n != 1 {
				t.Fatalf("titanic on-hit count=%d want 1", n)
			}
			if math.Abs(raw-tc.wantRaw) > 1e-6 {
				t.Fatalf("titanic raw=%v want %v", raw, tc.wantRaw)
			}
			wantMit := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mit-wantMit) > 1e-6 {
				t.Fatalf("titanic mitigated=%v want %v (armor=%v)", mit, wantMit, tc.armor)
			}
		})
	}
}

func TestGenericCompletedOnHitMechanismsTitanicHydraPhantomDoesNotCopy(t *testing.T) {
	// copyable_on_hit defaults false; guinsoo_hk does not open step_item_3748_titanic_hydra_damage.
	compileReq, runReq := gcohBaseFixture(t)
	srcHP := 1000.0
	armor := 100.0
	wantRaw := 5.0
	gcohMountPassive(&compileReq, &runReq, gcohTitanicProviderRef, "provider_item_3748_titanic_hydra", nil,
		[]model.ListenerDefinition{gcohSimpleOnHitListener(
			"listener_item_3748_titanic_hydra", gcohTitanicOpRef, "damage/physical", false, gcohTitanicAmount(),
		)})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: srcHP, Current: srcHP, Max: srcHP, Resolved: srcHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: armor, Current: armor, Max: armor, Resolved: armor,
	})
	gcohAttachGuinsooPhantomAt3(&compileReq, &runReq)
	gcohSetDriverHits(&runReq, 1, "titanic_ph")
	done := gcohRun(t, compileReq, runReq)

	if countEmittedEvents(done, gcohHitEvent) != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1", countEmittedEvents(done, gcohHitEvent))
	}
	origN, origRaw, origMit := gcohDamageEvidence(done, gcohTitanicOpRef, false)
	phN, _, _ := gcohDamageEvidence(done, gcohTitanicOpRef, true)
	if origN != 1 || math.Abs(origRaw-wantRaw) > 1e-6 {
		t.Fatalf("titanic original count=%d raw=%v want 1 / %v", origN, origRaw, wantRaw)
	}
	wantMit := expectedMitigatedPhysical(wantRaw, armor)
	if math.Abs(origMit-wantMit) > 1e-6 {
		t.Fatalf("titanic mitigated=%v want %v", origMit, wantMit)
	}
	if phN != 0 {
		t.Fatalf("titanic phantom copies=%d want 0 (copyable_on_hit=false)", phN)
	}
	// Phantom fixture armed: Guinsoo stacks advance 3→4 even though Titanic is not copied.
	bag := sourceProviderState(t, done.FinalSnapshot, gcohChampionRef)
	state, _ := bag["state"].(map[string]interface{})
	if stacks, _ := state[guinsooStackKey].(float64); stacks != 4 {
		t.Fatalf("guinsoo stacks=%v want 4 (phantom fixture armed)", stacks)
	}
}
