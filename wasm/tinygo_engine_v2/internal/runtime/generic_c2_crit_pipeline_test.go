package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func c2Float(v float64) *float64 { return &v }

func c2PipelineMod(key, command, channel, stage, policy string, value float64, priority int) model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: key,
		Kind:        "pipeline",
		Command:     command,
		Channel:     channel,
		Stage:       stage,
		Bucket:      "all_instances",
		Priority:    priority,
		ValuePolicy: policy,
		Value:       model.GenericFormulaExpr{Op: "const", Value: c2Float(value)},
	}
}

func modifiersByStage(data map[string]interface{}, stage string) []map[string]interface{} {
	var out []map[string]interface{}
	for _, m := range damageEvidenceModifiers(data) {
		if evidenceDataString(m, "stage") == stage {
			out = append(out, m)
		}
	}
	return out
}

func TestC2BaselineChanceAndMultiplierFloor(t *testing.T) {
	cases := []struct {
		name     string
		chance   float64
		mult     float64
		wantMult float64
	}{
		{"chance0", 0, critIEMultiplier, critIEMultiplier},
		{"chance025", 0.25, critIEMultiplier, critIEMultiplier},
		{"chance1", 1, critIEMultiplier, critIEMultiplier},
		{"multFloor", 0.5, 0.5, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadCritEligibleDamageFixture(t, tc.chance, tc.mult, true)
			done := runCritFixture(t, compileReq, runReq)
			data := firstOriginalDamage(t, done)
			_, _, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, tc.chance, tc.mult)
			assertCritEvidence(t, data, true, tc.chance, clamp01(tc.chance), tc.wantMult, critBaseRaw, normal, critPart, adjusted)
			if math.Abs(evidenceDataFloat(data, "originalCritChance")-clamp01(tc.chance)) > 1e-12 {
				t.Fatalf("p=%v", evidenceDataFloat(data, "originalCritChance"))
			}
			if math.Abs(evidenceDataFloat(data, "forcedCritWeight")) > 1e-12 {
				t.Fatalf("forcedWeight=%v", evidenceDataFloat(data, "forcedCritWeight"))
			}
		})
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func TestC2SourceChanceOverrideKeepsOriginalP(t *testing.T) {
	const p = 0.25
	compileReq, runReq := loadCritEligibleDamageFixture(t, p, critIEMultiplier, true)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_ob", "c2_ob",
		c2PipelineMod("ob_force", "crit", "all_damage", "crit_chance_pre_settlement", "override", 1, 0))
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "originalCritChance")-p) > 1e-12 {
		t.Fatalf("p=%v want %v", evidenceDataFloat(data, "originalCritChance"), p)
	}
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-1) > 1e-12 {
		t.Fatalf("q=%v want 1", evidenceDataFloat(data, "chanceEffective"))
	}
	if math.Abs(evidenceDataFloat(data, "naturalCritWeight")-p) > 1e-12 {
		t.Fatalf("naturalWeight=%v want p", evidenceDataFloat(data, "naturalCritWeight"))
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritWeight")-(1-p)) > 1e-12 {
		t.Fatalf("forcedWeight=%v want 1-p", evidenceDataFloat(data, "forcedCritWeight"))
	}
}

func TestC2SourceChanceMultiplyChangesQ(t *testing.T) {
	const p = 0.25
	compileReq, runReq := loadCritEligibleDamageFixture(t, p, critIEMultiplier, true)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_mul_q", "c2_mul_q",
		c2PipelineMod("mul_q", "crit", "all_damage", "crit_chance_pre_settlement", "multiply", 2, 0))
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	wantQ := 0.5
	if math.Abs(evidenceDataFloat(data, "originalCritChance")-p) > 1e-12 {
		t.Fatalf("p=%v", evidenceDataFloat(data, "originalCritChance"))
	}
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-wantQ) > 1e-12 {
		t.Fatalf("q=%v want %v", evidenceDataFloat(data, "chanceEffective"), wantQ)
	}
	if math.Abs(evidenceDataFloat(data, "naturalCritWeight")-p) > 1e-12 {
		t.Fatalf("naturalWeight=%v want p", evidenceDataFloat(data, "naturalCritWeight"))
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritWeight")-(wantQ-p)) > 1e-12 {
		t.Fatalf("forcedWeight=%v", evidenceDataFloat(data, "forcedCritWeight"))
	}
}

