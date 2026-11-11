package operation

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

type HealingOutcome struct {
	Before, AfterDone, After, Actual, Overheal float64
	Modifiers                                  []map[string]interface{}
}

func (f *calculation) vampError(message, path, ref string) *model.EngineError {
	err := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	err.Path, err.Ref = path, ref
	return err
}

// settleDamageVamp 是普通与复制伤害共同的末尾步骤；调用点在扣血后、派生事件前。
func (f *calculation) settleDamageVamp(cmd pipeline.Command, op planbundle.CompiledOperation, ability planbundle.CompiledAbility, outcome pipeline.DamageOutcome, targetHPBefore float64, damageID uint64, phantom bool) *model.EngineError {
	if len(f.executor.plan.VampRules) == 0 {
		return nil
	}
	detailed := f.executor.detailed
	var contributions []map[string]interface{}
	var data map[string]interface{}
	if detailed {
		contributions = make([]map[string]interface{}, 0, len(f.executor.plan.VampRules))
		data = map[string]interface{}{
			"damageId": damageID, "source": cmd.Source, "target": cmd.Source, "damageTarget": cmd.Target,
			"abilityRef": f.input.AbilityRef, "operationRef": op.Ref, "phantom": phantom,
			"postDefenseDamage": outcome.MitigatedAmount, "shieldAbsorbed": outcome.ShieldAbsorbed,
			"actualHpLoss": outcome.HPDamage, "overkillDamage": math.Max(0, outcome.MitigatedAmount-outcome.ShieldAbsorbed-outcome.HPDamage),
			"contributions": contributions, "healingBeforeModifiers": 0.0, "healingAfterDone": 0.0,
			"healingAfterModifiers": 0.0, "actualHealing": 0.0, "overheal": 0.0,
			"modifiers": []map[string]interface{}{},
		}
		attachCastProvenance(data, f.input.CastInstanceID, f.input.CastOrigin)
	}
	skip := ""
	switch {
	case cmd.Source == cmd.Target:
		skip = "self_damage"
	case targetHPBefore <= 0:
		skip = "target_was_dead"
	case attribute.ReadHP(f.stageFor(cmd.Source).attributesView()) <= 0:
		skip = "source_dead"
	case outcome.HPDamage <= 0 && outcome.ShieldAbsorbed <= 0:
		skip = "no_damage_applied"
	}
	if skip != "" {
		if detailed {
			data["skippedReason"] = skip
		}
		f.recordVamp(op.Ref, data)
		return nil
	}
	ctx := f.evalContext(ability)
	ctx.StrictReads = true
	ctx.HasDamageContext = true
	ctx.HasDamageParticipants = true
	ctx.DamageSelf = cmd.Source == cmd.Target
	ctx.DamageAmount = outcome.MitigatedAmount
	ctx.DamageTypeKey = cmd.DamageType
	ctx.DamageTraits = formula.BorrowStringView(op.Types)
	ctx.DamageAbilityTypes = formula.BorrowStringView(f.abilityTypeKeys(ability))
	ctx.DamageCastOrigin = f.input.CastOrigin
	targetTypes := f.combatantTypeSet(cmd.Target)
	damageTypes := f.eventTypeSet(op.Types)
	total := 0.0
	qualifyingRules := 0
	for _, rule := range f.executor.plan.VampRules {
		if !rule.TargetMatcher.Match(targetTypes) {
			continue
		}
		var override *planbundle.CompiledVampOverride
		for i := range op.VampOverrides {
			if op.VampOverrides[i].VampType == rule.VampType {
				override = &op.VampOverrides[i]
				break
			}
		}
		if override != nil && override.Mode == model.VampDisabled {
			continue
		}
		if override == nil && (!rule.AbilityMatcher.Match(ability.TypeSet) || !rule.DamageMatcher.Match(damageTypes)) {
			continue
		}
		basisKind, efficiency := rule.BasisOutputKind, rule.DefaultEfficiency
		if override != nil {
			basisKind = override.BasisOutputKind
			var err error
			efficiency, err = f.executor.formulas.Evaluation.EvalContext(override.EfficiencyProgram, &ctx)
			if err != nil {
				return f.preserveFormulaIssue(err, f.vampError(err.Error(), override.Path, op.Ref))
			}
			if math.IsNaN(efficiency) || math.IsInf(efficiency, 0) || efficiency < 0 {
				return f.vampError("vamp efficiency must be finite and non-negative", override.Path, op.Ref)
			}
		}
		slot, exists := f.stageFor(cmd.Source).attributesView().Lookup(rule.SourceAttributeKey)
		if !exists {
			return f.vampError("missing vamp source attribute: "+rule.SourceAttributeKey, "combatants["+cmd.Source+"].attributes."+rule.SourceAttributeKey, op.Ref)
		}
		ratio := slot.Resolved
		if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 {
			return f.vampError("vamp source ratio must be finite and non-negative", "combatants["+cmd.Source+"].attributes."+rule.SourceAttributeKey+".resolved", op.Ref)
		}
		basis := outcome.MitigatedAmount
		if basisKind == model.VampActualHPLoss {
			basis = outcome.HPDamage
		}
		amount := basis * ratio * efficiency
		if math.IsNaN(amount) || math.IsInf(amount, 0) || math.IsInf(total+amount, 0) {
			return f.vampError("non-finite vamp contribution", "vamp.contributions", op.Ref)
		}
		total += amount
		qualifyingRules++
		if detailed {
			contributions = append(contributions, map[string]interface{}{"vampType": rule.VampType, "basisOutputKind": basisKind, "basis": basis, "ratio": ratio, "efficiency": efficiency, "amount": amount})
		}
	}
	if detailed {
		data["contributions"] = contributions
	}
	if qualifyingRules == 0 {
		if detailed {
			data["skippedReason"] = "no_qualifying_rule"
		}
		f.recordVamp(op.Ref, data)
		return nil
	}
	heal, err := f.settleHealing(cmd.Source, cmd.Source, total, model.HealVamp, ability, ctx)
	if err != nil {
		return err
	}
	if detailed {
		data["healingBeforeModifiers"], data["healingAfterDone"], data["healingAfterModifiers"] = heal.Before, heal.AfterDone, heal.After
		data["actualHealing"], data["overheal"], data["modifiers"] = heal.Actual, heal.Overheal, heal.Modifiers
	}
	f.recordVamp(op.Ref, data)
	return nil
}

