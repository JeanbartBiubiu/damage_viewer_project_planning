// 效果应用、移除、投影与护盾执行的所属状态及同步边界。
package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	"tinygo_engine_v2/internal/runtime/execution/operation"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
	"tinygo_engine_v2/internal/scheduler"
)

type pendingShieldExpire = lifecycle.ShieldExpiry

type lifecycleProjectionReadsAPI interface {
	// ApplicationContext 仅在当前投影阶段借用应用时读值，不执行或提交其他功能。
	ApplicationContext(source, target string) (formula.GenericEvalContext, *model.EngineError)
}

// 使用同布局借用建立固定窄适配，不为每个事件分配转接对象。
type lifecycleProjectionReads Frame

type lifecycleProviderPreparationAPI interface {
	// ProviderContext 准备原效果操作位置的实际双方读值，不执行生命周期规则。
	ProviderContext(ability planbundle.CompiledAbility, source, target string) (formula.GenericEvalContext, *model.EngineError)
	// ImmediatePeriodicApplication 同步交给行动执行核对实际立即周期资格。
	ImmediatePeriodicApplication(operation planbundle.CompiledOperation) *model.EngineError
	// ExpireEventProvider 同步交给命中事实核对真实事件实例并暂存卸载。
	ExpireEventProvider(operation planbundle.CompiledOperation) *model.EngineError
	// PrepareDurationRead 在原静态期限核验后准备动态效果投影。
	PrepareDurationRead() *model.EngineError
	// DurationProviders 借用原投影后的当前拥有者暂存实例。
	DurationProviders(owner string) effectpkg.ProviderList
}

type lifecycleProviderPreparation Frame

type lifecycleLiveEffectsAPI interface {
	// ReadEffects 运输当前真实所属状态头，不创建缺失角色或状态袋。
	ReadEffects(owner string) (lifecycle.LiveEffects, bool)
	// EffectOwnerOrder 在原普通清扫位置取得当前拥有者遍历序，不改变排序政策。
	EffectOwnerOrder(buffer []string) []string
	// PublishEffects 只发布效果字段和已决定的原冷却头，不覆盖角色数值。
	PublishEffects(owner string, effects lifecycle.LiveEffects)
	// ProviderRemovalContext 在原实际位置准备有限双方上下文。
	ProviderRemovalContext(source, target string) formula.GenericEvalContext
	// MountEffectModifiers 运输双方效果状态，执行所属修正挂载。
	MountEffectModifiers(owner string, instance effectpkg.Provider)
	// UnmountEffectModifiers 在原位置卸载实际双方修正。
	UnmountEffectModifiers(owner, reference string)
	// ResolveAppliedEffects 按原应用上下文同步双方数值，保留延后失败。
	ResolveAppliedEffects(owner, source string)
	// ResolveRemovedEffects 按指定原上下文同步数值，不重新准备读值。
	ResolveRemovedEffects(owner string, context formula.GenericEvalContext)
	// RemoveEffectDependents 按原顺序清理行动弹药和监听绑定。
	RemoveEffectDependents(owner, reference string)
	// ScheduleEffectTick 在原新建位置交接真实首周期请求。
	ScheduleEffectTick(instance effectpkg.Provider)
	// RecordEffect 观察已发生实例事实，保留后续失败前缀。
	RecordEffect(kind model.EvidenceKind, instance effectpkg.Provider)
	// BindEffectListeners 沿原位置绑定动态监听。
	BindEffectListeners(instance effectpkg.Provider) *model.EngineError
	// BindImmediateEffectUse 交接普通应用成功后的实际使用绑定。
	BindImmediateEffectUse(owner, source, definition, use string)
	// EnqueueExpiry 运输已决定的期限给唯一队列，沿原延后错误通道返回。
	EnqueueExpiry(at int64, payload effectpkg.ExpiryPayload)
	// CommitEffectExpiry 开立原到期帧，消费预算、借所属暂存并统一提交。
	CommitEffectExpiry(command lifecycle.ExpiryFrame)
	// ExpireProviderCooldown 进入原内部冷却到期阶段。
	ExpireProviderCooldown(payload effectpkg.ExpiryPayload)
	// ExpireTargetTiming 进入原目标计时到期阶段。
	ExpireTargetTiming(payload effectpkg.ExpiryPayload)
	// ExpireTargetState 进入原目标状态到期阶段。
	ExpireTargetState(payload effectpkg.ExpiryPayload)
	// ExpireSourceState 进入原来源状态到期阶段。
	ExpireSourceState(payload effectpkg.ExpiryPayload)
	// SweepEffects 在原无效载荷位置交接完整清扫。
	SweepEffects()
	// RemoveExpiredProvider 按实际来源交接完整实例移除。
	RemoveExpiredProvider(owner, provider, source string)
	// RemoveExpiredShield 按原帧边界交接当前护盾移除。
	RemoveExpiredShield(owner, reference string)
}
type lifecycleLiveEffects Engine

type lifecycleShieldPreparationAPI interface {
	// ShieldDeadline 仅在普通盾原操作时点求值严格期限。
	ShieldDeadline(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) (int64, *model.EngineError)
	// LinkedShieldContext 在原期限求值之后准备实际双方的应用读值。
	LinkedShieldContext(ability planbundle.CompiledAbility, source, target string) (formula.GenericEvalContext, *model.EngineError)
	// LinkedShieldStaging 在前置检查成功后借用原同帧效果暂存。
	LinkedShieldStaging(target string) lifecycle.LinkedShieldStage
}

