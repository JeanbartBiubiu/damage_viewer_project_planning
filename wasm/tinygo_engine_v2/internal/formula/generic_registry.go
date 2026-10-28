package formula

import (
	"errors"
	"math"
	"tinygo_engine_v2/internal/base/expression"
	"tinygo_engine_v2/internal/base/inputbinding"
	"tinygo_engine_v2/internal/model"
	"unsafe"

	"tinygo_engine_v2/internal/base/attribute"
)

const (
	MaxGenericPrograms            = 65536
	MaxGenericProgramInstructions = 512
	MaxGenericTotalInstructions   = 262144
	MaxGenericTotalInputs         = 262144
	MaxGenericTotalStages         = 65536
	MaxGenericFormulaMemoryBytes  = 32 << 20
)

var (
	errGenericProgramLimit     = errors.New("formula program count exceeds maximum")
	errGenericInstructionLimit = errors.New("formula instruction count exceeds maximum")
	errGenericTotalLimit       = errors.New("formula cumulative instruction count exceeds maximum")
	errGenericInputLimit       = errors.New("formula cumulative input count exceeds maximum")
	errGenericStageLimit       = errors.New("formula cumulative result count exceeds maximum")
	errGenericMemoryLimit      = errors.New("formula memory accounting exceeds maximum")
	errGenericKeyConflict      = errors.New("formula key already registered with different contents")
)

// GenericRegistryAPI 集中声明战斗公式注册、用途检查和只读求值；不提交战斗状态。
// 声明用于阅读与编译检查；实际调用继续使用具体类型。
type GenericRegistryAPI interface {
	// AttributeCacheDependencies 返回可供属性缓存使用的依赖及是否可缓存，不能证明安全时返回 false。
	AttributeCacheDependencies(id GenericProgramID) ([]GenericInstr, bool)
	// BindAttributeLayout 绑定运行时使用的只读属性目录，不改变已经编译的数学规则。
	BindAttributeLayout(layout *attribute.Layout)
	// CloneForRun 复制程序表及索引供单次运行追加；已注册程序内容保持只读。
	CloneForRun() *GenericRegistry
	// DeclaredReferences 返回作者声明的具名公式引用副本，不公开内部临时用途包装。
	DeclaredReferences() map[string]model.GenericFormulaExpr
	// Eval 借用上下文数值求值；越界、缺少必要事实或非有限结果返回错误。
	Eval(id GenericProgramID, ctx GenericEvalContext) (float64, error)
	// EvalBound 同步借用显式数值及输入绑定，不保存数值切片，复用现有指令计费；输入绑定按同步回调读取。
	EvalBound(id GenericProgramID, binding *inputbinding.Plan, values []inputbinding.Value) (float64, error)
	// EvalContext 同步借用上下文指针且不保存；调用方及读取回调在求值期间不得修改上下文。
	EvalContext(id GenericProgramID, ctx *GenericEvalContext) (float64, error)
	// EvaluateInstructions 以临时程序表求值，不向共享注册表追加程序；保留静态读取及预算检查。
	EvaluateInstructions(instr []GenericInstr, ctx GenericEvalContext, static bool) (float64, error)
	// FoldInstructions 仅折叠非空且不含运行时读取的指令；失败不返回有效常量。
	FoldInstructions(instr []GenericInstr) (float64, bool)
	// FoldStatic 仅折叠没有运行时读取的有效程序；不能折叠时返回 false。
	FoldStatic(id GenericProgramID) (float64, bool)
	// InstructionDependencies 收集指令及其具名绑定可达的读取依赖，不执行公式。
	InstructionDependencies(instructions []GenericInstr, own *NamedBinding) []GenericInstr
	// ReadDependencies 返回输出可达的读取依赖，递归覆盖引用及条件两支。
	ReadDependencies(id GenericProgramID) []GenericInstr
	// Register 全项预检通过后注册；失败不改变编号或预算，调用方不得消费失败返回的编号。
	Register(program GenericProgram) (GenericProgramID, error)
	// TargetAttributeLinear 分析指定目标属性的线性形式；不能证明线性时返回 false。
	TargetAttributeLinear(id GenericProgramID, key string) (expression.Linear, bool)
	// ValidDeclaredScope 检查全部引用是否属于已声明的游戏或当前技能作用域。
	ValidDeclaredScope(instructions []GenericInstr, skill string) bool
}

