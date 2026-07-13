package pipeline

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/model"
)

func TestResolveDamageReducesHP(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{
		"hp": {Current: 1000, Max: 1000},
	}
	cmd := command.Command{Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical"}
	outcome, view := resolveDamage(cmd, CombatantView{Attributes: attrs}, 0)
	if outcome.HPDamage != 100 {
		t.Fatalf("hpDamage=%v want 100", outcome.HPDamage)
	}
	if attribute.ReadHP(view.Attributes) != 900 {
		t.Fatalf("hp=%v want 900", attribute.ReadHP(view.Attributes))
	}
}

func TestResolveDamageMustUsePipeline(t *testing.T) {
	called := false
	old := damageResolver
	damageResolver = func(cmd command.Command, view CombatantView, nowMs int64) (DamageOutcome, CombatantView) {
		called = true
		return old(cmd, view, nowMs)
	}
	defer func() { damageResolver = old }()

	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}}
	view := CombatantView{Attributes: attrs}
	ResolveCommand(command.Command{Kind: command.KindDamage, Amount: 50, DamageType: "damage/physical"}, view, 0)
	if !called {
		t.Fatal("damage must go through pipeline resolver")
	}
}

func TestResolveDamageShieldAbsorbFirst(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}}
	view := CombatantView{
		Attributes: attrs,
		Shields:    []ShieldInstance{{Remaining: 40}},
	}
	outcome, next := resolveDamage(command.Command{Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical"}, view, 0)
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
	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 950, Max: 1000}}
	_, healed := ResolveHeal(command.Command{Kind: command.KindHeal, Amount: 100}, attrs)
	if healed != 50 {
		t.Fatalf("healed=%v want 50", healed)
	}
	if attribute.ReadHP(attrs) != 1000 {
		t.Fatalf("hp=%v want 1000", attribute.ReadHP(attrs))
	}
}

