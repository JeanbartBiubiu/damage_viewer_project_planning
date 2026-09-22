package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_ashe Q Ranger's Focus / 射手的专注 (generic ABI, rank-5 partial core)
// + P Frost Shot / 冰霜射击 expectation-only normal basic-attack Phase-A.
//
// Data-owned modelling (Meraki 2026-07-14 / Frost Shot expected-crit Phase-A):
//   - Inactive: basic attacks arm Focus slots (max 4); refresh window; expire
//     one-by-one at +4000/+5000/+6000/+7000 ms via timed provider state slots.
//   - Q castCondition requires 4 Focus; costs 30 mana; clears Focus; arms
//     Flurry 6000 ms + flurry_first; rank-5 +75% AS via
//     0.75 * provider.state.flurry_active (not modifier.Condition).
//   - Flurry first AA: 6×28% total AD; subsequent: 5×28%; one basic_attack_hit
//     per flurry AA (on-hit once). Flurry arrow ops stay CritEligible=false
//     (separate partial Q boundary; not P damage integration).
//   - P Phase-A (expectation only): flurry_inactive normal AA deals
//     total AD × (1 + clamped_crit_chance × (total_crit_multiplier − 1))
//     via CritEligible settleExpectedCrit on ability/basic_attack; not full
//     Frost Shot fidelity.
//
// Non-goals: attack-timer reset scheduling, arrow travel, Frost Shot slow /
// critical slow / duration decay, RNG or on-crit sequencing, Q Flurry damage
// integration with P, item-specific interactions (Randuin / Runaan / Cheap Shot),
// life steal, buildings/multitarget, ability rotation/cadence, other abilities
// or ranks, full Frost Shot fidelity.

const (
	asheProviderRef     = "hero:ashe"
	asheStableID        = "hero_ashe"
	asheQKey            = "rangers_focus"
	asheAAKey           = "basic_attack"
	asheProbeKey        = "ashe_probe"
	asheFocus1Key       = "focus_1"
	asheFocus2Key       = "focus_2"
	asheFocus3Key       = "focus_3"
	asheFocus4Key       = "focus_4"
	asheFocusSnapKey    = "focus_snapshot"
	asheFlurryActiveKey = "flurry_active"
	asheFlurryFirstKey  = "flurry_first"
	asheASModKey        = "rangers_focus_attack_speed"
	asheArrowOpRef      = "op:ashe_flurry_arrow"
	asheNormalAAOpRef   = "op:ashe_aa"
	asheHitEvent        = "event/basic_attack_hit"
	asheCastEvent       = "event/ability_started"

	asheFocusDur1     = 4000
	asheFocusDur2     = 5000
	asheFocusDur3     = 6000
	asheFocusDur4     = 7000
	asheFlurryDur     = 6000
	asheQManaCost     = 30.0
	asheFlurryASBonus = 0.75
	asheArrowRatio    = 0.28
	asheFirstArrows   = 6
	asheNextArrows    = 5

	asheLevel1HP          = 640.0
	asheLevel1Mana        = 280.0
	asheLevel1AD          = 59.0
	asheLevel1AS          = 0.658
	asheLevel1Armor       = 26.0
	asheLevel1MR          = 30.0
	asheTotalAD           = 100.0
	asheTargetArmor       = 0.0
	asheCritChanceDefault = 0.0
	asheCritDamageDefault = 2.0
)

func asheFocusKeys() []string {
	return []string{asheFocus1Key, asheFocus2Key, asheFocus3Key, asheFocus4Key}
}

func asheTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func asheStateSchema() map[string]interface{} {
	return map[string]interface{}{
		asheFocus1Key: asheTimedSlot(0, 1, float64(asheFocusDur1)),
		asheFocus2Key: asheTimedSlot(0, 1, float64(asheFocusDur2)),
		asheFocus3Key: asheTimedSlot(0, 1, float64(asheFocusDur3)),
		asheFocus4Key: asheTimedSlot(0, 1, float64(asheFocusDur4)),
		asheFocusSnapKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(4),
			"durationMs":   float64(0),
		},
		asheFlurryActiveKey: asheTimedSlot(0, 1, float64(asheFlurryDur)),
		asheFlurryFirstKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(1),
			"durationMs":   float64(0),
		},
	}
}

func asheFocusSumExpr() model.GenericFormulaExpr {
	return model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "provider.state." + asheFocus1Key},
					{Op: "read", Path: "provider.state." + asheFocus2Key},
				},
			},
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "provider.state." + asheFocus3Key},
					{Op: "read", Path: "provider.state." + asheFocus4Key},
				},
			},
		},
	}
}