func TestC2ForcedAndNaturalMultipliersDiverge(t *testing.T) {
	const (
		p        = 0.25
		mNatural = 2.0
		mForced  = 3.0
	)
	compileReq, runReq := loadCritEligibleDamageFixture(t, p, 2.5, true)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_nat", "c2_nat",
		c2PipelineMod("nat", "crit", "all_damage", "crit_multiplier_natural_branch", "override", mNatural, 0))
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_frc", "c2_frc",
		c2PipelineMod("frc", "crit", "all_damage", "crit_multiplier_forced_branch", "override", mForced, 0))
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_q1", "c2_q1",
		c2PipelineMod("q1", "crit", "all_damage", "crit_chance_pre_settlement", "override", 1, 0))

	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	naturalWeight := p
	forcedWeight := 1 - p
	normalPart := critBaseRaw * 0 // q=1
	critPart := critBaseRaw * (naturalWeight*mNatural + forcedWeight*mForced)
	adjusted := normalPart + critPart
	if math.Abs(evidenceDataFloat(data, "naturalCritMultiplier")-mNatural) > 1e-12 {
		t.Fatalf("M_natural=%v", evidenceDataFloat(data, "naturalCritMultiplier"))
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritMultiplier")-mForced) > 1e-12 {
		t.Fatalf("M_forced=%v", evidenceDataFloat(data, "forcedCritMultiplier"))
	}
	if math.Abs(evidenceDataFloat(data, "critPart")-critPart) > 1e-9 {
		t.Fatalf("critPart=%v want %v", evidenceDataFloat(data, "critPart"), critPart)
	}
	if math.Abs(evidenceDataFloat(data, "critAdjustedRawAmount")-adjusted) > 1e-9 {
		t.Fatalf("adjusted=%v want %v", evidenceDataFloat(data, "critAdjustedRawAmount"), adjusted)
	}
}

func TestC2OutgoingProjectsPartsProportionally(t *testing.T) {
	const (
		p      = 0.25
		mult   = 2.0
		outMul = 2.0
	)
	compileReq, runReq := loadCritEligibleDamageFixture(t, p, mult, true)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_out", "c2_out",
		c2PipelineMod("out", "damage", "all_damage", "outgoing_pre_mitigation", "multiply", outMul, 0))
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	_, _, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, p, mult)
	wantNormal := normal * outMul
	wantCrit := critPart * outMul
	wantRaw := adjusted * outMul
	if math.Abs(evidenceDataFloat(data, "rawAmount")-wantRaw) > 1e-9 {
		t.Fatalf("raw=%v want %v", evidenceDataFloat(data, "rawAmount"), wantRaw)
	}
	if math.Abs(evidenceDataFloat(data, "normalPart")-wantNormal) > 1e-9 {
		t.Fatalf("normalPart=%v want %v", evidenceDataFloat(data, "normalPart"), wantNormal)
	}
	if math.Abs(evidenceDataFloat(data, "critPart")-wantCrit) > 1e-9 {
		t.Fatalf("critPart=%v want %v", evidenceDataFloat(data, "critPart"), wantCrit)
	}
	if math.Abs(evidenceDataFloat(data, "critAdjustedRawAmount")-adjusted) > 1e-9 {
		t.Fatalf("critAdjustedRawAmount must stay pre-outgoing %v got %v", adjusted, evidenceDataFloat(data, "critAdjustedRawAmount"))
	}
}