func TestResolveDamageShieldPriorityOrder(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}}
	view := CombatantView{
		Attributes: attrs,
		Shields: []ShieldInstance{
			{ShieldRef: "high", Remaining: 30, Priority: 10},
			{ShieldRef: "low", Remaining: 30, Priority: 1},
		},
	}
	outcome, next := resolveDamage(command.Command{Kind: command.KindDamage, Amount: 40, DamageType: "damage/physical"}, view, 0)
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
	attrs := map[string]model.AttributeSlotDef{
		"hp":    {Current: 1000, Max: 1000},
		"armor": {Base: 100, Current: 100, Max: 100, Resolved: 100},
	}
	outcome, next := resolveDamage(command.Command{
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
	attrs := map[string]model.AttributeSlotDef{
		"hp":           {Current: 1000, Max: 1000},
		"magic_resist": {Base: 100, Current: 100, Max: 100, Resolved: 100},
	}
	outcome, _ := resolveDamage(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/magic",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 50 {
		t.Fatalf("mitigated=%v want 50", outcome.MitigatedAmount)
	}
}

func TestResolveDamageMagicalAliasUsesMagicResist(t *testing.T) {
	for _, dt := range []string{"magical", "damage/magical"} {
		attrs := map[string]model.AttributeSlotDef{
			"hp":           {Current: 1000, Max: 1000},
			"magic_resist": {Base: 100, Current: 100, Max: 100, Resolved: 100},
		}
		outcome, next := resolveDamage(command.Command{
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
	attrs := map[string]model.AttributeSlotDef{
		"hp":           {Current: 1000, Max: 1000},
		"armor":        {Resolved: 200},
		"magic_resist": {Resolved: 200},
	}
	outcome, _ := resolveDamage(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/true",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 100 || outcome.HPDamage != 100 {
		t.Fatalf("outcome=%+v want mitigated/hp 100", outcome)
	}
}

func TestResolveDamageZeroAndNegativeResistance(t *testing.T) {
	attrs0 := map[string]model.AttributeSlotDef{
		"hp": {Current: 1000, Max: 1000}, "armor": {Resolved: 0},
	}
	out0, _ := resolveDamage(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "physical",
	}, CombatantView{Attributes: attrs0}, 0)
	if out0.MitigatedAmount != 100 {
		t.Fatalf("R=0 mitigated=%v want 100", out0.MitigatedAmount)
	}

	attrsNeg := map[string]model.AttributeSlotDef{
		"hp": {Current: 1000, Max: 1000}, "armor": {Resolved: -50},
	}
	outNeg, _ := resolveDamage(command.Command{
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
	attrs := map[string]model.AttributeSlotDef{
		"hp":    {Current: 1000, Max: 1000},
		"armor": {Base: 100, Current: 100, Max: 100, Resolved: 0},
	}
	outcome, _ := resolveDamage(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 100 {
		t.Fatalf("Resolved=0 must ignore Current=100: mitigated=%v want 100", outcome.MitigatedAmount)
	}
}

func TestResolveDamageResistanceThenShield(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{
		"hp":    {Current: 1000, Max: 1000},
		"armor": {Resolved: 100},
	}
	view := CombatantView{
		Attributes: attrs,
		Shields:    []ShieldInstance{{Remaining: 20}},
	}
	// 100 physical / 100 armor => 50 mitigated; shield absorbs 20; HP takes 30.
	outcome, next := resolveDamage(command.Command{
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
	attrs := map[string]model.AttributeSlotDef{
		"hp":    {Current: 30, Max: 1000},
		"armor": {Resolved: 100},
	}
	outcome, next := resolveDamage(command.Command{
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
	}, CombatantView{Attributes: map[string]model.AttributeSlotDef{
		"hp": {Current: 30, Max: 1000}, "armor": {Resolved: 100},
	}}, 0)
	if result.Amount != 50 {
		t.Fatalf("Result.Amount=%v want 50 mitigated", result.Amount)
	}
}

func TestResolveDamagePhysicalDoesNotReadMR(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{
		"hp":           {Current: 1000, Max: 1000},
		"magic_resist": {Resolved: 100},
	}
	outcome, _ := resolveDamage(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 100 {
		t.Fatalf("physical must ignore MR: mitigated=%v", outcome.MitigatedAmount)
	}
}

func TestResolveDamageMagicDoesNotReadArmor(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{
		"hp":    {Current: 1000, Max: 1000},
		"armor": {Resolved: 100},
	}
	outcome, _ := resolveDamage(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/magic",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 100 {
		t.Fatalf("magic must ignore armor: mitigated=%v", outcome.MitigatedAmount)
	}
}

func TestResolveDamageIgnoresSourcePenetrationAttrs(t *testing.T) {
	// Source pen attrs are not passed into pipeline target view; even if present on target map, unused.
	attrs := map[string]model.AttributeSlotDef{
		"hp":             {Current: 1000, Max: 1000},
		"armor":          {Resolved: 100},
		"armor_pen_flat": {Resolved: 100},
		"armor_pen_pct":  {Resolved: 1},
	}
	outcome, _ := resolveDamage(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/physical",
	}, CombatantView{Attributes: attrs}, 0)
	if outcome.MitigatedAmount != 50 {
		t.Fatalf("pen must have no effect: mitigated=%v want 50", outcome.MitigatedAmount)
	}
}

func TestResolveDamageUnknownTypeDoesNotMutate(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}}
	view := CombatantView{Attributes: attrs, Shields: []ShieldInstance{{Remaining: 10}}}
	outcome, next := resolveDamage(command.Command{
		Kind: command.KindDamage, Amount: 100, DamageType: "damage/chaos",
	}, view, 0)
	if outcome.MitigatedAmount != 0 || outcome.HPDamage != 0 || outcome.ShieldAbsorbed != 0 {
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
	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 1000, Max: 1000}}
	outcome, next := resolveDamage(command.Command{
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
	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 40, Max: 1000}}
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
	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 10, Max: 1000}}
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
	attrs := map[string]model.AttributeSlotDef{"hp": {Current: 0, Max: 1000}}
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
