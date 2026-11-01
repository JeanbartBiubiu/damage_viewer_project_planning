package operation

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

// DamageApplied 是本笔实际扣盾血及吸血完成后交给父层派发的有限事实。
type DamageApplied struct {
	Command              pipeline.Command
	Operation            planbundle.CompiledOperation
	Ability              planbundle.CompiledAbility
	Crit                 CritEvidence
	BaseRaw, Raw, Killed float64
	Outcome              pipeline.DamageOutcome
	Before               []contract.DamageStateBefore
	DamageID             uint64
	Result               pipeline.CommandResult
}

// DamageReads 只在原时点捕获伤前状态及关联盾身份，不持有后续执行控制。
type DamageReads interface {
	// CaptureDamageBefore 冻结本笔原伤害的前置状态。
	CaptureDamageBefore(source, target string) ([]contract.DamageStateBefore, *model.EngineError)
	// BindDamageAbsorptions 在护盾耗尽移除前绑定实际吸收身份。
	BindDamageAbsorptions(snapshot *pipeline.ShieldAbsorptionSnapshot, target string, total float64) *model.EngineError
}

// NumericBoundary 仅组合伤害后的效果和属性阶段及真实因果尾部。
type NumericBoundary interface {
	// SettleDamageDepletion 原位处理耗尽关联盾，不创建子帧或提交。
	SettleDamageDepletion() *model.EngineError
	// ResolveNumericAttributes 在原时点重算当前帧的属性。
	ResolveNumericAttributes(ability planbundle.CompiledAbility)
	// FinishNumericDamage 将已完成事实交给原顺序的事件与贡献汇集。
	FinishNumericDamage(value DamageApplied) *model.EngineError
}

// NumericRecording 只汇集当前帧记录及预算身份，不发布战斗状态。
type NumericRecording interface {
	// RecordNumericExecute 汇集实际斩杀事实，不生成伤害事件。
	RecordNumericExecute(value contract.ExecuteFact)
	// RecordNumericEvidence 保持原明细或汇总证据的插入位置。
	RecordNumericEvidence(kind model.EvidenceKind, item model.EvidenceItem)
	// RecordNumericDamage 补足来源身份后登记本帧逐伤事实。
	RecordNumericDamage(value contract.DamageFact)
	// NextNumericDamageID 在原结算点取得本帧身份。
	NextNumericDamageID() uint64
	// RecordNumericBefore 记录已捕获的伤前状态及实际伤害身份。
	RecordNumericBefore(before []contract.DamageStateBefore, id uint64, target string)
}

// ApplyDamage 执行扣盾血、耗尽同步、属性重算、吸血和数值事实，按原边界返回错误。
func (s *Executor) ApplyDamage(state *Frame, input Input, reads NumericReads, damageReads DamageReads, boundary NumericBoundary, recording NumericRecording, cmd pipeline.Command, op planbundle.CompiledOperation, crit CritEvidence, ability planbundle.CompiledAbility, mods []map[string]interface{}) *model.EngineError {
	f := calculation{executor: s, state: state, input: input, reads: reads, damageReads: damageReads, boundary: boundary, recording: recording}
	return f.applyDamageCommand(cmd, op, crit, ability, mods)
}
func (f *calculation) captureDamageStateBefore(source, target string) ([]contract.DamageStateBefore, *model.EngineError) {
	return f.damageReads.CaptureDamageBefore(source, target)
}
func (f *calculation) bindReceivedShieldAbsorptions(snapshot *pipeline.ShieldAbsorptionSnapshot, target string, total float64) *model.EngineError {
	return f.damageReads.BindDamageAbsorptions(snapshot, target, total)
}
func (f *calculation) recordOperationOutput(op planbundle.CompiledOperation, outcome pipeline.DamageOutcome) {
	f.state.RecordOutput(op.OutputRef, outcome)
}
func (f *calculation) nextDamageID() uint64 { return f.recording.NextNumericDamageID() }
func (f *calculation) recordDamageStateBefore(before []contract.DamageStateBefore, id uint64, target string) {
	f.recording.RecordNumericBefore(before, id, target)
}
func (f *calculation) recordGenericDamageEvidence(value contract.DamageFact) {
	f.recording.RecordNumericDamage(value)
}
func (f *calculation) settleDepletedShieldAttributes() *model.EngineError {
	return f.boundary.SettleDamageDepletion()
}
func (f *calculation) reResolveStagedAttributesTwoPass(ability planbundle.CompiledAbility) {
	f.boundary.ResolveNumericAttributes(ability)
}
func (f *calculation) applyDamageResult(cmd pipeline.Command, result pipeline.CommandResult, sc Owner) {
	f.state.AddTotals(result.Amount, 0)
	f.state.AddHistory(contract.DamageHistory{TimeMs: f.input.TimeMs, SourceKey: cmd.Source, TargetKey: cmd.Target, Amount: result.Amount})
	attrs := sc.attributesView()
	slot, ok := attrs.Lookup("hp")
	if ok && math.Float64bits(slot.Resolved) != math.Float64bits(slot.Current) {
		slot.Resolved = slot.Current
		attrs = attrs.With("hp", slot)
	}
	sc.setAttributes(attrs)
}

func (f *calculation) recordOverheal(source string, amount float64) {
	f.state.AddOverheal(source, amount)
}
func (f *calculation) providerFormulaContextFunc(host string) pipeline.ProviderFormulaContextFunc {
	return f.providerFormulaContextForTarget(host, f.input.Target, f.input.StrictProviders)
}
func attachCastProvenance(data map[string]interface{}, id uint64, origin string) {
	if id > 0 {
		data["castInstanceId"] = float64(id)
	}
	if origin != "" {
		data["castOrigin"] = origin
	}
}

func (f *calculation) recordGenericExecuteEvidence(value contract.ExecuteFact) {
	f.recording.RecordNumericExecute(value)
}
