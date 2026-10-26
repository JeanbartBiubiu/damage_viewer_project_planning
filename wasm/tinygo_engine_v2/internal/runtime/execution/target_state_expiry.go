package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// scheduleProviderTargetStateExpiry enqueues a deterministic expire_cleanup for one
// provider_target state key. Stale events are dropped in handleExpireCleanup by matching
// owner + providerRef + targetKey + stateKey + expectedExpireAt.
func (s *Engine) scheduleProviderTargetStateExpiry(
	ownerKey, providerRef, targetKey, stateKey string,
	expireAt int64,
) {
	if s == nil || expireAt <= 0 || ownerKey == "" || providerRef == "" || stateKey == "" {
		return
	}
	s.enqueueExpireCleanup(expireAt, effectpkg.ExpiryPayload{
		Kind:             "provider_target_state",
		CombatantKey:     ownerKey,
		ProviderRef:      providerRef,
		TargetKey:        targetKey,
		StateKey:         stateKey,
		ExpectedExpireAt: expireAt,
	})
}

// applyProviderTargetStateExpiry clears one expired target-bound state key and re-resolves
// the affected target combatant's attributes so final snapshot/sample reflect restored armor
// without requiring another cast.
func (s *Engine) applyProviderTargetStateExpiry(payload effectpkg.ExpiryPayload) {
	if payload.CombatantKey == "" || payload.ProviderRef == "" || payload.StateKey == "" {
		return
	}
	owner, ok := s.combatants[payload.CombatantKey]
	if !ok {
		return
	}
	bag := owner.providerState.Edit(payload.ProviderRef, false)
	if !bag.Present() {
		return
	}
	bag.Ensure()
	s.combatants[payload.CombatantKey] = owner
	// Stale after target switch or refresh: do not clear newer state.
	if bag.TargetKey() != payload.TargetKey {
		return
	}
	if bag.TargetExpireAt().At(payload.StateKey) != payload.ExpectedExpireAt {
		return
	}
	if payload.ExpectedExpireAt > s.loop.TimeMs() || payload.TargetKey == "" {
		return
	}
	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, payload.CombatantKey, payload.TargetKey, "target_state_expiry:"+payload.ProviderRef)
	frame := &frameStorage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.CombatantKey, payload.ProviderRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	staged := frame.stageFor(payload.CombatantKey)
	stagedBag := staged.providerState.Edit(payload.ProviderRef, false)
	stagedBag.SetTargetValue(payload.StateKey, stagedBag.Fields().At(payload.StateKey).DefaultValue)
	stagedBag.SetTargetExpireAt(payload.StateKey, 0)
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "provider_target_state_expired", Ref: payload.ProviderRef,
			Data: map[string]interface{}{"owner": payload.CombatantKey, "target": payload.TargetKey, "stateKey": payload.StateKey, "expectedExpireAt": payload.ExpectedExpireAt}}
	})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
