package expression

import "math"

// Arithmetic 只负责已声明的数学原语，调用者负责操作数数量及使用点约束。
func Arithmetic(op string, values []float64, decimals int) (float64, *ContractIssue) {
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, contractProblem("FORMULA_NON_FINITE", "")
		}
	}
	number := float64(0)
	if len(values) == 2 {
		left, right := values[0], values[1]
		switch op {
		case "add":
			number = left + right
		case "sub":
			number = left - right
		case "mul":
			number = left * right
		case "div":
			if right == 0 {
				return 0, contractProblem("FORMULA_DIVISION_BY_ZERO", "")
			}
			number = left / right
		case "min":
			number = math.Min(left, right)
		case "max":
			number = math.Max(left, right)
		case "eq", "ne", "lt", "lte", "gt", "gte":
			matched := op == "eq" && left == right || op == "ne" && left != right || op == "lt" && left < right || op == "lte" && left <= right || op == "gt" && left > right || op == "gte" && left >= right
			if matched {
				number = 1
			}
		default:
			return 0, contractProblem("FORMULA_INVALID_PROGRAM", "")
		}
	} else if len(values) == 3 && op == "clamp" {
		// 新协议在调用前检查边界；旧入口保持原上下界语义。
		number = math.Max(values[1], math.Min(values[2], values[0]))
	} else if len(values) == 1 {
		number = values[0]
		scale := float64(1)
		if decimals > 0 {
			scale = math.Pow(10, float64(decimals))
		}
		number *= scale
		if math.IsNaN(number) || math.IsInf(number, 0) || math.IsInf(scale, 0) {
			return 0, contractProblem("FORMULA_NON_FINITE", "")
		}
		switch op {
		case "round":
			number = math.Round(number)
		case "floor":
			number = math.Floor(number)
		case "ceil":
			number = math.Ceil(number)
		case "trunc":
			number = math.Trunc(number)
		default:
			return 0, contractProblem("FORMULA_INVALID_PROGRAM", "")
		}
		number /= scale
	} else {
		return 0, contractProblem("FORMULA_INVALID_PROGRAM", "")
	}
	if math.IsNaN(number) || math.IsInf(number, 0) {
		return 0, contractProblem("FORMULA_NON_FINITE", "")
	}
	return number, nil
}
