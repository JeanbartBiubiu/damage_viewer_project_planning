package runtime

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *genericRunState) validateEquipmentPeriodicProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if provider.Kind != "item" || provider.StableID == "" || provider.Lifecycle != nil || len(provider.Processes)+len(provider.StatusContributions) != 0 {
		return s.basicAttackErr("equipment periodic source must be an owned permanent selected passive", "initialSnapshot.combatants.providers")
	}
	ticks := 0
	for _, ability := range s.compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.HasSkillHit || ability.IsBasicAttack {
			return s.basicAttackErr("equipment periodic abilities cannot contain active casts, costs or processes", "initialSnapshot.combatants.providers")
		}
		switch ability.Kind {
		case "passive_listener":
			if ability.TickSpec != nil {
				return s.basicAttackErr("equipment hit listeners cannot contain a hidden tick specification", "initialSnapshot.combatants.providers")
			}
		case "tick":
			ticks++
			specification := ability.TickSpec
			if ticks > 1 || ability.OperationCount != 0 || specification == nil || specification.IsAnchored() || specification.IntervalMs <= 0 || specification.StartDelayMs <= 0 || specification.OnTickCount == 0 {
				return s.basicAttackErr("equipment requires one complete fixed tick with an explicit positive first delay and interval", "initialSnapshot.combatants.providers")
			}
			for _, operation := range s.compiled.Operations[int(specification.OnTickStart) : int(specification.OnTickStart)+int(specification.OnTickCount)] {
				if operation.Operation == "damage" && operation.Target == "target" && operation.HasAmount {
					continue
				}
				if operation.Operation == "state_change" && operation.StateScope == stateScopeProvider && (operation.Target == "self" || operation.Target == "source") && operation.HasAmount {
					continue
				}
				return s.basicAttackErr("equipment ticks require complete opponent damage or owned numeric state", operation.Path)
			}
		default:
			return s.basicAttackErr("equipment periodic source contains an unsupported ability", "initialSnapshot.combatants.providers")
		}
	}
	if ticks != 1 {
		return s.basicAttackErr("equipment periodic source requires its complete tick ability", "initialSnapshot.combatants.providers")
	}
	for _, modifier := range provider.Modifiers {
		key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		actor, present := s.combatants[owner]
		_, declared := actor.attributes[key]
		if modifier.Kind != "attribute" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || key == "" || key == "hp" || !present || !declared || modifier.HasCondition || modifier.ValuePolicy != "add" || !modifier.HasValue {
			return s.basicAttackErr("equipment periodic modifiers require an owned declared non-HP additive attribute", "initialSnapshot.combatants.providers")
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