func TestC2ResistanceAppliesOneFactorToBothParts(t *testing.T) {
	const (
		p    = 0.5
		mult = 2.0
	)
	compileReq, runReq := loadCritEligibleDamageFixture(t, p, mult, true)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	_, _, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, p, mult)
	wantMitigated := expectedMitigatedPhysical(adjusted, critArmor)
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-wantMitigated) > 1e-9 {
		t.Fatalf("mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), wantMitigated)
	}
	// Armor 100 → factor 0.5; parts sum through same factor.
	if math.Abs(wantMitigated-adjusted*0.5) > 1e-9 {
		t.Fatalf("expected single resist factor 0.5")
	}
	if math.Abs(evidenceDataFloat(data, "resistanceFactor")-0.5) > 1e-12 {
		t.Fatalf("resistanceFactor=%v want 0.5", evidenceDataFloat(data, "resistanceFactor"))
	}
	if math.Abs(evidenceDataFloat(data, "normalPartPostResistance")-normal*0.5) > 1e-9 {
		t.Fatalf("normalPartPostResistance=%v want %v", evidenceDataFloat(data, "normalPartPostResistance"), normal*0.5)
	}
	if math.Abs(evidenceDataFloat(data, "critPartPostResistance")-critPart*0.5) > 1e-9 {
		t.Fatalf("critPartPostResistance=%v want %v", evidenceDataFloat(data, "critPartPostResistance"), critPart*0.5)
	}
}

func TestC2IncomingCritPartThenGeneralIncoming(t *testing.T) {
	const (
		p    = 1.0
		mult = 2.0 // critPart = 200, normal = 0; armor 100 → mitigatedCrit=100
	)
	compileReq, runReq := loadCritEligibleDamageFixture(t, p, mult, true)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, "item:c2_randuin", "c2_randuin",
		c2PipelineMod("randuin", "damage", "all_damage", "incoming_crit_part_post_mitigation", "multiply", 0.5, 0))
	mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, "item:c2_rock", "c2_rock",
		c2PipelineMod("rock", "damage", "all_damage", "incoming_post_mitigation", "subtract", 10, 0))

	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	// pre-outgoing adjusted=200; resist factor 0.5 → normal=0 crit=100;
	// crit-part *0.5 → 50; merge=50; subtract 10 → 40.
	if math.Abs(evidenceDataFloat(data, "resistanceFactor")-0.5) > 1e-12 {
		t.Fatalf("resistanceFactor=%v want 0.5", evidenceDataFloat(data, "resistanceFactor"))
	}
	if math.Abs(evidenceDataFloat(data, "normalPartPostResistance")) > 1e-12 {
		t.Fatalf("normalPartPostResistance=%v want 0", evidenceDataFloat(data, "normalPartPostResistance"))
	}
	if math.Abs(evidenceDataFloat(data, "critPartPostResistance")-100) > 1e-9 {
		t.Fatalf("critPartPostResistance=%v want 100 (pre-incoming)", evidenceDataFloat(data, "critPartPostResistance"))
	}
	want := 40.0
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-want) > 1e-9 {
		t.Fatalf("mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), want)
	}
	partMods := modifiersByStage(data, "incoming_crit_part_post_mitigation")
	if len(partMods) != 1 {
		t.Fatalf("crit-part mods=%d data=%+v", len(partMods), data["modifiers"])
	}
	genMods := modifiersByStage(data, "incoming_post_mitigation")
	if len(genMods) != 1 {
		t.Fatalf("incoming mods=%d", len(genMods))
	}
}

