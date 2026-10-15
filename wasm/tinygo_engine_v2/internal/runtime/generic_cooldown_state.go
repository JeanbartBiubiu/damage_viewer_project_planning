package runtime

import (
	"math"
	"sort"
	"strconv"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/status"
)

func internalCooldownValue(ledger *genericCooldownLedger, id genericCooldownIdentity, now int64) float64 {
	if ledger.remaining(id, now) > 0 {
		return 1
	}
	return 0
}

// 投影不保留账本指针；读取者必须传入自己冻结或当次帧的实际版本。
func (b *providerStateBag) projectInternalCooldowns(ledger *genericCooldownLedger, owner, provider string, now int64) {
	if b == nil || ledger == nil || !b.hasInternalCooldowns {
		return
	}
	if b.cooldownProjectionBound && b.cooldownProjectionVersion == ledger.revision && b.cooldownProjectionAt == now {
		return
	}
	values := cloneFloatMap(b.state)
	for key, def := range b.fieldDefs {
		if def.stateKind == model.ProviderStateKindCooldown {
			values[key] = internalCooldownValue(ledger, genericStateCooldownIdentity(owner, provider, key, stateScopeProvider, ""), now)
		}
	}
	b.state, b.stateShared = values, true
	if b.targetKey != "" {
		target := cloneFloatMap(b.targetValues)
		for _, slot := range ledger.entries {
			id := slot.id
			if id.owner == owner && id.providerRef == provider && id.scope == stateScopeProviderTarget && id.target == b.targetKey && b.fieldDefs[id.stateKey].stateKind == model.ProviderStateKindCooldown {
				target[id.stateKey] = internalCooldownValue(ledger, id, now)
			}
		}
		for key := range target {
			if b.fieldDefs[key].stateKind == model.ProviderStateKindCooldown {
				target[key] = internalCooldownValue(ledger, genericStateCooldownIdentity(owner, provider, key, stateScopeProviderTarget, b.targetKey), now)
			}
		}
		b.targetValues, b.targetValuesShared = target, true
	}
	b.cooldownProjectionBound, b.cooldownProjectionAt, b.cooldownProjectionVersion = true, now, ledger.revision
}

func projectInternalCooldownExpiries(out map[string]interface{}, ledger *genericCooldownLedger, owner, provider, target, scope string, now int64) {
	if ledger == nil {
		return
	}
	for _, slot := range ledger.entries {
		id, entry := slot.id, slot.value
		if id.owner == owner && id.providerRef == provider && id.scope == scope && id.target == target && entry.active && entry.readyAt > now {
			out[id.stateKey] = float64(entry.readyAt)
		}
	}
}

