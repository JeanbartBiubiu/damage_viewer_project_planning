package expression

import (
	"math"
	"strconv"
	"unsafe"
)

// Binding 是作者明确声明的数值输入身份；它不持有战斗对象。
type Binding struct {
	Kind         string
	Object       string
	AttributeKey string
	ValueKind    string
	View         string
	SkillKey     string
	ParameterKey string
	ContextKey   string
}

type Input struct {
	Key     string
	Binding Binding
}

type instruction struct {
	op       string
	value    float64
	index    uint16
	jump     uint16
	decimals int
	path     string
}

type resultProgram struct {
	code []instruction
}

// ProgramAPI 集中声明纯表达式程序的查询与求值，不持有战斗对象。
// 声明用于阅读与编译检查；实际调用继续使用具体类型。
type ProgramAPI interface {
	// Evaluate 通过显式只读供值器求值，每次创建独立执行缓存并返回结构化问题。
	Evaluate(reader ReadInput) (Evaluation, *ContractIssue)
	// Inputs 返回全部声明输入的副本，调用方修改不影响程序。
	Inputs() []Input
	// LinearForm 用调用方给出的输入线性形式分析输出；不能证明线性时返回 false。
	LinearForm(read func(Binding) (Linear, bool)) (Linear, bool)
	// OutputInputs 返回输出可达输入并覆盖条件两支；声明授权仍使用全部 Inputs。
	OutputInputs() []Input
	// Stats 返回程序的输入、阶段、指令及逻辑计费统计；空程序返回零值。
	Stats() ProgramStats
}

// Program 私有持有编译产物。每次执行重新建立缓存，公开查询不暴露可写切片。
type Program struct {
	inputs       []Input
	stages       []resultProgram
	output       uint16
	instructions int
	bytes        int
}

type ProgramStats struct {
	Inputs       int
	Stages       int
	Instructions int
	ChargedBytes int
}

// ReadInput 只按已编译槽号供值；具体角色、时点及口径由绑定层持有。
type ReadInput func(slot uint16) (float64, *ContractIssue)

type Evaluation struct {
	Value           float64
	EvaluatedStages int
	ReadInputs      int
}

type evaluationState struct {
	program *Program
	reader  ReadInput
	stack   [DefinitionMaxNodes]float64
	top     int
	states  [DefinitionMaxStages]uint8
	results [DefinitionMaxStages]float64
	read    [DefinitionMaxInputs]bool
	inputs  [DefinitionMaxInputs]float64
	stats   Evaluation
}

var _ ProgramAPI = (*Program)(nil)

func (p *Program) Stats() ProgramStats {
	if p == nil {
		return ProgramStats{}
	}
	return ProgramStats{len(p.inputs), len(p.stages), p.instructions, p.bytes}
}

func (p *Program) Inputs() []Input {
	if p == nil {
		return nil
	}
	return append([]Input(nil), p.inputs...)
}

func (p *Program) OutputInputs() []Input {
	if p == nil {
		return nil
	}
	seenStages := make([]bool, len(p.stages))
	seenInputs := make([]bool, len(p.inputs))
	var visit func(uint16)
	visit = func(index uint16) {
		if int(index) >= len(p.stages) || seenStages[index] {
			return
		}
		seenStages[index] = true
		for _, in := range p.stages[index].code {
			if in.op == "read" && int(in.index) < len(seenInputs) {
				seenInputs[in.index] = true
			}
			if in.op == "ref" {
				visit(in.index)
			}
		}
	}
	visit(p.output)
	var out []Input
	for i, input := range p.inputs {
		if seenInputs[i] {
			out = append(out, input)
		}
	}
	return out
}

