package execution

import (
	"path/filepath"
	gort "runtime"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

// 私有不变量测试组合真实循环和执行器，不复制循环算法或会话注册实现。
func newGenericRunState(compiled planbundle.CompiledSession, req model.RunRequest) (*Engine, *model.EngineError) {
	loop := scheduler.NewLoop(req.InitialSnapshot.TimeMs, req.StopPolicy.DurationMs, req.StopPolicy)
	return New(compiled, req, loop)
}
func runForTest(compiled planbundle.CompiledSession, req model.RunRequest) (model.DoneResult, *model.EngineError) {
	engine, err := newGenericRunState(compiled, req)
	if err != nil {
		return model.DoneResult{}, err
	}
	if err := engine.loop.Run(engine); err != nil {
		return model.DoneResult{}, err
	}
	return engine.Finish()
}
func (s *Engine) runLoop() *model.EngineError { return s.loop.Run(s) }

// 测试重新准备事件时只排空真实队列，不重建循环或重置已经分配的事件身份。
func clearQueuedEventsForTest(loop *scheduler.Loop) {
	for {
		if _, exists := takeNextEventForTest(loop); !exists {
			break
		}
	}
	loop.SetQueueLimit(0)
}
func executionModuleRoot() string {
	_, file, _, ok := gort.Caller(0)
	if !ok {
		panic("cannot locate engine test module")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}
func runtimeFixturePath(name string) string {
	return filepath.Join(executionModuleRoot(), "internal", "testkit", "fixtures", name)
}
