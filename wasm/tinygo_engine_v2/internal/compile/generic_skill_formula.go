package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func (ctx *genericCompileContext) validateFormulaScope(instr []formula.GenericInstr, path string) bool {
	valid := true
	for _, in := range instr {
		if in.Op != formula.GenericOpRef {
			continue
		}
		if int(in.RefIndex) >= ctx.formulas.Count() {
			valid = false
			continue
		}
		program := ctx.formulas.Info(formula.GenericProgramID(in.RefIndex))
		if !program.DeclaredNamed || !program.HasNamedBinding ||
			(program.Scope != "skill" && program.Scope != "game") ||
			(program.Scope == "skill" && (ctx.currentSkillKey == "" || program.SkillKey != ctx.currentSkillKey)) {
			ctx.collector.addError(model.GenericErrUnknownRef, path, "common formula requires its independently declared owning skill", program.Key)
			valid = false
		}
	}
	return valid
}

// 静态位置仅接受字面数字或严格外部引用，再按字段原有约束冻结。
func (ctx *genericCompileContext) freezeStatic(raw any, path string, optional bool) (float64, bool) {
	if raw == nil && optional {
		return 0, true
	}
	if value, ok := asSchemaFloat64(raw); ok {
		return value, true
	}
	var expr model.GenericFormulaExpr
	switch value := raw.(type) {
	case model.GenericFormulaExpr:
		if value.Op != "ref" || value.Ref == "" || value.Value != nil || value.Path != "" || len(value.Args) != 0 || value.Decimals != nil || value.Min != nil || value.Max != nil || value.Expr != nil {
			break
		}
		expr = value
	case map[string]any:
		if len(value) != 2 || value["op"] != "ref" {
			break
		}
		ref, ok := value["ref"].(string)
		if ok {
			expr = model.GenericFormulaExpr{Op: "ref", Ref: ref}
		}
	}
	if expr.Ref == "" {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "static value requires a number or strict external formula ref", "")
		return 0, false
	}
	instr := formula.CompileGenericFormula(expr, path, ctx.namedFormulas, nil, ctx.collector.addError)
	if len(instr) == 0 || !ctx.validateFormulaScope(instr, path) {
		return 0, false
	}
	if len(ctx.formulas.InstructionDependencies(instr, nil)) != 0 {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "static formula permits only selected fixed or level parameters", expr.Ref)
		return 0, false
	}
	id, ok := ctx.registerFormula(path, instr)
	if !ok {
		return 0, false
	}
	value, ok := ctx.formulas.FoldStatic(id)
	if !ok {
		_, err := ctx.formulas.Eval(id, formula.GenericEvalContext{})
		if err != nil {
			if authored, yes := err.(*formula.AuthoredEvaluationError); yes {
				ctx.collector.addError(model.GenericErrCode(authored.Issue.Code), authored.DefinitionPath+authored.Issue.Path, authored.Error(), authored.ProgramKey)
				return 0, false
			}
		}
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "static formula cannot be evaluated", expr.Ref)
	}
	return value, ok
}

func (ctx *genericCompileContext) freezeStateSchema(schema map[string]any, path string) map[string]any {
	out := make(map[string]any, len(schema))
	for key, raw := range schema {
		if obj, ok := raw.(map[string]any); ok {
			if obj["op"] == "ref" {
				value, valid := ctx.freezeStatic(raw, path+"."+key, false)
				if valid {
					out[key] = value
				}
				continue
			}
			copyObj := make(map[string]any, len(obj))
			for field, value := range obj {
				copyObj[field] = value
			}
			for _, field := range []string{"defaultValue", "maxValue", "durationMs"} {
				if value, exists := obj[field]; exists {
					frozen, valid := ctx.freezeStatic(value, path+"."+key+"."+field, false)
					if valid {
						copyObj[field] = frozen
					} else {
						delete(copyObj, field)
					}
				}
			}
			out[key] = copyObj
		} else {
			out[key] = raw
		}
	}
	return out
}

func (ctx *genericCompileContext) validateForeignProviderRuntime(definitionRef, path string) {
	index, exists := findProviderIndex(ctx.session, definitionRef)
	if !exists {
		return
	}
	provider := ctx.session.Providers[index]
	if provider.SkillKey == ctx.currentSkillKey {
		return
	}
	var programs []formula.GenericProgramID
	if provider.Lifecycle != nil && provider.Lifecycle.HasDuration {
		programs = append(programs, provider.Lifecycle.DurationProgram)
	}
	for _, mod := range provider.Modifiers {
		if mod.HasValue {
			programs = append(programs, mod.ValueProgram)
		}
		if mod.HasCondition {
			programs = append(programs, mod.ConditionProg)
		}
	}
	for _, state := range provider.StatusContributions {
		if state.HasStrength {
			programs = append(programs, state.StrengthProgram)
		}
	}
	for _, program := range programs {
		for _, dep := range ctx.formulas.ReadDependencies(program) {
			if dep.ReadKind == formula.ReadAuthoredRuntimeParameter || dep.ReadKind == formula.ReadAuthoredAbilityParameter || dep.ReadKind == formula.ReadUseChargeDuration || dep.ReadKind == formula.ReadProcessActualCost || dep.ReadKind == formula.ReadProcessStartState {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "cross-skill definition runtime inputs cannot borrow the current skill", definitionRef)
				return
			}
		}
	}
}
