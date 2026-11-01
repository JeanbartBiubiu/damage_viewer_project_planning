package lifecycle

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// TimingRequests 只追加本次效果所需的有限计时，不暴露队列、时钟或发布能力。
type TimingRequests interface {
	// RemainingTimingSlots 返回唯一队列当前容量减去该帧已暂存计时的真实剩余量。
	RemainingTimingSlots() int
	// StageStateExpiry 追加所属状态的期限请求，仍由根层统一预检及发布。
	StageStateExpiry(at int64, payload effectpkg.ExpiryPayload)
	// StageAnchoredTick 追加所属锚定周期请求，仍由根层统一预检及发布。
	StageAnchoredTick(at int64, payload effectpkg.AnchoredPayload)
}

func (e *Executor) TargetTimingBinding(instances effectpkg.ProviderList, owner, ref, key string, now int64) (effectpkg.Provider, int, plan.CompiledTargetTiming, bool) {
	instance, _, found := instances.Find(ref)
	if !found || instance.Owner != owner || instance.Source != owner || instance.Expired(now) || int(instance.DefinitionIndex) >= len(e.compiled.Providers) {
		return instance, 0, plan.CompiledTargetTiming{}, false
	}
	for slot, timing := range e.compiled.Providers[instance.DefinitionIndex].TargetTimings {
		if timing.StateKey == key {
			return instance, slot, timing, true
		}
	}
	return instance, 0, plan.CompiledTargetTiming{}, false
}

func (e *Executor) StageTargetTiming(instance effectpkg.Provider, slot int, timing plan.CompiledTargetTiming, target, key string, value float64, expires, now, stop int64, bag effectpkg.BagChange, requests TimingRequests) *model.EngineError {
	if target == "" || !bag.Present() || slot >= 4 {
		return e.invariant(key, "target timing requires its actual target and bounded slot", "")
	}
	old := bag.Timing(slot)
	if old.Generation == math.MaxUint64 {
		return e.invariant(key, "target timing generation overflow", "")
	}
	fact := effectpkg.TimingFact{Key: key, Generation: old.Generation + 1, Origin: now, Expiry: expires, Active: value > 0 && expires > now}
	bag.SetTiming(slot, fact)
	if !fact.Active {
		bag.SetTargetExpireAt(key, 0)
		return nil
	}
	requests.StageStateExpiry(expires, effectpkg.ExpiryPayload{Kind: "target_timing", CombatantKey: instance.Owner,
		ProviderRef: instance.ProviderRef, TargetKey: target, StateKey: key, StateGeneration: fact.Generation, ExpectedExpireAt: expires, TimingSlot: slot})
	if timing.Phased {
		return e.StageTargetPhases(instance, slot, timing, bag, 0, stop, requests)
	}
	return nil
}

func (e *Executor) StageTargetPhases(instance effectpkg.Provider, slot int, timing plan.CompiledTargetTiming, bag effectpkg.BagChange, after, stop int64, requests TimingRequests) *model.EngineError {
	fact := bag.Timing(slot)
	ability := e.compiled.Abilities[timing.AbilityIndex]
	if ability.TickSpec == nil || ability.TickSpec.IntervalMs <= 0 {
		return e.invariant(timing.StateKey, "phased timing lacks its actual compiled interval", "")
	}
	interval, end := ability.TickSpec.IntervalMs, fact.Expiry
	if end > stop {
		end = stop
	}
	last := int64(0)
	if end > fact.Origin {
		last = (end - fact.Origin) / interval
	}
	first := fact.Scheduled + 1
	if first < 1 {
		first = 1
	}
	if after > fact.Origin {
		if next := (after-fact.Origin)/interval + 1; next > first {
			first = next
		}
	}
	if count := last - first + 1; count > int64(requests.RemainingTimingSlots()) {
		failure := e.invariant("", "phased target tick queue overflow", "")
		failure.BudgetCause = model.BudgetCauseMaxQueueEvents
		return failure
	}
	for ordinal := first; ordinal <= last; ordinal++ {
		requests.StageAnchoredTick(fact.Origin+ordinal*interval, effectpkg.AnchoredPayload{Phased: true, TimingSlot: slot,
			OwnerKey: instance.Owner, ProviderRef: instance.ProviderRef, SourceKey: instance.Source, TargetKey: bag.TargetKey(),
			AnchorStateKey: timing.StateKey, Generation: fact.Generation, ExpectedExpireAt: fact.Expiry})
	}
	if last > fact.Scheduled {
		fact.Scheduled = last
	}
	fact.Protect = last > 0 && fact.Origin+last*interval == fact.Expiry && fact.Expiry <= end
	bag.SetTiming(slot, fact)
	return nil
}

// CurrentPhasedFact 复核当前目标、槽位和世代，不以回调保存的旧期限替代新的事实期限。
func CurrentPhasedFact(payload effectpkg.AnchoredPayload, instance effectpkg.Provider, slot int, timing plan.CompiledTargetTiming, bag effectpkg.BagView) (effectpkg.TimingFact, bool) {
	if !timing.Phased || slot != payload.TimingSlot || payload.SourceKey != instance.Source ||
		!bag.Present() || !bag.HasTiming() || bag.TargetKey() != payload.TargetKey {
		return effectpkg.TimingFact{}, false
	}
	fact := bag.Timing(slot)
	return fact, fact.Active && fact.Generation == payload.Generation && fact.Key == payload.AnchorStateKey
}

// TargetTimingClearCurrent 在命令预算消耗前核对本帧实际目标、世代、活动状态和完整期限。
func TargetTimingClearCurrent(bag effectpkg.BagChange, target string, slot int, generation uint64, expiry int64) bool {
	return bag.Present() && bag.HasTiming() && bag.TargetKey() == target && bag.Timing(slot).Generation == generation &&
		bag.Timing(slot).Active && bag.Timing(slot).Expiry == expiry
}

// ClearTargetTiming 在命令预算已经接纳后暂存状态清除，不执行数值操作或报告。
func ClearTargetTiming(bag effectpkg.BagChange, key string, slot int) {
	fact := bag.Timing(slot)
	fact.Active, fact.Protect = false, false
	bag.SetTiming(slot, fact)
	bag.SetTargetValue(key, bag.Fields().At(key).DefaultValue)
	bag.SetTargetExpireAt(key, 0)
}
