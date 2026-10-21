package pipeline

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/expression"
	"tinygo_engine_v2/internal/inputbinding"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestResolveDamageReducesHP(t *testing.T) {
	defense := formuladefinition.ConstantDefense("1")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp": {Current: 1000, Max: 1000},
	})
	cmd := command.Command{Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical"}
	outcome, view := resolveAuthorDamage(t, defense, cmd, CombatantView{Attributes: attrs}, 0)
	if outcome.HPDamage != 100 {
		t.Fatalf("hpDamage=%v want 100", outcome.HPDamage)
	}
	if attribute.ReadHP(view.Attributes) != 900 {
		t.Fatalf("hp=%v want 900", attribute.ReadHP(view.Attributes))
	}
}

func TestGenericCommandCannotSettleDamage(t *testing.T) {
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}})
	view := CombatantView{Attributes: attrs, Shields: []ShieldInstance{{Remaining: 30}}}
	result, next := ResolveCommand(command.Command{Kind: command.KindDamage, Amount: 50, DamageType: "damage/physical"}, view, 0)
	if result.Applied || result.Amount != 0 || result.Message != "unsupported" || attribute.ReadHP(next.Attributes) != 1000 || next.Shields[0].Remaining != 30 {
		t.Fatalf("damage escaped authored settlement: %+v %+v", result, next)
	}
}

func TestResolveDamageShieldAbsorbFirst(t *testing.T) {
	defense := formuladefinition.ConstantDefense("1")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}})
	view := CombatantView{
		Attributes: attrs,
		Shields:    []ShieldInstance{{Remaining: 40}},
	}
	outcome, next := resolveAuthorDamage(t, defense, command.Command{Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical"}, view, 0)
	if outcome.ShieldAbsorbed != 40 {
		t.Fatalf("absorbed=%v want 40", outcome.ShieldAbsorbed)
	}
	if outcome.HPDamage != 60 {
		t.Fatalf("hpDamage=%v want 60", outcome.HPDamage)
	}
	if attribute.ReadHP(next.Attributes) != 940 {
		t.Fatalf("hp=%v want 940", attribute.ReadHP(next.Attributes))
	}
}

func TestResolveHealClampsMax(t *testing.T) {
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 950, Max: 1000}})
	next, healed := ResolveHeal(command.Command{Kind: command.KindHeal, Amount: 100}, attrs)
	if healed != 50 {
		t.Fatalf("healed=%v want 50", healed)
	}
	if attribute.ReadHP(next) != 1000 {
		t.Fatalf("hp=%v want 1000", attribute.ReadHP(next))
	}
}

func TestResolveDamageShieldPriorityOrder(t *testing.T) {
	defense := formuladefinition.ConstantDefense("1")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}})
	view := CombatantView{
		Attributes: attrs,
		Shields: []ShieldInstance{
			{ShieldRef: "high", Remaining: 30, Priority: 10},
			{ShieldRef: "low", Remaining: 30, Priority: 1},
		},
	}
	outcome, next := resolveAuthorDamage(t, defense, command.Command{Kind: command.KindDamage, Amount: 40, DamageType: "damage/physical"}, view, 0)
	if outcome.ShieldAbsorbed != 40 {
		t.Fatalf("absorbed=%v want 40", outcome.ShieldAbsorbed)
	}
	if len(next.Shields) != 1 {
		t.Fatalf("shields=%d want 1 (depleted shield removed)", len(next.Shields))
	}
	if next.Shields[0].ShieldRef != "high" || next.Shields[0].Remaining != 20 {
		t.Fatalf("high priority shield should have 20 remaining: %+v", next.Shields[0])
	}
}

func TestResolveDamagePhysicalArmorMitigation(t *testing.T) {
	defense := formuladefinition.ResistanceDefense("armor")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":    {Current: 1000, Max: 1000},
		"armor": {Base: 100, Current: 100, Max: 100, Resolved: 100},
	})
	outcome, next := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.RawAmount != 100 {
		t.Fatalf("raw=%v want 100", outcome.RawAmount)
	}
	if outcome.MitigatedAmount != 50 {
		t.Fatalf("mitigated=%v want 50", outcome.MitigatedAmount)
	}
	if outcome.HPDamage != 50 {
		t.Fatalf("hpDamage=%v want 50", outcome.HPDamage)
	}
	if attribute.ReadHP(next.Attributes) != 950 {
		t.Fatalf("hp=%v want 950", attribute.ReadHP(next.Attributes))
	}
}

