package lifecycle

import (
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type ExpiredSweep struct {
	Changed bool
	Refs    []string
	Expired effectpkg.ProviderList
}

type ShieldRemoval struct {
	Shield effectpkg.Shield
	Index  int
	Atomic bool
	Found  bool
}

// ExpiredEffects 只在原惰性清扫位置同步卸载给定真实实例，跨行动、监听及数值顺序由根层组合。
type ExpiredEffects interface {
	// RemoveExpiredProvider 卸载当前真实实例，按其实际施加者准备原属性求值上下文。
	RemoveExpiredProvider(owner, provider, source string)
	// RemoveExpiredShield 卸载当前真实护盾及关联供值实例，保持原帧边界。
	RemoveExpiredShield(owner, reference string)
}

func (e *Executor) PrepareProviderRemoval(instances *effectpkg.InstanceState, reference string) (effectpkg.Provider, bool) {
	if e.compiled.HasShieldLifecycle {
		instances.SetShields(instances.Shields().WithoutProvider(reference))
	}
	instance, _, exists := instances.Providers().Find(reference)
	return instance, exists
}

// RemoveProviderState 在行动及监听清理已同步完成后移除效果、状态和真实冷却归属。
func RemoveProviderState(owner, reference string, instances *effectpkg.InstanceState, bags *effectpkg.BagState, cooldowns **actionpkg.CooldownLedger, now int64) {
	*cooldowns = (*cooldowns).Clone()
	(*cooldowns).RemoveProvider(owner, reference, now)
	instances.SetProviders(instances.Providers().RemoveRef(reference))
	bags.Remove(reference)
}

// SweepExpiredState 只修改该拥有者的效果状态，交付后续跨双方卸载和属性更新所需原实例事实。
func SweepExpiredState(instances *effectpkg.InstanceState, bags *effectpkg.BagState, now int64) ExpiredSweep {
	result := ExpiredSweep{Refs: make([]string, 0)}
	active := effectpkg.ProviderList{}
	for index, values := 0, instances.Providers(); index < values.Len(); index++ {
		instance := values.At(index)
		if instance.Expired(now) {
			result.Refs = append(result.Refs, instance.ProviderRef)
			result.Expired = result.Expired.Append(instance)
			bags.Remove(instance.ProviderRef)
			result.Changed = true
			continue
		}
		active = active.Append(instance)
	}
	if result.Changed {
		instances.SetProviders(active)
	} else {
		instances.SetShields(instances.Shields().RemoveExpired(now))
	}
	return result
}

func (e *Executor) DecideShieldRemoval(instances effectpkg.InstanceState, reference string) ShieldRemoval {
	for index, shields := 0, instances.Shields(); index < shields.Len(); index++ {
		shield := shields.At(index)
		if shield.ShieldRef != reference {
			continue
		}
		provider, _, found := instances.Providers().Find(shield.LifecycleProviderRef)
		return ShieldRemoval{Shield: shield, Index: index, Found: true,
			Atomic: found && e.compiled.Providers[provider.DefinitionIndex].AtomicLinkedShield}
	}
	return ShieldRemoval{}
}

// SweepLinkedProviders 按清扫开始时借用的稳定实例顺序逐个卸载，保留每次卸载的真实发布边界。
func SweepLinkedProviders(owner string, providers effectpkg.ProviderList, now int64, execution ExpiredEffects) {
	for index := 0; index < providers.Len(); index++ {
		provider := providers.At(index)
		if provider.Expired(now) {
			execution.RemoveExpiredProvider(owner, provider.ProviderRef, provider.Source)
		}
	}
}

// SweepLinkedShields 必须在本拥有者供值清扫完成后取得当前护盾视图，再按原稳定顺序卸载。
func SweepLinkedShields(owner string, shields effectpkg.ShieldList, now int64, execution ExpiredEffects) {
	for index := 0; index < shields.Len(); index++ {
		shield := shields.At(index)
		if shield.Remaining <= 0 || shield.Expired(now) {
			execution.RemoveExpiredShield(owner, shield.ShieldRef)
		}
	}
}