// TestC2RanduinResilienceIncomingCritReduction closes Wiki item 3143 Resilience:
// target-hosted incoming_crit_part_post_mitigation ×0.70 (30% crit-part reduction).
func TestC2RanduinResilienceIncomingCritReduction(t *testing.T) {
	const (
		mult       = 2.0
		randuinMul = 0.70 // Wiki: incoming critical-strike damage reduced by 30%
	)
	mod := c2PipelineMod(
		"randuin_resilience",
		"damage",
		"all_damage",
		"incoming_crit_part_post_mitigation",
		"multiply",
		randuinMul,
		0,
	)

	t.Run("p1_settles_crit_part_to_70", func(t *testing.T) {
		// base 100, p=1, M=2 → adjusted 200; armor 100 → factor 0.5 → crit part 100; ×0.70 → 70.
		compileReq, runReq := loadCritEligibleDamageFixture(t, 1, mult, true)
		mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, "item:3143_randuin", "randuin_omen", mod)
		done := runCritFixture(t, compileReq, runReq)
		data := firstOriginalDamage(t, done)

		if math.Abs(evidenceDataFloat(data, "critPartPostResistance")-100) > 1e-9 {
			t.Fatalf("critPartPostResistance=%v want 100 (pre-incoming)", evidenceDataFloat(data, "critPartPostResistance"))
		}
		if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-70) > 1e-9 {
			t.Fatalf("mitigated=%v want 70", evidenceDataFloat(data, "mitigatedAmount"))
		}
		partMods := modifiersByStage(data, "incoming_crit_part_post_mitigation")
		if len(partMods) != 1 {
			t.Fatalf("crit-part mods=%d data=%+v", len(partMods), data["modifiers"])
		}
		m := partMods[0]
		if evidenceDataString(m, "stage") != "incoming_crit_part_post_mitigation" {
			t.Fatalf("stage=%q", evidenceDataString(m, "stage"))
		}
		channels, _ := m["matchedChannels"].([]string)
		if len(channels) == 0 {
			if raw, ok := m["matchedChannels"].([]interface{}); ok {
				for _, c := range raw {
					if s, ok := c.(string); ok {
						channels = append(channels, s)
					}
				}
			}
		}
		foundAll := false
		for _, c := range channels {
			if c == "all_damage" {
				foundAll = true
				break
			}
		}
		if !foundAll {
			t.Fatalf("matchedChannels=%v want all_damage", m["matchedChannels"])
		}
		if math.Abs(evidenceDataFloat(m, "value")-randuinMul) > 1e-12 {
			t.Fatalf("value=%v want %v (multiply policy)", evidenceDataFloat(m, "value"), randuinMul)
		}
		if math.Abs(evidenceDataFloat(m, "before")-100) > 1e-9 {
			t.Fatalf("before=%v want 100", evidenceDataFloat(m, "before"))
		}
		if math.Abs(evidenceDataFloat(m, "after")-70) > 1e-9 {
			t.Fatalf("after=%v want 70", evidenceDataFloat(m, "after"))
		}
		if evidenceDataString(m, "collectionHost") != model.SelectorTarget {
			t.Fatalf("collectionHost=%v want target", m["collectionHost"])
		}
		if evidenceDataString(m, "providerOwner") != model.SelectorTarget {
			t.Fatalf("providerOwner=%v want target", m["providerOwner"])
		}
	})

	t.Run("p0_non_crit_unchanged", func(t *testing.T) {
		compileReq, runReq := loadCritEligibleDamageFixture(t, 0, mult, true)
		mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, "item:3143_randuin", "randuin_omen", mod)
		done := runCritFixture(t, compileReq, runReq)
		data := firstOriginalDamage(t, done)
		want := expectedMitigatedPhysical(critBaseRaw, critArmor)
		if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-want) > 1e-9 {
			t.Fatalf("mitigated=%v want %v (non-crit control)", evidenceDataFloat(data, "mitigatedAmount"), want)
		}
		partMods := modifiersByStage(data, "incoming_crit_part_post_mitigation")
		if len(partMods) != 1 {
			t.Fatalf("expected crit-part apply on zero part, got %d", len(partMods))
		}
		if math.Abs(evidenceDataFloat(partMods[0], "after")) > 1e-12 {
			t.Fatalf("non-crit after must stay 0, after=%v", partMods[0]["after"])
		}
	})
}

