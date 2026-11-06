package runtime

import (
	"math"
	"strconv"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// validateRunTimeRange 在创建时钟和任何单场状态前核对运行窗口及驱动时刻。
func validateRunTimeRange(compiled planbundle.CompiledSession, req model.RunRequest) *model.EngineError {
	start, duration := req.InitialSnapshot.TimeMs, req.StopPolicy.DurationMs
	if start < 0 {
		return runTimeRangeError(compiled, req, "initialSnapshot.timeMs", "initial snapshot time must be non-negative")
	}
	if duration < 0 || duration > math.MaxInt64-start {
		return runTimeRangeError(compiled, req, "stopPolicy.durationMs", "duration must be non-negative and its end time must fit int64")
	}
	for index, entry := range req.DriverPlan.Entries {
		if entry.FirstAtMs < start {
			return runTimeRangeError(compiled, req, "driverPlan.entries["+strconv.Itoa(index)+"].firstAtMs", "driver cannot precede the initial snapshot")
		}
	}
	return nil
}

func runTimeRangeError(compiled planbundle.CompiledSession, req model.RunRequest, path, message string) *model.EngineError {
	err := runRequestError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	err.Path = path
	return err
}

func validateGenericRunRequest(compiled planbundle.CompiledSession, req model.RunRequest) *model.EngineError {
	if req.SessionID == "" {
		return runRequestError(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "sessionId is required", compiled.SchemaHash, compiled.RulesHash, "")
	}
	if req.InitialSnapshot.SchemaHash == "" {
		return runRequestError(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "initialSnapshot.schemaHash is required", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if req.InitialSnapshot.SchemaHash != compiled.SchemaHash {
		return runRequestError(model.GenericPhaseRun, model.GenericErrHashMismatch, "initialSnapshot.schemaHash mismatch", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if req.InitialSnapshot.RulesHash == "" {
		return runRequestError(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "initialSnapshot.rulesHash is required", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if req.InitialSnapshot.RulesHash != compiled.RulesHash {
		return runRequestError(model.GenericPhaseRun, model.GenericErrHashMismatch, "initialSnapshot.rulesHash mismatch", compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	return nil
}

func runRequestError(phase model.GenericErrorPhase, code model.GenericErrCode, message, schema, rules, session string) *model.EngineError {
	err := engineError(phase, code, message, schema, rules, session)
	return &err
}
