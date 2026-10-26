package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

// 旧探针直接改负载数组；现在通过真实登记入口重建测试输入，不公开生产可写集合。
func replaceEffectTimePayloadsForTest(state *Engine, expiry []effectpkg.ExpiryPayload, anchored []effectpkg.AnchoredPayload, keepTerminals bool) {
	previous := state.effectTimers
	var next effectpkg.TimeState
	for _, payload := range expiry {
		next.RegisterExpiry(payload)
	}
	for _, payload := range anchored {
		next.RegisterAnchored(payload)
	}
	if keepTerminals {
		seen := map[int64]bool{}
		for index := 0; index < previous.AnchoredCount(); index++ {
			at := previous.AnchoredAt(index).ExpectedExpireAt
			if seen[at] {
				continue
			}
			seen[at] = true
			for count := previous.TerminalCount(at); count > 0; count-- {
				next.AddTerminal(at)
			}
		}
	}
	state.effectTimers = next
}

func expiryPayloadsForTest(state *Engine) []effectpkg.ExpiryPayload {
	out := make([]effectpkg.ExpiryPayload, state.effectTimers.ExpiryCount())
	for index := range out {
		out[index] = state.effectTimers.ExpiryAt(index)
	}
	return out
}

func anchoredPayloadsForTest(state *Engine) []effectpkg.AnchoredPayload {
	out := make([]effectpkg.AnchoredPayload, state.effectTimers.AnchoredCount())
	for index := range out {
		out[index] = state.effectTimers.AnchoredAt(index)
	}
	return out
}
