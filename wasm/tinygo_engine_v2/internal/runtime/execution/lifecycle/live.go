package lifecycle

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// LiveEffects 只运输真实拥有者的所属状态头，不复制内容或持有角色数值。
// 冷却借用仍指向行动的同一账；跨同步读准备后须重新取得当前值。
type LiveEffects struct {
	Instances effectpkg.InstanceState
	Bags      effectpkg.BagState
	Cooldowns *actionpkg.CooldownLedger
}

// ProviderApplication 是一次实际应用的有限身份、期限及已准备贡献。
type ProviderApplication struct {
	Owner, Source, Definition, Reference string
	Expiry                               int64
	HasExpiry                            bool
	Contributions                        effectpkg.ContributionView
}

// ProviderWork 仅借用本次实例执行的所属头运输和原同步外部阶段。
// 排程与数值同步保留原延后失败通道；本接口不提供整场帧、队列或任意操作。
type ProviderWork interface {
	ExpiryRequests
	// ReadEffects 取得当前真实所属状态；不提前创建缺失拥有者或状态袋。
	ReadEffects(owner string) (LiveEffects, bool)
	// EffectOwnerOrder 在普通清扫原上下文准备之后取得当前拥有者原遍历序，不排序或保存。
	EffectOwnerOrder(buffer []string) []string
	// PublishEffects 只交回已决定的所属头，不覆盖数值或其他职责状态。
	PublishEffects(owner string, effects LiveEffects)
	// ProviderRemovalContext 在原位置准备实际双方的有限移除读值。
	ProviderRemovalContext(source, target string) formula.GenericEvalContext
	// MountEffectModifiers 在实例已发布后运输双方效果状态并挂载原修正。
	MountEffectModifiers(owner string, instance effectpkg.Provider)
	// UnmountEffectModifiers 在所属删除发布后卸载双方实际修正。
	UnmountEffectModifiers(owner, reference string)
	// ResolveAppliedEffects 按原应用时点和实际来源同步双方数值，失败仍走原延后通道。
	ResolveAppliedEffects(owner, source string)
	// ResolveRemovedEffects 使用给定原上下文同步拥有者再对方，不重新准备上下文。
	ResolveRemovedEffects(owner string, context formula.GenericEvalContext)
	// RemoveEffectDependents 在所属删除前按原顺序清理行动弹药及监听绑定。
	RemoveEffectDependents(owner, reference string)
	// ScheduleEffectTick 在新挂载原位置读取周期资格并交给唯一队列；不在刷新时重排相位。
	ScheduleEffectTick(instance effectpkg.Provider)
	// RecordEffect 观察已经发生的原实例事实，不因后续绑定失败撤回记录。
	RecordEffect(kind model.EvidenceKind, instance effectpkg.Provider)
	// BindEffectListeners 在新实例、数值和排程之后绑定原动态监听，错误保留已发布前缀。
	BindEffectListeners(instance effectpkg.Provider) *model.EngineError
	// BindImmediateEffectUse 仅在普通应用成功后沿原实际行动绑定激活使用。
	BindImmediateEffectUse(owner, source, definition, use string)
}

func (e *Executor) ApplyLive(input ProviderApplication, now int64, work ProviderWork) *model.EngineError {
	state, _ := work.ReadEffects(input.Owner)
	decision, err := e.decideApplication(input.Definition, input.Source, input.Owner, state.Instances.Providers(), now)
	if err != nil {
		return err
	}
	if decision.ExpiredRef != "" {
		e.RemoveLive(input.Owner, decision.ExpiredRef, work.ProviderRemovalContext(input.Source, input.Owner), model.EvidenceKindProviderExpire, now, work)
		state, _ = work.ReadEffects(input.Owner)
		decision.Existing, decision.ExistingIndex, decision.Replace = state.Instances.Providers().FindSourceTarget(input.Definition, input.Source, input.Owner, now)
	}
	if decision.Replace {
		change := e.replaceProvider(decision.Existing, input.Expiry, input.HasExpiry, input.Contributions, now)
		e.publishRefresh(input.Owner, decision.ExistingIndex, change, model.EvidenceKindProviderRefresh, work)
		return nil
	}
	reference := input.Reference
	if reference == "" {
		reference = e.identities.NextProvider(input.Definition)
	}
	expiry := int64(0)
	if input.HasExpiry {
		expiry = input.Expiry
	}
	instance := e.freshProvider(decision.DefinitionIndex, reference, input.Source, input.Owner, expiry, now, input.Contributions)
	return e.mountLive(instance, work)
}

func (e *Executor) mountLive(instance effectpkg.Provider, work ProviderWork) *model.EngineError {
	state, _ := work.ReadEffects(instance.Owner)
	state.Instances.AppendProvider(instance)
	work.PublishEffects(instance.Owner, state)
	work.MountEffectModifiers(instance.Owner, instance)
	work.ResolveAppliedEffects(instance.Owner, instance.Source)
	if instance.ExpireAt > 0 {
		work.EnqueueExpiry(instance.ExpireAt, effectpkg.ExpiryPayload{CombatantKey: instance.Owner, ProviderRef: instance.ProviderRef, Kind: "provider"})
	}
	work.ScheduleEffectTick(instance)
	work.RecordEffect(model.EvidenceKindProviderApply, instance)
	return work.BindEffectListeners(instance)
}

func (e *Executor) RefreshLive(owner, reference string, expiry int64, hasExpiry bool, contributions effectpkg.ContributionView, now int64, work ProviderWork) *model.EngineError {
	state, exists := work.ReadEffects(owner)
	if !exists {
		return e.fail(model.GenericErrUnknownRef, "", "unknown combatant: "+owner, "")
	}
	instance, index, exists := state.Instances.Providers().Find(reference)
	if !exists {
		return e.fail(model.GenericErrUnknownRef, "", "unknown providerRef: "+reference, "")
	}
	change, err := e.refreshProvider(instance, expiry, hasExpiry, contributions, now)
	if err != nil {
		return err
	}
	e.publishRefresh(owner, index, change, model.EvidenceKindProviderRefresh, work)
	return nil
}

