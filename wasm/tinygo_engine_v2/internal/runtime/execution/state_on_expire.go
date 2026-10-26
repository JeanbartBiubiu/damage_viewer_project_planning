package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

// A committed fact has a real callback in the queue: its state write and queue
// capacity are preflighted together. Keep the active value only at that exact
// deadline, until the callback commits or a real new write replaces its fact.

func (s *Engine) stateOnExpireBinding(payload effectpkg.ExpiryPayload) (plan.CompiledProviderStateField, bool) {
	actor, exists := s.combatants[payload.CombatantKey]
	if !exists || payload.Kind != "provider_source_state" || payload.StateGeneration == 0 || payload.ExpectedExpireAt <= 0 {
		return plan.CompiledProviderStateField{}, false
	}
	instance, _, mounted := actor.instances.Providers().Find(payload.ProviderRef)
	if !mounted || instance.Owner != payload.CombatantKey || instance.Source != payload.CombatantKey || instance.Expired(s.loop.TimeMs()) {
		return plan.CompiledProviderStateField{}, false
	}
	field := s.compiled.Providers[instance.DefinitionIndex].StateFields[payload.StateKey]
	bag := actor.providerState.Lookup(payload.ProviderRef)
	if field.OnExpireCount == 0 || !bag.Present() {
		return field, false
	}
	fact := bag.SourceExpiry(payload.StateKey)
	return field, fact.Generation == payload.StateGeneration && fact.Deadline == payload.ExpectedExpireAt
}

func (s *Engine) currentStateOnExpire(event scheduler.GenericEvent) bool {
	if event.Kind != scheduler.GenericEventExpireCleanup || event.DriverEntryIndex < 0 || event.DriverEntryIndex >= s.effectTimers.ExpiryCount() {
		return false
	}
	payload := s.effectTimers.ExpiryAt(event.DriverEntryIndex)
	_, current := s.stateOnExpireBinding(payload)
	return current && event.TimeMs == payload.ExpectedExpireAt
}

// 只有新到期回调排在同刻真实战斗之后；原清理事件与事件身份均不改。
func (s *Engine) selectCombatBeforeStateOnExpire(expiry scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError) {
	held := []scheduler.GenericEvent{expiry}
	selected, found := expiry, false
	for {
		at, ok := s.loop.Queue().PeekTime()
		if !ok || at != expiry.TimeMs {
			break
		}
		event, _ := s.loop.Queue().Pop()
		if event.Kind != scheduler.GenericEventSample && !s.currentStateOnExpire(event) {
			selected, found = event, true
			break
		}
		held = append(held, event)
	}
	if !found {
		held = held[1:]
	}
	for _, event := range held {
		if s.loop.Queue().Push(event) != model.ErrOK {
			return expiry, s.basicAttackErr("state expiry selection could not restore original events", "events")
		}
	}
	return selected, nil
}

func (s *Engine) applyStateOnExpire(payload effectpkg.ExpiryPayload) {
	field, current := s.stateOnExpireBinding(payload)
	if !current || payload.ExpectedExpireAt > s.loop.TimeMs() || s.combatantHp(payload.CombatantKey) <= 0 {
		return
	}
	var storage Frame
	s.initExecutionFrame(&storage, payload.CombatantKey, payload.CombatantKey, "state_expiry:"+payload.ProviderRef)
	f := &storage
	f.ownerCombatantKey, f.ownerProviderRef = payload.CombatantKey, payload.ProviderRef
	if err := f.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	bag := f.stageFor(payload.CombatantKey).providerState.Edit(payload.ProviderRef, false)
	bag.SetStateValue(payload.StateKey, field.DefaultValue)
	bag.SetExpireAt(payload.StateKey, 0)
	fact := bag.SourceExpiry(payload.StateKey)
	fact.Deadline = 0
	bag.SetSourceExpiry(payload.StateKey, fact)
	f.reResolveStagedAttributesTwoPass(plan.CompiledAbility{})
	ability := plan.CompiledAbility{}
	if err := f.executeOperations(ability, s.compiled.Operations[int(field.OnExpireStart):int(field.OnExpireStart)+int(field.OnExpireCount)]); err != nil {
		s.processFailure = err
		return
	}
	f.recordEvidenceLazy("provider_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "provider_state_expired", Ref: payload.ProviderRef, Data: map[string]interface{}{"owner": payload.CombatantKey, "stateKey": payload.StateKey, "expectedExpireAt": payload.ExpectedExpireAt}}
	})
	f.commit()
	if f.fatal {
		s.processFailure = f.fatalErr
		return
	}
	s.processFailure = f.dispatchPendingEvents()
}
