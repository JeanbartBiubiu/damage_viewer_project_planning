package lifecycle

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

// ShieldExpiryReads 只借用指定发布阶段的当前盾列表，不保存所属状态或队列。
type ShieldExpiryReads interface {
	// ShieldExpiryState 返回原时点真实拥有者的只读盾列表及其是否存在。
	// 预检使用当前暂存，正式发布使用已发布状态；一次调用的视图不跨后继入队保存。
	ShieldExpiryState(owner string) (effectpkg.ShieldList, bool)
}

// CountShieldExpiries 在原预检位置计算实际仍匹配的盾期限数，不去重或写队列。
func CountShieldExpiries(pending []ShieldExpiry, reads ShieldExpiryReads) int {
	count := 0
	for _, request := range pending {
		if matchingShieldExpiry(request, reads) {
			count++
		}
	}
	return count
}

// PublishShieldExpiries 在原盾期限发布位置重新匹配真实状态，并按每项原请求时刻入队。
// 同引用的重复请求仍独立交出，当前盾的新期限不能覆盖旧请求时刻。
func PublishShieldExpiries(pending []ShieldExpiry, reads ShieldExpiryReads, requests ExpiryRequests) {
	for _, request := range pending {
		if matchingShieldExpiry(request, reads) {
			requests.EnqueueExpiry(request.ExpireAt, effectpkg.ExpiryPayload{CombatantKey: request.CombatantKey, ShieldRef: request.ShieldRef, Kind: "shield"})
		}
	}
}

func matchingShieldExpiry(request ShieldExpiry, reads ShieldExpiryReads) bool {
	if request.ExpireAt <= 0 || request.ShieldRef == "" {
		return false
	}
	shields, exists := reads.ShieldExpiryState(request.CombatantKey)
	if !exists {
		return false
	}
	for index := 0; index < shields.Len(); index++ {
		shield := shields.At(index)
		if shield.ShieldRef == request.ShieldRef {
			return shield.ExpireAt > 0
		}
	}
	return false
}
