package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	critBaseRaw        = 100.0
	critIEChance       = 0.25
	critIEMultiplier   = 2.3
	critIEScalar       = 1.325 // 1 + 0.25*(2.3-1)
	critArmor          = 100.0
	critHitEvent       = "event/on_hit"
	critCopyableAmount = 40.0
)

func ensureCritTestTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: critHitEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
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

func critConst(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func setSourceCritAttrs(compileReq *model.CompileRequest, runReq *model.RunRequest, chance, multiplier float64) {
	setCombatantAttr(compileReq, runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: chance, Current: chance, Max: 1, Resolved: chance,
	})
	setCombatantAttr(compileReq, runReq, model.SelectorSource, "crit_damage", model.AttributeSlotDef{
		Base: multiplier, Current: multiplier, Max: multiplier, Resolved: multiplier,
	})
}

func loadCritEligibleDamageFixture(t *testing.T, chance, multiplier float64, eligible bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureCritTestTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation:    "damage",
		Target:       "target",
		DamageType:   "damage/physical",
		Amount:       critConst(critBaseRaw),
		CritEligible: eligible,
		Ref:          "op:crit_aa",
	}}
	setSourceCritAttrs(&compileReq, &runReq, chance, multiplier)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: critArmor, Current: critArmor, Max: critArmor, Resolved: critArmor,
	})
	runReq.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey:   "crit_hit",
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

func runCritFixture(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func wantExpectedCrit(base, chanceRaw, multRaw float64) (chanceEff, mult, normal, critPart, adjusted float64) {
	chanceEff = chanceRaw
	if chanceEff < 0 {
		chanceEff = 0
	}
	if chanceEff > 1 {
		chanceEff = 1
	}
	mult = multRaw
	if mult < 1 {
		mult = 1
	}
	normal = base * (1 - chanceEff)
	critPart = base * chanceEff * mult
	adjusted = normal + critPart
	return
}

func firstOriginalDamage(t *testing.T, done model.DoneResult) map[string]interface{} {
	t.Helper()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataBool(item.Data, "phantom") {
			continue
		}
		return item.Data
	}
	t.Fatal("missing original damage evidence")
	return nil
}

func TestGenericCritModifierChanceZero(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, 0, critIEMultiplier, true)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	_, _, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, 0, critIEMultiplier)
	assertCritEvidence(t, data, true, 0, 0, critIEMultiplier, critBaseRaw, normal, critPart, adjusted)
	wantMitigated := expectedMitigatedPhysical(adjusted, critArmor)
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-wantMitigated) > 1e-9 {
		t.Fatalf("mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), wantMitigated)
	}
	if math.Abs(done.Summary.SourceDamageDealt-wantMitigated) > 1e-9 {
		t.Fatalf("summary dealt=%v want %v", done.Summary.SourceDamageDealt, wantMitigated)
	}
}

func TestGenericCritModifierInfinityEdgeCanonical(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, critIEChance, critIEMultiplier, true)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	_, _, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, critIEChance, critIEMultiplier)
	if math.Abs(adjusted-critBaseRaw*critIEScalar) > 1e-9 {
		t.Fatalf("adjusted=%v want base*%v=%v", adjusted, critIEScalar, critBaseRaw*critIEScalar)
	}
	assertCritEvidence(t, data, true, critIEChance, critIEChance, critIEMultiplier, critBaseRaw, normal, critPart, adjusted)
	wantMitigated := expectedMitigatedPhysical(adjusted, critArmor)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-adjusted) > 1e-9 {
		t.Fatalf("rawAmount=%v want post-crit %v", evidenceDataFloat(data, "rawAmount"), adjusted)
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-wantMitigated) > 1e-9 {
		t.Fatalf("mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), wantMitigated)
	}
	if math.Abs(done.Summary.SourceDamageDealt-wantMitigated) > 1e-9 {
		t.Fatalf("summary dealt=%v want %v", done.Summary.SourceDamageDealt, wantMitigated)
	}
}

