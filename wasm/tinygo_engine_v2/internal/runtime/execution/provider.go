// generic runtime provider/shield/expire 生命周期（Slice E1）。
package execution

import (
	"fmt"
	"sort"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

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

func (s *Engine) findProviderDefinitionIndex(providerKey string) (uint16, bool) {
	for i, p := range s.compiled.Providers {
		if p.ProviderKey == providerKey {
			return uint16(i), true
		}
	}
	return 0, false
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

func (s *Engine) applyProviderInstanceWithRef(targetKey, sourceKey, definitionRef, assignedRef string, expireAt int64, hasExpireAt bool, contributions effectpkg.ContributionView) *model.EngineError {
	defIdx, ok := s.findProviderDefinitionIndex(definitionRef)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition: "+definitionRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	provider := s.compiled.Providers[defIdx]
	if provider.ShieldDefinitionRef != "" {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "shield lifecycle provider can only be created by its shield", "providerDefinitionRef", definitionRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
		c := s.combatants[targetKey]
		for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			expired := instanceValues.At(instanceIndex)
			if expired.DefinitionRef == definitionRef && expired.Source == sourceKey && expired.Owner == targetKey && expired.Expired(s.loop.TimeMs()) {
				s.removeProviderInstance(targetKey, expired.ProviderRef, s.evalContextForCombatants(sourceKey, targetKey), model.EvidenceKindProviderExpire)
				c = s.combatants[targetKey]
				break
			}
		}
		if inst, idx, found := c.instances.Providers().FindSourceTarget(definitionRef, sourceKey, targetKey, s.loop.TimeMs()); found {
			return s.replaceProviderInstance(targetKey, idx, inst, expireAt, hasExpireAt, contributions, model.EvidenceKindProviderRefresh)
		}
	}
	providerRef := assignedRef
	if providerRef == "" {
		providerRef = s.nextProviderRef(definitionRef)
	}
	if !hasExpireAt {
		expireAt = 0
	}
	s.mountFreshProviderInstance(targetKey, sourceKey, defIdx, providerRef, expireAt, contributions)
	return nil
}

func (s *Engine) mountFreshProviderInstance(targetKey, sourceKey string, defIdx uint16, providerRef string, expireAt int64, contributions effectpkg.ContributionView) {
	definitionRef := s.compiled.Providers[defIdx].ProviderKey
	inst := effectpkg.Provider{
		ProviderRef:         providerRef,
		DefinitionRef:       definitionRef,
		Source:              sourceKey,
		Owner:               targetKey,
		Stacks:              1,
		ExpireAt:            expireAt,
		State:               effectpkg.ObjectState(map[string]interface{}{}),
		DefinitionIndex:     defIdx,
		StatusContributions: contributions,
	}
	if s.compiled.Providers[defIdx].NeedsElapsedTime {
		inst.AppliedAtMs, inst.HasAppliedAt = s.loop.TimeMs(), true
	}
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
	s.bindProviderInstanceListeners(inst)
}

func (s *Engine) replaceProviderInstance(targetKey string, idx int, inst effectpkg.Provider, expireAt int64, hasExpireAt bool, contributions effectpkg.ContributionView, kind model.EvidenceKind) *model.EngineError {
	if s.compiled.Providers[inst.DefinitionIndex].NeedsElapsedTime {
		inst.AppliedAtMs, inst.HasAppliedAt = s.loop.TimeMs(), true
	}
	if hasExpireAt {
		inst.ExpireAt = expireAt
		if expireAt > 0 {
			s.enqueueExpireCleanup(expireAt, effectpkg.ExpiryPayload{
				CombatantKey: targetKey,
				ProviderRef:  inst.ProviderRef,
				Kind:         "provider",
			})
		}
	}
	if contributions.Present() {
		inst.StatusContributions = contributions
	}
	c := s.combatants[targetKey]
	c.instances.ReplaceProvider(idx, inst)
	s.combatants[targetKey] = c
	s.reResolveAfterProviderChange(targetKey, inst.Source)
	s.recordProviderLifecycleEvidence(kind, inst)
	return nil
}

func (s *Engine) refreshProviderInstance(targetKey, providerRef string, expireAt int64, hasExpireAt bool, contributions effectpkg.ContributionView) *model.EngineError {
	c, ok := s.combatants[targetKey]
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown combatant: "+targetKey, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	inst, idx, ok := c.instances.Providers().Find(providerRef)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown providerRef: "+providerRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	provider := s.compiled.Providers[inst.DefinitionIndex]
	if provider.ShieldDefinitionRef != "" {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "linked shield provider must be refreshed by applying its shield", "providerRef", providerRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	if provider.NeedsElapsedTime {
		return s.replaceProviderInstance(targetKey, idx, inst, expireAt, hasExpireAt, contributions, model.EvidenceKindProviderRefresh)
	}
	if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
		return s.replaceProviderInstance(targetKey, idx, inst, expireAt, hasExpireAt, contributions, model.EvidenceKindProviderRefresh)
	}
	policy := model.RefreshPolicyReplace
	maxStacks := 1
	if provider.Lifecycle != nil {
		if provider.Lifecycle.RefreshPolicy != "" {
			policy = provider.Lifecycle.RefreshPolicy
		}
		if provider.Lifecycle.MaxStacks > 0 {
			maxStacks = provider.Lifecycle.MaxStacks
		}
	}
	switch policy {
	case "extend":
		if hasExpireAt && expireAt > inst.ExpireAt {
			inst.ExpireAt = expireAt
			s.enqueueExpireCleanup(expireAt, effectpkg.ExpiryPayload{
				CombatantKey: targetKey,
				ProviderRef:  providerRef,
				Kind:         "provider",
			})
		}
	case "add_stack":
		if inst.Stacks < maxStacks {
			inst.Stacks++
		}
	default: // replace
		if hasExpireAt {
			inst.ExpireAt = expireAt
			if expireAt > 0 {
				s.enqueueExpireCleanup(inst.ExpireAt, effectpkg.ExpiryPayload{
					CombatantKey: targetKey,
					ProviderRef:  providerRef,
					Kind:         "provider",
				})
			}
		}
		if inst.Stacks < maxStacks {
			inst.Stacks = maxStacks
		}
	}
	if contributions.Present() {
		inst.StatusContributions = contributions
	}
	c.instances.ReplaceProvider(idx, inst)
	s.combatants[targetKey] = c
	s.reResolveAfterProviderChange(targetKey, inst.Source)
	s.recordProviderLifecycleEvidence(model.EvidenceKindProviderRefresh, inst)
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
	// Remove the reverse edge before unmounting. Repeated removal is harmless and
	// never follows a static definition or a textual reference prefix.
	if s.compiled.HasShieldLifecycle {
		c.instances.SetShields(removeShieldsForProvider(c.instances.Shields(), providerRef))
	}
	inst, _, ok := c.instances.Providers().Find(providerRef)
	if !ok {
		return
	}
	s.actions.RemoveAmmoProvider(targetKey, providerRef)
	s.unbindProviderInstanceListeners(targetKey, providerRef)
	c.cooldowns = c.cooldowns.Clone()
	c.cooldowns.RemoveProvider(targetKey, providerRef, s.loop.TimeMs())
	c.instances.SetProviders(c.instances.Providers().RemoveRef(providerRef))
	c.providerState.Remove(providerRef)
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
				staged.providerOps = append(staged.providerOps, stagedProviderMutation{kind: "expire", targetKey: payload.CombatantKey,
					providerRef: payload.ProviderRef, evidenceKind: model.EvidenceKindProviderExpire})
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
		changed := false
		active := effectpkg.ProviderList{}
		expiredRefs := make([]string, 0)
		expiredInsts := effectpkg.ProviderList{}
		for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			inst := instanceValues.At(instanceIndex)
			if inst.Expired(s.loop.TimeMs()) {
				expiredRefs = append(expiredRefs, inst.ProviderRef)
				expiredInsts = expiredInsts.Append(inst)
				c.providerState.Remove(inst.ProviderRef)
				changed = true
				continue
			}
			active = active.Append(inst)
		}
		if changed {
			c.instances.SetProviders(active)

			s.combatants[key] = c
			for _, ref := range expiredRefs {
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
			for instanceIndex, instanceValues := 0, expiredInsts; instanceIndex < instanceValues.Len(); instanceIndex++ {
				inst := instanceValues.At(instanceIndex)
				s.recordProviderLifecycleEvidence(model.EvidenceKindProviderExpire, inst)
			}
			continue
		}
		c.instances.SetShields(c.instances.Shields().RemoveExpired(s.loop.TimeMs()))
		s.combatants[key] = c
	}
}

