package evaluation

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestDerivedCacheOnlyReplaysOutputsAndChecksMultiplyInput(t *testing.T) {
	for _, policy := range []string{"set", "multiply"} {
		t.Run(policy, func(t *testing.T) {
			state := attributeFixture{formulas: fixtureFormulaLibrary([]formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}}}),
				compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{CombatantKey: "source", AttributeKey: "speed", ValueProgram: 0, ValuePolicy: policy, ValueType: "FLOAT", Path: "derived.speed"}}},
			}
			resolver := effectpkg.AttributeResolver{}
			attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100), "speed": authoringSlot(100), "other": authoringSlot(100)})
			target := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})
			if _, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, target, nil); err != nil {
				t.Fatal(err)
			}
			hp, other := attrs.At("hp"), attrs.At("other")
			hp.Current, hp.Resolved, other.Resolved = 20, 20, 70
			attrs = attrs.With("hp", hp).With("other", other)
			memo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "source", true, false, [2]string{}, resolver, attrs)
			ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: attrs, TargetAttrs: target}
			if !memo.Probe(attrs, &ctx, nil) {
				t.Fatal("unrelated HP/resolved changes invalidated derived output")
			}
			result, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, target, nil)
			if err != nil || result.At("hp") != hp || result.At("other") != other {
				t.Fatal("derived cache rewound unrelated inputs", result, err)
			}
			speed := attrs.At("speed")
			speed.Resolved = 130
			attrs = attrs.With("speed", speed)
			hit := memo.Probe(attrs, &ctx, nil)
			if hit != (policy == "set") {
				t.Fatal("incorrect direct input dependency", policy, hit)
			}
			result, err = state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, target, nil)
			want := 2.0
			if policy == "multiply" {
				want = 260
			}
			if err != nil || result.At("speed").Resolved != want || result.At("hp") != hp || result.At("other") != other {
				t.Fatal(result, want, err)
			}
		})
	}
}

func TestDerivedCacheWithoutActorOutputKeepsInputAndAllocatesNothing(t *testing.T) {
	state := attributeFixture{compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{CombatantKey: "target", AttributeKey: "speed", ValuePolicy: "set"}}}}
	resolver := effectpkg.AttributeResolver{}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})
	_, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, attrs, nil)
	if err != nil {
		t.Fatal(err)
	}
	hp := attrs.At("hp")
	hp.Current, hp.Resolved = 20, 20
	attrs = attrs.With("hp", hp)
	allocs := testing.AllocsPerRun(20, func() {
		result, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, attrs, nil)
		if err != nil || result.At("hp") != hp {
			t.Fatal(result, err)
		}
	})
	if allocs != 0 {
		t.Fatalf("no-output derived cache allocated %.1f objects", allocs)
	}
}

func TestFinalAttributeLimitAppliesAfterSetAndMultiplyDerivations(t *testing.T) {
	for _, test := range []struct {
		name, policy string
		base, factor float64
		want         float64
	}{
		{"set_then_total", "set", 2, 2, 3.33},
		{"multiply_increases", "multiply", 2, 2, 3.33},
		{"multiply_decreases", "multiply", 4, .5, 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := attributeFixture{formulas: fixtureFormulaLibrary([]formula.GenericProgram{
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: test.factor}}},
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 3.33}}},
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}},
			}), compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{CombatantKey: "source", AttributeKey: "speed", ValueProgram: 0, ValuePolicy: test.policy, ValueType: "DECIMAL", Path: "derived.speed"}}}}
			resolver := effectpkg.AttributeResolver{}
			resolver.MountCompiledModifierOwned("source", "cap", planbundle.CompiledModifier{ModifierKey: "cap", Kind: "attribute", Target: "speed", Stage: "final", ValuePolicy: "min", HasValue: true, ValueProgram: 1})
			if test.policy == "set" {
				resolver.MountCompiledModifierOwned("source", "total", planbundle.CompiledModifier{ModifierKey: "total", Kind: "attribute", Target: "speed", Stage: "total", ValuePolicy: "multiply", HasValue: true, ValueProgram: 2})
			}
			attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(test.base)})
			ordinary, err := state.cache.ResolveOrdinary(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs}, nil)
			if err != nil {
				t.Fatal(err)
			}
			got, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", ordinary, resolver, ordinary, ordinary, nil)
			if err != nil || got.At("speed").Resolved != test.want {
				t.Fatal("final bound ran before all derivation arithmetic", got.At("speed").Resolved, test.want, err)
			}
		})
	}
}

func TestFinalLimitDerivedCacheTracksActualExpiryAndUnmount(t *testing.T) {
	state := attributeFixture{formulas: fixtureFormulaLibrary([]formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 3.33}}},
	}), compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{CombatantKey: "source", AttributeKey: "speed", ValueProgram: 0, ValuePolicy: "multiply", ValueType: "DECIMAL", Path: "derived.speed"}}}}
	resolver := effectpkg.AttributeResolver{}
	resolver.MountCompiledModifierOwned("source", "cap", planbundle.CompiledModifier{ModifierKey: "cap", Kind: "attribute", Target: "speed", Stage: "final", ValuePolicy: "min", HasValue: true, ValueProgram: 1})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(2)})
	var now int64
	expiry := int64(1100)
	provider := func(owner, ref string) pipeline.ProviderFormulaContext {
		if owner != "source" || ref != "cap" {
			t.Fatal("final bound lost its actual instance identity", owner, ref)
		}
		return pipeline.ProviderFormulaContext{SkipExpiredAttributeModifier: now >= expiry}
	}
	for _, test := range []struct {
		now, refresh int64
		want         float64
	}{{100, 0, 3.33}, {600, 1600, 3.33}, {1100, 0, 3.33}, {1600, 0, 4}} {
		now = test.now
		if test.refresh != 0 {
			expiry = test.refresh
		}
		got, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, attrs, provider)
		if err != nil || got.At("speed").Resolved != test.want {
			t.Fatal("derived memo ignored final-bound refresh or exact expiry", now, got, test.want, err)
		}
	}
	resolver.UnmountProviderOwned("source", "cap")
	got, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, attrs, nil)
	if err != nil || got.At("speed").Resolved != 4 {
		t.Fatal("unmounted final bound survived in the derived memo", got, err)
	}
}
