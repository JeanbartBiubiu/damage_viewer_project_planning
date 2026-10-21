package runtime

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
)

type sourceStateExpiryFact struct {
	generation uint64
	deadline   int64
}

// A committed fact has a real callback in the queue: its state write and queue
// capacity are preflighted together. Keep the active value only at that exact
// deadline, until the callback commits or a real new write replaces its fact.
func (b *providerStateBag) holdsSourceExpiryAt(key string, def providerStateFieldDef, nowMs, expireAt int64) bool {
	if !def.hasOnExpire || expireAt <= 0 || nowMs != expireAt || b.state[key] == def.defaultValue {
		return false
	}
	fact := b.sourceExpiryFacts[key]
	return fact.generation > 0 && fact.deadline == expireAt
}

func (b *providerStateBag) writableSourceExpiryFacts() map[string]sourceStateExpiryFact {
	if b.sourceExpiryFacts == nil || b.sourceExpiryFactsShared {
		copy := make(map[string]sourceStateExpiryFact, len(b.sourceExpiryFacts))
		for key, fact := range b.sourceExpiryFacts {
			copy[key] = fact
		}
		b.sourceExpiryFacts, b.sourceExpiryFactsShared = copy, false
	}
	return b.sourceExpiryFacts
}

func (b *providerStateBag) rearmSourceExpiry(key string, deadline int64) uint64 {
	fact := b.sourceExpiryFacts[key]
	fact.generation++
	fact.deadline = deadline
	b.writableSourceExpiryFacts()[key] = fact
	return fact.generation
}

func (s *genericRunState) stateOnExpireBinding(payload expireCleanupPayload) (plan.CompiledProviderStateField, bool) {
	actor, exists := s.combatants[payload.combatantKey]
	if !exists || payload.kind != "provider_source_state" || payload.stateGeneration == 0 || payload.expectedExpireAt <= 0 {
		return plan.CompiledProviderStateField{}, false
	}
	instance, _, mounted := status.FindByRef(actor.providers, payload.providerRef)
	if !mounted || instance.Owner != payload.combatantKey || instance.Source != payload.combatantKey || instance.Expired(s.nowMs) {
		return plan.CompiledProviderStateField{}, false
	}
	field := s.compiled.Providers[instance.DefinitionIndex].StateFields[payload.stateKey]
	bag := actor.providerState[payload.providerRef]
	if field.OnExpireCount == 0 || bag == nil {
		return field, false
	}
	fact := bag.sourceExpiryFacts[payload.stateKey]
	return field, fact.generation == payload.stateGeneration && fact.deadline == payload.expectedExpireAt
}

func (s *genericRunState) currentStateOnExpire(event scheduler.GenericEvent) bool {
	if event.Kind != scheduler.GenericEventExpireCleanup || event.DriverEntryIndex < 0 || event.DriverEntryIndex >= len(s.expireCleanupPayloads) {
		return false
	}
	payload := s.expireCleanupPayloads[event.DriverEntryIndex]
	_, current := s.stateOnExpireBinding(payload)
	return current && event.TimeMs == payload.expectedExpireAt
}

// 只有新到期回调排在同刻真实战斗之后；原清理事件与事件身份均不改。
func (s *genericRunState) selectCombatBeforeStateOnExpire(expiry scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError) {
	held := []scheduler.GenericEvent{expiry}
	selected, found := expiry, false
	for {
		at, ok := s.heap.PeekTime()
		if !ok || at != expiry.TimeMs {
			break
		}
		event, _ := s.heap.Pop()
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
		if s.heap.Push(event) != model.ErrOK {
			return expiry, s.basicAttackErr("state expiry selection could not restore original events", "events")
		}
	}
	return selected, nil
}

func (s *genericRunState) applyStateOnExpire(payload expireCleanupPayload) {
	field, current := s.stateOnExpireBinding(payload)
	if !current || payload.expectedExpireAt > s.nowMs || s.combatantHp(payload.combatantKey) <= 0 {
		return
	}
	var storage executionFrame
	s.initExecutionFrame(&storage, payload.combatantKey, payload.combatantKey, "state_expiry:"+payload.providerRef)
	f := &storage
	f.ownerCombatantKey, f.ownerProviderRef = payload.combatantKey, payload.providerRef
	if err := f.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	bag := writableProviderStateBag(f.stageFor(payload.combatantKey).writableProviderStates(), payload.providerRef, false)
	bag.writableState()[payload.stateKey], bag.writableExpireAt()[payload.stateKey] = field.DefaultValue, 0
	fact := bag.sourceExpiryFacts[payload.stateKey]
	fact.deadline = 0
	bag.writableSourceExpiryFacts()[payload.stateKey] = fact
	f.reResolveStagedAttributesTwoPass(plan.CompiledAbility{})
	ability := plan.CompiledAbility{}
	if err := f.executeOperations(ability, s.compiled.Operations[int(field.OnExpireStart):int(field.OnExpireStart)+int(field.OnExpireCount)]); err != nil {
		s.processFailure = err
		return
	}
	f.recordEvidenceLazy("provider_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.nowMs, Kind: "provider_state_expired", Ref: payload.providerRef, Data: map[string]interface{}{"owner": payload.combatantKey, "stateKey": payload.stateKey, "expectedExpireAt": payload.expectedExpireAt}}
	})
	f.commit()
	if f.fatal {
		s.processFailure = f.fatalErr
		return
	}
	s.processFailure = f.dispatchPendingEvents()
}
