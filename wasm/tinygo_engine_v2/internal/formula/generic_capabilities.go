package formula

import (
	"errors"
	"strings"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/expression"
	"tinygo_engine_v2/internal/base/inputbinding"
	"tinygo_engine_v2/internal/model"
)

// BuilderAPI 声明公式构建阶段能力；不能交给运行消费者。
type BuilderAPI interface {
	// Register 完整预检后登记并复制输入；失败不消耗编号或预算。
	Register(program GenericProgram) (GenericProgramID, error)
	// BindAttributeLayout 按只读目录重建绑定，不修改此前冻结的公式。
	BindAttributeLayout(layout *attribute.Layout)
	// BindReadReference 只修订读取指令的编译绑定，失败不改变程序或预算。
	BindReadReference(id GenericProgramID, instruction int, reference uint16) error
	// Freeze 交出不可变公式集合；构建器后续写入复制表头、索引及受影响指令。
	Freeze() Library
	// Count 返回当前成功登记的程序数量。
	Count() int
	// Find 查询已登记键，不公开索引映射。
	Find(key string) (GenericProgramID, bool)
	// Info 返回程序身份和种类的小值，越界时返回零值。
	Info(id GenericProgramID) ProgramInfo
	// Instructions 返回指定程序指令的副本，修改不影响构建器。
	Instructions(id GenericProgramID) []GenericInstr
	// DeclaredInputs 返回共同公式声明输入副本，不借出作者程序。
	DeclaredInputs(id GenericProgramID) []expression.Input
	// AttributeCacheDependencies 分析构建中的可缓存依赖，不读取战斗状态。
	AttributeCacheDependencies(id GenericProgramID) ([]GenericInstr, bool)
	// DeclaredReferences 返回作者声明引用副本，不包含使用点包装。
	DeclaredReferences() map[string]model.GenericFormulaExpr
	// ReadDependencies 返回可达读取副本，覆盖引用及条件两支。
	ReadDependencies(id GenericProgramID) []GenericInstr
	// InstructionDependencies 分析临时指令及其具名绑定，不执行战斗读取。
	InstructionDependencies(code []GenericInstr, own *NamedBinding) []GenericInstr
	// ValidDeclaredScope 检查引用所属技能或游戏作用域。
	ValidDeclaredScope(code []GenericInstr, skill string) bool
	// FoldStatic 仅折叠无运行读取的程序，不能折叠时返回false。
	FoldStatic(id GenericProgramID) (float64, bool)
	// FoldInstructions 仅折叠无运行读取的临时指令。
	FoldInstructions(code []GenericInstr) (float64, bool)
	// EvaluateInstructions 仅供构建阶段临时预检，不登记程序。
	EvaluateInstructions(code []GenericInstr, ctx GenericEvalContext, static bool) (float64, error)
	// Eval 同步借用事实供构建阶段验证，不保存或改写上下文。
	Eval(id GenericProgramID, ctx GenericEvalContext) (float64, error)
	// TargetAttributeLinear 分析目标属性的线性形式；不能证明时返回false。
	TargetAttributeLinear(id GenericProgramID, key string) (expression.Linear, bool)
}

// EvaluatorAPI 只授予纯求值，不授予程序登记、修订或状态准备能力。
type EvaluatorAPI interface {
	// Eval 同步借用只读事实，返回数值或原求值错误，不保存上下文。
	Eval(id GenericProgramID, ctx GenericEvalContext) (float64, error)
	// EvalContext 同步借用上下文指针，不能修改输入或跨调用保留。
	EvalContext(id GenericProgramID, ctx *GenericEvalContext) (float64, error)
	// EvalBound 同步借用显式输入和已编译绑定，保留指令计费及惰性检查。
	EvalBound(id GenericProgramID, binding *inputbinding.Plan, values []inputbinding.Value) (float64, error)
}

