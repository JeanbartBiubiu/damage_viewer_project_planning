// 统一队列容量预检、计时请求发布及原同步尾部。
package execution

import (
	"sort"
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
)

type pendingFrameStateExpiry struct {
	at      int64
	payload effectpkg.ExpiryPayload
}

type pendingFrameAnchoredTick struct {
	at      int64
	payload effectpkg.AnchoredPayload
}

type pendingFrameProviderTick struct {
	at          int64
	owner       string
	provider    string
	intervalMs  int64
	expireAt    int64
	activatedAt int64
}

func (f *Frame) providerTickCanContinue() bool {
	if f.pendingProviderTick == nil {
		return false
	}
	if f.run.actions.BasicAttack() == nil {
		return true
	}
	return f.continuousCombatantsLive()
}

func (f *Frame) continuousCombatantsLive() bool {
	if f.run.actions.BasicAttack() == nil {
		return true
	}
	for _, key := range []string{f.run.actions.BasicAttack().Plan().Source, f.run.actions.BasicAttack().Plan().Target} {
		if f.run.actions.Dead(key) {
			return false
		}
		health := f.run.combatantHp(key)
		if staged := f.staged.Get(key); staged != nil {
			health = staged.attributesView().At("hp").Current
		}
		if health <= 0 {
			return false
		}
	}
	return true
}

func (f *Frame) stageProviderTargetStateExpiry(owner, provider, target, key string, expires int64) {
	lifecycle.StageTargetStateExpiry(owner, provider, target, key, expires, (*stateExecutionFrame)(f))
}

func (f *Frame) commitKeysAndPreflight(keyBuffer []string) ([]string, *model.EngineError) {
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
	if f.effectProjection.ChangeCount() > 0 {
		for _, key := range keys {
			for _, mut := range f.staged.Get(key).providerOps {
				if !mut.Projected {
					return nil, f.run.processErr("providers", "atomic dynamic provider batch cannot mix unsupported non-pure provider lifecycle operations", mut.ProviderRef)
				}
			}
		}
	}
	count := len(f.pendingStateExpiry) + len(f.pendingAnchoredTicks) + waitEvents
	cooldownEvents, cooldownError := f.prepareCooldownWakeups()
	if cooldownError != nil {
		return nil, cooldownError
	}
	count += cooldownEvents
	for _, pending := range f.pendingAmmoWaits {
		if pending.wait.Active && f.ammoCombatantsLive(pending.ammo) {
			count++
		}
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
		for instanceIndex, instanceValues := 0, staged.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			shield := instanceValues.At(instanceIndex)
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
		base := staged.instances.Providers()
		if staged.instances.Projected() {
			base = staged.instances.BaseProviders()
		}
		executor := f.run.lifecycleExecutor()
		added, err := executor.PreflightMutations(base, staged.providerOps, lifecycle.MutationPreflight{
			Now: f.run.loop.TimeMs(), Stop: f.run.loop.StartMs() + f.run.loop.DurationMs(),
			BasicAttack: f.run.actions.BasicAttack() != nil, ParticipantsAlive: f.continuousCombatantsLive(),
		})
		if err != nil {
			return nil, err
		}
		count += added
	}
	if !f.run.loop.CanEnqueue(count) {
		return nil, f.run.budgetError(model.BudgetCauseMaxQueueEvents, "frame combat event queue overflow")
	}
	return keys, nil
}

// 只扣除已经暂存在本帧的两类计时请求；总帧排程仍由原统一预检核定。
func (f *Frame) remainingTimingSlots() int {
	return f.run.loop.RemainingCapacity() - len(f.pendingAnchoredTicks) - len(f.pendingStateExpiry)
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

func (f *Frame) commitFrameQueues() {
	f.commitAmmoWait()
	f.commitBasicAttackWait()
	f.commitCooldownWakeups()
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
