package effect

func (b *bagData) targetStateRemainingMs(key, target string, now int64) int64 {
	if b == nil || target == "" || b.targetKey != target || b.targetValues[key] <= 0 || b.targetExpireAt[key] <= now {
		return 0
	}
	return b.targetExpireAt[key] - now
}
