// AttributeModifier 聚合 resolver（§14 P0 无条件挂载即生效）。
package pipeline

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/numeric"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// MountedAttributeModifier 是已挂载到 combatant 的属性 modifier。
// OwnerCombatantKey + ProviderRef 标识挂载身份：跨 combatant 时用拥有者 bag 求值，
// 且两侧同名 providerRef 互不碰撞/误卸。
type MountedAttributeModifier struct {
	HasMultiplierGroup bool
	MultiplierGroupID  uint16
	HasSnapshot        bool
	SnapshotValue      float64
	OwnedHealthReads   bool
	OwnerCombatantKey  string
	ProviderRef        string
	ModifierKey        string
	AttributeKey       string
	Bucket             string
	Stage              string
	Priority           int
	ValuePolicy        string
	ValueProgram       formula.GenericProgramID
	HasValue           bool
}

// AttributeResolverAPI 集中声明属性修正的挂载与数值结算；角色数值仍由角色状态保存。
// 声明用于阅读与编译检查；实际调用继续使用具体类型。
type AttributeResolverAPI interface {
	// Clone 共享不可变修正计划；后续挂载与卸载创建新计划。
	Clone() AttributeResolver
	// MountCompiledModifier 按默认拥有者挂载一项已编译修正，沿用现有身份规则。
	MountCompiledModifier(providerRef string, mod planbundle.CompiledModifier)
	// MountCompiledModifierOwned 按明确拥有者与供值器身份挂载修正，双方同名引用互不覆盖。
	MountCompiledModifierOwned(ownerCombatantKey, providerRef string, mod planbundle.CompiledModifier)
	// MountProviderModifiers 从指定拥有者与供值器的编译定义挂载属性修正，不直接发布角色数值。
	MountProviderModifiers(ownerCombatantKey, providerRef string, provider planbundle.CompiledProvider, formulas formula.GenericRegistry)
	// MountSnapshotModifierOwned 挂载已冻结数值的修正，不在后续结算中重新求其施加值。
	MountSnapshotModifierOwned(ownerCombatantKey, providerRef string, mod planbundle.CompiledModifier, value float64)
	// MountedModifiers 借用当前不可变修正计划，只供读取，禁止修改切片内容。
	MountedModifiers() []MountedAttributeModifier
	// ResolveAttributes 使用给定只读上下文结算新属性表，不修改输入表。
	ResolveAttributes(attrs attribute.Table, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry) (attribute.Table, error)
	// ResolveAttributesWithProviderContext 按实际挂载获取供值上下文，返回新属性表；求值或数值错误原样返回。
	ResolveAttributesWithProviderContext(
		attrs attribute.Table,
		evalCtx formula.GenericEvalContext,
		formulas formula.GenericRegistry,
		providerContext ProviderFormulaContextFunc,
	) (attribute.Table, error)
	// ResolveDerivedAttribute 结算指定派生属性槽，保留属性阶段及分组规则，不发布角色状态。
	ResolveDerivedAttribute(attributeKey string, slot model.AttributeSlotDef, value float64, attrs attribute.Table, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext ProviderFormulaContextFunc) (model.AttributeSlotDef, error)
	// SameMounts 核对是否共享同一修正计划；两个空计划视为相同。
	SameMounts(other AttributeResolver) bool
	// UnmountProvider 移除默认拥有者下指定供值器的修正，不修改其他拥有者。
	UnmountProvider(providerRef string)
	// UnmountProviderOwned 移除指定拥有者与供值器的修正，保留其他挂载。
	UnmountProviderOwned(ownerCombatantKey, providerRef string)
}

// AttributeResolver 聚合 combatant 上的 attribute modifier。
type AttributeResolver struct {
	// 这些切片与索引在创建后不再写入，Clone 可以安全共享。
	mounts        []MountedAttributeModifier
	byAttribute   map[string][]MountedAttributeModifier
	attributeKeys []string
}

// ProviderFormulaContext 只携带供值状态覆盖项，避免复制无关的完整公式上下文。
type ProviderFormulaContext struct {
	SkipExpiredAttributeModifier                              bool
	HasProviderElapsed                                        bool
	ProviderElapsedMs                                         int64
	HasProviderContext                                        bool
	ProviderState, ProviderTargetState, ProviderStateDefaults model.NumericView
}

// 来源、目标属性、资源和事件字段始终来自原求值上下文。
type ProviderFormulaContextFunc func(ownerCombatantKey, providerRef string) ProviderFormulaContext

var _ AttributeResolverAPI = (*AttributeResolver)(nil)

func (r AttributeResolver) Clone() AttributeResolver {
	return r
}

func (r AttributeResolver) MountedModifiers() []MountedAttributeModifier {
	return r.mounts
}

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

func (r *AttributeResolver) MountProviderModifiers(ownerCombatantKey, providerRef string, provider planbundle.CompiledProvider, formulas formula.GenericRegistry) {
	for _, mod := range provider.Modifiers {
		r.MountCompiledModifierOwned(ownerCombatantKey, providerRef, mod)
	}
	_ = formulas
}

func (r *AttributeResolver) MountCompiledModifier(providerRef string, mod planbundle.CompiledModifier) {
	r.MountCompiledModifierOwned("", providerRef, mod)
}

