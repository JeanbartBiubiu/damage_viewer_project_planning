package attribute

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func editorBaseTable() Table {
	raw := make(map[string]model.AttributeSlotDef, 17)
	for index := 0; index < 17; index++ {
		raw[fmt.Sprintf("slot_%02d", index)] = tableSlot(float64(index))
	}
	return FromMap(raw)
}

func TestEditorBatchesSamePageAndCrossPageWrites(t *testing.T) {
	original := editorBaseTable()
	editor := original.Edit()
	first, lastInPage, nextPage := tableSlot(100), tableSlot(107), tableSlot(108)
	editor.SetIndex(0, first)
	editor.SetIndex(7, lastInPage)
	editor.SetIndex(8, nextPage)
	if slot, exists := editor.LookupIndex(7); !exists || slot != lastInPage {
		t.Fatal("editor lookup did not see its own same-page write")
	}
	result := editor.Finish()
	if result.AtIndex(0) != first || result.AtIndex(7) != lastInPage || result.AtIndex(8) != nextPage || result.Len() != original.Len() {
		t.Fatal("batched writes were not published")
	}
	if original.AtIndex(0) != tableSlot(0) || original.AtIndex(7) != tableSlot(7) || original.AtIndex(8) != tableSlot(8) {
		t.Fatal("batch writes changed the input snapshot")
	}
	if result.SamePage(original, 0) || result.SamePage(original, 1) || !result.SamePage(original, 2) {
		t.Fatal("batch copied untouched pages or retained writable old pages")
	}
}

func TestEditorAlreadyOwnedPageWritesAllocateNothing(t *testing.T) {
	original := editorBaseTable()
	editor := original.Edit()
	editor.SetIndex(0, tableSlot(100))
	allocations := testing.AllocsPerRun(20, func() {
		slot, _ := editor.LookupIndex(7)
		slot.Current++
		editor.SetIndex(7, slot)
	})
	if allocations != 0 {
		t.Fatalf("later writes to an owned page allocated %.1f objects", allocations)
	}
	result := editor.Finish()
	if result.AtIndex(7).Current != tableSlot(7).Current+21 || original.AtIndex(7) != tableSlot(7) || !result.SamePage(original, 1) {
		t.Fatal("owned-page reuse changed a frozen or unrelated page")
	}
}

func TestEditorFinishRequiresFreshPagesForLaterWrites(t *testing.T) {
	original := editorBaseTable()
	editor := original.Edit()
	editor.SetIndex(0, tableSlot(100))
	first := editor.Finish()
	editor.SetIndex(0, tableSlot(200))
	editor.SetIndex(8, tableSlot(208))
	second := editor.Finish()
	if original.AtIndex(0) != tableSlot(0) || first.AtIndex(0) != tableSlot(100) || first.AtIndex(8) != tableSlot(8) || second.AtIndex(0) != tableSlot(200) || second.AtIndex(8) != tableSlot(208) {
		t.Fatal("writing after publication changed an old version")
	}
	if second.SamePage(first, 0) || second.SamePage(first, 1) || !second.SamePage(first, 2) || !editor.Finish().Same(second) {
		t.Fatal("publication did not revoke private page ownership")
	}
}

func TestEditorCopiesSharePublicationAndForkSafely(t *testing.T) {
	original := editorBaseTable()
	editor := original.Edit()
	editor.SetIndex(0, tableSlot(100))
	copied := editor
	copied.SetIndex(7, tableSlot(107))
	if slot, _ := editor.LookupIndex(7); slot != tableSlot(107) {
		t.Fatal("active editor copies lost their common batch")
	}
	published := editor.Finish()
	copied.SetIndex(0, tableSlot(200))
	copied.SetIndex(8, tableSlot(208))
	if published.AtIndex(0) != tableSlot(100) || published.AtIndex(7) != tableSlot(107) || published.AtIndex(8) != tableSlot(8) || original.AtIndex(0) != tableSlot(0) {
		t.Fatal("a copied editor wrote into a published snapshot")
	}
	second := copied.Finish()
	if second.AtIndex(0) != tableSlot(200) || second.AtIndex(8) != tableSlot(208) || !editor.Finish().Same(second) {
		t.Fatal("copied editors did not share the latest published base")
	}
}