type lifecycleShieldPreparation Frame

var _ lifecycleProjectionReadsAPI = (*lifecycleProjectionReads)(nil)

var _ lifecycle.ProjectionReads = (*lifecycleProjectionReads)(nil)

var _ lifecycleProviderPreparationAPI = (*lifecycleProviderPreparation)(nil)

var _ lifecycle.ProviderOperationPreparation = (*lifecycleProviderPreparation)(nil)

var _ lifecycle.ProviderDurationPreparation = (*lifecycleProviderPreparation)(nil)

var _ lifecycleLiveEffectsAPI = (*lifecycleLiveEffects)(nil)

var _ lifecycle.ExpiredEffects = (*lifecycleLiveEffects)(nil)

var _ lifecycle.ProviderWork = (*lifecycleLiveEffects)(nil)

var _ lifecycle.ExpiryExecution = (*lifecycleLiveEffects)(nil)

var _ lifecycle.ProjectedEffectPublication = (*lifecycleLiveEffects)(nil)

var _ lifecycleShieldPreparationAPI = (*lifecycleShieldPreparation)(nil)

var _ lifecycle.ShieldPreparation = (*lifecycleShieldPreparation)(nil)

var _ lifecycle.LinkedShieldPreparation = (*lifecycleShieldPreparation)(nil)

func (f *Frame) commitProjectedProviderLifecycles() {
	f.effectProjection.Publish((*lifecycleLiveEffects)(f.run))
}

func (f *Frame) flushDynamicProviders() {
	if f.fatal || f.committed || (!f.run.compiled.HasResourceMax && !f.run.compiled.HasCooldownDuration && !f.run.compiled.HasProviderDurationChange && !f.run.compiled.HasStagedLinkedShield && !f.run.compiled.HasModifierSnapshots) {
		return
	}
	initialRead, entered := f.effectProjection.Begin()
	if !entered {
		return
	}
	defer f.effectProjection.End()
	executor := f.run.lifecycleExecutor()
	changed, err := executor.ProjectDynamic(f.lifecycleProjectionInput(initialRead))
	if err != nil {
		f.fatal, f.fatalErr = true, err
		return
	}
	f.effectProjection.Complete()
	if !changed {
		return
	}
	for _, owner := range [2]string{"source", "target"} {
		staged := f.stageFor(owner)
		f.settleResourceMax(owner, staged.resourceBatchContributors)
		staged.resourceBatchContributors = nil
	}
	if !f.fatal {
		f.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
		if initialRead {
			f.captureEntrySnapshots()
		}
	}
}

func (f *Frame) cooldownDurationFactor(process *actionpkg.ProcessView) (float64, *model.EngineError) {
	if !f.run.compiled.HasCooldownDuration {
		return 1, nil
	}
	f.flushDynamicProviders()
	if f.fatal {
		return 0, f.fatalErr
	}
	executor := f.run.lifecycleExecutor()
	return executor.CooldownDurationFactor(process, f.stageFor(process.Owner()).instances.Providers(), f.run.loop.TimeMs())
}

func (f *Frame) evalShieldDuration(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) (int64, *model.EngineError) {
	wasStrict := f.strictReads
	f.strictReads = true
	context, contextErr := f.evalContext(ability)
	f.strictReads = wasStrict
	if contextErr != nil {
		return 0, contextErr
	}
	executor := f.run.lifecycleExecutor()
	deadline, err := executor.ShieldDuration(op, context, f.run.loop.TimeMs())
	return deadline, f.preserveLifecycleFormulaError(err)
}

func (f *Frame) enqueueCommittedTimedShields() {
	lifecycle.PublishShieldExpiries(f.pendingShieldExpires, (*lifecycleLiveShieldExpiryReads)(f.run), (*lifecycleExpiryRequests)(f.run))
}

func (r *lifecycleProjectionReads) ApplicationContext(source, target string) (formula.GenericEvalContext, *model.EngineError) {
	return (*Frame)(r).evalContextForProviderApply(planbundle.CompiledAbility{}, source, target)
}

func (s *Engine) lifecycleExecutor() lifecycle.Executor {
	if !s.effectIdentities.ProvidersSeeded() {
		s.effectIdentities.SeedProviders()
		for _, owner := range s.combatants {
			for index, instances := 0, owner.instances.Providers(); index < instances.Len(); index++ {
				s.effectIdentities.ReserveProvider(instances.At(index).ProviderRef)
			}
		}
	}
	if !s.effectIdentities.ShieldsSeeded() {
		s.effectIdentities.SeedShields()
		for _, owner := range s.combatants {
			for index, shields := 0, owner.instances.Shields(); index < shields.Len(); index++ {
				s.effectIdentities.ReserveShield(shields.At(index).ShieldRef)
			}
		}
	}
	return lifecycle.New(&s.compiled, &s.formulas, &s.effectIdentities, s.req.SessionID)
}

func (f *Frame) lifecycleProjectionInput(initial bool) lifecycle.ProjectionInput {
	input := lifecycle.ProjectionInput{Now: f.run.loop.TimeMs(), InitialRead: initial,
		State: &f.effectProjection, Reads: (*lifecycleProjectionReads)(f)}
	for index, owner := range [2]string{"source", "target"} {
		staged := f.stageFor(owner)
		input.Owners[index] = lifecycle.OwnerProjection{Key: owner, Instances: &staged.instances,
			Bags: &staged.providerState, Numbers: &staged.numbers, Mutations: staged.providerOps,
			ResourceContributors: &staged.resourceBatchContributors, Dirty: &staged.dirty}
	}
	return input
}