func (f *calculation) recordVamp(ref string, data map[string]interface{}) {
	var item model.EvidenceItem
	if f.executor.detailed {
		item = model.EvidenceItem{TimeMs: f.input.TimeMs, Kind: model.EvidenceKindVamp, Ref: ref, Data: data}
	}
	f.recording.RecordNumericEvidence(model.EvidenceKindVamp, item)
}

func (f *calculation) combatantTypeSet(key string) typeset.TypeSet {
	for _, c := range f.executor.plan.Combatants {
		if c.Key == key {
			return c.TypeSet
		}
	}
	return typeset.TypeSet{}
}

// settleHealing 先计算所有修正，再经过既有生命管道一次性治疗；不派发伤害事件。
func (f *calculation) settleHealing(sourceKey, targetKey string, amount float64, category string, ability planbundle.CompiledAbility, baseCtx formula.GenericEvalContext) (HealingOutcome, *model.EngineError) {
	out := HealingOutcome{Before: amount, Modifiers: []map[string]interface{}{}}
	ctx := baseCtx
	ctx.StrictReads = true
	// 两方向公式求值完成前没有属性写；治疗提交仍走写时复制。
	ctx.SourceAttrs = f.stageFor(sourceKey).attributesView()
	ctx.TargetAttrs = f.stageFor(targetKey).attributesView()
	ctx.SourceResources = f.stageFor(sourceKey).resourceView()
	ctx.TargetResources = f.stageFor(targetKey).resourceView()
	var err *model.EngineError
	out.AfterDone, out.Modifiers, err = f.applyHealingDirection(sourceKey, model.HealDone, category, amount, ctx, out.Modifiers)
	if err != nil {
		return out, err
	}
	out.After, out.Modifiers, err = f.applyHealingDirection(targetKey, model.HealReceived, category, out.AfterDone, ctx, out.Modifiers)
	if err != nil {
		return out, err
	}
	out.After = math.Max(0, out.After)
	if math.IsNaN(out.After) || math.IsInf(out.After, 0) {
		return out, f.vampError("non-finite healing result", "heal", f.input.AbilityRef)
	}
	cmd := pipeline.Command{Kind: pipeline.KindHeal, Source: sourceKey, Target: targetKey, Amount: out.After}
	sc := f.stageFor(targetKey)
	result, nextAttributes, nextShields := sc.Instances.Shields().ResolveCommand(cmd, sc.attributesView(), f.input.TimeMs)
	sc.setAttributes(nextAttributes)
	sc.Instances.SetShields(nextShields)
	out.Actual = result.Amount
	out.Overheal = math.Max(0, out.After-out.Actual)
	f.state.AddTotals(0, out.Actual)
	f.recordOverheal(sourceKey, out.Overheal)
	f.reResolveStagedAttributesTwoPass(ability)
	return out, nil
}

