package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// item_3004 Manamune — Awe / 敬畏 + Manaflow / 法力流 direct-max-state Phase-A (generic ABI).
//
// FROZEN_PLAN_REV: manamune-manaflow-direct-max-state-phase-a-v2
// BACKEND_EVIDENCE_COMMIT: 615eda1b080f229251e6b1a133a5d3dfd15ad858
// Wiki Module:ItemData/data revid 4030984 / content SHA
// e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
// (item 3004 static mana 500; Manaflow cap 360; Awe 2% maximum mana).
//
// Two isolated source-only providers (no production item switch/special-case):
//  1) item:manamune_awe — AD add = 0.02 * source.attr.mana.resolved
//  2) item:manamune_manaflow_max_state — mana add = const 360
//
// Approved DPS approximation only: source mana.resolved += 360; Base/Current/Max
// and resource mana unchanged; Awe reads effective mana and therefore includes +360.
// Does NOT model 8s charge timer, charge queue, on-hit/ability trigger, +3/+6
// increments, per-cast throttle, Muramana transform, resource capacity/spend, or
// full fidelity.
//
// Runtime evidence (pin — do not claim same-pass dependency resolution):
//   - AttributeResolver writes only Resolved; modifier formulas evaluate sibling
//     attrs from a frozen eval context (input attrs), so same-pass Awe cannot
//     observe Manaflow's newly written mana.resolved.
//   - materializeCombatants: same-combatant resolve pass, then a second
//     cross-combatant pass; that second pass is what lets Awe consume the
//     first-pass effective mana.
//   - Refresh re-resolves from the prior resolved attribute context (same frozen
//     sibling-read rule).
//
// Governance/regression evidence only; excluded from production Wasm.

const (
	manamuneAweProviderRef = "item:manamune_awe"
	manamuneAweStableID    = "item_3004"
	manamuneAweModifierKey = "item_3004_manamune_awe_bonus_ad"

	manamuneManaflowProviderRef = "item:manamune_manaflow_max_state"
	manamuneManaflowStableID    = "item_3004"
	manamuneManaflowModifierKey = "item_3004_manamune_manaflow_max_state_mana"

	manamuneAweRatio         = 0.02
	manamuneManaflowConst360 = 360.0
	manamuneAweBaseAD        = 100.0
	manamuneMana0            = 0.0
	manamuneMana1000         = 1000.0
	manamuneMana2000         = 2000.0
)

func manamuneAweADModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: manamuneAweModifierKey,
		Kind:        "attribute",
		Target:      "ad",
		ValuePolicy: "add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(manamuneAweRatio),
				{Op: "read", Path: "source.attr.mana.resolved"},
			},
		},
	}
}

func manamuneManaflowManaModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: manamuneManaflowModifierKey,
		Kind:        "attribute",
		Target:      "mana",
		ValuePolicy: "add",
		Value:       gfConst(manamuneManaflowConst360),
	}
}

func manamuneAweProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: manamuneAweProviderRef,
		Kind:        "item",
		StableID:    manamuneAweStableID,
		Modifiers:   []model.ModifierDefinition{manamuneAweADModifier()},
	}
}

func manamuneManaflowProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: manamuneManaflowProviderRef,
		Kind:        "item",
		StableID:    manamuneManaflowStableID,
		Modifiers:   []model.ModifierDefinition{manamuneManaflowManaModifier()},
	}
}

// manamuneEqualManaSlot: every input mana slot Base=Current=Max=Resolved equal.
// Note: formula read of source.attr.mana.resolved falls back to Current when Resolved==0
// (formula.readAttrValue); fixtures never mix Max/Resolved.
func manamuneEqualManaSlot(v float64) model.AttributeSlotDef {
	return model.AttributeSlotDef{Base: v, Current: v, Max: v, Resolved: v}
}

func manamuneEqualADSlot(v float64) model.AttributeSlotDef {
	return model.AttributeSlotDef{Base: v, Current: v, Max: v, Resolved: v}
}

type manamuneMountOpts struct {
	awe      bool
	manaflow bool
	// reverseShared appends Manaflow before Awe in SharedProviders (after fixture providers).
	reverseShared bool
	// reverseSourceMounts / reverseSnapshot append Manaflow before Awe on source.
	reverseSourceMounts bool
	reverseSnapshot     bool
}

