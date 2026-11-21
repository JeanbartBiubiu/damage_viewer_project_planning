package operation

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

// applyDamageCommand 走实际结算，并用同一结果写入 summary 与 damage evidence。
// Ordering: expected crit (already applied to cmd.Amount) → outgoing_pre_mitigation
// (once on merged, then proportional part projection) → one resistance factor on both
// parts → incoming_crit_part_post_mitigation (crit part only) → merge →
// incoming_post_mitigation → shields/HP.
func (f *calculation) applyDamageCommand(cmd pipeline.Command, op planbundle.CompiledOperation, critEv CritEvidence, ability planbundle.CompiledAbility, modEvidence []map[string]interface{}) *model.EngineError {
	operationRef := op.Ref
	sourceHealthBefore, sourceHasHealth := f.stageFor(cmd.Source).attributesView().Lookup("hp")
	traits := append([]string(nil), op.Types...)
	baseRawAmount := cmd.Amount
	if critEv.Present {
		baseRawAmount = critEv.BaseRawAmount
	}
	sc := f.stageFor(cmd.Target)
	viewAttributes, viewShields := sc.attributesView(), sc.Instances.Shields()

	numbers, err := f.resolveDamageNumbers(cmd, op, critEv, ability, modEvidence)
	if err != nil {
		return err
	}
	cmd.Amount, critEv, modEvidence = numbers.RawAmount, numbers.Crit, numbers.Modifiers
	rawForEvidence := numbers.RawAmount
	if numbers.FailClosed {
		result := pipeline.CommandResult{Kind: cmd.Kind, Applied: false, Amount: 0}
		f.applyDamageResult(cmd, result, sc)
		f.recordGenericDamageEvidence(contract.DamageFact{
			Source: cmd.Source, Target: cmd.Target, DamageType: cmd.DamageType,
			RawAmount: rawForEvidence, MitigatedAmount: 0,
			ProviderRef: f.input.ProviderRef, AbilityRef: f.input.AbilityRef,
			OperationRef: operationRef, OperationPath: op.Path, Phantom: false, Crit: critEv,
			Modifiers: modEvidence, Traits: traits,
		})
		return nil
	}
	mitigated := numbers.MitigatedAmount
	var beforeState []contract.DamageStateBefore
	if f.executor.plan.Features.Has(planbundle.FeatureDamageStateBefore) {
		var captureErr *model.EngineError
		beforeState, captureErr = f.captureDamageStateBefore(cmd.Source, cmd.Target)
		if captureErr != nil {
			return captureErr
		}
	}
	targetHPBefore := attribute.ReadHP(viewAttributes)
	outcome, nextAttributes, nextShields := viewShields.ApplyDamage(rawForEvidence, mitigated, viewAttributes, f.input.TimeMs, f.executor.plan.Features.Has(planbundle.FeatureReceivedShieldReads))
	if f.executor.plan.Features.Has(planbundle.FeatureReceivedShieldReads) {
		if err := f.bindReceivedShieldAbsorptions(outcome.ShieldAbsorptions, cmd.Target, outcome.ShieldAbsorbed); err != nil {
			return err
		}
	}
	killed := float64(0)
	if targetHPBefore > 0 && attribute.ReadHP(nextAttributes) <= 0 {
		killed = 1
	}
	f.recordOperationOutput(op, outcome)
	damageID := f.nextDamageID()
	if f.executor.plan.Features.Has(planbundle.FeatureDamageStateBefore) {
		f.recordDamageStateBefore(beforeState, damageID, cmd.Target)
	}
	result := pipeline.CommandResult{
		Kind:    cmd.Kind,
		Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0,
		Amount:  outcome.MitigatedAmount,
	}

	sc.setAttributes(nextAttributes)
	sc.Instances.SetShields(nextShields)
	f.applyDamageResult(cmd, result, sc)
	if err := f.settleDepletedShieldAttributes(); err != nil {
		return err
	}
	f.reResolveStagedAttributesTwoPass(ability)
	damageRecordIndex := len(f.state.damages)
	f.recordGenericDamageEvidence(contract.DamageFact{
		Source:                    cmd.Source,
		Target:                    cmd.Target,
		DamageType:                cmd.DamageType,
		RawAmount:                 rawForEvidence,
		MitigatedAmount:           result.Amount,
		ProviderRef:               f.input.ProviderRef,
		AbilityRef:                f.input.AbilityRef,
		OperationRef:              operationRef,
		OperationPath:             op.Path,
		HpBefore:                  targetHPBefore,
		HpAfter:                   attribute.ReadHP(nextAttributes),
		HasSourceHp:               sourceHasHealth,
		SourceHpBefore:            sourceHealthBefore.Current,
		Phantom:                   false,
		Crit:                      critEv,
		Modifiers:                 modEvidence,
		Traits:                    traits,
		CastInstanceID:            f.input.CastInstanceID,
		CastOrigin:                f.input.CastOrigin,
		HasPostResistanceEvidence: true,
		ResistanceFactor:          numbers.ResistanceFactor,
		NormalPartPostResistance:  numbers.NormalPartPostResistance,
		CritPartPostResistance:    numbers.CritPartPostResistance,
		DamageID:                  damageID,
		Outcome:                   &outcome,
	})
	if err := f.settleDamageVamp(cmd, op, ability, outcome, targetHPBefore, damageID, false); err != nil {
		return err
	}
	f.state.CompleteDamageSource(damageRecordIndex, f.stageFor(cmd.Source).attributesView().At("hp").Current)
	return f.boundary.FinishNumericDamage(DamageApplied{Command: cmd, Operation: op, Ability: ability, Crit: critEv, BaseRaw: baseRawAmount, Raw: rawForEvidence, Killed: killed, Outcome: outcome, Before: beforeState, DamageID: damageID, Result: result})
}
