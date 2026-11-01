package execution

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/numeric"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

// frozenCritEvidence 冻结真实命中时的 expected crit 证据；phantom 原样回放，不重读属性。
// chanceEffective 是 q（修饰后有效暴击率）；originalCritChance 是 p（属性 clamp 后、修饰前）。
// normalPart/critPart 在 outgoing 投影后、抗性前更新；critAdjustedRawAmount 保持 pre-outgoing 合并量。
type frozenCritEvidence struct {
	present               bool
	eligible              bool
	policy                string
	chanceRaw             float64
	originalCritChance    float64
	chanceEffective       float64
	multiplier            float64
	naturalWeight         float64
	forcedWeight          float64
	naturalMultiplier     float64
	forcedMultiplier      float64
	baseRawAmount         float64
	normalPart            float64
	critPart              float64
	critAdjustedRawAmount float64
}

// damageNumbers 是普通与复制伤害共用的乘区、抗性和暴击分支数值结算。
// 复制保留原金额、暴击分支及完整冻结防御视图；乘区仍读本笔实际双方。
type damageNumbers struct {
	rawAmount                float64
	mitigatedAmount          float64
	crit                     frozenCritEvidence
	modifiers                []map[string]interface{}
	failClosed               bool
	resistanceFactor         float64
	normalPartPostResistance float64
	critPartPostResistance   float64
}

