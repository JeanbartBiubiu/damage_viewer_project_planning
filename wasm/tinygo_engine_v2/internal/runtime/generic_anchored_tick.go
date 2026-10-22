package runtime

import (
	"fmt"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
)

// anchoredTickPayload 是锚定 tick 堆事件的 run-local 载荷（经 DriverEntryIndex 索引）。
type anchoredTickPayload struct {
	phased           bool
	timingSlot       int
	ownerKey         string
	providerRef      string
	sourceKey        string
	targetKey        string
	anchorStateKey   string
	generation       uint64
	expectedExpireAt int64
}

func tickSpecAnchoredTo(ts *planbundle.CompiledTickSpec, stateKey string) bool {
	return ts != nil && ts.IsAnchored() && ts.AnchorStateKey == stateKey
}

func (s *genericRunState) findAnchoredTickAbility(defIdx uint16, stateKey string) (*planbundle.CompiledAbility, bool) {
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
func (s *genericRunState) scheduleAnchoredTicksOnTargetWrite(
	ownerKey, providerRef, sourceKey, targetKey, stateKey string,
	expireAt int64,
	bag *providerStateBag,
) {
	if s == nil || bag == nil || expireAt <= 0 || ownerKey == "" || providerRef == "" || targetKey == "" || stateKey == "" {
		return
	}
	owner, ok := s.combatants[ownerKey]
	if !ok {
		return
	}
	inst, _, ok := status.FindByRef(owner.providers, providerRef)
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
	gen := bag.bumpAnchoredTickGeneration(stateKey)

	writeAt := s.nowMs
	resolvedSource := sourceKey
	if resolvedSource == "" {
		resolvedSource = inst.Source
	}
	if resolvedSource == "" {
		resolvedSource = ownerKey
	}
	for at := writeAt + intervalMs; at <= expireAt; at += intervalMs {
		s.enqueueAnchoredTickAt(at, anchoredTickPayload{
			ownerKey:         ownerKey,
			providerRef:      providerRef,
			sourceKey:        resolvedSource,
			targetKey:        targetKey,
			anchorStateKey:   stateKey,
			generation:       gen,
			expectedExpireAt: expireAt,
		})
	}
}

func (s *genericRunState) enqueueAnchoredTickAt(atMs int64, payload anchoredTickPayload) {
	if atMs > s.startMs+s.durationMs {
		return
	}
	idx := len(s.anchoredTickPayloads)
	s.anchoredTickPayloads = append(s.anchoredTickPayloads, payload)
	ev := scheduler.GenericEvent{
		TimeMs:           atMs,
		Category:         scheduler.GenericCategoryAnchoredTick,
		Kind:             scheduler.GenericEventAnchoredTick,
		DriverEntryIndex: idx,
		ProviderInstanceRef: scheduler.ProviderInstanceRef{
			CombatantKey: payload.ownerKey,
			ProviderRef:  payload.providerRef,
		},
	}
	if !s.pushCombatEvent(ev) {
		return
	}
	if atMs == payload.expectedExpireAt {
		if s.anchoredTerminalAt == nil {
			s.anchoredTerminalAt = make(map[int64]int)
		}
		s.anchoredTerminalAt[atMs]++
		// Other callbacks at this exact boundary may resolve this provider's
		// modifiers before its own terminal runs. Only an actual, still-bound
		// queued terminal grants the existing per-bag inclusive hold.
		if s.currentAnchoredTerminal(ev) {
			owner := s.combatants[payload.ownerKey]
			bag := writableProviderStateBag(owner.writableProviderStates(), payload.providerRef, false)
			if !payload.phased {
				bag.setInclusiveAtExpiryHold(payload.targetKey, payload.anchorStateKey)
			}
			s.combatants[payload.ownerKey] = owner
		}
	}
}

// selectAnchoredTerminalBeforeProcessTimer changes only the next selected event,
// never the heap's category order. Held events retain their original nonzero Seq
// and Priority on reinsert, so all process timers and nonterminal ticks preserve
// their existing order. The selected terminal leaves the heap exactly once and
// is accounted/executed by the normal run loop, including errors and deaths.
func (s *genericRunState) selectAnchoredTerminalBeforeProcessTimer(timer scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError) {
	if s.anchoredTerminalAt[timer.TimeMs] == 0 {
		return timer, nil
	}
	held := []scheduler.GenericEvent{timer}
	selected := timer
	found := false
	for {
		at, ok := s.heap.PeekTime()
		if !ok || at != timer.TimeMs {
			break
		}
		ev, _ := s.heap.Pop()
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
		delete(s.anchoredTerminalAt, timer.TimeMs)
	}
	for _, ev := range held {
		// No execution happens during lookahead, and exactly one event remains
		// selected, so reinsertion cannot use more than the original capacity.
		if s.heap.Push(ev) != model.ErrOK {
			return timer, engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "anchored terminal selection could not restore heap", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
		}
	}
	return selected, nil
}

func (s *genericRunState) currentAnchoredTerminal(ev scheduler.GenericEvent) bool {
	if ev.Kind == scheduler.GenericEventAnchoredTick && ev.DriverEntryIndex >= 0 && ev.DriverEntryIndex < len(s.anchoredTickPayloads) {
		p := s.anchoredTickPayloads[ev.DriverEntryIndex]
		if p.phased {
			return s.phasedTerminal(ev, p)
		}
	}
	if ev.Kind != scheduler.GenericEventAnchoredTick || ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= len(s.anchoredTickPayloads) {
		return false
	}
	payload := s.anchoredTickPayloads[ev.DriverEntryIndex]
	if ev.TimeMs != payload.expectedExpireAt || payload.expectedExpireAt <= 0 || payload.ownerKey == "" || payload.providerRef == "" || payload.targetKey == "" || payload.anchorStateKey == "" {
		return false
	}
	owner, ok := s.combatants[payload.ownerKey]
	if !ok {
		return false
	}
	inst, _, ok := status.FindByRef(owner.providers, payload.providerRef)
	if !ok {
		return false
	}
	if _, ok := s.findAnchoredTickAbility(inst.DefinitionIndex, payload.anchorStateKey); !ok {
		return false
	}
	bag := owner.providerState[payload.providerRef]
	if bag == nil || bag.targetKey != payload.targetKey || bag.currentAnchoredTickGeneration(payload.anchorStateKey) != payload.generation || bag.targetExpireAt[payload.anchorStateKey] != payload.expectedExpireAt {
		return false
	}
	source := inst.Source
	if source == "" {
		source = payload.ownerKey
	}
	return payload.sourceKey == "" || payload.sourceKey == source
}

func (s *genericRunState) handleAnchoredTick(ev scheduler.GenericEvent) *model.EngineError {
	if ev.DriverEntryIndex >= 0 && ev.DriverEntryIndex < len(s.anchoredTickPayloads) && s.anchoredTickPayloads[ev.DriverEntryIndex].phased {
		return s.handlePhasedTick(ev, s.anchoredTickPayloads[ev.DriverEntryIndex])
	}
	if ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= len(s.anchoredTickPayloads) {
		return nil
	}
	payload := s.anchoredTickPayloads[ev.DriverEntryIndex]
	if ev.TimeMs == payload.expectedExpireAt {
		if remaining := s.anchoredTerminalAt[ev.TimeMs]; remaining > 1 {
			s.anchoredTerminalAt[ev.TimeMs] = remaining - 1
		} else {
			delete(s.anchoredTerminalAt, ev.TimeMs)
		}
	}
	if payload.ownerKey == "" || payload.providerRef == "" || payload.targetKey == "" || payload.anchorStateKey == "" {
		return nil
	}
	owner, ok := s.combatants[payload.ownerKey]
	if !ok {
		return nil
	}
	inst, _, ok := status.FindByRef(owner.providers, payload.providerRef)
	if !ok {
		return nil
	}
	tickAbility, ok := s.findAnchoredTickAbility(inst.DefinitionIndex, payload.anchorStateKey)
	if !ok || tickAbility.TickSpec == nil {
		return nil
	}

	bag := writableProviderStateBag(owner.writableProviderStates(), payload.providerRef, false)
	if bag == nil {
		return nil
	}
	bag.ensure()
	s.combatants[payload.ownerKey] = owner
	// Active target binding is mandatory; never fall back to inst.Owner.
	if bag.targetKey == "" || bag.targetKey != payload.targetKey {
		return nil
	}
	if bag.currentAnchoredTickGeneration(payload.anchorStateKey) != payload.generation {
		return nil
	}
	exp, ok := bag.targetExpireAt[payload.anchorStateKey]
	if !ok || exp <= 0 || exp != payload.expectedExpireAt {
		return nil
	}
	// Source ownership: prefer instance source; empty/mismatch with payload is a no-op.
	sourceKey := inst.Source
	if sourceKey == "" {
		sourceKey = payload.ownerKey
	}
	if payload.sourceKey != "" && sourceKey != payload.sourceKey {
		return nil
	}

	holdInclusive := s.nowMs == payload.expectedExpireAt
	terminalSettled := false
	if holdInclusive {
		bag.setInclusiveAtExpiryHold(payload.targetKey, payload.anchorStateKey)
		owner.providerState[payload.providerRef] = bag
		s.combatants[payload.ownerKey] = owner
		defer func() {
			if c, ok := s.combatants[payload.ownerKey]; ok {
				if b := writableProviderStateBag(c.writableProviderStates(), payload.providerRef, false); b != nil && terminalSettled && b.targetKey == payload.targetKey && b.currentAnchoredTickGeneration(payload.anchorStateKey) == payload.generation {
					b.clearInclusiveAtExpiryHold()
					c.providerState[payload.providerRef] = b
					s.combatants[payload.ownerKey] = c
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
	abilityRef := fmt.Sprintf("%s.provider[%s].ability[%s]", payload.ownerKey, inst.ProviderRef, tickAbility.AbilityKey)
	_, blocked := s.cooldownGate(payload.ownerKey, abilityRef)
	if !blocked && tickAbility.HasCastCondition {
		var err *model.EngineError
		blocked, err = s.castConditionBlocked(sourceKey, payload.targetKey, *tickAbility, abilityRef)
		if err != nil {
			return err
		}
	}
	if blocked && !holdInclusive {
		return nil
	}

	var frameStorage executionFrame
	s.initExecutionFrame(&frameStorage, sourceKey, payload.targetKey, abilityRef)
	frame := &frameStorage
	frame.ownerCombatantKey = payload.ownerKey
	frame.ownerProviderRef = payload.providerRef
	frame.castInstanceID = s.mintCastInstanceID()
	frame.castOrigin = tickAbility.CastOrigin
	if !blocked {
		if err := frame.stageLifecycleCostCooldown(*tickAbility, payload.ownerKey); err != nil {
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
			TimeMs:  s.nowMs,
			Kind:    model.EvidenceKindProviderTick,
			Ref:     payload.providerRef,
			Message: "anchored provider tick executed",
			Data: map[string]interface{}{
				"combatantKey":   payload.ownerKey,
				"providerRef":    payload.providerRef,
				"definitionRef":  inst.DefinitionRef,
				"targetKey":      payload.targetKey,
				"anchorStateKey": payload.anchorStateKey,
				"generation":     payload.generation,
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
func (f *executionFrame) stageAnchoredTerminalExpiry(payload anchoredTickPayload) *model.EngineError {
	staged := f.stageFor(payload.ownerKey)
	bag := writableProviderStateBag(staged.writableProviderStates(), payload.providerRef, false)
	if bag == nil || bag.targetKey != payload.targetKey || bag.currentAnchoredTickGeneration(payload.anchorStateKey) != payload.generation || bag.targetExpireAt[payload.anchorStateKey] != payload.expectedExpireAt {
		return nil
	}
	if err := f.consumeCommands(1); err != nil {
		return err
	}
	bag.clearInclusiveAtExpiryHold()
	bag.writableTargetValues()[payload.anchorStateKey] = bag.fieldDefs[payload.anchorStateKey].defaultValue
	bag.writableTargetExpireAt()[payload.anchorStateKey] = 0
	f.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	f.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "provider_target_state_expired", Ref: payload.providerRef,
			Data: map[string]interface{}{"owner": payload.ownerKey, "target": payload.targetKey, "stateKey": payload.anchorStateKey, "expectedExpireAt": payload.expectedExpireAt}}
	})
	return nil
}
