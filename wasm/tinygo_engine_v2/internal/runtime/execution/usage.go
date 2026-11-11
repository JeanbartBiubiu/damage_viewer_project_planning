// 唯一使用额度实例的恢复、身份准备与原预留发布接线。
package execution

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/runtime/execution/admission"
	"tinygo_engine_v2/internal/runtime/execution/hit"
	listenerpkg "tinygo_engine_v2/internal/runtime/execution/listener"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

type pendingUseReservation struct{ token usage.Reservation }

const maxUseTriggerLedger = usage.MaxEntries

const nativeHitFollowUpSuffix = "__native_hit"

func isNativeHitFollowUp(entryKey string) bool {
	return strings.HasSuffix(entryKey, nativeHitFollowUpSuffix)
}

func (s *Engine) initUseTriggerState() *model.EngineError {
	s.useTriggerLedger = usage.New(usage.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID})
	if err := s.validateAttackStartFacts(); err != nil {
		return err
	}
	return s.restoreUseTriggerLedger(s.req.InitialSnapshot.UseTriggerLedger)
}

func (s *Engine) validateAttackStartFacts() *model.EngineError {
	drivers := make([]admission.AttackStartDriver, len(s.req.DriverPlan.Entries))
	for index, entry := range s.req.DriverPlan.Entries {
		ability, _, resolved := s.lookupDriverAbility(entry)
		drivers[index] = admission.AttackStartDriver{
			Entry: entry, AbilityResolved: resolved,
			HasSkillHit: ability.HasSkillHit, IsBasicAttack: ability.IsBasicAttack,
			OperationCount: ability.OperationCount, SkillKey: ability.SkillKey,
			WhileReady: s.isWhileReady(entry),
		}
	}
	uses := make(map[string]admission.AttackStartUse, len(s.skillUses))
	for key, use := range s.skillUses {
		uses[key] = admission.AttackStartUse{Source: use.identity.Source(), SkillKey: use.identity.SkillKey()}
	}
	_, declared := s.compiled.RuntimeTypes.BasicAttackStart.Lookup()
	facts, err := admission.ValidateAttackStartFacts(admission.AttackStartInput{
		Facts: s.req.AttackStartFacts, Drivers: drivers, Uses: uses,
		HasStartEventType: declared, MaxFacts: hit.MaxFactsPerRun,
		Identity: admission.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID},
	})
	if facts != nil {
		s.attackStartFacts = facts
	}
	if err != nil {
		return err
	}
	return s.hits.ValidateAttackStartOrder(s.attackStartFacts, s.req.DriverPlan.Entries, hit.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID})
}

func (s *Engine) restoreUseTriggerLedger(rows []model.UseTriggerLedgerEntry) *model.EngineError {
	actors := make([]string, 0, len(s.combatants))
	for key := range s.combatants {
		actors = append(actors, key)
	}
	uses := make([]usage.UseIdentity, 0, len(s.skillUses))
	for key, use := range s.skillUses {
		uses = append(uses, usage.UseIdentity{UseKey: key, Source: use.identity.Source(), SkillKey: use.identity.SkillKey()})
	}
	return s.useTriggerLedger.Restore(rows, usage.RestoreFacts{ActorKeys: actors, Groups: s.mountedOncePerUseGroups(), Uses: uses})
}

func (s *Engine) mountedOncePerUseGroups() []usage.GroupAuthorization {
	var out []usage.GroupAuthorization
	for _, listener := range s.compiled.Listeners {
		if !listener.HasOncePerUse || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" || !s.listenerStillLive(listener) {
			continue
		}
		out = append(out, usage.GroupAuthorization{Owner: listener.OwnerCombatantKey, ProviderRef: listener.OwnerProviderRef, GroupKey: listener.OncePerUseGroup, Scope: listener.OncePerUseScope, AnyUse: true})
	}
	for _, actor := range s.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			if !hit.RuleMountLive(actor.Key, mount.ProviderRef, mount.DefinitionIndex, s.compiled.Providers, s.combatants[actor.Key].instances.Providers()) {
				continue
			}
			provider := s.compiled.Providers[mount.DefinitionIndex]
			for ai := provider.AbilityStart; ai < provider.AbilityStart+provider.AbilityCount; ai++ {
				ability := s.compiled.Abilities[ai]
				if !ability.HasSkillHit || ability.OperationCount != 1 {
					continue
				}
				hit := s.compiled.Operations[ability.OperationStart].SkillHit
				if hit == nil {
					continue
				}
				for _, group := range hit.RuleGroups {
					out = append(out, usage.GroupAuthorization{Owner: actor.Key, ProviderRef: mount.ProviderRef, GroupKey: group.OncePerUseGroup, Scope: group.OncePerUseScope, SkillKeys: []string{hit.SkillKey}})
				}
			}
		}
	}
	return out
}

// A cast-start name is not an originating-use grant. Only the synchronous
// accepted planned control may supply its already committed native use/cast.
func (s *Engine) isAcceptedPlannedCastStart(ev emittedEvent) bool {
	return s.skillActionFlowExecutor().AcceptedCastStart(actionflow.PlannedCastStart{EventType: ev.eventType, Source: ev.sourceKey, Target: ev.targetKey, CastOrigin: ev.castOrigin, UseKey: ev.useKey, UseSource: ev.useSource, UseSkillKey: ev.useSkillKey, CastID: ev.castInstanceID, Snapshot: ev.snapshot}, s.loop.TimeMs(), s.compiled.SkillActionBindings, skillEventsBridge{engine: s})
}

