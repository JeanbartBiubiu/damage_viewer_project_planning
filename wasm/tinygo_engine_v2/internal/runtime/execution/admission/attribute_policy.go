package admission

import (
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
