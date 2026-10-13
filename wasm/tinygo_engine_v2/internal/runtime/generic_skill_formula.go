package runtime

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// 保留共同程序原错误、JSON字段定位与实际使用引用，包含管道包装错误。
func preserveFormulaIssue(err error, fallback *model.EngineError) *model.EngineError {
	var authored *formula.AuthoredEvaluationError
	for depth := 0; err != nil && depth < 32; depth++ {
		if direct, ok := err.(*formula.AuthoredEvaluationError); ok {
			authored = direct
			break
		}
		wrapped, ok := err.(interface{ Unwrap() error })
		if !ok {
			break
		}
		err = wrapped.Unwrap()
	}
	if authored != nil {
		if fallback.Details == nil {
			fallback.Details = make(map[string]interface{})
		}
		if fallback.Path != "" {
			fallback.Details["usePoint"] = fallback.Path
		}
		fallback.Code = model.GenericErrCode(authored.Issue.Code)
		fallback.Path = authored.DefinitionPath + authored.Issue.Path
		fallback.Message = authored.Issue.Code + " in " + authored.ProgramKey
		if fallback.Details == nil {
			fallback.Details = make(map[string]interface{})
		}
		fallback.Details["formulaKey"] = authored.ProgramKey
		if authored.CombatantKey != "" {
			fallback.Details["combatantKey"] = authored.CombatantKey
		}
	}
	return fallback
}

func (f *executionFrame) preserveFormulaIssue(err error, fallback *model.EngineError) *model.EngineError {
	out := preserveFormulaIssue(err, fallback)
	if _, common := out.Details["formulaKey"]; common && f.abilityRef != "" {
		out.Ref = f.abilityRef
	}
	return out
}

func (s *genericRunState) evalFormulaError(id formula.GenericProgramID, err error, ref string) *model.EngineError {
	path := "formula"
	if int(id) < len(s.formulas.Programs) {
		path = s.formulas.Programs[id].Key
	}
	return preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID))
}