func (s *Engine) removeExpiredShieldInstance(combatantKey, shieldRef string) {
	c, ok := s.combatants[combatantKey]
	if !ok {
		return
	}
	if s.compiled.HasShieldLifecycle {
		for instanceIndex, instanceValues := 0, c.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			sh := instanceValues.At(instanceIndex)
			if sh.ShieldRef == shieldRef && sh.Expired(s.loop.TimeMs()) {
				s.removeShieldInstance(combatantKey, shieldRef, model.EvidenceKindProviderExpire)
				return
			}
		}
		return
	}
	out := c.instances.Shields().Slice(0, 0)
	for instanceIndex, instanceValues := 0, c.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		sh := instanceValues.At(instanceIndex)
		if sh.ShieldRef != shieldRef || !sh.Expired(s.loop.TimeMs()) {
			out = out.Append(sh)
		}
	}
	c.instances.SetShields(out)
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
	for _, key := range []string{model.SelectorSource, model.SelectorTarget} {
		c, exists := s.combatants[key]
		if !exists {
			continue
		}
		for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			inst := instanceValues.At(instanceIndex)
			if inst.ExpireAt > 0 && inst.ExpireAt > s.loop.TimeMs() {
				s.enqueueExpireCleanup(inst.ExpireAt, effectpkg.ExpiryPayload{
					CombatantKey: key,
					ProviderRef:  inst.ProviderRef,
					Kind:         "provider",
				})
			}
		}
		for instanceIndex, instanceValues := 0, c.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			sh := instanceValues.At(instanceIndex)
			if sh.ExpireAt > 0 && sh.ExpireAt > s.loop.TimeMs() {
				s.enqueueExpireCleanup(sh.ExpireAt, effectpkg.ExpiryPayload{
					CombatantKey: key,
					ShieldRef:    sh.ShieldRef,
					Kind:         "shield",
				})
			}
		}
		refs := c.providerState.Keys()
		sort.Strings(refs)
		for _, ref := range refs {
			bag := c.providerState.Lookup(ref)
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
					if expires := timers.At(field); expires > s.loop.TimeMs() {
						s.enqueueExpireCleanup(expires, effectpkg.ExpiryPayload{Kind: scope, CombatantKey: key,
							ProviderRef: ref, TargetKey: bag.TargetKey(), StateKey: field, ExpectedExpireAt: expires})
					}
				}
			}
		}
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

func compiledStateDefinitionIndex(compiled planbundle.CompiledSession, combatantKey, providerRef string, providers effectpkg.ProviderList) int {
	if providerRef == "" {
		return -1
	}
	for instanceIndex, instanceValues := 0, providers; instanceIndex < instanceValues.Len(); instanceIndex++ {
		inst := instanceValues.At(instanceIndex)
		if inst.ProviderRef != providerRef {
			continue
		}
		if int(inst.DefinitionIndex) < len(compiled.Providers) {
			return int(inst.DefinitionIndex)
		}
	}
	for _, combatant := range compiled.Combatants {
		if combatant.Key != combatantKey {
			continue
		}
		for _, mount := range combatant.ProviderMounts {
			if mount.ProviderRef != providerRef {
				continue
			}
			if int(mount.DefinitionIndex) < len(compiled.Providers) {
				return int(mount.DefinitionIndex)
			}
		}
	}
	for index, p := range compiled.Providers {
		if p.ProviderKey == providerRef {
			return index
		}
	}
	return -1
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
