package runtime

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
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
	bag := writableProviderStateBag(owner.writableProviderStates(), payload.providerRef, false)
	if bag == nil {
		return
	}
	bag.ensure()
	s.combatants[payload.combatantKey] = owner
	// Stale after target switch or refresh: do not clear newer state.
	if bag.targetKey != payload.targetKey {
		return
	}
	if bag.targetExpireAt[payload.stateKey] != payload.expectedExpireAt {
		return
	}
	if payload.expectedExpireAt > s.nowMs || payload.targetKey == "" {
		return
	}
	var frameStorage executionFrame
	s.initExecutionFrame(&frameStorage, payload.combatantKey, payload.targetKey, "target_state_expiry:"+payload.providerRef)
	frame := &frameStorage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.combatantKey, payload.providerRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	staged := frame.stageFor(payload.combatantKey)
	stagedBag := writableProviderStateBag(staged.writableProviderStates(), payload.providerRef, false)
	stagedBag.writableTargetValues()[payload.stateKey] = stagedBag.fieldDefs[payload.stateKey].defaultValue
	stagedBag.writableTargetExpireAt()[payload.stateKey] = 0
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.nowMs, Kind: "provider_target_state_expired", Ref: payload.providerRef,
			Data: map[string]interface{}{"owner": payload.combatantKey, "target": payload.targetKey, "stateKey": payload.stateKey, "expectedExpireAt": payload.expectedExpireAt}}
	})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
