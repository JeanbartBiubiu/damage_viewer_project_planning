package runtime

import (
	"math"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/typeset"
)

func (s *genericRunState) validateStaticInitializer(provider compilebundle.CompiledProvider, owner, providerRef string) *model.EngineError {
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

func (s *genericRunState) validateStaticInitializationListener(listener compilebundle.CompiledListener) *model.EngineError {
	initializationType, declared := s.compiled.Types.Registry.Lookup(model.EventTypeSourceInitialized)
	ownerType, ownerDeclared := s.compiled.Types.Registry.Lookup("event/source_owner")
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
		if !modifier.HasValue || modifier.HasCondition || int(modifier.ValueProgram) >= len(s.compiled.Formulas.Programs) {
			return s.basicAttackErr("initialization modifier requires a finite constant", operation.Path)
		}
		program := s.compiled.Formulas.Programs[modifier.ValueProgram]
		if len(program.Instr) != 1 || program.Instr[0].Op != formula.GenericOpConst || math.IsNaN(program.Instr[0].Value) || math.IsInf(program.Instr[0].Value, 0) {
			return s.basicAttackErr("initialization modifier requires an application snapshot constant", operation.Path)
		}
		if modifier.Kind == "attribute" && modifier.Target == "opponent.attr.attack_speed" && modifier.ValuePolicy == "multiply" {
			if program.Instr[0].Value <= 0 || program.Instr[0].Value > 1 {
				return s.basicAttackErr("static attack-speed aura requires a multiplier within (0,1]", operation.Path)
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
			if modifier.ValuePolicy != "add" && modifier.ValuePolicy != "add_percent" && modifier.ValuePolicy != "multiply" {
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
