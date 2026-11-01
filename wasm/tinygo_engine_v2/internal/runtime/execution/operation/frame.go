package operation

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/runtime/contract"
)

// Facts 是统一提交期间借用的数值事实，调用者不得改写切片或映射。
type Facts struct {
	Damage, Healing float64
	ResourceChanges []model.ResourceChangeRecord
	DamageIDs       uint64
	Damages         []contract.DamageFact
	History         []contract.DamageHistory
	DirectHealing   []model.DirectHealingRecord
	Overheal        map[string]float64
}

// Facts 返回本帧已完成的数值事实，不发布或复制所属状态。
func (f *Frame) Facts() Facts {
	return Facts{ResourceChanges: f.resourceChanges, Damage: f.damage, Healing: f.healing, DamageIDs: f.damageIDs, Damages: f.damages, History: f.history, DirectHealing: f.directHealing, Overheal: f.overheal}
}

// AddTotals 登记本帧管道已结算的伤害与治疗，不修改角色生命。
func (f *Frame) AddTotals(damage, healing float64) { f.damage += damage; f.healing += healing }

// AddDamage 登记一笔原位完成的逐伤事实，返回稳定索引。
func (f *Frame) AddDamage(value contract.DamageFact) int {
	index := len(f.damages)
	f.damages = append(f.damages, value)
	return index
}

// CompleteDamageSource 写入该笔伤害吸血之后的来源生命事实。
func (f *Frame) CompleteDamageSource(index int, hp float64) { f.damages[index].SourceHpAfter = hp }

// AddHistory 登记正数伤害汇总，与生命截断保持原独立语义。
func (f *Frame) AddHistory(value contract.DamageHistory) {
	if value.Amount > 0 {
		f.history = append(f.history, value)
	}
}

// AddHealing 登记一次直接治疗事实，提交仍由父层决定。
func (f *Frame) AddHealing(value model.DirectHealingRecord) {
	f.directHealing = append(f.directHealing, value)
}

// AddOverheal 汇集实际治疗之后的溢出金额。
func (f *Frame) AddOverheal(source string, amount float64) {
	if amount <= 0 {
		return
	}
	if f.overheal == nil {
		f.overheal = make(map[string]float64)
	}
	f.overheal[source] += amount
}

// NextDamageID 保留本帧尚未发布的身份增量。
func (f *Frame) NextDamageID(base uint64) uint64 { f.damageIDs++; return base + f.damageIDs }

// Outputs 返回本帧已结算操作输出的只读借用。
func (f *Frame) Outputs() map[string]formula.OperationOutputValues { return f.outputs }

// SetOutputs 恢复同帧嵌套候选原有的操作输出视图。
func (f *Frame) SetOutputs(value map[string]formula.OperationOutputValues) { f.outputs = value }

// RecordOutput 在原扣盾血完成时点登记实际操作输出。
func (f *Frame) RecordOutput(ref string, outcome pipeline.DamageOutcome) {
	if ref == "" {
		return
	}
	if f.outputs == nil {
		f.outputs = make(map[string]formula.OperationOutputValues)
	}
	f.outputs[ref] = formula.OperationOutputValues{PostDefenseDamage: outcome.MitigatedAmount, ShieldAbsorbed: outcome.ShieldAbsorbed, ActualHPLoss: outcome.HPDamage}
}

// SetTotals 在强化尾部的原汇总发布位置恢复或清空局部金额。
func (f *Frame) SetTotals(damage, healing float64) { f.damage, f.healing = damage, healing }

// EnsureFirstPerCast 在第一次可复制伤害时取得同次施放共享集合。
func (f *Frame) EnsureFirstPerCast() map[string]bool {
	if f.consumedFirstPerCast == nil {
		f.consumedFirstPerCast = make(map[string]bool)
	}
	return f.consumedFirstPerCast
}

// AddResourceChange 登记生命上限变化，父层已在原位置补足全场健康顺序。
func (f *Frame) AddResourceChange(row model.ResourceChangeRecord) {
	f.resourceChanges = append(f.resourceChanges, row)
}
