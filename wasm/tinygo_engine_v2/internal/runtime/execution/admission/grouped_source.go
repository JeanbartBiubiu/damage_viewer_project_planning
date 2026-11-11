package admission

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

// 新作者路径只在原有完整静态源或有限单层源闭包内扩大伤害增幅。
// 唯一允许的条件是明确的伤害类型谓词，不借此开放动态数值或任意条件。
func GroupedDamageSourceModifier(formulas formula.Library, mod planbundle.CompiledModifier) bool {
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
	if int(mod.ConditionProg) >= formulas.Metadata.Count() {
		return false
	}
	program := formulas.Metadata.Instructions(mod.ConditionProg)
	return len(program) == 1 && program[0].Op == formula.GenericOpRead &&
		program[0].ReadKind == formula.ReadDamageType && program[0].ReadKey != ""
}
