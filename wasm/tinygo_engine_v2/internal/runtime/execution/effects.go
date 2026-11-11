// 效果应用、移除、投影与护盾执行的所属状态及同步边界。
package execution

import (
	"fmt"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
	"tinygo_engine_v2/internal/scheduler"
)

type projectedProviderLifecycle = lifecycle.ProjectedChange

type pendingShieldExpire struct {
	combatantKey string
	shieldRef    string
	expireAt     int64
}

type lifecycleProjectionReadsAPI interface {
	// ApplicationContext 仅在当前投影阶段借用应用时读值，不执行或提交其他功能。
	ApplicationContext(source, target string) formula.GenericEvalContext
}

// 使用同布局借用建立固定窄适配，不为每个事件分配转接对象。
type lifecycleProjectionReads Frame

type lifecycleProviderPreparationAPI interface {
	// ProviderContext 准备原效果操作位置的实际双方读值，不执行生命周期规则。
	ProviderContext(ability planbundle.CompiledAbility, source, target string) formula.GenericEvalContext
	// ImmediatePeriodicApplication 同步交给行动执行核对实际立即周期资格。
	ImmediatePeriodicApplication(operation planbundle.CompiledOperation) *model.EngineError
	// ExpireEventProvider 同步交给命中事实核对真实事件实例并暂存卸载。
	ExpireEventProvider(operation planbundle.CompiledOperation) *model.EngineError
}

type lifecycleProviderPreparation Frame

type lifecycleExpiredEffectsAPI interface {
	// RemoveExpiredProvider 按实际来源组合原实例卸载、跨行动监听清理和属性同步。
	RemoveExpiredProvider(owner, provider, source string)
	// RemoveExpiredShield 按原帧边界清理当前实际护盾和关联效果。
	RemoveExpiredShield(owner, reference string)
}

type lifecycleExpiredEffects Engine

type lifecycleShieldPreparationAPI interface {
	// ShieldDeadline 仅在普通盾原操作时点求值严格期限。
	ShieldDeadline(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) (int64, *model.EngineError)
}

type lifecycleShieldPreparation Frame

var _ lifecycleProjectionReadsAPI = (*lifecycleProjectionReads)(nil)

var _ lifecycle.ProjectionReads = (*lifecycleProjectionReads)(nil)

var _ lifecycleProviderPreparationAPI = (*lifecycleProviderPreparation)(nil)

var _ lifecycle.ProviderOperationPreparation = (*lifecycleProviderPreparation)(nil)

var _ lifecycleExpiredEffectsAPI = (*lifecycleExpiredEffects)(nil)

var _ lifecycle.ExpiredEffects = (*lifecycleExpiredEffects)(nil)

var _ lifecycleShieldPreparationAPI = (*lifecycleShieldPreparation)(nil)

var _ lifecycle.ShieldPreparation = (*lifecycleShieldPreparation)(nil)

