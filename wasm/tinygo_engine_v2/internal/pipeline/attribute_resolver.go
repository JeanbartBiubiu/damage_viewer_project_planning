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
// OwnerCombatantKey + ProviderRef 标识挂载身份：跨 combatant 时用拥有者 bag 求值，
// 且两侧同名 providerRef 互不碰撞/误卸。
type MountedAttributeModifier struct {
	OwnerCombatantKey string
	ProviderRef       string
	ModifierKey       string
	AttributeKey      string
	Bucket            string
	Stage             string
	Priority          int
	ValuePolicy       string
	ValueProgram      formula.GenericProgramID
	HasValue          bool
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

// MountProviderModifiers 挂载 provider 的 attribute modifier（kind=attribute）到本 resolver。
// ownerCombatantKey 写入每条 mount 的 provenance；同 combatant 挂载时通常等于宿主 key。
func (r *AttributeResolver) MountProviderModifiers(ownerCombatantKey, providerRef string, provider compilebundle.CompiledProvider, formulas formula.GenericRegistry) {
	for _, mod := range provider.Modifiers {
		r.MountCompiledModifierOwned(ownerCombatantKey, providerRef, mod)
	}
	_ = formulas
}

// MountCompiledModifier 挂载单个已编译 attribute modifier（owner 空，兼容 rules / 旧调用）。
func (r *AttributeResolver) MountCompiledModifier(providerRef string, mod compilebundle.CompiledModifier) {
	r.MountCompiledModifierOwned("", providerRef, mod)
}

// MountCompiledModifierOwned 挂载单个 modifier，并记录 owner combatant provenance。
func (r *AttributeResolver) MountCompiledModifierOwned(ownerCombatantKey, providerRef string, mod compilebundle.CompiledModifier) {
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
		OwnerCombatantKey: ownerCombatantKey,
		ProviderRef:       providerRef,
		ModifierKey:       mod.ModifierKey,
		AttributeKey:      attrKey,
		Bucket:            mod.Bucket,
		Stage:             mod.Stage,
		Priority:          mod.Priority,
		ValuePolicy:       mod.ValuePolicy,
		ValueProgram:      mod.ValueProgram,
		HasValue:          mod.HasValue,
	})
}

// UnmountProvider 移除 ProviderRef 匹配且 OwnerCombatantKey 为空的 mount（rules / 旧同侧路径）。
func (r *AttributeResolver) UnmountProvider(providerRef string) {
	r.UnmountProviderOwned("", providerRef)
}

// UnmountProviderOwned 按 ownerCombatantKey + providerRef 移除 mount。
// ownerCombatantKey 为空时仅移除同样 owner 为空的条目，避免卸掉对侧同名 providerRef。
func (r *AttributeResolver) UnmountProviderOwned(ownerCombatantKey, providerRef string) {
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

// ProviderFormulaContextFunc 按 owner + providerRef 返回该 modifier 求值用的 provider formula context。
// 仅 HasProviderContext / ProviderState / ProviderTargetState 会覆盖到 base evalCtx；
// source/target attrs/resources、ability、event 字段始终来自 base。
type ProviderFormulaContextFunc func(ownerCombatantKey, providerRef string) formula.GenericEvalContext

// ResolveAttributes 按 bucket/stage/priority 聚合 modifier，写回 resolved。
// 等价于 ResolveAttributesWithProviderContext(..., nil)。
func (r AttributeResolver) ResolveAttributes(attrs map[string]model.AttributeSlotDef, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry) map[string]model.AttributeSlotDef {
	return r.ResolveAttributesWithProviderContext(attrs, evalCtx, formulas, nil)
}

// ResolveAttributesWithProviderContext 与 ResolveAttributes 相同，但可按 modifier 的
// OwnerCombatantKey + ProviderRef 注入逐 provider 的 formula context。
// providerContext 为 nil 时行为与 ResolveAttributes 一致。
func (r AttributeResolver) ResolveAttributesWithProviderContext(
	attrs map[string]model.AttributeSlotDef,
	evalCtx formula.GenericEvalContext,
	formulas formula.GenericRegistry,
	providerContext ProviderFormulaContextFunc,
) map[string]model.AttributeSlotDef {
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
			// Historical order: bucket, stage, priority, modifierKey.
			// OwnerCombatantKey / ProviderRef may only break ties after ModifierKey.
			if sorted[i].ModifierKey != sorted[j].ModifierKey {
				return sorted[i].ModifierKey < sorted[j].ModifierKey
			}
			if sorted[i].OwnerCombatantKey != sorted[j].OwnerCombatantKey {
				return sorted[i].OwnerCombatantKey < sorted[j].OwnerCombatantKey
			}
			if sorted[i].ProviderRef != sorted[j].ProviderRef {
				return sorted[i].ProviderRef < sorted[j].ProviderRef
			}
			return false
		})
		for _, mod := range sorted {
			if !mod.HasValue {
				continue
			}
			modCtx := evalCtx
			if providerContext != nil {
				pctx := providerContext(mod.OwnerCombatantKey, mod.ProviderRef)
				modCtx.HasProviderContext = pctx.HasProviderContext
				modCtx.ProviderState = pctx.ProviderState
				modCtx.ProviderTargetState = pctx.ProviderTargetState
			}
			value, err := formulas.Eval(mod.ValueProgram, modCtx)
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