func TestResolveDamageMagicResistMitigation(t *testing.T) {
	defense := formuladefinition.ResistanceDefense("magic_resist")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":           {Current: 1000, Max: 1000},
		"magic_resist": {Base: 100, Current: 100, Max: 100, Resolved: 100},
	})
	outcome, _ := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/magic",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 50 {
		t.Fatalf("mitigated=%v want 50", outcome.MitigatedAmount)
	}
}

func TestResolveDamageMagicalAliasUsesMagicResist(t *testing.T) {
	defense := formuladefinition.ResistanceDefense("magic_resist")
	for _, dt := range []string{"magical", "damage/magical"} {
		attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
			"hp":           {Current: 1000, Max: 1000},
			"magic_resist": {Base: 100, Current: 100, Max: 100, Resolved: 100},
		})
		outcome, next := resolveAuthorDamage(t, defense, command.Command{
			Kind: command.KindDamage, Amount: 100, DamageType: dt,
		}, CombatantView{Attributes: attrs}, 0)
		if outcome.MitigatedAmount != 50 {
			t.Fatalf("%s mitigated=%v want 50", dt, outcome.MitigatedAmount)
		}
		if attribute.ReadHP(next.Attributes) != 950 {
			t.Fatalf("%s hp=%v want 950", dt, attribute.ReadHP(next.Attributes))
		}
	}
}

func TestResolveDamageTrueIgnoresResistance(t *testing.T) {
	defense := formuladefinition.ConstantDefense("1")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":           {Current: 1000, Max: 1000},
		"armor":        {Resolved: 200},
		"magic_resist": {Resolved: 200},
	})
	outcome, _ := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/true",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 100 || outcome.HPDamage != 100 {
		t.Fatalf("outcome=%+v want mitigated/hp 100", outcome)
	}
}

func TestResolveDamageZeroAndNegativeResistance(t *testing.T) {
	defense := formuladefinition.ResistanceDefense("armor")
	attrs0 := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp": {Current: 1000, Max: 1000}, "armor": {Resolved: 0},
	})
	out0, _ := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "physical",
	}, CombatantView{Attributes: attrs0}, 0)
	if out0.MitigatedAmount != 100 {
		t.Fatalf("R=0 mitigated=%v want 100", out0.MitigatedAmount)
	}

	attrsNeg := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp": {Current: 1000, Max: 1000}, "armor": {Resolved: -50},
	})
	outNeg, _ := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrsNeg}, 0)
	want := 100 * (2 - 100.0/(100-(-50)))
	if math.Abs(outNeg.MitigatedAmount-want) > 1e-9 {
		t.Fatalf("R=-50 mitigated=%v want %v", outNeg.MitigatedAmount, want)
	}
}

// Resolved=0 is legal after modifiers (e.g. Base/Current=100, flat -100).
// Must not fall back to Current, or mitigation incorrectly uses 100 armor.
func TestResolveDamageResolvedZeroIgnoresCurrent(t *testing.T) {
	defense := formuladefinition.ResistanceDefense("armor")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":    {Current: 1000, Max: 1000},
		"armor": {Base: 100, Current: 100, Max: 100, Resolved: 0},
	})
	outcome, _ := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 100 {
		t.Fatalf("Resolved=0 must ignore Current=100: mitigated=%v want 100", outcome.MitigatedAmount)
	}
}

