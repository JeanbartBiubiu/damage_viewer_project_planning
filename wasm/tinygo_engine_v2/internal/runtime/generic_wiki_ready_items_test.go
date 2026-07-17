package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// Wiki-data-ready generic ABI proofs for items 2501 / 3097 / 3075.
// Path: CompileGeneric → RunGeneric only (no single_attacker_dps / legacy DPS).
//
// 2501 Tyranny: source-only provider modifier bonus AD = 0.025 * max(0, hp.max-hp.base).
//   Note: ResolveAttributes rewrites unmodified attr.resolved → base, so the Wiki-shaped
//   hp.resolved-hp.base is not observable inside modifier formulas; hp.max carries bonus HP
//   (same field family as Manamune mana.max).
// 3097 Bolt: precharged energized window only (seed charge=100 → next real basic_attack_hit
//            deals 100 bonus magic then consume). No energize-rate claims.
// 3075 Thorns: target-owned basic_attack_hit + source_opponent retaliation
//            (20 + 0.10 * source.attr.bonus_armor.resolved magic). Grievous Wounds out of scope.

const (
	wikiReadyChampionRef = spellbladeChampionRef
	wikiReadyHitAbility  = spellbladeHitAbilityKey
	wikiReadyHitEvent    = spellbladeHitEvent

	// --- 2501 Tyranny / 专横 ---
	tyrannyProviderRef = "item:overlord_tyranny"
	tyrannyStableID    = "item_2501"
	tyrannyModifierKey = "item_2501_tyranny_bonus_ad"
	tyrannyRatio       = 0.025
	tyrannyBaseAD      = 100.0
	tyrannyHPBase      = 1000.0
	tyrannyAAOpRef     = "op:tyranny_aa"

	// --- 3097 Bolt / 弩箭 ---
	boltChargeKey   = "energized_charge"
	boltProviderRef = "item:bolt_energized"
	boltStableID    = "item_3097"
	boltDamageOpRef = "op:bolt_energized_damage"
	boltAADamage    = 10.0
	boltProcRaw     = 100.0
	boltChargeMax   = 100.0

	// --- 3075 Thorns / 荆棘 ---
	thornsProviderRef = "item:thorns_retaliation"
	thornsStableID    = "item_3075"
	thornsDamageOpRef = "op:thorns_retaliation_damage"
	thornsBaseRaw     = 20.0
	thornsArmorRatio  = 0.10
	thornsAADamage    = 10.0
	thornsArmorBase   = 50.0
)

func runWikiReadyGeneric(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func wikiReadyAARef() string {
	return "source.provider[" + wikiReadyChampionRef + "].ability[" + wikiReadyHitAbility + "]"
}

func setWikiReadyDriverHits(runReq *model.RunRequest, hits int, prefix string) {
	ref := wikiReadyAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   prefix + "_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
}

func wikiReadyConstAAOps(aaDamage float64) []model.OperationDefinition {
	aa := aaDamage
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
			EventType: wikiReadyHitEvent,
			Ref:       wikiReadyHitEvent,
		},
	}
}

func wikiReadyADScaledAAOps() []model.OperationDefinition {
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Ref:        tyrannyAAOpRef,
			Amount: &model.GenericFormulaExpr{
				Op: "read", Path: "source.attr.ad.resolved",
			},
		},
	}
}

func combatantAttrBase(t *testing.T, snap model.Snapshot, key, attr string) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != key {
			continue
		}
		slot, ok := c.Attributes[attr]
		if !ok {
			t.Fatalf("combatant %s missing attr %s", key, attr)
		}
		return slot.Base
	}
	t.Fatalf("combatant %s missing", key)
	return 0
}

func combatantFinalHP(t *testing.T, snap model.Snapshot, key string) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != key {
			continue
		}
		slot, ok := c.Attributes["hp"]
		if !ok {
			t.Fatalf("combatant %s missing hp", key)
		}
		if slot.Current != 0 {
			return slot.Current
		}
		return slot.Resolved
	}
	t.Fatalf("combatant %s missing", key)
	return 0
}

// ---------------------------------------------------------------------------
// 2501 Tyranny
// ---------------------------------------------------------------------------

func tyrannyBonusADExpr() model.GenericFormulaExpr {
	zero := 0.0
	// Bonus health via max−base: unmodified hp.resolved is reset to base during resolve.
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			gfConst(tyrannyRatio),
			{
				Op: "max",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &zero},
					{
						Op: "sub",
						Args: []model.GenericFormulaExpr{
							{Op: "read", Path: "source.attr.hp.max"},
							{Op: "read", Path: "source.attr.hp.base"},
						},
					},
				},
			},
		},
	}
}

func mountTyrannyProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: tyrannyProviderRef,
		Kind:        "item",
		StableID:    tyrannyStableID,
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: tyrannyModifierKey,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       tyrannyBonusADExpr(),
		}},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: tyrannyProviderRef, DefinitionRef: tyrannyProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: tyrannyProviderRef, DefinitionRef: tyrannyProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func loadTyrannyFixture(t *testing.T, bonusHealth float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	mountTyrannyProvider(&compileReq, &runReq)

	hpMax := tyrannyHPBase + bonusHealth
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: tyrannyBaseAD, Current: tyrannyBaseAD, Max: tyrannyBaseAD, Resolved: tyrannyBaseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: tyrannyHPBase, Current: hpMax, Max: hpMax, Resolved: hpMax,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})

	// AA damage = resolved AD so bonus AD is observable in the damage pipeline.
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: wikiReadyHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: wikiReadyADScaledAAOps(),
	}}
	setWikiReadyDriverHits(&runReq, 1, "tyranny")
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

// TestGenericWikiReadyItemsTyrannyBonusADFromBonusHealth proves source-only Tyranny
// modifier: bonus health 0/400/1000 → bonus AD 0/10/25, and AA damage tracks AD.
func TestGenericWikiReadyItemsTyrannyBonusADFromBonusHealth(t *testing.T) {
	cases := []struct {
		bonusHealth float64
		wantBonusAD float64
	}{
		{0, 0},
		{400, 10},
		{1000, 25},
	}
	for _, tc := range cases {
		compileReq, runReq := loadTyrannyFixture(t, tc.bonusHealth)
		done := runWikiReadyGeneric(t, compileReq, runReq)

		gotAD := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorSource, "ad")
		gotBase := combatantAttrBase(t, done.FinalSnapshot, model.SelectorSource, "ad")
		wantAD := tyrannyBaseAD + tc.wantBonusAD
		if math.Abs(gotBase-tyrannyBaseAD) > 1e-12 {
			t.Fatalf("bonusHP=%v: ad.base=%v want %v", tc.bonusHealth, gotBase, tyrannyBaseAD)
		}
		if math.Abs(gotAD-wantAD) > 1e-12 {
			t.Fatalf("bonusHP=%v: ad.resolved=%v want %v (base %v + 0.025*%v)",
				tc.bonusHealth, gotAD, wantAD, tyrannyBaseAD, tc.bonusHealth)
		}
		if math.Abs(sumDamageRawByOpRef(done, tyrannyAAOpRef)-wantAD) > 1e-6 {
			t.Fatalf("bonusHP=%v: AA raw=%v want %v (must track resolved AD)",
				tc.bonusHealth, sumDamageRawByOpRef(done, tyrannyAAOpRef), wantAD)
		}
		if math.Abs(done.Summary.SourceDamageDealt-wantAD) > 1e-6 {
			t.Fatalf("bonusHP=%v: sourceDamageDealt=%v want %v",
				tc.bonusHealth, done.Summary.SourceDamageDealt, wantAD)
		}
	}
}

// ---------------------------------------------------------------------------
// 3097 Bolt (precharge window only)
// ---------------------------------------------------------------------------

func boltReadyCond() *model.GenericFormulaExpr {
	threshold := boltChargeMax
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + boltChargeKey},
			{Op: "const", Value: &threshold},
		},
	}
}

func boltHitListener() model.ListenerDefinition {
	zero := 0.0
	raw := boltProcRaw
	ready := boltReadyCond()
	// Precharge-only: proc + consume. No charge-gain op (rate is non-goal).
	return model.ListenerDefinition{
		ListenerKey:  "listener_item_3097_bolt_energized",
		EventMatcher: model.TypeMatcher{All: []string{wikiReadyHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           boltDamageOpRef,
				CopyableOnHit: false,
				Condition:     ready,
				Amount:        &model.GenericFormulaExpr{Op: "const", Value: &raw},
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         boltChargeKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   ready,
			},
		},
	}
}

func boltChargeSchema() map[string]interface{} {
	return map[string]interface{}{
		boltChargeKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(boltChargeMax),
			"durationMs":   float64(0),
		},
	}
}

func mountBoltProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        boltProviderRef,
		Kind:               "item",
		StableID:           boltStableID,
		InitialStateSchema: boltChargeSchema(),
		Listeners:          []model.ListenerDefinition{boltHitListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: boltProviderRef, DefinitionRef: boltProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: boltProviderRef, DefinitionRef: boltProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func seedBoltCharge(runReq *model.RunRequest, charge float64) {
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[boltProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{boltChargeKey: charge},
		}
	}
}

