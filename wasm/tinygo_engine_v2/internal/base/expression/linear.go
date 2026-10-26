package expression

import "math"

// Linear 表示 a*x+b；仅供编译期封闭机制验证。
type Linear struct{ Factor, Offset float64 }

func LinearOperation(op string, a, b Linear) (Linear, bool) {
	var out Linear
	switch op {
	case "add":
		out = Linear{a.Factor + b.Factor, a.Offset + b.Offset}
	case "sub":
		out = Linear{a.Factor - b.Factor, a.Offset - b.Offset}
	case "mul":
		if a.Factor != 0 && b.Factor != 0 {
			return out, false
		}
		out = Linear{a.Factor*b.Offset + b.Factor*a.Offset, a.Offset * b.Offset}
	case "div":
		if b.Factor != 0 || b.Offset == 0 {
			return out, false
		}
		out = Linear{a.Factor / b.Offset, a.Offset / b.Offset}
	default:
		return out, false
	}
	return out, !math.IsNaN(out.Factor) && !math.IsInf(out.Factor, 0) && !math.IsNaN(out.Offset) && !math.IsInf(out.Offset, 0)
}

func (p *Program) LinearForm(read func(Binding) (Linear, bool)) (Linear, bool) {
	if p == nil {
		return Linear{}, false
	}
	visiting := make([]bool, len(p.stages))
	cache := make([]Linear, len(p.stages))
	done := make([]bool, len(p.stages))
	var stage func(uint16) (Linear, bool)
	stage = func(index uint16) (Linear, bool) {
		if int(index) >= len(p.stages) || visiting[index] {
			return Linear{}, false
		}
		if done[index] {
			return cache[index], true
		}
		visiting[index] = true
		stack := make([]Linear, 0, 8)
		for _, instruction := range p.stages[index].code {
			var value Linear
			valid := true
			switch instruction.op {
			case "const":
				value.Offset = instruction.value
			case "read":
				if int(instruction.index) >= len(p.inputs) {
					return Linear{}, false
				}
				value, valid = read(p.inputs[instruction.index].Binding)
			case "ref":
				value, valid = stage(instruction.index)
			default:
				if len(stack) < 2 {
					return Linear{}, false
				}
				value, valid = LinearOperation(instruction.op, stack[len(stack)-2], stack[len(stack)-1])
				stack = stack[:len(stack)-2]
			}
			if !valid {
				return Linear{}, false
			}
			stack = append(stack, value)
		}
		if len(stack) != 1 {
			return Linear{}, false
		}
		visiting[index] = false
		done[index] = true
		cache[index] = stack[0]
		return stack[0], true
	}
	return stage(p.output)
}
