package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// 永久技能伴随来源使用真实目标状态驱动周期；装备固定周期仍走自己的准入。
func (s *Engine) validateTargetWindowProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if len(provider.TargetTimings) > 0 {
		return s.validateTargetTimingProvider(provider, owner, providerRef)
	}
	if (provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.Lifecycle != nil || provider.AmmoBinding != nil || len(provider.Processes)+len(provider.StatusContributions) != 0 {
		return s.basicAttackErr("target window requires an owned permanent passive skill source", "initialSnapshot.combatants.providers")
	}
	ticks := 0
	for _, ability := range s.compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.HasSkillHit || ability.IsBasicAttack {
			return s.basicAttackErr("target window abilities cannot contain active casts, costs or processes", "initialSnapshot.combatants.providers")
		}
		switch ability.Kind {
		case "passive_listener":
			if ability.TickSpec != nil {
				return s.basicAttackErr("target window listeners cannot contain a hidden tick specification", "initialSnapshot.combatants.providers")
			}
		case "tick":
			ticks++
			specification := ability.TickSpec
			if ticks > 1 || ability.OperationCount != 0 || specification == nil || !specification.IsAnchored() || specification.AnchorScope != stateScopeProviderTarget || specification.IntervalMs <= 0 || specification.StartDelayMs != 0 || specification.OnTickCount == 0 {
				return s.basicAttackErr("target window requires one complete provider-target anchored tick", "initialSnapshot.combatants.providers")
			}
			anchor, exists := provider.StateFields[specification.AnchorStateKey]
			if !exists || anchor.DurationMs <= 0 || anchor.RefreshPolicy != model.ProviderStateRefreshOnWrite {
				return s.basicAttackErr("target window anchor requires its declared timed refresh-on-write field", "initialSnapshot.combatants.providers")
			}
			for _, operation := range s.compiled.Operations[int(specification.OnTickStart) : int(specification.OnTickStart)+int(specification.OnTickCount)] {
				if operation.Operation == "damage" && operation.Target == "target" && operation.HasAmount {
					continue
				}
				field, declared := provider.StateFields[operation.Ref]
				if operation.Operation == "state_change" && operation.StateScope == stateScopeProvider && (operation.Target == "self" || operation.Target == "source") && operation.HasAmount && declared && field.StateKind != model.ProviderStateKindCooldown && field.AmmoRecovery == nil {
					continue
				}
				return s.basicAttackErr("target window ticks require complete opponent damage or owned numeric guards", operation.Path)
			}
		default:
			return s.basicAttackErr("target window source contains an unsupported ability", "initialSnapshot.combatants.providers")
		}
	}
	if ticks != 1 {
		return s.basicAttackErr("target window requires its complete anchored tick ability", "initialSnapshot.combatants.providers")
	}
	for _, modifier := range provider.Modifiers {
		key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		_, declared := s.combatants[owner].attributesView().Lookup(key)
		if modifier.Kind != "attribute" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || key == "hp" || !declared || modifier.HasCondition || !modifier.HasValue || !admissibleOwnedAttributePolicy(modifier) {
			return s.basicAttackErr("target window modifiers require complete owned non-HP attributes", "initialSnapshot.combatants.providers")
		}
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}