func asheQCastCondition() *model.GenericFormulaExpr {
	four := 4.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			asheFocusSumExpr(),
			{Op: "const", Value: &four},
		},
	}
}

func asheEqState(key string, want float64) model.GenericFormulaExpr {
	v := want
	return model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + key},
			{Op: "const", Value: &v},
		},
	}
}

func asheGteState(key string, want float64) model.GenericFormulaExpr {
	v := want
	return model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + key},
			{Op: "const", Value: &v},
		},
	}
}

func asheAnd2(a, b model.GenericFormulaExpr) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{a, b}}
}

func asheSnapEq(n float64) model.GenericFormulaExpr {
	return asheEqState(asheFocusSnapKey, n)
}

func asheSnapGte(n float64) model.GenericFormulaExpr {
	return asheGteState(asheFocusSnapKey, n)
}

func asheStateOverride(ref string, value float64, cond *model.GenericFormulaExpr) model.OperationDefinition {
	v := value
	return model.OperationDefinition{
		Operation:   "state_change",
		Target:      "source",
		Ref:         ref,
		Types:       []string{"state_scope/provider"},
		ValuePolicy: "override",
		Amount:      &model.GenericFormulaExpr{Op: "const", Value: &v},
		Condition:   cond,
	}
}

func asheArrowAmount() *model.GenericFormulaExpr {
	ratio := asheArrowRatio
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &ratio},
			{Op: "read", Path: "source.attr.ad.resolved"},
		},
	}
}

func asheFlurryArrowOps(count int, cond *model.GenericFormulaExpr) []model.OperationDefinition {
	ops := make([]model.OperationDefinition, 0, count)
	for i := 0; i < count; i++ {
		ops = append(ops, model.OperationDefinition{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Ref:        asheArrowOpRef,
			Amount:     asheArrowAmount(),
			Condition:  cond,
		})
	}
	return ops
}

func asheFocusBuildOps() []model.OperationDefinition {
	inactive := asheEqState(asheFlurryActiveKey, 0)
	// Snapshot Focus sum once so later slot writes do not invalidate branch conditions.
	snap := asheFocusSumExpr()
	c0 := asheAnd2(inactive, asheSnapEq(0))
	c1 := asheAnd2(inactive, asheSnapEq(1))
	c2 := asheAnd2(inactive, asheSnapEq(2))
	c3 := asheAnd2(inactive, asheSnapGte(3))
	ops := []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         asheFocusSnapKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &snap,
			Condition:   &inactive,
		},
	}
	// snapshot 0 → slot1; 1 → 1-2; 2 → 1-3; ≥3 → all four (cap/refresh).
	ops = append(ops, asheStateOverride(asheFocus1Key, 1, c0))
	ops = append(ops, asheStateOverride(asheFocus2Key, 0, c0))
	ops = append(ops, asheStateOverride(asheFocus3Key, 0, c0))
	ops = append(ops, asheStateOverride(asheFocus4Key, 0, c0))

	ops = append(ops, asheStateOverride(asheFocus1Key, 1, c1))
	ops = append(ops, asheStateOverride(asheFocus2Key, 1, c1))
	ops = append(ops, asheStateOverride(asheFocus3Key, 0, c1))
	ops = append(ops, asheStateOverride(asheFocus4Key, 0, c1))

	ops = append(ops, asheStateOverride(asheFocus1Key, 1, c2))
	ops = append(ops, asheStateOverride(asheFocus2Key, 1, c2))
	ops = append(ops, asheStateOverride(asheFocus3Key, 1, c2))
	ops = append(ops, asheStateOverride(asheFocus4Key, 0, c2))

	ops = append(ops, asheStateOverride(asheFocus1Key, 1, c3))
	ops = append(ops, asheStateOverride(asheFocus2Key, 1, c3))
	ops = append(ops, asheStateOverride(asheFocus3Key, 1, c3))
	ops = append(ops, asheStateOverride(asheFocus4Key, 1, c3))
	return ops
}

