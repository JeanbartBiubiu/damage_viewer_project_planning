package lifecycle

import (
	"sort"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ExpiryRequests 只把本次效果已决定的期限交给唯一循环，不授予队列或时钟。
type ExpiryRequests interface {
	// EnqueueExpiry 在原直接入队位置提交真实到期请求，保留原容量失败语义。
	EnqueueExpiry(at int64, payload effectpkg.ExpiryPayload)
}

// SeedEffectExpiries 按原实例、护盾、来源袋及排序字段顺序恢复现有期限请求。
func SeedEffectExpiries(key string, instances effectpkg.InstanceState, bags *effectpkg.BagState, now int64, requests ExpiryRequests) {
	for instanceIndex, instanceValues := 0, instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		inst := instanceValues.At(instanceIndex)
		if inst.ExpireAt > 0 && inst.ExpireAt > now {
			requests.EnqueueExpiry(inst.ExpireAt, effectpkg.ExpiryPayload{
				CombatantKey: key,
				ProviderRef:  inst.ProviderRef,
				Kind:         "provider",
			})
		}
	}
	for instanceIndex, instanceValues := 0, instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		sh := instanceValues.At(instanceIndex)
		if sh.ExpireAt > 0 && sh.ExpireAt > now {
			requests.EnqueueExpiry(sh.ExpireAt, effectpkg.ExpiryPayload{
				CombatantKey: key,
				ShieldRef:    sh.ShieldRef,
				Kind:         "shield",
			})
		}
	}
	refs := bags.Keys()
	sort.Strings(refs)
	for _, ref := range refs {
		bag := bags.Lookup(ref)
		if !bag.Present() {
			continue
		}
		for _, scope := range []string{"provider_source_state", "provider_target_state"} {
			timers := bag.ExpireAt()
			if scope == "provider_target_state" {
				timers = bag.TargetExpireAt()
			}
			fields := make([]string, 0, timers.Len())
			timers.Range(func(field string, _ int64) bool { fields = append(fields, field); return true })
			sort.Strings(fields)
			for _, field := range fields {
				if expires := timers.At(field); expires > now {
					requests.EnqueueExpiry(expires, effectpkg.ExpiryPayload{Kind: scope, CombatantKey: key,
						ProviderRef: ref, TargetKey: bag.TargetKey(), StateKey: field, ExpectedExpireAt: expires})
				}
			}
		}
	}
}

// SeedCooldownExpiries 只从实际行动冷却账登记活动状态期限，不保存第二份截止。
func SeedCooldownExpiries(owner string, ledger *actionpkg.CooldownLedger, now int64, requests ExpiryRequests) {
	if ledger == nil {
		return
	}
	identities := make([]contract.CooldownIdentity, 0)
	for slot := 0; slot < ledger.EntryCount(); slot++ {
		id, _ := ledger.EntryAt(slot)
		if id.StateKey != "" && ledger.Remaining(id, now) > 0 {
			identities = append(identities, id)
		}
	}
	actionpkg.SortCooldownIdentities(identities)
	for _, id := range identities {
		wait := ledger.RegisterWait(actionpkg.InternalCooldownWaitKey(id), []contract.CooldownIdentity{id}, 0, now)
		requests.EnqueueExpiry(wait.ReadyAt, effectpkg.ExpiryPayload{Kind: "provider_cooldown", CombatantKey: id.Owner, ProviderRef: id.ProviderRef, StateKey: id.StateKey, TargetKey: id.Target, ExpectedExpireAt: wait.ReadyAt, CooldownVersion: wait.Version})
	}
}