func TestResolveDamageResistanceThenShield(t *testing.T) {
	defense := formuladefinition.ResistanceDefense("armor")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":    {Current: 1000, Max: 1000},
		"armor": {Resolved: 100},
	})
	view := CombatantView{
		Attributes: attrs,
		Shields:    []ShieldInstance{{Remaining: 20}},
	}
	// 100 physical / 100 armor => 50 mitigated; shield absorbs 20; HP takes 30.
	outcome, next := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, view, 0)
	if outcome.MitigatedAmount != 50 {
		t.Fatalf("mitigated=%v want 50", outcome.MitigatedAmount)
	}
	if outcome.ShieldAbsorbed != 20 {
		t.Fatalf("absorbed=%v want 20", outcome.ShieldAbsorbed)
	}
	if outcome.HPDamage != 30 {
		t.Fatalf("hpDamage=%v want 30", outcome.HPDamage)
	}
	if attribute.ReadHP(next.Attributes) != 970 {
		t.Fatalf("hp=%v want 970", attribute.ReadHP(next.Attributes))
	}
}

func TestResolveDamageOverkillSummaryUsesMitigated(t *testing.T) {
	defense := formuladefinition.ResistanceDefense("armor")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":    {Current: 30, Max: 1000},
		"armor": {Resolved: 100},
	})
	outcome, next := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	// mitigated=50; HP clipped to 30.
	if outcome.MitigatedAmount != 50 {
		t.Fatalf("mitigated=%v want 50 (summary口径)", outcome.MitigatedAmount)
	}
	if outcome.HPDamage != 30 {
		t.Fatalf("hpDamage=%v want 30", outcome.HPDamage)
	}
	if attribute.ReadHP(next.Attributes) != 0 {
		t.Fatalf("hp=%v want 0", attribute.ReadHP(next.Attributes))
	}
	result, _ := ResolveCommand(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp": {Current: 30, Max: 1000}, "armor": {Resolved: 100},
	})}, 0)
	if result.Amount != 0 || result.Applied {
		t.Fatalf("generic command must reject damage: %+v", result)
	}
}

func TestResolveDamagePhysicalDoesNotReadMR(t *testing.T) {
	defense := formuladefinition.ConstantDefense("1")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":           {Current: 1000, Max: 1000},
		"magic_resist": {Resolved: 100},
	})
	outcome, _ := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 100 {
		t.Fatalf("physical must ignore MR: mitigated=%v", outcome.MitigatedAmount)
	}
}

func TestResolveDamageMagicDoesNotReadArmor(t *testing.T) {
	defense := formuladefinition.ConstantDefense("1")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":    {Current: 1000, Max: 1000},
		"armor": {Resolved: 100},
	})
	outcome, _ := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/magic",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 100 {
		t.Fatalf("magic must ignore armor: mitigated=%v", outcome.MitigatedAmount)
	}
}

func TestResolveDamageTargetMapPenetrationNoOp(t *testing.T) {
	defense := formuladefinition.ResistanceDefense("armor")
	// Penetration is source-side only; attrs on the target map must not affect mitigation.
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp":             {Current: 1000, Max: 1000},
		"armor":          {Resolved: 100},
		"armor_pen_flat": {Resolved: 100},
		"armor_pen_pct":  {Resolved: 1},
	})
	outcome, _ := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 50 {
		t.Fatalf("target-map pen must have no effect: mitigated=%v want 50", outcome.MitigatedAmount)
	}
}

func TestAuthoredDefenseNoSource(t *testing.T) {
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"armor": {Resolved: 100}})
	res, ok := authoredMitigate(t, 100, formuladefinition.ResistanceDefense("armor"), attrs, attribute.Table{})
	if !ok || res.Amount != 50 {
		t.Fatalf("explicit definition=%+v ok=%v want50", res, ok)
	}
}

