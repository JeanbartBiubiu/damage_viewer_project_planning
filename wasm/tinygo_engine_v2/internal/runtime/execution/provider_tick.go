package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"fmt"
	"sort"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

func findTickAbility(provider planbundle.CompiledProvider, session planbundle.CompiledSession) (*planbundle.CompiledAbility, bool) {
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

func (s *Engine) providerTickSchedule(defIdx uint16) (intervalMs, startDelayMs int64, ok bool) {
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
		if !hasTick || tickAbility.TickSpec == nil || !tickAbility.TickSpec.ImmediateFirst {
			startDelayMs = intervalMs
		}
	}
	return intervalMs, startDelayMs, true
}

func (s *Engine) scheduleInitialProviderTick(combatantKey, providerRef string, defIdx uint16, expireAt int64, sourceKey string) {
	if s.actions.BasicAttack() != nil && (s.combatantHp(s.actions.BasicAttack().Plan().Source) <= 0 || s.combatantHp(s.actions.BasicAttack().Plan().Target) <= 0) {
		return
	}
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
	if startDelayMs > s.loop.StartMs()+s.loop.DurationMs()-s.loop.TimeMs() {
		return
	}
	firstAt := s.loop.TimeMs() + startDelayMs
	if s.actions.BasicAttack() == nil && expireAt > 0 && firstAt >= expireAt {
		return
	}
	s.enqueueProviderTickAt(firstAt, combatantKey, providerRef, intervalMs, expireAt, s.loop.TimeMs())
	_ = sourceKey
}

func (s *Engine) seedProviderTicks() {
	owners := make([]string, 0, len(s.combatants))
	for key := range s.combatants {
		owners = append(owners, key)
	}
	sort.Strings(owners)
	for _, key := range owners {
		instances := s.combatants[key].instances.Providers().Snapshot()
		sort.SliceStable(instances, func(previous, next int) bool { return instances[previous].ProviderRef < instances[next].ProviderRef })
		for _, inst := range instances {
			if inst.ExpireAt > 0 && inst.ExpireAt <= s.loop.TimeMs() {
				continue
			}
			s.scheduleInitialProviderTick(key, inst.ProviderRef, inst.DefinitionIndex, inst.ExpireAt, inst.Source)
		}
	}
}

