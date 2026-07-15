package runtime

import (
	"tinygo_engine_v2/internal/model"
)

// scheduleProviderTargetStateExpiry enqueues a deterministic expire_cleanup for one
// provider_target state key. Stale events are dropped in handleExpireCleanup by matching
// owner + providerRef + targetKey + stateKey + expectedExpireAt.
func (s *genericRunState) scheduleProviderTargetStateExpiry(
	ownerKey, providerRef, targetKey, stateKey string,
	expireAt int64,
) {
	if s == nil || expireAt <= 0 || ownerKey == "" || providerRef == "" || stateKey == "" {
		return
	}
	s.enqueueExpireCleanup(expireAt, expireCleanupPayload{
		kind:             "provider_target_state",
		combatantKey:     ownerKey,
		providerRef:      providerRef,
		targetKey:        targetKey,
		stateKey:         stateKey,
		expectedExpireAt: expireAt,
	})
}

// applyProviderTargetStateExpiry clears one expired target-bound state key and re-resolves
// the affected target combatant's attributes so final snapshot/sample reflect restored armor
// without requiring another cast.
func (s *genericRunState) applyProviderTargetStateExpiry(payload expireCleanupPayload) {
	if payload.combatantKey == "" || payload.providerRef == "" || payload.stateKey == "" {
		return
	}
	owner, ok := s.combatants[payload.combatantKey]
	if !ok {
		return
	}
	bag := owner.providerState[payload.providerRef]
	if bag == nil {
		return
	}
	bag.ensure()
	// Stale after target switch or refresh: do not clear newer state.
	if bag.targetKey != payload.targetKey {
		return
	}
	if bag.targetExpireAt[payload.stateKey] != payload.expectedExpireAt {
		return
	}
	def, hasDef := bag.fieldDefs[payload.stateKey]
	defaultValue := 0.0
	if hasDef {
		defaultValue = def.defaultValue
	}
	bag.targetValues[payload.stateKey] = defaultValue
	bag.targetExpireAt[payload.stateKey] = 0
	owner.providerState[payload.providerRef] = bag
	s.combatants[payload.combatantKey] = owner

	affectedKey := payload.targetKey
	if affectedKey == "" {
		return
	}
	evalCtx := s.evalContextForCombatants(model.SelectorSource, model.SelectorTarget)
	if affected, ok := s.combatants[affectedKey]; ok {
		affected.attributes = s.resolveAttributesFor(affectedKey, affected.attributes, evalCtx, affectedKey)
		s.combatants[affectedKey] = affected
	}
	// Owner-side modifiers reading target_state (rare) also refresh.
	if payload.combatantKey != affectedKey {
		if own, ok := s.combatants[payload.combatantKey]; ok {
			own.attributes = s.resolveAttributesFor(payload.combatantKey, own.attributes, evalCtx, affectedKey)
			s.combatants[payload.combatantKey] = own
		}
	}
}
