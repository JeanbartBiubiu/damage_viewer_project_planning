package evaluation

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// PreserveFormulaIssue 最多解包32层，保留作者定位、调用位置及实际分组来源。
// 共同公式没有分组来源且abilityRef非空时使用真实能力引用；否则保留所属错误的引用。
// 未匹配时返回原fallback，不为普通错误创建Details。
func PreserveFormulaIssue(err error, fallback *model.EngineError, abilityRef string) *model.EngineError {
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
	_, hasGroupSource := fallback.Details["attributeGroupSource"]
	if _, common := fallback.Details["formulaKey"]; common && !hasGroupSource && abilityRef != "" {
		fallback.Ref = abilityRef
	}
	return fallback
}
