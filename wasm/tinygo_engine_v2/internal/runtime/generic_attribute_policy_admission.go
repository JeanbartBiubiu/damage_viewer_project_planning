package runtime

import planbundle "tinygo_engine_v2/internal/plan"

func admissibleOwnedAttributePolicy(modifier planbundle.CompiledModifier) bool {
	switch modifier.ValuePolicy {
	case "add", "percent_add", "multiply":
		return true
	case "complement_multiply":
		return modifier.Kind == "attribute" && modifier.Stage == "total"
	default:
		return false
	}
}
