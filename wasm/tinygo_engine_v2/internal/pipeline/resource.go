package pipeline

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
