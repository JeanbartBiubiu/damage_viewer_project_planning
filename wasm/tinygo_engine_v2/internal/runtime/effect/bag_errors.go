package effect

import (
	"math"
	"tinygo_engine_v2/internal/model"
)

const maxJSONSafeInteger = int64(9007199254740991)

func addDuration(nowMs, durationMs int64) (int64, bool) {
	if durationMs <= 0 || nowMs > 0 && durationMs > math.MaxInt64-nowMs || nowMs < 0 && durationMs < math.MinInt64-nowMs {
		return 0, false
	}
	return nowMs + durationMs, true
}

func engineErrorPtrAt(phase model.GenericErrorPhase, code model.GenericErrCode, message, path, ref, schema, rules, session string) *model.EngineError {
	err := model.NewEngineError(phase, code, message)
	err.Path, err.Ref, err.SchemaHash, err.RulesHash, err.SessionID = path, ref, schema, rules, session
	return &err
}
