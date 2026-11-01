package execution

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	listenerpkg "tinygo_engine_v2/internal/runtime/execution/listener"
)

const (
	eventSourceOwner    = "event/source_owner"
	eventSourceOpponent = "event/source_opponent"
	eventTargetOwner    = "event/target_owner"
)

func (s *Engine) dispatchListeners(ev emittedEvent, chainDepth int) *model.EngineError {
	attachUseToSnapshot(&ev)
	if chainDepth > s.budget.MaxChainDepth {
		return s.budgetError(model.BudgetCauseMaxChainDepth, "max chain depth exceeded")
	}
	s.lazyExpireAllProviderState()
	collector := &eventCopyableCollector{}
	baseEventTypes := s.eventTypeSet(ev.types)
	// 编译监听器只读；动态监听器会在递归触发期间原地移除，仍需冻结副本。
	compiledListeners := s.compiled.Listeners
	runtimeListeners := s.listeners.FreezeDynamic()
	compiledCount := len(compiledListeners)
	listenerCount := compiledCount + len(runtimeListeners)
	listenerAt := func(index int) planbundle.CompiledListener {
		if index < compiledCount {
			return compiledListeners[index]
		}
		return runtimeListeners[index-compiledCount]
	}
	// 0表示没有冻结条件，1表示条件通过，2表示条件拒绝。
	var inlineConditions [16]uint8
	frozen := inlineConditions[:]
	if listenerCount > len(frozen) {
		frozen = make([]uint8, listenerCount)
	}
	for i := 0; i < listenerCount; i++ {
		listener := listenerAt(i)
		if !listener.HasCondition || !s.listenerMatchesEvent(listener, ev, baseEventTypes) {
			continue
		}
		ok, err := s.evalListenerCondition(listener, ev)
		if err != nil {
			return err
		}
		frozen[i] = 2
		if ok {
			frozen[i] = 1
		}
	}
	for listenerIndex := 0; listenerIndex < listenerCount; listenerIndex++ {
		listener := listenerAt(listenerIndex)
		if !s.listenerMatchesEvent(listener, ev, baseEventTypes) {
			continue
		}
		if frozen[listenerIndex] == 2 {
			s.recordEvidenceLazy(model.EvidenceKindListenerSkipped, func() model.EvidenceItem {
				return model.EvidenceItem{
					TimeMs: s.loop.TimeMs(),
					Kind:   model.EvidenceKindListenerSkipped,
					Ref:    listener.ListenerKey,
					Data:   map[string]interface{}{"reason": "condition_false"},
				}
			})
			continue
		}
		maxTriggers := listener.MaxTriggersPerEvent
		if maxTriggers <= 0 {
			maxTriggers = 1
		}
		if maxTriggers < 1 {
			continue
		}
		hasOps := listener.OperationCount > 0
		hasAbilityRef := listener.HasAbilityRef && listener.AbilityRef != ""
		if !hasOps && !hasAbilityRef {
			continue
		}
		castID := ev.castInstanceID
		if castID == 0 {
			castID = ev.snapshot.castInstanceID
		}
		if !s.listeners.Allow(listenerIndex, listener.OwnerCombatantKey, listener.OwnerProviderRef, castID, listener.PerCastThrottleMs, s.loop.TimeMs()) {
			continue
		}
		if listener.HasOncePerUse && listenerIndex >= compiledCount {
			return s.skillHitErr(model.GenericErrUnknownRef, "dynamic listeners do not support oncePerUse", "listeners["+listener.ListenerKey+"].oncePerUse", listener.OncePerUseGroup)
		}
		oncePerUse := listener.HasOncePerUse
		reserved := false
		if oncePerUse {
			didReserve, skip, err := s.reserveOncePerUse(listener, ev)
			if err != nil {
				return err
			}
			if skip {
				s.recordEvidenceLazy(model.EvidenceKindListenerSkipped, func() model.EvidenceItem {
					return model.EvidenceItem{
						TimeMs: s.loop.TimeMs(),
						Kind:   model.EvidenceKindListenerSkipped,
						Ref:    listener.ListenerKey,
						Data: map[string]interface{}{
							"reason":   "once_per_use",
							"groupKey": listener.OncePerUseGroup,
						},
					}
				})
				continue
			}
			reserved = didReserve
		}
		sourceKey, targetKey := listenerpkg.Combatants(ev.eventType, ev.sourceKey, ev.targetKey, listener.OwnerCombatantKey)
		// 子帧入口会各自冻结快照；这里仅补齐标量，不先重复复制一份相同快照。
		eventCtx := ev.snapshot
		if eventCtx.castInstanceID == 0 {
			eventCtx.castInstanceID = castID
		}
		if eventCtx.castOrigin == "" {
			eventCtx.castOrigin = ev.castOrigin
		}
		triggered := false
		if reserved {
			collector.reservation = &pendingUseReservation{listener: listener, event: ev}
		}
		for trigger := 0; trigger < maxTriggers; trigger++ {
			if hasOps {
				if err := s.dispatchListenerOperations(listener, sourceKey, targetKey, chainDepth, &eventCtx, collector); err != nil {
					s.releaseUncommittedUseReservation(collector.reservation)
					return err
				}
				triggered = true
			}
			if hasAbilityRef {
				resolvedChildRef := normalizeAbilityRef(listener.AbilityRef, sourceKey, targetKey)
				if _, blocked := s.cooldownGate(sourceKey, resolvedChildRef); blocked {
					continue
				}
				beforeCasts := s.abilityCastCount
				if err := s.castAbilityAt(sourceKey, targetKey, listener.AbilityRef, chainDepth, &eventCtx, collector, ""); err != nil {
					s.releaseUncommittedUseReservation(collector.reservation)
					return err
				}
				triggered = triggered || s.abilityCastCount > beforeCasts
			}
		}
		if reserved && triggered {
			s.commitOncePerUse(listener, ev)
		} else if reserved {
			s.releaseUncommittedUseReservation(collector.reservation)
		}
		collector.reservation = nil
		if triggered && listener.PerCastThrottleMs > 0 {
			s.listeners.Triggered(listenerIndex, listener.OwnerCombatantKey, listener.OwnerProviderRef, castID, s.loop.TimeMs())
		}
	}
	return s.flushDeferredPhantomReplay(collector)
}

