package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

const multiplierGroupCapacity = uint32(1 << 16)

// 字符串只在编译期使用；先检查容量再转换，编号0与无组由独立布尔值区分。
func (ctx *genericCompileContext) internMultiplierGroup(key, path, ref string) (uint16, bool) {
	if id, exists := ctx.multiplierGroups[key]; exists {
		return id, true
	}
	if ctx.session.MultiplierGroupCount >= multiplierGroupCapacity {
		ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, path, "multiplier group count exceeds supported index range", ref)
		return 0, false
	}
	if ctx.multiplierGroups == nil {
		ctx.multiplierGroups = make(map[string]uint16)
	}
	id := uint16(ctx.session.MultiplierGroupCount)
	ctx.multiplierGroups[key] = id
	ctx.session.MultiplierGroupCount++
	return id, true
}

func validMultiplierGroupKey(key string) bool {
	if len(key) == 0 || len(key) > 64 || key[0] < 'a' || key[0] > 'z' {
		return false
	}
	for i := 1; i < len(key); i++ {
		b := key[i]
		if b != '_' && (b < 'a' || b > 'z') && (b < '0' || b > '9') {
			return false
		}
	}
	return true
}

func compileMultiplierGroup(raw model.ModifierDefinition, mod *plan.CompiledModifier, path string, ctx *genericCompileContext) {
	if raw.MultiplierGroupKey == nil {
		return
	}
	fail := func(field, message string) {
		ctx.collector.addError(model.GenericErrUnknownRef, path+field, message, mod.ModifierKey)
	}
	if !validMultiplierGroupKey(*raw.MultiplierGroupKey) {
		fail(".multiplierGroupKey", "multiplier group key must match ^[a-z][a-z0-9_]{0,63}$")
		return
	}
	attribute := mod.Kind == "attribute" && mod.Stage == "total" && mod.ValuePolicy == "multiply"
	damage := mod.Kind == "pipeline" && mod.Command == "damage" && (mod.Stage == "outgoing_pre_mitigation" || mod.Stage == "incoming_post_mitigation") && mod.ValuePolicy == "multiply"
	if !attribute && !damage {
		fail(".multiplierGroupKey", "multiplier groups require attribute/total/multiply or damage amplification multiply")
		return
	}
	if mod.ValueReadMode != "" || mod.CurrentValuePolicy != "" || mod.HasAffectedAbilityRefs || mod.HasMaximumReductionRatio || mod.HealDirection != "" || mod.HealCategory != "" || mod.HealGroupKey != "" || mod.HealGroupCalculationMode != "" {
		fail(".multiplierGroupKey", "multiplier groups cannot enter snapshot, resource, cooldown, capped reduction or healing mechanisms")
		return
	}
	if attribute && (raw.Condition != nil || multiplierAttributeKey(mod.Target) == "" || mod.Command != "" || mod.Channel != "") {
		fail(".multiplierGroupKey", "attribute multiplier groups require an explicit attribute target without condition or pipeline fields")
		return
	}
	if damage && mod.Target != "" {
		fail(".target", "damage multiplier group uses its actual provider carrier or rule stage, not an attribute target")
		return
	}
	if mod.HasValue && len(ctx.session.Formulas.ReadDependencies(mod.ValueProgram)) == 0 {
		value, err := ctx.session.Formulas.Eval(mod.ValueProgram, formula.GenericEvalContext{})
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 1 {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path+".value", "static grouped multiplier must be finite and >=1", mod.ModifierKey)
		}
	}
	mod.MultiplierGroupID, mod.HasMultiplierGroup = ctx.internMultiplierGroup(*raw.MultiplierGroupKey, path+".multiplierGroupKey", mod.ModifierKey)
}

const (
	multiplierCarrierSource = uint8(1)
	multiplierCarrierTarget = uint8(2)
	multiplierCarrierBoth   = multiplierCarrierSource | multiplierCarrierTarget
)

type multiplierMember struct {
	modifier plan.CompiledModifier
	path     string
	carriers uint8
}

// 恢复快照与动态挂载可把普通供值器放到任意角色，编译初始挂载不构成互斥证明。
// 只有绝对属性目标和规则的固定阶段能证明单角色；不新增挂载白名单。
func multiplierCarriers(mod plan.CompiledModifier, rule bool) uint8 {
	if mod.Kind == "pipeline" {
		if rule {
			if mod.Stage == "outgoing_pre_mitigation" {
				return multiplierCarrierSource
			}
			if mod.Stage == "incoming_post_mitigation" {
				return multiplierCarrierTarget
			}
		}
		return multiplierCarrierBoth
	}
	target := strings.TrimSpace(mod.Target)
	if strings.HasPrefix(target, "source.attr.") {
		return multiplierCarrierSource
	}
	if strings.HasPrefix(target, "target.attr.") {
		return multiplierCarrierTarget
	}
	if rule {
		if strings.HasPrefix(target, "self.attr.") {
			return multiplierCarrierSource
		}
		if strings.HasPrefix(target, "opponent.attr.") {
			return multiplierCarrierTarget
		}
	}
	return multiplierCarrierBoth
}

