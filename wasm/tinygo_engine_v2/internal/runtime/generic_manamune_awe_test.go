package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// item_3004 Manamune — Awe / 敬畏 (generic ABI).
// Source-owned always-on attribute modifier: bonus AD = 0.02 * source.attr.mana.max
// (ValuePolicy add on attr "ad"). No provider state, listeners, or effects.
// Non-goals: Manaflow charge growth, Muramana transform, resource spend/refund,
// on-hit, or any damage effect.

const (
	manamuneAweProviderRef = "item:manamune_awe"
	manamuneAweStableID    = "item_3004"
	manamuneAweModifierKey = "item_3004_manamune_awe_bonus_ad"
	manamuneAweRatio       = 0.02
	manamuneAweBaseAD      = 100.0
	manamuneAweManaMax0    = 0.0
	manamuneAweManaMax1000 = 1000.0
	manamuneAweManaMax2000 = 2000.0
	manamuneAweBonusAt1000 = 20.0 // 0.02 * 1000
	manamuneAweBonusAt2000 = 40.0 // 0.02 * 2000
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
				{Op: "read", Path: "source.attr.mana.max"},
			},
		},
	}
}

func mountManamuneAweProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: manamuneAweProviderRef,
		Kind:        "item",
		StableID:    manamuneAweStableID,
		Modifiers:   []model.ModifierDefinition{manamuneAweADModifier()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: manamuneAweProviderRef, DefinitionRef: manamuneAweProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: manamuneAweProviderRef, DefinitionRef: manamuneAweProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func loadManamuneAweFixture(t *testing.T, manaMax float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	mountManamuneAweProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: manamuneAweBaseAD, Current: manamuneAweBaseAD, Max: manamuneAweBaseAD, Resolved: manamuneAweBaseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "mana", model.AttributeSlotDef{
		Base: manaMax, Current: manaMax, Max: manaMax, Resolved: manaMax,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "ad", model.AttributeSlotDef{
		Base: manamuneAweBaseAD, Current: manamuneAweBaseAD, Max: manamuneAweBaseAD, Resolved: manamuneAweBaseAD,
	})

	// Attribute-only contract: no driver casts / damage ops.
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runManamuneAwe(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func manamuneAweSourceADSlot(t *testing.T, snap model.Snapshot) model.AttributeSlotDef {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes["ad"]
		if !ok {
			t.Fatal("source missing attr ad")
		}
		return slot
	}
	t.Fatal("source combatant missing")
	return model.AttributeSlotDef{}
}

func assertTargetLacksManamuneAwe(t *testing.T, done model.DoneResult) {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		for _, p := range c.Providers {
			if p.ProviderRef == manamuneAweProviderRef || p.DefinitionRef == manamuneAweProviderRef {
				t.Fatalf("target must not mount Manamune Awe provider: %+v", c.Providers)
			}
		}
		if raw, ok := c.ProviderState[manamuneAweProviderRef]; ok {
			t.Fatalf("target must not own Manamune Awe providerState: %+v", raw)
		}
		return
	}
	t.Fatal("target combatant missing")
}

func assertTargetADUnchanged(t *testing.T, done model.DoneResult) {
	t.Helper()
	got := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "ad")
	if math.Abs(got-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("target ad.resolved=%v want %v (Awe must not apply to target)", got, manamuneAweBaseAD)
	}
}

// TestManamuneAweBonusADFromManaMax: bounded Awe contract — 0.02*mana.max → source AD add;
// zero mana leaves AD unchanged; 1000 → +20; fixture mana.max mutation re-evaluates; target untouched.
func TestManamuneAweBonusADFromManaMax(t *testing.T) {
	// 1) mana.max=0 → source base and resolved AD unchanged.
	compile0, run0 := loadManamuneAweFixture(t, manamuneAweManaMax0)
	done0 := runManamuneAwe(t, compile0, run0)
	slot0 := manamuneAweSourceADSlot(t, done0.FinalSnapshot)
	if math.Abs(slot0.Base-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("mana.max 0: source ad.base=%v want %v", slot0.Base, manamuneAweBaseAD)
	}
	if math.Abs(slot0.Resolved-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("mana.max 0: source ad.resolved=%v want %v", slot0.Resolved, manamuneAweBaseAD)
	}
	assertTargetLacksManamuneAwe(t, done0)
	assertTargetADUnchanged(t, done0)

	// 2) mana.max=1000 → +20 AD; base unchanged, resolved reflects bonus.
	compile1000, run1000 := loadManamuneAweFixture(t, manamuneAweManaMax1000)
	done1000 := runManamuneAwe(t, compile1000, run1000)
	slot1000 := manamuneAweSourceADSlot(t, done1000.FinalSnapshot)
	if math.Abs(slot1000.Base-manamuneAweBaseAD) > 1e-12 {
		t.Fatalf("mana.max 1000: source ad.base=%v want %v (modifier must not mutate base)", slot1000.Base, manamuneAweBaseAD)
	}
	want1000 := manamuneAweBaseAD + manamuneAweBonusAt1000
	if math.Abs(slot1000.Resolved-want1000) > 1e-12 {
		t.Fatalf("mana.max 1000: source ad.resolved=%v want %v (base %v + 0.02*1000)", slot1000.Resolved, want1000, manamuneAweBaseAD)
	}
	assertTargetLacksManamuneAwe(t, done1000)
	assertTargetADUnchanged(t, done1000)

	// 3) Mutate fixture mana.max through the same runtime contract → formula re-evaluates.
	setCombatantAttr(&compile1000, &run1000, model.SelectorSource, "mana", model.AttributeSlotDef{
		Base: manamuneAweManaMax2000, Current: manamuneAweManaMax2000,
		Max: manamuneAweManaMax2000, Resolved: manamuneAweManaMax2000,
	})
	done2000 := runManamuneAwe(t, compile1000, run1000)
	got2000 := combatantAttrResolved(t, done2000.FinalSnapshot, model.SelectorSource, "ad")
	want2000 := manamuneAweBaseAD + manamuneAweBonusAt2000
	if math.Abs(got2000-want2000) > 1e-12 {
		t.Fatalf("mana.max 2000: source ad.resolved=%v want %v (must track current mana.max)", got2000, want2000)
	}
	if math.Abs(got2000-slot1000.Resolved) < 1e-12 {
		t.Fatal("resolved AD must change when fixture mana.max mutates from 1000 to 2000")
	}

	// 4) Target neither mounts Awe nor receives its modifier; resolved AD unchanged.
	assertTargetLacksManamuneAwe(t, done2000)
	assertTargetADUnchanged(t, done2000)
}
