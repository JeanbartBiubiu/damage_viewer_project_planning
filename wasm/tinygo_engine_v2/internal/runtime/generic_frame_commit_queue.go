package runtime

import (
	"sort"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/status"
)

type pendingFrameStateExpiry struct {
	at      int64
	payload expireCleanupPayload
}

type pendingFrameAnchoredTick struct {
	at      int64
	payload anchoredTickPayload
}

type pendingFrameProviderTick struct {
	at          int64
	owner       string
	provider    string
	intervalMs  int64
	expireAt    int64
	activatedAt int64
}

func (f *executionFrame) providerTickCanContinue() bool {
	if f.pendingProviderTick == nil {
		return false
	}
	if f.run.basicAttack == nil {
		return true
	}
	return f.continuousCombatantsLive()
}

func (f *executionFrame) continuousCombatantsLive() bool {
	if f.run.basicAttack == nil {
		return true
	}
	for _, key := range []string{f.run.basicAttack.plan.Source, f.run.basicAttack.plan.Target} {
		if f.run.actionDeaths[key] {
			return false
		}
		health := f.run.combatantHp(key)
		if staged := f.staged.Get(key); staged != nil {
			health = staged.attributes.At("hp").Current
		}
		if health <= 0 {
			return false
		}
	}
	return true
}

func (f *executionFrame) stageProviderTargetStateExpiry(owner, provider, target, key string, expires int64) {
	if expires <= 0 || owner == "" || provider == "" || key == "" {
		return
	}
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: expires, payload: expireCleanupPayload{
		kind: "provider_target_state", combatantKey: owner, providerRef: provider,
		targetKey: target, stateKey: key, expectedExpireAt: expires,
	}})
}

func (f *executionFrame) stageAnchoredTicksOnTargetWrite(owner, provider, source, target, key string, expires int64, bag *providerStateBag) *model.EngineError {
	if bag == nil || expires <= 0 || owner == "" || provider == "" || target == "" || key == "" {
		return nil
	}
	inst, _, exists := status.FindByRef(f.run.combatants[owner].providers, provider)
	if !exists {
		return nil
	}
	ability, exists := f.run.findAnchoredTickAbility(inst.DefinitionIndex, key)
	if !exists || ability.TickSpec.IntervalMs <= 0 {
		return nil
	}
	interval := ability.TickSpec.IntervalMs
	end := expires
	if runEnd := f.run.startMs + f.run.durationMs; end > runEnd {
		end = runEnd
	}
	count := int64(0)
	if end > f.run.nowMs {
		count = (end - f.run.nowMs) / interval
	}
	if count > int64(f.run.heap.RemainingCapacity()-len(f.pendingAnchoredTicks)-len(f.pendingStateExpiry)) {
		return f.run.budgetError(model.BudgetCauseMaxQueueEvents, "anchored tick queue overflow")
	}
	gen := bag.bumpAnchoredTickGeneration(key)
	if source == "" {
		source = inst.Source
	}
	if source == "" {
		source = owner
	}
	for i := int64(1); i <= count; i++ {
		f.pendingAnchoredTicks = append(f.pendingAnchoredTicks, pendingFrameAnchoredTick{
			at: f.run.nowMs + i*interval,
			payload: anchoredTickPayload{ownerKey: owner, providerRef: provider, sourceKey: source,
				targetKey: target, anchorStateKey: key, generation: gen, expectedExpireAt: expires},
		})
	}
	return nil
}

func (f *executionFrame) commitKeysAndPreflight(keyBuffer []string) ([]string, *model.EngineError) {
	if f.run.processFailure != nil {
		return nil, f.run.processFailure
	}
	if err := f.validatePlannedProcessDeadline(); err != nil {
		return nil, err
	}
	waitEvents, waitError := f.prepareBasicAttackWait()
	if waitError != nil {
		return nil, waitError
	}
	keys := sortedFrameCombatantKeys(f.staged, keyBuffer)
	count := len(f.pendingStateExpiry) + len(f.pendingAnchoredTicks) + waitEvents
	if f.pendingAmmoWait != nil && f.pendingAmmoWait.active && f.continuousCombatantsLive() {
		count++
	}
	if f.providerTickCanContinue() {
		count++
	}
	if f.pendingProcessTimer {
		count++
	}
	for _, pending := range f.pendingShieldExpires {
		staged := f.staged.Get(pending.combatantKey)
		if staged == nil || pending.expireAt <= 0 || pending.shieldRef == "" {
			continue
		}
		for _, shield := range staged.shields {
			if shield.ShieldRef == pending.shieldRef {
				if shield.ExpireAt > 0 {
					count++
				}
				break
			}
		}
	}
	// 只对本帧有生命周期操作的挂载列表做小范围预演。队列、历史与过程总表不复制。
	for _, key := range keys {
		staged := f.staged.Get(key)
		if len(staged.providerOps) == 0 {
			continue
		}
		providers := append([]status.ProviderInstance(nil), staged.providers...)
		for _, mutation := range staged.providerOps {
			added, next, err := f.preflightProviderMutation(providers, mutation)
			if err != nil {
				return nil, err
			}
			count += added
			providers = next
		}
	}
	if !f.run.heap.CanPush(count) {
		return nil, f.run.budgetError(model.BudgetCauseMaxQueueEvents, "frame combat event queue overflow")
	}
	return keys, nil
}

