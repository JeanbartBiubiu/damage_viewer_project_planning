package runtime

import (
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func (s *genericRunState) applyProviderSourceStateExpiry(payload expireCleanupPayload) {
	actor, exists := s.combatants[payload.combatantKey]
	if !exists {
		return
	}
	bag := actor.providerState[payload.providerRef]
	if bag == nil || bag.expireAt[payload.stateKey] != payload.expectedExpireAt || payload.expectedExpireAt > s.nowMs {
		return
	}
	frame := s.newExecutionFrame(model.SelectorSource, model.SelectorTarget, "state_expiry:"+payload.providerRef)
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.combatantKey, payload.providerRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	staged := frame.stageFor(payload.combatantKey)
	stagedBag := staged.providerState[payload.providerRef]
	stagedBag.state[payload.stateKey] = stagedBag.fieldDefs[payload.stateKey].defaultValue
	stagedBag.expireAt[payload.stateKey] = 0
	frame.reResolveStagedAttributesTwoPass(compilebundle.CompiledAbility{})
	frame.recordEvidence(model.EvidenceItem{TimeMs: s.nowMs, Kind: "provider_state_expired", Ref: payload.providerRef,
		Data: map[string]interface{}{"owner": payload.combatantKey, "stateKey": payload.stateKey, "expectedExpireAt": payload.expectedExpireAt}})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
