package runtime

import (
	"fmt"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
)

// anchoredTickPayload 是锚定 tick 堆事件的 run-local 载荷（经 DriverEntryIndex 索引）。
type anchoredTickPayload struct {
	ownerKey         string
	providerRef      string
	sourceKey        string
	targetKey        string
	anchorStateKey   string
	generation       uint64
	expectedExpireAt int64
}

func tickSpecAnchoredTo(ts *compilebundle.CompiledTickSpec, stateKey string) bool {
	return ts != nil && ts.IsAnchored() && ts.AnchorStateKey == stateKey
}

func (s *genericRunState) findAnchoredTickAbility(defIdx uint16, stateKey string) (*compilebundle.CompiledAbility, bool) {
	if int(defIdx) >= len(s.compiled.Providers) {
		return nil, false
	}
	provider := s.compiled.Providers[defIdx]
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
	_ = s.heap.Push(scheduler.GenericEvent{
		TimeMs:           atMs,
		Category:         scheduler.GenericCategoryAnchoredTick,
		Kind:             scheduler.GenericEventAnchoredTick,
		DriverEntryIndex: idx,
		ProviderInstanceRef: scheduler.ProviderInstanceRef{
			CombatantKey: payload.ownerKey,
			ProviderRef:  payload.providerRef,
		},
	})
}

func (s *genericRunState) handleAnchoredTick(ev scheduler.GenericEvent) *model.EngineError {
	if ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= len(s.anchoredTickPayloads) {
		return nil
	}
	payload := s.anchoredTickPayloads[ev.DriverEntryIndex]
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

	bag := owner.providerState[payload.providerRef]
	if bag == nil {
		return nil
	}
	bag.ensure()
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
	if holdInclusive {
		bag.setInclusiveAtExpiryHold(payload.targetKey, payload.anchorStateKey)
		owner.providerState[payload.providerRef] = bag
		s.combatants[payload.ownerKey] = owner
		defer func() {
			if c, ok := s.combatants[payload.ownerKey]; ok {
				if b := c.providerState[payload.providerRef]; b != nil {
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
	abilityRef := fmt.Sprintf("%s.provider[%s].ability[%s]", payload.ownerKey, inst.DefinitionRef, tickAbility.AbilityKey)

	frame := s.newExecutionFrame(sourceKey, payload.targetKey, abilityRef)
	frame.ownerCombatantKey = payload.ownerKey
	frame.ownerProviderRef = payload.providerRef
	frame.castInstanceID = s.mintCastInstanceID()
	frame.castOrigin = tickAbility.CastOrigin
	if err := frame.executeOperations(*tickAbility, ops); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}

	s.recordEvidence(model.EvidenceItem{
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
	})
	// Intentionally do not reschedule: cadence is fully planned at qualifying write time.
	return nil
}
