package execution

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func pipelineModifierIdentity(mod pipeline.MountedDamageModifier) string {
	return mod.OwnerCombatantKey + "\x00" + mod.ProviderRef + "\x00" + mod.ModifierKey
}

// applyPipelineDamageModifiers evaluates mounted pipeline modifiers for one command+stage.
// hostKey is the combatant whose damageResolver is consulted (source for crit/outgoing, target for incoming).
// Channel matching is the union of all_damage plus every qualifying specific channel.
func (f *Frame) applyPipelineDamageModifiers(
	hostKey, sourceKey, targetKey, command, stage string,
	amount float64,
	ability planbundle.CompiledAbility,
	damageType string,
	traits []string,
	evidence []map[string]interface{},
) (float64, []map[string]interface{}, *model.EngineError) {
	host := f.stageFor(hostKey)
	if !host.instances.Damage().HasCommandStage(command, stage) {
		return amount, evidence, nil
	}
	channels := f.matchingDamagePipelineChannels(ability)
	mods := host.instances.Damage().CollectForCommandChannelsWithMatches(command, channels, stage)
	if len(mods) == 0 {
		return amount, evidence, nil
	}
	baseCtx := f.evalContext(ability)
	baseCtx.StrictReads = true
	// 伤害命令可以重定向目标；条件和金额必须读取同一笔实际参与者。
	baseCtx.SourceAttrs = f.stageFor(sourceKey).attributesView()
	baseCtx.TargetAttrs = f.stageFor(targetKey).attributesView()
	baseCtx.SourceResources = f.stageFor(sourceKey).resourceView()
	baseCtx.TargetResources = f.stageFor(targetKey).resourceView()
	baseCtx.HasDamageParticipants = true
	baseCtx.DamageSelf = sourceKey == targetKey
	providerCtxFn := f.providerFormulaContextForTarget(hostKey, targetKey, true)
	if f.run.compiled.MultiplierGroupCount != 0 {
		for _, member := range mods {
			if member.Modifier.HasMultiplierGroup {
				return f.applyGroupedDamageBands(mods, hostKey, command, stage, amount, ability, damageType, traits, evidence, &baseCtx, providerCtxFn)
			}
		}
	}
	return f.applyIndependentDamageModifiers(mods, hostKey, command, stage, amount, ability, damageType, traits, evidence, &baseCtx, providerCtxFn, false)
}

func (f *Frame) evaluateDamageModifier(mod pipeline.MountedDamageModifier, baseCtx *formula.GenericEvalContext, providerCtxFn pipeline.ProviderFormulaContextFunc, amount float64, ability planbundle.CompiledAbility, damageType string, traits []string, exactExpiry bool) (float64, bool, *model.EngineError) {
	if exactExpiry && mod.OwnerCombatantKey != "" {
		instance, _, found := f.stageFor(mod.OwnerCombatantKey).instances.Providers().Find(mod.ProviderRef)
		if !found || instance.Expired(f.run.loop.TimeMs()) {
			return 0, false, nil
		}
	}
	if mod.Bucket == "first_per_cast" {
		id := pipelineModifierIdentity(mod)
		if f.consumedFirstPerCast != nil && f.consumedFirstPerCast[id] {
			return 0, false, nil
		}
	}
	modCtx := *baseCtx
	modCtx.HasDamageContext = true
	modCtx.DamageAmount = amount
	modCtx.DamageTraits = traits
	modCtx.DamageTypeKey = damageType
	modCtx.DamageCastOrigin = f.castOrigin
	modCtx.DamageAbilityTypes = f.abilityTypeKeys(ability)
	if providerCtxFn != nil {
		pctx := providerCtxFn(mod.OwnerCombatantKey, mod.ProviderRef)
		if exactExpiry && pctx.SkipExpiredAttributeModifier {
			return 0, false, nil
		}
		modCtx.HasProviderContext = pctx.HasProviderContext
		modCtx.ProviderState = pctx.ProviderState
		modCtx.ProviderTargetState = pctx.ProviderTargetState
		modCtx.ProviderStateDefaults = pctx.ProviderStateDefaults
	}
	if mod.HasCondition {
		cond, err := f.run.formulas.EvalContext(mod.ConditionProg, &modCtx)
		if err != nil {
			issue := f.preserveFormulaIssue(err, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
			if exactExpiry {
				f.locateGroupedDamageModifierError(issue, mod, mod.ConditionProg)
			}
			return 0, false, issue
		}
		if cond == 0 {
			return 0, false, nil
		}
	}
	if !mod.HasValue {
		return 0, false, nil
	}
	value, err := f.run.formulas.EvalContext(mod.ValueProgram, &modCtx)
	if err != nil {
		issue := f.preserveFormulaIssue(err, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
		if exactExpiry {
			f.locateGroupedDamageModifierError(issue, mod, mod.ValueProgram)
		}
		return 0, false, issue
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite pipeline modifier value", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}

	return value, true, nil
}

func (f *Frame) applyIndependentDamageModifiers(mods []pipeline.CollectedDamageModifier, hostKey, command, stage string, amount float64, ability planbundle.CompiledAbility, damageType string, traits []string, evidence []map[string]interface{}, baseCtx *formula.GenericEvalContext, providerCtxFn pipeline.ProviderFormulaContextFunc, exactExpiry bool) (float64, []map[string]interface{}, *model.EngineError) {
	for _, collected := range mods {
		mod := collected.Modifier
		value, active, err := f.evaluateDamageModifier(mod, baseCtx, providerCtxFn, amount, ability, damageType, traits, exactExpiry)
		if err != nil {
			return 0, evidence, err
		}
		if !active {
			continue
		}
		before := amount
		amount = pipeline.ApplyDamageValuePolicy(amount, mod.ValuePolicy, value)
		if math.IsNaN(amount) || math.IsInf(amount, 0) {
			return 0, evidence, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite pipeline modifier result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		// Zero remains valid; negative must not fall through mitigation as silent zero damage.
		if amount < 0 {
			return 0, evidence, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "negative pipeline modifier result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if mod.Bucket == "first_per_cast" {
			if f.consumedFirstPerCast == nil {
				f.consumedFirstPerCast = map[string]bool{}
			}
			f.consumedFirstPerCast[pipelineModifierIdentity(mod)] = true
		}
		evidence = f.appendDamageModifierEvidence(evidence, collected, hostKey, command, stage, traits, before, value, amount)
	}

	return amount, evidence, nil
}

func (f *Frame) appendDamageModifierEvidence(evidence []map[string]interface{}, collected pipeline.CollectedDamageModifier, hostKey, command, stage string, traits []string, before, value, after float64) []map[string]interface{} {
	if !f.run.detailedOutput() {
		return evidence
	}
	mod := collected.Modifier
	return append(evidence, map[string]interface{}{
		"stage": stage, "command": command, "modifierKey": mod.ModifierKey,
		"before": before, "value": value, "after": after,
		"matchedChannels": append([]string(nil), collected.MatchedChannels...),
		"matchedTraits":   append([]string(nil), traits...), "collectionHost": hostKey, "providerOwner": mod.OwnerCombatantKey,
	})
}
