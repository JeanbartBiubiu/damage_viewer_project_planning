package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *Engine) applyProviderSourceStateExpiry(payload effectpkg.ExpiryPayload) {
	if payload.StateGeneration > 0 {
		s.applyStateOnExpire(payload)
		return
	}
	actor, exists := s.combatants[payload.CombatantKey]
	if !exists {
		return
	}
	bag := actor.providerState.Lookup(payload.ProviderRef)
	if !bag.Present() || bag.ExpireAt().At(payload.StateKey) != payload.ExpectedExpireAt || payload.ExpectedExpireAt > s.loop.TimeMs() {
		return
	}
	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, model.SelectorSource, model.SelectorTarget, "state_expiry:"+payload.ProviderRef)
	frame := &frameStorage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.CombatantKey, payload.ProviderRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	staged := frame.stageFor(payload.CombatantKey)
	stagedBag := staged.providerState.Edit(payload.ProviderRef, false)
	stagedBag.SetStateValue(payload.StateKey, stagedBag.Fields().At(payload.StateKey).DefaultValue)
	stagedBag.SetExpireAt(payload.StateKey, 0)
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.recordEvidenceLazy("provider_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "provider_state_expired", Ref: payload.ProviderRef,
			Data: map[string]interface{}{"owner": payload.CombatantKey, "stateKey": payload.StateKey, "expectedExpireAt": payload.ExpectedExpireAt}}
	})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