func multiplierAttributeKey(target string) string {
	target = strings.TrimSpace(target)
	for _, prefix := range []string{"source.attr.", "target.attr.", "self.attr.", "opponent.attr."} {
		if key, found := strings.CutPrefix(target, prefix); found {
			return key
		}
	}
	if index := strings.LastIndex(target, ".attr."); index >= 0 {
		return target[index+len(".attr."):]
	}
	return target
}

func explicitRuleMultiplierAttributeTarget(target string) bool {
	target = strings.TrimSpace(target)
	for _, prefix := range []string{"source.attr.", "target.attr.", "self.attr.", "opponent.attr."} {
		if key, found := strings.CutPrefix(target, prefix); found {
			return key != ""
		}
	}
	return false
}

func sameMultiplierSettlement(a, b plan.CompiledModifier) bool {
	if a.Kind != b.Kind || a.Stage != b.Stage || a.Command != b.Command {
		return false
	}
	if a.Kind == "attribute" {
		return multiplierAttributeKey(a.Target) == multiplierAttributeKey(b.Target)
	}
	return a.Kind == "pipeline" && a.Command == "damage"
}

func multiplierReadsAmount(mod plan.CompiledModifier, ctx *genericCompileContext) (string, bool) {
	for _, item := range []struct {
		id      formula.GenericProgramID
		present bool
		field   string
	}{{mod.ValueProgram, mod.HasValue, ".value"}, {mod.ConditionProg, mod.HasCondition, ".condition"}} {
		if !item.present {
			continue
		}
		for _, read := range ctx.session.Formulas.ReadDependencies(item.id) {
			if read.ReadKind == formula.ReadDamageAmount {
				return item.field, true
			}
		}
	}
	return "", false
}

// Priority本身就是运行时连续段的确定身份；校验后无需另存无人消费的段编号。
func finalizeMultiplierGroups(ctx *genericCompileContext) {
	if ctx.session.MultiplierGroupCount == 0 {
		return
	}
	var members []multiplierMember
	for pi, provider := range ctx.session.Providers {
		for mi, mod := range provider.Modifiers {
			members = append(members, multiplierMember{mod, "sharedProviders[" + itoa(pi) + "].modifiers[" + itoa(mi) + "]", multiplierCarriers(mod, false)})
		}
	}
	for mi, mod := range ctx.session.RuleModifiers {
		path := "rules.modifiers[" + itoa(mi) + "]"
		if mod.HasMultiplierGroup && mod.Kind == "attribute" && !explicitRuleMultiplierAttributeTarget(mod.Target) {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".target", "grouped rule attributes require an explicit source, target, self or opponent attribute path", mod.ModifierKey)
		}
		members = append(members, multiplierMember{mod, path, multiplierCarriers(mod, true)})
	}
	for index, current := range members {
		mod := current.modifier
		if !mod.HasMultiplierGroup {
			continue
		}
		for otherIndex, other := range members {
			if index == otherIndex || current.carriers&other.carriers == 0 || !sameMultiplierSettlement(mod, other.modifier) {
				continue
			}
			next := other.modifier
			if mod.Kind == "pipeline" && next.HasMultiplierGroup && mod.MultiplierGroupID == next.MultiplierGroupID && (mod.Priority != next.Priority || mod.Channel != next.Channel || mod.Bucket != next.Bucket) {
				ctx.collector.addError(model.GenericErrUnknownRef, other.path+".multiplierGroupKey", "possibly coexisting damage group members require identical priority, channel and bucket; provider initial mounts do not prove carrier isolation", next.ModifierKey)
			}
		}
		if mod.Kind != "pipeline" {
			continue
		}
		for _, other := range members {
			if current.carriers&other.carriers == 0 || !sameMultiplierSettlement(mod, other.modifier) || mod.Priority != other.modifier.Priority {
				continue
			}
			if other.modifier.ValuePolicy != "multiply" {
				ctx.collector.addError(model.GenericErrUnknownRef, other.path+".valuePolicy", "a possibly coexisting grouped damage priority band permits multiply only", other.modifier.ModifierKey)
			}
			if field, reads := multiplierReadsAmount(other.modifier, ctx); reads {
				ctx.collector.addError(model.GenericErrUnknownRef, other.path+field, "a possibly coexisting grouped damage priority band cannot read damage.amount in any value or condition dependency", other.modifier.ModifierKey)
			}
		}
	}
	validateStaticMultiplierGroups(members, ctx)
}

