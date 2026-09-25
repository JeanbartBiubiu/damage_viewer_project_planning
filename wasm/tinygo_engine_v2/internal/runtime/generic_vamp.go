package runtime

import (
	"math"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/command"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/typeset"
)

type healingOutcome struct {
	before, afterDone, after, actual, overheal float64
	modifiers                                  []map[string]interface{}
}

func (f *executionFrame) vampError(message, path, ref string) *model.EngineError {
	err := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	err.Path, err.Ref = path, ref
	return err
}

// settleDamageVamp 是普通与复制伤害共同的末尾步骤；调用点在扣血后、派生事件前。
func (f *executionFrame) settleDamageVamp(cmd command.Command, op compilebundle.CompiledOperation, ability compilebundle.CompiledAbility, outcome pipeline.DamageOutcome, targetHPBefore float64, damageID uint64, phantom bool) *model.EngineError {
	if len(f.run.compiled.VampRules) == 0 {
		return nil
	}
	contributions := make([]map[string]interface{}, 0, len(f.run.compiled.VampRules))
	data := map[string]interface{}{
		"damageId": damageID, "source": cmd.Source, "target": cmd.Source, "damageTarget": cmd.Target,
		"abilityRef": f.abilityRef, "operationRef": op.Ref, "phantom": phantom,
		"postDefenseDamage": outcome.MitigatedAmount, "shieldAbsorbed": outcome.ShieldAbsorbed,
		"actualHpLoss": outcome.HPDamage, "overkillDamage": math.Max(0, outcome.MitigatedAmount-outcome.ShieldAbsorbed-outcome.HPDamage),
		"contributions": contributions, "healingBeforeModifiers": 0.0, "healingAfterDone": 0.0,
		"healingAfterModifiers": 0.0, "actualHealing": 0.0, "overheal": 0.0,
		"modifiers": []map[string]interface{}{},
	}
	attachCastProvenance(data, f.castInstanceID, f.castOrigin)
	record := func() {
		f.run.recordEvidence(model.EvidenceItem{TimeMs: f.run.nowMs, Kind: model.EvidenceKindVamp, Ref: op.Ref, Data: data})
	}
	skip := ""
	switch {
	case cmd.Source == cmd.Target:
		skip = "self_damage"
	case targetHPBefore <= 0:
		skip = "target_was_dead"
	case attribute.ReadHP(f.stageFor(cmd.Source).attributes) <= 0:
		skip = "source_dead"
	case outcome.HPDamage <= 0 && outcome.ShieldAbsorbed <= 0:
		skip = "no_damage_applied"
	}
	if skip != "" {
		data["skippedReason"] = skip
		record()
		return nil
	}
	ctx := f.evalContext(ability)
	ctx.StrictReads = true
	ctx.HasDamageContext = true
	ctx.HasDamageParticipants = true
	ctx.DamageSelf = cmd.Source == cmd.Target
	ctx.DamageAmount = outcome.MitigatedAmount
	ctx.DamageTypeKey = cmd.DamageType
	ctx.DamageTraits = op.Types
	ctx.DamageAbilityTypes = f.abilityTypeKeys(ability)
	ctx.DamageCastOrigin = f.castOrigin
	targetTypes := f.combatantTypeSet(cmd.Target)
	damageTypes := f.run.eventTypeSet(op.Types)
	total := 0.0
	for _, rule := range f.run.compiled.VampRules {
		if !rule.TargetMatcher.Match(targetTypes) {
			continue
		}
		var override *compilebundle.CompiledVampOverride
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
			efficiency, err = f.run.compiled.Formulas.Eval(override.EfficiencyProgram, ctx)
			if err != nil {
				return f.vampError(err.Error(), override.Path, op.Ref)
			}
			if math.IsNaN(efficiency) || math.IsInf(efficiency, 0) || efficiency < 0 {
				return f.vampError("vamp efficiency must be finite and non-negative", override.Path, op.Ref)
			}
		}
		slot, exists := f.stageFor(cmd.Source).attributes[rule.SourceAttributeKey]
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
		contributions = append(contributions, map[string]interface{}{"vampType": rule.VampType, "basisOutputKind": basisKind, "basis": basis, "ratio": ratio, "efficiency": efficiency, "amount": amount})
	}
	data["contributions"] = contributions
	if len(contributions) == 0 {
		data["skippedReason"] = "no_qualifying_rule"
		record()
		return nil
	}
	heal, err := f.settleHealing(cmd.Source, cmd.Source, total, model.HealVamp, ability, ctx)
	if err != nil {
		return err
	}
	data["healingBeforeModifiers"], data["healingAfterDone"], data["healingAfterModifiers"] = heal.before, heal.afterDone, heal.after
	data["actualHealing"], data["overheal"], data["modifiers"] = heal.actual, heal.overheal, heal.modifiers
	record()
	return nil
}

func (f *executionFrame) combatantTypeSet(key string) typeset.TypeSet {
	for _, c := range f.run.compiled.Combatants {
		if c.Key == key {
			return c.TypeSet
		}
	}
	return typeset.TypeSet{}
}

