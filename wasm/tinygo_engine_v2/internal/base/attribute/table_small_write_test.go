package attribute

import (
	"fmt"
	"math"
	"reflect"
	goruntime "runtime"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestSmallTableWriteKeepsRetainedVersionsAcrossGC(t *testing.T) {
	for _, slots := range []int{1, PageSize, PageSize * 4, PageSize*4 + 1} {
		t.Run(fmt.Sprint(slots), func(t *testing.T) {
			raw := make(map[string]model.AttributeSlotDef, slots)
			for index := 0; index < slots; index++ {
				raw[fmt.Sprintf("slot_%03d", index)] = tableSlot(float64(index))
			}
			base := FromMap(raw)
			versions := []Table{base}
			for round := 1; round <= 100; round++ {
				index := (round - 1) % slots
				slot := versions[round-1].AtIndex(index)
				slot.Current += float64(round)
				slot.Resolved = math.Copysign(0, -1)
				versions = append(versions, versions[round-1].WithIndex(index, slot))
			}
			goruntime.GC()
			for round := 1; round < len(versions); round++ {
				index := (round - 1) % slots
				before, after := versions[round-1].AtIndex(index), versions[round].AtIndex(index)
				if after.Current != before.Current+float64(round) || !math.Signbit(after.Resolved) || attributeFieldFlags(after) != attributeFieldFlags(before) || versions[round].SamePage(versions[round-1], index/PageSize) {
					t.Fatalf("retained version %d was overwritten or lost its page", round)
				}
			}
			if !reflect.DeepEqual(base.ToMap(), raw) {
				t.Fatal("original table changed")
			}
		})
	}
}

func attributeFieldFlags(slot model.AttributeSlotDef) [4]bool {
	return [4]bool{slot.HasBase(), slot.HasCurrent(), slot.HasMax(), slot.HasResolved()}
}

func TestSmallTableChangedWriteAllocationBudget(t *testing.T) {
	base := editorBaseTable()
	index := base.Index("slot_00")
	changed := tableSlot(900)
	allocations := testing.AllocsPerRun(20, func() { tableHPWriteSink = base.WithIndex(index, changed) })
	if allocations > 2 {
		t.Fatalf("small changed write allocated %.1f objects", allocations)
	}
	if tableHPWriteSink.AtIndex(index) != changed || base.AtIndex(index) != tableSlot(0) {
		t.Fatal("allocation path lost value isolation")
	}
}
