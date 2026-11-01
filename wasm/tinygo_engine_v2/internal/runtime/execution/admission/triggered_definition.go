package admission

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ValidateEquipmentHitDefinition 校验常驻触发来源的能力和自有属性，不执行其监听。
func ValidateEquipmentHitDefinition(input Input, provider planbundle.CompiledProvider, owner string) *model.EngineError {
	if (provider.Kind != "item" && provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.Lifecycle != nil || len(provider.Processes)+len(provider.StatusContributions) != 0 {
		return fail(input, "triggered skill must remain an owned permanent passive source", "initialSnapshot.combatants.providers")
	}
	for _, ability := range input.Compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.TickSpec != nil || ability.HasSkillHit {
			return fail(input, "equipment on-hit abilities must only represent their complete passive listener", "initialSnapshot.combatants.providers")
		}
	}
	actual, _ := actorView(input, owner)
	for _, modifier := range provider.Modifiers {
		attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		_, exists := actual.Attributes.Lookup(attributeKey)
		if modifier.Kind != "attribute" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || attributeKey == "hp" || !exists || modifier.HasCondition || !modifier.HasValue || !OwnedAttributePolicy(modifier) {
			return fail(input, "source modifiers require complete owned non-HP attributes", "initialSnapshot.combatants.providers")
		}
	}
	return nil
}