func validateStaticMultiplierGroups(members []multiplierMember, ctx *genericCompileContext) {
	for index, member := range members {
		mod := member.modifier
		if !mod.HasMultiplierGroup || staticMultiplierConditionFalse(mod, ctx) {
			continue
		}
		for _, carrier := range []uint8{multiplierCarrierSource, multiplierCarrierTarget} {
			if member.carriers&carrier == 0 {
				continue
			}
			seenSettlement := false
			for _, previous := range members[:index] {
				if previous.modifier.HasMultiplierGroup && !staticMultiplierConditionFalse(previous.modifier, ctx) && previous.carriers&carrier != 0 && sameMultiplierSettlement(mod, previous.modifier) && (mod.Kind == "attribute" || mod.Priority == previous.modifier.Priority) {
					seenSettlement = true
					break
				}
			}
			if seenSettlement {
				continue
			}
			type staticFactor struct {
				id     uint16
				factor float64
				member multiplierMember
			}
			var groups []staticFactor
			for _, item := range members {
				m := item.modifier
				if !m.HasMultiplierGroup || item.carriers&carrier == 0 || !sameMultiplierSettlement(mod, m) || mod.Kind == "pipeline" && mod.Priority != m.Priority || !m.HasValue || staticMultiplierConditionFalse(m, ctx) {
					continue
				}
				value, static := ctx.session.Formulas.FoldStatic(m.ValueProgram)
				if !static || math.IsNaN(value) || math.IsInf(value, 0) || value < 1 {
					continue
				}
				found := false
				for i := range groups {
					if groups[i].id != m.MultiplierGroupID {
						continue
					}
					groups[i].factor += value - 1
					groups[i].member = item
					found = true
					break
				}
				if !found {
					groups = append(groups, staticFactor{m.MultiplierGroupID, value, item})
				}
			}
			product := 1.0
			for _, group := range groups {
				product *= group.factor
				if math.IsNaN(group.factor) || math.IsInf(group.factor, 0) || math.IsNaN(product) || math.IsInf(product, 0) {
					ctx.collector.addError(model.GenericErrFormulaTypeError, group.member.path+".value", "static amplification group sum or inter-group product overflows for a possible carrier", group.member.modifier.ModifierKey)
					break
				}
			}
			if !math.IsNaN(product) && !math.IsInf(product, 0) {
				if failed, overflow := staticIndependentAmplificationOverflow(mod, carrier, product, members, ctx); overflow {
					ctx.collector.addError(model.GenericErrFormulaTypeError, failed.path+".value", "static independent multipliers and amplification group product overflow for a possible carrier", failed.modifier.ModifierKey)
				}
			}
		}
	}
}

// 仅供静态溢出共存分析使用；成员形状与整条优先级带的依赖校验不受条件影响。
// FoldStatic要求完整读取依赖为空，动态条件不能借当前运行值被误判为假。
func staticMultiplierConditionFalse(mod plan.CompiledModifier, ctx *genericCompileContext) bool {
	if !mod.HasCondition {
		return false
	}
	value, static := ctx.session.Formulas.FoldStatic(mod.ConditionProg)
	return static && value == 0
}

// 仅证明不会缩小或抵消的独立乘积。遇到减幅、零、负数、条件或动态项，
// 保留原有运行顺序的有限性/负值/下溢检查，不另建归一化的数值语义。
func staticIndependentAmplificationOverflow(mod plan.CompiledModifier, carrier uint8, groupProduct float64, members []multiplierMember, ctx *genericCompileContext) (multiplierMember, bool) {
	product := groupProduct
	var failed multiplierMember
	for _, item := range members {
		m := item.modifier
		if m.HasMultiplierGroup || item.carriers&carrier == 0 || !sameMultiplierSettlement(mod, m) || m.ValuePolicy != "multiply" || mod.Kind == "pipeline" && mod.Priority != m.Priority {
			continue
		}
		if staticMultiplierConditionFalse(m, ctx) {
			continue
		}
		if !m.HasValue || m.HasCondition {
			return multiplierMember{}, false
		}
		value, static := ctx.session.Formulas.FoldStatic(m.ValueProgram)
		if !static || math.IsNaN(value) || math.IsInf(value, 0) || value < 1 {
			return multiplierMember{}, false
		}
		product *= value
		if failed.path == "" && math.IsInf(product, 0) {
			failed = item
		}
	}
	return failed, failed.path != ""
}