func (s *Engine) handleProviderTick(ev scheduler.GenericEvent) *model.EngineError {
	ref := ev.ProviderInstanceRef
	if ref.CombatantKey == "" || ref.ProviderRef == "" {
		return nil
	}
	c, ok := s.combatants[ref.CombatantKey]
	if !ok {
		return nil
	}
	inst, _, ok := c.instances.Providers().Find(ref.ProviderRef)
	if !ok || inst.Expired(s.loop.TimeMs()) {
		return nil
	}
	provider := s.compiled.Providers[inst.DefinitionIndex]
	if provider.PermanentCharacterPeriod {
		s.currentEventCommands = 0
		if s.loop.Stopped() || s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0 {
			s.checkDeathStopReason()
			return nil
		}
		if inst.Source != ref.CombatantKey || inst.Owner != ref.CombatantKey || inst.ExpireAt != 0 || inst.Stacks != 1 || inst.HasAppliedAt || inst.ActivationUseRef != "" {
			return s.basicAttackErr("permanent character tick no longer belongs to its admitted fresh mount", "provider.tick")
		}
	}
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
	if s.actions.BasicAttack() != nil {
		if sourceKey == targetKey {
			targetKey = s.actions.BasicAttack().Plan().Source
			if sourceKey == s.actions.BasicAttack().Plan().Source {
				targetKey = s.actions.BasicAttack().Plan().Target
			}
		}
	}
	if provider.PermanentCharacterPeriod {
		sourceKey, targetKey = ref.CombatantKey, opponentCombatantKey(ref.CombatantKey)
	}
	if tickAbility.TickSpec.ImmediateFirst {
		use, exists := s.skillUses[inst.ActivationUseRef]
		process := s.processForUse(use)
		if !exists || process == nil || process.Owner() != inst.Source || process.Target() != opponentCombatantKey(inst.Source) {
			return s.processErr("provider.tick", "immediate period has no actual accepted source and opponent", inst.ProviderRef)
		}
		sourceKey, targetKey = process.Owner(), process.Target()
	}
	abilityRef := fmt.Sprintf("%s.provider[%s].ability[%s]", ref.CombatantKey, ref.ProviderRef, tickAbility.AbilityKey)
	// 周期只提供新的真实尝试；CD内跳过的周期不缓存，也不在CD到期补放。
	if _, blocked := s.cooldownGate(ref.CombatantKey, abilityRef); blocked {
		s.continueProviderTick(ev, inst)
		return nil
	}
	if tickAbility.HasCastCondition {
		blocked, err := s.castConditionBlocked(sourceKey, targetKey, *tickAbility, abilityRef)
		if err != nil {
			return err
		}
		if blocked {
			s.continueProviderTick(ev, inst)
			return nil
		}
	}

	ts := tickAbility.TickSpec
	start := ts.OnTickStart
	end := start + ts.OnTickCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "tick onTick range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]

	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, sourceKey, targetKey, abilityRef)
	frame := &frameStorage
	if s.actions.BasicAttack() != nil || provider.PermanentCharacterPeriod {
		frame.strictReads = true
	}
	frame.ownerCombatantKey = ref.CombatantKey
	frame.ownerProviderRef = ref.ProviderRef
	if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
		frame.providerDefinitionRef = provider.ProviderKey
		activatedAt := ev.ProviderTickActivatedAtMs
		frame.providerActivatedAtMs = &activatedAt
		frame.damageOwnerKey = sourceKey
	}
	// Independent TickSpec re-entry always mints a new cast instance.
	frame.castInstanceID = s.mintCastInstanceID()
	frame.castOrigin = tickAbility.CastOrigin
	if err := frame.stageLifecycleCostCooldown(*tickAbility, ref.CombatantKey); err != nil {
		return err
	}
	if err := frame.executeOperations(*tickAbility, ops); err != nil {
		return err
	}
	if s.actions.BasicAttack() != nil {
		if ts.IntervalMs <= s.loop.StartMs()+s.loop.DurationMs()-s.loop.TimeMs() {
			nextAt := s.loop.TimeMs() + ts.IntervalMs
			frame.pendingProviderTick = &pendingFrameProviderTick{at: nextAt, owner: ref.CombatantKey, provider: ref.ProviderRef, intervalMs: ts.IntervalMs, expireAt: inst.ExpireAt, activatedAt: ev.ProviderTickActivatedAtMs}
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
		return model.EvidenceItem{
			TimeMs:  s.loop.TimeMs(),
			Kind:    model.EvidenceKindProviderTick,
			Ref:     ref.ProviderRef,
			Message: "provider tick executed",
			Data: map[string]interface{}{
				"combatantKey":  ref.CombatantKey,
				"providerRef":   ref.ProviderRef,
				"definitionRef": inst.DefinitionRef,
			},
		}
	})
	if provider.PermanentCharacterPeriod {
		s.checkDeathStopReason()
		if s.loop.Stopped() {
			return nil
		}
	}
	if s.actions.BasicAttack() != nil {
		return nil
	}

	intervalMs, _, schedOK := s.providerTickSchedule(inst.DefinitionIndex)
	if !schedOK {
		return nil
	}
	if intervalMs > s.loop.StartMs()+s.loop.DurationMs()-s.loop.TimeMs() {
		return nil
	}
	nextAt := s.loop.TimeMs() + intervalMs
	s.enqueueProviderTickAt(nextAt, ref.CombatantKey, ref.ProviderRef, intervalMs, inst.ExpireAt, ev.ProviderTickActivatedAtMs)
	return nil
}

func (s *Engine) continueProviderTick(event scheduler.GenericEvent, instance effectpkg.Provider) {
	if s.actions.BasicAttack() != nil && (s.combatantHp(s.actions.BasicAttack().Plan().Source) <= 0 || s.combatantHp(s.actions.BasicAttack().Plan().Target) <= 0) {
		return
	}
	interval, _, exists := s.providerTickSchedule(instance.DefinitionIndex)
	if !exists || interval > s.loop.StartMs()+s.loop.DurationMs()-s.loop.TimeMs() {
		return
	}
	s.enqueueProviderTickAt(s.loop.TimeMs()+interval, event.ProviderInstanceRef.CombatantKey, event.ProviderInstanceRef.ProviderRef,
		interval, instance.ExpireAt, event.ProviderTickActivatedAtMs)
}