func TestGenericCritModifierChanceOne(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, 1, critIEMultiplier, true)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	_, _, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, 1, critIEMultiplier)
	if math.Abs(normal) > 1e-12 {
		t.Fatalf("normalPart=%v want 0", normal)
	}
	assertCritEvidence(t, data, true, 1, 1, critIEMultiplier, critBaseRaw, normal, critPart, adjusted)
}

func TestGenericCritModifierChanceClampBelowZero(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, -0.5, critIEMultiplier, true)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	chanceEff, mult, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, -0.5, critIEMultiplier)
	assertCritEvidence(t, data, true, -0.5, chanceEff, mult, critBaseRaw, normal, critPart, adjusted)
	if math.Abs(evidenceDataFloat(data, "chanceRaw")-(-0.5)) > 1e-12 {
		t.Fatalf("chanceRaw must record raw -0.5, got %v", evidenceDataFloat(data, "chanceRaw"))
	}
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-0) > 1e-12 {
		t.Fatalf("chanceEffective=%v want 0", evidenceDataFloat(data, "chanceEffective"))
	}
}

func TestGenericCritModifierChanceClampAboveOne(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, 1.5, critIEMultiplier, true)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	chanceEff, mult, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, 1.5, critIEMultiplier)
	assertCritEvidence(t, data, true, 1.5, chanceEff, mult, critBaseRaw, normal, critPart, adjusted)
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-1) > 1e-12 {
		t.Fatalf("chanceEffective=%v want 1", evidenceDataFloat(data, "chanceEffective"))
	}
}

func TestGenericCritModifierMultiplierFloor(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, 0.5, 0.5, true)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	_, mult, normal, critPart, adjusted := wantExpectedCrit(critBaseRaw, 0.5, 0.5)
	if math.Abs(mult-1) > 1e-12 {
		t.Fatalf("multiplier floor want 1 got %v", mult)
	}
	assertCritEvidence(t, data, true, 0.5, 0.5, 1, critBaseRaw, normal, critPart, adjusted)
}

func TestGenericCritModifierMissingCritChanceFails(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, critIEChance, critIEMultiplier, true)
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key == model.SelectorSource {
			delete(compileReq.Combatants[i].Attributes, "crit_chance")
		}
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorSource {
			delete(runReq.InitialSnapshot.Combatants[i].Attributes, "crit_chance")
		}
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, runReq)
	if err == nil {
		t.Fatal("expected missing crit_chance run error")
	}
	if err.Code != model.GenericErrMissingRequiredField {
		t.Fatalf("code=%q want missing_required_field", err.Code)
	}
}

func TestGenericCritModifierNonFiniteCritDamageFails(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, critIEChance, math.NaN(), true)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, runReq)
	if err == nil {
		t.Fatal("expected non-finite crit_damage run error")
	}
	if err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want formula_type_error", err.Code)
	}
}

func TestGenericCritModifierNonEligibleUnchanged(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, 1, critIEMultiplier, false)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if evidenceDataBool(data, "eligible") {
		t.Fatalf("non-eligible must not report eligible=true: %+v", data)
	}
	if _, ok := data["chanceRaw"]; ok {
		t.Fatalf("non-eligible must not fabricate chanceRaw: %+v", data)
	}
	if _, ok := data["critPart"]; ok {
		t.Fatalf("non-eligible must not fabricate critPart: %+v", data)
	}
	if math.Abs(evidenceDataFloat(data, "rawAmount")-critBaseRaw) > 1e-9 {
		t.Fatalf("rawAmount=%v want base %v", evidenceDataFloat(data, "rawAmount"), critBaseRaw)
	}
	wantMitigated := expectedMitigatedPhysical(critBaseRaw, critArmor)
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-wantMitigated) > 1e-9 {
		t.Fatalf("mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), wantMitigated)
	}
}

