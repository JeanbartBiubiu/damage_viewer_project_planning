package runtime

import "tinygo_engine_v2/internal/model"

// Driver source/target are concrete snapshot actor keys. Only self/opponent
// are relative aliases; operation targets retain their frame-relative meaning.
func (s *genericRunState) resolveDriverCombatantKey(selector, sourceKey string) (string, bool) {
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
	return key, s.combatantExists(key)
}