func (s *Engine) listenerMatchesEvent(listener planbundle.CompiledListener, ev emittedEvent, baseEventTypes typeset.TypeSet) bool {
	facts := listenerpkg.EventMatchFacts{EventType: ev.eventType, SourceKey: ev.sourceKey, TargetKey: ev.targetKey,
		Types: baseEventTypes, MountLive: s.listenerStillLive(listener), HasBlockedHit: ev.skillHit != nil}
	if ev.skillHit != nil {
		facts.ShieldOwner, facts.ShieldProviderRef = ev.skillHit.shieldOwner, ev.skillHit.shieldProviderRef
	}
	return listenerpkg.Matches(listener, facts, s.compiled.RuntimeTypes)
}

func (s *Engine) dispatchListenerOperations(listener planbundle.CompiledListener, sourceKey, targetKey string, chainDepth int, eventCtx *eventFormulaSnapshot, collector *eventCopyableCollector) *model.EngineError {
	start := listener.OperationStart
	end := start + listener.OperationCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "listener operation range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]
	ability := planbundle.CompiledAbility{}
	if listener.SourceAbilityIndex >= 0 && listener.SourceAbilityIndex < len(s.compiled.Abilities) {
		ability = s.compiled.Abilities[listener.SourceAbilityIndex]
	}
	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, sourceKey, targetKey, "listener:"+listener.ListenerKey)
	frame := &frameStorage
	if listener.SourceAbilityIndex >= 0 && listener.SourceAbilityIndex < len(s.compiled.Abilities) {
		frame.abilityRef = listener.OwnerCombatantKey + ".provider[" + listener.OwnerProviderRef + "].ability[" + ability.AbilityKey + "]"
	}
	frame.strictReads = s.automatedRun() || listener.HasCondition || listener.HasOncePerUse
	frame.chainDepth = chainDepth
	frame.ownerCombatantKey = listener.OwnerCombatantKey
	frame.ownerProviderRef = listener.OwnerProviderRef
	frame.mountedListener = listener.OwnerCombatantKey != "" && listener.OwnerProviderRef != ""
	frame.readsDamageStateBefore = listener.ReadsDamageStateBefore
	frame.eventCtx = cloneEventSnapshot(eventCtx)
	frame.copyableCollector = collector
	// Listener Operations inherit triggering cast identity (do not mint).
	if eventCtx != nil {
		frame.castInstanceID = eventCtx.castInstanceID
		frame.castOrigin = eventCtx.castOrigin
	}
	if err := frame.executeOperations(ability, ops); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	return frame.dispatchPendingEvents()
}

func (s *Engine) eventTypeSet(keys []string) typeset.TypeSet {
	var set typeset.TypeSet
	for _, key := range keys {
		if key == "" {
			continue
		}
		if id, ok := s.compiled.Types.LookupForEntity(key, typeset.EntityListener); ok {
			set.Add(id)
		}
	}
	return set
}