func (f *Frame) preserveLifecycleFormulaError(err *model.EngineError) *model.EngineError {
	if err == nil {
		return nil
	}
	return evaluation.PreserveFormulaIssue(nil, err, f.abilityRef)
}

func (f *Frame) adoptLifecycleBudget(err *model.EngineError) *model.EngineError {
	if err != nil && err.BudgetCause != "" && f.run.budgetCause == "" {
		f.run.budgetCause = err.BudgetCause
	}
	return err
}

func (r *lifecycleProviderPreparation) ProviderContext(ability planbundle.CompiledAbility, source, target string) (formula.GenericEvalContext, *model.EngineError) {
	return (*Frame)(r).evalContextForProviderApply(ability, source, target)
}

func (r *lifecycleProviderPreparation) ImmediatePeriodicApplication(operation planbundle.CompiledOperation) *model.EngineError {
	return (*Frame)(r).validateImmediatePeriodicApplication(operation)
}

func (r *lifecycleProviderPreparation) ExpireEventProvider(operation planbundle.CompiledOperation) *model.EngineError {
	return (*Frame)(r).expireProviderFromEvent(operation)
}

func (r *lifecycleProviderPreparation) PrepareDurationRead() *model.EngineError {
	frame := (*Frame)(r)
	frame.flushDynamicProviders()
	if frame.fatal {
		return frame.fatalErr
	}
	return nil
}

func (r *lifecycleProviderPreparation) DurationProviders(owner string) effectpkg.ProviderList {
	return (*Frame)(r).stageFor(owner).instances.Providers()
}

func (f *Frame) providerPreparationInput(definition, reference, source, target string, ability planbundle.CompiledAbility) lifecycle.ProviderPreparationInput {
	actor, exists := f.run.combatants[target]
	providers := actor.instances.Providers()
	if staged := f.staged.Get(target); staged != nil {
		providers = staged.instances.Providers()
	}
	return lifecycle.ProviderPreparationInput{Definition: definition, Reference: reference, Source: source,
		Target: target, Ability: ability, Providers: providers, TargetExists: exists, Now: f.run.loop.TimeMs()}
}

func (f *Frame) stageProviderOperation(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, target string) *model.EngineError {
	executor := f.run.lifecycleExecutor()
	var mutation lifecycle.Mutation
	var appendMutation bool
	var err *model.EngineError
	if operation.Operation == "expire_provider" && operation.ProviderDefinitionRef != "" {
		mutation, appendMutation, err = executor.PrepareOwnDefinitionExpiry(operation, f.providerOwnerKey(), f.sourceKey,
			f.ownerProviderRef, target, f.run.loop.TimeMs(), (*lifecycleProviderPreparation)(f))
	} else {
		mutation, appendMutation, err = executor.StageProviderOperation(lifecycle.ProviderOperationInput{
			Operation: operation, Preparation: f.providerPreparationInput("", "", f.sourceKey, target, ability),
			UseRef: f.skillActionUseRef(),
		}, (*lifecycleProviderPreparation)(f))
	}
	if err != nil || !appendMutation {
		return f.preserveLifecycleFormulaError(err)
	}
	staged := f.stageFor(target)
	staged.providerOps = append(staged.providerOps, mutation)
	staged.dirty = true
	f.effectProjection.MarkDirty()
	return nil
}

func (r *lifecycleLiveEffects) RemoveExpiredProvider(owner, provider, source string) {
	s := (*Engine)(r)
	s.removeProviderInstance(owner, provider, s.evalContextForCombatants(source, owner), model.EvidenceKindProviderExpire)
}

func (r *lifecycleLiveEffects) RemoveExpiredShield(owner, reference string) {
	(*Engine)(r).removeShieldInstance(owner, reference, model.EvidenceKindProviderExpire)
}

func (r *lifecycleShieldPreparation) ShieldDeadline(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) (int64, *model.EngineError) {
	return (*Frame)(r).evalShieldDuration(op, ability)
}

func (r *lifecycleShieldPreparation) LinkedShieldContext(ability planbundle.CompiledAbility, source, target string) (formula.GenericEvalContext, *model.EngineError) {
	return (*Frame)(r).evalContextForProviderApply(ability, source, target)
}

func (r *lifecycleShieldPreparation) LinkedShieldStaging(target string) lifecycle.LinkedShieldStage {
	staged := (*Frame)(r).stageFor(target)
	return lifecycle.LinkedShieldStage{Instances: &staged.instances, Mutations: staged.providerOps}
}

func sameHealthMaximum(a, b float64) bool { return lifecycle.SameHealthMaximum(a, b) }

func (s *Engine) permanentHealthAnchor(owner string) (float64, *model.EngineError) {
	executor := s.lifecycleExecutor()
	return executor.PermanentHealthAnchor(owner, s.combatants[owner].attributesView())
}