func (f *calculation) applyHealingDirection(hostKey, direction, category string, amount float64, baseCtx formula.GenericEvalContext, evidence []map[string]interface{}) (float64, []map[string]interface{}, *model.EngineError) {
	mods := f.stageFor(hostKey).Instances.Damage().CollectForHeal(direction, category)
	type group struct {
		key      string
		mode     string
		ratio    float64
		items    []map[string]interface{}
		hasValue bool
	}
	groups := make([]group, 0)
	index := map[string]int{}
	providerCtxFn := f.providerFormulaContextFunc(hostKey)
	for _, mod := range mods {
		ctx := baseCtx
		if providerCtxFn != nil {
			pctx := providerCtxFn(mod.OwnerCombatantKey, mod.ProviderRef)
			ctx.HasProviderContext, ctx.ProviderState, ctx.ProviderTargetState = pctx.HasProviderContext, pctx.ProviderState, pctx.ProviderTargetState
		}
		if mod.HasCondition {
			value, err := f.executor.formulas.Evaluation.EvalContext(mod.ConditionProg, &ctx)
			if err != nil {
				return 0, evidence, f.preserveFormulaIssue(err, f.vampError(err.Error(), "heal.modifiers["+mod.ModifierKey+"].condition", mod.ModifierKey))
			}
			if value == 0 {
				continue
			}
		}
		value, err := f.executor.formulas.Evaluation.EvalContext(mod.ValueProgram, &ctx)
		if err != nil {
			return 0, evidence, f.preserveFormulaIssue(err, f.vampError(err.Error(), "heal.modifiers["+mod.ModifierKey+"].value", mod.ModifierKey))
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, evidence, f.vampError("non-finite healing modifier", "heal.modifiers["+mod.ModifierKey+"]", mod.ModifierKey)
		}
		i, ok := index[mod.HealGroupKey]
		if !ok {
			i = len(groups)
			index[mod.HealGroupKey] = i
			groups = append(groups, group{key: mod.HealGroupKey, mode: model.NormalizeHealGroupMode(mod.HealGroupCalculationMode), items: []map[string]interface{}{}})
		}
		if groups[i].mode == model.HealGroupRatioMax {
			if value < -1 || value > 0 {
				return 0, evidence, f.vampError("ratio_max healing modifier must be within [-1,0]", "heal.modifiers["+mod.ModifierKey+"].value", mod.ModifierKey)
			}
			if !groups[i].hasValue || value < groups[i].ratio {
				groups[i].ratio = value
			}
		} else {
			groups[i].ratio += value
			if math.IsInf(groups[i].ratio, 0) || math.IsNaN(groups[i].ratio) {
				return 0, evidence, f.vampError("non-finite healing group ratio", "heal.modifiers", mod.ModifierKey)
			}
		}
		groups[i].hasValue = true
		if f.executor.detailed {
			groups[i].items = append(groups[i].items, map[string]interface{}{"modifierKey": mod.ModifierKey, "providerOwner": mod.OwnerCombatantKey, "providerRef": mod.ProviderRef, "value": value, "calculationMode": groups[i].mode})
		}
	}
	for _, g := range groups {
		before := amount
		factor := math.Max(0, 1+g.ratio)
		amount *= factor
		if math.IsNaN(amount) || math.IsInf(amount, 0) {
			return 0, evidence, f.vampError("non-finite healing modifier result", "heal.modifiers", g.key)
		}
		if f.executor.detailed {
			evidence = append(evidence, map[string]interface{}{"direction": direction, "groupKey": g.key, "calculationMode": g.mode, "netRatio": g.ratio, "factor": factor, "before": before, "after": amount, "items": g.items})
		}
	}
	return amount, evidence, nil
}