// 初始快照的现有状态形状只在恢复边界读取；随后移除CD的旧数值期限。
func migrateInternalCooldownTimers(bag *providerStateBag, ledger *genericCooldownLedger, owner, provider string, now int64) {
	if bag == nil || !bag.hasInternalCooldowns {
		return
	}
	keys := make([]string, 0)
	for key, def := range bag.fieldDefs {
		if def.stateKind == model.ProviderStateKindCooldown {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		if ready := bag.expireAt[key]; bag.state[key] != 0 && ready > now {
			ledger.set(genericStateCooldownIdentity(owner, provider, key, stateScopeProvider, ""), ready, now)
		}
		delete(bag.writableExpireAt(), key)
		if bag.targetKey != "" {
			if ready := bag.targetExpireAt[key]; bag.targetValues[key] != 0 && ready > now {
				ledger.set(genericStateCooldownIdentity(owner, provider, key, stateScopeProviderTarget, bag.targetKey), ready, now)
			}
		}
		delete(bag.writableTargetExpireAt(), key)
	}
	bag.cooldownProjectionBound = false
	bag.projectInternalCooldowns(ledger, owner, provider, now)
}

func internalCooldownWaitKey(id genericCooldownIdentity) genericCooldownWaitKey {
	part := func(value string) string { return strconv.Itoa(len(value)) + ":" + value }
	return genericCooldownWaitKey{kind: "provider_cooldown", owner: id.owner, key: part(id.providerRef) + part(id.scope) + part(id.stateKey) + part(id.target)}
}

func (f *executionFrame) activateProviderTarget(bag *providerStateBag, owner, provider, target string) {
	if bag == nil || target == "" {
		return
	}
	if bag.targetKey != "" && bag.targetKey != target {
		ledger := f.stageFor(owner).writableCooldowns()
		ledger.removeTarget(owner, provider, bag.targetKey, f.run.nowMs)
	}
	bag.activateProviderTarget(target)
	bag.cooldownProjectionBound = false
}

func (f *executionFrame) applyInternalCooldownStateChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) *model.EngineError {
	owner := f.providerOwnerKey()
	bag := f.providerStateBag(owner, f.ownerProviderRef, true)
	if bag == nil || bag.fieldDefs[op.Ref].stateKind != model.ProviderStateKindCooldown {
		return f.run.processErr(op.Path, "internal cooldown requires its explicit compiled state binding", op.Ref)
	}
	if op.StateScope != stateScopeProvider && op.StateScope != stateScopeProviderTarget {
		return f.run.processErr(op.Path, "internal cooldown requires its explicit state scope", op.Ref)
	}
	if op.StateScope == stateScopeProviderTarget {
		f.activateProviderTarget(bag, owner, f.ownerProviderRef, f.targetKey)
	}
	id := genericStateCooldownIdentity(owner, f.ownerProviderRef, op.Ref, op.StateScope, f.targetKey)
	ledger := f.stageFor(owner).writableCooldowns()
	current := internalCooldownValue(ledger, id, f.run.nowMs)
	next, message := bag.nextStateValue(op.Ref, current, amount, op.ValuePolicy)
	if message != "" || (next != 0 && next != 1) {
		if message == "" {
			message = "internal cooldown activity must be zero or one"
		}
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	changed := false
	if next == 0 {
		changed = ledger.reset(id, f.run.nowMs)
	} else {
		var valid bool
		changed, valid = ledger.start(id, bag.fieldDefs[op.Ref].durationMs, f.run.nowMs)
		if !valid {
			return f.run.processErr(op.Path, "internal cooldown requires a safe positive deadline", op.Ref)
		}
	}
	if changed {
		f.stageInternalCooldownExpiry(id)
	}
	bag.cooldownProjectionBound = false
	bag.projectInternalCooldowns(ledger, owner, f.ownerProviderRef, f.run.nowMs)
	f.stageFor(owner).dirty = true
	f.reResolveStagedAttributesTwoPass(ability)
	if f.fatal {
		return f.fatalErr
	}
	return nil
}

func (f *executionFrame) applyInternalCooldownDurationChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	owner := f.providerOwnerKey()
	bag := f.providerStateBag(owner, f.ownerProviderRef, true)
	if bag == nil || bag.fieldDefs[op.Ref].stateKind != model.ProviderStateKindCooldown {
		return f.run.processErr(op.Path, "internal cooldown requires its explicit compiled state binding", op.Ref)
	}
	if op.StateScope != stateScopeProvider && op.StateScope != stateScopeProviderTarget {
		return f.run.processErr(op.Path, "internal cooldown requires its explicit state scope", op.Ref)
	}
	target := ""
	if op.StateScope == stateScopeProviderTarget {
		// 目标CD只作用于当次实际目标；不会去减少另一个活动目标的期限。
		if bag.targetKey == "" || bag.targetKey != f.targetKey {
			return nil
		}
		target = f.targetKey
	}
	id := genericStateCooldownIdentity(owner, f.ownerProviderRef, op.Ref, op.StateScope, target)
	if f.stageFor(owner).cooldowns.isReady(id, f.run.nowMs) {
		return nil
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !finiteState(amount) || amount < 0 || amount > float64(maxJSONSafeInteger) {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "state_duration_change amount must be finite, non-negative and safe", op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	ledger := f.stageFor(owner).writableCooldowns()
	changed, _, _ := ledger.subtract(id, int64(math.Round(amount)), f.run.nowMs)
	if changed {
		f.stageInternalCooldownExpiry(id)
	}
	bag.cooldownProjectionBound = false
	bag.projectInternalCooldowns(ledger, owner, f.ownerProviderRef, f.run.nowMs)
	f.stageFor(owner).dirty = true
	f.reResolveStagedAttributesTwoPass(ability)
	if f.fatal {
		return f.fatalErr
	}
	return nil
}

func (f *executionFrame) stageInternalCooldownExpiry(id genericCooldownIdentity) {
	ledger := f.stageFor(id.owner).writableCooldowns()
	key := internalCooldownWaitKey(id)
	// 同帧多次写同一个CD只发布最终期限，不重复消费队列容量。
	for i := len(f.pendingStateExpiry) - 1; i >= 0; i-- {
		payload := f.pendingStateExpiry[i].payload
		if payload.kind == "provider_cooldown" && payload.combatantKey == id.owner && payload.providerRef == id.providerRef && payload.stateKey == id.stateKey && payload.targetKey == id.target {
			f.pendingStateExpiry = append(f.pendingStateExpiry[:i], f.pendingStateExpiry[i+1:]...)
		}
	}
	if ledger.isReady(id, f.run.nowMs) {
		ledger.cancelWait(key)
		return
	}
	wait := ledger.registerWait(key, []genericCooldownIdentity{id}, 0, f.run.nowMs)
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: wait.readyAt, payload: expireCleanupPayload{
		kind: "provider_cooldown", combatantKey: id.owner, providerRef: id.providerRef, stateKey: id.stateKey,
		targetKey: id.target, expectedExpireAt: wait.readyAt, cooldownVersion: wait.version,
	}})
}