func (f *Frame) commitProjectedProviderLifecycles() {
	for index := 0; index < f.effectProjection.ChangeCount(); index++ {
		change := f.effectProjection.ChangeAt(index)
		inst := change.Instance
		if change.EnqueueExpiry && inst.ExpireAt > 0 {
			f.run.enqueueExpireCleanup(inst.ExpireAt, effectpkg.ExpiryPayload{CombatantKey: inst.Owner, ProviderRef: inst.ProviderRef, Kind: "provider"})
		}
		f.run.recordProviderLifecycleEvidence(change.Kind, inst)
	}
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

func (f *Frame) stageLifecycleCostCooldown(ability planbundle.CompiledAbility, sourceKey string) *model.EngineError {
	if ability.Cost != nil && ability.Cost.HasAmount {
		amount, err := f.evalAmount(ability.Cost.AmountProgram, ability)
		if err != nil {
			return err
		}
		if err := f.applyResourceChange(sourceKey, ability.Cost.ResourceKey, -amount, ability); err != nil {
			return err
		}
	}
	if ability.Cooldown != nil && ability.Cooldown.HasDuration {
		duration, err := f.evalAmount(ability.Cooldown.DurationProgram, ability)
		if err != nil {
			return err
		}
		readyAt := f.run.loop.TimeMs() + int64(duration)
		return f.applyCooldownChange(sourceKey, f.abilityRef, readyAt)
	}
	return nil
}

func (f *Frame) evalShieldDuration(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) (int64, *model.EngineError) {
	wasStrict := f.strictReads
	f.strictReads = true
	context := f.evalContext(ability)
	f.strictReads = wasStrict
	executor := f.run.lifecycleExecutor()
	deadline, err := executor.ShieldDuration(op, context, f.run.loop.TimeMs())
	return deadline, f.preserveLifecycleFormulaError(err)
}

func (f *Frame) enqueueCommittedTimedShields() {
	for _, pending := range f.pendingShieldExpires {
		if pending.expireAt <= 0 || pending.shieldRef == "" {
			continue
		}
		c, ok := f.run.combatants[pending.combatantKey]
		if !ok {
			continue
		}
		for instanceIndex, instanceValues := 0, c.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			sh := instanceValues.At(instanceIndex)
			if sh.ShieldRef != pending.shieldRef {
				continue
			}
			if sh.ExpireAt > 0 {
				f.run.enqueueExpireCleanup(pending.expireAt, effectpkg.ExpiryPayload{
					CombatantKey: pending.combatantKey,
					ShieldRef:    pending.shieldRef,
					Kind:         "shield",
				})
			}
			break
		}
	}
}

func (r *lifecycleProjectionReads) ApplicationContext(source, target string) formula.GenericEvalContext {
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

func (r *lifecycleProviderPreparation) ProviderContext(ability planbundle.CompiledAbility, source, target string) formula.GenericEvalContext {
	return (*Frame)(r).evalContextForProviderApply(ability, source, target)
}

func (r *lifecycleProviderPreparation) ImmediatePeriodicApplication(operation planbundle.CompiledOperation) *model.EngineError {
	return (*Frame)(r).validateImmediatePeriodicApplication(operation)
}

func (r *lifecycleProviderPreparation) ExpireEventProvider(operation planbundle.CompiledOperation) *model.EngineError {
	return (*Frame)(r).expireProviderFromEvent(operation)
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
	mutation, appendMutation, err := executor.StageProviderOperation(lifecycle.ProviderOperationInput{
		Operation: operation, Preparation: f.providerPreparationInput("", "", f.sourceKey, target, ability),
		UseRef: f.skillActionUseRef(),
	}, (*lifecycleProviderPreparation)(f))
	if err != nil || !appendMutation {
		return f.preserveLifecycleFormulaError(err)
	}
	staged := f.stageFor(target)
	staged.providerOps = append(staged.providerOps, mutation)
	staged.dirty = true
	f.effectProjection.MarkDirty()
	return nil
}

func (r *lifecycleExpiredEffects) RemoveExpiredProvider(owner, provider, source string) {
	s := (*Engine)(r)
	s.removeProviderInstance(owner, provider, s.evalContextForCombatants(source, owner), model.EvidenceKindProviderExpire)
}

func (r *lifecycleExpiredEffects) RemoveExpiredShield(owner, reference string) {
	(*Engine)(r).removeShieldInstance(owner, reference, model.EvidenceKindProviderExpire)
}

func (r *lifecycleShieldPreparation) ShieldDeadline(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) (int64, *model.EngineError) {
	return (*Frame)(r).evalShieldDuration(op, ability)
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

func (s *Engine) nextProviderRef(definitionRef string) string {
	if !s.effectIdentities.ProvidersSeeded() {
		s.effectIdentities.SeedProviders()
		for _, c := range s.combatants {
			for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
				inst := instanceValues.At(instanceIndex)
				s.effectIdentities.ReserveProvider(inst.ProviderRef)
			}
		}
	}
	return s.effectIdentities.NextProvider(definitionRef)
}

func (s *Engine) nextShieldRef(definitionRef string) string {
	s.reserveShieldRef("")
	return s.effectIdentities.NextShield(definitionRef)
}

func (s *Engine) reserveShieldRef(ref string) {
	if !s.effectIdentities.ShieldsSeeded() {
		s.effectIdentities.SeedShields()
		for _, c := range s.combatants {
			for instanceIndex, instanceValues := 0, c.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
				sh := instanceValues.At(instanceIndex)
				if sh.ShieldRef != "" {
					s.effectIdentities.ReserveShield(sh.ShieldRef)
				}
			}
		}
	}
	if ref != "" {
		s.effectIdentities.ReserveShield(ref)
	}
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
	decision, err := executor.DecideApplication(definition, source, target, s.combatants[target].instances.Providers(), s.loop.TimeMs())
	if err != nil {
		return err
	}
	if decision.ExpiredRef != "" {
		s.removeProviderInstance(target, decision.ExpiredRef, s.evalContextForCombatants(source, target), model.EvidenceKindProviderExpire)
		decision.Existing, decision.ExistingIndex, decision.Replace = s.combatants[target].instances.Providers().FindSourceTarget(definition, source, target, s.loop.TimeMs())
	}
	if decision.Replace {
		return s.replaceProviderInstance(target, decision.ExistingIndex, decision.Existing, expiry, hasExpiry, contributions, model.EvidenceKindProviderRefresh)
	}
	reference := assigned
	if reference == "" {
		reference = s.nextProviderRef(definition)
	}
	if !hasExpiry {
		expiry = 0
	}
	return s.mountFreshProviderInstance(target, source, decision.DefinitionIndex, reference, expiry, contributions)
}

