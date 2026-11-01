package execution

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
)

func TestResourceOwnershipFrozenViewsAndCommittedFrames(t *testing.T) {
	state := attributeOwnershipState(t, 1000)
	live := state.combatants["source"]
	live.numbers = actor.New("source", live.attributesView(), map[string]model.ResourceSlotDef{"mana": {Current: 50, Max: 100}})
	state.combatants["source"] = live
	frame := state.newExecutionFrame("source", "target", "")
	ability := planbundle.CompiledAbility{}
	if err := frame.applyResourceChange("source", "mana", -10, ability); err != nil {
		t.Fatal(err)
	}
	frozen := frame.captureEmitSnapshot(attributeOwnershipEvent, "source", "target")
	copied := cloneEventSnapshot(&frozen)
	entry, emitted := frozen.EntrySourceResources.ToMap(), frozen.SourceResources.ToMap()
	if err := frame.applyResourceChange("source", "mana", -15, ability); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(frozen.EntrySourceResources.ToMap(), entry) || !reflect.DeepEqual(copied.SourceResources.ToMap(), emitted) {
		t.Fatal("resource snapshot changed during later operation")
	}
	if state.combatants["source"].resourceView().At("mana").Current != 50 {
		t.Fatal("resource write published before commit")
	}
	frame.commit()
	if frame.fatal || state.combatants["source"].resourceView().At("mana").Current != 25 {
		t.Fatal(frame.fatalErr)
	}
	published := state.combatants["source"].resourceView().ToMap()
	if err := frame.applyResourceChange("source", "mana", 40, ability); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(state.combatants["source"].resourceView().ToMap(), published) {
		t.Fatal("post-commit frame mutated live resources")
	}
	next := state.newExecutionFrame("source", "target", "")
	if err := next.applyResourceChange("source", "mana", -5, ability); err != nil {
		t.Fatal(err)
	}
	next.fatal = true
	next.commit()
	if !reflect.DeepEqual(state.combatants["source"].resourceView().ToMap(), published) || !reflect.DeepEqual(frozen.EntrySourceResources.ToMap(), entry) || !reflect.DeepEqual(copied.SourceResources.ToMap(), emitted) {
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
	if _, exists := frame.stageFor("source").resourceView().Lookup("new_resource"); !exists {
		t.Fatal("zero refund lost existing insertion semantics")
	}
	if _, exists := state.combatants["source"].resourceView().Lookup("new_resource"); exists {
		t.Fatal("zero refund inserted into live view")
	}
	if _, exists := frozen.SourceResources.Lookup("new_resource"); exists {
		t.Fatal("zero refund changed prior event view")
	}
}
