package attribute

import (
	"encoding/json"
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func resolvedPageTable() Table {
	return FromMap(map[string]model.AttributeSlotDef{
		"attack": {Base: 10, Current: 12, Max: 30, Resolved: 10},
		"hp":     {Base: 1000, Current: 900, Max: 1000, Resolved: 1000},
	})
}

func TestResolvedPageReusePublishesCachedImmutablePage(t *testing.T) {
	base := resolvedPageTable()
	attack := base.Index("attack")
	slot := base.AtIndex(attack)
	slot.Resolved = 20
	cached := base.WithIndex(attack, slot)
	editor := base.Edit()
	if !editor.ReuseResolvedPage(cached, attack/PageSize, 1<<uint(attack%PageSize)) {
		t.Fatal("compatible resolved-only page was rejected")
	}
	copy := editor
	result := editor.Finish()
	if !result.SamePage(cached, attack/PageSize) || result.At("hp") != base.At("hp") || base.At("attack").Resolved != 10 {
		t.Fatal("cached page was copied or non-resolved data changed")
	}
	slot.Resolved = 30
	copy.SetIndex(attack, slot)
	newer := copy.Finish()
	if result.At("attack").Resolved != 20 || cached.At("attack").Resolved != 20 || newer.At("attack").Resolved != 30 {
		t.Fatal("editing a copied editor mutated a published cached page")
	}
}

func TestResolvedPageReuseChecksCurrentWorkAndKeepsEarlierWrites(t *testing.T) {
	base := resolvedPageTable()
	attack, hp := base.Index("attack"), base.Index("hp")
	attackSlot, hpSlot := base.AtIndex(attack), base.AtIndex(hp)
	attackSlot.Resolved, hpSlot.Current = 20, 950
	cached := base.WithIndex(attack, attackSlot)
	editor := base.Edit()
	editor.SetIndex(hp, hpSlot)
	if editor.ReuseResolvedPage(cached, 0, 1<<uint(attack)) {
		t.Fatal("page reuse would roll back an earlier current-HP write")
	}
	matching := cached.WithIndex(hp, hpSlot)
	if !editor.ReuseResolvedPage(matching, 0, 1<<uint(attack)) {
		t.Fatal("matching current-work fields should permit resolved-only reuse")
	}
	result := editor.Finish()
	if result.At("hp").Current != 950 || !result.SamePage(matching, 0) {
		t.Fatal("earlier write disappeared from reused page")
	}
}

func TestResolvedPageRejectsPreservedFieldAndPresenceChanges(t *testing.T) {
	base := resolvedPageTable()
	attack, hp := base.Index("attack"), base.Index("hp")
	mask := uint8(1<<uint(attack) | 1<<uint(hp))
	for _, field := range []string{"base", "current", "max", "flags", "uncovered_resolved", "missing", "layout", "outside_mask"} {
		t.Run(field, func(t *testing.T) {
			cached := base
			slot := cached.AtIndex(hp)
			selected := mask
			switch field {
			case "base":
				slot.Base++
			case "current":
				slot.Current++
			case "max":
				slot.Max++
			case "flags":
				if err := json.Unmarshal([]byte(`{"base":1000,"current":900,"max":1000,"resolved":1000}`), &slot); err != nil {
					t.Fatal(err)
				}
			case "uncovered_resolved":
				slot.Resolved++
				selected = 1 << uint(attack)
			case "missing":
				cached = cached.Without("hp")
			case "layout":
				cached = FromMap(base.ToMap())
			case "outside_mask":
				selected = 128
			}
			if field != "missing" && field != "layout" {
				cached = cached.WithIndex(hp, slot)
			}
			editor := base.Edit()
			if editor.ReuseResolvedPage(cached, 0, selected) || !editor.Finish().Same(base) {
				t.Fatal("preserved fields or mask accepted, or failure changed the editor")
			}
		})
	}
}

func TestResolvedPageNoOpIsZeroAllocationAndSignedZeroRemainsDistinct(t *testing.T) {
	base := resolvedPageTable()
	independent := FromMap(base.ToMap(), base.Layout())
	if allocations := testing.AllocsPerRun(100, func() {
		editor := base.Edit()
		if !editor.ReuseResolvedPage(independent, 0, 3) || !editor.Finish().Same(base) {
			t.Fatal("equal page changed the table")
		}
	}); allocations != 0 {
		t.Fatalf("equal page allocated %v objects", allocations)
	}
	attack := base.Index("attack")
	slot := base.AtIndex(attack)
	slot.Resolved = 0
	base = base.WithIndex(attack, slot)
	slot.Resolved = math.Copysign(0, -1)
	cached := base.WithIndex(attack, slot)
	editor := base.Edit()
	if editor.ReuseResolvedPage(cached, 0, 0) {
		t.Fatal("uncovered negative zero was accepted")
	}
	if !editor.ReuseResolvedPage(cached, 0, 1<<uint(attack)) || math.Float64bits(editor.Finish().AtIndex(attack).Resolved) != math.Float64bits(slot.Resolved) {
		t.Fatal("covered negative zero was lost")
	}
}

func TestResolvedPageRejectsZeroValueAndOutOfBoundsPages(t *testing.T) {
	var empty Table
	editor := empty.Edit()
	if editor.ReuseResolvedPage(empty, 0, 0) {
		t.Fatal("empty table accepted a page")
	}
	base := resolvedPageTable()
	editor = base.Edit()
	if editor.ReuseResolvedPage(base, -1, 1) || editor.ReuseResolvedPage(base, 1, 1) {
		t.Fatal("out-of-bounds page was accepted")
	}
}