// MetadataAPI 提供准入、缓存和诊断实际需要的只读元信息。
type MetadataAPI interface {
	// Count 返回冻结程序数量。
	Count() int
	// Find 读取公式键的稳定编号，不公开内部索引。
	Find(key string) (GenericProgramID, bool)
	// Info 返回身份、种类、归属和计费统计；不返回程序指针。
	Info(id GenericProgramID) ProgramInfo
	// Instructions 返回单个程序的指令副本，供有限结构准入使用。
	Instructions(id GenericProgramID) []GenericInstr
	// ReadDependencies 返回可达读取副本，不触发读取或状态准备。
	ReadDependencies(id GenericProgramID) []GenericInstr
	// AttributeCacheDependencies 返回可供属性缓存使用的依赖与可缓存标志。
	AttributeCacheDependencies(id GenericProgramID) ([]GenericInstr, bool)
	// WaitReadDeps 只交付普攻等待需要比较的双方属性与状态，不含指令。
	WaitReadDeps(id GenericProgramID) []WaitReadDependency
	// FoldStatic 在无运行输入时求静态值，不能折叠时返回false。
	FoldStatic(id GenericProgramID) (float64, bool)
	// TargetAttributeLinear 分析指定目标属性的线性形式，不读取战斗状态。
	TargetAttributeLinear(id GenericProgramID, key string) (expression.Linear, bool)
}

// WaitReadDependency 标记等待快照中需要按原顺序比较的一项属性或供值状态。
type WaitReadDependency struct {
	Kind GenericReadKind
	Key  string
}

// Builder 的复制句柄仍属于同一个构建作用域，冻结结果独立于该作用域的后续写入。
type Builder struct{ store *programStore }

// Library 是构建阶段交出的不可变产物；装配时分别借用求值与元信息能力。
type Library struct {
	Evaluation Evaluator
	Metadata   Metadata
}

type Evaluator struct{ store *programStore }
type Metadata struct{ store *programStore }

// ProgramInfo 只包含身份和统计，不借出编译程序或输入绑定的可写指针。
type ProgramInfo struct {
	Key, Scope, SkillKey, DefinitionPath        string
	DeclaredNamed, HasAuthored, HasNamedBinding bool
	InstructionCount                            int
	AuthoredStats                               expression.ProgramStats
}

var _ BuilderAPI = (*Builder)(nil)
var _ EvaluatorAPI = (*Evaluator)(nil)
var _ MetadataAPI = (*Metadata)(nil)

// NewBuilder 创建单独构建作用域，共享已有不可变指令；首次写入才复制表头及索引。
func NewBuilder(base Library) Builder {
	if base.Metadata.store == nil {
		return Builder{}
	}
	copy := *base.Metadata.store
	copy.shared = true
	return Builder{store: &copy}
}

func (b *Builder) current() *programStore {
	if b.store == nil {
		b.store = &programStore{}
	}
	return b.store
}

func (b *Builder) writable() *programStore {
	r := b.current()
	if r.shared {
		r.programs = append([]GenericProgram(nil), r.programs...)
		index := make(map[string]GenericProgramID, len(r.index))
		for key, id := range r.index {
			index[key] = id
		}
		r.index, r.shared = index, false
	}
	return r
}

