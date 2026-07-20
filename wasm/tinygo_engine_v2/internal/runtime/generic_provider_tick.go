package runtime

import (
	"fmt"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
)

func findTickAbility(provider compilebundle.CompiledProvider, session compilebundle.CompiledSession) (*compilebundle.CompiledAbility, bool) {
	start := provider.AbilityStart
	end := start + provider.AbilityCount
	for i := start; i < end; i++ {
		ability := session.Abilities[i]
		if ability.Kind == "tick" {
			return &session.Abilities[i], true
		}
	}
	return nil, false
}

func (s *genericRunState) providerTickSchedule(defIdx uint16) (intervalMs, startDelayMs int64, ok bool) {
	provider := s.compiled.Providers[defIdx]
	tickAbility, hasTick := findTickAbility(provider, s.compiled)

	if provider.Lifecycle != nil && provider.Lifecycle.TickIntervalMs > 0 {
		intervalMs = provider.Lifecycle.TickIntervalMs
	}
	if hasTick && tickAbility.TickSpec != nil {
		if tickAbility.TickSpec.IntervalMs > 0 {
			intervalMs = tickAbility.TickSpec.IntervalMs
		}
		startDelayMs = tickAbility.TickSpec.StartDelayMs
	}
	if intervalMs <= 0 && !hasTick {
		return 0, 0, false
	}
	if intervalMs <= 0 {
		return 0, 0, false
	}
	if startDelayMs <= 0 {
		startDelayMs = intervalMs
	}
	return intervalMs, startDelayMs, true
}

func (s *genericRunState) scheduleInitialProviderTick(combatantKey, providerRef string, defIdx uint16, expireAt int64, sourceKey string) {
	if int(defIdx) >= len(s.compiled.Providers) {
		return
	}
	provider := s.compiled.Providers[defIdx]
	if tickAbility, hasTick := findTickAbility(provider, s.compiled); hasTick && tickAbility.TickSpec != nil && tickAbility.TickSpec.IsAnchored() {
		// Anchored providers are scheduled only by qualifying provider_target writes.
		return
	}
	intervalMs, startDelayMs, ok := s.providerTickSchedule(defIdx)
	if !ok {
		return
	}
	firstAt := s.nowMs + startDelayMs
	if expireAt > 0 && firstAt >= expireAt {
		return
	}
	s.enqueueProviderTickAt(firstAt, combatantKey, providerRef, intervalMs, expireAt)
	_ = sourceKey
}

func (s *genericRunState) seedProviderTicks() {
	for key, c := range s.combatants {
		for _, inst := range c.providers {
			if inst.ExpireAt > 0 && inst.ExpireAt <= s.nowMs {
				continue
			}
			s.scheduleInitialProviderTick(key, inst.ProviderRef, inst.DefinitionIndex, inst.ExpireAt, inst.Source)
		}
	}
}

func (s *genericRunState) handleProviderTick(ev scheduler.GenericEvent) *model.EngineError {
	ref := ev.ProviderInstanceRef
	if ref.CombatantKey == "" || ref.ProviderRef == "" {
		return nil
	}
	c, ok := s.combatants[ref.CombatantKey]
	if !ok {
		return nil
	}
	inst, _, ok := status.FindByRef(c.providers, ref.ProviderRef)
	if !ok {
		return nil
	}
	provider := s.compiled.Providers[inst.DefinitionIndex]
	tickAbility, hasTick := findTickAbility(provider, s.compiled)
	if !hasTick || tickAbility.TickSpec == nil {
		return nil
	}

	sourceKey := inst.Source
	if sourceKey == "" {
		sourceKey = ref.CombatantKey
	}
	targetKey := inst.Owner
	if targetKey == "" {
		targetKey = ref.CombatantKey
	}
	abilityRef := fmt.Sprintf("%s.provider[%s].ability[%s]", ref.CombatantKey, inst.DefinitionRef, tickAbility.AbilityKey)

	ts := tickAbility.TickSpec
	start := ts.OnTickStart
	end := start + ts.OnTickCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "tick onTick range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]

	frame := s.newExecutionFrame(sourceKey, targetKey, abilityRef)
	frame.ownerCombatantKey = ref.CombatantKey
	frame.ownerProviderRef = ref.ProviderRef
	// Independent TickSpec re-entry always mints a new cast instance.
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
		Ref:     ref.ProviderRef,
		Message: "provider tick executed",
		Data: map[string]interface{}{
			"combatantKey":  ref.CombatantKey,
			"providerRef":   ref.ProviderRef,
			"definitionRef": inst.DefinitionRef,
		},
	})

	intervalMs, _, schedOK := s.providerTickSchedule(inst.DefinitionIndex)
	if !schedOK {
		return nil
	}
	nextAt := s.nowMs + intervalMs
	if nextAt > s.startMs+s.durationMs {
		return nil
	}
	s.enqueueProviderTickAt(nextAt, ref.CombatantKey, ref.ProviderRef, intervalMs, inst.ExpireAt)
	return nil
}
