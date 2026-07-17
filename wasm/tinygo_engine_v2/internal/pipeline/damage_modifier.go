// Damage pipeline modifiers (kind=pipeline, command=damage).
package pipeline

import (
	"sort"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
)

// MountedDamageModifier is a provider/rules pipeline damage modifier mounted on a combatant.
// OwnerCombatantKey + ProviderRef identify the mounted provider for formula provenance.
type MountedDamageModifier struct {
	OwnerCombatantKey string
	ProviderRef       string
	ModifierKey       string
	Command           string
	Channel           string
	Bucket            string
	Stage             string
	Priority          int
	ValuePolicy       string
	ValueProgram      formula.GenericProgramID
	HasValue          bool
	HasCondition      bool
	ConditionProg     formula.GenericProgramID
}

// DamageModifierResolver aggregates pipeline damage modifiers on one combatant.
type DamageModifierResolver struct {
	mounts []MountedDamageModifier
}

// Clone deep-copies resolver state.
func (r DamageModifierResolver) Clone() DamageModifierResolver {
	out := DamageModifierResolver{mounts: make([]MountedDamageModifier, len(r.mounts))}
	copy(out.mounts, r.mounts)
	return out
}

// MountCompiledModifierOwned mounts a kind=pipeline damage modifier with owner provenance.
func (r *DamageModifierResolver) MountCompiledModifierOwned(ownerCombatantKey, providerRef string, mod compilebundle.CompiledModifier) {
	if mod.Kind != "pipeline" {
		return
	}
	r.mounts = append(r.mounts, MountedDamageModifier{
		OwnerCombatantKey: ownerCombatantKey,
		ProviderRef:       providerRef,
		ModifierKey:       mod.ModifierKey,
		Command:           mod.Command,
		Channel:           mod.Channel,
		Bucket:            mod.Bucket,
		Stage:             mod.Stage,
		Priority:          mod.Priority,
		ValuePolicy:       mod.ValuePolicy,
		ValueProgram:      mod.ValueProgram,
		HasValue:          mod.HasValue,
		HasCondition:      mod.HasCondition,
		ConditionProg:     mod.ConditionProg,
	})
}

// UnmountProviderOwned removes mounts matching ownerCombatantKey + providerRef.
func (r *DamageModifierResolver) UnmountProviderOwned(ownerCombatantKey, providerRef string) {
	if len(r.mounts) == 0 {
		return
	}
	out := r.mounts[:0]
	for _, m := range r.mounts {
		if m.ProviderRef == providerRef && m.OwnerCombatantKey == ownerCombatantKey {
			continue
		}
		out = append(out, m)
	}
	r.mounts = out
}

// CollectForStage returns mounts for command=damage, the given channel/stage, sorted deterministically:
// priority, ownerCombatantKey, providerRef, modifierKey.
func (r DamageModifierResolver) CollectForStage(channel, stage string) []MountedDamageModifier {
	var out []MountedDamageModifier
	for _, m := range r.mounts {
		if m.Command != "damage" {
			continue
		}
		if m.Channel != channel {
			continue
		}
		if m.Stage != stage {
			continue
		}
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Priority != out[j].Priority {
			return out[i].Priority < out[j].Priority
		}
		if out[i].OwnerCombatantKey != out[j].OwnerCombatantKey {
			return out[i].OwnerCombatantKey < out[j].OwnerCombatantKey
		}
		if out[i].ProviderRef != out[j].ProviderRef {
			return out[i].ProviderRef < out[j].ProviderRef
		}
		return out[i].ModifierKey < out[j].ModifierKey
	})
	return out
}

// ApplyDamageValuePolicy applies multiply/override to the current damage amount.
func ApplyDamageValuePolicy(amount float64, policy string, value float64) float64 {
	switch policy {
	case "multiply":
		return amount * value
	case "override":
		return value
	default:
		return amount
	}
}