func asheAAOps() []model.OperationDefinition {
	inactive := asheEqState(asheFlurryActiveKey, 0)
	firstFlurry := asheAnd2(asheGteState(asheFlurryActiveKey, 1), asheGteState(asheFlurryFirstKey, 1))
	nextFlurry := asheAnd2(asheGteState(asheFlurryActiveKey, 1), asheEqState(asheFlurryFirstKey, 0))

	ops := []model.OperationDefinition{
		{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Ref:          asheNormalAAOpRef,
			Amount:       &model.GenericFormulaExpr{Op: "read", Path: "source.attr.ad.resolved"},
			CritEligible: true,
			Condition:    &inactive,
		},
	}
	ops = append(ops, asheFocusBuildOps()...)
	// First-flurry arrows while flurry_first is still armed; next-flurry arrows only
	// when first was already cleared by a prior AA. Clear flurry_first last so the
	// five-arrow branch cannot fire in the same cast as the six-arrow branch.
	ops = append(ops, asheFlurryArrowOps(asheFirstArrows, firstFlurry)...)
	ops = append(ops, asheFlurryArrowOps(asheNextArrows, nextFlurry)...)
	ops = append(ops, asheStateOverride(asheFlurryFirstKey, 0, firstFlurry))
	ops = append(ops, model.OperationDefinition{
		Operation: "emit_event",
		Target:    "target",
		EventType: asheHitEvent,
		Ref:       asheHitEvent,
	})
	return ops
}

func asheQOps() []model.OperationDefinition {
	return []model.OperationDefinition{
		asheStateOverride(asheFocus1Key, 0, nil),
		asheStateOverride(asheFocus2Key, 0, nil),
		asheStateOverride(asheFocus3Key, 0, nil),
		asheStateOverride(asheFocus4Key, 0, nil),
		asheStateOverride(asheFocusSnapKey, 0, nil),
		asheStateOverride(asheFlurryActiveKey, 1, nil),
		asheStateOverride(asheFlurryFirstKey, 1, nil),
	}
}

func asheASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: asheASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(asheFlurryASBonus),
				{Op: "read", Path: "provider.state." + asheFlurryActiveKey},
			},
		},
	}
}

func asheQAbility() model.AbilityDefinition {
	cost := asheQManaCost
	return model.AbilityDefinition{
		AbilityKey:    asheQKey,
		Kind:          "active",
		Types:         []string{},
		CastCondition: asheQCastCondition(),
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Operations: asheQOps(),
	}
}

func asheAAAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: asheAAKey,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: asheAAOps(),
	}
}

func asheProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: asheProbeKey,
		Kind:       "active",
		Types:      []string{},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
				Ref:        "op:ashe_probe",
			},
		},
	}
}

func ensureAsheTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: asheCastEvent, Domain: "event"},
		{Key: asheHitEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "state_scope/provider", Domain: "state_scope"},
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

func configureAsheProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        asheProviderRef,
		Kind:               "champion",
		StableID:           asheStableID,
		InitialStateSchema: asheStateSchema(),
		Modifiers:          []model.ModifierDefinition{asheASModifier()},
		Abilities: []model.AbilityDefinition{
			asheQAbility(),
			asheAAAbility(),
			asheProbeAbility(),
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: asheProviderRef, DefinitionRef: asheProviderRef},
	}
	bonusAD := asheTotalAD - asheLevel1AD
	compileReq.SharedProviders[0].Modifiers = append(compileReq.SharedProviders[0].Modifiers, model.ModifierDefinition{
		ModifierKey: "fixture_ashe_bonus_ad",
		Kind:        "attribute",
		Target:      "ad",
		ValuePolicy: "add",
		Value:       gfConst(bonusAD),
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: asheProviderRef, DefinitionRef: asheProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func asheQRef() string {
	return "source.provider[" + asheProviderRef + "].ability[" + asheQKey + "]"
}

func asheAARef() string {
	return "source.provider[" + asheProviderRef + "].ability[" + asheAAKey + "]"
}

func asheProbeRef() string {
	return "source.provider[" + asheProviderRef + "].ability[" + asheProbeKey + "]"
}

func loadAsheRangersFocusFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureAsheTypes(&compileReq)
	configureAsheProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: asheLevel1HP, Current: asheLevel1HP, Max: asheLevel1HP, Resolved: asheLevel1HP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: asheLevel1AD, Current: asheLevel1AD, Max: asheLevel1AD, Resolved: asheLevel1AD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: asheLevel1AS, Current: asheLevel1AS, Max: asheLevel1AS, Resolved: asheLevel1AS,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor", model.AttributeSlotDef{
		Base: asheLevel1Armor, Current: asheLevel1Armor, Max: asheLevel1Armor, Resolved: asheLevel1Armor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_resist", model.AttributeSlotDef{
		Base: asheLevel1MR, Current: asheLevel1MR, Max: asheLevel1MR, Resolved: asheLevel1MR,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: asheCritChanceDefault, Current: asheCritChanceDefault, Max: 1, Resolved: asheCritChanceDefault,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_damage", model.AttributeSlotDef{
		Base: asheCritDamageDefault, Current: asheCritDamageDefault, Max: asheCritDamageDefault, Resolved: asheCritDamageDefault,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: asheLevel1Mana, Max: asheLevel1Mana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: asheTargetArmor, Current: asheTargetArmor, Max: asheTargetArmor, Resolved: asheTargetArmor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runAsheRangersFocus(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func asheStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, asheProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		return 0
	}
	v, _ := state[key].(float64)
	return v
}

func asheFocusSum(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	var sum float64
	for _, k := range asheFocusKeys() {
		sum += asheStateValue(t, done, k)
	}
	return sum
}

func asheSourceMana(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Resources["mana"]
		if !ok {
			t.Fatal("source mana missing")
		}
		return slot.Current
	}
	t.Fatal("source missing")
	return 0
}

func asheSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func asheAAEntries(n int, startMs, stepMs int64) []model.DriverEntry {
	out := make([]model.DriverEntry, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, model.DriverEntry{
			EntryKey:   "aa" + itoaAshe(i),
			AbilityRef: asheAARef(),
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  startMs + int64(i)*stepMs,
		})
	}
	return out
}

func itoaAshe(i int) string {
	if i == 0 {
		return "0"
	}
	var b [16]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(b[pos:])
}

func asheExpectedFirstFlurryRaw() float64 {
	return float64(asheFirstArrows) * asheArrowRatio * asheTotalAD
}

func asheExpectedNextFlurryRaw() float64 {
	return float64(asheNextArrows) * asheArrowRatio * asheTotalAD
}

// TestAsheRangersFocusCastConditionFalseSkipsManaAndFlurry:
// fewer than 4 Focus → condition_false; no mana spend; Flurry stays off.
func TestAsheRangersFocusCastConditionFalseSkipsManaAndFlurry(t *testing.T) {
	compileReq, runReq := loadAsheRangersFocusFixture(t)
	runReq.DriverPlan.Entries = append(asheAAEntries(3, 0, 0), model.DriverEntry{
		EntryKey: "q", AbilityRef: asheQRef(), Source: "source", Target: "target", FirstAtMs: 10,
	})
	runReq.StopPolicy.DurationMs = 50
	done := runAsheRangersFocus(t, compileReq, runReq)

	if asheFocusSum(t, done) != 3 {
		t.Fatalf("focus sum=%v want 3", asheFocusSum(t, done))
	}
	if asheSkipReasonCount(done, model.AttemptSkipConditionFalse) < 1 {
		t.Fatal("expected condition_false skip for Q under 4 Focus")
	}
	if countEmittedEvents(done, asheCastEvent) != 0 {
		t.Fatalf("ability_started=%d want 0", countEmittedEvents(done, asheCastEvent))
	}
	if got := asheSourceMana(t, done.FinalSnapshot); math.Abs(got-asheLevel1Mana) > 1e-9 {
		t.Fatalf("mana=%v want %v (no spend)", got, asheLevel1Mana)
	}
	if got := asheStateValue(t, done, asheFlurryActiveKey); got != 0 {
		t.Fatalf("flurry_active=%v want 0", got)
	}
	if done.Summary.AbilityCastCount != 3 {
		t.Fatalf("abilityCastCount=%d want 3 (AAs only)", done.Summary.AbilityCastCount)
	}
}

