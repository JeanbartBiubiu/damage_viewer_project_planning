package admission

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

type settledEventHealTerm struct {
	factor  float64
	damage  bool
	clamped bool
}

// OwnedSettledEventHeal 只在初始化时核对自身已结算伤害治疗的完整结构。
// 当前没有事件，不求值虚构事件，也不冻结执行时的金额；编译绑定和公式均只读借用。
func OwnedSettledEventHeal(input Input, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	damage, hasDamage := input.Compiled.RuntimeTypes.DamageInstance.Lookup()
	owner, hasOwner := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	if !hasDamage || !hasOwner || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(owner) ||
		listener.OperationCount != 1 || listener.HasOncePerUse || operation.HasCondition ||
		listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(input.Compiled.Abilities) {
		return false
	}
	ability := input.Compiled.Abilities[listener.SourceAbilityIndex]
	provider := input.Compiled.Providers[operation.OwnerProviderIndex]
	if ability.Kind != "passive_listener" || int(ability.ProviderIndex) != operation.OwnerProviderIndex ||
		listener.SourceAbilityIndex < int(provider.AbilityStart) || listener.SourceAbilityIndex >= int(provider.AbilityStart)+int(provider.AbilityCount) ||
		provider.Lifecycle != nil || provider.StableID == "" || (provider.Kind != "character" && provider.Kind != "build" && provider.Kind != "item") {
		return false
	}
	spent := 0
	term, valid := settledEventHealFormulaTerm(input.Formulas, operation.AmountProgram, ability.Params, 1, &spent)
	return valid && term.damage && finiteNonnegativeEventHealFactor(term.factor)
}

func finiteNonnegativeEventHealFactor(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

// 金额必须是有限静态系数，或恰有一次已结算伤害乘除静态系数，可在最外层取 max(0,x)。
// 全程序遍历保留原递归及累计指令预算；其他读值、分支、偏移和伤害分母不准入。
func settledEventHealFormulaTerm(registry *formula.Library, id formula.GenericProgramID, params map[string]float64, depth int, spent *int) (settledEventHealTerm, bool) {
	invalid := settledEventHealTerm{}
	if depth > 32 || int(id) >= registry.Metadata.Count() {
		return invalid, false
	}
	program := registry.Metadata.Info(formula.GenericProgramID(id))
	instructions := registry.Metadata.Instructions(id)
	charge := len(instructions)
	if program.HasAuthored {
		charge = program.AuthoredStats.Instructions
	}
	if charge > formula.MaxGenericTotalInstructions-*spent {
		return invalid, false
	}
	*spent += charge
	if program.HasAuthored {
		// 共享公式仅能提供已选定静态系数；未绑定运行参数不能在此求值。
		value, static := registry.Metadata.FoldStatic(id)
		return settledEventHealTerm{factor: value}, static && finiteNonnegativeEventHealFactor(value)
	}
	stack := make([]settledEventHealTerm, 0, 8)
	for _, instruction := range instructions {
		var value settledEventHealTerm
		switch instruction.Op {
		case formula.GenericOpConst:
			value.factor = instruction.Value
		case formula.GenericOpRead:
			switch instruction.ReadKind {
			case formula.ReadEventDamage:
				if instruction.ReadKey != "mitigatedAmount" {
					return invalid, false
				}
				value.factor, value.damage = 1, true
			case formula.ReadAbilityParam:
				var present bool
				value.factor, present = params[instruction.ReadKey]
				if !present || instruction.ReadKey == "" {
					return invalid, false
				}
			default:
				return invalid, false
			}
		case formula.GenericOpRef:
			var valid bool
			value, valid = settledEventHealFormulaTerm(registry, formula.GenericProgramID(instruction.RefIndex), params, depth+1, spent)
			if !valid {
				return invalid, false
			}
		case formula.GenericOpMul, formula.GenericOpDiv, formula.GenericOpMax:
			if len(stack) < 2 {
				return invalid, false
			}
			left, right := stack[len(stack)-2], stack[len(stack)-1]
			stack = stack[:len(stack)-2]
			if left.clamped || right.clamped || left.damage && right.damage {
				return invalid, false
			}
			switch instruction.Op {
			case formula.GenericOpMul:
				value = settledEventHealTerm{factor: left.factor * right.factor, damage: left.damage || right.damage}
			case formula.GenericOpDiv:
				if right.damage || right.factor == 0 {
					return invalid, false
				}
				value = settledEventHealTerm{factor: left.factor / right.factor, damage: left.damage}
			case formula.GenericOpMax:
				if left.damage && !right.damage && right.factor == 0 {
					value = left
				} else if right.damage && !left.damage && left.factor == 0 {
					value = right
				} else {
					return invalid, false
				}
				value.clamped = true
			}
		default:
			return invalid, false
		}
		if math.IsNaN(value.factor) || math.IsInf(value.factor, 0) || value.damage && value.factor < 0 {
			return invalid, false
		}
		stack = append(stack, value)
	}
	if len(stack) != 1 {
		return invalid, false
	}
	return stack[0], true
}
