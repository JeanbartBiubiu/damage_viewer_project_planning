package compile

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

// finiteFinalAttributePolicy 仅供已核对生命周期与实际自身接收者的动态效果使用，不扩大永久来源策略。
func finiteFinalAttributePolicy(formulas formula.Library, modifier planbundle.CompiledModifier) bool {
	if modifier.Kind != "attribute" || modifier.Stage != "final" || modifier.ValuePolicy != "min" || !modifier.HasValue || modifier.HasCondition || modifier.HasMultiplierGroup || modifier.Bucket != "" || modifier.ValueReadMode != "" {
		return false
	}
	value, fixed := formulas.Metadata.FoldStatic(modifier.ValueProgram)
	return fixed && !math.IsNaN(value) && !math.IsInf(value, 0)
}

// 新作者路径只在原有完整静态源或有限单层源闭包内扩大伤害增幅。
// 唯一允许的条件是明确的伤害类型谓词，不借此开放动态数值或任意条件。
func groupedDamageSourceModifier(formulas formula.Library, mod planbundle.CompiledModifier) bool {
	if !mod.HasMultiplierGroup || mod.Kind != "pipeline" || mod.Command != "damage" ||
		(mod.Stage != "outgoing_pre_mitigation" && mod.Stage != "incoming_post_mitigation") ||
		mod.ValuePolicy != "multiply" || mod.Channel != "all_damage" || mod.Bucket != "all_instances" ||
		!mod.HasValue || mod.HasMaximumReductionRatio || mod.ValueReadMode != "" ||
		int(mod.ValueProgram) >= formulas.Metadata.Count() {
		return false
	}
	value, static := formulas.Metadata.FoldStatic(mod.ValueProgram)
	if !static || math.IsNaN(value) || math.IsInf(value, 0) || value < 1 {
		return false
	}
	if !mod.HasCondition {
		return false // 作者必须明确所选伤害类型，不能以省略表示全部类型。
	}
	return singleDamageTypeCondition(formulas, mod.ConditionProg)
}

// staticIncomingDamageReductionModifier 仅供完整永久初始化闭包使用，不扩大动态来源。
// 数值保持静态；可选的单伤害类型谓词仍由实际伤害管道求值。
func staticIncomingDamageReductionModifier(formulas formula.Library, mod planbundle.CompiledModifier) bool {
	if mod.Kind != "pipeline" || mod.Command != "damage" || mod.Stage != "incoming_post_mitigation" ||
		mod.Channel != "all_damage" || mod.Bucket != "all_instances" || mod.ValuePolicy != "multiply" ||
		mod.HasMultiplierGroup || mod.HasMaximumReductionRatio || mod.ValueReadMode != "" ||
		!mod.HasValue || int(mod.ValueProgram) >= formulas.Metadata.Count() {
		return false
	}
	value, static := formulas.Metadata.FoldStatic(mod.ValueProgram)
	if !static || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
		return false
	}
	if !mod.HasCondition {
		return true
	}
	return singleDamageTypeCondition(formulas, mod.ConditionProg)
}

func singleDamageTypeCondition(formulas formula.Library, id formula.GenericProgramID) bool {
	if int(id) >= formulas.Metadata.Count() {
		return false
	}
	program := formulas.Metadata.Instructions(id)
	return len(program) == 1 && program[0].Op == formula.GenericOpRead &&
		program[0].ReadKind == formula.ReadDamageType && program[0].ReadKey != ""
}
