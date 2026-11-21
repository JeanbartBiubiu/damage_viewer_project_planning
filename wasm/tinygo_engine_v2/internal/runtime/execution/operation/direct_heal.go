package operation

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// Recovery 只交接普通监听恢复资格及恢复记录的来源事实。
type Recovery interface {
	// NumericRecoveryRecipient 在实际恢复前核对所属监听者与当前生命。
	NumericRecoveryRecipient(target string, op planbundle.CompiledOperation) (bool, *model.EngineError)
	// RecordNumericHealing 补足真实使用及因果身份，并在原位置登记记录。
	RecordNumericHealing(record model.DirectHealingRecord, op planbundle.CompiledOperation, heal HealingOutcome)
}

// DirectHeal 执行真实直接治疗；资格、付款前后视图及记录时点保持原顺序。
func (s *Executor) DirectHeal(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, recording NumericRecording, recovery Recovery, cmd pipeline.Command, op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	f := calculation{executor: s, state: state, input: input, reads: reads, boundary: boundary, recording: recording}
	if skip, err := recovery.NumericRecoveryRecipient(cmd.Target, op); err != nil || skip {
		return err
	}
	hpBefore := f.stageFor(cmd.Target).attributesView().At("hp").Current
	ctx, err := f.evalContext(ability)
	if err != nil {
		return err
	}
	heal, err := f.settleHealing(cmd.Source, cmd.Target, cmd.Amount, model.HealDirect, ability, ctx)
	if err != nil {
		return err
	}
	record := model.DirectHealingRecord{TimeMs: f.input.TimeMs, Source: cmd.Source, Target: cmd.Target, AbilityRef: f.input.AbilityRef, OperationRef: cmd.Ref, RawAmount: heal.Before, HealingAfterDone: heal.AfterDone, HealingAfterModifiers: heal.After, ActualHealing: heal.Actual, Overheal: heal.Overheal, HpBefore: hpBefore, HpAfter: f.stageFor(cmd.Target).attributesView().At("hp").Current}
	recovery.RecordNumericHealing(record, op, heal)
	return nil
}
