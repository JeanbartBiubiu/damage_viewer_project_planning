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
	resolver.MountProviderModifiers("source", "p1", provider, registry)
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
	resolver.MountProviderModifiers("source", "temp", provider, registry)
	attrs := map[string]model.AttributeSlotDef{"attack_damage": {Base: 50, Current: 50}}
	ctx := formula.GenericEvalContext{TargetAttrs: attrs}
	out := resolver.ResolveAttributes(attrs, ctx, registry)
	if out["attack_damage"].Resolved != 70 {
		t.Fatalf("resolved=%v want 70", out["attack_damage"].Resolved)
	}
	resolver.UnmountProviderOwned("source", "temp")
	out = resolver.ResolveAttributes(attrs, ctx, registry)
	if out["attack_damage"].Resolved != 50 {
		t.Fatalf("after unmount resolved=%v want 50", out["attack_damage"].Resolved)
	}
}

func TestAttributeResolverUnmountProviderOwnedIsolation(t *testing.T) {
	mod := compilebundle.CompiledModifier{
		ModifierKey: "shred", Kind: "attribute", Target: "opponent.attr.armor",
		ValuePolicy: "add", ValueProgram: 0, HasValue: true,
	}
	var resolver AttributeResolver
	resolver.MountCompiledModifierOwned("source", "provider_same_ref", mod)
	resolver.MountCompiledModifierOwned("target", "provider_same_ref", mod)
	if len(resolver.mounts) != 2 {
		t.Fatalf("mounts=%d want 2", len(resolver.mounts))
	}
	resolver.UnmountProviderOwned("source", "provider_same_ref")
	if len(resolver.mounts) != 1 {
		t.Fatalf("after source unmount mounts=%d want 1", len(resolver.mounts))
	}
	if resolver.mounts[0].OwnerCombatantKey != "target" {
		t.Fatalf("remaining owner=%q want target", resolver.mounts[0].OwnerCombatantKey)
	}
	// Legacy UnmountProvider("") must not remove owned mounts.
	resolver.UnmountProvider("provider_same_ref")
	if len(resolver.mounts) != 1 {
		t.Fatalf("empty-owner unmount must not remove owned mount, got %d", len(resolver.mounts))
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
	resolver.MountProviderModifiers("source", "p1", provider, registry)
	attrs := map[string]model.AttributeSlotDef{
		"attack_damage": {Base: 100, Current: 100},
	}
	ctx := formula.GenericEvalContext{TargetAttrs: attrs}
	out := resolver.ResolveAttributes(attrs, ctx, registry)
	if out["attack_damage"].Resolved != 125 {
		t.Fatalf("resolved=%v want 125 for canonical path target", out["attack_damage"].Resolved)
	}
}

func TestAttributeResolverPerModifierProviderContext(t *testing.T) {
	registry := formula.GenericRegistry{
		Programs: []formula.GenericProgram{
			{
				Key: "provider.state.stacks",
				Instr: []formula.GenericInstr{
					{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderState, ReadKey: "stacks"},
				},
			},
		},
	}
	var resolver AttributeResolver
	resolver.MountCompiledModifierOwned("source", "buff_a", compilebundle.CompiledModifier{
		ModifierKey: "a", Kind: "attribute", Target: "attack_damage",
		ValuePolicy: "add", ValueProgram: 0, HasValue: true,
	})
	resolver.MountCompiledModifierOwned("source", "buff_b", compilebundle.CompiledModifier{
		ModifierKey: "b", Kind: "attribute", Target: "attack_damage",
		ValuePolicy: "add", ValueProgram: 0, HasValue: true,
	})
	attrs := map[string]model.AttributeSlotDef{
		"attack_damage": {Base: 100, Current: 100},
	}
	baseCtx := formula.GenericEvalContext{
		TargetAttrs:   attrs,
		AbilityParams: map[string]float64{"keep": 9},
	}
	var seen []string
	out := resolver.ResolveAttributesWithProviderContext(attrs, baseCtx, registry, func(ownerKey, providerRef string) formula.GenericEvalContext {
		seen = append(seen, ownerKey+"|"+providerRef)
		switch providerRef {
		case "buff_a":
			return formula.GenericEvalContext{
				HasProviderContext: true,
				ProviderState:      map[string]float64{"stacks": 1},
				AbilityParams:      map[string]float64{"keep": -1},
			}
		case "buff_b":
			return formula.GenericEvalContext{
				HasProviderContext: true,
				ProviderState:      map[string]float64{"stacks": 3},
			}
		default:
			t.Fatalf("unexpected providerRef %q", providerRef)
			return formula.GenericEvalContext{}
		}
	})
	if len(seen) != 2 || seen[0] != "source|buff_a" || seen[1] != "source|buff_b" {
		t.Fatalf("providerRefs=%v want [source|buff_a source|buff_b]", seen)
	}
	if out["attack_damage"].Resolved != 104 {
		t.Fatalf("resolved=%v want 104", out["attack_damage"].Resolved)
	}
}

func TestAttributeResolverCrossCombatantOwnerContext(t *testing.T) {
	attrs := map[string]model.AttributeSlotDef{
		"armor": {Base: 100, Current: 100},
	}
	registry2 := formula.GenericRegistry{
		Programs: []formula.GenericProgram{
			{
				Key: "neg_pct",
				Instr: []formula.GenericInstr{
					{Op: formula.GenericOpConst, Value: -0.06},
					{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderTargetState, ReadKey: "carve_stacks"},
					{Op: formula.GenericOpMul},
				},
			},
		},
	}
	var r2 AttributeResolver
	r2.MountCompiledModifierOwned("source", "bc", compilebundle.CompiledModifier{
		ModifierKey: "carve", Kind: "attribute", Target: "opponent.attr.armor",
		ValuePolicy: "percent_add", ValueProgram: 0, HasValue: true,
	})
	out2 := r2.ResolveAttributesWithProviderContext(attrs, formula.GenericEvalContext{}, registry2, func(ownerKey, providerRef string) formula.GenericEvalContext {
		if ownerKey != "source" || providerRef != "bc" {
			t.Fatalf("unexpected provenance owner=%q ref=%q", ownerKey, providerRef)
		}
		return formula.GenericEvalContext{
			HasProviderContext:  true,
			ProviderTargetState: map[string]float64{"carve_stacks": 5},
		}
	})
	if out2["armor"].Resolved != 70 {
		t.Fatalf("armor=%v want 70 (100 * (1 - 0.30))", out2["armor"].Resolved)
	}
}

// TestAttributeResolverModifierKeyOrderBeforeOwnerProvider proves non-commutative same-priority
// aggregation keeps historical modifierKey order; OwnerCombatantKey/ProviderRef only break ties
// after ModifierKey and must not reorder distinct keys.
func TestAttributeResolverModifierKeyOrderBeforeOwnerProvider(t *testing.T) {
	registry := formula.GenericRegistry{
		Programs: []formula.GenericProgram{
			{Key: "mul2", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}},
			{Key: "add10", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}},
		},
	}
	var resolver AttributeResolver
	// Mount in reverse modifierKey order with owners that would reorder if owner sorted before key:
	// owner "zzz" / key "a_mul" then owner "aaa" / key "b_add".
	// Correct order by modifierKey: a_mul then b_add => (100*2)+10 = 210.
	// If owner sorted before modifierKey: aaa/b_add then zzz/a_mul => (100+10)*2 = 220.
	resolver.MountCompiledModifierOwned("zzz", "prov_z", compilebundle.CompiledModifier{
		ModifierKey: "a_mul", Kind: "attribute", Target: "attack_damage",
		ValuePolicy: "multiply", ValueProgram: 0, HasValue: true, Priority: 1,
	})
	resolver.MountCompiledModifierOwned("aaa", "prov_a", compilebundle.CompiledModifier{
		ModifierKey: "b_add", Kind: "attribute", Target: "attack_damage",
		ValuePolicy: "add", ValueProgram: 1, HasValue: true, Priority: 1,
	})
	attrs := map[string]model.AttributeSlotDef{
		"attack_damage": {Base: 100, Current: 100},
	}
	out := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{TargetAttrs: attrs}, registry)
	if out["attack_damage"].Resolved != 210 {
		t.Fatalf("resolved=%v want 210 (modifierKey order); owner/provider must not reorder distinct keys", out["attack_damage"].Resolved)
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
		{"opponent.attr.armor", "armor"},
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
	if got := ModifierTargetCombatantSelector("opponent.attr.armor"); got != model.SelectorOpponent {
		t.Fatalf("selector=%q want opponent", got)
	}
	if got := ModifierTargetCombatantSelector("attack_damage"); got != "" {
		t.Fatalf("bare key selector=%q want empty", got)
	}
}
