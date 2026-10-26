package effect

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestBagChangeSetsKeepSourceAndTargetExpiryInTheirOwnVersions(t *testing.T) {
	state := RestoreBags(map[string]interface{}{"buff": map[string]interface{}{
		"state":       map[string]interface{}{"count": float64(2)},
		"expireAt":    map[string]interface{}{"count": float64(10)},
		"targetState": map[string]interface{}{"target": "target", "values": map[string]interface{}{"hits": float64(3)}, "expireAt": map[string]interface{}{"hits": float64(20)}},
	}})
	fields := NewFields(map[string]FieldDefinition{"count": {DurationMs: 10}, "hits": {DurationMs: 20}})
	state.Edit("buff", false).BindFieldDefs(fields)
	entry := state.Lookup("buff")
	first, second := StageBags(&state), StageBags(&state)
	current := first.PrepareRead("buff", false, fields, 10, ReadOptions{Defaults: true, TargetView: true, TargetKey: "target"})
	if current.State().At("count") != 0 || current.TargetValues().At("hits") != 3 {
		t.Fatal("source-only read changed target expiry scope")
	}
	published := first.Publish()
	closed := second.PrepareRead("buff", false, fields, 20, ReadOptions{ExpireTarget: true, Defaults: true, TargetView: true, TargetKey: "target"})
	if closed.State().At("count") != 0 || closed.TargetValues().At("hits") != 0 {
		t.Fatal("second version did not settle its own expired values")
	}
	if entry.State().At("count") != 2 || entry.TargetValues().At("hits") != 3 || state.Lookup("buff") != entry {
		t.Fatal("a staged preparation published into original state")
	}
	change := first.Edit("buff", false)
	change.SetStateValue("count", 7)
	change.SetTargetValue("hits", 8)
	if published.Lookup("buff").State().At("count") != 0 || published.Lookup("buff").TargetValues().At("hits") != 3 || current.State().At("count") != 0 || current.TargetValues().At("hits") != 3 {
		t.Fatal("post-publication writes changed a committed or borrowed view")
	}
}

func TestBagDefinitionCacheKeepsEmptyAndZeroValuesWithoutReallocation(t *testing.T) {
	state := RestoreBags(nil)
	change := state.Edit("buff", true)
	change.BindFieldDefs(NewFields(map[string]FieldDefinition{"zero": {DefaultValue: 0}}))
	view := state.PrepareRead("buff", false, nil, 0, ReadOptions{Defaults: true})
	if value, exists := view.State().Lookup("zero"); !exists || value != 0 {
		t.Fatal("declared zero became missing")
	}
	if _, exists := view.State().Lookup("absent"); exists || state.PrepareRead("absent", false, nil, 0, ReadOptions{}).Present() {
		t.Fatal("a read invented a missing key or bag")
	}
	if value, exists := view.DefaultsForFormula().Lookup("zero"); !exists || value != 0 {
		t.Fatal("default zero became missing")
	}
	var output model.NumericView
	if allocations := testing.AllocsPerRun(50, func() { output = state.PrepareRead("buff", false, nil, 0, ReadOptions{Defaults: true}).State() }); allocations != 0 {
		t.Fatalf("prepared borrowed state allocated %v objects", allocations)
	}
	if output.At("zero") != 0 {
		t.Fatal("borrowed output changed")
	}
}
