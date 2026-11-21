package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ExpiryFrame 只公开原帧运输身份，所属移除与投影政策由效果生成并消费。
type ExpiryFrame struct {
	Source, Target, Owner, AbilityRef string
	mutation                          Mutation
	markDirty                         bool
}

// ExpiryExecution 仅提供原独立到期帧及已经存在的状态到期阶段。
type ExpiryExecution interface {
	// CommitEffectExpiry 开立命令指定的原真实帧，消费原预算并统一提交；失败走原延后通道。
	CommitEffectExpiry(frame ExpiryFrame)
	// ExpireProviderCooldown 同步交接该真实内部冷却的原身份复核与到期处理。
	ExpireProviderCooldown(payload effectpkg.ExpiryPayload)
	// ExpireTargetTiming 同步进入原目标计时到期阶段，不重建世代或提前处理末拍。
	ExpireTargetTiming(payload effectpkg.ExpiryPayload)
	// ExpireTargetState 同步进入原目标状态袋的到期阶段。
	ExpireTargetState(payload effectpkg.ExpiryPayload)
	// ExpireSourceState 同步进入原来源状态袋的到期阶段。
	ExpireSourceState(payload effectpkg.ExpiryPayload)
	// SweepEffects 在原无效载荷位置按原拥有者次序请求完整清扫。
	SweepEffects()
}

func (e *Executor) StageExpiryFrame(frame ExpiryFrame, mutations []Mutation, projection *Projection, dirty *bool) []Mutation {
	mutations = append(mutations, frame.mutation)
	if frame.markDirty {
		*dirty = true
		projection.MarkDirty()
	}
	return mutations
}

func (e *Executor) HandleExpiry(payload effectpkg.ExpiryPayload, now int64, automated bool, work ProviderWork, execution ExpiryExecution) {
	switch payload.Kind {
	case "provider_cooldown":
		execution.ExpireProviderCooldown(payload)
	case "provider":
		if payload.ProviderRef == "" {
			return
		}
		if state, exists := work.ReadEffects(payload.CombatantKey); exists {
			if instance, _, found := state.Instances.Providers().Find(payload.ProviderRef); found && instance.ExpireAt > now {
				return
			}
		}
		context := work.ProviderRemovalContext(model.SelectorSource, model.SelectorTarget)
		if !automated && !e.compiled.Features.NeedsExactExpirySweep() {
			e.RemoveLive(payload.CombatantKey, payload.ProviderRef, context, model.EvidenceKindProviderExpire, now, work)
			return
		}
		execution.CommitEffectExpiry(ExpiryFrame{Source: model.SelectorSource, Target: model.SelectorTarget, Owner: payload.CombatantKey, AbilityRef: "provider_expiry:" + payload.ProviderRef,
			mutation: Mutation{Kind: "expire", TargetKey: payload.CombatantKey, ProviderRef: payload.ProviderRef, EvidenceKind: model.EvidenceKindProviderExpire}})
	case "target_timing":
		execution.ExpireTargetTiming(payload)
	case "provider_target_state":
		execution.ExpireTargetState(payload)
	case "provider_source_state":
		execution.ExpireSourceState(payload)
	case "shield":
		e.RemoveExpiredShield(payload.CombatantKey, payload.ShieldRef, now, work, execution)
	default:
		execution.SweepEffects()
	}
}

func (e *Executor) RemoveExpiredShield(owner, reference string, now int64, work ProviderWork, execution ExpiryExecution) {
	state, exists := work.ReadEffects(owner)
	if !exists {
		return
	}
	if e.compiled.Features.Has(plan.FeatureShieldLifecycle) {
		if state.Instances.Shields().HasExpiredRef(reference, now) {
			e.RemoveLiveShield(owner, reference, model.EvidenceKindProviderExpire, now, work, execution)
		}
		return
	}
	state.Instances.SetShields(state.Instances.Shields().RemoveExpiredRef(reference, now))
	work.PublishEffects(owner, state)
}

func (e *Executor) RemoveLiveShield(owner, reference string, kind model.EvidenceKind, now int64, work ProviderWork, execution ExpiryExecution) {
	state, exists := work.ReadEffects(owner)
	if !exists {
		return
	}
	decision := e.decideShieldRemoval(state.Instances, reference)
	if !decision.Found {
		return
	}
	if decision.Atomic {
		execution.CommitEffectExpiry(ExpiryFrame{Source: decision.Shield.Source, Target: owner, Owner: owner, AbilityRef: "shield_expiry:" + reference,
			mutation: Mutation{Kind: "expire", ProviderRef: decision.Shield.LifecycleProviderRef, TargetKey: owner, EvidenceKind: kind}, markDirty: true})
		return
	}
	state.Instances.SetShields(state.Instances.Shields().Remove(decision.Index))
	work.PublishEffects(owner, state)
	if decision.Shield.LifecycleProviderRef != "" {
		e.RemoveLive(owner, decision.Shield.LifecycleProviderRef, work.ProviderRemovalContext(decision.Shield.Source, owner), kind, now, work)
	}
}