func (s *Engine) initPermanentResourceMax() *model.EngineError {
	if len(s.compiled.PermanentResourceMax) == 0 {
		return nil
	}
	executor := s.lifecycleExecutor()
	if err := executor.ValidatePermanentResourceFresh(s.loop.StartMs(), s.req.InitialSnapshot); err != nil {
		return err
	}
	if err := s.validateInitialSelection(false); err != nil {
		return err
	}
	var owners [2]lifecycle.InitialResourceOwner
	for i, key := range [2]string{"source", "target"} {
		owner := s.combatants[key]
		owners[i] = lifecycle.InitialResourceOwner{Owner: key, Attributes: owner.attributesView(), Providers: owner.instances.Providers()}
	}
	prepared, err := executor.PreparePermanentResourceMax(s.req.InitialSnapshot, owners, s.loop.TimeMs())
	if err != nil {
		return err
	}
	for _, item := range prepared {
		owner := s.combatants[item.Owner]
		installed := executor.InstallPermanentResourceMax(item, &owner.instances, &owner.numbers, s.detailedOutput())
		s.combatants[item.Owner] = owner
		if item.Total != item.Anchor || len(installed.Contributors) != 0 || installed.HasContribution {
			s.recordEvidenceLazy("resource_max_initialized", func() model.EvidenceItem {
				return model.EvidenceItem{TimeMs: 0, Kind: "resource_max_initialized", Ref: item.Owner,
					Data: map[string]interface{}{"resourceKey": "hp", "owner": item.Owner, "target": item.Owner, "anchorMax": item.Anchor,
						"permanentIncrease": item.Total - item.Anchor, "max": item.Total, "current": installed.Current, "contributions": installed.Contributors}}
			})
		}
	}
	return nil
}

func hasPermanentHealthOwner(plans []planbundle.CompiledPermanentResourceMax, owner string) bool {
	return lifecycle.HasPermanentHealthOwner(plans, owner)
}

func (f *Frame) skipInstalledPermanentResourceMax(op planbundle.CompiledOperation) *model.EngineError {
	executor := f.run.lifecycleExecutor()
	return executor.PermanentOperationConsumed(op, f.ownerCombatantKey, f.ownerProviderRef, f.run.effectInitialization.Active(), f.run.loop.TimeMs())
}

func (s *Engine) findProviderDefinitionIndex(key string) (uint16, bool) {
	executor := s.lifecycleExecutor()
	return executor.FindDefinition(key)
}

func (s *Engine) enqueueExpireCleanup(atMs int64, payload effectpkg.ExpiryPayload) {
	idx := s.effectTimers.RegisterExpiry(payload)
	ev := scheduler.GenericEvent{
		TimeMs:           atMs,
		Category:         scheduler.GenericCategoryExpireCleanup,
		Kind:             scheduler.GenericEventExpireCleanup,
		DriverEntryIndex: idx,
	}
	if payload.BeforeCombat {
		ev.Category = scheduler.GenericCategoryStateCooldownExpiry
	}
	if payload.ProviderRef != "" {
		ev.ProviderInstanceRef = scheduler.ProviderInstanceRef{
			CombatantKey: payload.CombatantKey,
			ProviderRef:  payload.ProviderRef,
		}
	}
	s.pushCombatEvent(ev)
}

func (s *Engine) applyProviderInstance(targetKey, sourceKey, definitionRef string, expireAt int64, hasExpireAt bool, contributions effectpkg.ContributionView) *model.EngineError {
	return s.applyProviderInstanceWithRef(targetKey, sourceKey, definitionRef, "", expireAt, hasExpireAt, contributions)
}

func (s *Engine) applyProviderInstanceWithRef(target, source, definition, assigned string, expiry int64, hasExpiry bool, contributions effectpkg.ContributionView) *model.EngineError {
	executor := s.lifecycleExecutor()
	return executor.ApplyLive(lifecycle.ProviderApplication{Owner: target, Source: source, Definition: definition, Reference: assigned, Expiry: expiry, HasExpiry: hasExpiry, Contributions: contributions}, s.loop.TimeMs(), (*lifecycleLiveEffects)(s))
}

func (s *Engine) refreshProviderInstance(target, reference string, expiry int64, hasExpiry bool, contributions effectpkg.ContributionView) *model.EngineError {
	executor := s.lifecycleExecutor()
	return executor.RefreshLive(target, reference, expiry, hasExpiry, contributions, s.loop.TimeMs(), (*lifecycleLiveEffects)(s))
}

func (s *Engine) reResolveAfterProviderChange(targetKey, sourceKey string) {
	evalCtx := s.evalContextForCombatants(sourceKey, targetKey)
	if sourceKey == "" {
		evalCtx = s.evalContextForCombatants(model.SelectorSource, model.SelectorTarget)
	}
	operation.ResolveRelatedLiveAttributes(s.attributeRules(), &s.evaluation, targetKey, opponentCombatantKey(targetKey), evalCtx, (*numericLiveAttributes)(s))
}

func (s *Engine) expireProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext) {
	s.removeProviderInstance(targetKey, providerRef, evalCtx, model.EvidenceKindProviderRemove)
}

func (s *Engine) removeProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext, kind model.EvidenceKind) {
	executor := s.lifecycleExecutor()
	executor.RemoveLive(targetKey, providerRef, evalCtx, kind, s.loop.TimeMs(), (*lifecycleLiveEffects)(s))
}

