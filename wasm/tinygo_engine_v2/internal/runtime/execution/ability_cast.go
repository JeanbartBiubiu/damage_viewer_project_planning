package execution

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *Engine) executeAbilityCast(entry model.DriverEntry) *model.EngineError {
	sourceKey, ok := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "source unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	targetKey, ok := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "target unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	return s.castAbilityAt(sourceKey, targetKey, entry.AbilityRef, 0, nil, nil, entry.EntryKey)
}

// castAbilityAt 在独立 execution frame 中施放 ability（driver cast 与 listener child ability 共用）。
// eventCtx 非 nil 时继承原始 emit 快照（listener abilityRef child cast）。
// collector 非 nil 时表示处于某次真实 emitted event 的 listener/child 路径，共享 event-local collector。
//
// Cast-instance 规则：
//   - 顶层 driver / TickSpec / Listener AbilityRef 完整 child ability：总是 mint 新 ID，使用本 ability 的 CastOrigin。
//   - 同 frame 多 op / delayed 继承 frame 上的 ID+origin（本函数内一次 mint）。
func (s *Engine) castAbilityAt(sourceKey, targetKey, abilityRef string, chainDepth int, eventCtx *eventFormulaSnapshot, collector *eventCopyableCollector, driverEntryKey string) *model.EngineError {
	resolvedRef := normalizeAbilityRef(abilityRef, sourceKey, targetKey)
	ref, ok := s.compiled.AbilityRefIndex[resolvedRef]
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown abilityRef", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ability := s.compiled.Abilities[ref.AbilityIndex]
	if ability.TargetExpirySpec != nil || len(s.compiled.Providers[ability.ProviderIndex].TargetTimings) > 0 {
		return s.basicAttackErr("target timing source abilities require their actual hit, damage, or timer callback", "abilityRef")
	}
	if s.compiled.Providers[ability.ProviderIndex].PermanentCharacterPeriod {
		return s.basicAttackErr("permanent character ticks can execute only through their actual scheduled tick", "abilityRef")
	}
	if s.compiled.Providers[ability.ProviderIndex].HasStateOnExpire {
		return s.basicAttackErr("state expiry source abilities require their actual initialization or received-damage listener", "abilityRef")
	}
	if _, blocked := s.cooldownGate(sourceKey, resolvedRef); blocked {
		return nil
	}
	if ability.ProcessControl != nil {
		if ability.ProcessControl.UseRefFromEvent {
			return s.startProcessFromEvent(sourceKey, targetKey, resolvedRef, ability, chainDepth, eventCtx, driverEntryKey, collector)
		}
		return s.processErr("abilityRef", "process control can only execute through its single-shot driver fact", resolvedRef)
	}
	start := ability.OperationStart
	end := start + ability.OperationCount
	if int(end) > len(s.compiled.Operations) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "operation range out of bounds", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ops := s.compiled.Operations[start:end]

	// Lazy-expire provider timed state and refresh resolved attrs before staging entry snapshots.
	s.refreshProviderAwareAttributes(sourceKey, targetKey)

	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, sourceKey, targetKey, resolvedRef)
	frame := &frameStorage
	frame.chainDepth = chainDepth
	frame.eventCtx = cloneEventSnapshot(eventCtx)
	frame.copyableCollector = collector
	frame.driverEntryKey = driverEntryKey
	if int(ref.CombatantIndex) < len(s.compiled.Combatants) {
		frame.ownerCombatantKey = s.compiled.Combatants[ref.CombatantIndex].Key
	}
	if parsed, ok := planbundle.ParseAbilityRef(resolvedRef); ok {
		frame.ownerProviderRef = parsed.ProviderRef
		if frame.ownerCombatantKey == "" {
			frame.ownerCombatantKey = parsed.Combatant
		}
	}
	if err := frame.stageLifecycleCostCooldown(ability, sourceKey); err != nil {
		return err
	}
	// Mint after successful gate (driver) / lifecycle staging; Listener AbilityRef always new ID.
	frame.castInstanceID = 0
	if s.hasSkillPlan() {
		if fact, exists := s.hits.Fact(driverEntryKey); exists && fact.UseRef != nil {
			if use := s.skillUses[*fact.UseRef]; use != nil && use.identity.ProcessReference().Present {
				frame.castInstanceID = use.identity.CastID()
			}
		}
	}
	if frame.castInstanceID == 0 {
		frame.castInstanceID = s.mintCastInstanceID()
	}
	frame.castOrigin = ability.CastOrigin
	frame.countCastOnCommit = !isNativeHitFollowUp(frame.driverEntryKey)
	if err := frame.executeOperations(ability, ops); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	// 自动 damage_dealt：commit 后、pending/listener dispatch 前追加到 pendingEvents 尾部。
	frame.maybeQueueDamageDealtEvent(ability)
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	if err := frame.maybeDispatchAbilityStartedEvent(ability); err != nil {
		return err
	}
	if err := frame.maybeDispatchBasicAttackStart(ability); err != nil {
		return err
	}
	if err := frame.maybeDispatchBasicAttackHit(ability); err != nil {
		return err
	}

	s.checkDeathStopReason()
	return nil
}