// GenericRegistry的两种内容共享同一预算和编号；程序内容注册后只读。
type GenericRegistry struct {
	attributeLayout   *attribute.Layout
	Programs          []GenericProgram
	Index             map[string]GenericProgramID
	accountedPrograms int
	instructionCount  int
	inputCount        int
	stageCount        int
	memoryBytes       uint64
}

type genericUsage struct {
	instructions, inputs, stages int
	bytes                        uint64
}

var _ GenericRegistryAPI = (*GenericRegistry)(nil)

func IsRegistryLimit(err error) bool {
	return errors.Is(err, errGenericProgramLimit) || errors.Is(err, errGenericInstructionLimit) || errors.Is(err, errGenericTotalLimit) || errors.Is(err, errGenericInputLimit) || errors.Is(err, errGenericStageLimit) || errors.Is(err, errGenericMemoryLimit)
}

func programUsage(program GenericProgram) (genericUsage, error) {
	usage := genericUsage{instructions: len(program.Instr)}
	if program.Authored != nil {
		if len(program.Instr) != 0 {
			return genericUsage{}, errors.New("formula program contents must be mutually exclusive")
		}
		stats := program.Authored.Stats()
		if stats.Stages < 1 {
			return genericUsage{}, errors.New("authored formula program is invalid")
		}
		usage.instructions, usage.inputs, usage.stages = stats.Instructions, stats.Inputs, stats.Stages
	} else if len(program.Instr) == 0 || program.BindingBytes != 0 {
		return genericUsage{}, errors.New("formula program requires instructions or authored content")
	}
	if usage.instructions > MaxGenericProgramInstructions {
		return genericUsage{}, errGenericInstructionLimit
	}
	var err error
	usage.bytes, err = genericProgramMemoryBytes(program)
	return usage, err
}

func addUsage(total, next genericUsage) (genericUsage, error) {
	if next.instructions > MaxGenericTotalInstructions-total.instructions {
		return genericUsage{}, errGenericTotalLimit
	}
	if next.inputs > MaxGenericTotalInputs-total.inputs {
		return genericUsage{}, errGenericInputLimit
	}
	if next.stages > MaxGenericTotalStages-total.stages {
		return genericUsage{}, errGenericStageLimit
	}
	if next.bytes > uint64(MaxGenericFormulaMemoryBytes)-total.bytes {
		return genericUsage{}, errGenericMemoryLimit
	}
	return genericUsage{total.instructions + next.instructions, total.inputs + next.inputs, total.stages + next.stages, total.bytes + next.bytes}, nil
}

func (r *GenericRegistry) Register(program GenericProgram) (GenericProgramID, error) {
	if r == nil {
		return 0, errors.New("formula registry is nil")
	}
	if program.Key == "" {
		return 0, errors.New("formula program key is required")
	}
	if id, exists := r.Index[program.Key]; exists {
		if int(id) >= len(r.Programs) {
			return 0, errors.New("formula registered index is out of range")
		}
		if !sameGenericProgram(r.Programs[id], program) {
			return 0, errGenericKeyConflict
		}
		return id, nil
	}
	if len(r.Programs) >= MaxGenericPrograms {
		return 0, errGenericProgramLimit
	}
	current, err := r.usage()
	if err != nil {
		return 0, err
	}
	if err := r.validateCalls(program); err != nil {
		return 0, err
	}
	next, err := programUsage(program)
	if err != nil {
		return 0, err
	}
	total, err := addUsage(current, next)
	if err != nil {
		return 0, err
	}
	id := GenericProgramID(len(r.Programs))
	if r.Index == nil {
		r.Index = make(map[string]GenericProgramID)
	}
	r.Programs = append(r.Programs, bindProgramAttributes(program, r.attributeLayout))
	r.Index[program.Key] = id
	r.accountedPrograms, r.instructionCount = len(r.Programs), total.instructions
	r.inputCount, r.stageCount, r.memoryBytes = total.inputs, total.stages, total.bytes
	return id, nil
}

func (r GenericRegistry) CloneForRun() *GenericRegistry {
	clone := &GenericRegistry{attributeLayout: r.attributeLayout, Programs: make([]GenericProgram, len(r.Programs)), Index: make(map[string]GenericProgramID, len(r.Index)), accountedPrograms: r.accountedPrograms, instructionCount: r.instructionCount, inputCount: r.inputCount, stageCount: r.stageCount, memoryBytes: r.memoryBytes}
	copy(clone.Programs, r.Programs)
	for key, id := range r.Index {
		clone.Index[key] = id
	}
	return clone
}

