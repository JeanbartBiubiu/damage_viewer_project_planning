// AttributeModifier 聚合 resolver（§14 P0 无条件挂载即生效）。
package pipeline

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
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
	// 这些切片与索引在创建后不再写入，Clone 可以安全共享。
	mounts        []MountedAttributeModifier
	byAttribute   map[string][]MountedAttributeModifier
	attributeKeys []string
}

// Clone 共享不可变修正计划；挂载与卸载始终创建新计划。
func (r AttributeResolver) Clone() AttributeResolver {
	return r
}

// MountedModifiers 返回当前不可变修正计划，只供调用方读取，禁止修改其内容。
func (r AttributeResolver) MountedModifiers() []MountedAttributeModifier {
	return r.mounts
}

// SameMounts 核对是否共享同一修正计划；两个空计划视为相同。
func (r AttributeResolver) SameMounts(other AttributeResolver) bool {
	if len(r.mounts) != len(other.mounts) {
		return false
	}
	return len(r.mounts) == 0 || &r.mounts[0] == &other.mounts[0]
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
func (r *AttributeResolver) MountProviderModifiers(ownerCombatantKey, providerRef string, provider planbundle.CompiledProvider, formulas formula.GenericRegistry) {
	for _, mod := range provider.Modifiers {
		r.MountCompiledModifierOwned(ownerCombatantKey, providerRef, mod)
	}
	_ = formulas
}

// MountCompiledModifier 挂载单个已编译 attribute modifier（owner 空，兼容 rules / 旧调用）。
func (r *AttributeResolver) MountCompiledModifier(providerRef string, mod planbundle.CompiledModifier) {
	r.MountCompiledModifierOwned("", providerRef, mod)
}

// MountCompiledModifierOwned 挂载单个 modifier，并记录 owner combatant provenance。
func (r *AttributeResolver) MountCompiledModifierOwned(ownerCombatantKey, providerRef string, mod planbundle.CompiledModifier) {
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
	mount := MountedAttributeModifier{
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
	}
	// 相同排序键插在已有条目之后，保留原挂载顺序。
	index := sort.Search(len(r.mounts), func(i int) bool {
		return mountedAttributeModifierLess(mount, r.mounts[i])
	})
	mounts := make([]MountedAttributeModifier, len(r.mounts)+1)
	copy(mounts, r.mounts[:index])
	mounts[index] = mount
	copy(mounts[index+1:], r.mounts[index:])
	r.setMounts(mounts)
}

// UnmountProvider 移除 ProviderRef 匹配且 OwnerCombatantKey 为空的 mount（rules / 旧同侧路径）。
func (r *AttributeResolver) UnmountProvider(providerRef string) {
	r.UnmountProviderOwned("", providerRef)
}

// UnmountProviderOwned 按 ownerCombatantKey + providerRef 移除 mount。
// ownerCombatantKey 为空时仅移除同样 owner 为空的条目，避免卸掉对侧同名 providerRef。
func (r *AttributeResolver) UnmountProviderOwned(ownerCombatantKey, providerRef string) {
	remaining := 0
	for _, m := range r.mounts {
		if m.ProviderRef != providerRef || m.OwnerCombatantKey != ownerCombatantKey {
			remaining++
		}
	}
	if remaining == len(r.mounts) {
		return
	}
	out := make([]MountedAttributeModifier, 0, remaining)
	for _, m := range r.mounts {
		if m.ProviderRef == providerRef && m.OwnerCombatantKey == ownerCombatantKey {
			continue
		}
		out = append(out, m)
	}
	r.setMounts(out)
}

func mountedAttributeModifierLess(a, b MountedAttributeModifier) bool {
	if a.AttributeKey != b.AttributeKey {
		return a.AttributeKey < b.AttributeKey
	}
	if a.Bucket != b.Bucket {
		return a.Bucket < b.Bucket
	}
	if a.Stage != b.Stage {
		return a.Stage < b.Stage
	}
	if a.Priority != b.Priority {
		return a.Priority < b.Priority
	}
	if a.ModifierKey != b.ModifierKey {
		return a.ModifierKey < b.ModifierKey
	}
	if a.OwnerCombatantKey != b.OwnerCombatantKey {
		return a.OwnerCombatantKey < b.OwnerCombatantKey
	}
	return a.ProviderRef < b.ProviderRef
}

// setMounts 只接受新建且已排序的切片；索引只在挂载列表变化时重建。
func (r *AttributeResolver) setMounts(mounts []MountedAttributeModifier) {
	r.mounts = mounts
	r.byAttribute = nil
	r.attributeKeys = nil
	if len(mounts) == 0 {
		return
	}
	r.byAttribute = make(map[string][]MountedAttributeModifier)
	for start := 0; start < len(mounts); {
		key := mounts[start].AttributeKey
		end := start + 1
		for end < len(mounts) && mounts[end].AttributeKey == key {
			end++
		}
		r.byAttribute[key] = mounts[start:end:end]
		r.attributeKeys = append(r.attributeKeys, key)
		start = end
	}
}

// ProviderFormulaContext 只携带供值状态覆盖项，避免复制无关的完整公式上下文。
type ProviderFormulaContext struct {
	SkipExpiredAttributeModifier                              bool
	HasProviderElapsed                                        bool
	ProviderElapsedMs                                         int64
	HasProviderContext                                        bool
	ProviderState, ProviderTargetState, ProviderStateDefaults map[string]float64
}

// 来源、目标属性、资源和事件字段始终来自原求值上下文。
type ProviderFormulaContextFunc func(ownerCombatantKey, providerRef string) ProviderFormulaContext

// ResolveAttributes 按 bucket/stage/priority 聚合 modifier，写回 resolved。
// 等价于 ResolveAttributesWithProviderContext(..., nil)。
func (r AttributeResolver) ResolveAttributes(attrs attribute.Table, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry) (attribute.Table, error) {
	return r.ResolveAttributesWithProviderContext(attrs, evalCtx, formulas, nil)
}

// ResolveAttributesWithProviderContext 与 ResolveAttributes 相同，但可按 modifier 的
// OwnerCombatantKey + ProviderRef 注入逐 provider 的 formula context。
// providerContext 为 nil 时行为与 ResolveAttributes 一致。
func (r AttributeResolver) ResolveAttributesWithProviderContext(
	attrs attribute.Table,
	evalCtx formula.GenericEvalContext,
	formulas formula.GenericRegistry,
	providerContext ProviderFormulaContextFunc,
) (attribute.Table, error) {
	out := attrs.Edit()
	attrs.Range(func(key string, slot model.AttributeSlotDef) bool {
		// 有修正的槽在下方按既有顺序计算最终值，不先写入临时Base值。
		if len(r.byAttribute[key]) != 0 {
			return true
		}
		slot.Resolved = slot.Base
		out.SetIndex(attrs.Index(key), slot)
		return true
	})
	for _, key := range r.attributeKeys {
		slot, exists := attrs.Lookup(key)
		if !exists {
			continue
		}
		value, err := r.resolveAttributeValue(key, slot.Base, evalCtx, formulas, providerContext)
		if err != nil {
			return attribute.Table{}, err
		}
		slot.Resolved = value
		out.SetIndex(attrs.Index(key), slot)
	}
	return out.Finish(), nil
}

func (r AttributeResolver) ResolveDerivedAttribute(attributeKey string, slot model.AttributeSlotDef, value float64, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext ProviderFormulaContextFunc) (model.AttributeSlotDef, error) {
	resolved, err := r.resolveAttributeValue(attributeKey, value, evalCtx, formulas, providerContext)
	if err != nil {
		return model.AttributeSlotDef{}, err
	}
	slot.Resolved = resolved
	return slot, nil
}

func (r AttributeResolver) resolveAttributeValue(attributeKey string, base float64, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext ProviderFormulaContextFunc) (float64, error) {
	resolved := base
	complementProduct, hasComplement := 1.0, false
	totalProduct := 1.0
	for _, mod := range r.byAttribute[attributeKey] {
		if !mod.HasValue {
			continue
		}
		modCtx := evalCtx
		if providerContext != nil {
			pctx := providerContext(mod.OwnerCombatantKey, mod.ProviderRef)
			if pctx.SkipExpiredAttributeModifier {
				continue
			}
			modCtx.HasProviderContext = pctx.HasProviderContext
			modCtx.ProviderState = pctx.ProviderState
			modCtx.ProviderTargetState = pctx.ProviderTargetState
			modCtx.ProviderStateDefaults = pctx.ProviderStateDefaults
			modCtx.HasProviderElapsed = pctx.HasProviderElapsed
			modCtx.ProviderElapsedMs = pctx.ProviderElapsedMs
		}
		value, err := formulas.EvalContext(mod.ValueProgram, &modCtx)
		if err != nil {
			return 0, fmt.Errorf("attribute %s modifier %s: %w", attributeKey, mod.ModifierKey, err)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, fmt.Errorf("attribute %s modifier %s: invalid value: %v", attributeKey, mod.ModifierKey, err)
		}
		if mod.ValuePolicy == "complement_multiply" {
			if value < 0 || value > 1 {
				return 0, fmt.Errorf("attribute %s modifier %s: complement ratio must be in [0,1]", attributeKey, mod.ModifierKey)
			}
			complementProduct *= 1 - value
			hasComplement = true
			continue
		}
		if mod.ValuePolicy == "multiply" && mod.Stage == "total" {
			totalProduct *= value
			if math.IsNaN(totalProduct) || math.IsInf(totalProduct, 0) {
				return 0, fmt.Errorf("attribute %s modifier %s: non-finite total multiplier", attributeKey, mod.ModifierKey)
			}
			continue
		}
		resolved = applyValuePolicy(resolved, base, mod.ValuePolicy, value)
		if math.IsNaN(resolved) || math.IsInf(resolved, 0) {
			return 0, fmt.Errorf("attribute %s modifier %s: non-finite resolved value", attributeKey, mod.ModifierKey)
		}
	}
	resolved *= totalProduct
	if math.IsNaN(resolved) || math.IsInf(resolved, 0) {
		return 0, fmt.Errorf("attribute %s: non-finite total value", attributeKey)
	}
	if hasComplement {
		if math.IsNaN(resolved) || math.IsInf(resolved, 0) || resolved < 0 || resolved > 1 {
			return 0, fmt.Errorf("attribute %s: complement input must be in [0,1]", attributeKey)
		}
		resolved = 1 - (1-resolved)*complementProduct
	}
	return resolved, nil
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
