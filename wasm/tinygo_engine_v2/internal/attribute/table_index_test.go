package attribute

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestRangeIndexPreservesSparseLayoutOrderAndEarlyStop(t *testing.T) {
	layout := NewLayout([]string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"})
	attrs := FromMap(map[string]model.AttributeSlotDef{"a": {Base: 1}, "i": {Base: 2}, "j": {}}, layout).Without("i")
	var byName, byIndex []string
	attrs.Range(func(key string, slot model.AttributeSlotDef) bool { byName = append(byName, key); return true })
	attrs.RangeIndex(func(index int, slot model.AttributeSlotDef) bool {
		key := attrs.Layout().Key(index)
		if actual, present := attrs.LookupIndex(index); !present || actual != slot {
			t.Fatal("enumerated absent or wrong slot")
		}
		byIndex = append(byIndex, key)
		return true
	})
	if !reflect.DeepEqual(byIndex, byName) {
		t.Fatal(byIndex, byName)
	}
	count := 0
	attrs.RangeIndex(func(int, model.AttributeSlotDef) bool { count++; return false })
	if count != 1 {
		t.Fatal("early stop changed", count)
	}
}

func TestHPIndexPreservesMissingSlotExtensionAndDifferentLayouts(t *testing.T) {
	for _, keys := range [][]string{{"hp", "z"}, {"a", "hp", "z"}, {"a", "z"}} {
		layout := NewLayout(keys)
		before := FromMap(map[string]model.AttributeSlotDef{"z": {Base: 7}}, layout)
		if ReadHP(before) != 0 || ReadHPMax(before) != 0 {
			t.Fatal("missing HP became present")
		}
		after := SetHP(before, 40)
		if ReadHP(after) != 40 || ReadHPMax(after) != 40 || before.Len() != 1 || before.At("z").Base != 7 {
			t.Fatal("HP insertion changed frozen view or other slots")
		}
		extended := after.Layout().Extend([]string{"aa", "zz"})
		if extended.HPIndex() != after.Layout().HPIndex() {
			t.Fatal("extension renumbered HP")
		}
		next := FromMap(after.ToMap(), extended)
		if ReadHP(next) != 40 {
			t.Fatal("wrong HP slot after layout change")
		}
	}
}
