package runtime

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution"
	"tinygo_engine_v2/internal/scheduler"
)

// RunGeneric 为单次运行创建唯一循环并协调初始化、执行及末态输出。
func RunGeneric(compiled planbundle.CompiledSession, req model.RunRequest) (model.DoneResult, *model.EngineError) {
	loop := scheduler.NewLoop(req.InitialSnapshot.TimeMs, req.StopPolicy.DurationMs, req.StopPolicy)
	engine, err := execution.New(compiled, req, loop)
	if err != nil {
		return model.DoneResult{}, err
	}
	if err := loop.Run(engine); err != nil {
		return model.DoneResult{}, err
	}
	return engine.Finish()
}