func TestAuthoredDefenseExplicitPhysicalBindingsClampFloor(t *testing.T) {
	target := attribute.FromMap(map[string]model.AttributeSlotDef{"armor": {Resolved: 100}})
	src := attribute.FromMap(map[string]model.AttributeSlotDef{"armor_pen_pct": {Resolved: 0.4}, "physical_pen_percent": {Resolved: 0.9}, "armor_pen_flat": {Resolved: 10}, "physical_pen": {Resolved: 50}})
	res, ok := authoredMitigate(t, 100, formuladefinition.PenetrationDefense("armor", "armor_pen_pct", "armor_pen_flat"), target, src)
	want := 100.0 * 100 / 150
	if !ok || math.Abs(res.Amount-want) > 1e-9 || math.Abs(res.ResistanceFactor-want/100) > 1e-9 {
		t.Fatalf("explicit bindings=%+v want%v", res, want)
	}
	src2 := attribute.FromMap(map[string]model.AttributeSlotDef{"armor_pen_percent": {Resolved: 2}, "lethality": {Resolved: -20}})
	res2, ok := authoredMitigate(t, 100, formuladefinition.PenetrationDefense("armor", "armor_pen_percent", "lethality"), target, src2)
	if !ok || res2.Amount != 100 {
		t.Fatalf("explicit clamp/floor=%+v", res2)
	}
	neg := attribute.FromMap(map[string]model.AttributeSlotDef{"armor": {Resolved: -50}})
	src3 := attribute.FromMap(map[string]model.AttributeSlotDef{"armor_pen_percent": {Resolved: 1}, "armor_pen_flat": {Resolved: 100}})
	res3, ok := authoredMitigate(t, 100, formuladefinition.PenetrationDefense("armor", "armor_pen_percent", "armor_pen_flat"), neg, src3)
	wantNeg := 100 * (2 - 100.0/(100-(-50)))
	if !ok || math.Abs(res3.Amount-wantNeg) > 1e-9 {
		t.Fatalf("explicit negative=%+v want%v", res3, wantNeg)
	}
}

func TestAuthoredDefenseExplicitMagicAndConstant(t *testing.T) {
	target := attribute.FromMap(map[string]model.AttributeSlotDef{"magic_resist": {Resolved: 100}})
	src := attribute.FromMap(map[string]model.AttributeSlotDef{"magic_pen_pct": {Resolved: 0.5}, "magic_pen_flat": {Resolved: 20}})
	res, ok := authoredMitigate(t, 100, formuladefinition.PenetrationDefense("magic_resist", "magic_pen_pct", "magic_pen_flat"), target, src)
	want := 100.0 * 100 / 130
	if !ok || math.Abs(res.Amount-want) > 1e-9 {
		t.Fatalf("magic=%+v want%v", res, want)
	}
	constantRes, ok := authoredMitigate(t, 100, formuladefinition.ConstantDefense("1"), attribute.FromMap(map[string]model.AttributeSlotDef{"armor": {Resolved: 200}, "magic_resist": {Resolved: 200}}), src)
	if !ok || constantRes.Amount != 100 || constantRes.ResistanceFactor != 1 {
		t.Fatalf("constant=%+v", constantRes)
	}
}

func TestResolveDamageUnknownTypeDoesNotMutate(t *testing.T) {
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}})
	view := CombatantView{Attributes: attrs, Shields: []ShieldInstance{{Remaining: 10}}}
	outcome, next := ResolveCommand(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/chaos",
	}, view, 0)
	if outcome.Amount != 0 || outcome.Applied {
		t.Fatalf("unknown type must not apply: %+v", outcome)
	}
	if attribute.ReadHP(next.Attributes) != 1000 {
		t.Fatalf("hp mutated=%v", attribute.ReadHP(next.Attributes))
	}
	if len(next.Shields) != 1 || next.Shields[0].Remaining != 10 {
		t.Fatalf("shield mutated=%+v", next.Shields)
	}
}

