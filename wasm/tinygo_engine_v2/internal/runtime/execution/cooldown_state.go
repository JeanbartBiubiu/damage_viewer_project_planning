package execution

import "tinygo_engine_v2/internal/runtime/contract"

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"math"
	"sort"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// 投影不保留账本指针；读取者必须传入自己冻结或当次帧的实际版本。

// 初始快照的现有状态形状只在恢复边界读取；随后移除CD的旧数值期限。
func migrateInternalCooldownTimers(bag effectpkg.BagChange, ledger *actionpkg.CooldownLedger, owner, provider string, now int64) {
	if !bag.Present() || !bag.HasInternalCooldowns() {
		return
	}
	keys := make([]string, 0)
	bag.Fields().Range(func(key string, def effectpkg.FieldDefinition) {
		if def.StateKind == model.ProviderStateKindCooldown {
			keys = append(keys, key)
		}
	})
	sort.Strings(keys)
	for _, key := range keys {
		if ready := bag.ExpireAt().At(key); bag.State().At(key) != 0 && ready > now {
			ledger.Set(actionpkg.StateCooldownIdentity(owner, provider, key, stateScopeProvider, ""), ready, now)
		}
		bag.DeleteExpireAt(key)
		if bag.TargetKey() != "" {
			if ready := bag.TargetExpireAt().At(key); bag.TargetValues().At(key) != 0 && ready > now {
				ledger.Set(actionpkg.StateCooldownIdentity(owner, provider, key, stateScopeProviderTarget, bag.TargetKey()), ready, now)
			}
		}
		bag.DeleteTargetExpireAt(key)
	}
	bag.InvalidateCooldownProjection()
	bag.ProjectInternalCooldowns(ledger.View(), owner, provider, now)
}

func (f *Frame) activateProviderTarget(bag effectpkg.BagChange, owner, provider, target string) {
	if !bag.Present() || target == "" {
		return
	}
	if bag.TargetKey() != "" && bag.TargetKey() != target {
		ledger := f.stageFor(owner).writableCooldowns()
		ledger.RemoveTarget(owner, provider, bag.TargetKey(), f.run.loop.TimeMs())
	}
	bag.ActivateProviderTarget(target)
	bag.InvalidateCooldownProjection()
}

func (f *Frame) applyInternalCooldownStateChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) *model.EngineError {
	owner := f.providerOwnerKey()
	bag := f.providerStateBag(owner, f.ownerProviderRef, true)
	if !bag.Present() || bag.Fields().At(op.Ref).StateKind != model.ProviderStateKindCooldown {
		return f.run.processErr(op.Path, "internal cooldown requires its explicit compiled state binding", op.Ref)
	}
	if op.StateScope != stateScopeProvider && op.StateScope != stateScopeProviderTarget {
		return f.run.processErr(op.Path, "internal cooldown requires its explicit state scope", op.Ref)
	}
	if op.StateScope == stateScopeProviderTarget {
		f.activateProviderTarget(bag, owner, f.ownerProviderRef, f.targetKey)
	}
	id := actionpkg.StateCooldownIdentity(owner, f.ownerProviderRef, op.Ref, op.StateScope, f.targetKey)
	ledger := f.stageFor(owner).writableCooldowns()
	current := effectpkg.InternalCooldownValue(ledger.View(), id, f.run.loop.TimeMs())
	next, message := bag.NextStateValue(op.Ref, current, amount, op.ValuePolicy)
	if message != "" || (next != 0 && next != 1) {
		if message == "" {
			message = "internal cooldown activity must be zero or one"
		}
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	changed := false
	if next == 0 {
		changed = ledger.Reset(id, f.run.loop.TimeMs())
	} else {
		var valid bool
		changed, valid = ledger.Start(id, bag.Fields().At(op.Ref).DurationMs, f.run.loop.TimeMs())
		if !valid {
			return f.run.processErr(op.Path, "internal cooldown requires a safe positive deadline", op.Ref)
		}
	}
	if changed {
		f.stageInternalCooldownExpiry(id)
	}
	bag.InvalidateCooldownProjection()
	bag.ProjectInternalCooldowns(ledger.View(), owner, f.ownerProviderRef, f.run.loop.TimeMs())
	f.stageFor(owner).dirty = true
	f.reResolveStagedAttributesTwoPass(ability)
	if f.fatal {
		return f.fatalErr
	}
	return nil
}

func (f *Frame) applyInternalCooldownDurationChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	owner := f.providerOwnerKey()
	bag := f.providerStateBag(owner, f.ownerProviderRef, true)
	if !bag.Present() || bag.Fields().At(op.Ref).StateKind != model.ProviderStateKindCooldown {
		return f.run.processErr(op.Path, "internal cooldown requires its explicit compiled state binding", op.Ref)
	}
	if op.StateScope != stateScopeProvider && op.StateScope != stateScopeProviderTarget {
		return f.run.processErr(op.Path, "internal cooldown requires its explicit state scope", op.Ref)
	}
	target := ""
	if op.StateScope == stateScopeProviderTarget {
		// 目标CD只作用于当次实际目标；不会去减少另一个活动目标的期限。
		if bag.TargetKey() == "" || bag.TargetKey() != f.targetKey {
			return nil
		}
		target = f.targetKey
	}
	id := actionpkg.StateCooldownIdentity(owner, f.ownerProviderRef, op.Ref, op.StateScope, target)
	if f.stageFor(owner).cooldowns.IsReady(id, f.run.loop.TimeMs()) {
		return nil
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !effectpkg.FiniteState(amount) || amount < 0 || amount > float64(maxJSONSafeInteger) {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "state_duration_change amount must be finite, non-negative and safe", op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	ledger := f.stageFor(owner).writableCooldowns()
	changed, _, _ := ledger.Subtract(id, int64(math.Round(amount)), f.run.loop.TimeMs())
	if changed {
		f.stageInternalCooldownExpiry(id)
	}
	bag.InvalidateCooldownProjection()
	bag.ProjectInternalCooldowns(ledger.View(), owner, f.ownerProviderRef, f.run.loop.TimeMs())
	f.stageFor(owner).dirty = true
	f.reResolveStagedAttributesTwoPass(ability)
	if f.fatal {
		return f.fatalErr
	}
	return nil
}

func (f *Frame) stageInternalCooldownExpiry(id contract.CooldownIdentity) {
	ledger := f.stageFor(id.Owner).writableCooldowns()
	key := actionpkg.InternalCooldownWaitKey(id)
	// 同帧多次写同一个CD只发布最终期限，不重复消费队列容量。
	for i := len(f.pendingStateExpiry) - 1; i >= 0; i-- {
		payload := f.pendingStateExpiry[i].payload
		if payload.Kind == "provider_cooldown" && payload.CombatantKey == id.Owner && payload.ProviderRef == id.ProviderRef && payload.StateKey == id.StateKey && payload.TargetKey == id.Target {
			f.pendingStateExpiry = append(f.pendingStateExpiry[:i], f.pendingStateExpiry[i+1:]...)
		}
	}
	if ledger.IsReady(id, f.run.loop.TimeMs()) {
		ledger.CancelWait(key)
		return
	}
	wait := ledger.RegisterWait(key, []contract.CooldownIdentity{id}, 0, f.run.loop.TimeMs())
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: wait.ReadyAt, payload: effectpkg.ExpiryPayload{
		Kind: "provider_cooldown", CombatantKey: id.Owner, ProviderRef: id.ProviderRef, StateKey: id.StateKey,
		TargetKey: id.Target, ExpectedExpireAt: wait.ReadyAt, CooldownVersion: wait.Version,
	}})
}

