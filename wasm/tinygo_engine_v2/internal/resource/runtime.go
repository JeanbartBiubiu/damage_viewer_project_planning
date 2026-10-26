// generic run 期资源槽最小读写。
package resource

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

// SpendSlot 计算单槽扣减；集合所有者负责暂存和统一发布。
func SpendSlot(slot model.ResourceSlotDef, exists bool, amount float64) (model.ResourceSlotDef, bool) {
	if !exists || amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) || slot.Current < amount {
		return slot, false
	}
	slot.Current -= amount
	return clampSlot(slot), true
}

// RefundSlot 增加资源并夹取到上限；不访问调用方的可写映射。
func RefundSlot(slot model.ResourceSlotDef, amount float64) (model.ResourceSlotDef, bool) {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return slot, false
	}
	slot.Current += amount
	return clampSlot(slot), true
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
