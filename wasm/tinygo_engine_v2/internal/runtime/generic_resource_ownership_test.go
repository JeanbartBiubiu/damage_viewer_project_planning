package runtime

import (
	"maps"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestResourceOwnershipFrozenViewsAndCommittedFrames(t *testing.T) {
	state := attributeOwnershipState(t, 1000)
	live := state.combatants["source"]
	live.resources = map[string]model.ResourceSlotDef{"mana": {Current: 50, Max: 100}}
	state.combatants["source"] = live
	frame := state.newExecutionFrame("source", "target", "")
	ability := planbundle.CompiledAbility{}
	if err := frame.applyResourceChange("source", "mana", -10, ability); err != nil {
		t.Fatal(err)
	}
	frozen := frame.captureEmitSnapshot(attributeOwnershipEvent, "source", "target")
	copied := cloneEventSnapshot(&frozen)
	entry, emitted := maps.Clone(frozen.entrySourceResources), maps.Clone(frozen.sourceResources)
	if err := frame.applyResourceChange("source", "mana", -15, ability); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(frozen.entrySourceResources, entry) || !reflect.DeepEqual(copied.sourceResources, emitted) {
		t.Fatal("resource snapshot changed during later operation")
	}
	if state.combatants["source"].resources["mana"].Current != 50 {
		t.Fatal("resource write published before commit")
	}
	frame.commit()
	if frame.fatal || state.combatants["source"].resources["mana"].Current != 25 {
		t.Fatal(frame.fatalErr)
	}
	published := maps.Clone(state.combatants["source"].resources)
	if err := frame.applyResourceChange("source", "mana", 40, ability); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(state.combatants["source"].resources, published) {
		t.Fatal("post-commit frame mutated live resources")
	}
	next := state.newExecutionFrame("source", "target", "")
	if err := next.applyResourceChange("source", "mana", -5, ability); err != nil {
		t.Fatal(err)
	}
	next.fatal = true
	next.commit()
	if !reflect.DeepEqual(state.combatants["source"].resources, published) || !reflect.DeepEqual(frozen.entrySourceResources, entry) || !reflect.DeepEqual(copied.sourceResources, emitted) {
		t.Fatal("failed frame changed live or frozen resource views")
	}
}

func TestResourceOwnershipZeroRefundInsertsOnlyIntoStagedView(t *testing.T) {
	state := attributeOwnershipState(t, 1000)
	frame := state.newExecutionFrame("source", "target", "")
	frozen := frame.captureEmitSnapshot(attributeOwnershipEvent, "source", "target")
	if err := frame.applyResourceChange("source", "new_resource", 0, planbundle.CompiledAbility{}); err != nil {
		t.Fatal(err)
	}
	if _, exists := frame.stageFor("source").resources["new_resource"]; !exists {
		t.Fatal("zero refund lost existing insertion semantics")
	}
	if _, exists := state.combatants["source"].resources["new_resource"]; exists {
		t.Fatal("zero refund inserted into live view")
	}
	if _, exists := frozen.sourceResources["new_resource"]; exists {
		t.Fatal("zero refund changed prior event view")
	}
}