// TestAsheRangersFocusStacksAndStaggeredExpire: 4 AAs → 4 slots; after refresh
// at t=0 they expire one-by-one at 4000/5000/6000/7000.
func TestAsheRangersFocusStacksAndStaggeredExpire(t *testing.T) {
	// Build four stacks with same-time AAs so the final refresh is at t=0.
	// Probe at the check time forces lazy-expire before the final snapshot.
	for _, tc := range []struct {
		stopMs int64
		want   float64
	}{
		{3999, 4},
		{4000, 3},
		{5000, 2},
		{6000, 1},
		{7000, 0},
	} {
		t.Run(itoaAshe(int(tc.stopMs)), func(t *testing.T) {
			compileReq, runReq := loadAsheRangersFocusFixture(t)
			runReq.DriverPlan.Entries = append(asheAAEntries(4, 0, 0), model.DriverEntry{
				EntryKey: "probe", AbilityRef: asheProbeRef(), Source: "source", Target: "target", FirstAtMs: tc.stopMs,
			})
			runReq.StopPolicy.DurationMs = tc.stopMs + 1
			done := runAsheRangersFocus(t, compileReq, runReq)
			if got := asheFocusSum(t, done); got != tc.want {
				t.Fatalf("at %dms focus sum=%v want %v (slots=%v/%v/%v/%v)",
					tc.stopMs, got, tc.want,
					asheStateValue(t, done, asheFocus1Key),
					asheStateValue(t, done, asheFocus2Key),
					asheStateValue(t, done, asheFocus3Key),
					asheStateValue(t, done, asheFocus4Key),
				)
			}
		})
	}
}

// TestAsheRangersFocusQSpendsManaClearsFocusArmsFlurry.
func TestAsheRangersFocusQSpendsManaClearsFocusArmsFlurry(t *testing.T) {
	compileReq, runReq := loadAsheRangersFocusFixture(t)
	runReq.DriverPlan.Entries = append(asheAAEntries(4, 0, 0), model.DriverEntry{
		EntryKey: "q", AbilityRef: asheQRef(), Source: "source", Target: "target", FirstAtMs: 1,
	})
	runReq.StopPolicy.DurationMs = 50
	done := runAsheRangersFocus(t, compileReq, runReq)

	if countEmittedEvents(done, asheCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, asheCastEvent))
	}
	if got := asheSourceMana(t, done.FinalSnapshot); math.Abs(got-(asheLevel1Mana-asheQManaCost)) > 1e-9 {
		t.Fatalf("mana=%v want %v", got, asheLevel1Mana-asheQManaCost)
	}
	if got := asheFocusSum(t, done); got != 0 {
		t.Fatalf("focus sum=%v want 0 after Q", got)
	}
	if got := asheStateValue(t, done, asheFlurryActiveKey); got != 1 {
		t.Fatalf("flurry_active=%v want 1", got)
	}
	if got := asheStateValue(t, done, asheFlurryFirstKey); got != 1 {
		t.Fatalf("flurry_first=%v want 1", got)
	}
}

// TestAsheRangersFocusFlurryAttackSpeedModifier: +75% while Flurry active; baseline after expiry.
func TestAsheRangersFocusFlurryAttackSpeedModifier(t *testing.T) {
	compileReq, runReq := loadAsheRangersFocusFixture(t)
	runReq.DriverPlan.Entries = append(asheAAEntries(4, 0, 0),
		model.DriverEntry{EntryKey: "q", AbilityRef: asheQRef(), Source: "source", Target: "target", FirstAtMs: 1},
		model.DriverEntry{EntryKey: "probe_active", AbilityRef: asheProbeRef(), Source: "source", Target: "target", FirstAtMs: 100},
		model.DriverEntry{EntryKey: "probe_expired", AbilityRef: asheProbeRef(), Source: "source", Target: "target", FirstAtMs: 6001},
	)
	runReq.StopPolicy.DurationMs = 6100
	done := runAsheRangersFocus(t, compileReq, runReq)

	wantActive := asheLevel1AS * (1 + asheFlurryASBonus)
	// After Flurry expiry, probe at 6001 lazy-expires and restores baseline AS.
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-asheLevel1AS) > 1e-9 {
		t.Fatalf("attack_speed after expiry=%v want baseline %v", got, asheLevel1AS)
	}
	if got := asheStateValue(t, done, asheFlurryActiveKey); got != 0 {
		t.Fatalf("flurry_active after expiry=%v want 0", got)
	}

	// Separate short run while Flurry is active.
	c2, r2 := loadAsheRangersFocusFixture(t)
	r2.DriverPlan.Entries = append(asheAAEntries(4, 0, 0),
		model.DriverEntry{EntryKey: "q", AbilityRef: asheQRef(), Source: "source", Target: "target", FirstAtMs: 1},
		model.DriverEntry{EntryKey: "probe", AbilityRef: asheProbeRef(), Source: "source", Target: "target", FirstAtMs: 100},
	)
	r2.StopPolicy.DurationMs = 200
	doneActive := runAsheRangersFocus(t, c2, r2)
	if got := sourceAttrResolved(t, doneActive.FinalSnapshot, "attack_speed"); math.Abs(got-wantActive) > 1e-9 {
		t.Fatalf("attack_speed while Flurry=%v want %v", got, wantActive)
	}
}

