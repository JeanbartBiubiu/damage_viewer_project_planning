package actionflow

import "tinygo_engine_v2/internal/model"

// ResolveDriverCombatant 只解析原驱动允许的实际来源与相对别名，是否存在由调用方核验。
func ResolveDriverCombatant(selector, sourceKey string) (string, bool) {
	key := selector
	switch selector {
	case model.SelectorSource, model.SelectorTarget:
	case model.SelectorSelf:
		key = sourceKey
	case model.SelectorOpponent:
		if sourceKey == model.SelectorSource {
			key = model.SelectorTarget
		} else if sourceKey == model.SelectorTarget {
			key = model.SelectorSource
		} else {
			return "", false
		}
	default:
		return "", false
	}
	return key, true
}