func (s *Engine) handleExpireCleanup(event scheduler.GenericEvent) {
	if event.DriverEntryIndex < 0 || event.DriverEntryIndex >= s.effectTimers.ExpiryCount() {
		s.sweepExpiredInstances()
		return
	}
	executor := s.lifecycleExecutor()
	executor.HandleExpiry(s.effectTimers.ExpiryAt(event.DriverEntryIndex), s.loop.TimeMs(), s.automatedRun(), (*lifecycleLiveEffects)(s), (*lifecycleLiveEffects)(s))
}

func (s *Engine) sweepExpiredInstances() {
	executor := s.lifecycleExecutor()
	executor.SweepLive(s.loop.TimeMs(), (*lifecycleLiveEffects)(s), (*lifecycleLiveEffects)(s))
}

func (s *Engine) removeExpiredShieldInstance(owner, reference string) {
	executor := s.lifecycleExecutor()
	executor.RemoveExpiredShield(owner, reference, s.loop.TimeMs(), (*lifecycleLiveEffects)(s), (*lifecycleLiveEffects)(s))
}

func (s *Engine) seedExpireCleanups() {
	for _, key := range [2]string{model.SelectorSource, model.SelectorTarget} {
		owner, exists := s.combatants[key]
		if !exists {
			continue
		}
		lifecycle.SeedEffectExpiries(key, owner.instances, &owner.providerState, s.loop.TimeMs(), (*lifecycleExpiryRequests)(s))
	}
	s.seedInternalCooldownExpiries()
}

func (s *Engine) enqueueProviderTickAt(atMs int64, combatantKey, providerRef string, intervalMs, expireAt, activatedAt int64) {
	if intervalMs <= 0 {
		return
	}
	if atMs > s.loop.StartMs()+s.loop.DurationMs() {
		return
	}
	if s.actions.BasicAttack() == nil && expireAt > 0 && atMs > expireAt {
		return
	}
	s.pushCombatEvent(scheduler.GenericEvent{
		TimeMs:                    atMs,
		Category:                  scheduler.GenericCategoryProviderTick,
		Kind:                      scheduler.GenericEventProviderTick,
		ProviderTickActivatedAtMs: activatedAt,
		ProviderInstanceRef: scheduler.ProviderInstanceRef{
			CombatantKey: combatantKey,
			ProviderRef:  providerRef,
		},
	})
	_ = intervalMs
}

func (s *Engine) evalContextForCombatants(sourceKey, targetKey string) formula.GenericEvalContext {
	ctx := formula.GenericEvalContext{}
	if c, ok := s.combatants[sourceKey]; ok {
		ctx.SourceAttrs = c.attributesView()
		ctx.SourceResources = c.resourceView()
	}
	if c, ok := s.combatants[targetKey]; ok {
		ctx.TargetAttrs = c.attributesView()
		ctx.TargetResources = c.resourceView()
	}
	return ctx
}

// providerFormulaContextFromBag builds the H2a provider overlay. Attrs/resources/ability/event
// are intentionally left unset so ResolveAttributesWithProviderContext keeps them from base.
func providerFormulaContextFromBag(bag effectpkg.BagView, activeTargetKey string) pipeline.ProviderFormulaContext {
	if !bag.Present() {
		return pipeline.ProviderFormulaContext{HasProviderContext: true}
	}
	ctx := pipeline.ProviderFormulaContext{HasProviderContext: true, ProviderState: bag.State(), ProviderStateDefaults: bag.DefaultsForFormula()}
	if activeTargetKey != "" && bag.TargetKey() == activeTargetKey {
		ctx.ProviderTargetState = bag.TargetStateForFormula()
	}
	return ctx
}

// providerTargetActiveKey chooses which combatant key gates provider_target formula visibility.
// Same-combatant / empty-owner mounts keep cast-target semantics; a modifier hosted on another
// combatant always reads the owner bag against that mount host (stable across unrelated casts).
func providerTargetActiveKey(hostCombatantKey, ownerCombatantKey, castTargetKey string) string {
	if ownerCombatantKey != "" && ownerCombatantKey != hostCombatantKey {
		return hostCombatantKey
	}
	return castTargetKey
}

func (s *Engine) resolveProviderStateFieldDefs(combatantKey, providerRef string, providers effectpkg.ProviderList) *effectpkg.FieldMetadata {
	if s == nil || providerRef == "" {
		return nil
	}
	index := compiledStateDefinitionIndex(s.compiled, combatantKey, providerRef, providers)
	if index < 0 {
		return nil
	}
	return s.providerDefinitionFields.Lookup(index, s.compiled.Providers)
}

func compiledStateFieldsForProvider(
	compiled planbundle.CompiledSession,
	combatantKey, providerRef string,
	providers effectpkg.ProviderList,
) *effectpkg.FieldMetadata {
	index := compiledStateDefinitionIndex(compiled, combatantKey, providerRef, providers)
	if index < 0 {
		return nil
	}
	return effectpkg.CompileFields(compiled.Providers[index].StateFields)
}

func compiledStateDefinitionIndex(compiled planbundle.CompiledSession, owner, reference string, instances effectpkg.ProviderList) int {
	return lifecycle.StateDefinitionIndex(compiled, owner, reference, instances)
}

