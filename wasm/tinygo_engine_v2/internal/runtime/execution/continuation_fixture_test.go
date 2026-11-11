package execution

import "tinygo_engine_v2/internal/runtime/execution/usage"

// 组合测试用有限输入准备真实收集器，不读取续接包的私有载荷表。
type collectorTestSeed struct {
	damages      []copyableDamageFrozen
	repeats      []deferredRepeatRequest
	reservation  usage.Reservation
	commandCount int
}

func newTestCopyableCollector(seed collectorTestSeed) *eventCopyableCollector {
	c := &eventCopyableCollector{}
	c.Append(seed.damages, seed.repeats)
	c.SetCommands(seed.commandCount)
	c.SetReservation(seed.reservation)
	return c
}
func pendingContinuations(s *Engine) int { n, _ := s.continuations.PendingCounts(); return n }
