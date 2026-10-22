package runtime

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *genericRunState) validateEquipmentHitListener(listener planbundle.CompiledListener) *model.EngineError {
	qualified := false
	types := s.compiled.RuntimeTypes
	for _, event := range []struct{ kind, relation planbundle.DeclaredType }{
		{types.BasicAttackStart, types.SourceOwner}, {types.BasicAttackHit, types.SourceOwner},
		{types.SkillHit, types.SourceOwner},
		{types.ProcessResolved, types.SourceOwner},
		{types.AttackLinkApplied, types.SourceOwner}, {types.HitLinkApplied, types.SourceOwner},
		{types.BasicAttackReceived, types.TargetOwner}, {types.DamageTaken, types.TargetOwner},
		{types.DamageInstance, types.SourceOwner},
		{types.AbilityStarted, types.SourceOwner},
	} {
		kind, kindDeclared := event.kind.Lookup()
		relation, relationDeclared := event.relation.Lookup()
		qualified = qualified || kindDeclared && relationDeclared && listener.EventMatcher.RequiresAllType(kind) && listener.EventMatcher.RequiresAllType(relation)
	}
	if !qualified || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" || listener.HasAbilityRef || listener.PerCastThrottleMs != 0 || listener.OperationCount == 0 || listener.MaxTriggersPerEvent != 1 {
		return s.basicAttackErr("source requires a complete owner-start/hit/link or receiver-only engine event listener", "listeners."+listener.ListenerKey)
	}
	for _, operation := range s.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
		if (operation.Operation == "heal" || operation.Operation == "resource_change") && s.isOwnedSettledSelfRecovery(listener, operation) {
			continue
		}
		if operation.Operation == "damage" && operation.Target == "target" && operation.HasAmount {
			continue
		}
		if operation.Operation == "state_change" && (operation.StateScope == stateScopeProvider || operation.StateScope == stateScopeProviderTarget) && (operation.Target == "self" || operation.Target == "source") && operation.HasAmount {
			fields := s.resolveProviderStateFieldDefs(listener.OwnerCombatantKey, listener.OwnerProviderRef, s.combatants[listener.OwnerCombatantKey].providers).definitions()
			if _, declared := fields[operation.Ref]; !declared {
				return s.basicAttackErr("source state operation requires its complete declared field", operation.Path)
			}
			continue
		}
		if operation.Operation == model.OperationKindStateDurationChange && operation.StateScope == stateScopeProvider && (operation.Target == "self" || operation.Target == "source") && operation.ValuePolicy == "subtract" && operation.HasAmount {
			provider := s.compiled.Providers[operation.OwnerProviderIndex]
			field := provider.StateFields[operation.Ref]
			if provider.AmmoBinding != nil && provider.AmmoBinding.StateKey == operation.Ref && field.AmmoRecovery != nil && field.AmmoRecovery.OneByOne && s.plannedSkillProvider(listener.OwnerCombatantKey, listener.OwnerProviderRef) {
				continue
			}
		}
		if operation.Operation == model.OperationKindStateDurationChange && operation.StateScope == stateScopeProviderTarget && operation.Target == "self" && operation.ValuePolicy == "ensure_remaining" && operation.HasAmount {
			fields := s.resolveProviderStateFieldDefs(listener.OwnerCombatantKey, listener.OwnerProviderRef, s.combatants[listener.OwnerCombatantKey].providers).definitions()
			field, declared := fields[operation.Ref]
			if declared && field.valueType == model.ProviderStateValueInteger && field.stateKind == "" && field.durationMs > 0 {
				continue
			}
		}
		if operation.Operation == "cooldown_change" && s.isOwnedAttackCooldownReduction(listener, operation) {
			continue
		}
		if operation.Operation == "provider_duration_change" && s.isOwnedProviderDurationListener(listener, operation) {
			continue
		}
		if (operation.Operation == model.OperationKindApplyHitLink || operation.Operation == model.OperationKindApplyAttackLink) && operation.Target == "target" && operation.HasAmount {
			link := types.HitLinkApplied
			if operation.Operation == model.OperationKindApplyAttackLink {
				link = types.AttackLinkApplied
			}
			linkType, declared := link.Lookup()
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

func (s *genericRunState) isOwnedSettledSelfRecovery(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	if (operation.Target != model.SelectorSelf && operation.Target != model.SelectorSource) || !operation.HasAmount || int(operation.AmountProgram) >= len(s.formulas.Programs) || operation.OwnerProviderIndex < 0 || operation.OwnerProviderIndex >= len(s.compiled.Providers) {
		return false
	}
	settled := false
	for _, pair := range []struct{ kind, relation planbundle.DeclaredType }{
		{s.compiled.RuntimeTypes.DamageInstance, s.compiled.RuntimeTypes.SourceOwner},
		{s.compiled.RuntimeTypes.DamageTaken, s.compiled.RuntimeTypes.TargetOwner},
	} {
		kind, declared := pair.kind.Lookup()
		relation, relationDeclared := pair.relation.Lookup()
		settled = settled || declared && relationDeclared && listener.EventMatcher.RequiresAllType(kind) && listener.EventMatcher.RequiresAllType(relation)
	}
	if !settled {
		return false
	}
	owned := false
	for _, actor := range s.compiled.Combatants {
		if actor.Key != listener.OwnerCombatantKey {
			continue
		}
		for _, mount := range actor.ProviderMounts {
			owned = owned || mount.ProviderRef == listener.OwnerProviderRef && int(mount.DefinitionIndex) == operation.OwnerProviderIndex
		}
	}
	amount, static := s.foldOwnedRecoveryAmount(listener, operation)
	owner, exists := s.combatants[listener.OwnerCombatantKey]
	if !owned || !exists || !static || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return false
	}
	health, hasHealth := owner.attributes.Lookup("hp")
	if !hasHealth || !health.HasCurrent() || !health.HasMax() || math.IsNaN(health.Current) || math.IsInf(health.Current, 0) || math.IsNaN(health.Max) || math.IsInf(health.Max, 0) || health.Max <= 0 || health.Current < 0 || health.Current > health.Max {
		return false
	}
	if operation.Operation == "heal" {
		return true
	}
	if operation.ResourceKey == "" || operation.ResourceKey == "hp" {
		return false
	}
	slot, present := owner.resources[operation.ResourceKey]
	return present && !math.IsNaN(slot.Current) && !math.IsInf(slot.Current, 0) && !math.IsNaN(slot.Max) && !math.IsInf(slot.Max, 0) && slot.Max > 0 && slot.Current >= 0 && slot.Current <= slot.Max
}

