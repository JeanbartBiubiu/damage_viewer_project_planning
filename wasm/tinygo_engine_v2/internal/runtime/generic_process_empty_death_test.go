package runtime

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/model"
)

func TestProcessDeathWithoutPendingDoesNotAllocateOrChangeInstances(t *testing.T) {
	state := genericRunState{combatants: map[string]combatantRuntime{
		"source": {attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})},
		"target": {attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(0)})},
	}, processInstances: identityCacheFixtures()}
	for _, p := range state.processInstances {
		if p.Owner == "target" {
			p.Status = "complete"
		}
	}
	before := append([]*processRuntime(nil), state.processInstances...)
	statuses := make([]string, len(before))
	for index, p := range before {
		statuses[index] = p.Status
	}
	allocations := testing.AllocsPerRun(20, func() {
		if err := state.failDeadProcesses(); err != nil {
			t.Fatal(err)
		}
	})
	if allocations != 0 || state.settlingProcessDeaths || !reflect.DeepEqual(state.processInstances, before) {
		t.Fatalf("empty settlement allocated %.1f objects or changed state", allocations)
	}
	for index, p := range state.processInstances {
		if p.Status != statuses[index] {
			t.Fatal("no-op death settlement changed process status")
		}
	}
}

func TestProcessDeathEmptyPathKeepsExistingRecursionFlagBehavior(t *testing.T) {
	state := genericRunState{settlingProcessDeaths: true, combatants: map[string]combatantRuntime{
		"target": {attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(0)})},
	}, processInstances: []*processRuntime{{ProcessInstanceSnapshot: model.ProcessInstanceSnapshot{Owner: "target", Status: "complete"}}}}
	if err := state.failDeadProcesses(); err != nil || state.settlingProcessDeaths {
		t.Fatal("direct nested call changed the original deferred flag reset", err)
	}
}
