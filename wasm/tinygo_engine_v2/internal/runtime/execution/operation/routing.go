package operation

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// Preparation 提供预算、原读取准备、目标身份和有限的其他功能交接。
type Preparation interface {
	// NumericFailure 返回此前阶段已记录的本帧错误，不触发新的准备。
	NumericFailure() (bool, *model.EngineError)
	// PrepareNumericOperation 在条件通过后按原顺序消费预算并准备当前帧，返回是否已处理。
	PrepareNumericOperation(op *planbundle.CompiledOperation) (bool, *model.EngineError)
	// ResolveNumericTarget 核对既有选择器的真实参与者。
	ResolveNumericTarget(selector string) (string, bool)
	// DispatchSpecializedOperation 同步交给所属功能，当前帧不会因此提交或派发。
	DispatchSpecializedOperation(ability planbundle.CompiledAbility, op *planbundle.CompiledOperation, target string, amount float64) *model.EngineError
	// CollectNumericDamage 在暴击之后、出伤修正之前冻结合格复制输入。
	CollectNumericDamage(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64, target string, crit CritEvidence) *model.EngineError
}

// Execute 依原顺序判断条件并执行操作；失败保留此前暂存和原部分发布边界。
func (s *Executor) Execute(state *Frame, input Input, reads NumericReads, damageReads DamageReads, boundary NumericBoundary, recording NumericRecording, preparation Preparation, ability planbundle.CompiledAbility, ops []planbundle.CompiledOperation) *model.EngineError {
	f := calculation{executor: s, state: state, input: input, reads: reads, damageReads: damageReads, boundary: boundary, recording: recording, preparation: preparation}
	for index := range ops {
		op := &ops[index]
		if failed, err := preparation.NumericFailure(); failed {
			return err
		}
		if op.HasCondition {
			value, err := f.evalAmount(op.ConditionProgram, ability)
			if err != nil {
				return err
			}
			if value == 0 {
				continue
			}
		}
		if err := f.executeOperation(ability, op); err != nil {
			return err
		}
	}
	return nil
}

// ExecuteOne 执行已由调用者准备条件的单个操作，复用相同预算和路由。
func (s *Executor) ExecuteOne(state *Frame, input Input, reads NumericReads, damageReads DamageReads, boundary NumericBoundary, recording NumericRecording, preparation Preparation, ability planbundle.CompiledAbility, op *planbundle.CompiledOperation) *model.EngineError {
	f := calculation{executor: s, state: state, input: input, reads: reads, damageReads: damageReads, boundary: boundary, recording: recording, preparation: preparation}
	return f.executeOperation(ability, op)
}
func (f *calculation) executeOperation(ability planbundle.CompiledAbility, op *planbundle.CompiledOperation) *model.EngineError {
	if done, err := f.preparation.PrepareNumericOperation(op); err != nil || done {
		return err
	}
	if op.Operation == model.OperationKindRepeat {
		return f.preparation.DispatchSpecializedOperation(ability, op, "", 0)
	}
	target, ok := f.preparation.ResolveNumericTarget(op.Target)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}
	switch op.Operation {
	case model.OperationKindExecuteThreshold:
		return f.applyExecuteThreshold(*op, target, ability)
	case "damage", "heal", "shield":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, op.Operation+" requires amount", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		if op.Operation == "shield" {
			amount, err = f.applyReceivedShieldModifiers(target, amount, ability)
			if err != nil {
				return err
			}
			return f.preparation.DispatchSpecializedOperation(ability, op, target, amount)
		}
		if op.Operation == "heal" {
			return f.preparation.DispatchSpecializedOperation(ability, op, target, amount)
		}
		crit, amount, mods, err := f.settleExpectedCrit(*op, ability, amount, target)
		if err != nil {
			return err
		}
		if err := f.preparation.CollectNumericDamage(*op, ability, amount, target, crit); err != nil {
			return err
		}
		return f.applyDamageCommand(pipeline.Command{Kind: pipeline.KindDamage, Source: f.input.Source, Target: target, Amount: amount, DamageType: op.DamageType, Ref: op.AttributeKey}, *op, crit, ability, mods)
	case "resource_change", "attribute_change":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, op.Operation+" requires amount", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
		}
		if op.Operation == "attribute_change" && op.AttributeKey == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "attribute_change requires attributeKey", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		if op.Operation == "resource_change" {
			return f.preparation.DispatchSpecializedOperation(ability, op, target, amount)
		}
		return f.applyAttributeChange(target, op.AttributeKey, op.ValuePolicy, amount, ability)
	default:
		return f.preparation.DispatchSpecializedOperation(ability, op, target, 0)
	}
}
func (f *calculation) evalAmount(id formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	ctx, contextErr := f.evalContext(ability)
	if contextErr != nil {
		return 0, contextErr
	}
	f.attachLinkedFacts(&ctx, ability, id)
	value, err := f.executor.formulas.Evaluation.EvalContext(id, &ctx)
	if err != nil {
		out := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
		if f.input.SkillHitOccurrenceID != 0 && int(id) < f.executor.formulas.Metadata.Count() {
			out.Path = f.executor.formulas.Metadata.Info(formula.GenericProgramID(id)).Key
			out.Ref = f.input.AbilityRef
		}
		if strings.HasPrefix(err.Error(), "event.skill_hit.") {
			out.Path = err.Error()
			out.Ref = f.input.AbilityRef
		}
		return 0, f.preserveFormulaIssue(err, out)
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite formula result", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}
	return value, nil
}
