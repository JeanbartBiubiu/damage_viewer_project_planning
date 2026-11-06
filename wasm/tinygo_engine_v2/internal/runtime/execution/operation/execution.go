// Package operation 执行数值操作并持有本帧的局部结算事实。
package operation

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

// NumericReads 只提供当前数值结算必需的视图；读取准备仍发生在原调用位置。
type NumericReads interface {
	// NumericOwner 借用角色及效果的所属变更对象，不发布状态。
	NumericOwner(key string) Owner
	// NumericContext 在原读取时点准备公式上下文。
	NumericContext(ability planbundle.CompiledAbility) formula.GenericEvalContext
	// NumericEntryAttributes 返回帧入口的不可变属性，复制伤害另传防御视图。
	NumericEntryAttributes(key string) attribute.Table
	// NumericProviderContext 只准备指定宿主、目标和严格性下的效果公式读取。
	NumericProviderContext(host, target string, strict bool) pipeline.ProviderFormulaContextFunc
	// NumericAbilityTypes 返回已编译能力类型身份。
	NumericAbilityTypes(ability planbundle.CompiledAbility) []string
}

// Owner 是一次数值调用借用的所属变更，不包含行动、队列或其他业务控制。
type Owner struct {
	Numbers   *actor.ChangeSet
	Instances *effectpkg.InstanceChangeSet
	Dirty     *bool
}

// Input 保存本次数值调用的有限身份与原读取时点。
type Input struct {
	Source, Target, AbilityRef, ProviderRef, CastOrigin string
	ProcessUseKey, ProcessUseSource, ProcessUseSkill    string
	CastInstanceID                                      uint64
	TimeMs                                              int64
	DefenseContext                                      *formula.GenericEvalContext
	StrictProviders                                     bool
	StrictReads                                         bool
	Event                                               *contract.EventSnapshot
	SkillHitOccurrenceID                                uint64
}

// FrameAPI 规定复制与同次施放共享的数值局部事实。
type FrameAPI interface {
	// AddDamage 登记一笔原位完成的逐伤事实，返回稳定索引。
	AddDamage(value contract.DamageFact) int
	// AddHealing 登记一次直接治疗事实，提交仍由父层决定。
	AddHealing(value model.DirectHealingRecord)
	// AddHistory 登记正数伤害汇总，与生命截断保持原独立语义。
	AddHistory(value contract.DamageHistory)
	// AddOverheal 汇集实际治疗之后的溢出金额。
	AddOverheal(source string, amount float64)
	// AddResourceChange 登记生命上限变化，父层已在原位置补足全场健康顺序。
	AddResourceChange(row model.ResourceChangeRecord)
	// AddTotals 登记本帧管道已结算的伤害与治疗，不修改角色生命。
	AddTotals(damage, healing float64)
	// Aggregation 返回当前帧汇集的只读借用，切片有效至下一次汇集或清空。
	Aggregation() Aggregation
	// ClearAggregation 在同帧候选切换位置清空原汇集，不清除数值结算。
	ClearAggregation()
	// CompleteDamageSource 写入该笔伤害吸血之后的来源生命事实。
	CompleteDamageSource(index int, hp float64)
	// EnsureFirstPerCast 在第一次可复制伤害时取得同次施放共享集合。
	EnsureFirstPerCast() map[string]bool
	// Facts 返回本帧已完成的数值事实，不发布或复制所属状态。
	Facts() Facts
	// FirstPerCast 返回供同次施放复制继承的消费事实，调用者不得改写。
	FirstPerCast() map[string]bool
	// NextDamageID 保留本帧尚未发布的身份增量。
	NextDamageID(base uint64) uint64
	// Outputs 返回本帧已结算操作输出的只读借用。
	Outputs() map[string]formula.OperationOutputValues
	// RecordOutput 在原扣盾血完成时点登记实际操作输出。
	RecordOutput(ref string, outcome pipeline.DamageOutcome)
	// SetOutputs 恢复同帧嵌套候选原有的操作输出视图。
	SetOutputs(value map[string]formula.OperationOutputValues)
	// SetTotals 在强化尾部的原汇总发布位置恢复或清空局部金额。
	SetTotals(damage, healing float64)
	// ShareFirstPerCast 继承同一施放的原消费集合，不复制或重置已消费事实。
	ShareFirstPerCast(value map[string]bool)
}