func sortedFrameCombatantKeys(staged *frameStagedCollection, keyBuffer []string) []string {
	if staged.Len() > 2 {
		// 额外参与者独立收集，避免常见两键缓冲流入通用排序。
		keys := make([]string, 0, staged.Len())
		staged.Range(func(key string, _ *stagedCombatant) { keys = append(keys, key) })
		sort.Strings(keys)
		return keys
	}
	keys := keyBuffer[:0]
	staged.Range(func(key string, _ *stagedCombatant) { keys = append(keys, key) })
	if len(keys) == 2 && keys[1] < keys[0] {
		keys[0], keys[1] = keys[1], keys[0]
	}
	return keys
}

func (f *executionFrame) preflightProviderMutation(providers []status.ProviderInstance, mutation stagedProviderMutation) (int, []status.ProviderInstance, *model.EngineError) {
	s := f.run
	badRef := func(message, ref string) (int, []status.ProviderInstance, *model.EngineError) {
		return 0, providers, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, message, "providers", ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	if mutation.kind == "apply" {
		defIndex, exists := s.findProviderDefinitionIndex(mutation.definitionRef)
		if !exists {
			return badRef("unknown provider definition", mutation.definitionRef)
		}
		definition := s.compiled.Providers[defIndex]
		if definition.Lifecycle != nil && definition.Lifecycle.AllowsSourceTargetReuse() {
			for i, inst := range providers {
				if inst.DefinitionRef == mutation.definitionRef && inst.Source == mutation.sourceKey && inst.Owner == mutation.targetKey && inst.Expired(s.nowMs) {
					providers = append(providers[:i], providers[i+1:]...)
					break
				}
			}
			if inst, index, found := findSourceTargetProvider(providers, mutation.definitionRef, mutation.sourceKey, mutation.targetKey, s.nowMs); found {
				added := 0
				if mutation.hasExpireAt {
					inst.ExpireAt = mutation.expireAt
					if mutation.expireAt > 0 {
						added++
					}
				}
				providers[index] = inst
				return added, providers, nil
			}
		}
		expires := int64(0)
		if mutation.hasExpireAt {
			expires = mutation.expireAt
		}
		added := 0
		if expires > 0 {
			added++
		}
		tick, hasTick := findTickAbility(definition, s.compiled)
		if !hasTick || tick.TickSpec == nil || !tick.TickSpec.IsAnchored() {
			interval, delay, ok := s.providerTickSchedule(defIndex)
			if ok && interval > 0 && delay <= s.startMs+s.durationMs-s.nowMs && f.continuousCombatantsLive() {
				first := s.nowMs + delay
				if s.basicAttack != nil || expires <= 0 || first < expires {
					added++
				}
			}
		}
		providers = append(providers, status.ProviderInstance{DefinitionRef: mutation.definitionRef, DefinitionIndex: defIndex,
			Source: mutation.sourceKey, Owner: mutation.targetKey, Stacks: 1, ExpireAt: expires})
		return added, providers, nil
	}
	inst, index, exists := status.FindByRef(providers, mutation.providerRef)
	if mutation.kind == "expire" {
		if !exists {
			if mutation.strict {
				return badRef("expire_provider instance is missing", mutation.providerRef)
			}
			return 0, providers, nil
		}
		if mutation.strict && mutation.definitionRef != "" && mutation.definitionRef != inst.DefinitionRef {
			return badRef("expire_provider definitionRef mismatch", mutation.providerRef)
		}
		return 0, append(providers[:index], providers[index+1:]...), nil
	}
	if !exists {
		return badRef("unknown providerRef", mutation.providerRef)
	}
	definition := s.compiled.Providers[inst.DefinitionIndex]
	policy := model.RefreshPolicyReplace
	if definition.Lifecycle != nil && definition.Lifecycle.RefreshPolicy != "" {
		policy = definition.Lifecycle.RefreshPolicy
	}
	if definition.Lifecycle != nil && definition.Lifecycle.AllowsSourceTargetReuse() {
		policy = model.RefreshPolicyReplace
	}
	added := 0
	switch policy {
	case "extend":
		if mutation.hasExpireAt && mutation.expireAt > inst.ExpireAt {
			inst.ExpireAt = mutation.expireAt
			added++
		}
	case "add_stack":
	default:
		if mutation.hasExpireAt {
			inst.ExpireAt = mutation.expireAt
			if mutation.expireAt > 0 {
				added++
			}
		}
	}
	providers[index] = inst
	return added, providers, nil
}

func (f *executionFrame) commitFrameQueues() {
	f.commitAmmoWait()
	f.commitBasicAttackWait()
	for _, pending := range f.pendingStateExpiry {
		f.run.enqueueExpireCleanup(pending.at, pending.payload)
	}
	for _, pending := range f.pendingAnchoredTicks {
		f.run.enqueueAnchoredTickAt(pending.at, pending.payload)
	}
	if f.providerTickCanContinue() {
		pending := f.pendingProviderTick
		f.run.enqueueProviderTickAt(pending.at, pending.owner, pending.provider, pending.intervalMs, pending.expireAt, pending.activatedAt)
	}
	f.enqueueCommittedTimedShields()
	if f.pendingProcessTimer {
		f.run.processFailure = f.run.enqueueProcessTimer(f.processOriginal)
	}
}