func TestC2IncomingCritPartOverrideOnlyCrit(t *testing.T) {
	const (
		p    = 0.5
		mult = 2.0 // normal=50 crit=100 pre-resist; post-resist normal=25 crit=50
	)
	compileReq, runReq := loadCritEligibleDamageFixture(t, p, mult, true)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, "item:c2_ov", "c2_ov",
		c2PipelineMod("ov", "damage", "all_damage", "incoming_crit_part_post_mitigation", "override", 10, 0))
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	// merge after crit-part: 25+10=35
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-35) > 1e-9 {
		t.Fatalf("mitigated=%v want 35", evidenceDataFloat(data, "mitigatedAmount"))
	}
}

func TestC2ModifierConditionDamageTraitAndHostEvidence(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, 0.25, critIEMultiplier, true)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
	)
	compileReq.SharedProviders[0].Abilities[0].Operations[0].Types = []string{"damage_trait/on_hit"}
	mod := c2PipelineMod("gated", "crit", "all_damage", "crit_chance_pre_settlement", "override", 1, 0)
	mod.Condition = &model.GenericFormulaExpr{Op: "read", Path: "damage.trait.on_hit"}
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_gate", "c2_gate", mod)

	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-1) > 1e-12 {
		t.Fatalf("q=%v want 1 (trait condition true)", evidenceDataFloat(data, "chanceEffective"))
	}
	mods := modifiersByStage(data, "crit_chance_pre_settlement")
	if len(mods) != 1 {
		t.Fatalf("mods=%d", len(mods))
	}
	if evidenceDataString(mods[0], "collectionHost") != model.SelectorSource {
		t.Fatalf("collectionHost=%v", mods[0]["collectionHost"])
	}
	if evidenceDataString(mods[0], "providerOwner") != model.SelectorSource {
		t.Fatalf("providerOwner=%v", mods[0]["providerOwner"])
	}

	// Target-hosted crit-part condition on damage.type.physical.
	compileReq2, runReq2 := loadCritEligibleDamageFixture(t, 1, 2, true)
	part := c2PipelineMod("type_gate", "damage", "all_damage", "incoming_crit_part_post_mitigation", "multiply", 0.5, 0)
	part.Condition = &model.GenericFormulaExpr{Op: "read", Path: "damage.type.physical"}
	mountPipelineProvider(&compileReq2, &runReq2, model.SelectorTarget, "item:c2_tgt", "c2_tgt", part)
	done2 := runCritFixture(t, compileReq2, runReq2)
	data2 := firstOriginalDamage(t, done2)
	partMods := modifiersByStage(data2, "incoming_crit_part_post_mitigation")
	if len(partMods) != 1 {
		t.Fatalf("target part mods=%d", len(partMods))
	}
	if evidenceDataString(partMods[0], "collectionHost") != model.SelectorTarget {
		t.Fatalf("collectionHost=%v", partMods[0]["collectionHost"])
	}
	if evidenceDataString(partMods[0], "providerOwner") != model.SelectorTarget {
		t.Fatalf("providerOwner=%v", partMods[0]["providerOwner"])
	}
}

