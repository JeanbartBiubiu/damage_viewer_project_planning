// generic run 期资源槽最小读写。
package resource

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

// ReadCurrent 读取资源 current，缺省 0。
func ReadCurrent(resources map[string]model.ResourceSlotDef, key string) float64 {
	if resources == nil {
		return 0
	}
	slot, ok := resources[key]
	if !ok {
		return 0
	}
	return slot.Current
}

// Spend 扣减资源并 clamp，返回是否成功。
func Spend(resources map[string]model.ResourceSlotDef, key string, amount float64) (map[string]model.ResourceSlotDef, bool) {
	if resources == nil || amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return resources, false
	}
	slot, ok := resources[key]
	if !ok {
		return resources, false
	}
	if slot.Current < amount {
		return resources, false
	}
	slot.Current -= amount
	slot = clampSlot(slot)
	resources[key] = slot
	return resources, true
}

// Refund 增加资源并 clamp 到 max。
func Refund(resources map[string]model.ResourceSlotDef, key string, amount float64) map[string]model.ResourceSlotDef {
	if resources == nil || amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return resources
	}
	slot, ok := resources[key]
	if !ok {
		slot = model.ResourceSlotDef{}
	}
	slot.Current += amount
	slot = clampSlot(slot)
	resources[key] = slot
	return resources
}

// EstimateReadyTimeMs 估算资源恢复到 required 的最早时间；无 regen 时回退 fallbackIntervalMs。
func EstimateReadyTimeMs(nowMs int64, current, required, regenPerMs float64, fallbackIntervalMs int64) int64 {
	if current >= required {
		return nowMs
	}
	if regenPerMs > 0 && !math.IsNaN(regenPerMs) && !math.IsInf(regenPerMs, 0) {
		deficit := required - current
		steps := math.Ceil(deficit / regenPerMs)
		if steps < 1 {
			steps = 1
		}
		return nowMs + int64(steps)
	}
	if fallbackIntervalMs <= 0 {
		fallbackIntervalMs = 100
	}
	return nowMs + fallbackIntervalMs
}

// RegenPerMs 从资源槽读取 regen 速率（P0 可选字段）；缺省 0。
func RegenPerMs(slot model.ResourceSlotDef) float64 {
	return 0
}

func clampSlot(slot model.ResourceSlotDef) model.ResourceSlotDef {
	if slot.Max < 0 || math.IsNaN(slot.Max) || math.IsInf(slot.Max, 0) {
		slot.Max = 0
	}
	if slot.Current < 0 || math.IsNaN(slot.Current) || math.IsInf(slot.Current, 0) {
		slot.Current = 0
	}
	if slot.Max > 0 && slot.Current > slot.Max {
		slot.Current = slot.Max
	}
	return slot
}