func (s *Engine) mountFreshProviderInstance(targetKey, sourceKey string, defIdx uint16, providerRef string, expireAt int64, contributions effectpkg.ContributionView) *model.EngineError {
	executor := s.lifecycleExecutor()
	inst := executor.FreshProvider(defIdx, providerRef, sourceKey, targetKey, expireAt, s.loop.TimeMs(), contributions)
	c := s.combatants[targetKey]
	c.instances.AppendProvider(inst)
	s.combatants[targetKey] = c
	mountProviderModifiersAcross(s.combatants, targetKey, inst, s.compiled)
	s.reResolveAfterProviderChange(targetKey, sourceKey)
	if expireAt > 0 {
		s.enqueueExpireCleanup(expireAt, effectpkg.ExpiryPayload{
			CombatantKey: targetKey,
			ProviderRef:  providerRef,
			Kind:         "provider",
		})
	}
	s.scheduleInitialProviderTick(targetKey, providerRef, defIdx, expireAt, inst.Source)
	s.recordProviderLifecycleEvidence(model.EvidenceKindProviderApply, inst)
	return s.bindProviderInstanceListeners(inst)
}

func (s *Engine) replaceProviderInstance(target string, index int, instance effectpkg.Provider, expiry int64, hasExpiry bool, contributions effectpkg.ContributionView, kind model.EvidenceKind) *model.EngineError {
	executor := s.lifecycleExecutor()
	change := executor.ReplaceProvider(instance, expiry, hasExpiry, contributions, s.loop.TimeMs())
	if change.EnqueueExpiry {
		s.enqueueExpireCleanup(change.Instance.ExpireAt, effectpkg.ExpiryPayload{CombatantKey: target, ProviderRef: instance.ProviderRef, Kind: "provider"})
	}
	actor := s.combatants[target]
	actor.instances.ReplaceProvider(index, change.Instance)
	s.combatants[target] = actor
	s.reResolveAfterProviderChange(target, change.Instance.Source)
	s.recordProviderLifecycleEvidence(kind, change.Instance)
	return nil
}