func TestC2DamageInstanceSnapshotImmutableThroughListener(t *testing.T) {
	const (
		p    = 0.25
		mult = 2.3
	)
	compileReq, runReq := loadCritEligibleDamageFixture(t, p, mult, true)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/c2_snap_probe", Domain: "event"},
		model.TypeCatalogEntry{Key: "damage_trait/ability", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
	)
	compileReq.SharedProviders[0].Abilities[0].Operations[0].Types = []string{"damage_trait/ability"}
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_ob2", "c2_ob2",
		c2PipelineMod("ob", "crit", "all_damage", "crit_chance_pre_settlement", "override", 1, 0))
	compileReq.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey:  "c2_read",
		EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "damage_trait/ability"}},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: c2Float(1)},
				Types:      []string{"damage_trait/on_hit"},
				Ref:        "op:child",
			},
			{
				Operation: "emit_event",
				Target:    "target",
				EventType: "event/c2_snap_probe",
				Ref:       "event/c2_snap_probe",
				Condition: &model.GenericFormulaExpr{
					Op: "eq",
					Args: []model.GenericFormulaExpr{
						{Op: "read", Path: "event.damage.originalCritChance"},
						{Op: "const", Value: c2Float(p)},
					},
				},
			},
		},
	}}
	done := runCritFixture(t, compileReq, runReq)
	evs := emittedEventsByRef(done, eventTypeDamageInstance)
	if len(evs) < 1 {
		t.Fatal("missing damage_instance")
	}
	dmg, ok := evs[0].Data["damage"].(map[string]interface{})
	if !ok {
		t.Fatalf("damage snapshot missing: %+v", evs[0].Data)
	}
	if math.Abs(evidenceDataFloat(dmg, "originalCritChance")-p) > 1e-12 {
		t.Fatalf("p=%v", evidenceDataFloat(dmg, "originalCritChance"))
	}
	if math.Abs(evidenceDataFloat(dmg, "effectiveCritChance")-1) > 1e-12 {
		t.Fatalf("q=%v", evidenceDataFloat(dmg, "effectiveCritChance"))
	}
	if math.Abs(evidenceDataFloat(dmg, "naturalCritWeight")-p) > 1e-12 {
		t.Fatalf("naturalWeight=%v", evidenceDataFloat(dmg, "naturalCritWeight"))
	}
	if math.Abs(evidenceDataFloat(dmg, "forcedCritWeight")-(1-p)) > 1e-12 {
		t.Fatalf("forcedWeight=%v", evidenceDataFloat(dmg, "forcedCritWeight"))
	}
	if math.Abs(evidenceDataFloat(dmg, "naturalCritMultiplier")-mult) > 1e-12 {
		t.Fatalf("M_natural=%v", evidenceDataFloat(dmg, "naturalCritMultiplier"))
	}
	wantNatural := critBaseRaw * mult // no outgoing
	if math.Abs(evidenceDataFloat(dmg, "naturalBranchRawAmount")-wantNatural) > 1e-9 {
		t.Fatalf("naturalBranch=%v want %v", evidenceDataFloat(dmg, "naturalBranchRawAmount"), wantNatural)
	}
	if len(emittedEventsByRef(done, "event/c2_snap_probe")) != 1 {
		t.Fatal("listener must still read immutable parent snapshot p")
	}
}

func TestC2CritPartMultiplyOnZeroStaysZero(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, 0, critIEMultiplier, true)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, "item:c2_zero", "c2_zero",
		c2PipelineMod("mul0", "damage", "all_damage", "incoming_crit_part_post_mitigation", "multiply", 0.5, 0))
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	want := expectedMitigatedPhysical(critBaseRaw, critArmor)
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-want) > 1e-9 {
		t.Fatalf("mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), want)
	}
	partMods := modifiersByStage(data, "incoming_crit_part_post_mitigation")
	if len(partMods) != 1 {
		t.Fatalf("expected crit-part apply on zero part, got %d", len(partMods))
	}
	if math.Abs(evidenceDataFloat(partMods[0], "after")) > 1e-12 {
		t.Fatalf("multiply on zero must stay 0, after=%v", partMods[0]["after"])
	}
}

func TestC2CompileRejectPathStillWired(t *testing.T) {
	// Sanity: invalid crit stage fails compile (collect-all), not silent drop.
	compileReq, runReq := loadBasicFixture(t)
	_ = runReq
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c2_bad", "c2_bad",
		c2PipelineMod("bad", "crit", "all_damage", "not_a_stage", "multiply", 1, 0))
	result := compile.CompileGeneric(compileReq)
	if result.OK {
		t.Fatal("expected compile failure")
	}
}
