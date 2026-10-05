package runtime

import (
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

func (s *genericRunState) validateEquipmentHitListener(listener compilebundle.CompiledListener) *model.EngineError {
	qualified := false
	for _, event := range []struct{ kind, relation string }{
		{model.EventTypeBasicAttackStart, eventSourceOwner}, {model.EventTypeBasicAttackHit, eventSourceOwner},
		{model.EventTypeAttackLinkApplied, eventSourceOwner}, {model.EventTypeHitLinkApplied, eventSourceOwner},
		{model.EventTypeBasicAttackReceived, eventTargetOwner}, {model.EventTypeDamageTaken, eventTargetOwner},
		{eventTypeDamageInstance, eventSourceOwner},
	} {
		kind, kindDeclared := s.compiled.Types.Registry.Lookup(event.kind)
		relation, relationDeclared := s.compiled.Types.Registry.Lookup(event.relation)
		qualified = qualified || kindDeclared && relationDeclared && listener.EventMatcher.RequiresAllType(kind) && listener.EventMatcher.RequiresAllType(relation)
	}
	if !qualified || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" || listener.HasAbilityRef || listener.PerCastThrottleMs != 0 || listener.OperationCount == 0 || listener.MaxTriggersPerEvent != 1 {
		return s.basicAttackErr("source requires a complete owner-start/hit/link or receiver-only engine event listener", "listeners."+listener.ListenerKey)
	}
	for _, operation := range s.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
		if operation.Operation == "damage" && operation.Target == "target" && operation.HasAmount {
			continue
		}
		if operation.Operation == "state_change" && (operation.StateScope == stateScopeProvider || operation.StateScope == stateScopeProviderTarget) && (operation.Target == "self" || operation.Target == "source") && operation.HasAmount {
			fields := s.resolveProviderStateFieldDefs(listener.OwnerCombatantKey, listener.OwnerProviderRef, s.combatants[listener.OwnerCombatantKey].providers)
			if _, declared := fields[operation.Ref]; !declared {
				return s.basicAttackErr("source state operation requires its complete declared field", operation.Path)
			}
			continue
		}
		if (operation.Operation == model.OperationKindApplyHitLink || operation.Operation == model.OperationKindApplyAttackLink) && operation.Target == "target" && operation.HasAmount {
			eventType := model.EventTypeHitLinkApplied
			if operation.Operation == model.OperationKindApplyAttackLink {
				eventType = model.EventTypeAttackLinkApplied
			}
			linkType, declared := s.compiled.Types.Registry.Lookup(eventType)
			if declared && listener.EventMatcher.RequiresAllType(linkType) {
				return s.basicAttackErr("a link listener cannot recursively apply the same link", operation.Path)
			}
			continue
		}
		if operation.Operation == "apply_provider" && (operation.Target == "target" || operation.Target == "self") {
			if err := s.validateEquipmentDynamicDefinition(listener.OwnerCombatantKey, listener.OwnerProviderRef, operation.ProviderDefinitionRef, operation.Target); err != nil {
				return err
			}
			continue
		}
		return s.basicAttackErr("source trigger requires complete opponent damage, owned state, links or a supported dynamic result", operation.Path)
	}
	return nil
}

