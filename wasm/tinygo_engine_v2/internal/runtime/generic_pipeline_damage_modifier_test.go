package runtime

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// Pipeline damage-modifier contract:
// expected crit → outgoing_pre_mitigation → resistance → incoming_post_mitigation → shields/HP.
// basic_damage matches ability TypeSet containing ability/basic_attack only.

const (
	pipeMagProviderRef      = "item:magnification"
	pipeMagModifierKey      = "magnification_basic"
	pipeRockProviderRef     = "item:rock_solid"
	pipeRockModifierKey     = "rock_solid_first"
	pipeOrderLowKey         = "order_low"
	pipeOrderHighKey        = "order_high"
	pipeNonBasicAbility     = "spell_probe"
	pipeGiantSlayerProvider = "item:3036_lord_dominiks"
	pipeGiantSlayerModKey   = "giant_slayer"
)

func pipeFloat(v float64) *float64 { return &v }

func magnificationModifier(factor float64) model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: pipeMagModifierKey,
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "basic_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: pipeFloat(factor)},
	}
}

func rockSolidModifier() model.ModifierDefinition {
	// max(damage.amount - 15, damage.amount * 0.8)
	fifteen := 15.0
	pointEight := 0.8
	return model.ModifierDefinition{
		ModifierKey: pipeRockModifierKey,
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "basic_damage",
		Stage:       "incoming_post_mitigation",
		Bucket:      "first_per_cast",
		Priority:    0,
		ValuePolicy: "override",
		Value: model.GenericFormulaExpr{
			Op: "max",
			Args: []model.GenericFormulaExpr{
				{
					Op: "sub",
					Args: []model.GenericFormulaExpr{
						{Op: "read", Path: "damage.amount"},
						{Op: "const", Value: &fifteen},
					},
				},
				{
					Op: "mul",
					Args: []model.GenericFormulaExpr{
						{Op: "read", Path: "damage.amount"},
						{Op: "const", Value: &pointEight},
					},
				},
			},
		},
	}
}

func mountPipelineProvider(
	compileReq *model.CompileRequest,
	runReq *model.RunRequest,
	ownerKey, providerRef, stableID string,
	mod model.ModifierDefinition,
) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: providerRef,
		Kind:        "item",
		StableID:    stableID,
		Modifiers:   []model.ModifierDefinition{mod},
	})
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != ownerKey {
			continue
		}
		compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, model.CombatantProviderMount{
			ProviderRef: providerRef, DefinitionRef: providerRef,
		})
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != ownerKey {
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

func loadPipelineDamageFixture(t *testing.T, raw float64, armor float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation:  "damage",
		Target:     "target",
		DamageType: "damage/physical",
		Amount:     &model.GenericFormulaExpr{Op: "const", Value: pipeFloat(raw)},
		Ref:        "op:pipe_aa",
	}}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: armor, Current: armor, Max: armor, Resolved: armor,
	})
	runReq.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey:   "pipe_hit",
		AbilityRef: runReq.DriverPlan.Entries[0].AbilityRef,
		Source:     model.SelectorSource,
		Target:     model.SelectorTarget,
		FirstAtMs:  0,
	}}
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runPipelineFixture(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("RunGeneric err=%+v", err)
	}
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}
	return done
}

func damageEvidenceModifiers(data map[string]interface{}) []map[string]interface{} {
	raw, ok := data["modifiers"]
	if !ok || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case []map[string]interface{}:
		return v
	case []interface{}:
		out := make([]map[string]interface{}, 0, len(v))
		for _, item := range v {
			if m, ok := item.(map[string]interface{}); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func TestPipelineMagnificationOutgoingBasicAttack(t *testing.T) {
	// Source basic attack raw 100 * 1.10, zero armor → 110.
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, pipeMagProviderRef, "magnification", magnificationModifier(1.10))
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-110) > 1e-9 {
		t.Fatalf("rawAmount=%v want 110", evidenceDataFloat(data, "rawAmount"))
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-110) > 1e-9 {
		t.Fatalf("mitigated=%v want 110", evidenceDataFloat(data, "mitigatedAmount"))
	}
	if math.Abs(done.Summary.SourceDamageDealt-110) > 1e-9 {
		t.Fatalf("summary dealt=%v want 110", done.Summary.SourceDamageDealt)
	}
	mods := damageEvidenceModifiers(data)
	if len(mods) != 1 || mods[0]["modifierKey"] != pipeMagModifierKey {
		t.Fatalf("modifiers=%v", mods)
	}
	if mods[0]["stage"] != "outgoing_pre_mitigation" {
		t.Fatalf("stage=%v", mods[0]["stage"])
	}
	if math.Abs(evidenceDataFloat(mods[0], "before")-100) > 1e-9 || math.Abs(evidenceDataFloat(mods[0], "after")-110) > 1e-9 {
		t.Fatalf("before/after=%v/%v", mods[0]["before"], mods[0]["after"])
	}
}