func (s *genericRunState) foldOwnedRecoveryAmount(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) (float64, bool) {
	if value, static := s.formulas.FoldStatic(operation.AmountProgram); static {
		return value, true
	}
	if listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(s.compiled.Abilities) {
		return 0, false
	}
	ability := s.compiled.Abilities[listener.SourceAbilityIndex]
	provider := s.compiled.Providers[operation.OwnerProviderIndex]
	if ability.Kind != "passive_listener" || int(ability.ProviderIndex) != operation.OwnerProviderIndex || listener.SourceAbilityIndex < int(provider.AbilityStart) || listener.SourceAbilityIndex >= int(provider.AbilityStart)+int(provider.AbilityCount) {
		return 0, false
	}
	reads := s.formulas.ReadDependencies(operation.AmountProgram)
	if len(reads) == 0 {
		return 0, false
	}
	for _, read := range reads {
		value, present := ability.Params[read.ReadKey]
		if read.ReadKind != formula.ReadAbilityParam || read.ReadKey == "" || !present || math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, false
		}
	}
	value, err := s.formulas.Eval(operation.AmountProgram, formula.GenericEvalContext{StrictReads: true, AbilityParams: ability.Params})
	return value, err == nil
}

func (s *genericRunState) isOwnedAttackCooldownReduction(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	attack := s.req.DriverPlan.BasicAttack
	hitType, hitDeclared := s.compiled.RuntimeTypes.BasicAttackHit.Lookup()
	ownerType, ownerDeclared := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	if attack != nil && attack.Source != listener.OwnerCombatantKey || listener.OwnerCombatantKey != model.SelectorSource ||
		!hitDeclared || !ownerDeclared || !listener.EventMatcher.RequiresAllType(hitType) || !listener.EventMatcher.RequiresAllType(ownerType) ||
		operation.Target != model.SelectorSelf || operation.ValuePolicy != "reduce" || !operation.HasAmount || !operation.HasAbilityRef || operation.HasCondition {
		return false
	}
	amount, static := s.formulas.FoldStatic(operation.AmountProgram)
	if !static || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount > float64(maxJSONSafeInteger) || math.Trunc(amount) != amount {
		return false
	}
	ref := normalizeAbilityRef(operation.AbilityRefStr, listener.OwnerCombatantKey, opponentCombatantKey(listener.OwnerCombatantKey))
	for _, action := range s.plannedSkillSources() {
		binding := action.binding
		if binding.Source != listener.OwnerCombatantKey || binding.ProviderRef != listener.OwnerProviderRef || binding.SkillKey == "" {
			continue
		}
		index, exists := binding.ControlAbilityIndices["INITIAL"]
		if !exists || int(index) >= len(s.compiled.Abilities) {
			continue
		}
		ability := s.compiled.Abilities[index]
		if ability.Kind != "active" || ability.IsBasicAttack || ability.SkillKey != binding.SkillKey || ability.ProcessControl == nil ||
			ability.ProcessControl.Action != "INITIAL" || ability.ProcessControl.UseRefFromEvent || int(ability.ProviderIndex) != operation.OwnerProviderIndex ||
			ref != binding.Source+".provider["+binding.ProviderRef+"].ability["+ability.AbilityKey+"]" {
			continue
		}
		provider := s.compiled.Providers[ability.ProviderIndex]
		processIndex := ability.ProcessControl.ProcessIndex
		if provider.ProviderKey == binding.ProviderDefinitionRef && processIndex >= 0 && processIndex < len(provider.Processes) &&
			provider.Processes[processIndex].SkillKey == binding.SkillKey && provider.Processes[processIndex].Cooldown != nil {
			return true
		}
	}
	return false
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
			_, exists := s.combatants[recipient].attributes.Lookup(attributeKey)
			if !exists || attributeKey == "hp" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || modifier.HasCondition || !modifier.HasValue || !admissibleOwnedAttributePolicy(modifier) || definition.Lifecycle.TickIntervalMs != 0 {
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

func (s *genericRunState) validateEquipmentHitProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if provider.HasStateOnExpire {
		return s.validateStateOnExpireProvider(provider, owner, providerRef)
	}
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
		_, exists := s.combatants[owner].attributes.Lookup(attributeKey)
		if modifier.Kind != "attribute" || pipeline.ModifierTargetCombatantSelector(modifier.Target) != model.SelectorSelf || attributeKey == "hp" || !exists || modifier.HasCondition || !modifier.HasValue || !admissibleOwnedAttributePolicy(modifier) {
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
