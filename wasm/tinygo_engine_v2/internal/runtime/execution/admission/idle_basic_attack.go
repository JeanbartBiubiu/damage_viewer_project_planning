package admission

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ValidateIdleBasicAttackAbilities 校验对手完整原生普攻能力，返回唯一开始能力和首次引用供父层核对实际监听。
func ValidateIdleBasicAttackAbilities(input Input, provider planbundle.CompiledProvider, owner, ref string, validAmmo bool) (planbundle.CompiledAbility, string, *model.EngineError) {
	fail := func() *model.EngineError {
		return fail(input, "idle opponent binding must contain its complete static basic attack and unique owner-start listener", "initialSnapshot.combatants.providers")
	}
	if provider.AbilityCount != 3 || len(provider.Processes) != 1 || provider.Lifecycle != nil || len(provider.Modifiers)+len(provider.StatusContributions) != 0 || !validAmmo {
		return planbundle.CompiledAbility{}, "", fail()
	}
	process := provider.Processes[0]
	if process.Cooldown == nil || !process.Cooldown.RoundPositiveMs || process.Cooldown.StartMoment.MomentType != "PROCESS_START" || len(process.Costs) != 0 {
		return planbundle.CompiledAbility{}, "", fail()
	}
	for _, step := range process.Steps {
		if step.StepType != "IMMEDIATE" {
			return planbundle.CompiledAbility{}, "", fail()
		}
	}
	for _, moment := range process.MomentOperations {
		if moment.Moment.MomentType != "PROCESS_START" {
			return planbundle.CompiledAbility{}, "", fail()
		}
		for _, operation := range input.Compiled.Operations[int(moment.OperationStart) : int(moment.OperationStart)+int(moment.OperationCount)] {
			if provider.AmmoBinding != nil && operation.Path == provider.AmmoBinding.ConsumptionPath {
				continue
			}
			if operation.Operation != model.OperationKindApplyAttackLink && operation.Operation != model.OperationKindApplyHitLink {
				return planbundle.CompiledAbility{}, "", fail()
			}
		}
	}
	var start planbundle.CompiledAbility
	initialRef := ""
	starts, hits := 0, 0
	for _, ability := range input.Compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if !ability.IsBasicAttack || ability.SkillKey != process.SkillKey || ability.Kind != "active" || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.TickSpec != nil {
			return planbundle.CompiledAbility{}, "", fail()
		}
		if ability.ProcessControl != nil {
			if initialRef != "" || ability.ProcessControl.Action != "INITIAL" || !ability.ProcessControl.UseRefFromEvent || ability.ProcessControl.ProcessIndex != 0 || ability.OperationCount != 0 || ability.HasSkillHit {
				return planbundle.CompiledAbility{}, "", fail()
			}
			initialRef = owner + ".provider[" + ref + "].ability[" + ability.AbilityKey + "]"
		} else if ability.HasSkillHit {
			if ability.OperationCount != 1 || input.Compiled.Operations[ability.OperationStart].Operation != model.OperationKindResolveSkillHit {
				return planbundle.CompiledAbility{}, "", fail()
			}
			hits++
		} else {
			if ability.OperationCount != 0 {
				return planbundle.CompiledAbility{}, "", fail()
			}
			start = ability
			starts++
		}
	}
	if initialRef == "" || starts != 1 || hits != 1 {
		return planbundle.CompiledAbility{}, "", fail()
	}
	return start, initialRef, nil
}
