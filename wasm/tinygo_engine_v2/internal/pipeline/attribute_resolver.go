// AttributeModifier 聚合 resolver（§14 P0 无条件挂载即生效）。
package pipeline

import (
	"math"
	"sort"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// MountedAttributeModifier 是已挂载到 combatant 的属性 modifier。
type MountedAttributeModifier struct {
	ProviderRef  string
	ModifierKey  string
	AttributeKey string
	Bucket       string
	Stage        string
	Priority     int
	ValuePolicy  string
	ValueProgram formula.GenericProgramID
	HasValue     bool
}

// AttributeResolver 聚合 combatant 上的 attribute modifier。
type AttributeResolver struct {
	mounts []MountedAttributeModifier
}

// Clone 深拷贝 resolver 状态。
func (r AttributeResolver) Clone() AttributeResolver {
	out := AttributeResolver{mounts: make([]MountedAttributeModifier, len(r.mounts))}
	copy(out.mounts, r.mounts)
	return out
}

// AttributeKeyFromModifierTarget 从 modifier target path 提取属性 key。
// 支持裸 key（attack_damage）与 canonical path（source.attr.attack_damage / target.attr.x）。
func AttributeKeyFromModifierTarget(target string) string {
	target = strings.TrimSpace(target)
	if target == "" {
		return ""
	}
	if key, ok := strings.CutPrefix(target, "source.attr."); ok {
		return key
	}
	if key, ok := strings.CutPrefix(target, "target.attr."); ok {
		return key
	}
	if key, ok := strings.CutPrefix(target, "self.attr."); ok {
		return key
	}
	if key, ok := strings.CutPrefix(target, "opponent.attr."); ok {
		return key
	}
	if idx := strings.LastIndex(target, ".attr."); idx >= 0 {
		return target[idx+len(".attr."):]
	}
	return target
}

// ModifierTargetCombatantSelector 从 canonical modifier target 解析 combatant selector。
// 裸属性 key 返回空字符串（由调用方决定挂载对象）。
func ModifierTargetCombatantSelector(target string) string {
	target = strings.TrimSpace(target)
	switch {
	case strings.HasPrefix(target, "source.attr."):
		return model.SelectorSource
	case strings.HasPrefix(target, "target.attr."):
		return model.SelectorTarget
	case strings.HasPrefix(target, "self.attr."):
		return model.SelectorSelf
	case strings.HasPrefix(target, "opponent.attr."):
		return model.SelectorOpponent
	default:
		return ""
	}
}

// MountProviderModifiers 挂载 provider 的 attribute modifier（kind=attribute）。
func (r *AttributeResolver) MountProviderModifiers(providerRef string, provider compilebundle.CompiledProvider, formulas formula.GenericRegistry) {
	for _, mod := range provider.Modifiers {
		r.MountCompiledModifier(providerRef, mod)
	}
	_ = formulas
}

// MountCompiledModifier 挂载单个已编译 attribute modifier。
func (r *AttributeResolver) MountCompiledModifier(providerRef string, mod compilebundle.CompiledModifier) {
	if mod.Kind != "attribute" && mod.Kind != "" {
		return
	}
	if mod.HasCondition {
		return
	}
	attrKey := AttributeKeyFromModifierTarget(mod.Target)
	if attrKey == "" {
		attrKey = mod.Channel
	}
	if attrKey == "" {
		return
	}
	r.mounts = append(r.mounts, MountedAttributeModifier{
		ProviderRef:  providerRef,
		ModifierKey:  mod.ModifierKey,
		AttributeKey: attrKey,
		Bucket:       mod.Bucket,
		Stage:        mod.Stage,
		Priority:     mod.Priority,
		ValuePolicy:  mod.ValuePolicy,
		ValueProgram: mod.ValueProgram,
		HasValue:     mod.HasValue,
	})
}

// UnmountProvider 移除指定 provider 的全部 modifier。
func (r *AttributeResolver) UnmountProvider(providerRef string) {
	if len(r.mounts) == 0 {
		return
	}
	out := r.mounts[:0]
	for _, m := range r.mounts {
		if m.ProviderRef != providerRef {
			out = append(out, m)
		}
	}
	r.mounts = out
}

// ResolveAttributes 按 bucket/stage/priority 聚合 modifier，写回 resolved。
func (r AttributeResolver) ResolveAttributes(attrs map[string]model.AttributeSlotDef, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry) map[string]model.AttributeSlotDef {
	if attrs == nil {
		return attrs
	}
	byAttr := map[string][]MountedAttributeModifier{}
	for _, m := range r.mounts {
		byAttr[m.AttributeKey] = append(byAttr[m.AttributeKey], m)
	}
	out := make(map[string]model.AttributeSlotDef, len(attrs))
	for k, v := range attrs {
		out[k] = v
	}
	for attrKey, slot := range out {
		mods := byAttr[attrKey]
		base := slot.Base
		if base == 0 {
			base = slot.Current
		}
		if len(mods) == 0 {
			slot.Resolved = base
			out[attrKey] = slot
			continue
		}
		resolved := base
		sorted := append([]MountedAttributeModifier(nil), mods...)
		sort.SliceStable(sorted, func(i, j int) bool {
			if sorted[i].Bucket != sorted[j].Bucket {
				return sorted[i].Bucket < sorted[j].Bucket
			}
			if sorted[i].Stage != sorted[j].Stage {
				return sorted[i].Stage < sorted[j].Stage
			}
			if sorted[i].Priority != sorted[j].Priority {
				return sorted[i].Priority < sorted[j].Priority
			}
			return sorted[i].ModifierKey < sorted[j].ModifierKey
		})
		for _, mod := range sorted {
			if !mod.HasValue {
				continue
			}
			value, err := formulas.Eval(mod.ValueProgram, evalCtx)
			if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
				continue
			}
			resolved = applyValuePolicy(resolved, base, mod.ValuePolicy, value)
		}
		slot.Resolved = resolved
		out[attrKey] = slot
	}
	return out
}

func applyValuePolicy(current, base float64, policy string, value float64) float64 {
	switch policy {
	case "add", "":
		return current + value
	case "multiply":
		return current * value
	case "percent_add":
		return current + base*value
	case "min":
		return math.Min(current, value)
	case "max":
		return math.Max(current, value)
	case "clamp":
		return math.Min(math.Max(current, value), value)
	default:
		return current + value
	}
}