func (s *Engine) readLiveProviderFormulaContext(combatantKey, castTargetKey, ownerCombatantKey, providerRef string) pipeline.ProviderFormulaContext {
	bagOwnerKey := ownerCombatantKey
	if bagOwnerKey == "" {
		bagOwnerKey = combatantKey
	}
	c, ok := s.combatants[bagOwnerKey]
	if !ok {
		return providerFormulaContextFromBag(effectpkg.BagView{}, providerTargetActiveKey(combatantKey, ownerCombatantKey, castTargetKey))
	}
	activeTarget := providerTargetActiveKey(combatantKey, ownerCombatantKey, castTargetKey)
	bag := c.providerState.PrepareRead(providerRef, false,
		s.resolveProviderStateFieldDefs(bagOwnerKey, providerRef, c.instances.Providers()), s.loop.TimeMs(), effectpkg.ReadOptions{ExpireTarget: true, Defaults: true, TargetView: activeTarget != "", TargetKey: activeTarget, Cooldowns: c.cooldowns.View(), OwnerKey: bagOwnerKey})
	if !bag.Present() {
		ctx := providerFormulaContextFromBag(effectpkg.BagView{}, activeTarget)
		if s.compiled.HasProviderElapsedReads || s.compiled.HasFiniteModifierExpiry {
			ctx = withProviderElapsed(ctx, c.instances.Providers(), providerRef, s.loop.TimeMs(), s.compiled.Providers)
		}
		return ctx
	}
	s.combatants[bagOwnerKey] = c
	ctx := providerFormulaContextFromBag(bag, activeTarget)
	if s.compiled.HasProviderElapsedReads || s.compiled.HasFiniteModifierExpiry {
		ctx = withProviderElapsed(ctx, c.instances.Providers(), providerRef, s.loop.TimeMs(), s.compiled.Providers)
	}
	return ctx
}

func (s *Engine) resolveAttributesFor(combatantKey string, attrs attribute.Table, evalCtx formula.GenericEvalContext, activeTargetKey string) attribute.Table {
	return operation.ResolveLiveAttributes(s.attributeRules(), &s.evaluation, combatantKey, attrs, evalCtx, activeTargetKey, (*numericLiveAttributes)(s))
}

// refreshProviderAwareAttributes lazy-expires provider timed state and re-resolves attributes
// so the next run event reflects recovered resolved values without a state write.
func (s *Engine) refreshProviderAwareAttributes(sourceKey, targetKey string) {
	if s.compiled.HasResourceMax {
		s.settleLiveResourceExpiry()
	}
	evalCtx := s.evalContextForCombatants(sourceKey, targetKey)
	for key, c := range s.combatants {
		resolved := s.resolveAttributesFor(key, c.attributesView(), evalCtx, targetKey)
		c = s.combatants[key]

		c.setAttributes(resolved)
		s.combatants[key] = c
	}
}

// remountAllProviderModifiers clears then remounts every provider modifier onto the correct
// combatant resolver (including opponent.attr.* cross-combatant mounts).
func remountAllProviderModifiers(combatants map[string]combatantRuntime, compiled planbundle.CompiledSession) {
	for key, c := range combatants {
		c.instances.SetAttributes(effectpkg.AttributeResolver{})
		c.instances.SetDamage(effectpkg.DamageResolver{})
		combatants[key] = c
	}
	for ownerKey, c := range combatants {
		for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			inst := instanceValues.At(instanceIndex)
			mountProviderModifiersAcross(combatants, ownerKey, inst, compiled)
		}
	}
}

func (f *Frame) applyProviderEnsureRemaining(operation planbundle.CompiledOperation) *model.EngineError {
	executor := f.run.lifecycleExecutor()
	owner := f.providerOwnerKey()
	mutation, changed, err := executor.PrepareDurationChange(operation, owner, f.sourceKey, f.ownerProviderRef, f.run.loop.TimeMs(), (*lifecycleProviderPreparation)(f))
	if err != nil || !changed {
		return err
	}
	staged := f.stageFor(owner)
	staged.providerOps = append(staged.providerOps, mutation)
	staged.dirty = true
	f.effectProjection.MarkDirty()
	return nil
}

func (s *Engine) initResourceMaxState() *model.EngineError {
	if !s.report.InitResourceRecords(s.req.RecordBudget, s.compiled.HasResourceMax) {
		return s.processErr("recordBudget.maxResourceChangeRecords", "resource change record budget must be in [0,10000]", "")
	}
	if !s.compiled.HasResourceMax {
		return nil
	}
	for _, key := range []string{"source", "target"} {
		c := s.combatants[key]
		executor := s.lifecycleExecutor()
		anchor, err := executor.InitialResourceMaximum(key, c.attributesView(), c.instances.Providers())
		if err != nil {
			return err
		}
		c.setHPMaxAnchor(anchor)
		s.combatants[key] = c
	}
	return s.initPermanentResourceMax()
}

func (s *Engine) reserveHealthOrder() uint64 { s.nextHealthOrder++; return s.nextHealthOrder }

func (f *Frame) settleResourceMax(owner string, contributors []model.ResourceChangeContributor) {
	if !f.run.compiled.HasResourceMax {
		return
	}
	sc := f.stageFor(owner)
	executor := f.run.lifecycleExecutor()
	projection := executor.ProjectResourceMaximum(sc.instances, f.run.combatants[owner].hpMaxAnchorValue(), contributors, f.run.loop.TimeMs())
	row, changed, err := f.run.operations.ResourceMaximum(f.operationInput(), (*operationReads)(f), owner, projection.Maximum, projection.Contributions, projection.Records, f.run.actions.Dead(owner))
	if err != nil {
		f.fatal = true
		f.fatalErr = err
		return
	}
	if changed {
		row.HealthOrder = f.run.reserveHealthOrder()
		f.numeric.AddResourceChange(row)
	}
}

