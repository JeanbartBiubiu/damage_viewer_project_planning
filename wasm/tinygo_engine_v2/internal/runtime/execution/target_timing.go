package execution

import (
	"fmt"
	"math"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

// Facts are bounded by the compiled source's at most three phases and one
// reservation. No owner/provider/target string composite is hashed per event.

func (s *Engine) targetTimingBinding(owner, ref, key string) (effectpkg.Provider, int, planbundle.CompiledTargetTiming, bool) {
	actor, ok := s.combatants[owner]
	if !ok {
		return effectpkg.Provider{}, 0, planbundle.CompiledTargetTiming{}, false
	}
	inst, _, ok := actor.instances.Providers().Find(ref)
	if !ok || inst.Owner != owner || inst.Source != owner || inst.Expired(s.loop.TimeMs()) || int(inst.DefinitionIndex) >= len(s.compiled.Providers) {
		return inst, 0, planbundle.CompiledTargetTiming{}, false
	}
	for slot, timing := range s.compiled.Providers[inst.DefinitionIndex].TargetTimings {
		if timing.StateKey == key {
			return inst, slot, timing, true
		}
	}
	return inst, 0, planbundle.CompiledTargetTiming{}, false
}

func (f *Frame) stageTargetTimingWrite(owner, ref, target, key string, value float64, expires int64, bag effectpkg.BagChange) (bool, *model.EngineError) {
	if !f.run.compiled.HasTargetTiming {
		return false, nil
	}
	inst, slot, timing, found := f.run.targetTimingBinding(owner, ref, key)
	if !found {
		return false, nil
	}
	if target == "" || !bag.Present() || slot >= 4 {
		return true, f.run.basicAttackErr("target timing requires its actual target and bounded slot", key)
	}
	old := bag.Timing(slot)
	if old.Generation == math.MaxUint64 {
		return true, f.run.basicAttackErr("target timing generation overflow", key)
	}
	fact := effectpkg.TimingFact{Key: key, Generation: old.Generation + 1, Origin: f.run.loop.TimeMs(), Expiry: expires, Active: value > 0 && expires > f.run.loop.TimeMs()}
	bag.SetTiming(slot, fact)
	if !fact.Active {
		bag.SetTargetExpireAt(key, 0)
		return true, nil
	}
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: expires, payload: effectpkg.ExpiryPayload{Kind: "target_timing", CombatantKey: owner, ProviderRef: ref, TargetKey: target, StateKey: key, StateGeneration: fact.Generation, ExpectedExpireAt: expires, TimingSlot: slot}})
	if timing.Phased {
		if err := f.stageTargetPhases(inst, slot, timing, bag, 0); err != nil {
			return true, err
		}
	}
	return true, nil
}

func (f *Frame) stageTargetPhases(inst effectpkg.Provider, slot int, timing planbundle.CompiledTargetTiming, bag effectpkg.BagChange, after int64) *model.EngineError {
	fact := bag.Timing(slot)
	a := f.run.compiled.Abilities[timing.AbilityIndex]
	if a.TickSpec == nil || a.TickSpec.IntervalMs <= 0 {
		return f.run.basicAttackErr("phased timing lacks its actual compiled interval", timing.StateKey)
	}
	interval := a.TickSpec.IntervalMs
	end := fact.Expiry
	if stop := f.run.loop.StartMs() + f.run.loop.DurationMs(); end > stop {
		end = stop
	}
	last := int64(0)
	if end > fact.Origin {
		last = (end - fact.Origin) / interval
	}
	first := fact.Scheduled + 1
	if first < 1 {
		first = 1
	}
	if after > fact.Origin {
		if n := (after-fact.Origin)/interval + 1; n > first {
			first = n
		}
	}
	count := last - first + 1
	if count > int64(f.run.loop.Queue().RemainingCapacity()-len(f.pendingAnchoredTicks)-len(f.pendingStateExpiry)) {
		return f.run.budgetError(model.BudgetCauseMaxQueueEvents, "phased target tick queue overflow")
	}
	for ordinal := first; ordinal <= last; ordinal++ {
		at := fact.Origin + ordinal*interval
		f.pendingAnchoredTicks = append(f.pendingAnchoredTicks, pendingFrameAnchoredTick{at: at, payload: effectpkg.AnchoredPayload{Phased: true, TimingSlot: slot, OwnerKey: inst.Owner, ProviderRef: inst.ProviderRef, SourceKey: inst.Source, TargetKey: bag.TargetKey(), AnchorStateKey: timing.StateKey, Generation: fact.Generation, ExpectedExpireAt: fact.Expiry}})
	}
	if last > fact.Scheduled {
		fact.Scheduled = last
	}
	fact.Protect = last > 0 && fact.Origin+last*interval == fact.Expiry && fact.Expiry <= end
	bag.SetTiming(slot, fact)
	return nil
}

