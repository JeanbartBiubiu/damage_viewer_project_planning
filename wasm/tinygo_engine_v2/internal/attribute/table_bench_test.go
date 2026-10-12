package attribute

import (
	"fmt"
	"testing"

	"tinygo_engine_v2/internal/model"
)

var tableHPWriteSink Table
var mapHPWriteSink map[string]model.AttributeSlotDef

// 两条路径保留输入快照，只更新180个槽中的生命Current，不含JSON或其他战斗工作。
func BenchmarkFrozenAttributeHPWrite(b *testing.B) {
	raw := make(map[string]model.AttributeSlotDef, 180)
	raw["hp"] = model.AttributeSlotDef{Base: 1000, Current: 1000, Max: 1000, Resolved: 1000}
	for index := 0; index < 179; index++ {
		raw[fmt.Sprintf("attribute_%03d", index)] = tableSlot(float64(index))
	}
	changed := raw["hp"]
	changed.Current = 999
	b.Run("map", func(b *testing.B) {
		b.ReportAllocs()
		for iteration := 0; iteration < b.N; iteration++ {
			out := make(map[string]model.AttributeSlotDef, len(raw))
			for key, slot := range raw {
				out[key] = slot
			}
			out["hp"] = changed
			mapHPWriteSink = out
		}
	})
	b.Run("table_page8", func(b *testing.B) {
		table := FromMap(raw)
		index := table.Index("hp")
		b.ReportAllocs()
		b.ResetTimer()
		for iteration := 0; iteration < b.N; iteration++ {
			tableHPWriteSink = table.WithIndex(index, changed)
		}
	})
}
