package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestDerivedCacheOnlyReplaysOutputsAndChecksMultiplyInput(t *testing.T) {
	for _, policy := range []string{"set", "multiply"} {
		t.Run(policy, func(t *testing.T) {
			state := Engine{loop: newTestLoopAt(0),
				formulas: formula.GenericRegistry{Programs: []formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}}}},
				compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{CombatantKey: "source", AttributeKey: "speed", ValueProgram: 0, ValuePolicy: policy, ValueType: "FLOAT", Path: "derived.speed"}}},
			}
			resolver := effectpkg.AttributeResolver{}
			attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100), "speed": authoringSlot(100), "other": authoringSlot(100)})
			target := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})
			if _, err := state.resolveDerivedAttributesCached("source", attrs, resolver, attrs, target, nil); err != nil {
				t.Fatal(err)
			}
			hp, other := attrs.At("hp"), attrs.At("other")
			hp.Current, hp.Resolved, other.Resolved = 20, 20, 70
			attrs = attrs.With("hp", hp).With("other", other)
			memo := state.attributeMemo("source", true, false, [2]string{}, resolver, attrs)
			ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: attrs, TargetAttrs: target}
			if !memo.probe(attrs, &ctx, nil) {
				t.Fatal("unrelated HP/resolved changes invalidated derived output")
			}
			result, err := state.resolveDerivedAttributesCached("source", attrs, resolver, attrs, target, nil)
			if err != nil || result.At("hp") != hp || result.At("other") != other {
				t.Fatal("derived cache rewound unrelated inputs", result, err)
			}
			speed := attrs.At("speed")
			speed.Resolved = 130
			attrs = attrs.With("speed", speed)
			hit := memo.probe(attrs, &ctx, nil)
			if hit != (policy == "set") {
				t.Fatal("incorrect direct input dependency", policy, hit)
			}
			result, err = state.resolveDerivedAttributesCached("source", attrs, resolver, attrs, target, nil)
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
	state := Engine{loop: newTestLoopAt(0), compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{CombatantKey: "target", AttributeKey: "speed", ValuePolicy: "set"}}}}
	resolver := effectpkg.AttributeResolver{}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})
	_, err := state.resolveDerivedAttributesCached("source", attrs, resolver, attrs, attrs, nil)
	if err != nil {
		t.Fatal(err)
	}
	hp := attrs.At("hp")
	hp.Current, hp.Resolved = 20, 20
	attrs = attrs.With("hp", hp)
	allocs := testing.AllocsPerRun(20, func() {
		result, err := state.resolveDerivedAttributesCached("source", attrs, resolver, attrs, attrs, nil)
		if err != nil || result.At("hp") != hp {
			t.Fatal(result, err)
		}
	})
	if allocs != 0 {
		t.Fatalf("no-output derived cache allocated %.1f objects", allocs)
	}
}