func (f *Frame) ensurePhasedTargetRemaining(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	owner := f.providerOwnerKey()
	inst, slot, timing, exists := f.run.targetTimingBinding(owner, f.ownerProviderRef, op.Ref)
	if !exists || !timing.Phased || op.Target != "self" || op.StateScope != stateScopeProviderTarget || int(inst.DefinitionIndex) != op.OwnerProviderIndex || !f.mountedListener || f.eventCtx == nil || f.eventCtx.eventType != model.EventTypeSkillHit || f.eventCtx.eventSourceKey != owner || f.eventCtx.skillHit == nil || f.eventCtx.skillHit.blocked != 0 {
		return f.run.basicAttackErr("phase preserving extension requires its actual unblocked owner skill hit and phased anchor", op.Path)
	}
	bag := f.providerStateBagForRead(owner, f.ownerProviderRef, false, effectpkg.ReadOptions{})
	if !bag.Present() || !bag.HasTiming() || bag.TargetStateRemainingMs(op.Ref, f.targetKey, f.run.loop.TimeMs()) == 0 || !bag.Timing(slot).Active {
		return nil
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !effectpkg.ValidStateInteger(amount) || amount <= 0 {
		return f.run.basicAttackErr("phase extension requires positive safe integer milliseconds", op.Path)
	}
	next, ok := addDuration(f.run.loop.TimeMs(), int64(amount))
	if !ok {
		return f.run.basicAttackErr("phase extension timestamp overflow", op.Path)
	}
	if next <= bag.TargetExpireAt().At(op.Ref) {
		return nil
	}
	change := f.providerStateBag(owner, f.ownerProviderRef, false)
	prior := change.Timing(slot).Expiry
	fact := change.Timing(slot)
	fact.Expiry, fact.Protect = next, false
	change.SetTiming(slot, fact)
	change.SetTargetExpireAt(op.Ref, next)
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: next, payload: effectpkg.ExpiryPayload{Kind: "target_timing", CombatantKey: owner, ProviderRef: f.ownerProviderRef, TargetKey: f.targetKey, StateKey: op.Ref, StateGeneration: fact.Generation, ExpectedExpireAt: next, TimingSlot: slot}})
	if err := f.stageTargetPhases(inst, slot, timing, change, prior); err != nil {
		return err
	}
	f.stageFor(owner).dirty = true
	return nil
}

func (s *Engine) phasedFact(payload effectpkg.AnchoredPayload) (effectpkg.Provider, planbundle.CompiledTargetTiming, effectpkg.BagView, effectpkg.TimingFact, bool) {
	inst, slot, timing, exists := s.targetTimingBinding(payload.OwnerKey, payload.ProviderRef, payload.AnchorStateKey)
	if !exists || !timing.Phased || slot != payload.TimingSlot || payload.SourceKey != inst.Source {
		return inst, timing, effectpkg.BagView{}, effectpkg.TimingFact{}, false
	}
	bag := s.combatants[payload.OwnerKey].providerState.Lookup(payload.ProviderRef)
	if !bag.Present() || !bag.HasTiming() || bag.TargetKey() != payload.TargetKey {
		return inst, timing, bag, effectpkg.TimingFact{}, false
	}
	fact := bag.Timing(slot)
	return inst, timing, bag, fact, fact.Active && fact.Generation == payload.Generation && fact.Key == payload.AnchorStateKey
}