func (e *Executor) publishRefresh(owner string, index int, change refreshDecision, kind model.EvidenceKind, work ProviderWork) {
	if change.EnqueueExpiry {
		work.EnqueueExpiry(change.Instance.ExpireAt, effectpkg.ExpiryPayload{CombatantKey: owner, ProviderRef: change.Instance.ProviderRef, Kind: "provider"})
	}
	state, _ := work.ReadEffects(owner)
	state.Instances.ReplaceProvider(index, change.Instance)
	work.PublishEffects(owner, state)
	work.ResolveAppliedEffects(owner, change.Instance.Source)
	work.RecordEffect(kind, change.Instance)
}

func (e *Executor) RemoveLive(owner, reference string, context formula.GenericEvalContext, kind model.EvidenceKind, now int64, work ProviderWork) {
	state, exists := work.ReadEffects(owner)
	if !exists {
		return
	}
	instance, found := e.prepareProviderRemoval(&state.Instances, reference)
	if !found {
		return
	}
	work.RemoveEffectDependents(owner, reference)
	removeProviderState(owner, reference, &state.Instances, &state.Bags, &state.Cooldowns, now)
	work.PublishEffects(owner, state)
	work.UnmountEffectModifiers(owner, reference)
	work.ResolveRemovedEffects(owner, context)
	if kind != "" {
		work.RecordEffect(kind, instance)
	}
}

func (e *Executor) RemoveLiveStrict(owner, reference, definition string, context formula.GenericEvalContext, now int64, work ProviderWork) *model.EngineError {
	state, exists := work.ReadEffects(owner)
	if !exists {
		return e.fail(model.GenericErrUnknownRef, "combatants", "expire_provider owner is missing", owner)
	}
	instance, _, found := state.Instances.Providers().Find(reference)
	if !found {
		return e.fail(model.GenericErrUnknownRef, "providers", "expire_provider instance is missing", reference)
	}
	if definition != "" && instance.DefinitionRef != definition {
		return e.fail(model.GenericErrUnknownRef, reference, "expire_provider definitionRef mismatch", instance.DefinitionRef)
	}
	e.RemoveLive(owner, reference, context, model.EvidenceKindProviderRemove, now, work)
	return nil
}

func (e *Executor) PublishMutations(mutations []Mutation, context formula.GenericEvalContext, now int64, work ProviderWork) *model.EngineError {
	for _, mutation := range mutations {
		if mutation.Projected {
			continue
		}
		switch mutation.Kind {
		case "shield_apply":
			instance := e.freshProvider(mutation.DefinitionIndex, mutation.ProviderRef, mutation.SourceKey, mutation.TargetKey, mutation.ExpireAt, now, mutation.Contributions)
			if err := e.mountLive(instance, work); err != nil {
				return err
			}
		case "apply":
			if err := e.ApplyLive(ProviderApplication{Owner: mutation.TargetKey, Source: mutation.SourceKey, Definition: mutation.DefinitionRef, Reference: mutation.ProviderRef, Expiry: mutation.ExpireAt, HasExpiry: mutation.HasExpireAt, Contributions: mutation.Contributions}, now, work); err != nil {
				return err
			}
			if e.compiled.Features.Has(plan.FeatureImmediatePeriodic) {
				work.BindImmediateEffectUse(mutation.TargetKey, mutation.SourceKey, mutation.DefinitionRef, mutation.UseRef)
			}
		case "refresh":
			if err := e.RefreshLive(mutation.TargetKey, mutation.ProviderRef, mutation.ExpireAt, mutation.HasExpireAt, mutation.Contributions, now, work); err != nil {
				return err
			}
		case "expire":
			if mutation.Strict {
				if err := e.RemoveLiveStrict(mutation.TargetKey, mutation.ProviderRef, mutation.DefinitionRef, context, now, work); err != nil {
					return err
				}
				continue
			}
			kind := mutation.EvidenceKind
			if kind == "" {
				kind = model.EvidenceKindProviderRemove
			}
			e.RemoveLive(mutation.TargetKey, mutation.ProviderRef, context, kind, now, work)
		}
	}
	return nil
}

func (e *Executor) SweepLive(now int64, work ProviderWork, expired ExpiredEffects) {
	if e.compiled.Features.Has(plan.FeatureShieldLifecycle) {
		for _, owner := range [2]string{model.SelectorSource, model.SelectorTarget} {
			state, _ := work.ReadEffects(owner)
			SweepLinkedProviders(owner, state.Instances.Providers(), now, expired)
			state, _ = work.ReadEffects(owner)
			SweepLinkedShields(owner, state.Instances.Shields(), now, expired)
		}
		return
	}
	context := work.ProviderRemovalContext(model.SelectorSource, model.SelectorTarget)
	var ownerBuffer [2]string
	owners := work.EffectOwnerOrder(ownerBuffer[:0])
	for _, owner := range owners {
		state, _ := work.ReadEffects(owner)
		sweep := sweepExpiredState(&state.Instances, &state.Bags, now)
		work.PublishEffects(owner, state)
		if !sweep.Changed {
			continue
		}
		for _, reference := range sweep.Refs {
			work.UnmountEffectModifiers(owner, reference)
		}
		work.ResolveRemovedEffects(owner, context)
		for index := 0; index < sweep.Expired.Len(); index++ {
			work.RecordEffect(model.EvidenceKindProviderExpire, sweep.Expired.At(index))
		}
	}
}