// applyDamageCommand 走实际结算，并用同一结果写入 summary 与 damage evidence。
// Ordering: expected crit (already applied to cmd.Amount) → outgoing_pre_mitigation
// (once on merged, then proportional part projection) → one resistance factor on both
// parts → incoming_crit_part_post_mitigation (crit part only) → merge →
// incoming_post_mitigation → shields/HP.
func (f *Frame) applyDamageCommand(cmd pipeline.Command, op planbundle.CompiledOperation, critEv frozenCritEvidence, ability planbundle.CompiledAbility, modEvidence []map[string]interface{}) *model.EngineError {
	operationRef := op.Ref
	sourceHealthBefore, sourceHasHealth := f.stageFor(cmd.Source).attributesView().Lookup("hp")
	traits := append([]string(nil), op.Types...)
	baseRawAmount := cmd.Amount
	if critEv.present {
		baseRawAmount = critEv.baseRawAmount
	}
	sc := f.stageFor(cmd.Target)
	viewAttributes, viewShields := sc.attributesView(), sc.instances.Shields()

	numbers, err := f.resolveDamageNumbers(cmd, op, critEv, ability, modEvidence)
	if err != nil {
		return err
	}
	cmd.Amount, critEv, modEvidence = numbers.rawAmount, numbers.crit, numbers.modifiers
	rawForEvidence := numbers.rawAmount
	if numbers.failClosed {
		result := pipeline.CommandResult{Kind: cmd.Kind, Applied: false, Amount: 0}
		f.applyDamageResult(cmd, result, sc)
		f.recordGenericDamageEvidence(genericDamageEvidence{
			source: cmd.Source, target: cmd.Target, damageType: cmd.DamageType,
			rawAmount: rawForEvidence, mitigatedAmount: 0,
			providerRef: f.ownerProviderRef, abilityRef: f.abilityRef,
			operationRef: operationRef, operationPath: op.Path, phantom: false, crit: critEv,
			modifiers: modEvidence, traits: traits,
		})
		return nil
	}
	mitigated := numbers.mitigatedAmount
	var beforeState []frozenDamageStateBefore
	if f.run.compiled.HasDamageStateBefore {
		var captureErr *model.EngineError
		beforeState, captureErr = f.captureDamageStateBefore(cmd.Source, cmd.Target)
		if captureErr != nil {
			return captureErr
		}
	}
	targetHPBefore := attribute.ReadHP(viewAttributes)
	outcome, nextAttributes, nextShields := viewShields.ApplyDamage(rawForEvidence, mitigated, viewAttributes, f.run.loop.TimeMs(), f.run.compiled.HasReceivedShieldReads)
	if f.run.compiled.HasReceivedShieldReads {
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
	if f.run.compiled.HasDamageStateBefore {
		f.recordDamageStateBefore(beforeState, damageID, cmd.Target)
	}
	result := pipeline.CommandResult{
		Kind:    cmd.Kind,
		Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0,
		Amount:  outcome.MitigatedAmount,
	}

	sc.setAttributes(nextAttributes)
	sc.instances.SetShields(nextShields)
	f.applyDamageResult(cmd, result, sc)
	if err := f.settleDepletedShieldAttributes(); err != nil {
		return err
	}
	f.reResolveStagedAttributesTwoPass(ability)
	damageRecordIndex := len(f.pendingDamage)
	f.recordGenericDamageEvidence(genericDamageEvidence{
		source:                    cmd.Source,
		target:                    cmd.Target,
		damageType:                cmd.DamageType,
		rawAmount:                 rawForEvidence,
		mitigatedAmount:           result.Amount,
		providerRef:               f.ownerProviderRef,
		abilityRef:                f.abilityRef,
		operationRef:              operationRef,
		operationPath:             op.Path,
		hpBefore:                  targetHPBefore,
		hpAfter:                   attribute.ReadHP(nextAttributes),
		hasSourceHp:               sourceHasHealth,
		sourceHpBefore:            sourceHealthBefore.Current,
		phantom:                   false,
		crit:                      critEv,
		modifiers:                 modEvidence,
		traits:                    traits,
		castInstanceID:            f.castInstanceID,
		castOrigin:                f.castOrigin,
		hasPostResistanceEvidence: true,
		resistanceFactor:          numbers.resistanceFactor,
		normalPartPostResistance:  numbers.normalPartPostResistance,
		critPartPostResistance:    numbers.critPartPostResistance,
		damageID:                  damageID,
		outcome:                   &outcome,
	})
	if err := f.settleDamageVamp(cmd, op, ability, outcome, targetHPBefore, damageID, false); err != nil {
		return err
	}
	f.pendingDamage[damageRecordIndex].sourceHpAfter = f.stageFor(cmd.Source).attributesView().At("hp").Current
	f.queueDamageTaken(cmd, op, ability, critEv, baseRawAmount, rawForEvidence, outcome, killed, damageID)
	if err := f.recordDamageContribution(cmd, result, operationRef, op.Path); err != nil {
		return err
	}
	f.maybeQueueDamageInstanceEvent(cmd, op, ability, critEv, baseRawAmount, rawForEvidence, result.Amount, killed, beforeState, damageID)
	return nil
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

func (f *Frame) matchesBasicDamageChannel(ability planbundle.CompiledAbility) bool {
	basicAttackID, ok := f.run.compiled.RuntimeTypes.BasicAttack.Lookup()
	if !ok {
		return false
	}
	return ability.TypeSet.Contains(basicAttackID)
}

func (f *Frame) matchingDamagePipelineChannels(ability planbundle.CompiledAbility) []string {
	channels := []string{"all_damage"}
	if f.matchesBasicDamageChannel(ability) {
		channels = append(channels, "basic_damage")
	}
	return channels
}

func (f *Frame) applyDamageResult(cmd pipeline.Command, result pipeline.CommandResult, sc *stagedCombatant) {
	// damageDealt / recordDamage use mitigated amount（抗性后、护盾前），HP clipping 不反向改变 summary。
	f.damageDealt += result.Amount
	f.recordDamage(cmd.Source, cmd.Target, result.Amount)

	sc.setAttributes(syncHPResolved(sc.attributesView()))
}

// settleExpectedCrit applies the unified deterministic expected-crit branch pipeline
// before outgoing modifiers / resistance. Only CritEligible damage settles; otherwise
// amount is unchanged. No command-budget cost. No RNG.
func (f *Frame) settleExpectedCrit(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, baseRawAmount float64, targetKey string) (frozenCritEvidence, float64, []map[string]interface{}, *model.EngineError) {
	if !op.CritEligible {
		return frozenCritEvidence{}, baseRawAmount, nil, nil
	}
	var chanceRaw, critDamageRaw float64
	var err *model.EngineError
	if op.HasCritFormula && int(op.CritChanceProgram) < len(f.run.formulas.Programs) && int(op.CritMultiplierProgram) < len(f.run.formulas.Programs) &&
		f.run.formulas.Programs[op.CritChanceProgram].Key == op.Path+".critChance" &&
		f.run.formulas.Programs[op.CritMultiplierProgram].Key == op.Path+".critMultiplier" &&
		(!op.HasCritMultiplierMin || (!math.IsNaN(op.CritMultiplierMin) && !math.IsInf(op.CritMultiplierMin, 0) && op.CritMultiplierMin >= 0)) {
		chanceRaw, err = f.evalResultFormula(op.CritChanceProgram, ability, targetKey)
		if err == nil {
			critDamageRaw, err = f.evalResultFormula(op.CritMultiplierProgram, ability, targetKey)
		}
	} else {
		return frozenCritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"eligible damage requires compiled critical formulas", op.Path+".critChance", op.Ref,
			f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	p, _ := numeric.ClampValue("critical_probability", "source", chanceRaw, numeric.ProbabilityBounds())
	traits := append([]string(nil), op.Types...)
	var modEvidence []map[string]interface{}

	q := p
	q, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, f.sourceKey, targetKey, "crit", "crit_chance_pre_settlement", q, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	q, _ = numeric.ClampValue("critical_probability", "source", q, numeric.ProbabilityBounds())

	mForced := critDamageRaw
	if op.HasCritMultiplierMin && mForced < op.CritMultiplierMin {
		mForced = op.CritMultiplierMin
	}
	mForced, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, f.sourceKey, targetKey, "crit", "crit_multiplier_forced_branch", mForced, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	if op.HasCritMultiplierMin && mForced < op.CritMultiplierMin {
		mForced = op.CritMultiplierMin
	}

	mNatural := critDamageRaw
	if op.HasCritMultiplierMin && mNatural < op.CritMultiplierMin {
		mNatural = op.CritMultiplierMin
	}
	mNatural, modEvidence, err = f.applyPipelineDamageModifiers(
		f.sourceKey, f.sourceKey, targetKey, "crit", "crit_multiplier_natural_branch", mNatural, ability, op.DamageType, traits, modEvidence)
	if err != nil {
		return frozenCritEvidence{}, 0, nil, err
	}
	if op.HasCritMultiplierMin && mNatural < op.CritMultiplierMin {
		mNatural = op.CritMultiplierMin
	}
	if math.IsNaN(mNatural) || math.IsInf(mNatural, 0) || mNatural < 0 || math.IsNaN(mForced) || math.IsInf(mForced, 0) || mForced < 0 {
		return frozenCritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"critical branch multipliers must remain finite and nonnegative", op.Path+".critMultiplier", op.Ref,
			f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
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
		return frozenCritEvidence{}, 0, nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"critical expected amounts must remain finite and nonnegative", op.Path+".critMultiplier", op.Ref,
			f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}

	// Legacy single multiplier field: prefer natural; when branches equal it matches the old scalar.
	legacyMult := mNatural
	if mForced == mNatural {
		legacyMult = mNatural
	}

	return frozenCritEvidence{
		present:               true,
		eligible:              true,
		policy:                "expected",
		chanceRaw:             chanceRaw,
		originalCritChance:    p,
		chanceEffective:       q,
		multiplier:            legacyMult,
		naturalWeight:         naturalWeight,
		forcedWeight:          forcedWeight,
		naturalMultiplier:     mNatural,
		forcedMultiplier:      mForced,
		baseRawAmount:         baseRawAmount,
		normalPart:            normalPart,
		critPart:              critPart,
		critAdjustedRawAmount: critAdjusted,
	}, critAdjusted, modEvidence, nil
}

// stableDamageReplayedFrom 用 providerRef + ability/listener ref + operationRef 构造稳定 provenance。
// 禁止 slice index、指针地址或随机 ID。
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

func (f *Frame) resolveDamageNumbers(
	cmd pipeline.Command, op planbundle.CompiledOperation, critEv frozenCritEvidence,
	ability planbundle.CompiledAbility, modifiers []map[string]interface{},
) (damageNumbers, *model.EngineError) {
	out := damageNumbers{crit: critEv, modifiers: modifiers}
	def, err := evaluation.RequireConfiguredDefense(f.run.compiled.DamageTypeFormulas, f.run.formulas, cmd.DamageType, op.Path, evaluation.DefenseIdentity{AbilityRef: f.abilityRef, SchemaHash: f.run.compiled.SchemaHash, RulesHash: f.run.compiled.RulesHash, SessionID: f.run.req.SessionID})
	if err != nil {
		return out, err
	}
	traits := append([]string(nil), op.Types...)
	preOutgoingMerged := cmd.Amount
	normalPart, critPart := 0.0, 0.0
	if critEv.present && critEv.eligible {
		normalPart, critPart = critEv.normalPart, critEv.critPart
	}
	cmd.Amount, out.modifiers, err = f.applyPipelineDamageModifiers(
		cmd.Source, cmd.Source, cmd.Target, "damage", "outgoing_pre_mitigation", cmd.Amount,
		ability, cmd.DamageType, traits, out.modifiers)
	if err != nil {
		return out, err
	}
	if critEv.present && critEv.eligible {
		normalPart, critPart = projectCritPartsAfterOutgoing(preOutgoingMerged, normalPart, critPart, cmd.Amount)
		out.crit.normalPart, out.crit.critPart = normalPart, critPart
	}
	out.rawAmount = cmd.Amount
	if math.IsNaN(cmd.Amount) || math.IsInf(cmd.Amount, 0) || cmd.Amount < 0 {
		out.failClosed = true
		return out, nil
	}

	mitigatedNormal, mitigatedCrit := 0.0, 0.0
	workingNormal, workingCrit, capped, records, capErr := f.incomingCappedFlat(cmd, ability, critEv, preOutgoingMerged, out.rawAmount, out.modifiers)
	if capErr != nil {
		return out, capErr
	}
	out.modifiers = records
	if capped {
		cmd.Amount = workingNormal + workingCrit
	}
	mitigation, err := f.resolveConfiguredDefense(cmd, def)
	if err != nil {
		return out, err
	}
	out.resistanceFactor = mitigation.Factor
	mitigatedNormal = mitigation.Amount
	if capped {
		mitigatedNormal = workingNormal * mitigation.Factor
		mitigatedCrit = workingCrit * mitigation.Factor
	} else if critEv.present && critEv.eligible {
		mitigatedNormal = normalPart * mitigation.Factor
		mitigatedCrit = critPart * mitigation.Factor
	}
	out.normalPartPostResistance, out.critPartPostResistance = mitigatedNormal, mitigatedCrit
	if critEv.present && critEv.eligible {
		mitigatedCrit, out.modifiers, err = f.applyPipelineDamageModifiers(
			cmd.Target, cmd.Source, cmd.Target, "damage", "incoming_crit_part_post_mitigation",
			mitigatedCrit, ability, cmd.DamageType, traits, out.modifiers)
		if err != nil {
			return out, err
		}
	}
	out.mitigatedAmount = mitigatedNormal + mitigatedCrit
	out.mitigatedAmount, out.modifiers, err = f.applyPipelineDamageModifiers(
		cmd.Target, cmd.Source, cmd.Target, "damage", "incoming_post_mitigation",
		out.mitigatedAmount, ability, cmd.DamageType, traits, out.modifiers)
	if err != nil {
		return out, err
	}
	if math.IsNaN(out.mitigatedAmount) || math.IsInf(out.mitigatedAmount, 0) || out.mitigatedAmount < 0 {
		out.failClosed = true
	}
	return out, nil
}
