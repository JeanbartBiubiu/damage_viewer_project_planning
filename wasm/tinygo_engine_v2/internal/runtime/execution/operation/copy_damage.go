package operation

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

// ApplyCopyDamage 用冻结暴击和防御入口结算当前盾血、原逐伤证据及吸血，不产生普通伤害事件。
func (s *Executor) ApplyCopyDamage(state *Frame, input Input, reads NumericReads, boundary NumericBoundary, recording NumericRecording, cmd pipeline.Command, op planbundle.CompiledOperation, crit CritEvidence, ability planbundle.CompiledAbility, repeatTag string) *model.EngineError {
	f := calculation{executor: s, state: state, input: input, reads: reads, boundary: boundary, recording: recording}
	return f.applyCopyDamage(cmd, op, crit, ability, repeatTag)
}
func (f *calculation) applyCopyDamage(cmd pipeline.Command, op planbundle.CompiledOperation, crit CritEvidence, ability planbundle.CompiledAbility, repeatTag string) *model.EngineError {
	targetStage := f.stageFor(cmd.Target)
	viewAttributes, viewShields := targetStage.attributesView(), targetStage.Instances.Shields()
	// 暴击分支已冻结在 dmg.crit；本笔 modifiers 只登记重新执行的伤害修正。
	numbers, err := f.resolveDamageNumbers(cmd, op, crit, ability, nil)
	if err != nil {
		return err
	}
	var replayedFrom map[string]interface{}
	if f.executor.detailed {
		replayedFrom = stableDamageReplayedFrom(f.input.ProviderRef, f.input.AbilityRef, op.Ref)
	}
	if numbers.FailClosed {
		f.recordGenericDamageEvidence(contract.DamageFact{
			Source: cmd.Source, Target: cmd.Target, DamageType: cmd.DamageType,
			RawAmount: numbers.RawAmount, MitigatedAmount: 0,
			ProviderRef: f.input.ProviderRef, AbilityRef: f.input.AbilityRef, OperationRef: op.Ref, OperationPath: op.Path,
			Phantom: true, RepeatTag: repeatTag,
			ReplayedFrom: replayedFrom,
			Crit:         numbers.Crit, Modifiers: numbers.Modifiers, Traits: op.Types,
		})
		return nil
	}
	targetHPBefore := attribute.ReadHP(viewAttributes)
	outcome, nextAttributes, nextShields := viewShields.ApplyDamage(numbers.RawAmount, numbers.MitigatedAmount, viewAttributes, f.input.TimeMs, false)
	sourceHealthBefore, sourceHasHealth := f.stageFor(cmd.Source).attributesView().Lookup("hp")
	result := pipeline.CommandResult{Kind: cmd.Kind, Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0, Amount: outcome.MitigatedAmount}
	damageID := f.nextDamageID()

	targetStage.setAttributes(nextAttributes)
	targetStage.Instances.SetShields(nextShields)
	if err := f.settleDepletedShieldAttributes(); err != nil {
		return err
	}
	f.reResolveStagedAttributesTwoPass(ability)
	f.state.AddTotals(result.Amount, 0)
	f.state.AddHistory(contract.DamageHistory{TimeMs: f.input.TimeMs, SourceKey: cmd.Source, TargetKey: cmd.Target, Amount: result.Amount})
	damageRecordIndex := len(f.state.Facts().Damages)
	f.recordGenericDamageEvidence(contract.DamageFact{
		Source:                    cmd.Source,
		Target:                    cmd.Target,
		DamageType:                cmd.DamageType,
		RawAmount:                 numbers.RawAmount,
		MitigatedAmount:           result.Amount,
		ProviderRef:               f.input.ProviderRef,
		AbilityRef:                f.input.AbilityRef,
		OperationRef:              op.Ref,
		OperationPath:             op.Path,
		HpBefore:                  targetHPBefore,
		HpAfter:                   attribute.ReadHP(nextAttributes),
		HasSourceHp:               sourceHasHealth,
		SourceHpBefore:            sourceHealthBefore.Current,
		Phantom:                   true,
		RepeatTag:                 repeatTag,
		ReplayedFrom:              replayedFrom,
		Crit:                      numbers.Crit,
		Modifiers:                 numbers.Modifiers,
		Traits:                    op.Types,
		CastInstanceID:            f.input.CastInstanceID,
		CastOrigin:                f.input.CastOrigin,
		DamageID:                  damageID,
		Outcome:                   &outcome,
		HasPostResistanceEvidence: true,
		ResistanceFactor:          numbers.ResistanceFactor,
		NormalPartPostResistance:  numbers.NormalPartPostResistance,
		CritPartPostResistance:    numbers.CritPartPostResistance,
	})
	if err := f.settleDamageVamp(cmd, op, ability, outcome, targetHPBefore, damageID, true); err != nil {
		return err
	}
	f.state.CompleteDamageSource(damageRecordIndex, f.stageFor(cmd.Source).attributesView().At("hp").Current)

	return nil
}
func stableDamageReplayedFrom(providerRef, abilityRef, operationRef string) map[string]interface{} {
	from := map[string]interface{}{}
	if providerRef != "" {
		from["providerRef"] = providerRef
	}
	if abilityRef != "" {
		from["abilityRef"] = abilityRef
	}
	if operationRef != "" {
		from["operationRef"] = operationRef
	}
	return from
}