// TestAsheRangersFocusFlurryArrowCountsAndSingleOnHit: first 6×28%AD, next 5×28%AD; one hit event each.
func TestAsheRangersFocusFlurryArrowCountsAndSingleOnHit(t *testing.T) {
	if math.Abs(asheExpectedFirstFlurryRaw()-168) > 1e-9 {
		t.Fatalf("first raw total=%v want 168", asheExpectedFirstFlurryRaw())
	}
	if math.Abs(asheExpectedNextFlurryRaw()-140) > 1e-9 {
		t.Fatalf("next raw total=%v want 140", asheExpectedNextFlurryRaw())
	}

	compileReq, runReq := loadAsheRangersFocusFixture(t)
	runReq.DriverPlan.Entries = append(asheAAEntries(4, 0, 0),
		model.DriverEntry{EntryKey: "q", AbilityRef: asheQRef(), Source: "source", Target: "target", FirstAtMs: 1},
		model.DriverEntry{EntryKey: "flurry1", AbilityRef: asheAARef(), Source: "source", Target: "target", FirstAtMs: 10},
		model.DriverEntry{EntryKey: "flurry2", AbilityRef: asheAARef(), Source: "source", Target: "target", FirstAtMs: 20},
	)
	runReq.StopPolicy.DurationMs = 50
	done := runAsheRangersFocus(t, compileReq, runReq)

	if got := countDamageByOpRef(done, asheArrowOpRef, false); got != asheFirstArrows+asheNextArrows {
		t.Fatalf("arrow ops=%d want %d", got, asheFirstArrows+asheNextArrows)
	}
	if got := sumDamageRawByOpRef(done, asheArrowOpRef); math.Abs(got-(asheExpectedFirstFlurryRaw()+asheExpectedNextFlurryRaw())) > 1e-6 {
		t.Fatalf("arrow raw sum=%v want %v", got, asheExpectedFirstFlurryRaw()+asheExpectedNextFlurryRaw())
	}
	// Two flurry AAs → exactly two basic_attack_hit events (on-hit once each).
	// Plus no extra from Q. Pre-Q stack AAs also emit hits (4).
	if got := countEmittedEvents(done, asheHitEvent); got != 6 {
		t.Fatalf("basic_attack_hit=%d want 6 (4 stack + 2 flurry)", got)
	}
	if got := asheStateValue(t, done, asheFlurryFirstKey); got != 0 {
		t.Fatalf("flurry_first after first flurry AA=%v want 0", got)
	}
}

// TestAsheRangersFocusOnlyNormalAttacksBuildFocus: Q/Flurry must not rebuild Focus.
func TestAsheRangersFocusOnlyNormalAttacksBuildFocus(t *testing.T) {
	compileReq, runReq := loadAsheRangersFocusFixture(t)
	runReq.DriverPlan.Entries = append(asheAAEntries(4, 0, 0),
		model.DriverEntry{EntryKey: "q", AbilityRef: asheQRef(), Source: "source", Target: "target", FirstAtMs: 1},
		model.DriverEntry{EntryKey: "flurry1", AbilityRef: asheAARef(), Source: "source", Target: "target", FirstAtMs: 10},
		model.DriverEntry{EntryKey: "flurry2", AbilityRef: asheAARef(), Source: "source", Target: "target", FirstAtMs: 20},
	)
	runReq.StopPolicy.DurationMs = 50
	done := runAsheRangersFocus(t, compileReq, runReq)
	if got := asheFocusSum(t, done); got != 0 {
		t.Fatalf("focus after Q+Flurry AAs=%v want 0 (Flurry must not rebuild)", got)
	}
}

