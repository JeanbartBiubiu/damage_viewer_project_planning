package admission

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ValidateTargetWindowDefinition 核对完整编译来源、数值槽及周期定义，不派发监听或安排时钟。
func ValidateTargetWindowDefinition(input Input, provider planbundle.CompiledProvider, owner string) *model.EngineError {
	if (provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.Lifecycle != nil || provider.AmmoBinding != nil || len(provider.Processes)+len(provider.StatusContributions) != 0 {
		return fail(input, "target window requires an owned permanent passive skill source", "initialSnapshot.combatants.providers")
	}
	ticks := 0
	for _, ability := range input.Compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.HasSkillHit || ability.IsBasicAttack {
			return fail(input, "target window abilities cannot contain active casts, costs or processes", "initialSnapshot.combatants.providers")
		}
		switch ability.Kind {
		case "passive_listener":
			if ability.TickSpec != nil {
				return fail(input, "target window listeners cannot contain a hidden tick specification", "initialSnapshot.combatants.providers")
			}
		case "tick":
			ticks++
			specification := ability.TickSpec
			if ticks > 1 || ability.OperationCount != 0 || specification == nil || !specification.IsAnchored() || specification.AnchorScope != "state_scope/provider_target" || specification.IntervalMs <= 0 || specification.StartDelayMs != 0 || specification.OnTickCount == 0 {
				return fail(input, "target window requires one complete provider-target anchored tick", "initialSnapshot.combatants.providers")
			}
			anchor, exists := provider.StateFields[specification.AnchorStateKey]
			if !exists || anchor.DurationMs <= 0 || anchor.RefreshPolicy != model.ProviderStateRefreshOnWrite {
				return fail(input, "target window anchor requires its declared timed refresh-on-write field", "initialSnapshot.combatants.providers")
			}
			for _, operation := range input.Compiled.Operations[int(specification.OnTickStart) : int(specification.OnTickStart)+int(specification.OnTickCount)] {
				if operation.Operation == "damage" && operation.Target == "target" && operation.HasAmount {
					continue
				}
				field, declared := provider.StateFields[operation.Ref]
				if operation.Operation == "state_change" && operation.StateScope == "state_scope/provider" && (operation.Target == "self" || operation.Target == "source") && operation.HasAmount && declared && field.StateKind != model.ProviderStateKindCooldown && field.AmmoRecovery == nil {
					continue
				}
				return fail(input, "target window ticks require complete opponent damage or owned numeric guards", operation.Path)
			}
		default:
			return fail(input, "target window source contains an unsupported ability", "initialSnapshot.combatants.providers")
		}
	}
	if ticks != 1 {
		return fail(input, "target window requires its complete anchored tick ability", "initialSnapshot.combatants.providers")
	}
	actual, _ := actorView(input, owner)
	for _, modifier := range provider.Modifiers {
		key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		_, declared := actual.Attributes.Lookup(key)
		if modifier.Kind != "attribute" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || key == "hp" || !declared || modifier.HasCondition || !modifier.HasValue || !OwnedAttributePolicy(modifier) {
			return fail(input, "target window modifiers require complete owned non-HP attributes", "initialSnapshot.combatants.providers")
		}
	}
	return nil
}
