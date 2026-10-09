package inputbinding

import (
	"math"
	"strconv"
	"unsafe"

	"tinygo_engine_v2/internal/expression"
)

const MaxCatalogEntries = 4096

// Scalar 明确区分未供值与合法0。
type Scalar struct {
	Value   float64
	Present bool
}

// Value 是调用者按目录顺序提供的当前帧或冻结事件只读数值。
type Value struct {
	Base, Total, Current, Max Scalar
	Number                    Scalar
}

type boundInput struct {
	catalog uint16
	kind    string
	value   string
}

// Plan 固定声明到目录的索引及口径，不持有战斗对象或可写输入。
type Plan struct {
	inputs  []boundInput
	entries int
}

// ChargedBytes返回只读计划保留内存的逻辑计费，供同一会话注册预算使用。
func (p *Plan) ChargedBytes() uint64 {
	if p == nil {
		return 0
	}
	bytes := uint64(unsafe.Sizeof(Plan{})) + uint64(cap(p.inputs))*uint64(unsafe.Sizeof(boundInput{}))
	for _, input := range p.inputs {
		bytes += uint64(len(input.kind) + len(input.value))
	}
	return bytes
}

func Bind(program *expression.Program, catalog []expression.Binding) (*Plan, *expression.ContractIssue) {
	if program == nil {
		return nil, &expression.ContractIssue{Code: "FORMULA_INVALID_PROGRAM"}
	}
	if len(catalog) > MaxCatalogEntries {
		return nil, &expression.ContractIssue{Code: "FORMULA_LIMIT", Path: "/catalog"}
	}
	index := make(map[expression.Binding]uint16, len(catalog))
	for i, binding := range catalog {
		if _, exists := index[binding]; exists {
			return nil, &expression.ContractIssue{Code: "FORMULA_DUPLICATE_KEY", Path: "/catalog/" + strconv.Itoa(i)}
		}
		index[binding] = uint16(i) // 已在窄化前检查目录上限。
	}
	inputs := program.Inputs()
	plan := &Plan{inputs: make([]boundInput, len(inputs)), entries: len(catalog)}
	for i, input := range inputs {
		position, exists := index[input.Binding]
		if !exists {
			return nil, &expression.ContractIssue{Code: "FORMULA_UNKNOWN_BINDING", Path: "/inputs/" + strconv.Itoa(i) + "/binding"}
		}
		plan.inputs[i] = boundInput{catalog: position, kind: input.Binding.Kind, value: input.Binding.ValueKind}
	}
	return plan, nil
}

// Reader 冻结本次显式数值，只有被实际读取的字段执行存在性与数值检查。
func (p *Plan) Reader(values []Value) (expression.ReadInput, *expression.ContractIssue) {
	if p == nil {
		return nil, &expression.ContractIssue{Code: "FORMULA_INVALID_PROGRAM"}
	}
	if len(values) > p.entries {
		return nil, &expression.ContractIssue{Code: "FORMULA_INVALID_PROGRAM", Path: "/values"}
	}
	frozen := append([]Value(nil), values...)
	return func(slot uint16) (float64, *expression.ContractIssue) {
		if int(slot) >= len(p.inputs) {
			return 0, &expression.ContractIssue{Code: "FORMULA_INVALID_PROGRAM"}
		}
		input := p.inputs[slot]
		if int(input.catalog) >= len(frozen) {
			return 0, &expression.ContractIssue{Code: "FORMULA_MISSING_INPUT"}
		}
		value := frozen[input.catalog]
		read := func(s Scalar) (float64, *expression.ContractIssue) {
			if !s.Present {
				return 0, &expression.ContractIssue{Code: "FORMULA_MISSING_INPUT"}
			}
			if math.IsNaN(s.Value) || math.IsInf(s.Value, 0) {
				return 0, &expression.ContractIssue{Code: "FORMULA_NON_FINITE"}
			}
			return s.Value, nil
		}
		if input.kind == "parameter" || input.kind == "context" {
			return read(value.Number)
		}
		if input.kind != "attribute" {
			return 0, &expression.ContractIssue{Code: "FORMULA_INVALID_PROGRAM"}
		}
		switch input.value {
		case "BASE":
			return read(value.Base)
		case "TOTAL":
			return read(value.Total)
		case "CURRENT":
			return read(value.Current)
		case "MAX":
			return read(value.Max)
		}
		var left, right float64
		var issue *expression.ContractIssue
		if input.value == "BONUS" {
			left, issue = read(value.Total)
			if issue == nil {
				right, issue = read(value.Base)
			}
		} else {
			left, issue = read(value.Max)
			if issue == nil {
				right, issue = read(value.Current)
			}
		}
		if issue != nil {
			return 0, issue
		}
		switch input.value {
		case "BONUS", "MISSING":
			return expression.Arithmetic("sub", []float64{left, right}, 0)
		case "CURRENT_RATIO":
			return expression.Arithmetic("div", []float64{right, left}, 0)
		case "MISSING_RATIO":
			missing, issue := expression.Arithmetic("sub", []float64{left, right}, 0)
			if issue != nil {
				return 0, issue
			}
			return expression.Arithmetic("div", []float64{missing, left}, 0)
		default:
			return 0, &expression.ContractIssue{Code: "FORMULA_INVALID_PROGRAM"}
		}
	}, nil
}
