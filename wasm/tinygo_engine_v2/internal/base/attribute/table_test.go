package attribute

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"testing"
	"unsafe"

	"tinygo_engine_v2/internal/model"
)

func tableSlot(value float64) model.AttributeSlotDef {
	return model.AttributeSlotDef{Base: value, Current: value + 100, Max: value + 200, Resolved: value + 300}
}

func TestTableHeaderIsOnePointerAndZeroValueIsSafe(t *testing.T) {
	if got, want := unsafe.Sizeof(Table{}), unsafe.Sizeof((*tableData)(nil)); got != want {
		t.Fatalf("table header=%d bytes want one pointer=%d", got, want)
	}
	var zero Table
	if zero.Layout() != nil || zero.Index("hp") != -1 || zero.Len() != 0 || zero.PageCount() != 0 || zero.At("hp") != (model.AttributeSlotDef{}) || zero.AtIndex(0) != (model.AttributeSlotDef{}) {
		t.Fatal("zero table lookup exposed data")
	}
	if _, exists := zero.Lookup("hp"); exists {
		t.Fatal("zero table had a slot")
	}
	if _, exists := zero.LookupIndex(0); exists {
		t.Fatal("zero table had an indexed slot")
	}
	zero.Range(func(string, model.AttributeSlotDef) bool {
		t.Fatal("zero table enumerated a slot")
		return false
	})
	if !zero.SameShape(Table{}) || !zero.Same(Table{}) || zero.SamePage(Table{}, 0) || !zero.WithIndex(0, tableSlot(1)).Same(zero) || !zero.Without("hp").Same(zero) {
		t.Fatal("zero table identity or invalid mutation was unsafe")
	}
	inserted := zero.With("hp", model.AttributeSlotDef{})
	if inserted.Len() != 1 || inserted.Same(zero) || inserted.SameShape(zero) || zero.SameShape(inserted) || zero.Same(inserted) {
		t.Fatal("zero-table insertion failed to retain independent shape")
	}
}

func TestLayoutStableIndicesAndImmutableExtension(t *testing.T) {
	keys := []string{"c", "a", "b", "a"}
	layout := NewLayout(keys)
	keys[0] = "changed"
	if layout.Len() != 3 || layout.Key(0) != "a" || layout.Key(1) != "b" || layout.Key(2) != "c" {
		t.Fatal("initial keys were not copied, deduplicated and sorted")
	}
	extended := layout.Extend([]string{"d", "aa", "a", "aa"})
	for index, want := range []string{"a", "b", "c", "aa", "d"} {
		if got, exists := extended.Lookup(want); !exists || got != index || extended.Key(index) != want {
			t.Fatalf("index=%d key=%s lookup=%d exists=%v", index, want, got, exists)
		}
	}
	if layout.Len() != 3 {
		t.Fatal("extension changed the old layout")
	}
	if _, exists := layout.Lookup("aa"); exists {
		t.Fatal("extension inserted a new key into the old layout")
	}
	if extended.Extend([]string{"a", "d"}) != extended {
		t.Fatal("adding existing keys replaced the layout identity")
	}
	var empty *Layout
	if index, exists := empty.Lookup("a"); index != -1 || exists || empty.Len() != 0 || empty.Key(0) != "" || layout.Key(-1) != "" || layout.Key(layout.Len()) != "" {
		t.Fatal("empty or invalid layout lookup was not safe")
	}
}

