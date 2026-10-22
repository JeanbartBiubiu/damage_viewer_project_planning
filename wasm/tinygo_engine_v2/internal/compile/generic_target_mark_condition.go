package compile

import "tinygo_engine_v2/internal/formula"

// A conservative proof over boolean conjunctions; arbitrary conditions do not
// become authorization merely because a blocked read occurs in a hidden branch.
type targetMarkProofValue struct {
	known, boolean, readsBlocked bool
	value                        float64
}

func targetMarkConditionUnblocked(program formula.GenericProgramID, registry formula.GenericRegistry, depth int) bool {
	value, ok := targetMarkConditionValue(program, registry, depth)
	return ok && value.readsBlocked && value.known && value.value == 0
}

func targetMarkConditionValue(program formula.GenericProgramID, registry formula.GenericRegistry, depth int) (targetMarkProofValue, bool) {
	if depth > 64 || int(program) >= len(registry.Programs) {
		return targetMarkProofValue{}, false
	}
	stack := make([]targetMarkProofValue, 0, 8)
	for _, in := range registry.Programs[program].Instr {
		switch in.Op {
		case formula.GenericOpConst:
			stack = append(stack, targetMarkProofValue{known: true, boolean: in.Value == 0 || in.Value == 1, value: in.Value})
		case formula.GenericOpRead:
			v := targetMarkProofValue{}
			if in.ReadKind == formula.ReadEventSkillHit && in.ReadKey == "blocked" {
				v = targetMarkProofValue{known: true, boolean: true, readsBlocked: true, value: 1}
			}
			stack = append(stack, v)
		case formula.GenericOpRef:
			v, ok := targetMarkConditionValue(formula.GenericProgramID(in.RefIndex), registry, depth+1)
			if !ok {
				return targetMarkProofValue{}, false
			}
			stack = append(stack, v)
		default:
			if len(stack) < 2 {
				return targetMarkProofValue{}, false
			}
			a, b := stack[len(stack)-2], stack[len(stack)-1]
			stack = stack[:len(stack)-2]
			v := targetMarkProofValue{readsBlocked: a.readsBlocked || b.readsBlocked}
			switch in.Op {
			case formula.GenericOpEq, formula.GenericOpNe, formula.GenericOpLt, formula.GenericOpLte, formula.GenericOpGt, formula.GenericOpGte:
				v.boolean = true
				if a.known && b.known {
					truth := false
					switch in.Op {
					case formula.GenericOpEq:
						truth = a.value == b.value
					case formula.GenericOpNe:
						truth = a.value != b.value
					case formula.GenericOpLt:
						truth = a.value < b.value
					case formula.GenericOpLte:
						truth = a.value <= b.value
					case formula.GenericOpGt:
						truth = a.value > b.value
					case formula.GenericOpGte:
						truth = a.value >= b.value
					}
					v.known = true
					if truth {
						v.value = 1
					}
				}
			case formula.GenericOpMin, formula.GenericOpMax:
				v.boolean = a.boolean && b.boolean
				if a.known && b.known {
					v.known = true
					v.value = a.value
					if (in.Op == formula.GenericOpMin && b.value < v.value) || (in.Op == formula.GenericOpMax && b.value > v.value) {
						v.value = b.value
					}
				} else if v.boolean {
					if in.Op == formula.GenericOpMin && ((a.known && a.value == 0) || (b.known && b.value == 0)) {
						v.known = true
						v.value = 0
					}
					if in.Op == formula.GenericOpMax && ((a.known && a.value == 1) || (b.known && b.value == 1)) {
						v.known = true
						v.value = 1
					}
				}
			default:
				return targetMarkProofValue{}, false
			}
			stack = append(stack, v)
		}
	}
	if len(stack) != 1 {
		return targetMarkProofValue{}, false
	}
	return stack[0], true
}