// CompileDefinition 校验并编译共同定义，所有结果各编译一次，不递归内联共享结果。
func CompileDefinition(definition any, allowedBindings []any) (*Program, *ContractIssue) {
	if issue := ValidateDefinition(definition, allowedBindings); issue != nil {
		return nil, issue
	}
	root := contractMap(definition)
	inputs, stages := contractArray(root["inputs"]), contractArray(root["stages"])
	p := &Program{inputs: make([]Input, len(inputs)), stages: make([]resultProgram, len(stages))}
	inputIndex, stageIndex := make(map[string]uint16, len(inputs)), make(map[string]uint16, len(stages))
	for i, raw := range inputs {
		item := contractMap(raw)
		binding := contractMap(item["binding"])
		p.inputs[i] = Input{Key: contractString(item["key"]), Binding: Binding{
			Kind: contractString(binding["kind"]), Object: contractString(binding["object"]), AttributeKey: contractString(binding["attributeKey"]),
			ValueKind: contractString(binding["valueKind"]), View: contractString(binding["view"]), SkillKey: contractString(binding["skillKey"]),
			ParameterKey: contractString(binding["parameterKey"]), ContextKey: contractString(binding["contextKey"]),
		}}
		inputIndex[p.inputs[i].Key] = uint16(i) // 已通过64项局部索引预算。
	}
	for i, raw := range stages {
		stageIndex[contractString(contractMap(raw)["key"])] = uint16(i)
	}
	p.output = stageIndex[contractString(root["outputStageKey"])]
	var emit func(map[string]any, string, *[]instruction)
	emit = func(expr map[string]any, path string, code *[]instruction) {
		op := contractString(expr["op"])
		switch op {
		case "const":
			value, _ := strconv.ParseFloat(contractString(expr["value"]), 64)
			*code = append(*code, instruction{op: op, value: value, path: path})
		case "read":
			*code = append(*code, instruction{op: op, index: inputIndex[contractString(expr["inputKey"])], path: path + "/inputKey"})
		case "ref":
			*code = append(*code, instruction{op: op, index: stageIndex[contractString(expr["stageKey"])], path: path + "/stageKey"})
		case "if":
			args := contractArray(expr["args"])
			emit(contractMap(args[0]), path+"/args/0", code)
			conditional := len(*code)
			*code = append(*code, instruction{op: "jump_zero", path: path})
			emit(contractMap(args[1]), path+"/args/1", code)
			end := len(*code)
			*code = append(*code, instruction{op: "jump", path: path})
			(*code)[conditional].jump = uint16(len(*code))
			emit(contractMap(args[2]), path+"/args/2", code)
			(*code)[end].jump = uint16(len(*code))
		default:
			for i, raw := range contractArray(expr["args"]) {
				emit(contractMap(raw), path+"/args/"+strconv.Itoa(i), code)
			}
			decimals, _ := contractInteger(expr["decimals"])
			*code = append(*code, instruction{op: op, decimals: int(decimals), path: path})
		}
	}
	for i, raw := range stages {
		emit(contractMap(contractMap(raw)["expression"]), "/stages/"+strconv.Itoa(i)+"/expression", &p.stages[i].code)
		p.instructions += len(p.stages[i].code) + 1 // 每份结果的保存也计指令。
	}
	if p.instructions > DefinitionMaxInstructions {
		return nil, contractProblem("FORMULA_LIMIT", "/stages")
	}
	p.bytes = int(unsafe.Sizeof(Program{})) + len(p.inputs)*int(unsafe.Sizeof(Input{})) + len(p.stages)*int(unsafe.Sizeof(resultProgram{}))
	for _, input := range p.inputs {
		b := input.Binding
		p.bytes += len(input.Key) + len(b.Kind) + len(b.Object) + len(b.AttributeKey) + len(b.ValueKind) + len(b.View) + len(b.SkillKey) + len(b.ParameterKey) + len(b.ContextKey)
	}
	for _, stage := range p.stages {
		p.bytes += cap(stage.code) * int(unsafe.Sizeof(instruction{}))
		for _, in := range stage.code {
			p.bytes += len(in.op) + len(in.path)
		}
	}
	return p, nil
}

func (p *Program) Evaluate(reader ReadInput) (Evaluation, *ContractIssue) {
	if p == nil || len(p.stages) == 0 || len(p.stages) > DefinitionMaxStages || len(p.inputs) > DefinitionMaxInputs || int(p.output) >= len(p.stages) {
		return Evaluation{}, contractProblem("FORMULA_INVALID_PROGRAM", "")
	}
	if result, issue, handled := p.evaluatePrimitive(reader); handled {
		return result, issue
	}
	state := evaluationState{program: p, reader: reader}
	value, issue := state.stage(p.output, 1)
	if issue != nil {
		return Evaluation{}, issue
	}
	state.stats.Value = value
	return state.stats, nil
}

// 单独常量、读取或两叶值二元运算不需要初始化整套阶段、输入和运算栈缓存。
func (p *Program) evaluatePrimitive(reader ReadInput) (Evaluation, *ContractIssue, bool) {
	code := p.stages[p.output].code
	if len(code) == 3 && (code[0].op == "const" || code[0].op == "read") && (code[1].op == "const" || code[1].op == "read") {
		switch code[2].op {
		case "add", "sub", "mul", "div", "min", "max", "eq", "ne", "lt", "lte", "gt", "gte":
			result, issue := p.evaluateBinaryPrimitive(code, reader)
			return result, issue, true
		}
	}
	if len(code) != 1 || (code[0].op != "const" && code[0].op != "read") {
		return Evaluation{}, nil, false
	}
	in := code[0]
	value, reads := in.value, 0
	if in.op == "read" {
		if int(in.index) >= len(p.inputs) {
			return Evaluation{}, contractProblem("FORMULA_INVALID_PROGRAM", in.path), true
		}
		if reader == nil {
			return Evaluation{}, contractProblem("FORMULA_MISSING_INPUT", in.path), true
		}
		var issue *ContractIssue
		value, issue = reader(in.index)
		if issue != nil {
			problem := *issue
			if problem.Path == "" {
				problem.Path = in.path
			}
			return Evaluation{}, &problem, true
		}
		reads = 1
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return Evaluation{}, contractProblem("FORMULA_NON_FINITE", in.path), true
	}
	return Evaluation{Value: value, EvaluatedStages: 1, ReadInputs: reads}, nil, true
}