func (s *Engine) refreshProviderInstance(target, reference string, expiry int64, hasExpiry bool, contributions effectpkg.ContributionView) *model.EngineError {
	actor, exists := s.combatants[target]
	if !exists {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown combatant: "+target, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	instance, index, exists := actor.instances.Providers().Find(reference)
	if !exists {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown providerRef: "+reference, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	executor := s.lifecycleExecutor()
	change, err := executor.RefreshProvider(instance, expiry, hasExpiry, contributions, s.loop.TimeMs())
	if err != nil {
		return err
	}
	if change.EnqueueExpiry {
		s.enqueueExpireCleanup(change.Instance.ExpireAt, effectpkg.ExpiryPayload{CombatantKey: target, ProviderRef: reference, Kind: "provider"})
	}
	actor.instances.ReplaceProvider(index, change.Instance)
	s.combatants[target] = actor
	s.reResolveAfterProviderChange(target, change.Instance.Source)
	s.recordProviderLifecycleEvidence(model.EvidenceKindProviderRefresh, change.Instance)
	return nil
}

func (s *Engine) reResolveAfterProviderChange(targetKey, sourceKey string) {
	evalCtx := s.evalContextForCombatants(sourceKey, targetKey)
	if sourceKey == "" {
		evalCtx = s.evalContextForCombatants(model.SelectorSource, model.SelectorTarget)
	}
	c := s.combatants[targetKey]
	resolved := s.resolveAttributesFor(targetKey, c.attributesView(), evalCtx, "")
	c = s.combatants[targetKey]

	c.setAttributes(resolved)
	s.combatants[targetKey] = c
	if opp := opponentCombatantKey(targetKey); opp != "" {
		if oc, ok := s.combatants[opp]; ok {
			resolved := s.resolveAttributesFor(opp, oc.attributesView(), evalCtx, "")
			oc = s.combatants[opp]

			oc.setAttributes(resolved)
			s.combatants[opp] = oc
		}
	}
}

func (s *Engine) expireProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext) {
	s.removeProviderInstance(targetKey, providerRef, evalCtx, model.EvidenceKindProviderRemove)
}

func (s *Engine) removeProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext, kind model.EvidenceKind) {
	c, ok := s.combatants[targetKey]
	if !ok {
		return
	}
	executor := s.lifecycleExecutor()
	inst, ok := executor.PrepareProviderRemoval(&c.instances, providerRef)
	if !ok {
		return
	}
	s.actions.RemoveAmmoProvider(targetKey, providerRef)
	s.unbindProviderInstanceListeners(targetKey, providerRef)
	lifecycle.RemoveProviderState(targetKey, providerRef, &c.instances, &c.providerState, &c.cooldowns, s.loop.TimeMs())
	s.combatants[targetKey] = c
	unmountProviderModifiersAcross(s.combatants, targetKey, providerRef)
	c = s.combatants[targetKey]
	resolved := s.resolveAttributesFor(targetKey, c.attributesView(), evalCtx, "")
	c = s.combatants[targetKey]

	c.setAttributes(resolved)
	s.combatants[targetKey] = c
	if opp := opponentCombatantKey(targetKey); opp != "" {
		if oc, ok := s.combatants[opp]; ok {
			resolved := s.resolveAttributesFor(opp, oc.attributesView(), evalCtx, "")
			oc = s.combatants[opp]

			oc.setAttributes(resolved)
			s.combatants[opp] = oc
		}
	}
	if kind != "" {
		s.recordProviderLifecycleEvidence(kind, inst)
	}
}

