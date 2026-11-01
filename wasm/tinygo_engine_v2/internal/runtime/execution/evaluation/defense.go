package evaluation

import (
	"math"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/expression"
	"tinygo_engine_v2/internal/base/inputbinding"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// DefenseIdentity 保存原调用点的错误归属，不授予运行状态或帧访问能力。
type DefenseIdentity struct {
	AbilityRef, SchemaHash, RulesHash, SessionID string
}

// DefenseResult 是作者防御公式的倍率和金额；不包含护盾、生命或发布状态。
type DefenseResult struct{ Amount, Factor float64 }

// RequireConfiguredDefense 在金额短路之前核对实际伤害类型的完整作者防御计划。
func RequireConfiguredDefense(definitions map[string]planbundle.CompiledDamageTypeFormula, formulas formula.GenericRegistry, damageType, operationPath string, identity DefenseIdentity) (planbundle.CompiledDamageTypeFormula, *model.EngineError) {
	def, exists := definitions[damageType]
	valid := exists && def.DamageType == damageType && def.Binding != nil && int(def.Program) < len(formulas.Programs)
	if valid {
		program := formulas.Programs[def.Program]
		valid = program.Authored != nil && program.Authored.Stats().Stages > 0 && len(program.Instr) == 0 && program.NamedBinding == nil
	}
	if !valid {
		return planbundle.CompiledDamageTypeFormula{}, defenseError(identity, model.GenericErrRuntimeInvariantFailed, "damage operation requires a valid authored defense plan", operationPath+".damageType", damageType)
	}
	return def, nil
}

// ResolveConfiguredDefense 仅使用调用方选定的入口或复制冻结视图求值，保留缺失字段和原错误定位。
func ResolveConfiguredDefense(formulas formula.GenericRegistry, def planbundle.CompiledDamageTypeFormula, rawAmount float64, sourceAttrs, targetAttrs attribute.Table, identity DefenseIdentity) (DefenseResult, *model.EngineError) {
	var valueBuffer [8]inputbinding.Value
	values := valueBuffer[:0]
	if len(def.Reads) <= len(valueBuffer) {
		values = valueBuffer[:len(def.Reads)]
	} else {
		values = make([]inputbinding.Value, len(def.Reads))
	}
	for i, read := range def.Reads {
		attrs := sourceAttrs
		if read.Object == "target" {
			attrs = targetAttrs
		}
		slot, exists := attrs.Lookup(read.AttributeKey)
		if !exists {
			continue
		}
		values[i] = inputbinding.Value{Base: inputbinding.Scalar{Value: slot.Base, Present: slot.HasBase()}, Total: inputbinding.Scalar{Value: slot.Resolved, Present: slot.HasResolved()}}
	}
	factor, err := formulas.EvalBound(def.Program, def.Binding, values)
	if err != nil {
		if authored, ok := err.(*formula.AuthoredEvaluationError); ok {
			return DefenseResult{}, defenseFormulaIssue(identity, def, authored.Issue)
		}
		path := "formula"
		if int(def.Program) < len(formulas.Programs) {
			path = formulas.Programs[def.Program].Key
		}
		return DefenseResult{}, defenseError(identity, model.GenericErrFormulaTypeError, err.Error(), path, identity.AbilityRef)
	}
	amount := rawAmount * factor
	if factor < 0 {
		result := defenseFormulaIssue(identity, def, expression.ContractIssue{Code: "FORMULA_INVALID_OUTPUT"})
		result.Path, result.Message = def.OutputPath, "configured defense factor must be non-negative"
		return DefenseResult{}, result
	}
	if math.IsNaN(factor) || math.IsInf(factor, 0) || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		result := defenseFormulaIssue(identity, def, expression.ContractIssue{Code: "FORMULA_NON_FINITE"})
		result.Path = def.OutputPath
		return DefenseResult{}, result
	}
	return DefenseResult{Amount: amount, Factor: factor}, nil
}

func defenseFormulaIssue(identity DefenseIdentity, def planbundle.CompiledDamageTypeFormula, issue expression.ContractIssue) *model.EngineError {
	return defenseError(identity, model.GenericErrCode(issue.Code), issue.Code, def.Path+issue.Path, identity.AbilityRef)
}

func defenseError(identity DefenseIdentity, code model.GenericErrCode, message, path, ref string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, code, message)
	err.Path, err.Ref = path, ref
	err.SchemaHash, err.RulesHash, err.SessionID = identity.SchemaHash, identity.RulesHash, identity.SessionID
	return &err
}
