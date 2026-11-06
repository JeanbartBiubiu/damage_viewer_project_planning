package actionflow

import (
	"math"
	"tinygo_engine_v2/internal/model"
)

// NormalizeConditionRecheckInterval 保留原默认和允许重查区间，不创建独立计时器。
func NormalizeConditionRecheckInterval(raw int64) int64 {
	if raw <= 0 {
		return 100
	}
	if raw < 10 {
		return 10
	}
	if raw > 1000 {
		return 1000
	}
	return raw
}

// ResourceReadyTimeMs 在没有自然资源恢复时保留原条件重查等待。
func ResourceReadyTimeMs(now int64, current, required float64, fallback int64) int64 {
	if current >= required {
		return now
	}
	if fallback <= 0 {
		fallback = 100
	}
	return now + fallback
}

// IsWhileReady 保留驱动任意非空配置的原判定，真实作者校验仍由原准入负责。
func IsWhileReady(entry model.DriverEntry) bool {
	switch value := entry.WhileReady.(type) {
	case bool:
		return value
	case nil:
		return false
	default:
		return true
	}
}

// EstimateDriverAttempts 按原观察窗口和事件预算计算固定重复的有限尝试上限。
func EstimateDriverAttempts(entry model.DriverEntry, start, duration int64, maxEvents int) int {
	if entry.Repeat == nil || entry.Repeat.IntervalMs <= 0 || duration <= 0 {
		return 1
	}
	firstOffset := entry.FirstAtMs - start
	if firstOffset < 0 {
		firstOffset = 0
	}
	remaining := duration - firstOffset
	if remaining < 0 {
		return 1
	}
	additional := remaining / entry.Repeat.IntervalMs
	if additional >= int64(maxEvents) {
		return maxEvents
	}
	return int(additional) + 1
}

// NextWhileReadyTime 保留拒绝原因对应的真实等待或条件重查，不消费释放资格。
func NextWhileReadyTime(reason model.AttemptSkipReason, ready, now, recheck int64) int64 {
	next := now + recheck
	if reason == model.AttemptSkipCooldownNotReady || reason == model.AttemptSkipResourceInsufficient {
		next = ready
	}
	if next <= now {
		next = now + recheck
	}
	return next
}

// DynamicRepeatTime 在真实金额求值之后核定下一次尝试，合法0与非法数值不混同。
func DynamicRepeatTime(raw float64, now, end int64) (int64, bool) {
	if math.IsNaN(raw) || math.IsInf(raw, 0) || raw <= 0 {
		return 0, false
	}
	rounded := math.Round(raw)
	if rounded < 1 {
		rounded = 1
	}
	// 先按剩余窗口和整数范围核对，避免浮点转整数溢出后被补成1毫秒。
	if now > end || rounded >= float64(math.MaxInt64) || rounded > float64(end-now) {
		return 0, false
	}
	interval := int64(rounded)
	if interval > end-now {
		return 0, false
	}
	return now + interval, true
}
