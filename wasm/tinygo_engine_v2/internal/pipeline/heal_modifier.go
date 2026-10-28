package pipeline

import (
	"sort"
	"tinygo_engine_v2/internal/model"
)

func (r DamageModifierResolver) CollectForHeal(direction, category string) []MountedDamageModifier {
	var out []MountedDamageModifier
	for _, m := range r.mounts {
		if m.Command == "heal" && m.HealDirection == direction && (m.HealCategory == model.HealAny || m.HealCategory == category) {
			out = append(out, m)
		}
	}
	if len(out) < 2 {
		return out
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Priority != b.Priority {
			return a.Priority < b.Priority
		}
		if a.OwnerCombatantKey != b.OwnerCombatantKey {
			return a.OwnerCombatantKey < b.OwnerCombatantKey
		}
		if a.ProviderRef != b.ProviderRef {
			return a.ProviderRef < b.ProviderRef
		}
		return a.ModifierKey < b.ModifierKey
	})
	return out
}