func TestPipelineMagnificationSkipsNonBasicAbility(t *testing.T) {
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, pipeMagProviderRef, "magnification", magnificationModifier(1.10))
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = pipeNonBasicAbility
	compileReq.SharedProviders[0].Abilities[0].Types = []string{}
	runReq.DriverPlan.Entries[0].AbilityRef = "source.provider[champion:source_demo].ability[" + pipeNonBasicAbility + "]"
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-100) > 1e-9 {
		t.Fatalf("rawAmount=%v want 100 (non-basic unaffected)", evidenceDataFloat(data, "rawAmount"))
	}
	if len(damageEvidenceModifiers(data)) != 0 {
		t.Fatalf("expected no pipeline modifiers on non-basic ability")
	}
	if math.Abs(done.Summary.SourceDamageDealt-100) > 1e-9 {
		t.Fatalf("summary dealt=%v want 100", done.Summary.SourceDamageDealt)
	}
}

func TestPipelineRockSolidPostMitigation100To85(t *testing.T) {
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, pipeRockProviderRef, "rock_solid", rockSolidModifier())
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-100) > 1e-9 {
		t.Fatalf("rawAmount=%v want 100", evidenceDataFloat(data, "rawAmount"))
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-85) > 1e-9 {
		t.Fatalf("mitigated=%v want 85", evidenceDataFloat(data, "mitigatedAmount"))
	}
	if math.Abs(done.Summary.SourceDamageDealt-85) > 1e-9 {
		t.Fatalf("summary dealt=%v want 85", done.Summary.SourceDamageDealt)
	}
}

func TestPipelineRockSolidPostMitigation50To40(t *testing.T) {
	compileReq, runReq := loadPipelineDamageFixture(t, 50, 0)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, pipeRockProviderRef, "rock_solid", rockSolidModifier())
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-40) > 1e-9 {
		t.Fatalf("mitigated=%v want 40", evidenceDataFloat(data, "mitigatedAmount"))
	}
	if math.Abs(done.Summary.SourceDamageDealt-40) > 1e-9 {
		t.Fatalf("summary dealt=%v want 40", done.Summary.SourceDamageDealt)
	}
}

func TestPipelineRockSolidFirstPerCastTwoHitsThenNextCast(t *testing.T) {
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, pipeRockProviderRef, "rock_solid", rockSolidModifier())
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: pipeFloat(100)},
			Ref:        "op:pipe_aa_1",
		},
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: pipeFloat(100)},
			Ref:        "op:pipe_aa_2",
		},
	}
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalMs: 50, MaxAttempts: 2}
	runReq.StopPolicy.DurationMs = 200
	done := runPipelineFixture(t, compileReq, runReq)

	var originals []map[string]interface{}
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataBool(item.Data, "phantom") {
			continue
		}
		originals = append(originals, item.Data)
	}
	if len(originals) != 4 {
		t.Fatalf("damage evidence count=%d want 4 (2 casts × 2 ops)", len(originals))
	}
	if math.Abs(evidenceDataFloat(originals[0], "mitigatedAmount")-85) > 1e-9 {
		t.Fatalf("cast1 op1 mitigated=%v want 85", evidenceDataFloat(originals[0], "mitigatedAmount"))
	}
	if math.Abs(evidenceDataFloat(originals[1], "mitigatedAmount")-100) > 1e-9 {
		t.Fatalf("cast1 op2 mitigated=%v want 100", evidenceDataFloat(originals[1], "mitigatedAmount"))
	}
	if math.Abs(evidenceDataFloat(originals[2], "mitigatedAmount")-85) > 1e-9 {
		t.Fatalf("cast2 op1 mitigated=%v want 85", evidenceDataFloat(originals[2], "mitigatedAmount"))
	}
	if math.Abs(evidenceDataFloat(originals[3], "mitigatedAmount")-100) > 1e-9 {
		t.Fatalf("cast2 op2 mitigated=%v want 100", evidenceDataFloat(originals[3], "mitigatedAmount"))
	}
	wantTotal := 85.0 + 100.0 + 85.0 + 100.0
	if math.Abs(done.Summary.SourceDamageDealt-wantTotal) > 1e-9 {
		t.Fatalf("summary dealt=%v want %v", done.Summary.SourceDamageDealt, wantTotal)
	}
}