func appendManamuneSharedProviders(compileReq *model.CompileRequest, opts manamuneMountOpts) {
	awe := manamuneAweProviderDef()
	mf := manamuneManaflowProviderDef()
	switch {
	case opts.awe && opts.manaflow && opts.reverseShared:
		compileReq.SharedProviders = append(compileReq.SharedProviders, mf, awe)
	case opts.awe && opts.manaflow:
		compileReq.SharedProviders = append(compileReq.SharedProviders, awe, mf)
	case opts.awe:
		compileReq.SharedProviders = append(compileReq.SharedProviders, awe)
	case opts.manaflow:
		compileReq.SharedProviders = append(compileReq.SharedProviders, mf)
	}
}

func manamuneSourceMounts(opts manamuneMountOpts) []model.CombatantProviderMount {
	awe := model.CombatantProviderMount{
		ProviderRef: manamuneAweProviderRef, DefinitionRef: manamuneAweProviderRef,
	}
	mf := model.CombatantProviderMount{
		ProviderRef: manamuneManaflowProviderRef, DefinitionRef: manamuneManaflowProviderRef,
	}
	switch {
	case opts.awe && opts.manaflow && opts.reverseSourceMounts:
		return []model.CombatantProviderMount{mf, awe}
	case opts.awe && opts.manaflow:
		return []model.CombatantProviderMount{awe, mf}
	case opts.awe:
		return []model.CombatantProviderMount{awe}
	case opts.manaflow:
		return []model.CombatantProviderMount{mf}
	default:
		return nil
	}
}

func manamuneSourceSnapshots(opts manamuneMountOpts) []model.CombatantProviderSnapshot {
	awe := model.CombatantProviderSnapshot{
		ProviderRef: manamuneAweProviderRef, DefinitionRef: manamuneAweProviderRef,
		Stacks: 1, State: map[string]interface{}{},
	}
	mf := model.CombatantProviderSnapshot{
		ProviderRef: manamuneManaflowProviderRef, DefinitionRef: manamuneManaflowProviderRef,
		Stacks: 1, State: map[string]interface{}{},
	}
	switch {
	case opts.awe && opts.manaflow && opts.reverseSnapshot:
		return []model.CombatantProviderSnapshot{mf, awe}
	case opts.awe && opts.manaflow:
		return []model.CombatantProviderSnapshot{awe, mf}
	case opts.awe:
		return []model.CombatantProviderSnapshot{awe}
	case opts.manaflow:
		return []model.CombatantProviderSnapshot{mf}
	default:
		return nil
	}
}

func mountManamuneProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts manamuneMountOpts) {
	appendManamuneSharedProviders(compileReq, opts)
	mounts := manamuneSourceMounts(opts)
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != model.SelectorSource {
			continue
		}
		compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, mounts...)
	}
	snaps := manamuneSourceSnapshots(opts)
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers, snaps...,
		)
	}
}

func loadManamuneFixture(t *testing.T, mana float64, opts manamuneMountOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	mountManamuneProviders(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", manamuneEqualADSlot(manamuneAweBaseAD))
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "mana", manamuneEqualManaSlot(mana))
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "ad", manamuneEqualADSlot(manamuneAweBaseAD))

	// Attribute-only contract: no driver casts / damage ops.
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runManamune(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func manamuneSourceAttrSlot(t *testing.T, snap model.Snapshot, attr string) model.AttributeSlotDef {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes[attr]
		if !ok {
			t.Fatalf("source missing attr %s", attr)
		}
		return slot
	}
	t.Fatal("source combatant missing")
	return model.AttributeSlotDef{}
}

func assertManamuneTargetLacksProviders(t *testing.T, done model.DoneResult) {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		for _, p := range c.Providers {
			if p.ProviderRef == manamuneAweProviderRef || p.DefinitionRef == manamuneAweProviderRef ||
				p.ProviderRef == manamuneManaflowProviderRef || p.DefinitionRef == manamuneManaflowProviderRef {
				t.Fatalf("target must not mount Manamune providers: %+v", c.Providers)
			}
		}
		if raw, ok := c.ProviderState[manamuneAweProviderRef]; ok {
			t.Fatalf("target must not own Manamune Awe providerState: %+v", raw)
		}
		if raw, ok := c.ProviderState[manamuneManaflowProviderRef]; ok {
			t.Fatalf("target must not own Manamune Manaflow providerState: %+v", raw)
		}
		return
	}
	t.Fatal("target combatant missing")
}