func (s *Engine) seedInternalCooldownExpiries() {
	owners := make([]string, 0, len(s.combatants))
	for owner := range s.combatants {
		owners = append(owners, owner)
	}
	sort.Strings(owners)
	for _, owner := range owners {
		actor := s.combatants[owner]
		if actor.cooldowns == nil {
			continue
		}
		keys := make([]contract.CooldownIdentity, 0)
		for slot := 0; slot < actor.cooldowns.EntryCount(); slot++ {
			id, _ := actor.cooldowns.EntryAt(slot)
			if id.StateKey != "" && actor.cooldowns.Remaining(id, s.loop.TimeMs()) > 0 {
				keys = append(keys, id)
			}
		}
		actionpkg.SortCooldownIdentities(keys)
		for _, id := range keys {
			wait := actor.cooldowns.RegisterWait(actionpkg.InternalCooldownWaitKey(id), []contract.CooldownIdentity{id}, 0, s.loop.TimeMs())
			s.enqueueExpireCleanup(wait.ReadyAt, effectpkg.ExpiryPayload{Kind: "provider_cooldown", CombatantKey: id.Owner, ProviderRef: id.ProviderRef,
				StateKey: id.StateKey, TargetKey: id.Target, ExpectedExpireAt: wait.ReadyAt, CooldownVersion: wait.Version})
		}
		s.combatants[owner] = actor
	}
}

func (s *Engine) applyInternalCooldownExpiry(payload effectpkg.ExpiryPayload) {
	owner, exists := s.combatants[payload.CombatantKey]
	if !exists {
		return
	}
	if _, _, mounted := owner.instances.Providers().Find(payload.ProviderRef); !mounted {
		return
	}
	bag := owner.providerState.Lookup(payload.ProviderRef)
	if !bag.Present() || (payload.TargetKey != "" && bag.TargetKey() != payload.TargetKey) {
		return
	}
	scope := stateScopeProvider
	if payload.TargetKey != "" {
		scope = stateScopeProviderTarget
	}
	id := actionpkg.StateCooldownIdentity(payload.CombatantKey, payload.ProviderRef, payload.StateKey, scope, payload.TargetKey)
	key := actionpkg.InternalCooldownWaitKey(id)
	if !owner.cooldowns.WaitCurrent(key, payload.ExpectedExpireAt, payload.CooldownVersion) || owner.cooldowns.ReadyAt(id) != payload.ExpectedExpireAt || s.loop.TimeMs() < payload.ExpectedExpireAt {
		return
	}
	var storage Frame
	s.initExecutionFrame(&storage, model.SelectorSource, model.SelectorTarget, "cooldown_expiry:"+payload.ProviderRef)
	frame := &storage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.CombatantKey, payload.ProviderRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	ledger := frame.stageFor(payload.CombatantKey).writableCooldowns()
	ledger.Set(id, payload.ExpectedExpireAt, s.loop.TimeMs())
	ledger.CancelWait(key)
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
