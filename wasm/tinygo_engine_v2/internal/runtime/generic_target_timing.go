package runtime

import (
	"fmt"
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
)

// Facts are bounded by the compiled source's at most three phases and one
// reservation. No owner/provider/target string composite is hashed per event.
type targetTimingFact struct {
	key                       string
	generation                uint64
	origin, expiry, scheduled int64
	active, protect           bool
}
type targetTimingState [4]targetTimingFact

func (b *providerStateBag) writableTargetTiming() *targetTimingState {
	if b.timing == nil {
		b.timing = &targetTimingState{}
		b.timingShared = false
	} else if b.timingShared {
		copy := *b.timing
		b.timing = &copy
		b.timingShared = false
	}
	return b.timing
}

func (s *genericRunState) targetTimingBinding(owner, ref, key string) (status.ProviderInstance, int, planbundle.CompiledTargetTiming, bool) {
	actor, ok := s.combatants[owner]
	if !ok {
		return status.ProviderInstance{}, 0, planbundle.CompiledTargetTiming{}, false
	}
	inst, _, ok := status.FindByRef(actor.providers, ref)
	if !ok || inst.Owner != owner || inst.Source != owner || inst.Expired(s.nowMs) || int(inst.DefinitionIndex) >= len(s.compiled.Providers) {
		return inst, 0, planbundle.CompiledTargetTiming{}, false
	}
	for slot, timing := range s.compiled.Providers[inst.DefinitionIndex].TargetTimings {
		if timing.StateKey == key {
			return inst, slot, timing, true
		}
	}
	return inst, 0, planbundle.CompiledTargetTiming{}, false
}

func (f *executionFrame) stageTargetTimingWrite(owner, ref, target, key string, value float64, expires int64, bag *providerStateBag) (bool, *model.EngineError) {
	if !f.run.compiled.HasTargetTiming {
		return false, nil
	}
	inst, slot, timing, found := f.run.targetTimingBinding(owner, ref, key)
	if !found {
		return false, nil
	}
	if target == "" || bag == nil || slot >= 4 {
		return true, f.run.basicAttackErr("target timing requires its actual target and bounded slot", key)
	}
	bag.writableTargetTiming()
	old := bag.timing[slot]
	if old.generation == math.MaxUint64 {
		return true, f.run.basicAttackErr("target timing generation overflow", key)
	}
	fact := targetTimingFact{key: key, generation: old.generation + 1, origin: f.run.nowMs, expiry: expires, active: value > 0 && expires > f.run.nowMs}
	bag.writableTargetTiming()[slot] = fact
	if !fact.active {
		bag.writableTargetExpireAt()[key] = 0
		return true, nil
	}
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: expires, payload: expireCleanupPayload{kind: "target_timing", combatantKey: owner, providerRef: ref, targetKey: target, stateKey: key, stateGeneration: fact.generation, expectedExpireAt: expires, timingSlot: slot}})
	if timing.Phased {
		if err := f.stageTargetPhases(inst, slot, timing, bag, 0); err != nil {
			return true, err
		}
	}
	return true, nil
}

func (f *executionFrame) stageTargetPhases(inst status.ProviderInstance, slot int, timing planbundle.CompiledTargetTiming, bag *providerStateBag, after int64) *model.EngineError {
	fact := bag.timing[slot]
	a := f.run.compiled.Abilities[timing.AbilityIndex]
	if a.TickSpec == nil || a.TickSpec.IntervalMs <= 0 {
		return f.run.basicAttackErr("phased timing lacks its actual compiled interval", timing.StateKey)
	}
	interval := a.TickSpec.IntervalMs
	end := fact.expiry
	if stop := f.run.startMs + f.run.durationMs; end > stop {
		end = stop
	}
	last := int64(0)
	if end > fact.origin {
		last = (end - fact.origin) / interval
	}
	first := fact.scheduled + 1
	if first < 1 {
		first = 1
	}
	if after > fact.origin {
		if n := (after-fact.origin)/interval + 1; n > first {
			first = n
		}
	}
	count := last - first + 1
	if count > int64(f.run.heap.RemainingCapacity()-len(f.pendingAnchoredTicks)-len(f.pendingStateExpiry)) {
		return f.run.budgetError(model.BudgetCauseMaxQueueEvents, "phased target tick queue overflow")
	}
	for ordinal := first; ordinal <= last; ordinal++ {
		at := fact.origin + ordinal*interval
		f.pendingAnchoredTicks = append(f.pendingAnchoredTicks, pendingFrameAnchoredTick{at: at, payload: anchoredTickPayload{phased: true, timingSlot: slot, ownerKey: inst.Owner, providerRef: inst.ProviderRef, sourceKey: inst.Source, targetKey: bag.targetKey, anchorStateKey: timing.StateKey, generation: fact.generation, expectedExpireAt: fact.expiry}})
	}
	if last > fact.scheduled {
		fact.scheduled = last
	}
	fact.protect = last > 0 && fact.origin+last*interval == fact.expiry && fact.expiry <= end
	bag.writableTargetTiming()[slot] = fact
	return nil
}

