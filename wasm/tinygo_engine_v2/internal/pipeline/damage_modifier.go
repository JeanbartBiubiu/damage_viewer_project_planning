// Damage pipeline modifiers (kind=pipeline, command=damage|crit).
package pipeline

import (
	"sort"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

// MountedDamageModifier is a provider/rules pipeline damage modifier mounted on a combatant.
// OwnerCombatantKey + ProviderRef identify the mounted provider for formula provenance.
type MountedDamageModifier struct {
	HasMultiplierGroup       bool
	MultiplierGroupID        uint16
	HasMaximumReductionRatio bool
	MaximumReductionRatio    float64
	OwnerCombatantKey        string
	ProviderRef              string
	ModifierKey              string
	Command                  string
	Channel                  string
	Bucket                   string
	Stage                    string
	Priority                 int
	HealDirection            string
	HealCategory             string
	HealGroupKey             string
	HealGroupCalculationMode string
	ValuePolicy              string
	ValueProgram             formula.GenericProgramID
	HasValue                 bool
	HasCondition             bool
	ConditionProg            formula.GenericProgramID
}

// DamageModifierResolverAPI 集中声明伤害与治疗修正的挂载及稳定收集，不拥有角色或效果生命周期。
// 声明用于阅读与编译检查；实际调用继续使用具体类型。
type DamageModifierResolverAPI interface {
	// Clone 复制解析器值并共享不可变挂载切片；后续挂载与卸载建立新切片。
	Clone() DamageModifierResolver
	// CollectForChannels 收集任一指定频道匹配的伤害修正并去重，保留稳定顺序。
	CollectForChannels(channels []string, stage string) []MountedDamageModifier
	// CollectForChannelsWithMatches 收集伤害修正，同时保留使每项入选的频道证据。
	CollectForChannelsWithMatches(channels []string, stage string) []CollectedDamageModifier
	// CollectForCommandChannelsWithMatches 按命令、阶段和频道去重收集，保留稳定顺序及匹配频道证据。
	CollectForCommandChannelsWithMatches(command string, channels []string, stage string) []CollectedDamageModifier
	// CollectForHeal 按方向和分类收集治疗修正，沿用优先级和来源的稳定顺序。
	CollectForHeal(direction, category string) []MountedDamageModifier
	// CollectForStage 收集伤害命令在指定频道和阶段的修正，按优先级、拥有者、供值器及修正键稳定排序。
	CollectForStage(channel, stage string) []MountedDamageModifier
	// HasCommandStage 只读检查是否存在指定命令阶段的挂载，避免提前构造收集容器。
	HasCommandStage(command, stage string) bool
	// MountCompiledModifierOwned 按明确拥有者与供值器挂载已编译修正，保留完整来源身份。
	MountCompiledModifierOwned(ownerCombatantKey, providerRef string, mod planbundle.CompiledModifier)
	// UnmountProviderOwned 卸载指定拥有者与供值器的挂载，不影响其他来源。
	UnmountProviderOwned(ownerCombatantKey, providerRef string)
}

// DamageModifierResolver aggregates pipeline damage modifiers on one combatant.
type DamageModifierResolver struct {
	mounts []MountedDamageModifier
}

// CollectedDamageModifier is a mounted damage modifier plus the channels that selected it.
type CollectedDamageModifier struct {
	Modifier        MountedDamageModifier
	MatchedChannels []string
}

var _ DamageModifierResolverAPI = (*DamageModifierResolver)(nil)

func (r DamageModifierResolver) Clone() DamageModifierResolver {
	return r
}

func (r *DamageModifierResolver) MountCompiledModifierOwned(ownerCombatantKey, providerRef string, mod planbundle.CompiledModifier) {
	if mod.Kind != "pipeline" {
		return
	}
	mounts := make([]MountedDamageModifier, len(r.mounts), len(r.mounts)+1)
	copy(mounts, r.mounts)
	r.mounts = append(mounts, MountedDamageModifier{
		HasMultiplierGroup:       mod.HasMultiplierGroup,
		MultiplierGroupID:        mod.MultiplierGroupID,
		HasMaximumReductionRatio: mod.HasMaximumReductionRatio,
		MaximumReductionRatio:    mod.MaximumReductionRatio,
		OwnerCombatantKey:        ownerCombatantKey,
		ProviderRef:              providerRef,
		ModifierKey:              mod.ModifierKey,
		Command:                  mod.Command,
		Channel:                  mod.Channel,
		Bucket:                   mod.Bucket,
		Stage:                    mod.Stage,
		Priority:                 mod.Priority,
		HealDirection:            mod.HealDirection,
		HealCategory:             mod.HealCategory,
		HealGroupKey:             mod.HealGroupKey,
		HealGroupCalculationMode: mod.HealGroupCalculationMode,
		ValuePolicy:              mod.ValuePolicy,
		ValueProgram:             mod.ValueProgram,
		HasValue:                 mod.HasValue,
		HasCondition:             mod.HasCondition,
		ConditionProg:            mod.ConditionProg,
	})
}

func (r *DamageModifierResolver) UnmountProviderOwned(ownerCombatantKey, providerRef string) {
	if len(r.mounts) == 0 {
		return
	}
	count := 0
	for _, m := range r.mounts {
		if m.ProviderRef == providerRef && m.OwnerCombatantKey == ownerCombatantKey {
			count++
		}
	}
	if count == 0 {
		return
	}
	out := make([]MountedDamageModifier, 0, len(r.mounts)-count)
	for _, m := range r.mounts {
		if m.ProviderRef == providerRef && m.OwnerCombatantKey == ownerCombatantKey {
			continue
		}
		out = append(out, m)
	}
	r.mounts = out
}

func (r DamageModifierResolver) CollectForStage(channel, stage string) []MountedDamageModifier {
	return r.CollectForChannels([]string{channel}, stage)
}

func (r DamageModifierResolver) HasCommandStage(command, stage string) bool {
	for index := range r.mounts {
		mod := &r.mounts[index]
		if mod.Command == command && mod.Stage == stage {
			return true
		}
	}
	return false
}

func (r DamageModifierResolver) CollectForChannels(channels []string, stage string) []MountedDamageModifier {
	collected := r.CollectForCommandChannelsWithMatches("damage", channels, stage)
	out := make([]MountedDamageModifier, len(collected))
	for i, c := range collected {
		out[i] = c.Modifier
	}
	return out
}

func (r DamageModifierResolver) CollectForChannelsWithMatches(channels []string, stage string) []CollectedDamageModifier {
	return r.CollectForCommandChannelsWithMatches("damage", channels, stage)
}

func (r DamageModifierResolver) CollectForCommandChannelsWithMatches(command string, channels []string, stage string) []CollectedDamageModifier {
	if len(channels) == 0 || command == "" {
		return nil
	}
	if len(r.mounts) == 0 {
		return []CollectedDamageModifier{}
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
	if len(out) < 2 {
		return out
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
