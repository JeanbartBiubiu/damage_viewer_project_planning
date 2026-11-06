package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func newTestLoopAt(at int64) *scheduler.Loop {
	loop := scheduler.NewLoop(0, 0, model.StopPolicy{})
	loop.Advance(at)
	return loop
}

func takeNextEventForTest(loop *scheduler.Loop) (scheduler.GenericEvent, bool) {
	at, exists := loop.NextEventAt()
	if !exists {
		return scheduler.GenericEvent{}, false
	}
	return loop.TakeAt(at)
}

type prefixTestDriver struct {
	*Engine
	through    int64
	checkpoint *model.EngineError
}

func (d *prefixTestDriver) DecideNext(observation scheduler.LoopObservation) (scheduler.LoopDecision, *model.EngineError) {
	decision, err := d.Engine.DecideNext(observation)
	if err != nil {
		return decision, err
	}
	if decision.Kind == scheduler.LoopHandleNext && observation.HasNextEvent && observation.NextEventAtMs > d.through {
		return scheduler.LoopDecision{}, d.checkpoint
	}
	return decision, nil
}

// 检查点只中断接纳下一事件，不结束观察窗口或改变真实循环的队列、计数和停止状态。
func runPrefixThroughForTest(t *testing.T, state *Engine, through int64) {
	t.Helper()
	checkpoint := &model.EngineError{Message: "test prefix checkpoint"}
	driver := &prefixTestDriver{Engine: state, through: through, checkpoint: checkpoint}
	if err := state.loop.Run(driver); err != checkpoint {
		t.Fatalf("expected prefix checkpoint through %d, got %v", through, err)
	}
}
