package pipeline

import (
	"math"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
)

func TestApplyDamageValuePolicySubtract(t *testing.T) {
	if got := ApplyDamageValuePolicy(20, "subtract", 7); math.Abs(got-13) > 1e-9 {
		t.Fatalf("got=%v want 13", got)
	}
	if got := ApplyDamageValuePolicy(5, "subtract", 9); got != 0 {
		t.Fatalf("got=%v want 0", got)
	}
	if got := ApplyDamageValuePolicy(10, "multiply", 1.5); math.Abs(got-15) > 1e-9 {
		t.Fatalf("multiply got=%v", got)
	}
}

func TestCollectForChannelsDedupesAndOrders(t *testing.T) {
	var r DamageModifierResolver
	r.MountCompiledModifierOwned("source", "item:a", compilebundle.CompiledModifier{
		ModifierKey: "shared", Kind: "pipeline", Command: "damage", Channel: "all_damage",
		Stage: "outgoing_pre_mitigation", Priority: 10, ValuePolicy: "multiply", HasValue: true,
	})
	r.MountCompiledModifierOwned("source", "item:a", compilebundle.CompiledModifier{
		ModifierKey: "shared", Kind: "pipeline", Command: "damage", Channel: "basic_damage",
		Stage: "outgoing_pre_mitigation", Priority: 10, ValuePolicy: "multiply", HasValue: true,
	})
	r.MountCompiledModifierOwned("source", "item:b", compilebundle.CompiledModifier{
		ModifierKey: "early", Kind: "pipeline", Command: "damage", Channel: "all_damage",
		Stage: "outgoing_pre_mitigation", Priority: 1, ValuePolicy: "subtract", HasValue: true,
	})
	got := r.CollectForChannelsWithMatches([]string{"all_damage", "basic_damage"}, "outgoing_pre_mitigation")
	if len(got) != 2 {
		t.Fatalf("len=%d want 2: %+v", len(got), got)
	}
	if got[0].Modifier.ModifierKey != "early" || got[1].Modifier.ModifierKey != "shared" {
		t.Fatalf("order=%v/%v", got[0].Modifier.ModifierKey, got[1].Modifier.ModifierKey)
	}
	if len(got[1].MatchedChannels) != 2 || got[1].MatchedChannels[0] != "all_damage" || got[1].MatchedChannels[1] != "basic_damage" {
		t.Fatalf("matchedChannels=%v", got[1].MatchedChannels)
	}
}

func TestCollectForCommandChannelsFiltersCommandAndStage(t *testing.T) {
	var r DamageModifierResolver
	r.MountCompiledModifierOwned("source", "item:crit", compilebundle.CompiledModifier{
		ModifierKey: "chance", Kind: "pipeline", Command: "crit", Channel: "all_damage",
		Stage: "crit_chance_pre_settlement", Priority: 5, ValuePolicy: "override", HasValue: true,
	})
	r.MountCompiledModifierOwned("source", "item:crit", compilebundle.CompiledModifier{
		ModifierKey: "chance_basic", Kind: "pipeline", Command: "crit", Channel: "basic_damage",
		Stage: "crit_chance_pre_settlement", Priority: 5, ValuePolicy: "override", HasValue: true,
	})
	r.MountCompiledModifierOwned("source", "item:out", compilebundle.CompiledModifier{
		ModifierKey: "out", Kind: "pipeline", Command: "damage", Channel: "all_damage",
		Stage: "outgoing_pre_mitigation", Priority: 1, ValuePolicy: "multiply", HasValue: true,
	})
	r.MountCompiledModifierOwned("target", "item:randuin", compilebundle.CompiledModifier{
		ModifierKey: "crit_part", Kind: "pipeline", Command: "damage", Channel: "all_damage",
		Stage: "incoming_crit_part_post_mitigation", Priority: 0, ValuePolicy: "multiply", HasValue: true,
	})

	critGot := r.CollectForCommandChannelsWithMatches("crit", []string{"all_damage", "basic_damage"}, "crit_chance_pre_settlement")
	if len(critGot) != 2 {
		t.Fatalf("crit len=%d want 2", len(critGot))
	}
	if critGot[0].Modifier.ModifierKey != "chance" && critGot[0].Modifier.ModifierKey != "chance_basic" {
		t.Fatalf("unexpected first=%v", critGot[0].Modifier.ModifierKey)
	}
	damageGot := r.CollectForCommandChannelsWithMatches("damage", []string{"all_damage"}, "outgoing_pre_mitigation")
	if len(damageGot) != 1 || damageGot[0].Modifier.ModifierKey != "out" {
		t.Fatalf("damage outgoing=%+v", damageGot)
	}
	partGot := r.CollectForCommandChannelsWithMatches("damage", []string{"all_damage"}, "incoming_crit_part_post_mitigation")
	if len(partGot) != 1 || partGot[0].Modifier.OwnerCombatantKey != "target" {
		t.Fatalf("crit part host routing=%+v", partGot)
	}
	// Crit command must not collect damage-stage mounts.
	if mixed := r.CollectForCommandChannelsWithMatches("crit", []string{"all_damage"}, "outgoing_pre_mitigation"); len(mixed) != 0 {
		t.Fatalf("crit must not collect damage stage: %+v", mixed)
	}
}