func TestEditorCopiesBeforeFirstWriteAreIndependent(t *testing.T) {
	original := editorBaseTable()
	first := original.Edit()
	second := first
	first.SetIndex(0, tableSlot(100))
	firstResult := first.Finish()
	second.SetIndex(0, tableSlot(200))
	secondResult := second.Finish()
	if firstResult.AtIndex(0) != tableSlot(100) || secondResult.AtIndex(0) != tableSlot(200) || original.AtIndex(0) != tableSlot(0) || !first.Finish().Same(firstResult) {
		t.Fatal("unstarted editor copies shared a later mutable page")
	}
}

func TestEditorMissingZeroAndZeroValueAreSafe(t *testing.T) {
	var empty Editor
	if _, exists := empty.LookupIndex(0); exists {
		t.Fatal("zero editor had a slot")
	}
	empty.SetIndex(0, tableSlot(1))
	empty.SetIndex(-1, tableSlot(1))
	if !empty.Finish().Same(Table{}) {
		t.Fatal("invalid writes changed a zero editor")
	}
	original := FromMap(nil, NewLayout([]string{"hp"}))
	editor := original.Edit()
	editor.SetIndex(1, tableSlot(1))
	editor.SetIndex(0, model.AttributeSlotDef{})
	if slot, exists := editor.LookupIndex(0); !exists || slot != (model.AttributeSlotDef{}) {
		t.Fatal("missing zero slot was not inserted")
	}
	result := editor.Finish()
	if result.Len() != 1 || result.AtIndex(0) != (model.AttributeSlotDef{}) || original.Len() != 0 || result.SameShape(original) {
		t.Fatal("zero insertion lost slot presence or changed its input")
	}
}

func TestEditorUnchangedBatchAllocatesNothing(t *testing.T) {
	original := editorBaseTable()
	allocations := testing.AllocsPerRun(20, func() {
		editor := original.Edit()
		editor.SetIndex(0, tableSlot(0))
		editor.SetIndex(8, tableSlot(8))
		editor.SetIndex(-1, tableSlot(1))
		editor.SetIndex(17, tableSlot(1))
		if !editor.Finish().Same(original) {
			t.Fatal("unchanged batch produced another version")
		}
	})
	if allocations != 0 {
		t.Fatalf("unchanged fresh editor allocated %.1f objects", allocations)
	}
	allocations = testing.AllocsPerRun(20, func() {
		var editor Editor
		editor.SetIndex(0, model.AttributeSlotDef{})
		editor.Finish()
	})
	if allocations != 0 {
		t.Fatalf("invalid zero-editor write allocated %.1f objects", allocations)
	}
}

func TestEditorPreservesFieldFlagsAndSignedZero(t *testing.T) {
	var partial model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"current":0,"max":10}`), &partial); err != nil {
		t.Fatal(err)
	}
	original := FromMap(map[string]model.AttributeSlotDef{"hp": partial})
	editor := original.Edit()
	editor.SetIndex(0, model.AttributeSlotDef{Max: 10})
	complete := editor.Finish()
	if original.AtIndex(0).HasBase() || original.AtIndex(0).HasResolved() || !complete.AtIndex(0).HasBase() || !complete.AtIndex(0).HasResolved() || complete.Same(original) {
		t.Fatal("batch write confused equal numbers with authored field flags")
	}
	for _, field := range []string{"base", "current", "max", "resolved"} {
		t.Run(field, func(t *testing.T) {
			base := FromMap(map[string]model.AttributeSlotDef{"slot": {}})
			editor := base.Edit()
			slot, _ := editor.LookupIndex(0)
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
			editor.SetIndex(0, slot)
			result := editor.Finish()
			got := result.AtIndex(0)
			if result.Same(base) || math.Float64bits(got.Base) != math.Float64bits(slot.Base) || math.Float64bits(got.Current) != math.Float64bits(slot.Current) || math.Float64bits(got.Max) != math.Float64bits(slot.Max) || math.Float64bits(got.Resolved) != math.Float64bits(slot.Resolved) || base.AtIndex(0) != (model.AttributeSlotDef{}) {
				t.Fatal("batch equality lost negative zero or changed the frozen base")
			}
		})
	}
}
