// 复制事实冻结、同步因果和延迟复制的真实帧及唯一入队。
package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/continuation"
	"tinygo_engine_v2/internal/scheduler"
)

type copyableDamageFrozen = continuation.FrozenDamage

type deferredRepeatRequest = continuation.RepeatRequest

type eventCopyableCollector = continuation.Collector

var _ continuation.Host = (*Engine)(nil)

func (s *Engine) processExecution(use string) (int, *eventCopyableCollector) {
	return s.continuations.Find(use)
}

func (s *Engine) processForUse(use *skillUseRuntime) *actionpkg.ProcessView {
	if use == nil {
		return nil
	}
	return s.actions.Process(use.identity.ProcessReference())
}

func (f *Frame) registerDeferredRepeat(op planbundle.CompiledOperation) *model.EngineError {
	return f.pendingContinuation.RegisterRepeat(f.copyableCollector, op, f.providerOwnerKey(), f.ownerProviderRef,
		continuation.Identity{SchemaHash: f.run.compiled.SchemaHash, RulesHash: f.run.compiled.RulesHash, SessionID: f.run.req.SessionID})
}

func (f *Frame) maybeCollectCopyableDamage(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, rawAmount float64, targetKey string, critEv frozenCritEvidence) *model.EngineError {
	collector := f.copyableCollector
	if collector == nil || collector.Phantom() || !op.CopyableOnHit || op.Operation != "damage" {
		return nil
	}
	if f.commandsSpent() > f.run.budget.MaxCommandsPerEvent {
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	f.numeric.EnsureFirstPerCast()
	rec := copyableDamageFrozen{
		RawAmount:            rawAmount,
		DamageType:           op.DamageType,
		SourceKey:            f.sourceKey,
		TargetKey:            targetKey,
		ProviderRef:          f.ownerProviderRef,
		OriginRef:            f.abilityRef,
		OperationRef:         op.Ref,
		Crit:                 critEv,
		Ability:              ability,
		Operation:            op,
		CastInstanceID:       f.castInstanceID,
		CastOrigin:           f.castOrigin,
		ConsumedFirstPerCast: f.numeric.FirstPerCast(),
		OwnerCombatantKey:    f.providerOwnerKey(),
		EventCtx:             cloneEventSnapshot(f.eventCtx),
	}
	if f.eventCtx != nil {
		rec.EventSourceKey = f.eventCtx.EventSourceKey
		rec.EventTargetKey = f.eventCtx.EventTargetKey
		rec.EntrySourceAttrs = f.eventCtx.EntrySourceAttrs
		rec.EntryTargetAttrs = f.eventCtx.EntryTargetAttrs
		rec.EntrySourceResources = f.eventCtx.EntrySourceResources
		rec.EntryTargetResources = f.eventCtx.EntryTargetResources
	} else {
		rec.EventSourceKey = f.sourceKey
		rec.EventTargetKey = f.targetKey
		rec.EntrySourceAttrs = f.entrySourceAttrs
		rec.EntryTargetAttrs = f.entryTargetAttrs
		rec.EntrySourceResources = f.entrySourceResources
		rec.EntryTargetResources = f.entryTargetResources
	}
	f.pendingContinuation.AddDamage(rec)
	if collector.Counts()+f.pendingContinuation.Count() > f.run.budget.MaxCommandsPerEvent {
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	return nil
}

func (s *Engine) flushDeferredPhantomReplay(c *eventCopyableCollector) *model.EngineError {
	return s.continuations.Flush(s, c)
}

func (s *Engine) handleTriggeredContinuation(ev scheduler.GenericEvent) *model.EngineError {
	return s.continuations.Fire(s, ev.ContinuationID)
}

// QueueCopyContinuation 只在原延迟登记位置接线唯一队列。
func (s *Engine) QueueCopyContinuation(id uint64, delayMs int) *model.EngineError {
	code := s.loop.Queue().Push(scheduler.GenericEvent{TimeMs: s.loop.TimeMs() + int64(delayMs), Category: scheduler.GenericCategoryTriggeredContinuation, Kind: scheduler.GenericEventTriggeredContinuation, ContinuationID: id})
	if code != model.ErrOK {
		return s.budgetError(model.BudgetCauseMaxQueueEvents, "triggered continuation queue overflow")
	}
	return nil
}

func (s *Engine) ReadRepeatState(owner, provider, key string) (float64, bool) {
	if owner == "" || provider == "" || key == "" {
		return 0, false
	}
	c, ok := s.combatants[owner]
	if !ok {
		return 0, false
	}
	bag := c.providerState.PrepareRead(provider, false,
		s.resolveProviderStateFieldDefs(owner, provider, c.instances.Providers()), s.loop.TimeMs(), effectpkg.ReadOptions{Cooldowns: c.cooldowns.View(), OwnerKey: owner})
	if !bag.Present() {
		return 0, false
	}
	s.combatants[owner] = c
	value, ok := bag.State().Lookup(key)
	if !ok {
		return 0, false
	}
	return value, true
}

func (s *Engine) SettleCopyDeaths() { s.checkDeathStopReason() }

func (s *Engine) CopiesStopped() bool { return s.loop.Stopped() }

func (s *Engine) ApplyCopy(c *eventCopyableCollector, d copyableDamageFrozen, tag string) *model.EngineError {
	return s.applyPhantomCopyableDamage(c, d, tag)
}

func (s *Engine) applyPhantomCopyableDamage(collector *eventCopyableCollector, dmg copyableDamageFrozen, repeatTag string) *model.EngineError {
	if collector == nil {
		return nil
	}
	if _, ok := s.combatants[dmg.TargetKey]; !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	var storage Frame
	s.initExecutionFrame(&storage, dmg.SourceKey, dmg.TargetKey, dmg.OriginRef)
	f := &storage
	f.copyableCollector = collector
	if err := f.bumpCommandBudget(); err != nil {
		return err
	}
	f.ownerCombatantKey, f.ownerProviderRef = dmg.OwnerCombatantKey, dmg.ProviderRef
	f.castInstanceID, f.castOrigin = dmg.CastInstanceID, dmg.CastOrigin
	f.numeric.ShareFirstPerCast(dmg.ConsumedFirstPerCast)
	f.eventCtx = cloneEventSnapshot(dmg.EventCtx)
	defense := continuation.DefenseContext(dmg)
	f.damageDefenseContext = &defense
	cmd := pipeline.Command{Kind: pipeline.KindDamage, Source: dmg.SourceKey, Target: dmg.TargetKey, Amount: dmg.RawAmount, DamageType: dmg.DamageType}
	if err := s.operations.ApplyCopyDamage(&f.numeric, f.operationInput(), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), cmd, dmg.Operation, dmg.Crit, dmg.Ability, repeatTag); err != nil {
		return err
	}
	f.commit()
	return f.fatalErr
}