func (f *executionFrame) ensurePhasedTargetRemaining(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	owner := f.providerOwnerKey()
	inst, slot, timing, exists := f.run.targetTimingBinding(owner, f.ownerProviderRef, op.Ref)
	if !exists || !timing.Phased || op.Target != "self" || op.StateScope != stateScopeProviderTarget || int(inst.DefinitionIndex) != op.OwnerProviderIndex || !f.mountedListener || f.eventCtx == nil || f.eventCtx.eventType != model.EventTypeSkillHit || f.eventCtx.eventSourceKey != owner || f.eventCtx.skillHit == nil || f.eventCtx.skillHit.blocked != 0 {
		return f.run.basicAttackErr("phase preserving extension requires its actual unblocked owner skill hit and phased anchor", op.Path)
	}
	bag := f.providerStateBagForRead(owner, f.ownerProviderRef, false, providerStateReadOptions{})
	if bag == nil || bag.timing == nil || bag.targetStateRemainingMs(op.Ref, f.targetKey, f.run.nowMs) == 0 || !bag.timing[slot].active {
		return nil
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !validStateInteger(amount) || amount <= 0 {
		return f.run.basicAttackErr("phase extension requires positive safe integer milliseconds", op.Path)
	}
	next, ok := addDuration(f.run.nowMs, int64(amount))
	if !ok {
		return f.run.basicAttackErr("phase extension timestamp overflow", op.Path)
	}
	if next <= bag.targetExpireAt[op.Ref] {
		return nil
	}
	bag = f.providerStateBag(owner, f.ownerProviderRef, false)
	prior := bag.timing[slot].expiry
	fact := bag.timing[slot]
	fact.expiry, fact.protect = next, false
	bag.writableTargetTiming()[slot] = fact
	bag.writableTargetExpireAt()[op.Ref] = next
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: next, payload: expireCleanupPayload{kind: "target_timing", combatantKey: owner, providerRef: f.ownerProviderRef, targetKey: f.targetKey, stateKey: op.Ref, stateGeneration: fact.generation, expectedExpireAt: next, timingSlot: slot}})
	if err := f.stageTargetPhases(inst, slot, timing, bag, prior); err != nil {
		return err
	}
	f.stageFor(owner).dirty = true
	return nil
}

func (s *genericRunState) phasedFact(payload anchoredTickPayload) (status.ProviderInstance, planbundle.CompiledTargetTiming, *providerStateBag, targetTimingFact, bool) {
	inst, slot, timing, exists := s.targetTimingBinding(payload.ownerKey, payload.providerRef, payload.anchorStateKey)
	if !exists || !timing.Phased || slot != payload.timingSlot || payload.sourceKey != inst.Source {
		return inst, timing, nil, targetTimingFact{}, false
	}
	bag := s.combatants[payload.ownerKey].providerState[payload.providerRef]
	if bag == nil || bag.timing == nil || bag.targetKey != payload.targetKey {
		return inst, timing, bag, targetTimingFact{}, false
	}
	fact := bag.timing[slot]
	return inst, timing, bag, fact, fact.active && fact.generation == payload.generation && fact.key == payload.anchorStateKey
}