// settleHealing 先计算所有修正，再经过既有生命管道一次性治疗；不派发伤害事件。
func (f *executionFrame) settleHealing(sourceKey, targetKey string, amount float64, category string, ability compilebundle.CompiledAbility, baseCtx formula.GenericEvalContext) (healingOutcome, *model.EngineError) {
	out := healingOutcome{before: amount, modifiers: []map[string]interface{}{}}
	ctx := baseCtx
	ctx.StrictReads = true
	ctx.SourceAttrs = cloneAttributeMap(f.stageFor(sourceKey).attributes)
	ctx.TargetAttrs = cloneAttributeMap(f.stageFor(targetKey).attributes)
	ctx.SourceResources = cloneResourceMap(f.stageFor(sourceKey).resources)
	ctx.TargetResources = cloneResourceMap(f.stageFor(targetKey).resources)
	var err *model.EngineError
	out.afterDone, out.modifiers, err = f.applyHealingDirection(sourceKey, model.HealDone, category, amount, ctx, out.modifiers)
	if err != nil {
		return out, err
	}
	out.after, out.modifiers, err = f.applyHealingDirection(targetKey, model.HealReceived, category, out.afterDone, ctx, out.modifiers)
	if err != nil {
		return out, err
	}
	out.after = math.Max(0, out.after)
	if math.IsNaN(out.after) || math.IsInf(out.after, 0) {
		return out, f.vampError("non-finite healing result", "heal", f.abilityRef)
	}
	cmd := command.Command{Kind: command.KindHeal, Source: sourceKey, Target: targetKey, Amount: out.after}
	sc := f.stageFor(targetKey)
	result, next := pipeline.ResolveCommand(cmd, pipeline.CombatantView{Attributes: sc.attributes, Shields: sc.shields}, f.run.nowMs)
	sc.attributes, sc.shields = next.Attributes, next.Shields
	out.actual = result.Amount
	out.overheal = math.Max(0, out.after-out.actual)
	f.healingDone += out.actual
	f.run.recordOverheal(sourceKey, out.overheal)
	f.reResolveStagedAttributesTwoPass(ability)
	return out, nil
}

func (f *executionFrame) applyHealingDirection(hostKey, direction, category string, amount float64, baseCtx formula.GenericEvalContext, evidence []map[string]interface{}) (float64, []map[string]interface{}, *model.EngineError) {
	mods := f.stageFor(hostKey).damageResolver.CollectForHeal(direction, category)
	type group struct {
		key   string
		mode  string
		ratio float64
		items []map[string]interface{}
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
			value, err := f.run.compiled.Formulas.Eval(mod.ConditionProg, ctx)
			if err != nil {
				return 0, evidence, f.vampError(err.Error(), "heal.modifiers["+mod.ModifierKey+"].condition", mod.ModifierKey)
			}
			if value == 0 {
				continue
			}
		}
		value, err := f.run.compiled.Formulas.Eval(mod.ValueProgram, ctx)
		if err != nil {
			return 0, evidence, f.vampError(err.Error(), "heal.modifiers["+mod.ModifierKey+"].value", mod.ModifierKey)
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
			if len(groups[i].items) == 0 || value < groups[i].ratio {
				groups[i].ratio = value
			}
		} else {
			groups[i].ratio += value
			if math.IsInf(groups[i].ratio, 0) || math.IsNaN(groups[i].ratio) {
				return 0, evidence, f.vampError("non-finite healing group ratio", "heal.modifiers", mod.ModifierKey)
			}
		}
		groups[i].items = append(groups[i].items, map[string]interface{}{"modifierKey": mod.ModifierKey, "providerOwner": mod.OwnerCombatantKey, "providerRef": mod.ProviderRef, "value": value, "calculationMode": groups[i].mode})
	}
	for _, g := range groups {
		before := amount
		factor := math.Max(0, 1+g.ratio)
		amount *= factor
		if math.IsNaN(amount) || math.IsInf(amount, 0) {
			return 0, evidence, f.vampError("non-finite healing modifier result", "heal.modifiers", g.key)
		}
		evidence = append(evidence, map[string]interface{}{"direction": direction, "groupKey": g.key, "calculationMode": g.mode, "netRatio": g.ratio, "factor": factor, "before": before, "after": amount, "items": g.items})
	}
	return amount, evidence, nil
}

func (f *executionFrame) applyDirectHeal(cmd command.Command, ability compilebundle.CompiledAbility) *model.EngineError {
	heal, err := f.settleHealing(cmd.Source, cmd.Target, cmd.Amount, model.HealDirect, ability, f.evalContext(ability))
	if err != nil {
		return err
	}
	f.run.recordEvidence(model.EvidenceItem{TimeMs: f.run.nowMs, Kind: model.EvidenceKindHeal, Ref: f.abilityRef, Data: map[string]interface{}{
		"source": cmd.Source, "target": cmd.Target, "category": model.HealDirect,
		"healingBeforeModifiers": heal.before, "healingAfterDone": heal.afterDone, "healingAfterModifiers": heal.after,
		"actualHealing": heal.actual, "overheal": heal.overheal, "modifiers": heal.modifiers,
	}})
	return nil
}
