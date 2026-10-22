package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func validateImmediatePeriodicRefundFreshSnapshot(compiled planbundle.CompiledSession, request model.RunRequest) *model.EngineError {
	bad := func(path string) *model.EngineError {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "immediate finite periods and total cooldown refunds require a fresh snapshot with no imported cooldown provenance", path, "", compiled.SchemaHash, compiled.RulesHash, request.SessionID)
	}
	if request.InitialSnapshot.TimeMs != 0 || len(request.InitialSnapshot.ProcessInstances) != 0 {
		return bad("initialSnapshot")
	}
	for _, actor := range request.InitialSnapshot.Combatants {
		if compiled.HasTotalCooldownRefund && len(actor.Cooldowns) != 0 {
			return bad("initialSnapshot.combatants.cooldowns")
		}
		for _, instance := range actor.Providers {
			for _, provider := range compiled.Providers {
				if provider.ProviderKey != instance.DefinitionRef {
					continue
				}
				if tick, exists := findTickAbility(provider, compiled); exists && tick.TickSpec != nil && tick.TickSpec.ImmediateFirst {
					return bad("initialSnapshot.combatants.providers")
				}
			}
		}
	}
	return nil
}

func (f *executionFrame) validateImmediatePeriodicApplication(operation planbundle.CompiledOperation) *model.EngineError {
	if !f.run.compiled.HasImmediatePeriodic {
		return nil
	}
	index, exists := f.run.findProviderDefinitionIndex(operation.ProviderDefinitionRef)
	if !exists {
		return nil
	} // The existing apply-provider path reports the unknown definition.
	ability, hasTick := findTickAbility(f.run.compiled.Providers[index], f.run.compiled)
	if !hasTick || ability.TickSpec == nil || !ability.TickSpec.ImmediateFirst {
		return nil
	}
	p := f.pendingProcess
	if p == nil || f.processMomentKind != "PROCESS_START" || operation.OwnerProviderIndex != int(p.ability.ProviderIndex) || operation.Target != model.SelectorSelf || f.ownerCombatantKey != p.Owner || f.ownerProviderRef != p.ProviderRef || p.Target != opponentCombatantKey(p.Owner) || !f.run.plannedSkillProvider(p.Owner, p.ProviderRef) {
		return f.run.processErr(operation.Path, "immediate finite period requires its actual planned source process start", operation.ProviderDefinitionRef)
	}
	return nil
}

// The ordinary (non-projected) commit path must retain the same accepted-use
// provenance as the existing dynamic projection. No target is inferred from a
// background attack, and ticks do not acquire a synthetic active-use identity.
func (s *genericRunState) bindImmediatePeriodicUse(owner, source, definition, use string) {
	index, exists := s.findProviderDefinitionIndex(definition)
	if !exists {
		return
	}
	ability, tick := findTickAbility(s.compiled.Providers[index], s.compiled)
	if !tick || ability.TickSpec == nil || !ability.TickSpec.ImmediateFirst {
		return
	}
	c := s.combatants[owner]
	for i, instance := range c.providers {
		if instance.DefinitionRef == definition && instance.Source == source && instance.Owner == owner && !instance.Expired(s.nowMs) {
			c.writableProviders()[i].ActivationUseRef = use
			s.combatants[owner] = c
			return
		}
	}
}

func (s *genericRunState) isOwnedTotalCooldownRefund(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	target := operation.TotalCooldownTarget
	if operation.ValuePolicy != "reduce_total_ratio" || target == nil || listener.OperationCount != 1 || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || operation.Target != model.SelectorSelf || operation.HasCondition || listener.OwnerCombatantKey != target.CombatantKey || listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(s.compiled.Abilities) {
		return false
	}
	damage, hasDamage := s.compiled.RuntimeTypes.DamageInstance.Lookup()
	owner, hasOwner := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	if !hasDamage || !hasOwner || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(owner) {
		return false
	}
	ability := s.compiled.Abilities[listener.SourceAbilityIndex]
	if int(ability.ProviderIndex) != operation.OwnerProviderIndex || ability.Kind != "passive_listener" {
		return false
	}
	mounts := 0
	for _, actor := range s.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			if actor.Key == listener.OwnerCombatantKey && mount.ProviderRef == listener.OwnerProviderRef && mount.DefinitionIndex == ability.ProviderIndex {
				mounts++
			}
		}
	}
	if mounts != 1 {
		return false
	}
	for _, action := range s.plannedSkillSources() {
		binding := action.binding
		if binding.Source == target.CombatantKey && binding.ProviderRef == target.ProviderRef && binding.InitialAbilityIndex == target.AbilityIndex && s.compiled.Abilities[target.AbilityIndex].ProviderIndex == target.ProviderIndex && binding.ProviderDefinitionRef == s.compiled.Providers[target.ProviderIndex].ProviderKey {
			return true
		}
	}
	return false
}

func (f *executionFrame) applyTotalCooldownRatioRefund(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	target, event := operation.TotalCooldownTarget, f.eventCtx
	if target == nil || !f.mountedListener || event == nil || !event.hasDamageSnapshot || event.eventType != eventTypeDamageInstance || event.eventSourceKey != f.ownerCombatantKey || target.CombatantKey != f.ownerCombatantKey || int(ability.ProviderIndex) != operation.OwnerProviderIndex {
		return f.run.processErr(operation.Path, "total cooldown refund requires its actual owned settled packet and compiled INITIAL target", operation.AbilityRefStr)
	}
	id := genericAbilityCooldownIdentity(target.CombatantKey, operation.AbilityRefStr)
	ledger := f.stageFor(target.CombatantKey).cooldowns
	if ledger.remaining(id, f.run.nowMs) == 0 {
		return nil
	}
	entry := ledger.entryValue(id)
	if !entry.hasOrdinaryTotal || entry.ordinaryTotalMs <= 0 || entry.ordinaryTotalMs > maxJSONSafeInteger {
		return f.run.processErr(operation.Path, "active ordinary cooldown has no real committed total duration", operation.AbilityRefStr)
	}
	refund := math.Round(float64(entry.ordinaryTotalMs) * operation.TotalCooldownRatio)
	if math.IsNaN(refund) || math.IsInf(refund, 0) || refund < 0 || refund > float64(maxJSONSafeInteger) {
		return f.run.processErr(operation.Path, "total cooldown refund is not finite nonnegative safe milliseconds", operation.AbilityRefStr)
	}
	if refund == 0 {
		return nil
	}
	readyAt := entry.readyAt - int64(refund)
	if readyAt < f.run.nowMs {
		readyAt = f.run.nowMs
	}
	return f.applyCooldownChange(target.CombatantKey, operation.AbilityRefStr, readyAt)
}
