package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func newTestLoopAt(at int64) *scheduler.Loop {
	loop := scheduler.NewLoop(0, 0, model.StopPolicy{})
	loop.Advance(at)
	return loop
}

// 重建测试观察窗口，继续借用同一份真实队列，不公开循环内部状态。
func setTestLoopDuration(state *Engine, duration int64) {
	replaceTestLoop(state, duration, true)
}

func clearTestLoopStop(state *Engine) {
	replaceTestLoop(state, state.loop.DurationMs(), false)
}

func replaceTestLoop(state *Engine, duration int64, preserveStop bool) {
	previous := state.loop
	loop := scheduler.NewLoop(previous.StartMs(), duration, state.req.StopPolicy)
	*loop.Queue() = *previous.Queue()
	for count := 0; count < previous.ProcessedEvents(); count++ {
		loop.AcceptEvent(previous.TimeMs())
	}
	loop.Advance(previous.TimeMs())
	if preserveStop && previous.Stopped() {
		loop.Stop(previous.Reason())
	}
	state.loop = loop
}