func TestPipelineOwnershipNotSwapped(t *testing.T) {
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorTarget, pipeMagProviderRef, "magnification", magnificationModifier(1.10))
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, pipeRockProviderRef, "rock_solid", rockSolidModifier())
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-100) > 1e-9 {
		t.Fatalf("rawAmount=%v want 100 (target-owned outgoing ignored)", evidenceDataFloat(data, "rawAmount"))
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-100) > 1e-9 {
		t.Fatalf("mitigated=%v want 100 (source-owned incoming ignored)", evidenceDataFloat(data, "mitigatedAmount"))
	}
	if len(damageEvidenceModifiers(data)) != 0 {
		t.Fatalf("expected no applied modifiers when ownership swapped: %v", damageEvidenceModifiers(data))
	}
}

func TestPipelineModifierDeterministicOrdering(t *testing.T) {
	// priority 1: *2.0 → 200; priority 5: *0.5 → 100. Insertion order is reversed on purpose.
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	low := model.ModifierDefinition{
		ModifierKey: pipeOrderLowKey,
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "basic_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    1,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: pipeFloat(2.0)},
	}
	high := model.ModifierDefinition{
		ModifierKey: pipeOrderHighKey,
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "basic_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    5,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: pipeFloat(0.5)},
	}
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:order_probe",
		Kind:        "item",
		StableID:    "order_probe",
		Modifiers:   []model.ModifierDefinition{high, low},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: "item:order_probe", DefinitionRef: "item:order_probe",
	})
	runReq.InitialSnapshot.Combatants[0].Providers = append(runReq.InitialSnapshot.Combatants[0].Providers,
		model.CombatantProviderSnapshot{ProviderRef: "item:order_probe", DefinitionRef: "item:order_probe", Stacks: 1},
	)
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	mods := damageEvidenceModifiers(data)
	if len(mods) != 2 {
		t.Fatalf("modifiers=%v want 2", mods)
	}
	if mods[0]["modifierKey"] != pipeOrderLowKey || mods[1]["modifierKey"] != pipeOrderHighKey {
		t.Fatalf("order keys=%v,%v want %s then %s", mods[0]["modifierKey"], mods[1]["modifierKey"], pipeOrderLowKey, pipeOrderHighKey)
	}
	if math.Abs(evidenceDataFloat(mods[0], "before")-100) > 1e-9 || math.Abs(evidenceDataFloat(mods[0], "after")-200) > 1e-9 {
		t.Fatalf("first step=%v", mods[0])
	}
	if math.Abs(evidenceDataFloat(mods[1], "before")-200) > 1e-9 || math.Abs(evidenceDataFloat(mods[1], "after")-100) > 1e-9 {
		t.Fatalf("second step=%v", mods[1])
	}
	if math.Abs(evidenceDataFloat(data, "rawAmount")-100) > 1e-9 {
		t.Fatalf("rawAmount=%v want 100", evidenceDataFloat(data, "rawAmount"))
	}
}

func TestPipelineUnsupportedModifierRejectedAtCompile(t *testing.T) {
	compileReq, _ := loadPipelineDamageFixture(t, 100, 0)
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:bad_pipe",
		Kind:        "item",
		StableID:    "bad_pipe",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "bad",
			Kind:        "pipeline",
			Command:     "shield",
			Channel:     "basic_damage",
			Stage:       "outgoing_pre_mitigation",
			Bucket:      "all_instances",
			ValuePolicy: "multiply",
			Value:       model.GenericFormulaExpr{Op: "const", Value: pipeFloat(1.1)},
		}},
	})
	result := compile.CompileGeneric(compileReq)
	if result.OK {
		t.Fatal("expected compile failure for unsupported pipeline command")
	}
	found := false
	for _, e := range result.Result.Errors {
		if e.Code == model.GenericErrUnknownRef && strings.Contains(e.Message, "unsupported pipeline modifier command") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("missing unsupported command error: %+v", result.Result.Errors)
	}
}

func TestPipelineNegativeModifierResultFailsClosed(t *testing.T) {
	// Supported outgoing multiply yielding a finite negative amount must be a
	// structured run error — not silent zero via MitigateRawDamage fail-closed.
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(
		&compileReq, &runReq, model.SelectorSource, pipeMagProviderRef, "magnification",
		magnificationModifier(-0.5),
	)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err == nil {
		t.Fatalf("expected negative pipeline modifier run error, got ok done summary=%+v", done.Summary)
	}
	if err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want %q", err.Code, model.GenericErrFormulaTypeError)
	}
	if !strings.Contains(err.Message, "negative pipeline modifier result") {
		t.Fatalf("message=%q want negative pipeline modifier result", err.Message)
	}
}

