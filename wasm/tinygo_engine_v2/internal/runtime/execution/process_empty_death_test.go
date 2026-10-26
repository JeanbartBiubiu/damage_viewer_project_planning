package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/runtime/actor"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
)

func TestProcessDeathWithoutPendingDoesNotAllocateOrChangeInstances(t *testing.T) {
	state := Engine{loop: newTestLoopAt(0), combatants: map[string]combatantRuntime{
		"source": {numbers: actor.New("", attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)}), nil)},
		"target": {numbers: actor.New("", attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(0)}), nil)},
	}}
	for _, p := range identityCacheFixtures() {
		state.actions.AddProcess(p)
	}
	for processSlot := 0; processSlot < state.actions.ProcessCount(); processSlot++ {
		p := state.actions.ProcessAt(processSlot)
		if p.Owner() == "target" {
			changes := actionpkg.StageProcess(p)
			changes.Finish("complete", "", 0)
			changes.Publish(p)
		}
	}
	before := state.actions.ProcessViews()
	statuses := make([]string, len(before))
	for index, p := range before {
		statuses[index] = p.Status()
	}
	allocations := testing.AllocsPerRun(20, func() {
		if err := state.failDeadProcesses(); err != nil {
			t.Fatal(err)
		}
	})
	if allocations != 0 || state.settlingProcessDeaths || !reflect.DeepEqual(state.actions.ProcessViews(), before) {
		t.Fatalf("empty settlement allocated %.1f objects or changed state", allocations)
	}
	for index := 0; index < state.actions.ProcessCount(); index++ {
		p := state.actions.ProcessAt(index)
		if p.Status() != statuses[index] {
			t.Fatal("no-op death settlement changed process status")
		}
	}
}

func TestProcessDeathEmptyPathKeepsExistingRecursionFlagBehavior(t *testing.T) {
	state := Engine{loop: newTestLoopAt(0), settlingProcessDeaths: true, combatants: map[string]combatantRuntime{
		"target": {numbers: actor.New("", attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(0)}), nil)},
	}}
	state.actions.AddProcess(actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: "target", Status: "complete"}}))
	if err := state.failDeadProcesses(); err != nil || state.settlingProcessDeaths {
		t.Fatal("direct nested call changed the original deferred flag reset", err)
	}
}
