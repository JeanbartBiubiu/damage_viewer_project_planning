package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/typeset"
)

func (s *genericRunState) validateStaticInitializer(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if (provider.Kind != "item" && provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.AbilityCount != 0 || provider.Lifecycle != nil || len(provider.Listeners) == 0 || len(provider.Processes)+len(provider.StateFields)+len(provider.StatusContributions)+len(provider.Modifiers) != 0 {
		return s.basicAttackErr("initializer must be a complete static owned source", "initialSnapshot.combatants.providers")
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateStaticInitializationListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *genericRunState) validateStaticInitializationListener(listener planbundle.CompiledListener) *model.EngineError {
	initializationType, declared := s.compiled.Types.Registry.LookupDomain("event", model.EventTypeSourceInitialized)
	ownerType, ownerDeclared := s.compiled.Types.Registry.LookupDomain("event", "event/source_owner")
	var eventTypes typeset.TypeSet
	eventTypes.Add(initializationType)
	if !declared || !ownerDeclared || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" || listener.HasAbilityRef || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.OperationCount == 0 || listener.MaxTriggersPerEvent != 1 || !listener.EventMatcher.RequiresAllType(initializationType) || !listener.EventMatcher.RequiresAllType(ownerType) || !s.listenerMatchesEvent(listener, emittedEvent{eventType: model.EventTypeSourceInitialized, sourceKey: listener.OwnerCombatantKey, targetKey: listener.OwnerCombatantKey}, eventTypes) {
		return s.basicAttackErr("this stage accepts only unconditional owner source initialization listeners", "listeners."+listener.ListenerKey)
	}
	for _, operation := range s.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
		if operation.Operation != "apply_provider" || operation.Target != "self" || operation.ProviderRef == "" || operation.HasCondition || operation.HasAmount || operation.ProviderRefFromEvent {
			return s.basicAttackErr("initialization may only mount a complete permanent modifier on its own source", operation.Path)
		}
		index, exists := s.findProviderDefinitionIndex(operation.ProviderDefinitionRef)
		if !exists {
			return s.basicAttackErr("missing initialized effect definition", operation.Path)
		}
		effect := s.compiled.Providers[index]
		if effect.Kind != "status" || effect.AbilityCount != 0 || effect.Lifecycle != nil || len(effect.Listeners)+len(effect.Processes)+len(effect.StateFields)+len(effect.StatusContributions) != 0 || len(effect.Modifiers) != 1 {
			return s.basicAttackErr("initialized effect must contain one permanent static modifier", operation.Path)
		}
		modifier := effect.Modifiers[0]
		if !modifier.HasValue || modifier.HasCondition || int(modifier.ValueProgram) >= len(s.formulas.Programs) {
			return s.basicAttackErr("initialization modifier requires a finite constant", operation.Path)
		}
		value, static := s.formulas.FoldStatic(modifier.ValueProgram)
		if !static || math.IsNaN(value) || math.IsInf(value, 0) {
			return s.basicAttackErr("initialization modifier requires an application snapshot constant", operation.Path)
		}
		if modifier.Kind == "attribute" && pipeline.ModifierTargetCombatantSelector(modifier.Target) == model.SelectorOpponent {
			attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			opponent, exists := s.combatants[opponentCombatantKey(listener.OwnerCombatantKey)]
			if !exists || attributeKey == "" || attributeKey == "hp" {
				return s.basicAttackErr("permanent aura requires a declared non-HP opponent attribute", operation.Path)
			}
			if _, declared := opponent.attributes[attributeKey]; !declared {
				return s.basicAttackErr("permanent aura opponent attribute slot is missing", operation.Path)
			}
			if modifier.ValuePolicy != "multiply" || modifier.Stage != "total" || value < 0 {
				return s.basicAttackErr("permanent aura requires an explicit nonnegative total multiplier", operation.Path)
			}
			continue
		}
		if modifier.Kind == "attribute" && pipeline.ModifierTargetCombatantSelector(modifier.Target) == model.SelectorSelf {
			attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			owner, ownerExists := s.combatants[listener.OwnerCombatantKey]
			if !ownerExists || attributeKey == "hp" || attributeKey == "" {
				return s.basicAttackErr("permanent skill attribute requires a supported owned non-HP slot", operation.Path)
			}
			if _, exists := owner.attributes[attributeKey]; !exists {
				return s.basicAttackErr("permanent skill attribute slot is missing", operation.Path)
			}
			if modifier.ValuePolicy != "add" && modifier.ValuePolicy != "percent_add" && modifier.ValuePolicy != "multiply" {
				return s.basicAttackErr("permanent skill attribute requires an explicit supported calculation", operation.Path)
			}
			continue
		}
		if modifier.Kind == "pipeline" && modifier.Command == "heal" && modifier.HealDirection == model.HealReceived && modifier.HealCategory == model.HealAny && modifier.HealGroupCalculationMode == model.HealGroupRatioAdd && modifier.ValuePolicy == "add_percent" {
			continue
		}
		if modifier.Kind == "pipeline" && modifier.Command == "shield" && modifier.Channel == "normal_shield" && modifier.Stage == "received" && modifier.ValuePolicy == "add_percent" {
			continue
		}
		return s.basicAttackErr("unsupported permanent source modifier", operation.Path)
	}
	return nil
}