func boltChargeValue(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, boltProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("bolt state bag missing: %+v", bag)
	}
	v, _ := state[boltChargeKey].(float64)
	return v
}

func loadBoltFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureSpellbladeTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: wikiReadyHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: wikiReadyConstAAOps(boltAADamage),
	}}
	mountBoltProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

// TestGenericWikiReadyItemsBoltPrechargeProcAndConsume: seed 100 → first real hit procs
// 100 magic (MR-mitigated), consumes charge; second hit does not proc.
func TestGenericWikiReadyItemsBoltPrechargeProcAndConsume(t *testing.T) {
	compileReq, runReq := loadBoltFixture(t)
	mr := 100.0
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: mr, Current: mr, Max: mr, Resolved: mr,
	})
	seedBoltCharge(&runReq, boltChargeMax)
	setWikiReadyDriverHits(&runReq, 2, "bolt")
	done := runWikiReadyGeneric(t, compileReq, runReq)

	if n := countDamageByOpRef(done, boltDamageOpRef, false); n != 1 {
		t.Fatalf("bolt proc count=%d want 1", n)
	}
	if got := sumDamageRawByOpRef(done, boltDamageOpRef); math.Abs(got-boltProcRaw) > 1e-6 {
		t.Fatalf("bolt raw=%v want %v", got, boltProcRaw)
	}
	wantMitigated := expectedMitigatedMagic(boltProcRaw, mr) // 100 * 100/(100+100) = 50
	if math.Abs(wantMitigated-50) > 1e-9 {
		t.Fatalf("helper mitigated=%v want 50", wantMitigated)
	}
	if got := sumDamageMitigatedByOpRef(done, boltDamageOpRef); math.Abs(got-wantMitigated) > 1e-6 {
		t.Fatalf("bolt mitigated=%v want %v", got, wantMitigated)
	}
	if got := boltChargeValue(t, done); math.Abs(got) > 1e-6 {
		t.Fatalf("energized_charge after consume=%v want 0", got)
	}
	wantDealt := boltAADamage*2 + wantMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestGenericWikiReadyItemsBoltPhantomDoesNotExtraConsume: Guinsoo phantom must not
// re-proc or re-consume Bolt (CopyableOnHit=false + listener not re-fired).
func TestGenericWikiReadyItemsBoltPhantomDoesNotExtraConsume(t *testing.T) {
	compileReq, runReq := loadBoltFixture(t)
	aa := boltAADamage
	one := 1.0
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
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
			EventType: wikiReadyHitEvent,
			Ref:       wikiReadyHitEvent,
		},
	}
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{wikiReadyHitEvent, "event/source_owner"}},
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
			EventMatcher: model.TypeMatcher{All: []string{wikiReadyHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			wikiReadyChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
			boltProviderRef: map[string]interface{}{
				"state": map[string]interface{}{boltChargeKey: float64(boltChargeMax)},
			},
		}
	}
	setWikiReadyDriverHits(&runReq, 1, "bolt_phantom")
	done := runWikiReadyGeneric(t, compileReq, runReq)

	if n := countDamageByOpRef(done, boltDamageOpRef, false); n != 1 {
		t.Fatalf("original bolt proc=%d want 1", n)
	}
	if n := countPhantomDamageByOpRef(done, boltDamageOpRef); n != 0 {
		t.Fatalf("phantom bolt damage=%d want 0", n)
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1 (fixture must fire phantom)", n)
	}
	if got := boltChargeValue(t, done); math.Abs(got) > 1e-6 {
		t.Fatalf("charge=%v want 0 (phantom must not re-consume)", got)
	}
}

// ---------------------------------------------------------------------------
// 3075 Thorns
// ---------------------------------------------------------------------------

func thornsRetaliationAmount() *model.GenericFormulaExpr {
	base := thornsBaseRaw
	ratio := thornsArmorRatio
	// Synthetic bonus_armor (Jak'Sho pattern): armor.resolved−armor.base is wiped by resolve.
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{Op: "read", Path: "source.attr.bonus_armor.resolved"},
				},
			},
		},
	}
}

func thornsHitListener() model.ListenerDefinition {
	return model.ListenerDefinition{
		ListenerKey:  "listener_item_3075_thorns",
		EventMatcher: model.TypeMatcher{All: []string{wikiReadyHitEvent, "event/source_opponent"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target", // after owner remap = original attacker
				DamageType:    "damage/magic",
				Ref:           thornsDamageOpRef,
				CopyableOnHit: false,
				Amount:        thornsRetaliationAmount(),
			},
		},
	}
}