func assertManamuneTargetADUnchanged(t *testing.T, done model.DoneResult) {
	t.Helper()
	got := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "ad")
	if math.Abs(got-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("target ad.resolved=%v want %v (Manamune must not apply to target)", got, manamuneAweBaseAD)
	}
}

func assertManamuneBCMUnchanged(t *testing.T, slot model.AttributeSlotDef, want float64, label string) {
	t.Helper()
	if math.Abs(slot.Base-want) > 1e-12 || math.Abs(slot.Current-want) > 1e-12 || math.Abs(slot.Max-want) > 1e-12 {
		t.Fatalf("%s: mana Base/Current/Max=%v/%v/%v want all %v (Manaflow must write Resolved only)",
			label, slot.Base, slot.Current, slot.Max, want)
	}
}

func manamuneWantAweAD(manaEffective float64) float64 {
	return manamuneAweBaseAD + manamuneAweRatio*manaEffective
}

func manamuneFindProvider(compileReq model.CompileRequest, ref string) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == ref {
			return p
		}
	}
	return nil
}

func assertManamuneProviderBare(t *testing.T, p *model.ProviderDefinition, label string) {
	t.Helper()
	if p == nil {
		t.Fatalf("%s provider missing", label)
	}
	if len(p.Abilities) != 0 {
		t.Fatalf("%s must have no abilities: %+v", label, p.Abilities)
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("%s must have no listeners: %+v", label, p.Listeners)
	}
	if p.Lifecycle != nil {
		t.Fatalf("%s must have no lifecycle: %+v", label, p.Lifecycle)
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("%s must have no initialStateSchema/state: %+v", label, p.InitialStateSchema)
	}
	if len(p.Modifiers) != 1 {
		t.Fatalf("%s modifiers=%d want exactly 1", label, len(p.Modifiers))
	}
}

// TestManamuneAweBonusADFromManaResolved: Awe-only compatibility — 0.02*mana.resolved →
// source AD add; mana 0/1000/2000 → AD 100/120/140; fixture mutation re-evaluates; target untouched.
// (Strengthened from prior mana.max read; formula path is source.attr.mana.resolved.)
func TestManamuneAweBonusADFromManaResolved(t *testing.T) {
	opts := manamuneMountOpts{awe: true}

	// 1) mana=0 → source base and resolved AD unchanged.
	// Resolved==0 read falls back to Current (also 0) in formula.readAttrValue.
	compile0, run0 := loadManamuneFixture(t, manamuneMana0, opts)
	done0 := runManamune(t, compile0, run0)
	slot0 := manamuneSourceAttrSlot(t, done0.FinalSnapshot, "ad")
	if math.Abs(slot0.Base-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("mana 0: source ad.base=%v want %v", slot0.Base, manamuneAweBaseAD)
	}
	if math.Abs(slot0.Resolved-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("mana 0: source ad.resolved=%v want %v", slot0.Resolved, manamuneAweBaseAD)
	}
	assertManamuneTargetLacksProviders(t, done0)
	assertManamuneTargetADUnchanged(t, done0)

	// 2) mana=1000 → +20 AD; base unchanged, resolved reflects bonus.
	compile1000, run1000 := loadManamuneFixture(t, manamuneMana1000, opts)
	done1000 := runManamune(t, compile1000, run1000)
	slot1000 := manamuneSourceAttrSlot(t, done1000.FinalSnapshot, "ad")
	if math.Abs(slot1000.Base-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("mana 1000: source ad.base=%v want %v (modifier must not mutate base)", slot1000.Base, manamuneAweBaseAD)
	}
	want1000 := manamuneWantAweAD(manamuneMana1000)
	if math.Abs(slot1000.Resolved-want1000) > 1e-12 {
		t.Fatalf("mana 1000: source ad.resolved=%v want %v (base %v + 0.02*1000)", slot1000.Resolved, want1000, manamuneAweBaseAD)
	}
	assertManamuneTargetLacksProviders(t, done1000)
	assertManamuneTargetADUnchanged(t, done1000)

	// 3) Mutate fixture mana through the same runtime contract → formula re-evaluates.
	setCombatantAttr(&compile1000, &run1000, model.SelectorSource, "mana", manamuneEqualManaSlot(manamuneMana2000))
	done2000 := runManamune(t, compile1000, run1000)
	got2000 := combatantAttrResolved(t, done2000.FinalSnapshot, model.SelectorSource, "ad")
	want2000 := manamuneWantAweAD(manamuneMana2000)
	if math.Abs(got2000-want2000) > 1e-12 {
		t.Fatalf("mana 2000: source ad.resolved=%v want %v (must track current mana.resolved)", got2000, want2000)
	}
	if math.Abs(got2000-slot1000.Resolved) < 1e-12 {
		t.Fatal("resolved AD must change when fixture mana mutates from 1000 to 2000")
	}

	assertManamuneTargetLacksProviders(t, done2000)
	assertManamuneTargetADUnchanged(t, done2000)
}

