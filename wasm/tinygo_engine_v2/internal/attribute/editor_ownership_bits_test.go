package attribute

import (
	"fmt"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func largeEditorTable() Table {
	raw := make(map[string]model.AttributeSlotDef, PageSize*130)
	for index := 0; index < PageSize*130; index++ {
		raw[fmt.Sprintf("slot_%04d", index)] = tableSlot(float64(index))
	}
	return FromMap(raw)
}

func TestEditorOwnershipWordBoundariesKeepPublishedSnapshots(t *testing.T) {
	base := largeEditorTable()
	editor := base.Edit()
	for _, page := range []int{0, 63, 64, 127, 128, 129} {
		first, last := page*PageSize, page*PageSize+PageSize-1
		editor.SetIndex(first, tableSlot(float64(first+2000)))
		editor.SetIndex(last, tableSlot(float64(last+2000)))
	}
	shared := editor
	first := editor.Finish()
	for _, page := range []int{0, 63, 64, 127, 128, 129} {
		index := page * PageSize
		shared.SetIndex(index, tableSlot(float64(index+4000)))
	}
	second := shared.Finish()
	for _, page := range []int{0, 63, 64, 127, 128, 129} {
		index, last := page*PageSize, page*PageSize+PageSize-1
		if base.AtIndex(index) != tableSlot(float64(index)) || first.AtIndex(index) != tableSlot(float64(index+2000)) || second.AtIndex(index) != tableSlot(float64(index+4000)) || second.AtIndex(last) != tableSlot(float64(last+2000)) {
			t.Fatalf("page %d lost isolation or same-page writes", page)
		}
		if first.SamePage(second, page) {
			t.Fatalf("published page %d was reused for writing", page)
		}
	}
	if !base.SamePage(first, 1) || !first.SamePage(second, 1) {
		t.Fatal("unrelated page was copied")
	}
}

func TestEditorResolvedPageReuseRevokesOwnershipAcrossWords(t *testing.T) {
	base := largeEditorTable()
	for _, page := range []int{63, 64, 128} {
		t.Run(fmt.Sprint(page), func(t *testing.T) {
			index := page * PageSize
			cachedSlot := base.AtIndex(index)
			cachedSlot.Resolved += 3000
			cached := base.WithIndex(index, cachedSlot)
			editor := base.Edit()
			pending := base.AtIndex(index)
			pending.Resolved += 2000
			editor.SetIndex(index, pending)
			if !editor.ReuseResolvedPage(cached, page, 1) {
				t.Fatal("matching cached page was rejected")
			}
			neighbor := base.AtIndex(index + 1)
			neighbor.Current += 4000
			editor.SetIndex(index+1, neighbor)
			result := editor.Finish()
			if result.AtIndex(index) != cachedSlot || result.AtIndex(index+1) != neighbor || cached.AtIndex(index+1) != base.AtIndex(index+1) || base.AtIndex(index) != tableSlot(float64(index)) || result.SamePage(cached, page) {
				t.Fatal("later write mutated the borrowed cache page")
			}
		})
	}
}

func TestEditorAlreadyOwnedPagesAllocateNothingAcrossWords(t *testing.T) {
	base := largeEditorTable()
	editor := base.Edit()
	for _, page := range []int{63, 64, 128} {
		editor.SetIndex(page*PageSize, tableSlot(2000))
	}
	allocations := testing.AllocsPerRun(20, func() {
		for _, page := range []int{63, 64, 128} {
			index := page*PageSize + 1
			slot, _ := editor.LookupIndex(index)
			slot.Current++
			editor.SetIndex(index, slot)
		}
	})
	if allocations != 0 {
		t.Fatalf("owned-page updates allocated %.1f objects", allocations)
	}
	if editor.Finish().Same(base) {
		t.Fatal("updates were not published")
	}
}
