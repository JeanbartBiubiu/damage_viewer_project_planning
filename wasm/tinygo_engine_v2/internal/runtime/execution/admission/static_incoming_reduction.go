package admission

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

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
	if int(mod.ConditionProg) >= formulas.Metadata.Count() {
		return false
	}
	program := formulas.Metadata.Instructions(mod.ConditionProg)
	return len(program) == 1 && program[0].Op == formula.GenericOpRead &&
		program[0].ReadKind == formula.ReadDamageType && program[0].ReadKey != ""
}