func (s *genericRunState) phasedTerminal(event scheduler.GenericEvent, payload anchoredTickPayload) bool {
	_, timing, _, fact, valid := s.phasedFact(payload)
	if !valid || fact.expiry != event.TimeMs || !fact.protect || event.TimeMs <= fact.origin {
		return false
	}
	interval := s.compiled.Abilities[timing.AbilityIndex].TickSpec.IntervalMs
	return interval > 0 && (event.TimeMs-fact.origin)%interval == 0
}

func (s *genericRunState) handlePhasedTick(event scheduler.GenericEvent, payload anchoredTickPayload) *model.EngineError {
	if event.TimeMs == payload.expectedExpireAt && s.anchoredTerminalAt[event.TimeMs] > 0 {
		s.anchoredTerminalAt[event.TimeMs]--
		if s.anchoredTerminalAt[event.TimeMs] == 0 {
			delete(s.anchoredTerminalAt, event.TimeMs)
		}
	}
	inst, timing, _, fact, valid := s.phasedFact(payload)
	if !valid || event.TimeMs > fact.expiry {
		return nil
	}
	ability := s.compiled.Abilities[timing.AbilityIndex]
	interval := ability.TickSpec.IntervalMs
	if interval <= 0 || event.TimeMs <= fact.origin || (event.TimeMs-fact.origin)%interval != 0 {
		return nil
	}
	var frame executionFrame
	s.initExecutionFrame(&frame, inst.Source, payload.targetKey, fmt.Sprintf("%s.provider[%s].ability[%s]", inst.Owner, inst.ProviderRef, ability.AbilityKey))
	frame.ownerCombatantKey, frame.ownerProviderRef = inst.Owner, inst.ProviderRef
	frame.castInstanceID, frame.castOrigin = s.mintCastInstanceID(), ability.CastOrigin
	frame.strictReads = true
	spec := ability.TickSpec
	if err := frame.executeOperations(ability, s.compiled.Operations[int(spec.OnTickStart):int(spec.OnTickStart)+int(spec.OnTickCount)]); err != nil {
		return err
	}
	if event.TimeMs == fact.expiry {
		if err := frame.stageTargetTimingClear(inst.Owner, inst.ProviderRef, payload.targetKey, payload.anchorStateKey, payload.timingSlot, payload.generation, fact.expiry); err != nil {
			return err
		}
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	s.recordEvidenceLazy(model.EvidenceKindProviderTick, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.nowMs, Kind: model.EvidenceKindProviderTick, Ref: inst.ProviderRef, Data: map[string]interface{}{"combatantKey": inst.Owner, "providerRef": inst.ProviderRef, "definitionRef": inst.DefinitionRef, "targetKey": payload.targetKey, "anchorStateKey": payload.anchorStateKey, "generation": payload.generation, "anchored": true}}
	})
	return nil
}

func (f *executionFrame) stageTargetTimingClear(owner, ref, target, key string, slot int, gen uint64, expiry int64) *model.EngineError {
	bag := f.providerStateBag(owner, ref, false)
	if bag == nil || bag.timing == nil || bag.targetKey != target || bag.timing[slot].generation != gen || !bag.timing[slot].active || bag.timing[slot].expiry != expiry {
		return nil
	}
	if err := f.consumeCommands(1); err != nil {
		return err
	}
	fact := bag.timing[slot]
	fact.active, fact.protect = false, false
	bag.writableTargetTiming()[slot] = fact
	bag.writableTargetValues()[key] = bag.fieldDefs[key].defaultValue
	bag.writableTargetExpireAt()[key] = 0
	f.stageFor(owner).dirty = true
	f.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "provider_target_state_expired", Ref: ref, Data: map[string]interface{}{"owner": owner, "target": target, "stateKey": key, "expectedExpireAt": expiry}}
	})
	return nil
}

func (s *genericRunState) currentTargetTimingExpiry(event scheduler.GenericEvent) bool {
	return event.Kind == scheduler.GenericEventExpireCleanup && event.DriverEntryIndex >= 0 && event.DriverEntryIndex < len(s.expireCleanupPayloads) && s.expireCleanupPayloads[event.DriverEntryIndex].kind == "target_timing"
}

