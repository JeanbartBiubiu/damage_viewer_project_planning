package actionflow

import (
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// IncomingCappedFlatActivePlanned 仅核对实际首次手动或自动行动，不以编译图存在、外部驱动或使用事实代替本场计划。
func IncomingCappedFlatActivePlanned(source planbundle.CompiledIncomingCappedFlatSource, providers []planbundle.CompiledProvider, abilities []planbundle.CompiledAbility, actions *actionpkg.State) bool {
	parent := providers[source.ParentIndex]
	for index := 0; index < actions.ManualCount(); index++ {
		action := actions.ManualAt(index)
		if action.Plan().Action() == "INITIAL" && action.ControlAbilityIndex() == action.Binding().InitialAbilityIndex &&
			incomingCappedFlatInitialMatches(source, parent.ProviderKey, parent.SkillKey, action.Binding(), abilities) {
			return true
		}
	}
	if actions.HasAutomatic() {
		for index := 0; index < actions.AutomaticCount(); index++ {
			rule := actions.AutomaticAt(index)
			if rule.ControlIndex() == rule.Binding().InitialAbilityIndex &&
				incomingCappedFlatInitialMatches(source, parent.ProviderKey, parent.SkillKey, rule.Binding(), abilities) {
				return true
			}
		}
	}
	return false
}

func incomingCappedFlatInitialMatches(source planbundle.CompiledIncomingCappedFlatSource, definition, skill string, binding planbundle.CompiledSkillActionBinding, abilities []planbundle.CompiledAbility) bool {
	return binding.Source == source.Owner && binding.ProviderRef == source.ParentProviderRef && binding.ProviderDefinitionRef == definition &&
		binding.SkillKey == skill && abilities[binding.InitialAbilityIndex].ProviderIndex == source.ParentIndex
}
