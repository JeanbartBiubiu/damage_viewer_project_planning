package evaluation

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// 保留共同程序原错误、JSON字段定位与实际使用引用，包含管道包装错误。
// PreserveFormulaIssue 保留作者公式与分组错误的原定义定位及使用事实。
func PreserveFormulaIssue(err error, fallback *model.EngineError) *model.EngineError {
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