func TestResolveDamageNonFiniteDoesNotMutate(t *testing.T) {
	defense := formuladefinition.ConstantDefense("1")
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}})
	outcome, next := resolveAuthorDamage(t, defense, command.Command{
		Kind: command.KindDamage, Amount: math.NaN(), DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.HPDamage != 0 {
		t.Fatalf("nan must not apply: %+v", outcome)
	}
	if attribute.ReadHP(next.Attributes) != 1000 {
		t.Fatalf("hp mutated")
	}
}

func TestResolveExecuteThresholdSetsHPZeroPreservesShield(t *testing.T) {
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 40, Max: 1000}})
	view := CombatantView{
		Attributes: attrs,
		Shields: []ShieldInstance{
			{ShieldRef: "s1", Remaining: 200, Priority: 1},
			{ShieldRef: "s2", Remaining: 50, Priority: 0},
		},
	}
	outcome, next := ResolveExecuteThreshold(command.Command{
		Kind: command.KindExecuteThreshold, Target: "target", Threshold: 0.05,
	}, view)
	if !outcome.Applied || !outcome.Killed || !outcome.ShieldBypassed {
		t.Fatalf("outcome=%+v", outcome)
	}
	if outcome.HPBefore != 40 {
		t.Fatalf("hpBefore=%v want 40", outcome.HPBefore)
	}
	if attribute.ReadHP(next.Attributes) != 0 {
		t.Fatalf("hp=%v want 0", attribute.ReadHP(next.Attributes))
	}
	if len(next.Shields) != 2 {
		t.Fatalf("shields=%d want 2", len(next.Shields))
	}
	if next.Shields[0].Remaining != 200 || next.Shields[1].Remaining != 50 {
		t.Fatalf("shields mutated: %+v", next.Shields)
	}
}

func TestResolveExecuteThresholdNotDamageResult(t *testing.T) {
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 10, Max: 1000}})
	result, next := ResolveCommand(command.Command{
		Kind: command.KindExecuteThreshold, Target: "target",
	}, CombatantView{Attributes: attrs, Shields: []ShieldInstance{{Remaining: 30}}}, 0)
	if result.Kind != command.KindExecuteThreshold {
		t.Fatalf("kind=%q", result.Kind)
	}
	if !result.Applied || result.Amount != 0 {
		t.Fatalf("result=%+v want applied non-damage amount=0", result)
	}
	if attribute.ReadHP(next.Attributes) != 0 {
		t.Fatalf("hp=%v want 0", attribute.ReadHP(next.Attributes))
	}
	if len(next.Shields) != 1 || next.Shields[0].Remaining != 30 {
		t.Fatalf("shields=%+v", next.Shields)
	}
}

func TestResolveExecuteThresholdLiveDeadSkip(t *testing.T) {
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 0, Max: 1000}})
	view := CombatantView{
		Attributes: attrs,
		Shields:    []ShieldInstance{{ShieldRef: "keep", Remaining: 80}},
	}
	outcome, next := ResolveExecuteThreshold(command.Command{
		Kind: command.KindExecuteThreshold, Target: "target",
	}, view)
	if outcome.Applied || outcome.Killed {
		t.Fatalf("dead target must skip: %+v", outcome)
	}
	if attribute.ReadHP(next.Attributes) != 0 {
		t.Fatalf("hp=%v", attribute.ReadHP(next.Attributes))
	}
	if len(next.Shields) != 1 || next.Shields[0].Remaining != 80 {
		t.Fatalf("shields mutated: %+v", next.Shields)
	}
}

func TestResolveDamageAccumulatesAgainstDBShapedHP(t *testing.T) {
	defense := formuladefinition.ConstantDefense("1")
	// Real Web/DB slot: Base=Current=Max=Resolved=5000. SetHP only mutates Current;
	// refresh leaves Resolved at Base. ReadHP must accumulate on Current across hits.
	const initial = 5000.0
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp": {Base: initial, Current: initial, Max: initial, Resolved: initial},
	})
	view := CombatantView{Attributes: attrs}
	const hits = 10
	const perHit = 100.0
	for i := 0; i < hits; i++ {
		var outcome DamageOutcome
		outcome, view = resolveAuthorDamage(t, defense, command.Command{
			Kind: command.KindDamage, Amount: perHit, DamageType: "damage/true",
		}, view, 0)
		if outcome.HPDamage != perHit {
			t.Fatalf("hit %d hpDamage=%v want %v (ReadHP must not stick on Resolved)", i+1, outcome.HPDamage, perHit)
		}
	}
	want := initial - perHit*hits
	if got := attribute.ReadHP(view.Attributes); got != want {
		t.Fatalf("ReadHP=%v want %v", got, want)
	}
	if slot := view.Attributes.At("hp"); slot.Resolved != initial || slot.Base != initial {
		t.Fatalf("Base/Resolved mutated: %+v want both %v", slot, initial)
	}
}