func (s *genericRunState) validateEquipmentDynamicDefinition(owner, providerRef, reference, target string) *model.EngineError {
	index, found := s.findProviderDefinitionIndex(reference)
	if !found {
		return s.basicAttackErr("equipment result has no complete provider definition", reference)
	}
	definition := s.compiled.Providers[index]
	owned := false
	for _, actor := range s.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			parent := s.compiled.Providers[mount.DefinitionIndex]
			owned = owned || actor.Key == owner && mount.ProviderRef == providerRef && (parent.Kind == "item" || parent.Kind == "character" || parent.Kind == "build") && parent.StableID != "" && parent.StableID == definition.StableID
		}
	}
	if !owned || definition.Kind != "status" || definition.Lifecycle == nil || !definition.Lifecycle.AllowsSourceTargetReuse() || !definition.Lifecycle.HasDuration || definition.Lifecycle.MaxStacks != 1 || definition.Lifecycle.RefreshPolicy != "replace" || len(definition.Processes)+len(definition.Listeners)+len(definition.StateFields) != 0 {
		return s.basicAttackErr("equipment dynamic result requires a complete single-source status instance", reference)
	}
	if len(definition.StatusContributions) != 0 {
		if target != "target" || len(definition.StatusContributions) != 1 || definition.AbilityCount != 0 || len(definition.Modifiers) != 0 || definition.Lifecycle.TickIntervalMs != 0 || definition.StatusContributions[0].StatusKind != model.StatusKindMovementSlow || !definition.StatusContributions[0].HasStrength {
			return s.basicAttackErr("equipment movement slow requires one complete opponent status without mixed effects", reference)
		}
		return nil
	}
	if definition.AbilityCount == 1 && len(definition.Modifiers) == 0 {
		ability := s.compiled.Abilities[definition.AbilityStart]
		if ability.Kind != "tick" || ability.TickSpec == nil || ability.TickSpec.IsAnchored() || ability.TickSpec.IntervalMs <= 0 || ability.TickSpec.StartDelayMs <= 0 || ability.TickSpec.OnTickCount == 0 || ability.OperationCount != 0 || ability.ProcessControl != nil || ability.HasCastCondition || ability.Cost != nil || ability.Cooldown != nil || ability.HasSkillHit {
			return s.basicAttackErr("temporary equipment period requires one complete configured tick", reference)
		}
		for _, operation := range s.compiled.Operations[int(ability.TickSpec.OnTickStart) : int(ability.TickSpec.OnTickStart)+int(ability.TickSpec.OnTickCount)] {
			if operation.Operation != "damage" || operation.Target != "target" || !operation.HasAmount {
				return s.basicAttackErr("temporary equipment period only admits complete opponent damage", operation.Path)
			}
		}
		return nil
	}
	if definition.AbilityCount != 0 || len(definition.Modifiers) == 0 {
		return s.basicAttackErr("equipment dynamic result is neither a configured period nor received healing", reference)
	}
	for _, modifier := range definition.Modifiers {
		if modifier.Kind == "attribute" {
			attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			recipient := owner
			if target == "target" {
				recipient = opponentCombatantKey(owner)
			}
			_, exists := s.combatants[recipient].attributes[attributeKey]
			if !exists || attributeKey == "hp" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || modifier.HasCondition || !modifier.HasValue || (modifier.ValuePolicy != "add" && modifier.ValuePolicy != "percent_add" && modifier.ValuePolicy != "multiply") || definition.Lifecycle.TickIntervalMs != 0 {
				return s.basicAttackErr("dynamic attribute result requires an explicit non-HP modifier on its actual recipient", reference)
			}
			continue
		}
		if modifier.Kind != "pipeline" || modifier.Command != "heal" || modifier.HealDirection != "RECEIVED" || modifier.HealGroupCalculationMode != "ratio_max" || modifier.ValuePolicy != "add_percent" || !modifier.HasValue || modifier.HasCondition {
			return s.basicAttackErr("equipment dynamic result is outside received-healing ratio-max scope", reference)
		}
	}
	return nil
}

func (s *genericRunState) validateEquipmentHitProvider(provider compilebundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if (provider.Kind != "item" && provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.Lifecycle != nil || len(provider.Processes)+len(provider.StatusContributions) != 0 {
		return s.basicAttackErr("triggered skill must remain an owned permanent passive source", "initialSnapshot.combatants.providers")
	}
	for _, ability := range s.compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.TickSpec != nil || ability.HasSkillHit {
			return s.basicAttackErr("equipment on-hit abilities must only represent their complete passive listener", "initialSnapshot.combatants.providers")
		}
	}
	for _, modifier := range provider.Modifiers {
		attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		_, exists := s.combatants[owner].attributes[attributeKey]
		if modifier.Kind != "attribute" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || attributeKey == "hp" || !exists || modifier.HasCondition || !modifier.HasValue || (modifier.ValuePolicy != "add" && modifier.ValuePolicy != "percent_add" && modifier.ValuePolicy != "multiply") {
			return s.basicAttackErr("source modifiers require complete owned non-HP attributes", "initialSnapshot.combatants.providers")
		}
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateStaticInitializationListener(listener); err == nil {
				continue
			}
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}
