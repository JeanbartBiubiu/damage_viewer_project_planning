package pipeline

import (
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func TestAttributeResolverMultipleModifiersByPriority(t *testing.T) {
	registry := formula.GenericRegistry{
		Programs: []formula.GenericProgram{
			{Key: "v10", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}},
			{Key: "v5", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 5}}},
		},
	}
	provider := compilebundle.CompiledProvider{
		Modifiers: []compilebundle.CompiledModifier{
			{ModifierKey: "m_low", Kind: "attribute", Target: "attack_damage", ValuePolicy: "add", ValueProgram: 0, HasValue: true, Priority: 1},
			{ModifierKey: "m_high", Kind: "attribute", Target: "attack_damage", ValuePolicy: "add", ValueProgram: 1, HasValue: true, Priority: 5},
		},
	}
	var resolver AttributeResolver
	resolver.MountProviderModifiers("p1", provider, registry)
	attrs := map[string]model.AttributeSlotDef{
		"attack_damage": {Base: 100, Current: 100},
	}
	ctx := formula.GenericEvalContext{TargetAttrs: attrs}
	out := resolver.ResolveAttributes(attrs, ctx, registry)
	if out["attack_damage"].Resolved != 115 {
		t.Fatalf("resolved=%v want 115", out["attack_damage"].Resolved)
	}
}

func TestAttributeResolverUnmountProvider(t *testing.T) {
	registry := formula.GenericRegistry{
		Programs: []formula.GenericProgram{
			{Key: "v20", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 20}}},
		},
	}
	provider := compilebundle.CompiledProvider{
		Modifiers: []compilebundle.CompiledModifier{
			{ModifierKey: "buff", Kind: "attribute", Target: "attack_damage", ValuePolicy: "add", ValueProgram: 0, HasValue: true},
		},
	}
	var resolver AttributeResolver
	resolver.MountProviderModifiers("temp", provider, registry)
	attrs := map[string]model.AttributeSlotDef{"attack_damage": {Base: 50, Current: 50}}
	ctx := formula.GenericEvalContext{TargetAttrs: attrs}
	out := resolver.ResolveAttributes(attrs, ctx, registry)
	if out["attack_damage"].Resolved != 70 {
		t.Fatalf("resolved=%v want 70", out["attack_damage"].Resolved)
	}
	resolver.UnmountProvider("temp")
	out = resolver.ResolveAttributes(attrs, ctx, registry)
	if out["attack_damage"].Resolved != 50 {
		t.Fatalf("after unmount resolved=%v want 50", out["attack_damage"].Resolved)
	}
}

func TestAttributeResolverCanonicalPathTarget(t *testing.T) {
	registry := formula.GenericRegistry{
		Programs: []formula.GenericProgram{
			{Key: "v25", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 25}}},
		},
	}
	provider := compilebundle.CompiledProvider{
		Modifiers: []compilebundle.CompiledModifier{
			{ModifierKey: "path_buff", Kind: "attribute", Target: "source.attr.attack_damage", ValuePolicy: "add", ValueProgram: 0, HasValue: true},
		},
	}
	var resolver AttributeResolver
	resolver.MountProviderModifiers("p1", provider, registry)
	attrs := map[string]model.AttributeSlotDef{
		"attack_damage": {Base: 100, Current: 100},
	}
	ctx := formula.GenericEvalContext{TargetAttrs: attrs}
	out := resolver.ResolveAttributes(attrs, ctx, registry)
	if out["attack_damage"].Resolved != 125 {
		t.Fatalf("resolved=%v want 125 for canonical path target", out["attack_damage"].Resolved)
	}
}

func TestAttributeKeyFromModifierTarget(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"attack_damage", "attack_damage"},
		{"source.attr.attack_damage", "attack_damage"},
		{"target.attr.hp", "hp"},
		{"self.attr.armor", "armor"},
	}
	for _, tc := range cases {
		if got := AttributeKeyFromModifierTarget(tc.in); got != tc.want {
			t.Fatalf("AttributeKeyFromModifierTarget(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
	if got := ModifierTargetCombatantSelector("source.attr.attack_damage"); got != model.SelectorSource {
		t.Fatalf("selector=%q want source", got)
	}
	if got := ModifierTargetCombatantSelector("target.attr.attack_damage"); got != model.SelectorTarget {
		t.Fatalf("selector=%q want target", got)
	}
	if got := ModifierTargetCombatantSelector("attack_damage"); got != "" {
		t.Fatalf("bare key selector=%q want empty", got)
	}
}
