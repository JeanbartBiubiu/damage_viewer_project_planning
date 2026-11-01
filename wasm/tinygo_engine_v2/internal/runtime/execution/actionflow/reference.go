package actionflow

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// NormalizeAbilityRef 按真实双方把相对能力引用归一到实际拥有者，不改写非法引用。
func NormalizeAbilityRef(abilityRef, sourceKey, targetKey string) string {
	parsed, ok := planbundle.ParseAbilityRef(abilityRef)
	if !ok {
		return abilityRef
	}
	combatant := parsed.Combatant
	switch combatant {
	case model.SelectorSelf:
		combatant = sourceKey
	case model.SelectorOpponent:
		if sourceKey == model.SelectorSource {
			combatant = model.SelectorTarget
		} else if sourceKey == model.SelectorTarget {
			combatant = model.SelectorSource
		} else {
			combatant = targetKey
		}
	case model.SelectorSource, model.SelectorTarget:
		// already concrete
	default:
		return abilityRef
	}
	if combatant == "" {
		return abilityRef
	}
	return combatant + ".provider[" + parsed.ProviderRef + "].ability[" + parsed.AbilityKey + "]"
}