func TestGenericCritModifierBeforeArmorResistance(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, critIEChance, critIEMultiplier, true)
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	adjusted := critBaseRaw * critIEScalar
	wantMitigated := expectedMitigatedPhysical(adjusted, critArmor)
	// Pre-crit base through armor would be 50; post-crit 132.5 through armor is 66.25.
	preCritMitigated := expectedMitigatedPhysical(critBaseRaw, critArmor)
	if math.Abs(wantMitigated-preCritMitigated) < 1e-6 {
		t.Fatal("post-crit mitigated must differ from pre-crit mitigated")
	}
	if math.Abs(evidenceDataFloat(data, "rawAmount")-adjusted) > 1e-9 {
		t.Fatalf("rawAmount=%v want %v (post-crit before resistance)", evidenceDataFloat(data, "rawAmount"), adjusted)
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-wantMitigated) > 1e-9 {
		t.Fatalf("mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), wantMitigated)
	}
	if math.Abs(done.Summary.SourceDamageDealt-wantMitigated) > 1e-9 {
		t.Fatalf("summary=%v want %v", done.Summary.SourceDamageDealt, wantMitigated)
	}
}

func TestGenericCritModifierDeterministic(t *testing.T) {
	compileReq, runReq := loadCritEligibleDamageFixture(t, critIEChance, critIEMultiplier, true)
	done1 := runCritFixture(t, compileReq, runReq)
	done2 := runCritFixture(t, compileReq, runReq)
	d1 := firstOriginalDamage(t, done1)
	d2 := firstOriginalDamage(t, done2)
	keys := []string{"rawAmount", "mitigatedAmount", "chanceRaw", "chanceEffective", "multiplier", "baseRawAmount", "normalPart", "critPart", "critAdjustedRawAmount"}
	for _, k := range keys {
		if math.Abs(evidenceDataFloat(d1, k)-evidenceDataFloat(d2, k)) > 1e-12 {
			t.Fatalf("deterministic mismatch on %s: %v vs %v", k, evidenceDataFloat(d1, k), evidenceDataFloat(d2, k))
		}
	}
	if math.Abs(done1.Summary.SourceDamageDealt-done2.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("summary dealt mismatch %v vs %v", done1.Summary.SourceDamageDealt, done2.Summary.SourceDamageDealt)
	}
}

