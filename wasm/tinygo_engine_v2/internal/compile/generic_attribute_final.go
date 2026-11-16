package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func validateFinalAttributeLimit(raw model.ModifierDefinition, mod plan.CompiledModifier, path string, ctx *genericCompileContext) {
	if mod.Stage != "final" {
		return
	}
	attributeKey := multiplierAttributeKey(raw.Target)
	validTarget := attributeKey != "" && !strings.Contains(attributeKey, ".") && strings.TrimSpace(raw.Target) == raw.Target && (!strings.Contains(raw.Target, ".") || explicitRuleMultiplierAttributeTarget(raw.Target))
	if mod.Kind != "attribute" || mod.ValuePolicy != "min" || !validTarget || raw.Condition != nil || raw.MultiplierGroupKey != nil || mod.HasMultiplierGroup || mod.Command != "" || mod.Channel != "" || mod.Bucket != "" || mod.Priority != 0 || mod.CurrentValuePolicy != "" || raw.AffectedAbilityRefs != nil || mod.ValueReadMode != "" || raw.MaximumReductionRatio != nil || mod.HealDirection != "" || mod.HealCategory != "" || mod.HealGroupKey != "" || mod.HealGroupCalculationMode != "" {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "final attribute limit requires a plain attribute min with an explicit target and no condition, grouping or pipeline fields", mod.ModifierKey)
	}
	if !mod.HasValue {
		ctx.collector.addError(model.GenericErrMissingRequiredField, path+".value", "final attribute limit requires an explicit finite static value", mod.ModifierKey)
		return
	}
	value, static := ctx.formulas.FoldStatic(mod.ValueProgram)
	if !static || math.IsNaN(value) || math.IsInf(value, 0) {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".value", "final attribute limit requires an explicit finite static value", mod.ModifierKey)
	}
}
