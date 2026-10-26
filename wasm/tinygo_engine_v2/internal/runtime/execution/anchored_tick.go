package execution

import (
	"fmt"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

// anchoredTickPayload 是锚定 tick 堆事件的 run-local 载荷（经 DriverEntryIndex 索引）。

func tickSpecAnchoredTo(ts *planbundle.CompiledTickSpec, stateKey string) bool {
	return ts != nil && ts.IsAnchored() && ts.AnchorStateKey == stateKey
}

func (s *Engine) findAnchoredTickAbility(defIdx uint16, stateKey string) (*planbundle.CompiledAbility, bool) {
	if int(defIdx) >= len(s.compiled.Providers) {
		return nil, false
	}
	provider := s.compiled.Providers[defIdx]
	for i := int(provider.AbilityStart); i < int(provider.AbilityStart)+int(provider.AbilityCount); i++ {
		a := &s.compiled.Abilities[i]
		if a.TickSpec != nil && a.TickSpec.PhasePolicy == "preserve_on_extend" && tickSpecAnchoredTo(a.TickSpec, stateKey) {
			return a, true
		}
	}
	tickAbility, ok := findTickAbility(provider, s.compiled)
	if !ok || tickAbility.TickSpec == nil {
		return nil, false
	}
	if !tickSpecAnchoredTo(tickAbility.TickSpec, stateKey) {
		return nil, false
	}
	return tickAbility, true
}

// scheduleAnchoredTicksOnTargetWrite 在合格 provider_target 写入后重启锚定 tick 世代。
// bag 必须是本次写入所在的 bag（通常为 execution frame staged bag），不能回读未 commit 的 run combatants。
// 在 write+n*interval（n>=1）且 <= expireAt 处调度全部 ticks；tick 处理本身不递归续期。
func (s *Engine) scheduleAnchoredTicksOnTargetWrite(
	ownerKey, providerRef, sourceKey, targetKey, stateKey string,
	expireAt int64,
	bag effectpkg.BagChange,
) {
	if s == nil || !bag.Present() || expireAt <= 0 || ownerKey == "" || providerRef == "" || targetKey == "" || stateKey == "" {
		return
	}
	owner, ok := s.combatants[ownerKey]
	if !ok {
		return
	}
	inst, _, ok := owner.instances.Providers().Find(providerRef)
	if !ok {
		return
	}
	tickAbility, ok := s.findAnchoredTickAbility(inst.DefinitionIndex, stateKey)
	if !ok {
		return
	}
	intervalMs := tickAbility.TickSpec.IntervalMs
	if intervalMs <= 0 {
		return
	}
	gen := bag.BumpAnchoredTickGeneration(stateKey)

	writeAt := s.loop.TimeMs()
	resolvedSource := sourceKey
	if resolvedSource == "" {
		resolvedSource = inst.Source
	}
	if resolvedSource == "" {
		resolvedSource = ownerKey
	}
	for at := writeAt + intervalMs; at <= expireAt; at += intervalMs {
		s.enqueueAnchoredTickAt(at, effectpkg.AnchoredPayload{
			OwnerKey:         ownerKey,
			ProviderRef:      providerRef,
			SourceKey:        resolvedSource,
			TargetKey:        targetKey,
			AnchorStateKey:   stateKey,
			Generation:       gen,
			ExpectedExpireAt: expireAt,
		})
	}
}

func (s *Engine) enqueueAnchoredTickAt(atMs int64, payload effectpkg.AnchoredPayload) {
	if atMs > s.loop.StartMs()+s.loop.DurationMs() {
		return
	}
	idx := s.effectTimers.RegisterAnchored(payload)
	ev := scheduler.GenericEvent{
		TimeMs:           atMs,
		Category:         scheduler.GenericCategoryAnchoredTick,
		Kind:             scheduler.GenericEventAnchoredTick,
		DriverEntryIndex: idx,
		ProviderInstanceRef: scheduler.ProviderInstanceRef{
			CombatantKey: payload.OwnerKey,
			ProviderRef:  payload.ProviderRef,
		},
	}
	if !s.pushCombatEvent(ev) {
		return
	}
	if atMs == payload.ExpectedExpireAt {
		s.effectTimers.AddTerminal(atMs)
		// Other callbacks at this exact boundary may resolve this provider's
		// modifiers before its own terminal runs. Only an actual, still-bound
		// queued terminal grants the existing per-bag inclusive hold.
		if s.currentAnchoredTerminal(ev) {
			owner := s.combatants[payload.OwnerKey]
			bag := owner.providerState.Edit(payload.ProviderRef, false)
			if !payload.Phased {
				bag.SetInclusiveAtExpiryHold(payload.TargetKey, payload.AnchorStateKey)
			}
			s.combatants[payload.OwnerKey] = owner
		}
	}
}

// selectAnchoredTerminalBeforeProcessTimer changes only the next selected event,
// never the heap's category order. Held events retain their original nonzero Seq
// and Priority on reinsert, so all process timers and nonterminal ticks preserve
// their existing order. The selected terminal leaves the heap exactly once and
// is accounted/executed by the normal run loop, including errors and deaths.
func (s *Engine) selectAnchoredTerminalBeforeProcessTimer(timer scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError) {
	if s.effectTimers.TerminalCount(timer.TimeMs) == 0 {
		return timer, nil
	}
	held := []scheduler.GenericEvent{timer}
	selected := timer
	found := false
	for {
		at, ok := s.loop.Queue().PeekTime()
		if !ok || at != timer.TimeMs {
			break
		}
		ev, _ := s.loop.Queue().Pop()
		if s.currentAnchoredTerminal(ev) {
			selected, found = ev, true
			break
		}
		held = append(held, ev)
		if ev.Category > scheduler.GenericCategoryAnchoredTick {
			break
		}
	}
	if !found {
		held = held[1:]
		// All terminal entries at this time are already stale. A subsequent
		// positive-duration write cannot create a new terminal at this time.
		s.effectTimers.ClearTerminal(timer.TimeMs)
	}
	for _, ev := range held {
		// No execution happens during lookahead, and exactly one event remains
		// selected, so reinsertion cannot use more than the original capacity.
		if s.loop.Queue().Push(ev) != model.ErrOK {
			return timer, engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "anchored terminal selection could not restore heap", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
		}
	}
	return selected, nil
}

func (s *Engine) currentAnchoredTerminal(ev scheduler.GenericEvent) bool {
	if ev.Kind == scheduler.GenericEventAnchoredTick && ev.DriverEntryIndex >= 0 && ev.DriverEntryIndex < s.effectTimers.AnchoredCount() {
		p := s.effectTimers.AnchoredAt(ev.DriverEntryIndex)
		if p.Phased {
			return s.phasedTerminal(ev, p)
		}
	}
	if ev.Kind != scheduler.GenericEventAnchoredTick || ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= s.effectTimers.AnchoredCount() {
		return false
	}
	payload := s.effectTimers.AnchoredAt(ev.DriverEntryIndex)
	if ev.TimeMs != payload.ExpectedExpireAt || payload.ExpectedExpireAt <= 0 || payload.OwnerKey == "" || payload.ProviderRef == "" || payload.TargetKey == "" || payload.AnchorStateKey == "" {
		return false
	}
	owner, ok := s.combatants[payload.OwnerKey]
	if !ok {
		return false
	}
	inst, _, ok := owner.instances.Providers().Find(payload.ProviderRef)
	if !ok {
		return false
	}
	if _, ok := s.findAnchoredTickAbility(inst.DefinitionIndex, payload.AnchorStateKey); !ok {
		return false
	}
	bag := owner.providerState.Lookup(payload.ProviderRef)
	if !bag.Present() || bag.TargetKey() != payload.TargetKey || bag.CurrentAnchoredTickGeneration(payload.AnchorStateKey) != payload.Generation || bag.TargetExpireAt().At(payload.AnchorStateKey) != payload.ExpectedExpireAt {
		return false
	}
	source := inst.Source
	if source == "" {
		source = payload.OwnerKey
	}
	return payload.SourceKey == "" || payload.SourceKey == source
}

func (s *Engine) handleAnchoredTick(ev scheduler.GenericEvent) *model.EngineError {
	if ev.DriverEntryIndex >= 0 && ev.DriverEntryIndex < s.effectTimers.AnchoredCount() && s.effectTimers.AnchoredAt(ev.DriverEntryIndex).Phased {
		return s.handlePhasedTick(ev, s.effectTimers.AnchoredAt(ev.DriverEntryIndex))
	}
	if ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= s.effectTimers.AnchoredCount() {
		return nil
	}
	payload := s.effectTimers.AnchoredAt(ev.DriverEntryIndex)
	if ev.TimeMs == payload.ExpectedExpireAt {
		if remaining := s.effectTimers.TerminalCount(ev.TimeMs); remaining > 1 {
			s.effectTimers.SetTerminalCount(ev.TimeMs, remaining-1)
		} else {
			s.effectTimers.ClearTerminal(ev.TimeMs)
		}
	}
	if payload.OwnerKey == "" || payload.ProviderRef == "" || payload.TargetKey == "" || payload.AnchorStateKey == "" {
		return nil
	}
	owner, ok := s.combatants[payload.OwnerKey]
	if !ok {
		return nil
	}
	inst, _, ok := owner.instances.Providers().Find(payload.ProviderRef)
	if !ok {
		return nil
	}
	tickAbility, ok := s.findAnchoredTickAbility(inst.DefinitionIndex, payload.AnchorStateKey)
	if !ok || tickAbility.TickSpec == nil {
		return nil
	}

	bag := owner.providerState.Edit(payload.ProviderRef, false)
	if !bag.Present() {
		return nil
	}
	bag.Ensure()
	s.combatants[payload.OwnerKey] = owner
	// Active target binding is mandatory; never fall back to inst.Owner.
	if bag.TargetKey() == "" || bag.TargetKey() != payload.TargetKey {
		return nil
	}
	if bag.CurrentAnchoredTickGeneration(payload.AnchorStateKey) != payload.Generation {
		return nil
	}
	exp, ok := bag.TargetExpireAt().Lookup(payload.AnchorStateKey)
	if !ok || exp <= 0 || exp != payload.ExpectedExpireAt {
		return nil
	}
	// Source ownership: prefer instance source; empty/mismatch with payload is a no-op.
	sourceKey := inst.Source
	if sourceKey == "" {
		sourceKey = payload.OwnerKey
	}
	if payload.SourceKey != "" && sourceKey != payload.SourceKey {
		return nil
	}

	holdInclusive := s.loop.TimeMs() == payload.ExpectedExpireAt
	terminalSettled := false
	if holdInclusive {
		bag.SetInclusiveAtExpiryHold(payload.TargetKey, payload.AnchorStateKey)

		s.combatants[payload.OwnerKey] = owner
		defer func() {
			if c, ok := s.combatants[payload.OwnerKey]; ok {
				if b := c.providerState.Edit(payload.ProviderRef, false); b.Present() && terminalSettled && b.TargetKey() == payload.TargetKey && b.CurrentAnchoredTickGeneration(payload.AnchorStateKey) == payload.Generation {
					b.ClearInclusiveAtExpiryHold()

					s.combatants[payload.OwnerKey] = c
				}
			}
		}()
	}

	ts := tickAbility.TickSpec
	start := ts.OnTickStart
	end := start + ts.OnTickCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "anchored tick onTick range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]
	abilityRef := fmt.Sprintf("%s.provider[%s].ability[%s]", payload.OwnerKey, inst.ProviderRef, tickAbility.AbilityKey)
	_, blocked := s.cooldownGate(payload.OwnerKey, abilityRef)
	if !blocked && tickAbility.HasCastCondition {
		var err *model.EngineError
		blocked, err = s.castConditionBlocked(sourceKey, payload.TargetKey, *tickAbility, abilityRef)
		if err != nil {
			return err
		}
	}
	if blocked && !holdInclusive {
		return nil
	}

	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, sourceKey, payload.TargetKey, abilityRef)
	frame := &frameStorage
	frame.ownerCombatantKey = payload.OwnerKey
	frame.ownerProviderRef = payload.ProviderRef
	frame.castInstanceID = s.mintCastInstanceID()
	frame.castOrigin = tickAbility.CastOrigin
	if !blocked {
		if err := frame.stageLifecycleCostCooldown(*tickAbility, payload.OwnerKey); err != nil {
			return err
		}
		if err := frame.executeOperations(*tickAbility, ops); err != nil {
			return err
		}
	}
	if holdInclusive {
		if err := frame.stageAnchoredTerminalExpiry(payload); err != nil {
			return err
		}
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	terminalSettled = true
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	if blocked {
		return nil
	}

	s.recordEvidenceLazy(model.EvidenceKindProviderTick, func() model.EvidenceItem {
		return model.EvidenceItem{
			TimeMs:  s.loop.TimeMs(),
			Kind:    model.EvidenceKindProviderTick,
			Ref:     payload.ProviderRef,
			Message: "anchored provider tick executed",
			Data: map[string]interface{}{
				"combatantKey":   payload.OwnerKey,
				"providerRef":    payload.ProviderRef,
				"definitionRef":  inst.DefinitionRef,
				"targetKey":      payload.TargetKey,
				"anchorStateKey": payload.AnchorStateKey,
				"generation":     payload.Generation,
				"anchored":       true,
			},
		}
	})
	// Intentionally do not reschedule: cadence is fully planned at qualifying write time.
	return nil
}

// Stage the standard one-field target expiration in the callback's transaction.
// This preserves its expiry evidence and attribute invalidation while preventing
// an intervening process timer from seeing the completed window. A callback that
// cleared or refreshed the state owns its newer value; a failed frame publishes
// neither callback effects nor this cleanup.
func (f *Frame) stageAnchoredTerminalExpiry(payload effectpkg.AnchoredPayload) *model.EngineError {
	staged := f.stageFor(payload.OwnerKey)
	bag := staged.providerState.Edit(payload.ProviderRef, false)
	if !bag.Present() || bag.TargetKey() != payload.TargetKey || bag.CurrentAnchoredTickGeneration(payload.AnchorStateKey) != payload.Generation || bag.TargetExpireAt().At(payload.AnchorStateKey) != payload.ExpectedExpireAt {
		return nil
	}
	if err := f.consumeCommands(1); err != nil {
		return err
	}
	bag.ClearInclusiveAtExpiryHold()
	bag.SetTargetValue(payload.AnchorStateKey, bag.Fields().At(payload.AnchorStateKey).DefaultValue)
	bag.SetTargetExpireAt(payload.AnchorStateKey, 0)
	f.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	f.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "provider_target_state_expired", Ref: payload.ProviderRef,
			Data: map[string]interface{}{"owner": payload.OwnerKey, "target": payload.TargetKey, "stateKey": payload.AnchorStateKey, "expectedExpireAt": payload.ExpectedExpireAt}}
	})
	return nil
}
