// Damage pipeline modifiers (kind=pipeline, command=damage|crit).
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
	HealDirection     string
	HealCategory      string
	HealGroupKey      string
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
		HealDirection:     mod.HealDirection,
		HealCategory:      mod.HealCategory,
		HealGroupKey:      mod.HealGroupKey,
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
	return r.CollectForChannels([]string{channel}, stage)
}

// CollectedDamageModifier is a mounted damage modifier plus the channels that selected it.
type CollectedDamageModifier struct {
	Modifier        MountedDamageModifier
	MatchedChannels []string
}

// CollectForChannels returns the de-duplicated union of mounts matching any of the given
// channels at stage for command=damage, sorted by the global stable order.
func (r DamageModifierResolver) CollectForChannels(channels []string, stage string) []MountedDamageModifier {
	collected := r.CollectForCommandChannelsWithMatches("damage", channels, stage)
	out := make([]MountedDamageModifier, len(collected))
	for i, c := range collected {
		out[i] = c.Modifier
	}
	return out
}

// CollectForChannelsWithMatches is CollectForChannels plus matched channel provenance (command=damage).
func (r DamageModifierResolver) CollectForChannelsWithMatches(channels []string, stage string) []CollectedDamageModifier {
	return r.CollectForCommandChannelsWithMatches("damage", channels, stage)
}

// CollectForCommandChannelsWithMatches selects by command plus the de-duplicated union of all
// matching channels at stage, preserving stable order and matched channel evidence.
func (r DamageModifierResolver) CollectForCommandChannelsWithMatches(command string, channels []string, stage string) []CollectedDamageModifier {
	if len(channels) == 0 || command == "" {
		return nil
	}
	wanted := make(map[string]struct{}, len(channels))
	for _, ch := range channels {
		if ch != "" {
			wanted[ch] = struct{}{}
		}
	}
	type acc struct {
		mod      MountedDamageModifier
		channels map[string]struct{}
	}
	byID := map[string]*acc{}
	order := make([]string, 0)
	for _, m := range r.mounts {
		if m.Command != command {
			continue
		}
		if m.Stage != stage {
			continue
		}
		if _, ok := wanted[m.Channel]; !ok {
			continue
		}
		id := m.OwnerCombatantKey + "\x00" + m.ProviderRef + "\x00" + m.ModifierKey
		if existing, ok := byID[id]; ok {
			existing.channels[m.Channel] = struct{}{}
			continue
		}
		byID[id] = &acc{
			mod:      m,
			channels: map[string]struct{}{m.Channel: {}},
		}
		order = append(order, id)
	}
	out := make([]CollectedDamageModifier, 0, len(order))
	for _, id := range order {
		a := byID[id]
		matched := make([]string, 0, len(a.channels))
		for _, ch := range channels {
			if _, ok := a.channels[ch]; ok {
				matched = append(matched, ch)
			}
		}
		// Include any extra channel keys deterministically if not in the preferred order list.
		if len(matched) < len(a.channels) {
			extras := make([]string, 0, len(a.channels)-len(matched))
			for ch := range a.channels {
				found := false
				for _, m := range matched {
					if m == ch {
						found = true
						break
					}
				}
				if !found {
					extras = append(extras, ch)
				}
			}
			sort.Strings(extras)
			matched = append(matched, extras...)
		}
		out = append(out, CollectedDamageModifier{Modifier: a.mod, MatchedChannels: matched})
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].Modifier, out[j].Modifier
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

// ApplyDamageValuePolicy applies multiply/override/subtract to the current damage amount.
// subtract is max(0, amount - value).
func ApplyDamageValuePolicy(amount float64, policy string, value float64) float64 {
	switch policy {
	case "multiply":
		return amount * value
	case "override":
		return value
	case "subtract":
		next := amount - value
		if next < 0 {
			return 0
		}
		return next
	default:
		return amount
	}
}
