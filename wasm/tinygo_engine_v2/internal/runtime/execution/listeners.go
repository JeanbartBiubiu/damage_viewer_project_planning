// 监听的真实执行帧、当前值刷新与恢复来源接线。
package execution

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
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
	castID := ev.castInstanceID
	if castID == 0 {
		castID = ev.snapshot.CastInstanceID
	}
	collector := &eventCopyableCollector{}
	if ev.snapshot.CastInstanceID == 0 {
		ev.snapshot.CastInstanceID = castID
	}
	if ev.snapshot.CastOrigin == "" {
		ev.snapshot.CastOrigin = ev.castOrigin
	}
	facts := listenerpkg.EventMatchFacts{EventType: ev.eventType, SourceKey: ev.sourceKey, TargetKey: ev.targetKey,
		Types: s.eventTypeSet(ev.types), HasBlockedHit: ev.skillHit != nil}
	if ev.skillHit != nil {
		facts.ShieldOwner, facts.ShieldProviderRef = ev.skillHit.View().ShieldOwner, ev.skillHit.View().ShieldProviderRef
	}
	return listenerpkg.Dispatch(&s.listeners, listenerpkg.DispatchInput{
		Event: facts, Bindings: s.compiled.RuntimeTypes, Compiled: s.compiled.Listeners,
		CastID: castID, NowMs: s.loop.TimeMs(), ChainDepth: chainDepth,
	}, ev, collector, s)
}

func (s *Engine) listenerMatchesEvent(listener planbundle.CompiledListener, ev emittedEvent, baseEventTypes typeset.TypeSet) bool {
	facts := listenerpkg.EventMatchFacts{EventType: ev.eventType, SourceKey: ev.sourceKey, TargetKey: ev.targetKey,
		Types: baseEventTypes, MountLive: s.listenerStillLive(listener), HasBlockedHit: ev.skillHit != nil}
	if ev.skillHit != nil {
		facts.ShieldOwner, facts.ShieldProviderRef = ev.skillHit.View().ShieldOwner, ev.skillHit.View().ShieldProviderRef
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
		frame.castInstanceID = eventCtx.CastInstanceID
		frame.castOrigin = eventCtx.CastOrigin
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

func (f *Frame) checkListenerRecoveryRecipient(targetKey string, op planbundle.CompiledOperation) (bool, *model.EngineError) {
	return listenerpkg.CheckRecoveryRecipient(listenerpkg.RecoveryRecipient{Mounted: f.mountedListener, Owner: f.ownerCombatantKey, Target: targetKey, Path: op.Path}, f)
}

func (f *Frame) attachRecoveryProvenance(data map[string]interface{}, op planbundle.CompiledOperation) {
	definition := f.providerDefinitionRef
	if definition == "" && op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(f.run.compiled.Providers) {
		definition = f.run.compiled.Providers[op.OwnerProviderIndex].ProviderKey
	}
	facts := listenerpkg.RecoveryProvenance{Owner: f.providerOwnerKey(), Provider: f.ownerProviderRef, Definition: definition, Ability: f.abilityRef,
		Operation: op.Ref, Path: op.Path, Use: f.skillActionUseRef()}
	if f.readsDamageStateBefore && f.eventCtx != nil {
		facts.HasTriggerDamage, facts.DamageID, facts.DamageSource, facts.DamageTarget = true, f.eventCtx.DamageID, f.eventCtx.EventSourceKey, f.eventCtx.EventTargetKey
	}
	listenerpkg.AttachRecoveryProvenance(data, facts)
}

func (f *Frame) ListenerRecoveryHP(owner string) float64 {
	return attribute.ReadHP(f.stageFor(owner).attributesView())
}

func (f *Frame) ListenerRecoveryError(message, path, target string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, message, path, target, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
}

// Resource costs still call applyResourceChange directly. Only an authored
// positive/zero resource-change operation creates a committed restore fact.
func (f *Frame) applyResourceOperation(targetKey string, amount float64, op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	if amount < 0 {
		return f.applyResourceChange(targetKey, op.ResourceKey, amount, ability)
	}
	if skip, err := f.checkListenerRecoveryRecipient(targetKey, op); err != nil || skip {
		return err
	}
	before := f.stageFor(targetKey).resourceView().At(op.ResourceKey).Current
	if err := f.applyResourceChange(targetKey, op.ResourceKey, amount, ability); err != nil {
		return err
	}
	after := f.stageFor(targetKey).resourceView().At(op.ResourceKey).Current
	f.recordEvidenceLazy("resource_restore", func() model.EvidenceItem {
		data := map[string]interface{}{
			"source": f.sourceKey, "target": targetKey, "resourceKey": op.ResourceKey,
			"requestedAmount": amount, "currentBefore": before, "currentAfter": after,
			"actualDelta": after - before, "overflow": math.Max(0, amount-(after-before)),
		}
		f.attachRecoveryProvenance(data, op)
		ref := op.Ref
		if ref == "" {
			ref = f.abilityRef
		}
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "resource_restore", Ref: ref, Data: data}
	})
	return nil
}
