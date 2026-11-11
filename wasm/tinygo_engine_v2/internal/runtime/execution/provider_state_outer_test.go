package execution

import (
	"testing"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestProviderStateOuterLiveRemovalKeepsFrameEntries(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	frame := state.newExecutionFrame("source", "target", "before-remove")
	view := frame.stageFor("source").providerState.Publish()
	bag := view.Lookup("attack")
	if !bag.Present() {
		t.Fatal("missing fixture bag")
	}
	want := providerStateOwnershipSnapshot(bag)
	state.removeProviderInstance("source", "attack", formula.GenericEvalContext{}, "")
	if state.combatants["source"].providerState.Lookup("attack").Present() {
		t.Fatal("live removal lost detached map")
	}
	if view.Lookup("attack") != bag {
		t.Fatal("live removal changed staged outer entries")
	}
	assertProviderStateOwnershipView(t, "saved before removal", bag, want)
}

func TestProviderStateOuterReadPreparationDetachesAndPublishes(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	frame := state.newExecutionFrame("source", "target", "before-expiry")
	view := frame.stageFor("source").providerState.Publish()
	bag := view.Lookup("attack")
	want := providerStateOwnershipSnapshot(bag)
	state.loop.Advance(50)
	context := state.providerFormulaContextFunc("source", "target")("source", "attack")
	live := state.combatants["source"]
	if live.providerState.Lookup("attack") == bag || context.ProviderState.At("stacks") != 0 || live.providerState.Lookup("attack").ExpireAt().At("stacks") != 0 {
		t.Fatal("live preparation was not published")
	}
	assertProviderStateOwnershipView(t, "saved before live preparation", bag, want)
	// 属性刷新会调用状态读取；保存属性时必须保留回调发布的新外层表。
	change := live.providerState.Edit("attack", false)
	change.SetStateValue("stacks", 4)
	change.SetExpireAt("stacks", 50)
	program := formula.GenericProgramID(state.formulas.Metadata.Count())
	fixtureAppendFormula(&state.formulas, formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 0}}})
	live.instances.MountAttributeCompiled("source", "attack", planbundle.CompiledModifier{ModifierKey: "expiry-read", Kind: "attribute", Target: "hp", ValuePolicy: "add", HasValue: true, ValueProgram: program})
	state.combatants["source"] = live
	state.newExecutionFrame("source", "target", "freeze-again").stageFor("source")
	state.refreshProviderAwareAttributes("source", "target")
	if state.combatants["source"].providerState.Lookup("attack").State().At("stacks") != 0 {
		t.Fatal("attribute refresh restored stale state table")
	}
}
