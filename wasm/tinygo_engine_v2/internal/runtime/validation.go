package runtime

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

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