func (s *Engine) handleExpireCleanup(ev scheduler.GenericEvent) {
	if ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= s.effectTimers.ExpiryCount() {
		s.sweepExpiredInstances()
		return
	}
	payload := s.effectTimers.ExpiryAt(ev.DriverEntryIndex)
	switch payload.Kind {
	case "provider_cooldown":
		s.applyInternalCooldownExpiry(payload)
	case "provider":
		if payload.ProviderRef != "" {
			if c, ok := s.combatants[payload.CombatantKey]; ok {
				if inst, _, found := c.instances.Providers().Find(payload.ProviderRef); found {
					if inst.ExpireAt > s.loop.TimeMs() {
						return
					}
				}
			}
			evalCtx := s.evalContextForCombatants(model.SelectorSource, model.SelectorTarget)
			if !s.automatedRun() && !s.compiled.HasResourceMax && !s.compiled.HasCooldownDuration && !s.compiled.HasProviderDurationChange && !s.compiled.HasStagedLinkedShield && !s.compiled.HasModifierSnapshots {
				s.removeProviderInstance(payload.CombatantKey, payload.ProviderRef, evalCtx, model.EvidenceKindProviderExpire)
			} else {
				var frameStorage Frame
				s.initExecutionFrame(&frameStorage, model.SelectorSource, model.SelectorTarget, "provider_expiry:"+payload.ProviderRef)
				frame := &frameStorage
				if err := frame.consumeCommands(1); err != nil {
					s.processFailure = err
					return
				}
				staged := frame.stageFor(payload.CombatantKey)
				staged.providerOps = append(staged.providerOps, stagedProviderMutation{Kind: "expire", TargetKey: payload.CombatantKey,
					ProviderRef: payload.ProviderRef, EvidenceKind: model.EvidenceKindProviderExpire})
				frame.commit()
				if frame.fatal {
					s.processFailure = frame.fatalErr
				}
			}
		}
	case "target_timing":
		s.applyTargetTimingExpiry(payload)
	case "provider_target_state":
		s.applyProviderTargetStateExpiry(payload)
	case "provider_source_state":
		s.applyProviderSourceStateExpiry(payload)
	case "shield":
		s.removeExpiredShieldInstance(payload.CombatantKey, payload.ShieldRef)
	default:
		s.sweepExpiredInstances()
	}
}

func (s *Engine) sweepExpiredInstances() {
	if s.compiled.HasShieldLifecycle {
		s.sweepExpiredLinkedInstances()
		return
	}
	evalCtx := s.evalContextForCombatants(model.SelectorSource, model.SelectorTarget)
	for key, c := range s.combatants {
		sweep := lifecycle.SweepExpiredState(&c.instances, &c.providerState, s.loop.TimeMs())
		if sweep.Changed {

			s.combatants[key] = c
			for _, ref := range sweep.Refs {
				unmountProviderModifiersAcross(s.combatants, key, ref)
			}
			c = s.combatants[key]
			resolved := s.resolveAttributesFor(key, c.attributesView(), evalCtx, "")
			c = s.combatants[key]

			c.setAttributes(resolved)
			s.combatants[key] = c
			if opp := opponentCombatantKey(key); opp != "" {
				if oc, ok := s.combatants[opp]; ok {
					resolved := s.resolveAttributesFor(opp, oc.attributesView(), evalCtx, "")
					oc = s.combatants[opp]

					oc.setAttributes(resolved)
					s.combatants[opp] = oc
				}
			}
			for instanceIndex, instanceValues := 0, sweep.Expired; instanceIndex < instanceValues.Len(); instanceIndex++ {
				inst := instanceValues.At(instanceIndex)
				s.recordProviderLifecycleEvidence(model.EvidenceKindProviderExpire, inst)
			}
			continue
		}
		s.combatants[key] = c
	}
}

func (s *Engine) removeExpiredShieldInstance(combatantKey, shieldRef string) {
	c, ok := s.combatants[combatantKey]
	if !ok {
		return
	}
	if s.compiled.HasShieldLifecycle {
		if c.instances.Shields().HasExpiredRef(shieldRef, s.loop.TimeMs()) {
			s.removeShieldInstance(combatantKey, shieldRef, model.EvidenceKindProviderExpire)
		}
		return
	}
	c.instances.SetShields(c.instances.Shields().RemoveExpiredRef(shieldRef, s.loop.TimeMs()))
	s.combatants[combatantKey] = c
}

