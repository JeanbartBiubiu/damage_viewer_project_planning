package admission

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

// OwnedAttributePolicy 判断已有属性计算策略是否获准。
func OwnedAttributePolicy(modifier planbundle.CompiledModifier) bool {
	switch modifier.ValuePolicy {
	case "add", "percent_add", "multiply":
		return true
	case "complement_multiply":
		return modifier.Kind == "attribute" && modifier.Stage == "total"
	default:
		return false
	}
}

// finiteFinalAttributePolicy 仅供已核对生命周期与实际自身接收者的动态效果使用，不扩大永久来源策略。
func finiteFinalAttributePolicy(formulas formula.Library, modifier planbundle.CompiledModifier) bool {
	if modifier.Kind != "attribute" || modifier.Stage != "final" || modifier.ValuePolicy != "min" || !modifier.HasValue || modifier.HasCondition || modifier.HasMultiplierGroup || modifier.Bucket != "" || modifier.ValueReadMode != "" {
		return false
	}
	value, fixed := formulas.Metadata.FoldStatic(modifier.ValueProgram)
	return fixed && !math.IsNaN(value) && !math.IsInf(value, 0)
}
