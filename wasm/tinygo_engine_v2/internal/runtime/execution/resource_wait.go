package execution

// resourceReadyTimeMs 保留当前无自然资源恢复时的条件重查等待。
func resourceReadyTimeMs(nowMs int64, current, required float64, fallbackIntervalMs int64) int64 {
	if current >= required {
		return nowMs
	}
	if fallbackIntervalMs <= 0 {
		fallbackIntervalMs = 100
	}
	return nowMs + fallbackIntervalMs
}
