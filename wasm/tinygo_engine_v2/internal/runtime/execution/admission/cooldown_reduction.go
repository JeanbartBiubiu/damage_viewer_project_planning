package admission

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// AttackCooldownReductionListener 校验真实拥有者普攻监听与静态整数返还量。
func AttackCooldownReductionListener(input Input, attack *model.BasicAttackPlan, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	hitType, hitDeclared := input.Compiled.RuntimeTypes.BasicAttackHit.Lookup()
	ownerType, ownerDeclared := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	if attack != nil && attack.Source != listener.OwnerCombatantKey || listener.OwnerCombatantKey != model.SelectorSource ||
		!hitDeclared || !ownerDeclared || !listener.EventMatcher.RequiresAllType(hitType) || !listener.EventMatcher.RequiresAllType(ownerType) ||
		operation.Target != model.SelectorSelf || operation.ValuePolicy != "reduce" || !operation.HasAmount || !operation.HasAbilityRef || operation.HasCondition {
		return false
	}
	amount, static := input.Formulas.Metadata.FoldStatic(operation.AmountProgram)
	if !static || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount > float64(9007199254740991) || math.Trunc(amount) != amount {
		return false
	}
	return true
}

// AttackCooldownReductionBinding 核对一项实际计划来源与完整首次过程冷却；调用方只传入真实选中的来源。
func AttackCooldownReductionBinding(input Input, binding planbundle.CompiledSkillActionBinding, ref string, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	if binding.Source != listener.OwnerCombatantKey || binding.ProviderRef != listener.OwnerProviderRef || binding.SkillKey == "" {
		return false
	}
	index, exists := binding.ControlAbilityIndices["INITIAL"]
	if !exists || int(index) >= len(input.Compiled.Abilities) {
		return false
	}
	ability := input.Compiled.Abilities[index]
	if ability.Kind != "active" || ability.IsBasicAttack || ability.SkillKey != binding.SkillKey || ability.ProcessControl == nil ||
		ability.ProcessControl.Action != "INITIAL" || ability.ProcessControl.UseRefFromEvent || int(ability.ProviderIndex) != operation.OwnerProviderIndex ||
		ref != binding.Source+".provider["+binding.ProviderRef+"].ability["+ability.AbilityKey+"]" {
		return false
	}
	provider := input.Compiled.Providers[ability.ProviderIndex]
	processIndex := ability.ProcessControl.ProcessIndex
	if provider.ProviderKey == binding.ProviderDefinitionRef && processIndex >= 0 && processIndex < len(provider.Processes) &&
		provider.Processes[processIndex].SkillKey == binding.SkillKey && provider.Processes[processIndex].Cooldown != nil {
		return true
	}
	return false
}