func TestTableEightSlotBoundaryAndMultiVersionIsolation(t *testing.T) {
	raw := make(map[string]model.AttributeSlotDef)
	for index := 0; index < 17; index++ {
		raw[fmt.Sprintf("slot_%02d", index)] = tableSlot(float64(index))
	}
	original := FromMap(raw)
	if original.Len() != 17 || original.PageCount() != 3 {
		t.Fatal(original.Len(), original.PageCount())
	}
	firstSlot := original.AtIndex(7)
	firstSlot.Current = -7
	first := original.WithIndex(7, firstSlot)
	secondSlot := original.AtIndex(8)
	secondSlot.Current = -8
	second := original.WithIndex(8, secondSlot)
	third := first.WithIndex(8, secondSlot)
	lastSlot := third.AtIndex(16)
	lastSlot.Resolved = -16
	last := third.WithIndex(16, lastSlot)
	if original.AtIndex(7) != tableSlot(7) || original.AtIndex(8) != tableSlot(8) || original.AtIndex(16) != tableSlot(16) || first.AtIndex(8) != tableSlot(8) || second.AtIndex(7) != tableSlot(7) || third.AtIndex(16) != tableSlot(16) {
		t.Fatal("a write changed a previously frozen version")
	}
	if first.AtIndex(7) != firstSlot || second.AtIndex(8) != secondSlot || third.AtIndex(7) != firstSlot || last.AtIndex(16) != lastSlot {
		t.Fatal("changed slots were not retained")
	}
	for page := 0; page < original.PageCount(); page++ {
		if first.SamePage(original, page) != (page != 0) || second.SamePage(original, page) != (page != 1) || last.SamePage(third, page) != (page != 2) {
			t.Fatalf("unexpected copied page %d", page)
		}
	}
	if !first.SameShape(original) || !last.SameShape(original) || first.Same(original) || !original.Same(original) || original.SamePage(first, -1) || original.SamePage(first, 3) {
		t.Fatal("value, shape or page identity comparison was incorrect")
	}
}

func TestTableMissingZeroInsertionRemovalAndInvalidIndices(t *testing.T) {
	layout := NewLayout([]string{"hp", "known"})
	empty := FromMap(nil, layout)
	if empty.Index("hp") != 0 || empty.Index("missing") != -1 || empty.Len() != 0 {
		t.Fatal("layout membership was confused with actual slot presence")
	}
	if _, exists := empty.Lookup("hp"); exists {
		t.Fatal("empty table exposed a declared slot")
	}
	zero := empty.WithIndex(0, model.AttributeSlotDef{})
	if slot, exists := zero.Lookup("hp"); !exists || slot != (model.AttributeSlotDef{}) || zero.Len() != 1 {
		t.Fatal("writing a missing zero slot failed to insert it")
	}
	if !zero.WithIndex(0, model.AttributeSlotDef{}).Same(zero) || !zero.WithIndex(-1, tableSlot(1)).Same(zero) || !zero.WithIndex(layout.Len(), tableSlot(1)).Same(zero) {
		t.Fatal("same-value or invalid-index write changed the table")
	}
	if _, exists := zero.LookupIndex(-1); exists {
		t.Fatal("invalid negative index was present")
	}
	if _, exists := zero.LookupIndex(layout.Len()); exists {
		t.Fatal("out-of-range index was present")
	}
	if allocations := testing.AllocsPerRun(20, func() { zero.WithIndex(0, model.AttributeSlotDef{}) }); allocations != 0 {
		t.Fatalf("unchanged slot write allocated %.1f objects", allocations)
	}
	extended := zero.With("new", tableSlot(9))
	if extended.Index("hp") != 0 || extended.Index("known") != 1 || extended.Index("new") != 2 || extended.Len() != 2 || zero.Index("new") != -1 {
		t.Fatal("insertion changed existing indices or the old layout")
	}
	removed := zero.Without("hp")
	if removed.Len() != 0 || !removed.SameShape(empty) || !removed.Same(empty) || !removed.Without("missing").Same(removed) {
		t.Fatal("removal did not retain the original empty shape")
	}
	replaced := removed.With("known", model.AttributeSlotDef{})
	if replaced.Len() != zero.Len() || replaced.SameShape(zero) {
		t.Fatal("equal-sized key replacement hid a presence change")
	}
	if _, exists := zero.Lookup("hp"); !exists {
		t.Fatal("removal changed the frozen source table")
	}
}