func (s *genericRunState) applyTargetTimingExpiry(payload expireCleanupPayload) {
	inst, slot, timing, exists := s.targetTimingBinding(payload.combatantKey, payload.providerRef, payload.stateKey)
	if !exists || slot != payload.timingSlot {
		return
	}
	bag := s.combatants[inst.Owner].providerState[inst.ProviderRef]
	if bag == nil || bag.timing == nil || bag.targetKey != payload.targetKey {
		return
	}
	fact := bag.timing[slot]
	if !fact.active || fact.generation != payload.stateGeneration || fact.expiry != payload.expectedExpireAt || s.nowMs != fact.expiry {
		return
	}
	ability := s.compiled.Abilities[timing.AbilityIndex]
	var frame executionFrame
	s.initExecutionFrame(&frame, inst.Source, payload.targetKey, fmt.Sprintf("%s.provider[%s].ability[%s]", inst.Owner, inst.ProviderRef, ability.AbilityKey))
	frame.ownerCombatantKey, frame.ownerProviderRef = inst.Owner, inst.ProviderRef
	frame.castInstanceID, frame.castOrigin = s.mintCastInstanceID(), ability.CastOrigin
	frame.strictReads = true
	if err := frame.stageTargetTimingClear(inst.Owner, inst.ProviderRef, payload.targetKey, payload.stateKey, slot, payload.stateGeneration, fact.expiry); err != nil {
		s.processFailure = err
		return
	}
	if !timing.Phased {
		x := ability.TargetExpirySpec
		if x == nil {
			s.processFailure = s.basicAttackErr("target expiry lacks its actual compiled payload", payload.stateKey)
			return
		}
		if err := frame.executeOperations(ability, s.compiled.Operations[int(x.OnExpireStart):int(x.OnExpireStart)+int(x.OnExpireCount)]); err != nil {
			s.processFailure = err
			return
		}
	}
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
		return
	}
	s.processFailure = frame.dispatchPendingEvents()
}

func (s *genericRunState) validateTargetTimingFresh() *model.EngineError {
	if !s.compiled.HasTargetTiming {
		return nil
	}
	for owner, actor := range s.combatants {
		for _, instance := range actor.providers {
			if int(instance.DefinitionIndex) >= len(s.compiled.Providers) || len(s.compiled.Providers[instance.DefinitionIndex].TargetTimings) == 0 {
				continue
			}
			matches := 0
			for _, declared := range s.compiled.Combatants {
				if declared.Key != owner {
					continue
				}
				for _, mount := range declared.ProviderMounts {
					if mount.ProviderRef == instance.ProviderRef && mount.DefinitionIndex == instance.DefinitionIndex {
						matches++
					}
				}
			}
			if matches != 1 || instance.Owner != owner || instance.Source != owner || instance.ExpireAt != 0 || instance.Stacks != 1 {
				return s.basicAttackErr("target timing requires its exact unique permanent initial owner mount", "initialSnapshot.combatants.providers")
			}
		}
	}
	for _, actor := range s.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			p := s.compiled.Providers[mount.DefinitionIndex]
			if len(p.TargetTimings) == 0 {
				continue
			}
			instance, _, present := status.FindByRef(s.combatants[actor.Key].providers, mount.ProviderRef)
			if !present || instance.DefinitionIndex != mount.DefinitionIndex {
				return s.basicAttackErr("target timing initial mount is missing or has a foreign definition", "initialSnapshot.combatants.providers")
			}
			bag := s.combatants[actor.Key].providerState[mount.ProviderRef]
			if bag == nil {
				continue
			}
			valid := bag.targetKey == ""
			for key, value := range bag.state {
				field, ok := p.StateFields[key]
				valid = valid && ok && value == field.DefaultValue
			}
			for _, value := range bag.targetValues {
				valid = valid && value == 0
			}
			for _, value := range bag.expireAt {
				valid = valid && value == 0
			}
			for _, value := range bag.targetExpireAt {
				valid = valid && value == 0
			}
			if !valid {
				return s.basicAttackErr("target timing only accepts fresh default state before timer restoration", "initialSnapshot.combatants.providerState")
			}
		}
	}
	return nil
}
