package listener

import (
	"testing"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestDynamicListenerFreezeSurvivesRemovalAndRebinding(t *testing.T) {
	definitions := []planbundle.CompiledListener{{ListenerKey: "first"}, {ListenerKey: "second"}}
	var state State
	if !state.Bind(definitions, "source", "old") || !state.Bind([]planbundle.CompiledListener{{ListenerKey: "third"}}, "target", "old") {
		t.Fatal("listener fixture could not bind")
	}
	frozen := state.FreezeDynamic()
	state.Unbind("source", "old")
	if !state.Bind([]planbundle.CompiledListener{{ListenerKey: "added"}}, "source", "new") {
		t.Fatal("new listener fixture could not bind")
	}
	if len(frozen) != 3 || frozen[0].ListenerKey != "first" || frozen[1].ListenerKey != "second" || frozen[2].ListenerKey != "third" || frozen[0].OwnerCombatantKey != "source" || frozen[0].OwnerProviderRef != "old" {
		t.Fatalf("current binding modified a dispatch snapshot: %+v", frozen)
	}
	if definitions[0].OwnerCombatantKey != "" || definitions[0].OwnerProviderRef != "" {
		t.Fatal("runtime binding mutated the compiled listener definition")
	}
	if state.DynamicLen() != 2 || state.DynamicAt(0).ListenerKey != "third" || state.DynamicAt(1).ListenerKey != "added" {
		t.Fatal("unbind lost full identity or changed retained order")
	}
	state.Unbind("target", "")
	if state.DynamicLen() != 2 {
		t.Fatal("missing mount reference removed listeners")
	}
	addedIndex := state.dynamic[1].throttleIndex
	state.Triggered(addedIndex, "source", "new", 1, 0)
	state.ResetDynamic()
	if state.DynamicLen() != 0 || state.FreezeDynamic() != nil || state.Allow(addedIndex, "source", "new", 1, 100, 50) {
		t.Fatal("dynamic reset changed same-run throttle history or empty shape")
	}
}