// TestManamuneManaflowMaxStateResolvedOnly: Manaflow-only — mana.resolved += 360 while
// Base/Current/Max stay at input; source AD and target unchanged.
func TestManamuneManaflowMaxStateResolvedOnly(t *testing.T) {
	opts := manamuneMountOpts{manaflow: true}
	cases := []struct {
		input float64
		want  float64
	}{
		{manamuneMana0, manamuneManaflowConst360},
		{manamuneMana1000, manamuneMana1000 + manamuneManaflowConst360},
		{manamuneMana2000, manamuneMana2000 + manamuneManaflowConst360},
	}
	for _, tc := range cases {
		compileReq, runReq := loadManamuneFixture(t, tc.input, opts)
		done := runManamune(t, compileReq, runReq)
		mana := manamuneSourceAttrSlot(t, done.FinalSnapshot, "mana")
		assertManamuneBCMUnchanged(t, mana, tc.input, "manaflow-only")
		if math.Abs(mana.Resolved-tc.want) > 1e-12 {
			t.Fatalf("manaflow-only input=%v: mana.resolved=%v want %v", tc.input, mana.Resolved, tc.want)
		}
		ad := manamuneSourceAttrSlot(t, done.FinalSnapshot, "ad")
		if math.Abs(ad.Resolved-manamuneAweBaseAD) > 1e-12 || math.Abs(ad.Base-manamuneAweBaseAD) > 1e-12 {
			t.Fatalf("manaflow-only must not change source AD: %+v", ad)
		}
		assertManamuneTargetLacksProviders(t, done)
		assertManamuneTargetADUnchanged(t, done)
	}
}

// TestManamuneAwePlusManaflowCombinedEffectiveMana: combined — Manaflow first-pass effective
// mana is visible to Awe on the second (cross-combatant) materialize pass.
func TestManamuneAwePlusManaflowCombinedEffectiveMana(t *testing.T) {
	opts := manamuneMountOpts{awe: true, manaflow: true}
	cases := []struct {
		input    float64
		wantMana float64
		wantAD   float64
	}{
		{manamuneMana0, manamuneManaflowConst360, manamuneWantAweAD(manamuneManaflowConst360)},                                          // 107.2
		{manamuneMana1000, manamuneMana1000 + manamuneManaflowConst360, manamuneWantAweAD(manamuneMana1000 + manamuneManaflowConst360)}, // 127.2
		{manamuneMana2000, manamuneMana2000 + manamuneManaflowConst360, manamuneWantAweAD(manamuneMana2000 + manamuneManaflowConst360)}, // 147.2
	}
	for _, tc := range cases {
		compileReq, runReq := loadManamuneFixture(t, tc.input, opts)
		done := runManamune(t, compileReq, runReq)
		mana := manamuneSourceAttrSlot(t, done.FinalSnapshot, "mana")
		assertManamuneBCMUnchanged(t, mana, tc.input, "combined")
		if math.Abs(mana.Resolved-tc.wantMana) > 1e-12 {
			t.Fatalf("combined input=%v: mana.resolved=%v want %v", tc.input, mana.Resolved, tc.wantMana)
		}
		ad := manamuneSourceAttrSlot(t, done.FinalSnapshot, "ad")
		if math.Abs(ad.Base-manamuneAweBaseAD) > 1e-12 {
			t.Fatalf("combined input=%v: ad.base=%v want %v", tc.input, ad.Base, manamuneAweBaseAD)
		}
		if math.Abs(ad.Resolved-tc.wantAD) > 1e-12 {
			t.Fatalf("combined input=%v: ad.resolved=%v want %v (0.02 * effective mana)", tc.input, ad.Resolved, tc.wantAD)
		}
		assertManamuneTargetLacksProviders(t, done)
		assertManamuneTargetADUnchanged(t, done)
	}
}