// Frame 私有持有每次施放共享的首笔修正消费事实。
type Frame struct {
	aggregation          Aggregation
	consumedFirstPerCast map[string]bool
	damage, healing      float64
	damageIDs            uint64
	damages              []contract.DamageFact
	history              []contract.DamageHistory
	directHealing        []model.DirectHealingRecord
	overheal             map[string]float64
	outputs              map[string]formula.OperationOutputValues
	resourceChanges      []model.ResourceChangeRecord
}

var _ FrameAPI = (*Frame)(nil)

// ExecutorAPI 列出实际数值结算入口，热路径调用具体对象。
type ExecutorAPI interface {
	// ApplyCopyDamage 用冻结暴击和防御入口结算当前盾血、原逐伤证据及吸血，不产生普通伤害事件。
	ApplyCopyDamage(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, recording NumericRecording, cmd pipeline.Command, op planbundle.CompiledOperation, crit CritEvidence, ability planbundle.CompiledAbility, repeatTag string) *model.EngineError
	// ApplyDamage 执行扣盾血、耗尽同步、属性重算、吸血和数值事实，按原边界返回错误。
	ApplyDamage(state *Frame, input Input, reads NumericReads, damageReads DamageReads, boundary NumericBoundary, recording NumericRecording, cmd pipeline.Command, op planbundle.CompiledOperation, crit CritEvidence, ability planbundle.CompiledAbility, mods []map[string]interface{}) *model.EngineError
	// ApplyLink 在当前帧校验并执行作者联动事件，不提交或提前派发。
	ApplyLink(state *Frame, input Input, reads NumericReads, host EventHost, op planbundle.CompiledOperation, ability planbundle.CompiledAbility, target string) *model.EngineError
	// AttributeChange 执行属性基础值策略并在原时点请求派生重算。
	AttributeChange(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, target, key, policy string, amount float64, ability planbundle.CompiledAbility) *model.EngineError
	// DamageContribution 稳定汇集合格根帧的真实伤害，不重算数值，也不发布事件。
	DamageContribution(state *Frame, cmd pipeline.Command, result pipeline.CommandResult, operationRef, operationPath string) *model.EngineError
	// DamageNumbers 按原顺序结算修正乘区、作者防御和抗性后的暴击分支。
	DamageNumbers(state *Frame, input Input, reads NumericReads, cmd pipeline.Command, op planbundle.CompiledOperation, crit CritEvidence, ability planbundle.CompiledAbility, mods []map[string]interface{}) (DamageNumbers, *model.EngineError)
	// DirectHeal 执行真实直接治疗；资格、付款前后视图及记录时点保持原顺序。
	DirectHeal(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, recording NumericRecording, recovery Recovery, cmd pipeline.Command, op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError
	// Emit 核对作者事件并追加同帧事实，不允许伪造引擎生成的使用或命中事件。
	Emit(input Input, host EventHost, op planbundle.CompiledOperation, target string) *model.EngineError
	// Execute 依原顺序判断条件并执行操作；失败保留此前暂存和原部分发布边界。
	Execute(state *Frame, input Input, reads NumericReads, damageReads DamageReads, boundary NumericBoundary, recording NumericRecording, preparation Preparation, ability planbundle.CompiledAbility, ops []planbundle.CompiledOperation) *model.EngineError
	// ExecuteOne 执行已由调用者准备条件的单个操作，复用相同预算和路由。
	ExecuteOne(state *Frame, input Input, reads NumericReads, damageReads DamageReads, boundary NumericBoundary, recording NumericRecording, preparation Preparation, ability planbundle.CompiledAbility, op *planbundle.CompiledOperation) *model.EngineError
	// ExpectedCrit 在原金额之后结算确定性暴击与对应前置修正。
	ExpectedCrit(state *Frame, input Input, reads NumericReads, op planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64, target string) (CritEvidence, float64, []map[string]interface{}, *model.EngineError)
	// PipelineModifiers 执行指定参与者的整段修正与首笔消费。
	PipelineModifiers(state *Frame, input Input, reads NumericReads, host, source, target, command, stage string, amount float64, ability planbundle.CompiledAbility, damageType string, traits []string, evidence []map[string]interface{}) (float64, []map[string]interface{}, *model.EngineError)
	// ResourceChange 修改实际资源槽，成本与返还复用同一管道。
	ResourceChange(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, target, resource string, amount float64, ability planbundle.CompiledAbility) *model.EngineError
	// ResourceMaximum 按已准备的效果贡献调整当前生命及最大值，身份仍由父层在原位置分配。
	ResourceMaximum(input Input, reads NumericReads, owner string, maximum float64, next effectpkg.ResourceContributions, contributors []model.ResourceChangeContributor, dead bool) (model.ResourceChangeRecord, bool, *model.EngineError)
	// SettleHealing 结算两方向修正、实际生命与溢出，并在原时点请求属性重算。
	SettleHealing(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, recording NumericRecording, source, target string, amount float64, category string, ability planbundle.CompiledAbility, ctx formula.GenericEvalContext) (HealingOutcome, *model.EngineError)
	// SettleVamp 执行普通与复制伤害共用的吸血尾部。
	SettleVamp(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, recording NumericRecording, cmd pipeline.Command, op planbundle.CompiledOperation, ability planbundle.CompiledAbility, outcome pipeline.DamageOutcome, before float64, id uint64, phantom bool) *model.EngineError
}

// Executor 保存本场只读数值规则；每次调用使用独立局部上下文。
type Executor struct {
	plan      *planbundle.CompiledSession
	formulas  *formula.GenericRegistry
	sessionID string
	detailed  bool
}

type calculation struct {
	executor    *Executor
	state       *Frame
	input       Input
	reads       NumericReads
	damageReads DamageReads
	boundary    NumericBoundary
	recording   NumericRecording
	preparation Preparation
}

func (f *Frame) FirstPerCast() map[string]bool           { return f.consumedFirstPerCast }
func (f *Frame) ShareFirstPerCast(value map[string]bool) { f.consumedFirstPerCast = value }

var _ ExecutorAPI = (*Executor)(nil)

// New 借用本场固定规则；不保存当前帧、数值变更或同步执行上下文。
func New(plan *planbundle.CompiledSession, formulas *formula.GenericRegistry, sessionID string, detailed bool) Executor {
	return Executor{plan: plan, formulas: formulas, sessionID: sessionID, detailed: detailed}
}

func (s *Executor) ExpectedCrit(state *Frame, input Input, reads NumericReads, op planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64, target string) (CritEvidence, float64, []map[string]interface{}, *model.EngineError) {
	f := calculation{executor: s, state: state, input: input, reads: reads}
	return f.settleExpectedCrit(op, ability, amount, target)
}
func (s *Executor) DamageNumbers(state *Frame, input Input, reads NumericReads, cmd pipeline.Command, op planbundle.CompiledOperation, crit CritEvidence, ability planbundle.CompiledAbility, mods []map[string]interface{}) (DamageNumbers, *model.EngineError) {
	f := calculation{executor: s, state: state, input: input, reads: reads}
	return f.resolveDamageNumbers(cmd, op, crit, ability, mods)
}
func (s *Executor) PipelineModifiers(state *Frame, input Input, reads NumericReads, host, source, target, command, stage string, amount float64, ability planbundle.CompiledAbility, damageType string, traits []string, evidence []map[string]interface{}) (float64, []map[string]interface{}, *model.EngineError) {
	f := calculation{executor: s, state: state, input: input, reads: reads}
	return f.applyPipelineDamageModifiers(host, source, target, command, stage, amount, ability, damageType, traits, evidence)
}
func (f *calculation) stageFor(key string) Owner { return f.reads.NumericOwner(key) }
func (f *calculation) evalContext(ability planbundle.CompiledAbility) formula.GenericEvalContext {
	return f.reads.NumericContext(ability)
}
func (f *calculation) abilityTypeKeys(ability planbundle.CompiledAbility) []string {
	return f.reads.NumericAbilityTypes(ability)
}
func (f *calculation) providerFormulaContextForTarget(host, target string, strict bool) pipeline.ProviderFormulaContextFunc {
	return f.reads.NumericProviderContext(host, target, strict)
}
func (c Owner) attributesView() attribute.Table     { return c.Numbers.Attributes() }
func (c Owner) resourceView() model.ResourceView    { return c.Numbers.Resources() }
func (c Owner) setAttributes(value attribute.Table) { c.Numbers.SetAttributes(value) }
func (f *calculation) preserveFormulaIssue(err error, fallback *model.EngineError) *model.EngineError {
	return evaluation.PreserveFormulaIssue(err, fallback, f.input.AbilityRef)
}
func (f *calculation) formulaError(id formula.GenericProgramID, message string) *model.EngineError {
	path := "formula"
	if int(id) < len(f.executor.formulas.Programs) {
		path = f.executor.formulas.Programs[id].Key
	}
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, path, f.input.AbilityRef, f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
}
func (f *calculation) processError(path, message, ref string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path, ref, f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
}
func (f *calculation) evalResultFormula(id formula.GenericProgramID, ability planbundle.CompiledAbility, target string) (float64, *model.EngineError) {
	ctx := f.evalContext(ability)
	ctx.StrictReads = true
	ctx.TargetAttrs = f.stageFor(target).attributesView()
	ctx.TargetResources = f.stageFor(target).resourceView()
	value, err := f.executor.formulas.EvalContext(id, &ctx)
	if err != nil {
		return 0, evaluation.PreserveFormulaIssue(err, f.formulaError(id, err.Error()), f.input.AbilityRef)
	}
	return value, nil
}
func (f *calculation) resolveConfiguredDefense(cmd pipeline.Command, def planbundle.CompiledDamageTypeFormula) (evaluation.DefenseResult, *model.EngineError) {
	source, target := f.reads.NumericEntryAttributes(cmd.Source), f.reads.NumericEntryAttributes(cmd.Target)
	if f.input.DefenseContext != nil {
		source, target = f.input.DefenseContext.SourceAttrs, f.input.DefenseContext.TargetAttrs
	}
	return evaluation.ResolveConfiguredDefense(*f.executor.formulas, def, cmd.Amount, source, target, evaluation.DefenseIdentity{AbilityRef: f.input.AbilityRef, SchemaHash: f.executor.plan.SchemaHash, RulesHash: f.executor.plan.RulesHash, SessionID: f.executor.sessionID})
}
func engineErrorPtr(phase model.GenericErrorPhase, code model.GenericErrCode, message, schema, rules, session string) *model.EngineError {
	e := model.NewEngineError(phase, code, message)
	e.SchemaHash, e.RulesHash, e.SessionID = schema, rules, session
	return &e
}
func engineErrorPtrAt(phase model.GenericErrorPhase, code model.GenericErrCode, message, path, ref, schema, rules, session string) *model.EngineError {
	e := engineErrorPtr(phase, code, message, schema, rules, session)
	e.Path, e.Ref = path, ref
	return e
}

func (f *calculation) eventTypeSet(keys []string) typeset.TypeSet {
	var set typeset.TypeSet
	for _, key := range keys {
		if id, ok := f.executor.plan.Types.LookupForEntity(key, typeset.EntityListener); ok {
			set.Add(id)
		}
	}
	return set
}

// SettleVamp 执行普通与复制伤害共用的吸血尾部。
func (s *Executor) SettleVamp(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, recording NumericRecording, cmd pipeline.Command, op planbundle.CompiledOperation, ability planbundle.CompiledAbility, outcome pipeline.DamageOutcome, before float64, id uint64, phantom bool) *model.EngineError {
	f := calculation{executor: s, state: state, input: input, reads: reads, boundary: boundary, recording: recording}
	return f.settleDamageVamp(cmd, op, ability, outcome, before, id, phantom)
}

// SettleHealing 结算两方向修正、实际生命与溢出，并在原时点请求属性重算。
func (s *Executor) SettleHealing(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, recording NumericRecording, source, target string, amount float64, category string, ability planbundle.CompiledAbility, ctx formula.GenericEvalContext) (HealingOutcome, *model.EngineError) {
	f := calculation{executor: s, state: state, input: input, reads: reads, boundary: boundary, recording: recording}
	return f.settleHealing(source, target, amount, category, ability, ctx)
}

// ResourceChange 修改实际资源槽，成本与返还复用同一管道。
func (s *Executor) ResourceChange(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, target, resource string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	f := calculation{executor: s, state: state, input: input, reads: reads, boundary: boundary}
	return f.applyResourceChange(target, resource, amount, ability)
}

// AttributeChange 执行属性基础值策略并在原时点请求派生重算。
func (s *Executor) AttributeChange(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, target, key, policy string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	f := calculation{executor: s, state: state, input: input, reads: reads, boundary: boundary}
	return f.applyAttributeChange(target, key, policy, amount, ability)
}