func (s *Engine) addShieldInstance(targetKey, sourceKey string, amount float64, shieldRef string, priority int16, expireAt int64) {
	c := s.combatants[targetKey]
	if shieldRef == "" {
		shieldRef = fmt.Sprintf("shield#%d", c.instances.Shields().Len()+1)
	}
	s.reserveShieldRef(shieldRef)
	c.instances.SetShields(c.instances.Shields().Append(effectpkg.Shield{
		ShieldRef: shieldRef,
		Source:    sourceKey,
		Owner:     targetKey,
		Remaining: amount,
		Priority:  priority,
		ExpireAt:  expireAt,
		State:     effectpkg.ObjectState(map[string]interface{}{}),
	}))
	s.combatants[targetKey] = c
	if expireAt > 0 {
		s.enqueueExpireCleanup(expireAt, effectpkg.ExpiryPayload{
			CombatantKey: targetKey,
			ShieldRef:    shieldRef,
			Kind:         "shield",
		})
	}
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

func (s *Engine) providerFormulaContextFunc(combatantKey, castTargetKey string) pipeline.ProviderFormulaContextFunc {
	return func(ownerCombatantKey, providerRef string) pipeline.ProviderFormulaContext {
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
}

func (s *Engine) resolveAttributesFor(combatantKey string, attrs attribute.Table, evalCtx formula.GenericEvalContext, activeTargetKey string) attribute.Table {
	c, ok := s.combatants[combatantKey]
	if !ok {
		return attrs
	}
	resolved, err := s.evaluation.ResolveOrdinary(s.formulas, combatantKey,
		attrs,
		c.instances.Attributes(),
		evalCtx,
		s.providerFormulaContextFunc(combatantKey, activeTargetKey),
	)
	if err != nil {
		s.processFailure = preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+combatantKey+".attributes", "", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID))
		return attrs
	}
	if len(s.compiled.AttributeDerivations) == 0 {
		if s.compiled.HasResourceMax {
			resolved = syncHPResolved(resolved)
		}
		return resolved
	}
	ordinary := map[string]attribute.Table{}
	for _, owner := range []string{"source", "target"} {
		host := s.combatants[owner]
		ordinary[owner], err = s.evaluation.ResolveOrdinary(s.formulas, owner, host.attributesView(), host.instances.Attributes(), evalCtx, s.providerFormulaContextFunc(owner, activeTargetKey))
		if err != nil {
			s.processFailure = preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+owner+".attributes", "", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID))
			return attrs
		}
	}
	ordinary[combatantKey] = resolved
	resolved, err = s.evaluation.ResolveDerived(s.compiled.AttributeDerivations, s.formulas, combatantKey, resolved, c.instances.Attributes(), ordinary["source"], ordinary["target"], s.providerFormulaContextFunc(combatantKey, activeTargetKey))
	if err != nil {
		s.processFailure = preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), "combatants."+combatantKey+".attributes", "", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID))
		return attrs
	}
	// Resource capacity has already passed cold admission. Ordinary modifiers
	// rebuild Resolved from Base; runtime HP continues to mean actual Current,
	// including provider lifecycle refreshes and quiet observation endpoints.
	if s.compiled.HasResourceMax {
		resolved = syncHPResolved(resolved)
	}
	return resolved
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
	deadline, err := executor.DurationExtensionDeadline(operation, owner, f.sourceKey, f.ownerProviderRef, f.run.loop.TimeMs())
	if err != nil {
		return err
	}
	f.flushDynamicProviders()
	if f.fatal {
		return f.fatalErr
	}
	staged := f.stageFor(owner)
	mutation, changed, err := executor.PrepareDurationExtension(operation, owner, staged.instances.Providers(), deadline, f.run.loop.TimeMs())
	if err != nil || !changed {
		return err
	}
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
	provider, err := executor.BindLinkedShield(op, amount)
	if err != nil {
		return err
	}
	expires := int64(0)
	if op.HasShieldDuration {
		expires, err = f.evalShieldDuration(op, ability)
		if err != nil {
			return err
		}
	}
	context := f.evalContextForProviderApply(ability, f.sourceKey, target)
	context.StrictReads = true
	staged := f.stageFor(target)
	projected, err := executor.StageLinkedShield(op, provider, f.sourceKey, target, amount, expires, f.run.loop.TimeMs(), context, &staged.instances, staged.providerOps)
	if err != nil {
		return f.preserveLifecycleFormulaError(err)
	}
	previousCount := len(staged.providerOps)
	staged.providerOps, staged.dirty = projected.Mutations, true
	if projected.Changed || len(projected.Mutations) != previousCount {
		f.effectProjection.MarkDirty()
	}
	if projected.Expiry.ExpireAt > 0 {
		f.pendingShieldExpires = append(f.pendingShieldExpires, pendingShieldExpire{combatantKey: projected.Expiry.CombatantKey, shieldRef: projected.Expiry.ShieldRef, expireAt: projected.Expiry.ExpireAt})
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

func removeShieldsForProvider(shields effectpkg.ShieldList, ref string) effectpkg.ShieldList {
	return shields.WithoutProvider(ref)
}

func (s *Engine) removeShieldInstance(owner, shieldRef string, kind model.EvidenceKind) {
	c, found := s.combatants[owner]
	if !found {
		return
	}
	executor := s.lifecycleExecutor()
	decision := executor.DecideShieldRemoval(c.instances, shieldRef)
	if !decision.Found {
		return
	}
	if decision.Atomic {
		var storage Frame
		s.initExecutionFrame(&storage, decision.Shield.Source, owner, "shield_expiry:"+shieldRef)
		f := &storage
		if err := f.consumeCommands(1); err != nil {
			s.processFailure = err
			return
		}
		staged := f.stageFor(owner)
		staged.providerOps = append(staged.providerOps, stagedProviderMutation{Kind: "expire", ProviderRef: decision.Shield.LifecycleProviderRef, TargetKey: owner, EvidenceKind: kind})
		staged.dirty = true
		f.effectProjection.MarkDirty()
		f.commit()
		if f.fatal {
			s.processFailure = f.fatalErr
		}
		return
	}
	c.instances.SetShields(c.instances.Shields().Remove(decision.Index))
	s.combatants[owner] = c
	if decision.Shield.LifecycleProviderRef != "" {
		s.removeProviderInstance(owner, decision.Shield.LifecycleProviderRef, s.evalContextForCombatants(decision.Shield.Source, owner), kind)
	}
}

func (s *Engine) sweepExpiredLinkedInstances() {
	for _, owner := range [2]string{model.SelectorSource, model.SelectorTarget} {
		lifecycle.SweepLinkedProviders(owner, s.combatants[owner].instances.Providers(), s.loop.TimeMs(), (*lifecycleExpiredEffects)(s))
		lifecycle.SweepLinkedShields(owner, s.combatants[owner].instances.Shields(), s.loop.TimeMs(), (*lifecycleExpiredEffects)(s))
	}
}

func validateShieldLifecycleSnapshot(snapshot model.Snapshot, compiled planbundle.CompiledSession, sessionID string) *model.EngineError {
	return lifecycle.ValidateShieldSnapshot(snapshot, compiled, sessionID)
}

func (f *Frame) evalContextForProviderApply(ability planbundle.CompiledAbility, sourceKey, targetKey string) formula.GenericEvalContext {
	ctx := f.evalContext(ability)
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
	return ctx
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
