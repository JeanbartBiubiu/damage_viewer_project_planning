package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestProviderStateOuterReadonlyBorrowAndFirstWrite(t *testing.T) {
	bag := providerStateOwnershipBag()
	bag.fieldDefaults = map[string]float64{"stacks": 0}
	original := map[string]*providerStateBag{"attack": bag}
	frame := stagedCombatant{providerState: freezeProviderStateView(original), providerStateShared: true}
	initial := providerStateOwnershipSnapshot(bag)
	if count := testing.AllocsPerRun(100, func() {
		got := readSharedProviderStateBag(&frame.providerState, &frame.providerStateShared, "attack", false, nil, 0, providerStateReadOptions{})
		if got != bag {
			t.Fatal("prepared read copied a header")
		}
		if readSharedProviderStateBag(&frame.providerState, &frame.providerStateShared, "missing", false, nil, 0, providerStateReadOptions{}) != nil {
			t.Fatal("missing read inserted a bag")
		}
	}); count != 0 {
		t.Fatalf("readonly borrowing allocated %v", count)
	}
	owned := writableProviderStateBag(frame.writableProviderStates(), "attack", false)
	owned.writableState()["stacks"] = 33
	writableProviderStateBag(frame.writableProviderStates(), "created", true)
	if frame.providerStateShared || len(original) != 1 || original["attack"] != bag || owned == bag || len(frame.providerState) != 2 {
		t.Fatal("first write did not detach outer and header")
	}
	assertProviderStateOwnershipView(t, "original after first write", bag, initial)
	view := frame.readonlyProviderStates()
	delete(frame.writableProviderStates(), "created")
	if len(view) != 2 || len(frame.providerState) != 1 {
		t.Fatal("post-publication delete changed old outer view")
	}
}

func TestProviderStateOuterNilNormalizationKeepsLiveSource(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	c := state.combatants["source"]
	c.providerState["empty"] = nil
	state.combatants["source"] = c
	frame := state.newExecutionFrame("source", "target", "nil-test")
	staged := frame.stageFor("source")
	if state.combatants["source"].providerState["empty"] != nil || staged.providerState["empty"] == nil || !staged.providerState["empty"].headerShared {
		t.Fatal("nil normalization changed live source or published an owned header")
	}
	frame.commit()
	published := state.combatants["source"].providerState
	stagedEmpty := staged.providerState["empty"]
	owned := writableProviderStateBag(staged.writableProviderStates(), "empty", false)
	owned.writableState()["new"] = 1
	if owned == stagedEmpty || published["empty"] != stagedEmpty || len(stagedEmpty.state) != 0 {
		t.Fatal("normalized empty header was writable across publication")
	}
}

func TestProviderStateOuterLiveRemovalKeepsFrameEntries(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	frame := state.newExecutionFrame("source", "target", "before-remove")
	view := frame.stageFor("source").providerState
	bag := view["attack"]
	if bag == nil {
		t.Fatal("missing fixture bag")
	}
	want := providerStateOwnershipSnapshot(bag)
	state.removeProviderInstance("source", "attack", formula.GenericEvalContext{}, "")
	if _, exists := state.combatants["source"].providerState["attack"]; exists {
		t.Fatal("live removal lost detached map")
	}
	if view["attack"] != bag {
		t.Fatal("live removal changed staged outer entries")
	}
	assertProviderStateOwnershipView(t, "saved before removal", bag, want)
}

func TestProviderStateOuterReadPreparationDetachesAndPublishes(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	frame := state.newExecutionFrame("source", "target", "before-expiry")
	view := frame.stageFor("source").providerState
	bag := view["attack"]
	want := providerStateOwnershipSnapshot(bag)
	state.nowMs = 50
	context := state.providerFormulaContextFunc("source", "target")("source", "attack")
	live := state.combatants["source"]
	if live.providerState["attack"] == bag || live.providerStateShared || context.ProviderState["stacks"] != 0 || live.providerState["attack"].expireAt["stacks"] != 0 {
		t.Fatal("live preparation was not published")
	}
	assertProviderStateOwnershipView(t, "saved before live preparation", bag, want)
	// 属性刷新会调用状态读取；保存属性时必须保留回调发布的新外层表。
	live.providerState["attack"].writableState()["stacks"] = 4
	live.providerState["attack"].writableExpireAt()["stacks"] = 50
	program := formula.GenericProgramID(len(state.formulas.Programs))
	state.formulas.Programs = append(state.formulas.Programs, formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 0}}})
	live.resolver.MountCompiledModifierOwned("source", "attack", planbundle.CompiledModifier{ModifierKey: "expiry-read", Kind: "attribute", Target: "hp", ValuePolicy: "add", HasValue: true, ValueProgram: program})
	state.combatants["source"] = live
	state.newExecutionFrame("source", "target", "freeze-again").stageFor("source")
	state.refreshProviderAwareAttributes("source", "target")
	if state.combatants["source"].providerState["attack"].state["stacks"] != 0 {
		t.Fatal("attribute refresh restored stale state table")
	}
}
