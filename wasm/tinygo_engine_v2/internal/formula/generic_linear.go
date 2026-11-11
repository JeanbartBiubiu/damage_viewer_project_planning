package formula

import "tinygo_engine_v2/internal/base/expression"

func (r programStore) targetAttributeLinear(id GenericProgramID, key string) (expression.Linear, bool) {
	visiting := make(map[GenericProgramID]bool)
	var analyze func(GenericProgramID) (expression.Linear, bool)
	analyze = func(index GenericProgramID) (expression.Linear, bool) {
		if int(index) >= len(r.programs) || visiting[index] {
			return expression.Linear{}, false
		}
		visiting[index] = true
		defer delete(visiting, index)
		program := r.programs[index]
		if program.Authored != nil {
			if program.NamedBinding == nil {
				return expression.Linear{}, false
			}
			return program.Authored.LinearForm(func(binding expression.Binding) (expression.Linear, bool) {
				if binding.Kind == "attribute" && binding.Object == "target" && binding.AttributeKey == key && binding.ValueKind == "TOTAL" && binding.View == "current_frame" {
					return expression.Linear{Factor: 1}, true
				}
				if binding.Kind == "parameter" {
					for _, parameter := range program.NamedBinding.parameters {
						if parameter.ParameterKey == binding.ParameterKey && binding.SkillKey == program.NamedBinding.skillKey && parameter.ValueMode != "RUNTIME_INPUT" && parameter.Value != nil {
							return expression.Linear{Offset: *parameter.Value}, true
						}
					}
				}
				return expression.Linear{}, false
			})
		}
		stack := make([]expression.Linear, 0, 8)
		for _, instruction := range program.Instr {
			var value expression.Linear
			valid := true
			switch instruction.Op {
			case GenericOpConst:
				value.Offset = instruction.Value
			case GenericOpRead:
				if instruction.ReadKind != ReadTargetAttr || (instruction.ReadKey != key+".resolved" && instruction.ReadKey != key) {
					return expression.Linear{}, false
				}
				value.Factor = 1
			case GenericOpRef:
				value, valid = analyze(GenericProgramID(instruction.RefIndex))
			default:
				operation := ""
				switch instruction.Op {
				case GenericOpAdd:
					operation = "add"
				case GenericOpSub:
					operation = "sub"
				case GenericOpMul:
					operation = "mul"
				case GenericOpDiv:
					operation = "div"
				}
				if len(stack) < 2 {
					return expression.Linear{}, false
				}
				value, valid = expression.LinearOperation(operation, stack[len(stack)-2], stack[len(stack)-1])
				stack = stack[:len(stack)-2]
			}
			if !valid {
				return expression.Linear{}, false
			}
			stack = append(stack, value)
		}
		if len(stack) != 1 {
			return expression.Linear{}, false
		}
		return stack[0], true
	}
	return analyze(id)
}