func TestGenericCritModifierEligibleCopyablePhantomFreezes(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureCritTestTypes(&compileReq)
	ensureGuinsooKTypes(&compileReq)

	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = guinsooHitAbility
	compileReq.SharedProviders[0].Abilities[0].Operations = guinsooKAAOps()
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "crit_copyable_on_hit",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Amount:        critConst(critCopyableAmount),
				CopyableOnHit: true,
				CritEligible:  true,
				Ref:           "op:crit_copyable",
			}},
		},
		guinsooKRepeatListener("guinsoo_phantom"),
	}

	setSourceCritAttrs(&compileReq, &runReq, critIEChance, critIEMultiplier)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: critArmor, Current: critArmor, Max: critArmor, Resolved: critArmor,
	})

	abilityRef := "source.provider[" + guinsooProviderRef + "].ability[" + guinsooHitAbility + "]"
	entries := make([]model.DriverEntry, 0, 4)
	for i := 0; i < 4; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "crit_k_hit_" + itoaRuntime(i),
			AbilityRef: abilityRef,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = 500
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000

	done := runCritFixture(t, compileReq, runReq)

	_, _, normal, critPart, adjusted := wantExpectedCrit(critCopyableAmount, critIEChance, critIEMultiplier)
	wantMitigated := expectedMitigatedPhysical(adjusted, critArmor)
	aaMitigated := expectedMitigatedPhysical(guinsooKAAAmt, critArmor)

	var originals, phantoms []map[string]interface{}
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != "op:crit_copyable" {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			phantoms = append(phantoms, item.Data)
		} else {
			originals = append(originals, item.Data)
		}
	}
	if len(originals) != 4 {
		t.Fatalf("original crit copyable count=%d want 4", len(originals))
	}
	if len(phantoms) != 1 {
		t.Fatalf("phantom count=%d want 1 (single frozen replay, no second settlement event)", len(phantoms))
	}

	orig := originals[3]
	assertCritEvidence(t, orig, true, critIEChance, critIEChance, critIEMultiplier, critCopyableAmount, normal, critPart, adjusted)
	if math.Abs(evidenceDataFloat(orig, "rawAmount")-adjusted) > 1e-9 {
		t.Fatalf("original rawAmount=%v want %v", evidenceDataFloat(orig, "rawAmount"), adjusted)
	}

	ph := phantoms[0]
	assertCritEvidence(t, ph, true, critIEChance, critIEChance, critIEMultiplier, critCopyableAmount, normal, critPart, adjusted)
	if !evidenceDataBool(ph, "phantom") || evidenceDataString(ph, "phase") != "phantom" {
		t.Fatalf("phantom flags: %+v", ph)
	}
	if math.Abs(evidenceDataFloat(ph, "rawAmount")-adjusted) > 1e-9 {
		t.Fatalf("phantom rawAmount=%v want frozen %v", evidenceDataFloat(ph, "rawAmount"), adjusted)
	}
	if math.Abs(evidenceDataFloat(ph, "mitigatedAmount")-wantMitigated) > 1e-9 {
		t.Fatalf("phantom mitigated=%v want %v", evidenceDataFloat(ph, "mitigatedAmount"), wantMitigated)
	}

	// Crit settlement itself adds no command budget; phantom still costs exactly one damage command.
	// 4 AA + 4 on-hit originals + 1 phantom = 9 damage evidence items.
	damageCount := done.Evidence.CountsByKind[string(model.EvidenceKindDamage)]
	if damageCount != 9 {
		t.Fatalf("damage evidence count=%d want 9 (no crit-specific budget/event)", damageCount)
	}
	wantTotal := aaMitigated*4 + wantMitigated*4 + wantMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantTotal) > 1e-6 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, wantTotal)
	}
}

func TestGenericCritModifierGuinsooOwnerAttributeRegression(t *testing.T) {
	compileReq, runReq := loadGuinsooHFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	as := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")
	if math.Abs(as-1.32) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want 1.32 (owner-side percent_add still applies)", as)
	}
	state := sourceProviderState(t, done.FinalSnapshot, guinsooProviderRef)["state"].(map[string]interface{})
	if stacks, _ := state[guinsooStackKey].(float64); stacks != 4 {
		t.Fatalf("stacks=%v want 4", stacks)
	}
}

func assertCritEvidence(
	t *testing.T,
	data map[string]interface{},
	eligible bool,
	chanceRaw, chanceEff, mult, base, normal, critPart, adjusted float64,
) {
	t.Helper()
	if evidenceDataString(data, "policy") != "expected" {
		t.Fatalf("policy=%q want expected", evidenceDataString(data, "policy"))
	}
	if evidenceDataBool(data, "eligible") != eligible {
		t.Fatalf("eligible=%v want %v", evidenceDataBool(data, "eligible"), eligible)
	}
	checks := []struct {
		key  string
		want float64
	}{
		{"chanceRaw", chanceRaw},
		{"chanceEffective", chanceEff},
		{"multiplier", mult},
		{"baseRawAmount", base},
		{"normalPart", normal},
		{"critPart", critPart},
		{"critAdjustedRawAmount", adjusted},
		{"rawAmount", adjusted},
	}
	for _, c := range checks {
		got := evidenceDataFloat(data, c.key)
		if math.Abs(got-c.want) > 1e-9 {
			t.Fatalf("%s=%v want %v data=%+v", c.key, got, c.want, data)
		}
	}
}