func (f *Frame) resourceContributor(item effectpkg.ResourceContribution, reason string) model.ResourceChangeContributor {
	executor := f.run.lifecycleExecutor()
	return executor.ResourceContributor(item, reason)
}

func (s *Engine) commitResourceChange(row model.ResourceChangeRecord) {
	s.report.RecordResourceChange(row, s.detailedOutput())
}

func (s *Engine) resourceSummaryOutput() *model.ResourceChangeSummary {
	if !s.compiled.HasResourceMax {
		return nil
	}
	return s.report.ResourceSummary(s.combatants["source"].attributesView().At("hp").Max, s.combatants["target"].attributesView().At("hp").Max)
}

func (s *Engine) settleLiveResourceExpiry() {
	if !s.compiled.HasResourceMax || s.processFailure != nil || s.budgetCause != "" {
		return
	}
	needed := false
	for _, owner := range s.combatants {
		if lifecycle.ResourceExpiryNeeded(owner.instances, s.loop.TimeMs()) {
			needed = true
			break
		}
	}
	if !needed {
		return
	}
	var frame Frame
	s.initExecutionFrame(&frame, "source", "target", "resource_expiry_read")
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}

func (f *Frame) linkedShieldPresent(index uint16) (float64, error) {
	executor := f.run.lifecycleExecutor()
	owner := f.providerOwnerKey()
	staged := f.stageFor(owner)
	return executor.LinkedShieldPresent(index, f.ownerProviderRef, owner, staged.instances.Providers(), staged.instances.Shields(), staged.providerOps, f.run.loop.TimeMs())
}

func (f *Frame) stageLifecycleShield(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, target string, amount float64) *model.EngineError {
	executor := f.run.lifecycleExecutor()
	projected, err := executor.ExecuteLinkedShield(op, ability, f.sourceKey, target, amount, f.run.loop.TimeMs(), (*lifecycleShieldPreparation)(f))
	if err != nil {
		return f.preserveLifecycleFormulaError(err)
	}
	staged := f.stageFor(target)
	previousCount := len(staged.providerOps)
	staged.providerOps, staged.dirty = projected.Mutations, true
	if projected.Changed || len(projected.Mutations) != previousCount {
		f.effectProjection.MarkDirty()
	}
	if projected.Expiry.ExpireAt > 0 {
		f.pendingShieldExpires = append(f.pendingShieldExpires, projected.Expiry)
	}
	return nil
}

func (f *Frame) stageShieldProviderRemoval(sc *stagedCombatant, owner, ref string) {
	var changed bool
	sc.providerOps, changed = lifecycle.StageShieldRemoval(sc.providerOps, owner, ref)
	if changed {
		f.effectProjection.MarkDirty()
	}
}

func (f *Frame) settleDepletedShieldAttributes() *model.EngineError {
	if !f.run.compiled.HasStagedLinkedShield {
		return nil
	}
	f.prepareShieldLifecycleRemovals()
	f.flushDynamicProviders()
	return f.fatalErr
}

func (f *Frame) prepareShieldLifecycleRemovals() {
	f.staged.Range(func(owner string, staged *stagedCombatant) {
		var changed bool
		staged.providerOps, changed = lifecycle.PrepareShieldRemovals(owner, &staged.instances,
			f.run.combatants[owner].instances.Shields(), staged.providerOps, f.run.loop.TimeMs())
		if changed {
			f.effectProjection.MarkDirty()
		}
	})
}

func (s *Engine) removeShieldInstance(owner, reference string, kind model.EvidenceKind) {
	executor := s.lifecycleExecutor()
	executor.RemoveLiveShield(owner, reference, kind, s.loop.TimeMs(), (*lifecycleLiveEffects)(s), (*lifecycleLiveEffects)(s))
}

func validateShieldLifecycleSnapshot(snapshot model.Snapshot, compiled planbundle.CompiledSession, sessionID string) *model.EngineError {
	return lifecycle.ValidateShieldSnapshot(snapshot, compiled, sessionID)
}

func (f *Frame) evalContextForProviderApply(ability planbundle.CompiledAbility, sourceKey, targetKey string) (formula.GenericEvalContext, *model.EngineError) {
	ctx, err := f.evalContext(ability)
	if err != nil {
		return formula.GenericEvalContext{}, err
	}
	if sourceKey != "" && sourceKey != f.sourceKey {
		sc := f.stageFor(sourceKey)
		ctx.SourceAttrs = sc.attributesView()
		ctx.SourceResources = sc.resourceView()
	}
	if targetKey != "" && targetKey != f.targetKey {
		sc := f.stageFor(targetKey)
		ctx.TargetAttrs = sc.attributesView()
		ctx.TargetResources = sc.resourceView()
	}
	return ctx, nil
}

