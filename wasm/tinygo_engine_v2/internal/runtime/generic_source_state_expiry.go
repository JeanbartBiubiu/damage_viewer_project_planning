package runtime

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *genericRunState) applyProviderSourceStateExpiry(payload expireCleanupPayload) {
	if payload.stateGeneration > 0 {
		s.applyStateOnExpire(payload)
		return
	}
	actor, exists := s.combatants[payload.combatantKey]
	if !exists {
		return
	}
	bag := actor.providerState[payload.providerRef]
	if bag == nil || bag.expireAt[payload.stateKey] != payload.expectedExpireAt || payload.expectedExpireAt > s.nowMs {
		return
	}
	var frameStorage executionFrame
	s.initExecutionFrame(&frameStorage, model.SelectorSource, model.SelectorTarget, "state_expiry:"+payload.providerRef)
	frame := &frameStorage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.combatantKey, payload.providerRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	staged := frame.stageFor(payload.combatantKey)
	stagedBag := writableProviderStateBag(staged.writableProviderStates(), payload.providerRef, false)
	stagedBag.writableState()[payload.stateKey] = stagedBag.fieldDefs[payload.stateKey].defaultValue
	stagedBag.writableExpireAt()[payload.stateKey] = 0
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.recordEvidenceLazy("provider_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.nowMs, Kind: "provider_state_expired", Ref: payload.providerRef,
			Data: map[string]interface{}{"owner": payload.combatantKey, "stateKey": payload.stateKey, "expectedExpireAt": payload.expectedExpireAt}}
	})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