func (r GenericRegistry) usage() (genericUsage, error) {
	if len(r.Programs) > MaxGenericPrograms {
		return genericUsage{}, errGenericProgramLimit
	}
	total := genericUsage{}
	if r.accountedPrograms == len(r.Programs) {
		cached := genericUsage{r.instructionCount, r.inputCount, r.stageCount, r.memoryBytes}
		if cached.instructions < 0 || cached.inputs < 0 || cached.stages < 0 {
			return genericUsage{}, errGenericTotalLimit
		}
		return addUsage(total, cached)
	}
	for _, program := range r.Programs {
		next, err := programUsage(program)
		if err != nil {
			return genericUsage{}, err
		}
		total, err = addUsage(total, next)
		if err != nil {
			return genericUsage{}, err
		}
	}
	return total, nil
}

func genericProgramMemoryBytes(program GenericProgram) (uint64, error) {
	if len(program.Instr) > MaxGenericProgramInstructions {
		return 0, errGenericInstructionLimit
	}
	remaining := uint64(MaxGenericFormulaMemoryBytes)
	consume := func(bytes uint64) bool {
		if bytes > remaining {
			return false
		}
		remaining -= bytes
		return true
	}
	if !consume(uint64(unsafe.Sizeof(GenericProgram{}))) || !consume(uint64(len(program.Key))) {
		return 0, errGenericMemoryLimit
	}
	if !consume(program.PlanBytes) {
		return 0, errGenericMemoryLimit
	}
	if program.Authored != nil {
		stats := program.Authored.Stats()
		if stats.ChargedBytes < 0 || !consume(uint64(stats.ChargedBytes)) || !consume(program.BindingBytes) {
			return 0, errGenericMemoryLimit
		}
	} else {
		if !consume(uint64(len(program.Instr)) * uint64(unsafe.Sizeof(GenericInstr{}))) {
			return 0, errGenericMemoryLimit
		}
		for _, instr := range program.Instr {
			if !consume(uint64(len(instr.ReadKey))) {
				return 0, errGenericMemoryLimit
			}
		}
	}
	return uint64(MaxGenericFormulaMemoryBytes) - remaining, nil
}

func sameGenericProgram(a, b GenericProgram) bool {
	if a.Key != b.Key || a.Authored != b.Authored || a.BindingBytes != b.BindingBytes || a.PlanBytes != b.PlanBytes || !sameNamedBinding(a.NamedBinding, b.NamedBinding) || a.DeclaredNamed != b.DeclaredNamed || len(a.Instr) != len(b.Instr) {
		return false
	}
	for i, instr := range a.Instr {
		other := b.Instr[i]
		if instr.Op != other.Op || instr.AuthoredRead != other.AuthoredRead || math.Float64bits(instr.Value) != math.Float64bits(other.Value) || instr.ReadKind != other.ReadKind || instr.ReadKey != other.ReadKey || instr.RefIndex != other.RefIndex || instr.Decimals != other.Decimals || instr.JumpTarget != other.JumpTarget {
			return false
		}
	}
	return true
}

func (r GenericRegistry) validateCalls(program GenericProgram) error {
	visiting := make(map[GenericProgramID]bool)
	var count func(GenericProgram, int) (int, error)
	count = func(p GenericProgram, depth int) (int, error) {
		if depth > 32 {
			return 0, errGenericTotalLimit
		}
		total := len(p.Instr)
		if p.Authored != nil {
			total = p.Authored.Stats().Instructions
		}
		for _, in := range p.Instr {
			if in.Op != GenericOpRef {
				continue
			}
			id := GenericProgramID(in.RefIndex)
			if int(id) >= len(r.Programs) || visiting[id] {
				return 0, errors.New("formula call is unknown or cyclic")
			}
			visiting[id] = true
			cost, err := count(r.Programs[id], depth+1)
			delete(visiting, id)
			if err != nil {
				return 0, err
			}
			if cost > MaxGenericTotalInstructions-total {
				return 0, errGenericTotalLimit
			}
			total += cost
		}
		return total, nil
	}
	_, err := count(program, 1)
	return err
}