// TestManamuneCombinedOrderAndDeterminism: repeated runs identical; reverse SharedProviders
// and source mount/snapshot order; results identical.
func TestManamuneCombinedOrderAndDeterminism(t *testing.T) {
	forward := manamuneMountOpts{awe: true, manaflow: true}
	reversed := manamuneMountOpts{
		awe: true, manaflow: true,
		reverseShared: true, reverseSourceMounts: true, reverseSnapshot: true,
	}

	capture := func(opts manamuneMountOpts) (manaR, adR float64) {
		compileReq, runReq := loadManamuneFixture(t, manamuneMana1000, opts)
		done := runManamune(t, compileReq, runReq)
		return manamuneSourceAttrSlot(t, done.FinalSnapshot, "mana").Resolved,
			manamuneSourceAttrSlot(t, done.FinalSnapshot, "ad").Resolved
	}

	m1, a1 := capture(forward)
	m2, a2 := capture(forward)
	if m1 != m2 || a1 != a2 {
		t.Fatalf("repeated runs not deterministic: mana %v/%v ad %v/%v", m1, m2, a1, a2)
	}
	mR, aR := capture(reversed)
	if math.Abs(mR-m1) > 1e-12 || math.Abs(aR-a1) > 1e-12 {
		t.Fatalf("reversed shared/mount/snapshot order diverged: mana %v want %v; ad %v want %v", mR, m1, aR, a1)
	}
	wantMana := manamuneMana1000 + manamuneManaflowConst360
	wantAD := manamuneWantAweAD(wantMana)
	if math.Abs(m1-wantMana) > 1e-12 || math.Abs(a1-wantAD) > 1e-12 {
		t.Fatalf("combined baseline mana.resolved=%v want %v; ad.resolved=%v want %v", m1, wantMana, a1, wantAD)
	}
}

// TestManamuneProviderRemovalIsolation: removing Manaflow returns Awe-only; removing Awe
// leaves only effective mana.
func TestManamuneProviderRemovalIsolation(t *testing.T) {
	const input = manamuneMana1000

	cCombined, rCombined := loadManamuneFixture(t, input, manamuneMountOpts{awe: true, manaflow: true})
	combined := runManamune(t, cCombined, rCombined)
	wantCombinedAD := manamuneWantAweAD(input + manamuneManaflowConst360)
	gotCombinedAD := manamuneSourceAttrSlot(t, combined.FinalSnapshot, "ad").Resolved
	if math.Abs(gotCombinedAD-wantCombinedAD) > 1e-12 {
		t.Fatalf("combined baseline ad.resolved=%v want %v", gotCombinedAD, wantCombinedAD)
	}

	// Remove Manaflow → Awe-only (AD from raw mana, not +360).
	cAwe, rAwe := loadManamuneFixture(t, input, manamuneMountOpts{awe: true})
	aweOnly := runManamune(t, cAwe, rAwe)
	wantAweAD := manamuneWantAweAD(input)
	gotAweAD := manamuneSourceAttrSlot(t, aweOnly.FinalSnapshot, "ad").Resolved
	if math.Abs(gotAweAD-wantAweAD) > 1e-12 {
		t.Fatalf("manaflow removed: ad.resolved=%v want awe-only %v", gotAweAD, wantAweAD)
	}
	manaAweOnly := manamuneSourceAttrSlot(t, aweOnly.FinalSnapshot, "mana")
	if math.Abs(manaAweOnly.Resolved-input) > 1e-12 {
		t.Fatalf("manaflow removed: mana.resolved=%v want input %v", manaAweOnly.Resolved, input)
	}
	if math.Abs(gotAweAD-gotCombinedAD) < 1e-12 {
		t.Fatal("removing Manaflow must drop Awe below combined AD")
	}

	// Remove Awe → Manaflow-only effective mana; AD unchanged.
	cMF, rMF := loadManamuneFixture(t, input, manamuneMountOpts{manaflow: true})
	mfOnly := runManamune(t, cMF, rMF)
	wantMFMana := input + manamuneManaflowConst360
	manaMF := manamuneSourceAttrSlot(t, mfOnly.FinalSnapshot, "mana")
	assertManamuneBCMUnchanged(t, manaMF, input, "awe-removed")
	if math.Abs(manaMF.Resolved-wantMFMana) > 1e-12 {
		t.Fatalf("awe removed: mana.resolved=%v want %v", manaMF.Resolved, wantMFMana)
	}
	adMF := manamuneSourceAttrSlot(t, mfOnly.FinalSnapshot, "ad").Resolved
	if math.Abs(adMF-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("awe removed: ad.resolved=%v want %v", adMF, manamuneAweBaseAD)
	}
}

