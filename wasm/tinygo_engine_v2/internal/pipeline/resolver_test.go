package pipeline

import (
	"testing"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/model"
)

func TestResolveDamageReducesHP(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{
		"hp": {Current: 1000, Max: 1000},
	}
	cmd := command.Command{Kind: command.KindDamage, Amount: 100}
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
	ResolveCommand(command.Command{Kind: command.KindDamage, Amount: 50}, view, 0)
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
	outcome, next := resolveDamage(command.Command{Kind: command.KindDamage, Amount: 100}, view, 0)
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
	outcome, next := resolveDamage(command.Command{Kind: command.KindDamage, Amount: 40}, view, 0)
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
