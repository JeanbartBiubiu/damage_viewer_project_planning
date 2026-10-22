package runtime

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

// This is initialization-only structural admission. No event exists yet, so it
// neither evaluates a dummy event nor freezes the amount used by the executor.
func (s *genericRunState) isOwnedSettledEventHeal(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	damage, hasDamage := s.compiled.RuntimeTypes.DamageInstance.Lookup()
	owner, hasOwner := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	if !hasDamage || !hasOwner || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(owner) ||
		listener.OperationCount != 1 || listener.HasOncePerUse || operation.HasCondition ||
		listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(s.compiled.Abilities) {
		return false
	}
	ability := s.compiled.Abilities[listener.SourceAbilityIndex]
	provider := s.compiled.Providers[operation.OwnerProviderIndex]
	if ability.Kind != "passive_listener" || int(ability.ProviderIndex) != operation.OwnerProviderIndex ||
		listener.SourceAbilityIndex < int(provider.AbilityStart) || listener.SourceAbilityIndex >= int(provider.AbilityStart)+int(provider.AbilityCount) ||
		provider.Lifecycle != nil || provider.StableID == "" || (provider.Kind != "character" && provider.Kind != "build" && provider.Kind != "item") {
		return false
	}
	spent := 0
	term, valid := s.settledEventHealTerm(operation.AmountProgram, ability.Params, 1, &spent)
	return valid && term.damage && finiteNonnegativeEventHealFactor(term.factor)
}

type settledEventHealTerm struct {
	factor  float64
	damage  bool
	clamped bool
}

func finiteNonnegativeEventHealFactor(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

// A term is either a finite static coefficient or exactly one occurrence of the
// settled amount multiplied/divided by static coefficients, optionally max(0, x).
// Reading another field, branching, adding an offset or using damage as a divisor
// is outside this gate. Traversal visits the whole program, not a selected branch.
func (s *genericRunState) settledEventHealTerm(id formula.GenericProgramID, params map[string]float64, depth int, spent *int) (settledEventHealTerm, bool) {
	invalid := settledEventHealTerm{}
	if depth > 32 || int(id) >= len(s.formulas.Programs) {
		return invalid, false
	}
	program := s.formulas.Programs[id]
	charge := len(program.Instr)
	if program.Authored != nil {
		charge = program.Authored.Stats().Instructions
	}
	if charge > formula.MaxGenericTotalInstructions-*spent {
		return invalid, false
	}
	*spent += charge
	if program.Authored != nil {
		// The original shared formula can supply an already selected static
		// coefficient. Its unbound runtime parameters must never be executed here.
		value, static := s.formulas.FoldStatic(id)
		return settledEventHealTerm{factor: value}, static && finiteNonnegativeEventHealFactor(value)
	}
	stack := make([]settledEventHealTerm, 0, 8)
	for _, instruction := range program.Instr {
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
			value, valid = s.settledEventHealTerm(formula.GenericProgramID(instruction.RefIndex), params, depth+1, spent)
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