// TestManamuneCompileShapeTwoIsolatedProviders: identify exactly these two Manamune
// providers (one modifier each) among SharedProviders that also include loadBasicFixture
// unrelated providers; exact target/policy/formula; no state/listeners/effects/abilities/
// lifecycle/operations.
func TestManamuneCompileShapeTwoIsolatedProviders(t *testing.T) {
	compileReq, _ := loadManamuneFixture(t, manamuneMana1000, manamuneMountOpts{awe: true, manaflow: true})

	// Unrelated fixture provider must still be present — do not assume only two providers.
	if manamuneFindProvider(compileReq, "champion:source_demo") == nil {
		t.Fatal("loadBasicFixture unrelated provider champion:source_demo missing")
	}
	awe := manamuneFindProvider(compileReq, manamuneAweProviderRef)
	mf := manamuneFindProvider(compileReq, manamuneManaflowProviderRef)
	assertManamuneProviderBare(t, awe, "awe")
	assertManamuneProviderBare(t, mf, "manaflow")

	if awe.StableID != manamuneAweStableID || awe.Kind != "item" {
		t.Fatalf("awe identity kind/stableId=%q/%q", awe.Kind, awe.StableID)
	}
	if mf.StableID != manamuneManaflowStableID || mf.Kind != "item" {
		t.Fatalf("manaflow identity kind/stableId=%q/%q", mf.Kind, mf.StableID)
	}

	aweMod := awe.Modifiers[0]
	if aweMod.ModifierKey != manamuneAweModifierKey || aweMod.Kind != "attribute" ||
		aweMod.Target != "ad" || aweMod.ValuePolicy != "add" {
		t.Fatalf("awe modifier shape=%+v", aweMod)
	}
	if aweMod.Value.Op != "mul" || len(aweMod.Value.Args) != 2 {
		t.Fatalf("awe formula=%+v want mul(const 0.02, read mana.resolved)", aweMod.Value)
	}
	if aweMod.Value.Args[0].Op != "const" || aweMod.Value.Args[0].Value == nil ||
		math.Abs(*aweMod.Value.Args[0].Value-manamuneAweRatio) > 1e-12 {
		t.Fatalf("awe ratio const=%+v want %v", aweMod.Value.Args[0], manamuneAweRatio)
	}
	if aweMod.Value.Args[1].Op != "read" || aweMod.Value.Args[1].Path != "source.attr.mana.resolved" {
		t.Fatalf("awe read=%+v want source.attr.mana.resolved (never .max)", aweMod.Value.Args[1])
	}
	if aweMod.Condition != nil {
		t.Fatalf("awe must have no condition: %+v", aweMod.Condition)
	}

	mfMod := mf.Modifiers[0]
	if mfMod.ModifierKey != manamuneManaflowModifierKey || mfMod.Kind != "attribute" ||
		mfMod.Target != "mana" || mfMod.ValuePolicy != "add" {
		t.Fatalf("manaflow modifier shape=%+v", mfMod)
	}
	if mfMod.Value.Op != "const" || mfMod.Value.Value == nil ||
		math.Abs(*mfMod.Value.Value-manamuneManaflowConst360) > 1e-12 {
		t.Fatalf("manaflow formula=%+v want exact const 360", mfMod.Value)
	}
	if len(mfMod.Value.Args) != 0 {
		t.Fatalf("manaflow const360 must have no args/reads: %+v", mfMod.Value)
	}
	if mfMod.Condition != nil {
		t.Fatalf("manaflow must have no condition: %+v", mfMod.Condition)
	}

	// Count Manamune providers exactly once each among SharedProviders.
	aweN, mfN := 0, 0
	for _, p := range compileReq.SharedProviders {
		switch p.ProviderKey {
		case manamuneAweProviderRef:
			aweN++
		case manamuneManaflowProviderRef:
			mfN++
		}
	}
	if aweN != 1 || mfN != 1 {
		t.Fatalf("Manamune provider counts awe=%d manaflow=%d want 1 each (SharedProviders=%d)",
			aweN, mfN, len(compileReq.SharedProviders))
	}

	// Target mounts neither provider.
	for _, c := range compileReq.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		for _, m := range c.Providers {
			if m.ProviderRef == manamuneAweProviderRef || m.ProviderRef == manamuneManaflowProviderRef {
				t.Fatalf("compile target must not mount Manamune: %+v", c.Providers)
			}
		}
		return
	}
	t.Fatal("target combatant missing from compile request")
}