func (b *Builder) Register(program GenericProgram) (GenericProgramID, error) {
	return b.writable().register(program)
}
func (b *Builder) BindAttributeLayout(layout *attribute.Layout) {
	b.writable().bindAttributeLayout(layout)
}
func (b *Builder) Freeze() Library {
	r := b.current()
	copy := *r
	r.shared, copy.shared = true, true
	return Library{Evaluation: Evaluator{&copy}, Metadata: Metadata{&copy}}
}
func (b *Builder) BindReadReference(id GenericProgramID, instruction int, reference uint16) error {
	r := b.current()
	if int(id) >= len(r.programs) || instruction < 0 || instruction >= len(r.programs[id].Instr) || r.programs[id].Instr[instruction].Op != GenericOpRead {
		return errors.New("formula read binding requires an existing read instruction")
	}
	r = b.writable()
	code := append([]GenericInstr(nil), r.programs[id].Instr...)
	code[instruction].ReferenceBound, code[instruction].RefIndex = true, reference
	r.programs[id].Instr = code
	return nil
}
func (b *Builder) Count() int { return len(b.current().programs) }
func (b *Builder) Find(key string) (GenericProgramID, bool) {
	id, ok := b.current().index[key]
	return id, ok
}
func (b *Builder) Info(id GenericProgramID) ProgramInfo { return info(b.current(), id) }
func (b *Builder) Instructions(id GenericProgramID) []GenericInstr {
	return instructions(b.current(), id)
}
func (b *Builder) DeclaredInputs(id GenericProgramID) []expression.Input {
	r := b.current()
	if int(id) >= len(r.programs) || r.programs[id].Authored == nil {
		return nil
	}
	return r.programs[id].Authored.Inputs()
}
func (b *Builder) AttributeCacheDependencies(id GenericProgramID) ([]GenericInstr, bool) {
	return b.current().attributeCacheDependencies(id)
}
func (b *Builder) DeclaredReferences() map[string]model.GenericFormulaExpr {
	return b.current().declaredReferences()
}
func (b *Builder) ReadDependencies(id GenericProgramID) []GenericInstr {
	return b.current().readDependencies(id)
}
func (b *Builder) InstructionDependencies(code []GenericInstr, own *NamedBinding) []GenericInstr {
	return b.current().instructionDependencies(code, own)
}
func (b *Builder) ValidDeclaredScope(code []GenericInstr, skill string) bool {
	return b.current().validDeclaredScope(code, skill)
}
func (b *Builder) FoldStatic(id GenericProgramID) (float64, bool) { return b.current().foldStatic(id) }
func (b *Builder) FoldInstructions(code []GenericInstr) (float64, bool) {
	return b.current().foldInstructions(code)
}
func (b *Builder) EvaluateInstructions(code []GenericInstr, ctx GenericEvalContext, static bool) (float64, error) {
	return b.current().evaluateInstructions(code, ctx, static)
}
func (b *Builder) Eval(id GenericProgramID, ctx GenericEvalContext) (float64, error) {
	return b.current().evaluate(id, ctx)
}
func (b *Builder) TargetAttributeLinear(id GenericProgramID, key string) (expression.Linear, bool) {
	return b.current().targetAttributeLinear(id, key)
}

func (e Evaluator) current() programStore {
	if e.store == nil {
		return programStore{}
	}
	return *e.store
}
func (e Evaluator) Eval(id GenericProgramID, ctx GenericEvalContext) (float64, error) {
	return e.current().evaluate(id, ctx)
}
func (e Evaluator) EvalContext(id GenericProgramID, ctx *GenericEvalContext) (float64, error) {
	return e.current().evalContext(id, ctx)
}
func (e Evaluator) EvalBound(id GenericProgramID, binding *inputbinding.Plan, values []inputbinding.Value) (float64, error) {
	return e.current().evalBound(id, binding, values)
}
func (m Metadata) current() programStore {
	if m.store == nil {
		return programStore{}
	}
	return *m.store
}
func (m Metadata) Count() int { return len(m.current().programs) }
func (m Metadata) Find(key string) (GenericProgramID, bool) {
	id, ok := m.current().index[key]
	return id, ok
}
func (m Metadata) Info(id GenericProgramID) ProgramInfo            { return info(m.store, id) }
func (m Metadata) Instructions(id GenericProgramID) []GenericInstr { return instructions(m.store, id) }
func (m Metadata) ReadDependencies(id GenericProgramID) []GenericInstr {
	return m.current().readDependencies(id)
}
func (m Metadata) WaitReadDeps(id GenericProgramID) []WaitReadDependency {
	var dependencies []WaitReadDependency
	for _, read := range m.ReadDependencies(id) {
		if read.Op != GenericOpRead {
			continue
		}
		key := read.ReadKey
		switch read.ReadKind {
		case ReadSourceAttr, ReadTargetAttr:
			if separator := strings.LastIndex(key, "."); separator >= 0 {
				key = key[:separator]
			}
		case ReadProviderState, ReadProviderTargetState:
		default:
			continue
		}
		dependencies = append(dependencies, WaitReadDependency{Kind: read.ReadKind, Key: key})
	}
	return dependencies
}