func TestResolveExecuteThresholdCurrentZeroWithStaleResolved(t *testing.T) {
	// After execute, Base/Resolved may remain at initial; ReadHP must still see Current=0
	// so a second execute skips (stopOnTargetDeath=false path).
	const initial = 5000.0
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"hp": {Base: initial, Current: 200, Max: initial, Resolved: initial},
	})
	view := CombatantView{
		Attributes: attrs,
		Shields:    []ShieldInstance{{ShieldRef: "keep", Remaining: 50}},
	}
	outcome, next := ResolveExecuteThreshold(command.Command{
		Kind: command.KindExecuteThreshold, Target: "target", Threshold: 0.05,
	}, view)
	if !outcome.Applied || !outcome.Killed {
		t.Fatalf("first execute: %+v", outcome)
	}
	if attribute.ReadHP(next.Attributes) != 0 {
		t.Fatalf("hp=%v want 0", attribute.ReadHP(next.Attributes))
	}
	slot := next.Attributes.At("hp")
	if slot.Current != 0 {
		t.Fatalf("Current=%v want 0", slot.Current)
	}
	// Base/Resolved 不必清零；模拟 refresh 把 Resolved 写回 Base。
	slot.Resolved = slot.Base
	next.Attributes = next.Attributes.With("hp", slot)
	skip, after := ResolveExecuteThreshold(command.Command{
		Kind: command.KindExecuteThreshold, Target: "target", Threshold: 0.05,
	}, next)
	if skip.Applied || skip.Killed {
		t.Fatalf("second execute must skip with Current=0 stale Resolved: %+v", skip)
	}
	if attribute.ReadHP(after.Attributes) != 0 {
		t.Fatalf("hp after skip=%v", attribute.ReadHP(after.Attributes))
	}
	if len(after.Shields) != 1 || after.Shields[0].Remaining != 50 {
		t.Fatalf("shields=%+v", after.Shields)
	}
}

// 单测作者明确提供共同定义，pipeline只消费其已经求得的金额。
type authoredMitigation struct{ Amount, ResistanceFactor float64 }

func authoredMitigate(t *testing.T, raw float64, definition map[string]any, target, source attribute.Table) (authoredMitigation, bool) {
	t.Helper()
	if raw <= 0 || math.IsNaN(raw) || math.IsInf(raw, 0) {
		return authoredMitigation{}, false
	}
	var allowed []any
	var bindings []expression.Binding
	var values []inputbinding.Value
	for _, item := range definition["inputs"].([]any) {
		b := item.(map[string]any)["binding"].(map[string]any)
		binding := expression.Binding{Kind: "attribute", Object: b["object"].(string), AttributeKey: b["attributeKey"].(string), ValueKind: "TOTAL", View: "current_frame"}
		allowed = append(allowed, b)
		bindings = append(bindings, binding)
		attrs := target
		if binding.Object == "source" {
			attrs = source
		}
		slot, present := attrs.Lookup(binding.AttributeKey)
		values = append(values, inputbinding.Value{Total: inputbinding.Scalar{Value: slot.Resolved, Present: present && slot.HasResolved()}})
	}
	program, issue := expression.CompileDefinition(definition, allowed)
	if issue != nil {
		t.Fatalf("authored definition: %+v", issue)
	}
	plan, issue := inputbinding.Bind(program, bindings)
	if issue != nil {
		t.Fatal(issue)
	}
	reader, issue := plan.Reader(values)
	if issue != nil {
		t.Fatal(issue)
	}
	evaluated, issue := program.Evaluate(reader)
	if issue != nil {
		t.Fatal(issue)
	}
	return authoredMitigation{Amount: raw * evaluated.Value, ResistanceFactor: evaluated.Value}, true
}
func resolveAuthorDamage(t *testing.T, definition map[string]any, cmd command.Command, view CombatantView, now int64) (DamageOutcome, CombatantView) {
	t.Helper()
	mitigation, ok := authoredMitigate(t, cmd.Amount, definition, view.Attributes, attribute.Table{})
	if !ok {
		return DamageOutcome{}, view
	}
	return ApplyMitigatedDamage(cmd.Amount, mitigation.Amount, view, now, false)
}