func (s *Engine) recordProviderLifecycleEvidence(kind model.EvidenceKind, inst effectpkg.Provider) {
	source := inst.Source
	if source == "" {
		source = inst.Owner
	}
	s.recordEvidenceLazy(kind, func() model.EvidenceItem {
		contributions := make([]map[string]interface{}, 0, inst.StatusContributions.Len())
		for index := 0; index < inst.StatusContributions.Len(); index++ {
			item := inst.StatusContributions.At(index)
			contributions = append(contributions, reportpkg.StatusContributionData(item.ResultRef, item.StatusKey, item.StatusKind, item.Strength))
		}
		return model.EvidenceItem{
			TimeMs: s.loop.TimeMs(),
			Kind:   kind,
			Ref:    inst.ProviderRef,
			Path:   "providers[" + inst.ProviderRef + "]",
			Data: map[string]interface{}{
				"providerRef":         inst.ProviderRef,
				"definitionRef":       inst.DefinitionRef,
				"source":              source,
				"owner":               inst.Owner,
				"expireAt":            inst.ExpireAt,
				"statusContributions": contributions,
			},
		}
	})
}

func (r *lifecycleLiveEffects) ReadEffects(owner string) (lifecycle.LiveEffects, bool) {
	actor, exists := (*Engine)(r).combatants[owner]
	return lifecycle.LiveEffects{Instances: actor.instances, Bags: actor.providerState, Cooldowns: actor.cooldowns}, exists
}

func (r *lifecycleLiveEffects) EffectOwnerOrder(buffer []string) []string {
	for owner := range (*Engine)(r).combatants {
		buffer = append(buffer, owner)
	}
	return buffer
}

func (r *lifecycleLiveEffects) PublishEffects(owner string, effects lifecycle.LiveEffects) {
	s := (*Engine)(r)
	actor := s.combatants[owner]
	actor.instances, actor.providerState, actor.cooldowns = effects.Instances, effects.Bags, effects.Cooldowns
	s.combatants[owner] = actor
}

func (r *lifecycleLiveEffects) ProviderRemovalContext(source, target string) formula.GenericEvalContext {
	return (*Engine)(r).evalContextForCombatants(source, target)
}

func (r *lifecycleLiveEffects) MountEffectModifiers(owner string, instance effectpkg.Provider) {
	s := (*Engine)(r)
	mountProviderModifiersAcross(s.combatants, owner, instance, s.compiled)
}

func (r *lifecycleLiveEffects) UnmountEffectModifiers(owner, reference string) {
	unmountProviderModifiersAcross((*Engine)(r).combatants, owner, reference)
}

func (r *lifecycleLiveEffects) ResolveAppliedEffects(owner, source string) {
	(*Engine)(r).reResolveAfterProviderChange(owner, source)
}

func (r *lifecycleLiveEffects) ResolveRemovedEffects(owner string, context formula.GenericEvalContext) {
	s := (*Engine)(r)
	operation.ResolveRelatedLiveAttributes(s.attributeRules(), &s.evaluation, owner, opponentCombatantKey(owner), context, (*numericLiveAttributes)(s))
}

func (r *lifecycleLiveEffects) RemoveEffectDependents(owner, reference string) {
	s := (*Engine)(r)
	s.actions.RemoveAmmoProvider(owner, reference)
	s.unbindProviderInstanceListeners(owner, reference)
}

func (r *lifecycleLiveEffects) ScheduleEffectTick(instance effectpkg.Provider) {
	(*Engine)(r).scheduleInitialProviderTick(instance.Owner, instance.ProviderRef, instance.DefinitionIndex, instance.ExpireAt, instance.Source)
}

func (r *lifecycleLiveEffects) RecordEffect(kind model.EvidenceKind, instance effectpkg.Provider) {
	(*Engine)(r).recordProviderLifecycleEvidence(kind, instance)
}

func (r *lifecycleLiveEffects) BindEffectListeners(instance effectpkg.Provider) *model.EngineError {
	return (*Engine)(r).bindProviderInstanceListeners(instance)
}

func (r *lifecycleLiveEffects) BindImmediateEffectUse(owner, source, definition, use string) {
	(*Engine)(r).bindImmediatePeriodicUse(owner, source, definition, use)
}

func (r *lifecycleLiveEffects) EnqueueExpiry(at int64, payload effectpkg.ExpiryPayload) {
	(*Engine)(r).enqueueExpireCleanup(at, payload)
}

func (r *lifecycleLiveEffects) CommitEffectExpiry(command lifecycle.ExpiryFrame) {
	s := (*Engine)(r)
	var frame Frame
	s.initExecutionFrame(&frame, command.Source, command.Target, command.AbilityRef)
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	staged := frame.stageFor(command.Owner)
	executor := s.lifecycleExecutor()
	staged.providerOps = executor.StageExpiryFrame(command, staged.providerOps, &frame.effectProjection, &staged.dirty)
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}

func (r *lifecycleLiveEffects) ExpireProviderCooldown(payload effectpkg.ExpiryPayload) {
	(*Engine)(r).applyInternalCooldownExpiry(payload)
}

func (r *lifecycleLiveEffects) ExpireTargetTiming(payload effectpkg.ExpiryPayload) {
	(*Engine)(r).applyTargetTimingExpiry(payload)
}

func (r *lifecycleLiveEffects) ExpireTargetState(payload effectpkg.ExpiryPayload) {
	(*Engine)(r).applyProviderTargetStateExpiry(payload)
}

func (r *lifecycleLiveEffects) ExpireSourceState(payload effectpkg.ExpiryPayload) {
	(*Engine)(r).applyProviderSourceStateExpiry(payload)
}

func (r *lifecycleLiveEffects) SweepEffects() { (*Engine)(r).sweepExpiredInstances() }
