package execution

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

type evaluatedDamageMultiplier struct {
	member        pipeline.CollectedDamageModifier
	value         float64
	before, after float64
}

// 同一优先级带只乘算；成员资格、动态值及结果全部成功后才发布本带消费。
func (f *Frame) applyGroupedDamageBands(mods []pipeline.CollectedDamageModifier, hostKey, command, stage string, amount float64, ability planbundle.CompiledAbility, damageType string, traits []string, evidence []map[string]interface{}, baseCtx *formula.GenericEvalContext, providerCtxFn pipeline.ProviderFormulaContextFunc) (float64, []map[string]interface{}, *model.EngineError) {
	for start := 0; start < len(mods); {
		end := start + 1
		hasGroup := mods[start].Modifier.HasMultiplierGroup
		for end < len(mods) && mods[end].Modifier.Priority == mods[start].Modifier.Priority {
			hasGroup = hasGroup || mods[end].Modifier.HasMultiplierGroup
			end++
		}
		band := mods[start:end]
		var err *model.EngineError
		if hasGroup {
			amount, evidence, err = f.applyOneGroupedDamageBand(band, hostKey, command, stage, amount, ability, damageType, traits, evidence, baseCtx, providerCtxFn)
		} else {
			amount, evidence, err = f.applyIndependentDamageModifiers(band, hostKey, command, stage, amount, ability, damageType, traits, evidence, baseCtx, providerCtxFn, true)
		}
		if err != nil {
			return 0, evidence, err
		}
		start = end
	}
	return amount, evidence, nil
}

func (f *Frame) applyOneGroupedDamageBand(mods []pipeline.CollectedDamageModifier, hostKey, command, stage string, amount float64, ability planbundle.CompiledAbility, damageType string, traits []string, evidence []map[string]interface{}, baseCtx *formula.GenericEvalContext, providerCtxFn pipeline.ProviderFormulaContextFunc) (float64, []map[string]interface{}, *model.EngineError) {
	groups := pipeline.NewAmplificationGroups(len(mods))
	accepted := make([]evaluatedDamageMultiplier, 0, len(mods))
	working := amount
	for _, collected := range mods {
		mod := collected.Modifier
		if mod.ValuePolicy != "multiply" || command != "damage" || (stage != "outgoing_pre_mitigation" && stage != "incoming_post_mitigation") {
			return 0, evidence, f.groupedDamageModifierError(mod, "grouped priority band requires damage multiply at an amplification stage")
		}
		value, active, err := f.evaluateDamageModifier(mod, baseCtx, providerCtxFn, amount, ability, damageType, traits, true)
		if err != nil {
			f.locateGroupedDamageModifierError(err, mod, mod.ValueProgram)
			return 0, evidence, err
		}
		if !active {
			continue
		}
		entry := evaluatedDamageMultiplier{member: collected, value: value, before: working}
		if mod.HasMultiplierGroup {
			if err := groups.Add(mod.MultiplierGroupID, value); err != nil {
				return 0, evidence, f.groupedDamageModifierError(mod, err.Error())
			}
		} else {
			// 独立倍率保留原排序下的有限性与负结果检查，不把两个负数合并成正数。
			working = pipeline.ApplyDamageValuePolicy(working, mod.ValuePolicy, value)
			if math.IsNaN(working) || math.IsInf(working, 0) || working < 0 {
				return 0, evidence, f.groupedDamageModifierError(mod, "invalid independent multiplier result within grouped priority band")
			}
		}
		entry.after = working
		accepted = append(accepted, entry)
	}
	product, groupErr := groups.Product()
	if groupErr != nil {
		mod := mods[0].Modifier
		if issue, ok := groupErr.(pipeline.AmplificationGroupError); ok {
			for _, entry := range accepted {
				if entry.member.Modifier.HasMultiplierGroup && entry.member.Modifier.MultiplierGroupID == issue.ID {
					mod = entry.member.Modifier
					break
				}
			}
		}
		return 0, evidence, f.groupedDamageModifierError(mod, groupErr.Error())
	}
	result := working * product
	if math.IsNaN(result) || math.IsInf(result, 0) || result < 0 {
		member := mods[0].Modifier
		for index := len(accepted) - 1; index >= 0; index-- {
			member = accepted[index].member.Modifier
			if accepted[index].value != 1 {
				break
			}
		}
		return 0, evidence, f.groupedDamageModifierError(member, "non-finite or negative grouped damage result")
	}
	for _, entry := range accepted {
		mod := entry.member.Modifier
		if mod.Bucket == "first_per_cast" {
			if f.consumedFirstPerCast == nil {
				f.consumedFirstPerCast = make(map[string]bool)
			}
			f.consumedFirstPerCast[pipelineModifierIdentity(mod)] = true
		}
	}
	for _, entry := range accepted {
		mod := entry.member.Modifier
		before, after := entry.before, entry.after
		if mod.HasMultiplierGroup {
			before, after = amount, result
		}
		evidence = f.appendDamageModifierEvidence(evidence, entry.member, hostKey, command, stage, traits, before, entry.value, after)
		if mod.HasMultiplierGroup && f.run.detailedOutput() {
			// before/after表示整段输入/输出；成员倍率与实际组因子分别保留。
			row := evidence[len(evidence)-1]
			row["multiplierGroupId"] = mod.MultiplierGroupID
			row["groupMultiplier"] = groups.Factor(mod.MultiplierGroupID)
		}
	}
	return result, evidence, nil
}

func (f *Frame) groupedDamageModifierError(mod pipeline.MountedDamageModifier, message string) *model.EngineError {
	err := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	f.locateGroupedDamageModifierError(err, mod, mod.ValueProgram)
	return err
}

func (f *Frame) locateGroupedDamageModifierError(err *model.EngineError, mod pipeline.MountedDamageModifier, program formula.GenericProgramID) {
	if err.Path == "" && int(program) < len(f.run.formulas.Programs) {
		err.Path = f.run.formulas.Programs[program].Key
	}
	if err.Ref == "" {
		err.Ref = mod.OwnerCombatantKey + ".provider[" + mod.ProviderRef + "].modifier[" + mod.ModifierKey + "]"
	}
}