// 两个叶值加一个二元原语无需初始化完整栈；读取顺序、复用和错误定位与解释器相同。
func (p *Program) evaluateBinaryPrimitive(code []instruction, reader ReadInput) (Evaluation, *ContractIssue) {
	var values [2]float64
	reads := 0
	for index := range values {
		in := &code[index]
		value := in.value
		if in.op == "read" {
			if int(in.index) >= len(p.inputs) {
				return Evaluation{}, contractProblem("FORMULA_INVALID_PROGRAM", in.path)
			}
			if index == 1 && code[0].op == "read" && in.index == code[0].index {
				value = values[0]
			} else {
				if reader == nil {
					return Evaluation{}, contractProblem("FORMULA_MISSING_INPUT", in.path)
				}
				var issue *ContractIssue
				value, issue = reader(in.index)
				if issue != nil {
					problem := *issue
					if problem.Path == "" {
						problem.Path = in.path
					}
					return Evaluation{}, &problem
				}
				reads++
			}
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return Evaluation{}, contractProblem("FORMULA_NON_FINITE", in.path)
		}
		values[index] = value
	}
	value, issue := Arithmetic(code[2].op, values[:], code[2].decimals)
	if issue != nil {
		problem := *issue
		if problem.Path == "" {
			problem.Path = code[2].path
		}
		return Evaluation{}, &problem
	}
	return Evaluation{Value: value, EvaluatedStages: 1, ReadInputs: reads}, nil
}

func (s *evaluationState) stage(index uint16, depth int) (float64, *ContractIssue) {
	if depth > DefinitionMaxDepth {
		return 0, contractProblem("FORMULA_LIMIT", "")
	}
	if int(index) >= len(s.program.stages) || s.states[index] == 1 {
		return 0, contractProblem("FORMULA_INVALID_PROGRAM", "")
	}
	if s.states[index] == 2 {
		return s.results[index], nil
	}
	s.states[index] = 1
	s.stats.EvaluatedStages++
	base := s.top
	code := s.program.stages[index].code
	for pc := 0; pc < len(code); pc++ {
		in := code[pc]
		value := in.value
		var issue *ContractIssue
		switch in.op {
		case "const":
		case "read":
			if int(in.index) >= len(s.program.inputs) {
				return 0, contractProblem("FORMULA_INVALID_PROGRAM", in.path)
			}
			if s.read[in.index] {
				value = s.inputs[in.index]
			} else {
				if s.reader == nil {
					return 0, contractProblem("FORMULA_MISSING_INPUT", in.path)
				}
				value, issue = s.reader(in.index)
				if issue == nil {
					s.read[in.index], s.inputs[in.index] = true, value
					s.stats.ReadInputs++
				}
			}
		case "ref":
			value, issue = s.stage(in.index, depth+1)
		case "jump_zero", "jump":
			if int(in.jump) <= pc || int(in.jump) > len(code) {
				return 0, contractProblem("FORMULA_INVALID_PROGRAM", in.path)
			}
			jump := in.op == "jump"
			if in.op == "jump_zero" {
				if s.top <= base {
					return 0, contractProblem("FORMULA_INVALID_PROGRAM", in.path)
				}
				s.top--
				jump = s.stack[s.top] == 0
			}
			if jump {
				pc = int(in.jump) - 1
			}
			continue
		default:
			count := 2
			if in.op == "clamp" {
				count = 3
			} else if in.op == "round" || in.op == "floor" || in.op == "ceil" || in.op == "trunc" {
				count = 1
			}
			if s.top-base < count {
				return 0, contractProblem("FORMULA_INVALID_PROGRAM", in.path)
			}
			start := s.top - count
			if in.op == "clamp" && s.stack[start+1] > s.stack[start+2] {
				return 0, contractProblem("FORMULA_INVALID_BOUNDS", in.path)
			}
			value, issue = Arithmetic(in.op, s.stack[start:s.top], in.decimals)
			s.top = start
		}
		if issue != nil {
			problem := *issue
			if problem.Path == "" {
				problem.Path = in.path
			}
			return 0, &problem
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, contractProblem("FORMULA_NON_FINITE", in.path)
		}
		if s.top >= len(s.stack) {
			return 0, contractProblem("FORMULA_LIMIT", in.path)
		}
		s.stack[s.top] = value
		s.top++
	}
	if s.top-base != 1 {
		return 0, contractProblem("FORMULA_INVALID_PROGRAM", "")
	}
	s.top--
	value := s.stack[s.top]
	s.states[index], s.results[index] = 2, value
	return value, nil
}