func (r *AttributeResolver) MountCompiledModifierOwned(ownerCombatantKey, providerRef string, mod planbundle.CompiledModifier) {
	r.mountCompiledModifierOwned(ownerCombatantKey, providerRef, mod, false, 0)
}

func (r *AttributeResolver) MountSnapshotModifierOwned(ownerCombatantKey, providerRef string, mod planbundle.CompiledModifier, value float64) {
	r.mountCompiledModifierOwned(ownerCombatantKey, providerRef, mod, true, value)
}

func (r *AttributeResolver) mountCompiledModifierOwned(ownerCombatantKey, providerRef string, mod planbundle.CompiledModifier, snapshot bool, value float64) {
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
		HasMultiplierGroup: mod.HasMultiplierGroup,
		MultiplierGroupID:  mod.MultiplierGroupID,
		HasSnapshot:        snapshot, SnapshotValue: value,
		OwnedHealthReads:  mod.OwnedHealthReads,
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

func (r *AttributeResolver) UnmountProvider(providerRef string) {
	r.UnmountProviderOwned("", providerRef)
}

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

func (r AttributeResolver) ResolveAttributes(attrs attribute.Table, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry) (attribute.Table, error) {
	return r.ResolveAttributesWithProviderContext(attrs, evalCtx, formulas, nil)
}

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
		value, err := r.resolveAttributeValue(key, slot.Base, attrs, evalCtx, formulas, providerContext)
		if err != nil {
			return attribute.Table{}, err
		}
		slot.Resolved = value
		out.SetIndex(attrs.Index(key), slot)
	}
	return out.Finish(), nil
}

func (r AttributeResolver) ResolveDerivedAttribute(attributeKey string, slot model.AttributeSlotDef, value float64, attrs attribute.Table, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext ProviderFormulaContextFunc) (model.AttributeSlotDef, error) {
	resolved, err := r.resolveAttributeValue(attributeKey, value, attrs, evalCtx, formulas, providerContext)
	if err != nil {
		return model.AttributeSlotDef{}, err
	}
	slot.Resolved = resolved
	return slot, nil
}

func (r AttributeResolver) resolveAttributeValue(attributeKey string, base float64, attrs attribute.Table, evalCtx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext ProviderFormulaContextFunc) (float64, error) {
	resolved := base
	complementProduct, hasComplement := 1.0, false
	totalProduct := 1.0
	var groups numeric.AmplificationGroups
	hasGroups := false
	var participants []attributeGroupParticipant
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
		if mod.OwnedHealthReads {
			if mod.OwnerCombatantKey == "" {
				return 0, fmt.Errorf("attribute %s modifier %s: missing health formula owner", attributeKey, mod.ModifierKey)
			}
			modCtx.HasAuthoredActorContext = true
			modCtx.AuthoredSourceAttrs = attrs
			modCtx.AuthoredCombatantKey = mod.OwnerCombatantKey
		}
		value, err := mod.SnapshotValue, error(nil)
		if !mod.HasSnapshot {
			value, err = formulas.EvalContext(mod.ValueProgram, &modCtx)
		}
		if err != nil {
			if mod.HasMultiplierGroup {
				return 0, attributeGroupIssue(attributeKey, mod, formulas, err)
			}
			return 0, fmt.Errorf("attribute %s modifier %s: %w", attributeKey, mod.ModifierKey, err)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			if mod.HasMultiplierGroup {
				return 0, attributeGroupIssue(attributeKey, mod, formulas, fmt.Errorf("non-finite grouped multiplier"))
			}
			return 0, fmt.Errorf("attribute %s modifier %s: invalid value: %v", attributeKey, mod.ModifierKey, err)
		}
		if mod.OwnedHealthReads && value < 0 {
			return 0, fmt.Errorf("attribute %s modifier %s: health-derived addition must be nonnegative", attributeKey, mod.ModifierKey)
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
			if mod.HasMultiplierGroup {
				if !hasGroups {
					groups = numeric.NewAmplificationGroups(len(r.byAttribute[attributeKey]))
					participants = make([]attributeGroupParticipant, 0, len(r.byAttribute[attributeKey]))
					hasGroups = true
				}
				if err := groups.Add(mod.MultiplierGroupID, value); err != nil {
					return 0, attributeGroupIssue(attributeKey, mod, formulas, err)
				}
				participants = append(participants, attributeGroupParticipant{member: mod, value: value})
				continue
			}
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
	if hasGroups {
		groupProduct, err := groups.Product()
		if err != nil {
			id, match := uint16(0), false
			if issue, ok := err.(numeric.AmplificationGroupError); ok {
				id, match = issue.ID, true
			}
			return 0, attributeGroupIssue(attributeKey, attributeGroupFailureSource(participants, id, match), formulas, err)
		}
		totalProduct *= groupProduct
		if math.IsNaN(totalProduct) || math.IsInf(totalProduct, 0) {
			return 0, attributeGroupIssue(attributeKey, attributeGroupFailureSource(participants, 0, false), formulas, fmt.Errorf("non-finite grouped total multiplier"))
		}
	}
	resolved *= totalProduct
	if math.IsNaN(resolved) || math.IsInf(resolved, 0) {
		if hasGroups {
			return 0, attributeGroupIssue(attributeKey, attributeGroupFailureSource(participants, 0, false), formulas, fmt.Errorf("non-finite grouped total value"))
		}
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
