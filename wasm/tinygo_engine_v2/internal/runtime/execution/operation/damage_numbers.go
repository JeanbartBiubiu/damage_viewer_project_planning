package operation

import (
	"math"
	"tinygo_engine_v2/internal/base/numeric"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

type CritEvidence = contract.CritEvidence

// DamageNumbers 是普通与复制伤害共用的乘区、抗性和暴击分支数值结算。
// 复制保留原金额、暴击分支及完整冻结防御视图；乘区仍读本笔实际双方。
type DamageNumbers struct {
	RawAmount                float64
	MitigatedAmount          float64
	Crit                     CritEvidence
	Modifiers                []map[string]interface{}
	FailClosed               bool
	ResistanceFactor         float64
	NormalPartPostResistance float64
	CritPartPostResistance   float64
}

// projectCritPartsAfterOutgoing projects a non-negative merged outgoing result back onto
// normal/crit parts proportionally to their pre-outgoing weights.
func projectCritPartsAfterOutgoing(preOutgoingMerged, normalPart, critPart, postOutgoingMerged float64) (float64, float64) {
	if preOutgoingMerged > 0 {
		return postOutgoingMerged * (normalPart / preOutgoingMerged), postOutgoingMerged * (critPart / preOutgoingMerged)
	}
	// Pre-outgoing merged was zero: keep both parts at zero under multiply; if an override
	// created a positive merged amount, assign it entirely to the normal part.
	if postOutgoingMerged == 0 {
		return 0, 0
	}
	return postOutgoingMerged, 0
}

func (f *calculation) matchesBasicDamageChannel(ability planbundle.CompiledAbility) bool {
	basicAttackID, ok := f.executor.plan.RuntimeTypes.BasicAttack.Lookup()
	if !ok {
		return false
	}
	return ability.TypeSet.Contains(basicAttackID)
}

func (f *calculation) matchingDamagePipelineChannels(ability planbundle.CompiledAbility) []string {
	channels := []string{"all_damage"}
	if f.matchesBasicDamageChannel(ability) {
		channels = append(channels, "basic_damage")
	}
	return channels
}

// settleExpectedCrit applies the unified deterministic expected-crit branch pipeline
// before outgoing modifiers / resistance. Only CritEligible damage settles; otherwise
// amount is unchanged. No command-budget cost. No RNG.
func (f *calculation) settleExpectedCrit(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, baseRawAmount float64, targetKey string) (CritEvidence, float64, []map[string]interface{}, *model.EngineError) {
	if !op.CritEligible {
		return CritEvidence{}, baseRawAmount, nil, nil
	}
	var chanceRaw, critDamageRaw float64
	var err *model.EngineError
	if op.HasCritFormula && int(op.CritChanceProgram) < f.executor.formulas.Metadata.Count() && int(op.CritMultiplierProgram) < f.executor.formulas.Metadata.Count() &&
		f.executor.formulas.Metadata.Info(formula.GenericProgramID(op.CritChanceProgram)).Key == op.Path+".critChance" &&
		f.executor.formulas.Metadata.Info(formula.GenericProgramID(op.CritMultiplierProgram)).Key == op.Path+".critMultiplier" &&
		(!op.HasCritMultiplierMin || (!math.IsNaN(op.CritMultiplierMin) && !math.IsInf(op.CritMultiplierMin, 0) && op.CritMultiplierMin >= 0)) {
		chanceRaw, err = f.evalResultFormula(op.CritChanceProgram, ability, targetKey)
		if err == nil {
			critDamageRaw, err = f.evalResultFormula(op.CritMultiplierProgram, ability, targetKey)
		}
	} else {
		return CritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"eligible damage requires compiled critical formulas", op.Path+".critChance", op.Ref,
			f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}
	if err != nil {
		return CritEvidence{}, 0, nil, err
	}
	p, _ := numeric.ClampValue("critical_probability", "source", chanceRaw, numeric.ProbabilityBounds())
	traits := append([]string(nil), op.Types...)
	var modEvidence []map[string]interface{}

	q := p
	q, modEvidence, err = f.applyPipelineDamageModifiers(
		f.input.Source, f.input.Source, targetKey, "crit", "crit_chance_pre_settlement", q, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return CritEvidence{}, 0, nil, err
	}
	q, _ = numeric.ClampValue("critical_probability", "source", q, numeric.ProbabilityBounds())

	mForced := critDamageRaw
	if op.HasCritMultiplierMin && mForced < op.CritMultiplierMin {
		mForced = op.CritMultiplierMin
	}
	mForced, modEvidence, err = f.applyPipelineDamageModifiers(
		f.input.Source, f.input.Source, targetKey, "crit", "crit_multiplier_forced_branch", mForced, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return CritEvidence{}, 0, nil, err
	}
	if op.HasCritMultiplierMin && mForced < op.CritMultiplierMin {
		mForced = op.CritMultiplierMin
	}

	mNatural := critDamageRaw
	if op.HasCritMultiplierMin && mNatural < op.CritMultiplierMin {
		mNatural = op.CritMultiplierMin
	}
	mNatural, modEvidence, err = f.applyPipelineDamageModifiers(
		f.input.Source, f.input.Source, targetKey, "crit", "crit_multiplier_natural_branch", mNatural, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return CritEvidence{}, 0, nil, err
	}
	if op.HasCritMultiplierMin && mNatural < op.CritMultiplierMin {
		mNatural = op.CritMultiplierMin
	}
	if math.IsNaN(mNatural) || math.IsInf(mNatural, 0) || mNatural < 0 || math.IsNaN(mForced) || math.IsInf(mForced, 0) || mForced < 0 {
		return CritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"critical branch multipliers must remain finite and nonnegative", op.Path+".critMultiplier", op.Ref,
			f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}

	naturalWeight := p
	if q < naturalWeight {
		naturalWeight = q
	}
	forcedWeight := q - p
	if forcedWeight < 0 {
		forcedWeight = 0
	}
	normalWeight := 1 - q
	normalPart := baseRawAmount * normalWeight
	critPart := baseRawAmount * (naturalWeight*mNatural + forcedWeight*mForced)
	critAdjusted := normalPart + critPart
	if math.IsNaN(normalPart) || math.IsInf(normalPart, 0) || normalPart < 0 ||
		math.IsNaN(critPart) || math.IsInf(critPart, 0) || critPart < 0 ||
		math.IsNaN(critAdjusted) || math.IsInf(critAdjusted, 0) || critAdjusted < 0 {
		return CritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"critical expected amounts must remain finite and nonnegative", op.Path+".critMultiplier", op.Ref,
			f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}

	// Legacy single multiplier field: prefer natural; when branches equal it matches the old scalar.
	legacyMult := mNatural
	if mForced == mNatural {
		legacyMult = mNatural
	}

	return CritEvidence{
		Present:               true,
		Eligible:              true,
		Policy:                "expected",
		ChanceRaw:             chanceRaw,
		OriginalCritChance:    p,
		ChanceEffective:       q,
		Multiplier:            legacyMult,
		NaturalWeight:         naturalWeight,
		ForcedWeight:          forcedWeight,
		NaturalMultiplier:     mNatural,
		ForcedMultiplier:      mForced,
		BaseRawAmount:         baseRawAmount,
		NormalPart:            normalPart,
		CritPart:              critPart,
		CritAdjustedRawAmount: critAdjusted,
	}, critAdjusted, modEvidence, nil
}

func (f *calculation) resolveDamageNumbers(
	cmd pipeline.Command, op planbundle.CompiledOperation, critEv CritEvidence,
	ability planbundle.CompiledAbility, modifiers []map[string]interface{},
) (DamageNumbers, *model.EngineError) {
	out := DamageNumbers{Crit: critEv, Modifiers: modifiers}
	def, err := evaluation.RequireConfiguredDefense(f.executor.plan.DamageTypeFormulas, *f.executor.formulas, cmd.DamageType, op.Path, evaluation.DefenseIdentity{AbilityRef: f.input.AbilityRef, SchemaHash: f.executor.plan.SchemaHash, RulesHash: f.executor.plan.RulesHash, SessionID: f.executor.sessionID})
	if err != nil {
		return out, err
	}
	traits := append([]string(nil), op.Types...)
	preOutgoingMerged := cmd.Amount
	normalPart, critPart := 0.0, 0.0
	if critEv.Present && critEv.Eligible {
		normalPart, critPart = critEv.NormalPart, critEv.CritPart
	}
	cmd.Amount, out.Modifiers, err = f.applyPipelineDamageModifiers(
		cmd.Source, cmd.Source, cmd.Target, "damage", "outgoing_pre_mitigation", cmd.Amount,
		ability, cmd.DamageType, traits, out.Modifiers)
	if err != nil {
		return out, err
	}
	if critEv.Present && critEv.Eligible {
		normalPart, critPart = projectCritPartsAfterOutgoing(preOutgoingMerged, normalPart, critPart, cmd.Amount)
		out.Crit.NormalPart, out.Crit.CritPart = normalPart, critPart
	}
	out.RawAmount = cmd.Amount
	if math.IsNaN(cmd.Amount) || math.IsInf(cmd.Amount, 0) || cmd.Amount < 0 {
		out.FailClosed = true
		return out, nil
	}

	mitigatedNormal, mitigatedCrit := 0.0, 0.0
	workingNormal, workingCrit, capped, records, capErr := f.incomingCappedFlat(cmd, ability, critEv, preOutgoingMerged, out.RawAmount, out.Modifiers)
	if capErr != nil {
		return out, capErr
	}
	out.Modifiers = records
	if capped {
		cmd.Amount = workingNormal + workingCrit
	}
	mitigation, err := f.resolveConfiguredDefense(cmd, def)
	if err != nil {
		return out, err
	}
	out.ResistanceFactor = mitigation.Factor
	mitigatedNormal = mitigation.Amount
	if capped {
		mitigatedNormal = workingNormal * mitigation.Factor
		mitigatedCrit = workingCrit * mitigation.Factor
	} else if critEv.Present && critEv.Eligible {
		mitigatedNormal = normalPart * mitigation.Factor
		mitigatedCrit = critPart * mitigation.Factor
	}
	out.NormalPartPostResistance, out.CritPartPostResistance = mitigatedNormal, mitigatedCrit
	if critEv.Present && critEv.Eligible {
		mitigatedCrit, out.Modifiers, err = f.applyPipelineDamageModifiers(
			cmd.Target, cmd.Source, cmd.Target, "damage", "incoming_crit_part_post_mitigation",
			mitigatedCrit, ability, cmd.DamageType, traits, out.Modifiers)
		if err != nil {
			return out, err
		}
	}
	out.MitigatedAmount = mitigatedNormal + mitigatedCrit
	out.MitigatedAmount, out.Modifiers, err = f.applyPipelineDamageModifiers(
		cmd.Target, cmd.Source, cmd.Target, "damage", "incoming_post_mitigation",
		out.MitigatedAmount, ability, cmd.DamageType, traits, out.Modifiers)
	if err != nil {
		return out, err
	}
	if math.IsNaN(out.MitigatedAmount) || math.IsInf(out.MitigatedAmount, 0) || out.MitigatedAmount < 0 {
		out.FailClosed = true
	}
	return out, nil
}
