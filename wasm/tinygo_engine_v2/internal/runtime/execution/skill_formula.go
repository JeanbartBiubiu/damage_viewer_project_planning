package execution

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// 保留共同程序原错误、JSON字段定位与实际使用引用，包含管道包装错误。
func preserveFormulaIssue(err error, fallback *model.EngineError) *model.EngineError {
	var authored *formula.AuthoredEvaluationError
	var grouped *pipeline.AttributeGroupIssue
	for depth := 0; err != nil && depth < 32; depth++ {
		if direct, ok := err.(*pipeline.AttributeGroupIssue); ok {
			grouped = direct
		}
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
	if grouped != nil {
		if authored == nil && grouped.ValuePath != "" {
			fallback.Path = grouped.ValuePath
		}
		member := grouped.Member
		fallback.Ref = member.OwnerCombatantKey + ".provider[" + member.ProviderRef + "].modifier[" + member.ModifierKey + "]"
		if fallback.Details == nil {
			fallback.Details = make(map[string]interface{})
		}
		fallback.Details["attributeGroupSource"] = true
		fallback.Details["attributeKey"] = grouped.AttributeKey
		fallback.Details["providerOwner"] = member.OwnerCombatantKey
		fallback.Details["providerRef"] = member.ProviderRef
		fallback.Details["modifierKey"] = member.ModifierKey
	}
	return fallback
}

func (f *Frame) preserveFormulaIssue(err error, fallback *model.EngineError) *model.EngineError {
	out := preserveFormulaIssue(err, fallback)
	_, grouped := out.Details["attributeGroupSource"]
	if _, common := out.Details["formulaKey"]; common && !grouped && f.abilityRef != "" {
		out.Ref = f.abilityRef
	}
	return out
}

func (s *Engine) evalFormulaError(id formula.GenericProgramID, err error, ref string) *model.EngineError {
	path := "formula"
	if int(id) < len(s.formulas.Programs) {
		path = s.formulas.Programs[id].Key
	}
	return preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID))
}