func (s *Engine) oncePerUseKey(listener planbundle.CompiledListener, ev emittedEvent) (usage.Key, *model.EngineError) {
	if !ev.hasUse || strings.TrimSpace(ev.useKey) == "" {
		return usage.Key{}, s.skillHitErr(model.GenericErrMissingRequiredField, "oncePerUse requires a real use fact on the triggering event", "listeners["+listener.ListenerKey+"].oncePerUse", listener.OncePerUseGroup)
	}
	if !model.IsRealUseEvent(ev.eventType) && !s.isAcceptedPlannedCastStart(ev) {
		return usage.Key{}, s.skillHitErr(model.GenericErrUnknownRef, "oncePerUse requires an engine-produced originating-use event", "listeners["+listener.ListenerKey+"].oncePerUse", ev.eventType)
	}
	key := usage.Key{
		Owner:       listener.OwnerCombatantKey,
		ProviderRef: listener.OwnerProviderRef,
		GroupKey:    listener.OncePerUseGroup,
		Scope:       listener.OncePerUseScope,
		UseSource:   ev.useSource,
		UseKey:      ev.useKey,
	}
	if listener.OncePerUseScope == model.OncePerUseScopeProviderTarget {
		key.Target = ev.targetKey
		if ev.eventType == model.EventTypeDamageTaken || ev.eventType == model.EventTypeBasicAttackReceived {
			_, key.Target = listenerpkg.Combatants(ev.eventType, ev.sourceKey, ev.targetKey, listener.OwnerCombatantKey)
		}
	}
	return key, nil
}

func (s *Engine) reserveOncePerUse(listener planbundle.CompiledListener, ev emittedEvent) (usage.Reservation, bool, *model.EngineError) {
	if !listener.HasOncePerUse {
		return usage.Reservation{}, false, nil
	}
	if listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" {
		return usage.Reservation{}, false, s.skillHitErr(model.GenericErrUnknownRef, "oncePerUse requires a mounted provider listener", listener.ListenerKey, listener.OncePerUseGroup)
	}
	key, err := s.oncePerUseKey(listener, ev)
	if err != nil {
		return usage.Reservation{}, false, err
	}
	token, skip, err := s.useTriggerLedger.Reserve(key, ev.useSkillKey)
	if err != nil && err.BudgetCause != "" {
		s.budgetCause = err.BudgetCause
	}
	return token, skip, err
}

func (s *Engine) commitOncePerUse(token usage.Reservation) { s.useTriggerLedger.Commit(token) }

func (s *Engine) releaseUncommittedUseReservation(reservation *pendingUseReservation) {
	if reservation != nil {
		s.useTriggerLedger.Release(reservation.token)
	}
}

func (s *Engine) snapshotUseTriggerLedger() []model.UseTriggerLedgerEntry {
	return s.useTriggerLedger.Snapshot()
}

func (s *Engine) lazyExpireAllProviderState() {
	for key, c := range s.combatants {
		for _, ref := range c.providerState.Keys() {
			bag := c.providerState.Lookup(ref)
			if !bag.NeedsLazyExpiration(s.loop.TimeMs()) {
				continue
			}
			change := c.providerState.Edit(ref, false)
			change.LazyExpireProviderState(s.loop.TimeMs())
			change.LazyExpireProviderTargetState(s.loop.TimeMs())
		}
		s.combatants[key] = c
	}
}

func (s *Engine) evalListenerCondition(listener planbundle.CompiledListener, ev emittedEvent) (bool, *model.EngineError) {
	sourceKey, targetKey := listenerpkg.Combatants(ev.eventType, ev.sourceKey, ev.targetKey, listener.OwnerCombatantKey)
	ability := planbundle.CompiledAbility{Params: map[string]float64{}}
	if listener.SourceAbilityIndex >= 0 && listener.SourceAbilityIndex < len(s.compiled.Abilities) {
		ability = s.compiled.Abilities[listener.SourceAbilityIndex]
	}
	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, sourceKey, targetKey, "listener:"+listener.ListenerKey)
	frame := &frameStorage
	frame.strictReads = true
	frame.ownerCombatantKey = listener.OwnerCombatantKey
	frame.ownerProviderRef = listener.OwnerProviderRef
	frame.eventCtx = cloneEventSnapshot(&ev.snapshot)
	if frame.eventCtx != nil {
		if frame.eventCtx.CastInstanceID == 0 {
			frame.eventCtx.CastInstanceID = ev.castInstanceID
		}
		if frame.eventCtx.CastOrigin == "" {
			frame.eventCtx.CastOrigin = ev.castOrigin
		}
	}
	ctx := frame.evalContext(ability)
	ctx.Facts = frame.prepareFormulaFacts(s.compiled.FormulaFactReads[listener.ConditionProgram])
	ctx.StrictReads = true
	value, err := s.formulas.Evaluation.EvalContext(listener.ConditionProgram, &ctx)
	if err != nil {
		out := engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
		out.Path = "listeners[" + listener.ListenerKey + "].condition"
		out.Ref = listener.ListenerKey
		return false, preserveFormulaIssue(err, out)
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return false, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "listener.condition result must be finite", "listeners["+listener.ListenerKey+"].condition", listener.ListenerKey, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	return value != 0, nil
}