func (s *genericRunState) seedInternalCooldownExpiries() {
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
		keys := make([]genericCooldownIdentity, 0)
		for _, slot := range actor.cooldowns.entries {
			id := slot.id
			if id.stateKey != "" && actor.cooldowns.remaining(id, s.nowMs) > 0 {
				keys = append(keys, id)
			}
		}
		sortCooldownIdentities(keys)
		for _, id := range keys {
			wait := actor.cooldowns.registerWait(internalCooldownWaitKey(id), []genericCooldownIdentity{id}, 0, s.nowMs)
			s.enqueueExpireCleanup(wait.readyAt, expireCleanupPayload{kind: "provider_cooldown", combatantKey: id.owner, providerRef: id.providerRef,
				stateKey: id.stateKey, targetKey: id.target, expectedExpireAt: wait.readyAt, cooldownVersion: wait.version})
		}
		s.combatants[owner] = actor
	}
}

func (s *genericRunState) applyInternalCooldownExpiry(payload expireCleanupPayload) {
	owner, exists := s.combatants[payload.combatantKey]
	if !exists {
		return
	}
	if _, _, mounted := status.FindByRef(owner.providers, payload.providerRef); !mounted {
		return
	}
	bag := owner.providerState[payload.providerRef]
	if bag == nil || (payload.targetKey != "" && bag.targetKey != payload.targetKey) {
		return
	}
	scope := stateScopeProvider
	if payload.targetKey != "" {
		scope = stateScopeProviderTarget
	}
	id := genericStateCooldownIdentity(payload.combatantKey, payload.providerRef, payload.stateKey, scope, payload.targetKey)
	key := internalCooldownWaitKey(id)
	if !owner.cooldowns.waitCurrent(key, payload.expectedExpireAt, payload.cooldownVersion) || owner.cooldowns.readyAt(id) != payload.expectedExpireAt || s.nowMs < payload.expectedExpireAt {
		return
	}
	var storage executionFrame
	s.initExecutionFrame(&storage, model.SelectorSource, model.SelectorTarget, "cooldown_expiry:"+payload.providerRef)
	frame := &storage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.combatantKey, payload.providerRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	ledger := frame.stageFor(payload.combatantKey).writableCooldowns()
	ledger.set(id, payload.expectedExpireAt, s.nowMs)
	ledger.cancelWait(key)
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