func TestPipelineZeroModifierResultRemainsValid(t *testing.T) {
	// Zero after multiply is valid (not an error); mitigation may yield zero dealt.
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(
		&compileReq, &runReq, model.SelectorSource, pipeMagProviderRef, "magnification",
		magnificationModifier(0),
	)
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "rawAmount")) > 1e-9 {
		t.Fatalf("rawAmount=%v want 0", evidenceDataFloat(data, "rawAmount"))
	}
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-9 {
		t.Fatalf("summary dealt=%v want 0", done.Summary.SourceDamageDealt)
	}
}

// giantSlayerModifier encodes Wiki item 3036 Giant Slayer passive only (no AD/crit/pen stats):
// 1 + min(0.15, 0.0001 * max(0, target.hp.max - target.hp.base)).
// Bonus health is proxied as max−base under the current 1v1 champion-source scope;
// this does not claim a non-champion filter or a dedicated target_bonus_health ABI field.
func giantSlayerModifier() model.ModifierDefinition {
	one := 1.0
	cap := 0.15
	perUnit := 0.0001
	zero := 0.0
	return model.ModifierDefinition{
		ModifierKey: pipeGiantSlayerModKey,
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value: model.GenericFormulaExpr{
			Op: "add",
			Args: []model.GenericFormulaExpr{
				{Op: "const", Value: &one},
				{
					Op: "min",
					Args: []model.GenericFormulaExpr{
						{Op: "const", Value: &cap},
						{
							Op: "mul",
							Args: []model.GenericFormulaExpr{
								{Op: "const", Value: &perUnit},
								{
									Op: "max",
									Args: []model.GenericFormulaExpr{
										{Op: "const", Value: &zero},
										{
											Op: "sub",
											Args: []model.GenericFormulaExpr{
												{Op: "read", Path: "target.attr.hp.max"},
												{Op: "read", Path: "target.attr.hp.base"},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

// TestPipelineGiantSlayerBonusHealthOutgoing1v1ChampionSource proves Wiki 3036 Giant Slayer
// passive damage amp in the CompileGeneric→RunGeneric lane under the current 1v1
// champion-source boundary, using max−base as the bonus-health proxy (not a dedicated ABI field).
// Cases: bonusHealth 0→100, 400→104 (ratio), 1500→115 and 2000→115 (cap). Passive only.
func TestPipelineGiantSlayerBonusHealthOutgoing1v1ChampionSource(t *testing.T) {
	const hpBase = 100000.0
	cases := []struct {
		name        string
		bonusHealth float64
		want        float64
	}{
		{"bonusHealth_0", 0, 100},
		{"bonusHealth_400", 400, 104},
		{"bonusHealth_1500", 1500, 115},
		{"bonusHealth_2000", 2000, 115},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
			hpMax := hpBase + tc.bonusHealth
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
				Base: hpBase, Current: hpMax, Max: hpMax, Resolved: hpMax,
			})
			mountPipelineProvider(
				&compileReq, &runReq, model.SelectorSource,
				pipeGiantSlayerProvider, "3036", giantSlayerModifier(),
			)
			done := runPipelineFixture(t, compileReq, runReq)
			data := firstOriginalDamage(t, done)
			if math.Abs(evidenceDataFloat(data, "rawAmount")-tc.want) > 1e-9 {
				t.Fatalf("rawAmount=%v want %v (bonusHealth=%v)", evidenceDataFloat(data, "rawAmount"), tc.want, tc.bonusHealth)
			}
			if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-tc.want) > 1e-9 {
				t.Fatalf("mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), tc.want)
			}
			if math.Abs(done.Summary.SourceDamageDealt-tc.want) > 1e-9 {
				t.Fatalf("summary dealt=%v want %v", done.Summary.SourceDamageDealt, tc.want)
			}
			mods := damageEvidenceModifiers(data)
			if len(mods) != 1 || mods[0]["modifierKey"] != pipeGiantSlayerModKey {
				t.Fatalf("modifiers=%v want exactly one %s", mods, pipeGiantSlayerModKey)
			}
			if mods[0]["stage"] != "outgoing_pre_mitigation" {
				t.Fatalf("stage=%v want outgoing_pre_mitigation", mods[0]["stage"])
			}
			if math.Abs(evidenceDataFloat(mods[0], "before")-100) > 1e-9 ||
				math.Abs(evidenceDataFloat(mods[0], "after")-tc.want) > 1e-9 {
				t.Fatalf("before/after=%v/%v want 100/%v", mods[0]["before"], mods[0]["after"], tc.want)
			}
		})
	}
}
