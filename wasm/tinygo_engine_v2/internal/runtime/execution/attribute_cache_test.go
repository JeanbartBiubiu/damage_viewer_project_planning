package execution

import (
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func memoTestResolver(read formula.GenericInstr) (Engine, effectpkg.AttributeResolver) {
	state := Engine{loop: newTestLoopAt(0), formulas: fixtureFormulaLibrary([]formula.GenericProgram{{Key: "memo", Instr: []formula.GenericInstr{read}}})}
	resolver := effectpkg.AttributeResolver{}
	resolver.MountCompiledModifierOwned("source", "buff", planbundle.CompiledModifier{Kind: "attribute", Target: "speed", HasValue: true, ValueProgram: 0, ValuePolicy: "add"})
	return state, resolver
}

func TestAttributeRefreshMemoHealthOnlyAndActualHealthDependency(t *testing.T) {
	for _, readsHealth := range []bool{false, true} {
		state := Engine{loop: newTestLoopAt(0), combatants: map[string]combatantRuntime{
			"source": {numbers: actor.New("source", attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100), "speed": authoringSlot(100)}), nil)},
			"target": {numbers: actor.New("target", attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)}), nil)},
		}}
		if readsHealth {
			read := formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "hp.current"}
			programs, resolver := memoTestResolver(read)
			state.formulas = programs.formulas
			host := state.combatants["source"]
			host.instances.SetAttributes(resolver)
			state.combatants["source"] = host
		}
		frame := state.newExecutionFrame("source", "target", "")
		ability := planbundle.CompiledAbility{}
		frame.reResolveStagedAttributesTwoPass(ability)
		frame.reResolveStagedAttributesTwoPass(ability) // 依赖已稳定。
		host := frame.stageFor("source")
		hp := host.attributesView().At("hp")
		hp.Current, hp.Resolved = 20, 20

		host.setAttributes(host.attributesView().With("hp", hp))
		_, _, unchanged := frame.refreshMemo(frame.evalContext(ability))
		if unchanged == readsHealth {
			t.Fatalf("health dependency=%v, unchanged=%v", readsHealth, unchanged)
		}
		frame.reResolveStagedAttributesTwoPass(ability)
		want := 100.0
		if readsHealth {
			want = 120
		}
		if frame.fatal || host.attributesView().At("speed").Resolved != want || host.attributesView().At("hp").Current != 20 || host.attributesView().At("hp").Resolved != 20 {
			t.Fatal(readsHealth, host.attributesView(), frame.fatalErr)
		}
		if !readsHealth {
			allocs := testing.AllocsPerRun(20, func() { frame.reResolveStagedAttributesTwoPass(ability) })
			if allocs != 0 {
				t.Fatalf("unchanged refresh allocated %.1f objects", allocs)
			}
		}
	}
}