func (s *Engine) phasedTerminal(event scheduler.GenericEvent, payload effectpkg.AnchoredPayload) bool {
	_, timing, _, fact, valid := s.phasedFact(payload)
	if !valid || fact.Expiry != event.TimeMs || !fact.Protect || event.TimeMs <= fact.Origin {
		return false
	}
	interval := s.compiled.Abilities[timing.AbilityIndex].TickSpec.IntervalMs
	return interval > 0 && (event.TimeMs-fact.Origin)%interval == 0
}

func (s *Engine) handlePhasedTick(event scheduler.GenericEvent, payload effectpkg.AnchoredPayload) *model.EngineError {
	if event.TimeMs == payload.ExpectedExpireAt && s.effectTimers.TerminalCount(event.TimeMs) > 0 {
		s.effectTimers.DecrementTerminal(event.TimeMs)
		if s.effectTimers.TerminalCount(event.TimeMs) == 0 {
			s.effectTimers.ClearTerminal(event.TimeMs)
		}
	}
	inst, timing, _, fact, valid := s.phasedFact(payload)
	if !valid || event.TimeMs > fact.Expiry {
		return nil
	}
	ability := s.compiled.Abilities[timing.AbilityIndex]
	interval := ability.TickSpec.IntervalMs
	if interval <= 0 || event.TimeMs <= fact.Origin || (event.TimeMs-fact.Origin)%interval != 0 {
		return nil
	}
	var frame Frame
	s.initExecutionFrame(&frame, inst.Source, payload.TargetKey, fmt.Sprintf("%s.provider[%s].ability[%s]", inst.Owner, inst.ProviderRef, ability.AbilityKey))
	frame.ownerCombatantKey, frame.ownerProviderRef = inst.Owner, inst.ProviderRef
	frame.castInstanceID, frame.castOrigin = s.mintCastInstanceID(), ability.CastOrigin
	frame.strictReads = true
	spec := ability.TickSpec
	if err := frame.executeOperations(ability, s.compiled.Operations[int(spec.OnTickStart):int(spec.OnTickStart)+int(spec.OnTickCount)]); err != nil {
		return err
	}
	if event.TimeMs == fact.Expiry {
		if err := frame.stageTargetTimingClear(inst.Owner, inst.ProviderRef, payload.TargetKey, payload.AnchorStateKey, payload.TimingSlot, payload.Generation, fact.Expiry); err != nil {
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
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: model.EvidenceKindProviderTick, Ref: inst.ProviderRef, Data: map[string]interface{}{"combatantKey": inst.Owner, "providerRef": inst.ProviderRef, "definitionRef": inst.DefinitionRef, "targetKey": payload.TargetKey, "anchorStateKey": payload.AnchorStateKey, "generation": payload.Generation, "anchored": true}}
	})
	return nil
}

func (f *Frame) stageTargetTimingClear(owner, ref, target, key string, slot int, gen uint64, expiry int64) *model.EngineError {
	bag := f.providerStateBag(owner, ref, false)
	if !bag.Present() || !bag.HasTiming() || bag.TargetKey() != target || bag.Timing(slot).Generation != gen || !bag.Timing(slot).Active || bag.Timing(slot).Expiry != expiry {
		return nil
	}
	if err := f.consumeCommands(1); err != nil {
		return err
	}
	fact := bag.Timing(slot)
	fact.Active, fact.Protect = false, false
	bag.SetTiming(slot, fact)
	bag.SetTargetValue(key, bag.Fields().At(key).DefaultValue)
	bag.SetTargetExpireAt(key, 0)
	f.stageFor(owner).dirty = true
	f.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "provider_target_state_expired", Ref: ref, Data: map[string]interface{}{"owner": owner, "target": target, "stateKey": key, "expectedExpireAt": expiry}}
	})
	return nil
}

