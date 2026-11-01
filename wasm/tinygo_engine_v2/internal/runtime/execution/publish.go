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
		providers := effectpkg.ProviderList{}.AppendList(base)
		for _, mutation := range staged.providerOps {
			added, next, err := f.preflightProviderMutation(providers, mutation)
			if err != nil {
				return nil, err
			}
			count += added
			providers = next
		}
	}
	if !f.run.loop.Queue().CanPush(count) {
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

func (f *Frame) preflightProviderMutation(providers effectpkg.ProviderList, mutation stagedProviderMutation) (int, effectpkg.ProviderList, *model.EngineError) {
	s := f.run
	badRef := func(message, ref string) (int, effectpkg.ProviderList, *model.EngineError) {
		return 0, providers, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, message, "providers", ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	if mutation.Kind == "apply" || mutation.Kind == "shield_apply" {
		defIndex, exists := mutation.DefinitionIndex, mutation.Kind == "shield_apply"
		if !exists {
			defIndex, exists = s.findProviderDefinitionIndex(mutation.DefinitionRef)
		}
		if !exists {
			return badRef("unknown provider definition", mutation.DefinitionRef)
		}
		definition := s.compiled.Providers[defIndex]
		if definition.PermanentResourceMax {
			return badRef("permanent HP instance is only installed by cold initialization", mutation.DefinitionRef)
		}
		if mutation.Kind != "shield_apply" && definition.Lifecycle != nil && definition.Lifecycle.AllowsSourceTargetReuse() {
			for i, instanceValues := 0, providers; i < instanceValues.Len(); i++ {
				inst := instanceValues.At(i)
				if inst.DefinitionRef == mutation.DefinitionRef && inst.Source == mutation.SourceKey && inst.Owner == mutation.TargetKey && inst.Expired(s.loop.TimeMs()) {
					providers = providers.Slice(0, i).AppendList(providers.Slice(i+1, providers.Len()))
					break
				}
			}
			if inst, index, found := providers.FindSourceTarget(mutation.DefinitionRef, mutation.SourceKey, mutation.TargetKey, s.loop.TimeMs()); found {
				added := 0
				if mutation.HasExpireAt {
					inst.ExpireAt = mutation.ExpireAt
					if mutation.ExpireAt > 0 {
						added++
					}
				}
				providers = providers.With(index, inst)
				return added, providers, nil
			}
		}
		expires := int64(0)
		if mutation.HasExpireAt {
			expires = mutation.ExpireAt
		}
		added := 0
		if expires > 0 {
			added++
		}
		tick, hasTick := findTickAbility(definition, s.compiled)
		if !hasTick || tick.TickSpec == nil || !tick.TickSpec.IsAnchored() {
			interval, delay, ok := s.providerTickSchedule(defIndex)
			if ok && interval > 0 && delay <= s.loop.StartMs()+s.loop.DurationMs()-s.loop.TimeMs() && f.continuousCombatantsLive() {
				first := s.loop.TimeMs() + delay
				if s.actions.BasicAttack() != nil || expires <= 0 || first < expires {
					added++
				}
			}
		}
		providers = providers.Append(effectpkg.Provider{ProviderRef: mutation.ProviderRef, DefinitionRef: mutation.DefinitionRef, DefinitionIndex: defIndex,
			Source: mutation.SourceKey, Owner: mutation.TargetKey, Stacks: 1, ExpireAt: expires})
		return added, providers, nil
	}
	inst, index, exists := providers.Find(mutation.ProviderRef)
	if exists && s.compiled.Providers[inst.DefinitionIndex].PermanentResourceMax {
		return badRef("permanent HP initialization instance cannot be changed in combat", mutation.ProviderRef)
	}
	if mutation.Kind == "ensure_remaining" {
		if !exists || inst.Expired(s.loop.TimeMs()) {
			return 0, providers, nil
		}
		if inst.Owner != mutation.TargetKey || inst.Source != mutation.SourceKey || inst.DefinitionRef != mutation.DefinitionRef {
			return badRef("provider duration change has a foreign instance owner", mutation.ProviderRef)
		}
		if mutation.ExpireAt <= inst.ExpireAt {
			return 0, providers, nil
		}
		inst.ExpireAt = mutation.ExpireAt
		providers = providers.With(index, inst)
		return 1, providers, nil
	}
	if mutation.Kind == "expire" {
		if !exists {
			if mutation.Strict {
				return badRef("expire_provider instance is missing", mutation.ProviderRef)
			}
			return 0, providers, nil
		}
		if mutation.Strict && mutation.DefinitionRef != "" && mutation.DefinitionRef != inst.DefinitionRef {
			return badRef("expire_provider definitionRef mismatch", mutation.ProviderRef)
		}
		return 0, providers.Slice(0, index).AppendList(providers.Slice(index+1, providers.Len())), nil
	}
	if !exists {
		return badRef("unknown providerRef", mutation.ProviderRef)
	}
	definition := s.compiled.Providers[inst.DefinitionIndex]
	if definition.ShieldDefinitionRef != "" {
		return badRef("linked shield provider must be refreshed by applying its shield", mutation.ProviderRef)
	}
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
		if mutation.HasExpireAt && mutation.ExpireAt > inst.ExpireAt {
			inst.ExpireAt = mutation.ExpireAt
			added++
		}
	case "add_stack":
	default:
		if mutation.HasExpireAt {
			inst.ExpireAt = mutation.ExpireAt
			if mutation.ExpireAt > 0 {
				added++
			}
		}
	}
	providers = providers.With(index, inst)
	return added, providers, nil
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