func (m Metadata) AttributeCacheDependencies(id GenericProgramID) ([]GenericInstr, bool) {
	return m.current().attributeCacheDependencies(id)
}
func (m Metadata) FoldStatic(id GenericProgramID) (float64, bool) { return m.current().foldStatic(id) }
func (m Metadata) TargetAttributeLinear(id GenericProgramID, key string) (expression.Linear, bool) {
	return m.current().targetAttributeLinear(id, key)
}

func info(r *programStore, id GenericProgramID) ProgramInfo {
	if r == nil || int(id) >= len(r.programs) {
		return ProgramInfo{}
	}
	p := r.programs[id]
	i := ProgramInfo{Key: p.Key, DeclaredNamed: p.DeclaredNamed, HasAuthored: p.Authored != nil, HasNamedBinding: p.NamedBinding != nil, InstructionCount: len(p.Instr)}
	if p.Authored != nil {
		i.AuthoredStats = p.Authored.Stats()
	}
	if p.NamedBinding != nil {
		i.Scope, i.SkillKey, i.DefinitionPath = p.NamedBinding.scope, p.NamedBinding.skillKey, p.NamedBinding.path
	}
	return i
}
func instructions(r *programStore, id GenericProgramID) []GenericInstr {
	if r == nil || int(id) >= len(r.programs) {
		return nil
	}
	return append([]GenericInstr(nil), r.programs[id].Instr...)
}

// EvaluateRead 只求单个已经准备的读取事实，供准入校验复用读取口径；不登记程序。
func EvaluateRead(read GenericInstr, ctx GenericEvalContext) (float64, error) {
	if read.Op != GenericOpRead {
		return 0, errors.New("formula fact evaluation requires a read instruction")
	}
	return evalInstructionRead(read, &ctx)
}

func ownProgram(program GenericProgram) GenericProgram {
	program.Instr = append([]GenericInstr(nil), program.Instr...)
	if program.Authored != nil {
		if program.authoredIdentity == nil {
			program.authoredIdentity = program.Authored
		}
		copy := *program.Authored
		program.Authored = &copy
	}
	if binding := program.NamedBinding; binding != nil {
		copy := *binding
		if binding.plan != nil {
			if copy.planIdentity == nil {
				copy.planIdentity = binding.plan
			}
			plan := *binding.plan
			copy.plan = &plan
		}
		copy.inputs = append([]expression.Input(nil), binding.inputs...)
		copy.dependencies = append([]GenericInstr(nil), binding.dependencies...)
		copy.attributeInputs = append([]namedAttributeBinding(nil), binding.attributeInputs...)
		copy.parameters = append([]model.FormulaParameter(nil), binding.parameters...)
		for i, parameter := range copy.parameters {
			if parameter.Value != nil {
				value := *parameter.Value
				parameter.Value = &value
			}
			if parameter.RuntimeSource != nil {
				source := *parameter.RuntimeSource
				if source.Value != nil {
					value := *source.Value
					source.Value = &value
				}
				parameter.RuntimeSource = &source
			}
			copy.parameters[i] = parameter
		}
		program.NamedBinding = &copy
	}
	return program
}

func authoredIdentity(program GenericProgram) *expression.Program {
	if program.authoredIdentity != nil {
		return program.authoredIdentity
	}
	return program.Authored
}