func (s *Engine) currentTargetTimingExpiry(event scheduler.GenericEvent) bool {
	return event.Kind == scheduler.GenericEventExpireCleanup && event.DriverEntryIndex >= 0 && event.DriverEntryIndex < s.effectTimers.ExpiryCount() && s.effectTimers.ExpiryAt(event.DriverEntryIndex).Kind == "target_timing"
}

func (s *Engine) applyTargetTimingExpiry(payload effectpkg.ExpiryPayload) {
	inst, slot, timing, exists := s.targetTimingBinding(payload.CombatantKey, payload.ProviderRef, payload.StateKey)
	if !exists || slot != payload.TimingSlot {
		return
	}
	bag := s.combatants[inst.Owner].providerState.Lookup(inst.ProviderRef)
	if !bag.Present() || !bag.HasTiming() || bag.TargetKey() != payload.TargetKey {
		return
	}
	fact := bag.Timing(slot)
	if !fact.Active || fact.Generation != payload.StateGeneration || fact.Expiry != payload.ExpectedExpireAt || s.loop.TimeMs() != fact.Expiry {
		return
	}
	ability := s.compiled.Abilities[timing.AbilityIndex]
	var frame Frame
	s.initExecutionFrame(&frame, inst.Source, payload.TargetKey, fmt.Sprintf("%s.provider[%s].ability[%s]", inst.Owner, inst.ProviderRef, ability.AbilityKey))
	frame.ownerCombatantKey, frame.ownerProviderRef = inst.Owner, inst.ProviderRef
	frame.castInstanceID, frame.castOrigin = s.mintCastInstanceID(), ability.CastOrigin
	frame.strictReads = true
	if err := frame.stageTargetTimingClear(inst.Owner, inst.ProviderRef, payload.TargetKey, payload.StateKey, slot, payload.StateGeneration, fact.Expiry); err != nil {
		s.processFailure = err
		return
	}
	if !timing.Phased {
		x := ability.TargetExpirySpec
		if x == nil {
			s.processFailure = s.basicAttackErr("target expiry lacks its actual compiled payload", payload.StateKey)
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

func (s *Engine) validateTargetTimingFresh() *model.EngineError {
	if !s.compiled.HasTargetTiming {
		return nil
	}
	for owner, actor := range s.combatants {
		for instanceIndex, instanceValues := 0, actor.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			instance := instanceValues.At(instanceIndex)
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
			instance, _, present := s.combatants[actor.Key].instances.Providers().Find(mount.ProviderRef)
			if !present || instance.DefinitionIndex != mount.DefinitionIndex {
				return s.basicAttackErr("target timing initial mount is missing or has a foreign definition", "initialSnapshot.combatants.providers")
			}
			bag := s.combatants[actor.Key].providerState.Lookup(mount.ProviderRef)
			if !bag.Present() {
				continue
			}
			valid := bag.TargetKey() == ""
			bag.State().Range(func(key string, value float64) bool {
				field, ok := p.StateFields[key]
				valid = valid && ok && value == field.DefaultValue
				return true
			})
			bag.TargetValues().Range(func(_ string, value float64) bool {
				valid = valid && value == 0
				return true
			})
			bag.ExpireAt().Range(func(_ string, value int64) bool {
				valid = valid && value == 0
				return true
			})
			bag.TargetExpireAt().Range(func(_ string, value int64) bool {
				valid = valid && value == 0
				return true
			})
			if !valid {
				return s.basicAttackErr("target timing only accepts fresh default state before timer restoration", "initialSnapshot.combatants.providerState")
			}
		}
	}
	return nil
}
