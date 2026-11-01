package admission

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// ValidateEquipmentDynamicDefinition 校验动态结果的完整作者闭包及实际接收者属性槽，不安装效果。
func ValidateEquipmentDynamicDefinition(input Input, owner, providerRef, reference, target string) *model.EngineError {
	index, found := definitionIndex(input, reference)
	if !found {
		return fail(input, "equipment result has no complete provider definition", reference)
	}
	definition := input.Compiled.Providers[index]
	owned := false
	for _, actor := range input.Compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			parent := input.Compiled.Providers[mount.DefinitionIndex]
			owned = owned || actor.Key == owner && mount.ProviderRef == providerRef && (parent.Kind == "item" || parent.Kind == "character" || parent.Kind == "build") && parent.StableID != "" && parent.StableID == definition.StableID
		}
	}
	if !owned || definition.Kind != "status" || definition.Lifecycle == nil || !definition.Lifecycle.AllowsSourceTargetReuse() || !definition.Lifecycle.HasDuration || definition.Lifecycle.MaxStacks != 1 || definition.Lifecycle.RefreshPolicy != "replace" || len(definition.Processes)+len(definition.Listeners)+len(definition.StateFields) != 0 {
		return fail(input, "equipment dynamic result requires a complete single-source status instance", reference)
	}
	if len(definition.StatusContributions) != 0 {
		if target != "target" || len(definition.StatusContributions) != 1 || definition.AbilityCount != 0 || len(definition.Modifiers) != 0 || definition.Lifecycle.TickIntervalMs != 0 || definition.StatusContributions[0].StatusKind != model.StatusKindMovementSlow || !definition.StatusContributions[0].HasStrength {
			return fail(input, "equipment movement slow requires one complete opponent status without mixed effects", reference)
		}
		return nil
	}
	if definition.AbilityCount == 1 && len(definition.Modifiers) == 0 {
		ability := input.Compiled.Abilities[definition.AbilityStart]
		if ability.Kind != "tick" || ability.TickSpec == nil || ability.TickSpec.IsAnchored() || ability.TickSpec.IntervalMs <= 0 || ability.TickSpec.StartDelayMs <= 0 || ability.TickSpec.OnTickCount == 0 || ability.OperationCount != 0 || ability.ProcessControl != nil || ability.HasCastCondition || ability.Cost != nil || ability.Cooldown != nil || ability.HasSkillHit {
			return fail(input, "temporary equipment period requires one complete configured tick", reference)
		}
		for _, operation := range input.Compiled.Operations[int(ability.TickSpec.OnTickStart) : int(ability.TickSpec.OnTickStart)+int(ability.TickSpec.OnTickCount)] {
			if operation.Operation != "damage" || operation.Target != "target" || !operation.HasAmount {
				return fail(input, "temporary equipment period only admits complete opponent damage", operation.Path)
			}
		}
		return nil
	}
	if definition.AbilityCount != 0 || len(definition.Modifiers) == 0 {
		return fail(input, "equipment dynamic result is neither a configured period nor received healing", reference)
	}
	for _, modifier := range definition.Modifiers {
		if GroupedDamageSourceModifier(*input.Formulas, modifier) && definition.Lifecycle.TickIntervalMs == 0 {
			continue
		}
		if modifier.Kind == "attribute" {
			attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			recipient := owner
			if target == "target" {
				recipient = opponent(owner)
			}
			actual, _ := actorView(input, recipient)
			_, exists := actual.Attributes.Lookup(attributeKey)
			if !exists || attributeKey == "hp" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || modifier.HasCondition || !modifier.HasValue || !OwnedAttributePolicy(modifier) || definition.Lifecycle.TickIntervalMs != 0 {
				return fail(input, "dynamic attribute result requires an explicit non-HP modifier on its actual recipient", reference)
			}
			continue
		}
		if modifier.Kind != "pipeline" || modifier.Command != "heal" || modifier.HealDirection != "RECEIVED" || modifier.HealGroupCalculationMode != "ratio_max" || modifier.ValuePolicy != "add_percent" || !modifier.HasValue || modifier.HasCondition {
			return fail(input, "equipment dynamic result is outside received-healing ratio-max scope", reference)
		}
	}
	return nil
}
