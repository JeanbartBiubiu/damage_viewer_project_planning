package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestDerivedPageCacheStillMaterializesMissingZeroOutput(t *testing.T) {
	for _, modifier := range []bool{false, true} {
		t.Run(map[bool]string{false: "zero", true: "modifier_dependency"}[modifier], func(t *testing.T) {
			layout := attribute.NewLayout([]string{"hp", "force", "pulse"})
			attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100), "pulse": authoringSlot(0)}, layout)
			state := Engine{loop: newTestLoopAt(0), formulas: formula.GenericRegistry{Programs: []formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 0}}}, {Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "pulse.base"}}}}}, compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{CombatantKey: "source", AttributeKey: "force", ValueProgram: 0, ValuePolicy: "set", ValueType: "FLOAT", Path: "derived.force"}}}}
			resolver := effectpkg.AttributeResolver{}
			if modifier {
				resolver.MountCompiledModifierOwned("source", "buff", planbundle.CompiledModifier{Kind: "attribute", Target: "force", HasValue: true, ValueProgram: 1, ValuePolicy: "add"})
			}
			for round := 0; round < 3; round++ {
				if round == 2 {
					attrs = attrs.With("pulse", authoringSlot(3))
				}
				want, err := resolveDerivedAttributes(state.compiled, state.formulas, "source", attrs, resolver, attrs, attrs, nil)
				if err != nil {
					t.Fatal(err)
				}
				got, err := state.resolveDerivedAttributesCached("source", attrs, resolver, attrs, attrs, nil)
				if _, exists := got.Lookup("force"); err != nil || !exists || !reflect.DeepEqual(got.ToMap(), want.ToMap()) {
					t.Fatalf("round=%d missing zero derived output: got=%+v want=%+v err=%v", round, got.ToMap(), want.ToMap(), err)
				}
				if _, exists := attrs.Lookup("force"); exists {
					t.Fatal("derived calculation published into input")
				}
			}
		})
	}
}
