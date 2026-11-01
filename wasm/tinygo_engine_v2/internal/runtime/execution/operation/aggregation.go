package operation

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// TypeContribution 是一种实际伤害类型的只读汇集事实，条目不去重实际贡献。
type TypeContribution struct {
	DamageType      string
	RawAmount       float64
	MitigatedAmount float64
	OperationRefs   []string
}

type Aggregation struct {
	RawAmount       float64
	MitigatedAmount float64
	OperationRefs   []string
	// ByType 保持原键排序，只去重分类，不去重实际贡献。
	ByType []TypeContribution
}

// DamageContribution 稳定汇集合格根帧的真实伤害，不重算数值，也不发布事件。
func (s *Executor) DamageContribution(state *Frame, cmd pipeline.Command, result pipeline.CommandResult, operationRef, operationPath string) *model.EngineError {
	aggregation := &state.aggregation
	index := 0
	for index < len(aggregation.ByType) && aggregation.ByType[index].DamageType < cmd.DamageType {
		index++
	}
	existing := index < len(aggregation.ByType) && aggregation.ByType[index].DamageType == cmd.DamageType
	typeRaw, typeMitigated := cmd.Amount, result.Amount
	if existing {
		typeRaw += aggregation.ByType[index].RawAmount
		typeMitigated += aggregation.ByType[index].MitigatedAmount
	}
	totalRaw, totalMitigated := aggregation.RawAmount+cmd.Amount, aggregation.MitigatedAmount+result.Amount
	for _, amount := range [4]float64{totalRaw, totalMitigated, typeRaw, typeMitigated} {
		if math.IsNaN(amount) || math.IsInf(amount, 0) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
				"damage event aggregation must remain finite", operationPath, cmd.DamageType,
				s.plan.SchemaHash, s.plan.RulesHash, s.sessionID)
		}
	}
	aggregation.RawAmount, aggregation.MitigatedAmount = totalRaw, totalMitigated
	aggregation.OperationRefs = append(aggregation.OperationRefs, operationRef)
	if !existing {
		aggregation.ByType = append(aggregation.ByType, TypeContribution{})
		copy(aggregation.ByType[index+1:], aggregation.ByType[index:len(aggregation.ByType)-1])
		aggregation.ByType[index] = TypeContribution{DamageType: cmd.DamageType}
	}
	contribution := &aggregation.ByType[index]
	contribution.RawAmount, contribution.MitigatedAmount = typeRaw, typeMitigated
	contribution.OperationRefs = append(contribution.OperationRefs, operationRef)
	return nil
}

// Aggregation 返回当前帧汇集的只读借用，切片有效至下一次汇集或清空。
func (f *Frame) Aggregation() Aggregation { return f.aggregation }

// ClearAggregation 在同帧候选切换位置清空原汇集，不清除数值结算。
func (f *Frame) ClearAggregation() { f.aggregation = Aggregation{} }