// TestAsheRangersFocusCastConditionIsolatedNormalAbilityUnchanged:
// castCondition is provider-state scoped; abilities without it still cast.
func TestAsheRangersFocusCastConditionIsolatedNormalAbilityUnchanged(t *testing.T) {
	compileReq, runReq := loadAsheRangersFocusFixture(t)
	// No Focus stacks: Q blocked by castCondition; probe (no castCondition) still casts.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q", AbilityRef: asheQRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe", AbilityRef: asheProbeRef(), Source: "source", Target: "target", FirstAtMs: 1},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runAsheRangersFocus(t, compileReq, runReq)

	if asheSkipReasonCount(done, model.AttemptSkipConditionFalse) < 1 {
		t.Fatal("expected Q castCondition false")
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (probe only; Q blocked)", done.Summary.AbilityCastCount)
	}
	if countDamageByOpRef(done, "op:ashe_probe", false) != 1 {
		t.Fatalf("probe damage=%d want 1", countDamageByOpRef(done, "op:ashe_probe", false))
	}
	if got := asheSourceMana(t, done.FinalSnapshot); math.Abs(got-asheLevel1Mana) > 1e-9 {
		t.Fatalf("mana=%v want unchanged %v", got, asheLevel1Mana)
	}
	if got := asheStateValue(t, done, asheFlurryActiveKey); got != 0 {
		t.Fatalf("flurry_active=%v want 0", got)
	}
}

func asheFrostShotFirstNormalDamage(t *testing.T, done model.DoneResult) map[string]interface{} {
	t.Helper()
	var found map[string]interface{}
	n := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != asheNormalAAOpRef {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			t.Fatalf("unexpected phantom damage for %s", asheNormalAAOpRef)
		}
		n++
		found = item.Data
	}
	if n != 1 {
		t.Fatalf("normal AA damage evidence=%d want 1", n)
	}
	return found
}

func assertAsheFrostShotCompileShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) < 1 {
		t.Fatal("SharedProviders empty")
	}
	asheCount := 0
	var p model.ProviderDefinition
	for _, sp := range compileReq.SharedProviders {
		if sp.ProviderKey == asheProviderRef {
			asheCount++
			p = sp
		}
	}
	if asheCount != 1 {
		t.Fatalf("mounted Ashe shared providers=%d want 1", asheCount)
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no new Frost Shot listener)", len(p.Listeners))
	}
	if len(p.Abilities) != 3 {
		t.Fatalf("abilities=%d want 3 (Q + basic_attack + probe)", len(p.Abilities))
	}
	var aa *model.AbilityDefinition
	keys := map[string]bool{}
	for i := range p.Abilities {
		ab := &p.Abilities[i]
		keys[ab.AbilityKey] = true
		if ab.AbilityKey == asheAAKey {
			aa = ab
		}
	}
	if !keys[asheQKey] || !keys[asheAAKey] || !keys[asheProbeKey] {
		t.Fatalf("ability keys=%v want %s/%s/%s", keys, asheQKey, asheAAKey, asheProbeKey)
	}
	if aa == nil || len(aa.Types) != 1 || aa.Types[0] != "ability/basic_attack" {
		t.Fatalf("basic_attack types=%v want [ability/basic_attack]", aa.Types)
	}
	var normalCrit, arrowNoCrit, otherDamage int
	for _, op := range aa.Operations {
		switch op.Operation {
		case "damage":
			switch op.Ref {
			case asheNormalAAOpRef:
				if !op.CritEligible {
					t.Fatal("normal AA CritEligible must be true")
				}
				if op.Amount == nil || op.Amount.Op != "read" || op.Amount.Path != "source.attr.ad.resolved" {
					t.Fatalf("normal AA amount=%+v want read source.attr.ad.resolved", op.Amount)
				}
				if op.CopyableOnHit {
					t.Fatal("normal AA CopyableOnHit must stay false")
				}
				if op.DamageType != "damage/physical" {
					t.Fatalf("normal AA damageType=%q want damage/physical", op.DamageType)
				}
				normalCrit++
			case asheArrowOpRef:
				if op.CritEligible {
					t.Fatal("flurry arrow CritEligible must stay false")
				}
				arrowNoCrit++
			default:
				otherDamage++
			}
		case "slow", "control":
			t.Fatalf("unexpected %s op in basic_attack (Frost Shot Phase-A excludes slow/control)", op.Operation)
		}
	}
	if normalCrit != 1 {
		t.Fatalf("normal CritEligible ops=%d want 1", normalCrit)
	}
	if arrowNoCrit != asheFirstArrows+asheNextArrows {
		t.Fatalf("flurry arrow CritEligible=false ops=%d want %d", arrowNoCrit, asheFirstArrows+asheNextArrows)
	}
	if otherDamage != 0 {
		t.Fatalf("unexpected extra damage ops=%d", otherDamage)
	}
	mounts := 0
	for _, c := range compileReq.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		for _, m := range c.Providers {
			if m.ProviderRef == asheProviderRef {
				mounts++
			}
		}
	}
	if mounts != 1 {
		t.Fatalf("source Ashe mounts=%d want 1", mounts)
	}
}

