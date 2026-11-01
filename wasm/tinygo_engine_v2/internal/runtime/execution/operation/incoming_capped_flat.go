package operation

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// No cap uses the old path. A matching cap evaluates its points once, then
// changes only working branch amounts; raw and crit snapshots remain untouched.
func (f *calculation) incomingCappedFlat(cmd pipeline.Command, ability planbundle.CompiledAbility, crit CritEvidence,
	preOutgoing, raw float64, evidence []map[string]interface{},
) (normal, critical float64, applied bool, records []map[string]interface{}, result *model.EngineError) {
	records = evidence
	if len(f.executor.plan.IncomingCappedFlatSources) == 0 {
		return
	}
	host := f.stageFor(cmd.Target)
	if !host.Instances.Damage().HasCommandStage("damage", "incoming_pre_mitigation") {
		return
	}
	mods := host.Instances.Damage().CollectForCommandChannelsWithMatches("damage", []string{"all_damage"}, "incoming_pre_mitigation")
	if len(mods) != 1 {
		result = f.processError("damage.incoming_pre_mitigation", "capped flat requires exactly one actual owned modifier", cmd.Target)
		return
	}
	mod := mods[0].Modifier
	if mod.OwnerCombatantKey != cmd.Target || !mod.HasMaximumReductionRatio || !mod.HasCondition || !mod.HasValue {
		result = f.processError("damage.incoming_pre_mitigation", "capped flat lost its actual recipient or compiled shape", mod.ModifierKey)
		return
	}
	ctx := f.evalContext(ability)
	ctx.StrictReads, ctx.HasDamageContext = true, true
	ctx.DamageTypeKey = cmd.DamageType
	condition, err := f.executor.formulas.EvalContext(mod.ConditionProg, &ctx)
	if err != nil {
		result = f.formulaError(mod.ConditionProg, err.Error())
		return
	}
	if condition == 0 {
		return
	}
	// Authored source means the permanent modifier's real owner, not attacker.
	ctx.SourceAttrs = host.attributesView()
	if f.input.DefenseContext != nil {
		ctx.SourceAttrs = f.input.DefenseContext.TargetAttrs
	}
	points, err := f.executor.formulas.EvalContext(mod.ValueProgram, &ctx)
	if err != nil {
		result = f.formulaError(mod.ValueProgram, err.Error())
		return
	}
	cap := mod.MaximumReductionRatio
	if math.IsNaN(points) || math.IsInf(points, 0) || points < 0 || math.IsNaN(cap) || math.IsInf(cap, 0) || cap < 0 || cap > 1 {
		result = f.processError("damage.incoming_pre_mitigation", "capped flat points and ratio must be finite non-negative values", mod.ModifierKey)
		return
	}
	amounts, weights := [3]float64{raw, 0, 0}, [3]float64{1, 0, 0}
	if crit.Present && crit.Eligible && preOutgoing > 0 {
		factor := raw / preOutgoing
		amounts = [3]float64{crit.BaseRawAmount * factor, crit.BaseRawAmount * crit.NaturalMultiplier * factor, crit.BaseRawAmount * crit.ForcedMultiplier * factor}
		weights = [3]float64{1 - crit.ChanceEffective, crit.NaturalWeight, crit.ForcedWeight}
	}
	var reduced [3]float64
	for i, amount := range amounts {
		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || math.IsNaN(weights[i]) || math.IsInf(weights[i], 0) || weights[i] < 0 {
			result = f.processError("damage.incoming_pre_mitigation", "capped flat branch must be finite and non-negative", mod.ModifierKey)
			return
		}
		reduced[i] = amount - math.Min(points, cap*amount)
		if i == 0 {
			normal = reduced[i] * weights[i]
		} else {
			critical += reduced[i] * weights[i]
		}
	}
	if math.IsNaN(normal+critical) || math.IsInf(normal+critical, 0) || normal < 0 || critical < 0 {
		result = f.processError("damage.incoming_pre_mitigation", "capped flat result must be finite and non-negative", mod.ModifierKey)
		return
	}
	applied = true
	if f.executor.detailed {
		records = append(records, map[string]interface{}{"stage": "incoming_pre_mitigation", "command": "damage", "modifierKey": mod.ModifierKey,
			"providerOwner": mod.OwnerCombatantKey, "providerRef": mod.ProviderRef, "collectionHost": cmd.Target, "before": raw, "value": points,
			"maximumReductionRatio": cap, "after": normal + critical, "branchAmounts": amounts, "branchWeights": weights, "branchAfterReduction": reduced})
	}
	return
}
