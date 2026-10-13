// Package formuladefinition仅构造测试的共同作者数据，不进入正式编译路径。
package formuladefinition

import (
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
)

func Const(v float64) any {
	return map[string]any{"op": "const", "value": strconv.FormatFloat(v, 'g', -1, 64)}
}
func Stage(key string, expr any) any {
	return map[string]any{"key": key, "name": "测试结果", "expression": expr}
}
func Definition(inputs, stages []any, output string) any {
	if inputs == nil {
		inputs = []any{}
	}
	return map[string]any{"inputs": inputs, "stages": stages, "outputStageKey": output}
}
func Constant(key, skill string, value float64) model.NamedFormula {
	return model.NamedFormula{Scope: "skill", Key: key, SkillKey: skill, Expression: Definition(nil, []any{Stage("output", Const(value))}, "output"), Parameters: []model.FormulaParameter{}}
}

// FromExpr迁移测试构造中的已知属性/参数树，不接受内部事件或状态用途读。
func FromExpr(key, skill string, root model.GenericFormulaExpr, values map[string]float64) model.NamedFormula {
	var inputs []any
	parameters := []model.FormulaParameter{}
	keys := map[string]string{}
	var convert func(model.GenericFormulaExpr) any
	convert = func(expr model.GenericFormulaExpr) any {
		if expr.Op == "const" {
			if expr.Value == nil {
				return map[string]any{"op": "const"}
			}
			return Const(*expr.Value)
		}
		if expr.Op == "read" {
			input, known := keys[expr.Path]
			if !known {
				input = "input" + strconv.Itoa(len(keys))
				keys[expr.Path] = input
				var binding any
				parts := strings.Split(expr.Path, ".")
				if len(parts) == 4 && parts[1] == "attr" {
					kind := map[string]string{"base": "BASE", "resolved": "TOTAL", "current": "CURRENT", "max": "MAX"}[parts[3]]
					binding = map[string]any{"kind": "attribute", "object": parts[0], "attributeKey": parts[2], "valueKind": kind, "view": "current_frame"}
				} else if strings.HasPrefix(expr.Path, "ability.param.") {
					parameter := strings.TrimPrefix(expr.Path, "ability.param.")
					binding = map[string]any{"kind": "parameter", "skillKey": skill, "parameterKey": parameter}
					value, exists := values[parameter]
					mode := "RUNTIME_INPUT"
					var selected *float64
					if exists {
						mode = "FIXED"
						selected = &value
					}
					parameters = append(parameters, model.FormulaParameter{ParameterKey: parameter, ValueMode: mode, ValueType: "DECIMAL", Value: selected})
				} else if strings.HasPrefix(expr.Path, "process.actual_cost.") || expr.Path == "use.charge_duration_ms" {
					parameter := "runtime" + strconv.Itoa(len(parameters))
					binding = map[string]any{"kind": "parameter", "skillKey": skill, "parameterKey": parameter}
					source := &model.FormulaRuntimeSource{Kind: "use_charge_duration"}
					if strings.HasPrefix(expr.Path, "process.actual_cost.") {
						source = &model.FormulaRuntimeSource{Kind: "process_actual_cost", ResourceKey: strings.TrimPrefix(expr.Path, "process.actual_cost.")}
					}
					parameters = append(parameters, model.FormulaParameter{ParameterKey: parameter, ValueMode: "RUNTIME_INPUT", ValueType: "DECIMAL", RuntimeSource: source})
				} else {
					binding = map[string]any{"kind": "context", "contextKey": expr.Path}
				}
				inputs = append(inputs, map[string]any{"key": input, "binding": binding})
			}
			return map[string]any{"op": "read", "inputKey": input}
		}
		if expr.Op == "ref" {
			return map[string]any{"op": "ref", "stageKey": expr.Ref}
		}
		var args []any
		for _, arg := range expr.Args {
			args = append(args, convert(arg))
		}
		if expr.Expr != nil {
			args = append(args, convert(*expr.Expr))
		}
		if expr.Min != nil {
			args = append(args, convert(*expr.Min))
		}
		if expr.Max != nil {
			args = append(args, convert(*expr.Max))
		}
		out := map[string]any{"op": expr.Op, "args": args}
		if expr.Decimals != nil {
			out["decimals"] = *expr.Decimals
		}
		return out
	}
	output := convert(root)
	return model.NamedFormula{Scope: "skill", Key: key, SkillKey: skill, Expression: Definition(inputs, []any{Stage("output", output)}, "output"), Parameters: parameters}
}