func TestTableMapBoundariesAndStableEnumeration(t *testing.T) {
	layout := NewLayout([]string{"b"})
	raw := map[string]model.AttributeSlotDef{"a": tableSlot(1), "b": tableSlot(2)}
	table := FromMap(raw, layout)
	if _, exists := layout.Lookup("a"); exists {
		t.Fatal("FromMap changed the supplied layout")
	}
	raw["a"] = tableSlot(999)
	delete(raw, "b")
	if table.At("a") != tableSlot(1) || table.At("b") != tableSlot(2) {
		t.Fatal("caller input changed the materialized table")
	}
	exported := table.ToMap()
	exported["b"] = tableSlot(999)
	delete(exported, "a")
	if table.At("a") != tableSlot(1) || table.At("b") != tableSlot(2) {
		t.Fatal("exported map changed the table")
	}
	var keys []string
	table.Range(func(key string, slot model.AttributeSlotDef) bool {
		keys = append(keys, key)
		return true
	})
	if !reflect.DeepEqual(keys, []string{"b", "a"}) {
		t.Fatalf("enumeration changed stable appended indices: %v", keys)
	}
	count := 0
	table.Range(func(string, model.AttributeSlotDef) bool { count++; return false })
	if count != 1 {
		t.Fatal("Range did not stop on false")
	}
	var zero Table
	if zero.ToMap() == nil || FromMap(nil).ToMap() == nil || zero.Len() != 0 || zero.PageCount() != 0 {
		t.Fatal("empty table did not export an independent non-nil map")
	}
	if zero.With("hp", model.AttributeSlotDef{}).Len() != 1 {
		t.Fatal("zero-value table could not insert its first slot")
	}
}

func TestTablePreservesAuthoredFieldFlagsAndFloatBits(t *testing.T) {
	var partial model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"current":0,"max":10}`), &partial); err != nil {
		t.Fatal(err)
	}
	table := FromMap(map[string]model.AttributeSlotDef{"hp": partial})
	complete := model.AttributeSlotDef{Current: 0, Max: 10}
	changed := table.With("hp", complete)
	if table.At("hp").HasBase() || table.At("hp").HasResolved() || !changed.At("hp").HasBase() || !changed.At("hp").HasResolved() || changed.Same(table) {
		t.Fatal("numerically equal slots lost their private field-presence flags")
	}
	raw, err := json.Marshal(table.ToMap()["hp"])
	if err != nil || string(raw) != `{"current":0,"max":10}` {
		t.Fatal("export changed authored field presence", string(raw), err)
	}
	for _, field := range []string{"base", "current", "max", "resolved"} {
		t.Run(field+"_negative_zero", func(t *testing.T) {
			before := FromMap(map[string]model.AttributeSlotDef{"slot": {}})
			slot := before.At("slot")
			negative := math.Copysign(0, -1)
			switch field {
			case "base":
				slot.Base = negative
			case "current":
				slot.Current = negative
			case "max":
				slot.Max = negative
			case "resolved":
				slot.Resolved = negative
			}
			after := before.With("slot", slot)
			if after.Same(before) || math.Float64bits(after.At("slot").Base) != math.Float64bits(slot.Base) || math.Float64bits(after.At("slot").Current) != math.Float64bits(slot.Current) || math.Float64bits(after.At("slot").Max) != math.Float64bits(slot.Max) || math.Float64bits(after.At("slot").Resolved) != math.Float64bits(slot.Resolved) {
				t.Fatal("same-value comparison lost negative-zero bits")
			}
		})
	}
	nan := math.Float64frombits(0x7ff8000000000042)
	nanSlot := partial
	nanSlot.Current = nan
	nanTable := table.With("hp", nanSlot)
	if math.Float64bits(nanTable.At("hp").Current) != math.Float64bits(nan) || table.At("hp").Current != 0 || nanTable.At("hp").HasBase() {
		t.Fatal("NaN payload or slot flags changed")
	}
}

func TestTableIdentityRequiresSharedLayoutAndPages(t *testing.T) {
	layout := NewLayout([]string{"hp"})
	raw := map[string]model.AttributeSlotDef{"hp": tableSlot(1)}
	first, second := FromMap(raw, layout), FromMap(raw, layout)
	if !first.SameShape(second) || first.Same(second) || first.SamePage(second, 0) {
		t.Fatal("independent pages were reported as the same frozen version")
	}
	otherLayout := FromMap(raw, NewLayout([]string{"hp"}))
	if first.SameShape(otherLayout) || first.Same(otherLayout) || first.SamePage(otherLayout, 0) {
		t.Fatal("layout identity was ignored")
	}
	frozen := first
	if !first.Same(frozen) || !first.SamePage(frozen, 0) {
		t.Fatal("value copy did not retain frozen pages")
	}
}
