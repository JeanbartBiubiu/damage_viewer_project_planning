package runtime

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (f *executionFrame) applyReceivedShieldModifiers(targetKey string, amount float64, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, f.vampError("shield amount must be finite and nonnegative", "shield.amount", targetKey)
	}
	before := amount
	modifiers := f.stageFor(targetKey).damageResolver.CollectForCommandChannelsWithMatches("shield", []string{"normal_shield"}, "received")
	groups := map[string]float64{}
	order := []string{}
	providerContext := f.providerFormulaContextFunc(targetKey)
	for _, collected := range modifiers {
		modifier := collected.Modifier
		context := f.evalContext(ability)
		if providerContext != nil {
			owned := providerContext(modifier.OwnerCombatantKey, modifier.ProviderRef)
			context.HasProviderContext, context.ProviderState, context.ProviderTargetState = owned.HasProviderContext, owned.ProviderState, owned.ProviderTargetState
		}
		if modifier.HasCondition {
			condition, err := f.run.formulas.Eval(modifier.ConditionProg, context)
			if err != nil {
				return 0, f.preserveFormulaIssue(err, f.vampError(err.Error(), "shield.modifiers.condition", modifier.ModifierKey))
			}
			if condition == 0 {
				continue
			}
		}
		value, err := f.run.formulas.Eval(modifier.ValueProgram, context)
		if err != nil {
			return 0, f.preserveFormulaIssue(err, f.vampError(err.Error(), "shield.modifiers.value", modifier.ModifierKey))
		}
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, f.vampError("invalid received shield ratio", "shield.modifiers.value", modifier.ModifierKey)
		}
		if _, exists := groups[modifier.Bucket]; !exists {
			order = append(order, modifier.Bucket)
		}
		groups[modifier.Bucket] += value
		if math.IsNaN(groups[modifier.Bucket]) || math.IsInf(groups[modifier.Bucket], 0) {
			return 0, f.vampError("invalid received shield group", "shield.modifiers", modifier.Bucket)
		}
	}
	for _, group := range order {
		amount *= math.Max(0, 1+groups[group])
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, f.vampError("invalid received shield result", "shield.amount", targetKey)
	}
	f.recordEvidence(model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "shield", Ref: f.abilityRef, Data: map[string]interface{}{
		"source": f.sourceKey, "target": targetKey, "shieldBeforeModifiers": before, "shieldAfterModifiers": amount, "groups": groups,
	}})
	return amount, nil
}