func mountThornsOnTarget(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: thornsProviderRef,
		Kind:        "item",
		StableID:    thornsStableID,
		Listeners:   []model.ListenerDefinition{thornsHitListener()},
	})
	need := []model.TypeCatalogEntry{
		{Key: "event/source_opponent", Domain: "event"},
	}
	have := map[string]bool{}
	for _, t := range compileReq.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, t)
		}
	}

	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, model.CombatantProviderMount{
			ProviderRef: thornsProviderRef, DefinitionRef: thornsProviderRef,
		})
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: thornsProviderRef, DefinitionRef: thornsProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func loadThornsFixture(t *testing.T, bonusArmor, attackerMR float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureSpellbladeTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: wikiReadyHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: wikiReadyConstAAOps(thornsAADamage),
	}}
	mountThornsOnTarget(&compileReq, &runReq)

	armorResolved := thornsArmorBase + bonusArmor
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: thornsArmorBase, Current: armorResolved, Max: armorResolved, Resolved: armorResolved,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "bonus_armor", model.AttributeSlotDef{
		Base: bonusArmor, Current: bonusArmor, Max: bonusArmor, Resolved: bonusArmor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_resist", model.AttributeSlotDef{
		Base: attackerMR, Current: attackerMR, Max: attackerMR, Resolved: attackerMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func thornsWantRaw(bonusArmor float64) float64 {
	return thornsBaseRaw + thornsArmorRatio*bonusArmor
}

// TestGenericWikiReadyItemsThornsRetaliationBonusArmorAndMR: bonus armor 0/100 → raw 20/30,
// MR mitigates, once per real AA, no recursive extra thorns procs.
func TestGenericWikiReadyItemsThornsRetaliationBonusArmorAndMR(t *testing.T) {
	cases := []struct {
		bonusArmor float64
		wantRaw    float64
	}{
		{0, 20},
		{100, 30},
	}
	attackerMR := 100.0
	for _, tc := range cases {
		if math.Abs(tc.wantRaw-thornsWantRaw(tc.bonusArmor)) > 1e-12 {
			t.Fatalf("fixture wantRaw mismatch for bonusArmor=%v", tc.bonusArmor)
		}
		compileReq, runReq := loadThornsFixture(t, tc.bonusArmor, attackerMR)
		setWikiReadyDriverHits(&runReq, 2, "thorns")
		done := runWikiReadyGeneric(t, compileReq, runReq)

		if n := countDamageByOpRef(done, thornsDamageOpRef, false); n != 2 {
			t.Fatalf("bonusArmor=%v: thorns procs=%d want 2 (one per real AA)", tc.bonusArmor, n)
		}
		if got := sumDamageRawByOpRef(done, thornsDamageOpRef); math.Abs(got-tc.wantRaw*2) > 1e-6 {
			t.Fatalf("bonusArmor=%v: thorns raw sum=%v want %v", tc.bonusArmor, got, tc.wantRaw*2)
		}
		wantMitigatedOne := expectedMitigatedMagic(tc.wantRaw, attackerMR)
		wantMitigated := wantMitigatedOne * 2
		if got := sumDamageMitigatedByOpRef(done, thornsDamageOpRef); math.Abs(got-wantMitigated) > 1e-6 {
			t.Fatalf("bonusArmor=%v: thorns mitigated=%v want %v", tc.bonusArmor, got, wantMitigated)
		}
		// Target-owned listener damage is accounted on TargetDamageDealt.
		if math.Abs(done.Summary.TargetDamageDealt-wantMitigated) > 1e-6 {
			t.Fatalf("bonusArmor=%v: targetDamageDealt=%v want %v",
				tc.bonusArmor, done.Summary.TargetDamageDealt, wantMitigated)
		}
		wantSourceHP := 100000 - wantMitigated
		if got := combatantFinalHP(t, done.FinalSnapshot, model.SelectorSource); math.Abs(got-wantSourceHP) > 1e-6 {
			t.Fatalf("bonusArmor=%v: sourceFinalHp=%v want %v", tc.bonusArmor, got, wantSourceHP)
		}
		// No recursion: still exactly 2 thorns damages for 2 AAs (retaliation does not
		// emit basic_attack_hit and child magic damage does not re-fire this listener).
		if countEmittedEvents(done, wikiReadyHitEvent) != 2 {
			t.Fatalf("bonusArmor=%v: basic_attack_hit emits=%d want 2",
				tc.bonusArmor, countEmittedEvents(done, wikiReadyHitEvent))
		}
	}
}