// TestAsheFrostShotExpectedBasicAttackPhaseA: expectation-only P normal AA
// AD*(1+p*(m-1)) via settleExpectedCrit; not full Frost Shot fidelity.
func TestAsheFrostShotExpectedBasicAttackPhaseA(t *testing.T) {
	cases := []struct {
		name       string
		critChance float64
		critDamage float64
		armor      float64
		wantRaw    float64
		wantFinal  float64
	}{
		{"p0_m2_armor0", 0, 2.0, 0, 100, 100},
		{"p05_m2_armor0", 0.5, 2.0, 0, 150, 150},
		{"p1_m2_armor0", 1, 2.0, 0, 200, 200},
		{"p05_m2_armor100", 0.5, 2.0, 100, 150, 75},
		{"p05_m23_armor0", 0.5, 2.3, 0, 165, 165},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, _, _, wantAdj := wantExpectedCrit(asheTotalAD, tc.critChance, tc.critDamage)
			if math.Abs(wantAdj-tc.wantRaw) > 1e-9 {
				t.Fatalf("algebra wantRaw=%v helper=%v", tc.wantRaw, wantAdj)
			}

			compileReq, runReq := loadAsheRangersFocusFixture(t)
			assertAsheFrostShotCompileShape(t, compileReq)
			setSourceCritAttrs(&compileReq, &runReq, tc.critChance, tc.critDamage)
			setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
				Base: tc.armor, Current: tc.armor, Max: tc.armor, Resolved: tc.armor,
			})
			runReq.DriverPlan.Entries = asheAAEntries(1, 0, 0)
			runReq.StopPolicy.DurationMs = 50
			done := runAsheRangersFocus(t, compileReq, runReq)

			data := asheFrostShotFirstNormalDamage(t, done)
			if math.Abs(evidenceDataFloat(data, "rawAmount")-tc.wantRaw) > 1e-6 {
				t.Fatalf("rawAmount=%v want %v", evidenceDataFloat(data, "rawAmount"), tc.wantRaw)
			}
			if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-tc.wantFinal) > 1e-6 {
				t.Fatalf("mitigatedAmount=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), tc.wantFinal)
			}
			if countEmittedEvents(done, asheHitEvent) != 1 {
				t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, asheHitEvent))
			}
			if countEmittedEvents(done, asheCastEvent) != 0 {
				t.Fatalf("ability_started=%d want 0 (ability/basic_attack)", countEmittedEvents(done, asheCastEvent))
			}
			for _, m := range damageEvidenceModifiers(data) {
				if evidenceDataString(m, "command") == "crit" {
					t.Fatalf("must not mount crit pipeline modifiers: %+v", m)
				}
			}
			for _, item := range done.Evidence.Items {
				switch item.Kind {
				case model.EvidenceKindDamage, model.EvidenceKindEmittedEvent, model.EvidenceKindExecute:
					// expected
				default:
					if item.Kind == model.EvidenceKindAttemptSkipped {
						continue
					}
					// No RNG / on-crit / slow / control / tick mechanism evidence.
					if item.Kind == model.EvidenceKindProviderTick ||
						item.Kind == model.EvidenceKindListenerSkipped {
						t.Fatalf("unexpected mechanism evidence kind=%s ref=%s", item.Kind, item.Ref)
					}
				}
				if item.Kind == model.EvidenceKindEmittedEvent &&
					item.Ref != asheHitEvent {
					t.Fatalf("unexpected emitted event %q", item.Ref)
				}
			}
			if got := asheFocusSum(t, done); got != 1 {
				t.Fatalf("focus sum after inactive AA=%v want 1", got)
			}
			if got := asheStateValue(t, done, asheFlurryActiveKey); got != 0 {
				t.Fatalf("flurry_active=%v want 0", got)
			}
			if countDamageByOpRef(done, asheArrowOpRef, false) != 0 {
				t.Fatalf("flurry arrows=%d want 0 on inactive AA", countDamageByOpRef(done, asheArrowOpRef, false))
			}
		})
	}
}

// TestAsheFrostShotExpectedBasicAttackCompileShape: single Ashe provider,
// separate ability/basic_attack, CritEligible normal + ineligible Flurry arrows.
func TestAsheFrostShotExpectedBasicAttackCompileShape(t *testing.T) {
	compileReq, _ := loadAsheRangersFocusFixture(t)
	assertAsheFrostShotCompileShape(t, compileReq)
}
