// generic runtime provider/shield/expire 生命周期（Slice E1）。
package runtime

import (
	"fmt"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/scheduler"
	shieldpkg "tinygo_engine_v2/internal/shield"
	"tinygo_engine_v2/internal/status"
)

type expireCleanupPayload struct {
	combatantKey     string
	providerRef      string
	shieldRef        string
	kind             string // "provider" | "shield" | "sweep" | "provider_target_state"
	targetKey        string // provider_target_state: active target combatant
	stateKey         string // provider_target_state: state field key
	expectedExpireAt int64  // provider_target_state: stale-event guard
}

func (s *genericRunState) nextProviderRef(definitionRef string) string {
	if s.usedProviderRefs == nil {
		s.usedProviderRefs = map[string]bool{}
		for _, c := range s.combatants {
			for _, inst := range c.providers {
				s.usedProviderRefs[inst.ProviderRef] = true
			}
		}
	}
	for {
		s.nextProviderInstanceID++
		ref := fmt.Sprintf("%s#%d", definitionRef, s.nextProviderInstanceID)
		if !s.usedProviderRefs[ref] {
			s.usedProviderRefs[ref] = true
			return ref
		}
	}
}

func (s *genericRunState) findProviderDefinitionIndex(providerKey string) (uint16, bool) {
	for i, p := range s.compiled.Providers {
		if p.ProviderKey == providerKey {
			return uint16(i), true
		}
	}
	return 0, false
}

func (s *genericRunState) enqueueExpireCleanup(atMs int64, payload expireCleanupPayload) {
	idx := len(s.expireCleanupPayloads)
	s.expireCleanupPayloads = append(s.expireCleanupPayloads, payload)
	ev := scheduler.GenericEvent{
		TimeMs:           atMs,
		Category:         scheduler.GenericCategoryExpireCleanup,
		Kind:             scheduler.GenericEventExpireCleanup,
		DriverEntryIndex: idx,
	}
	if payload.providerRef != "" {
		ev.ProviderInstanceRef = scheduler.ProviderInstanceRef{
			CombatantKey: payload.combatantKey,
			ProviderRef:  payload.providerRef,
		}
	}
	_ = s.heap.Push(ev)
}

func (s *genericRunState) applyProviderInstance(targetKey, sourceKey, definitionRef string, expireAt int64, hasExpireAt bool, contributions []status.StatusContribution) *model.EngineError {
	defIdx, ok := s.findProviderDefinitionIndex(definitionRef)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition: "+definitionRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	provider := s.compiled.Providers[defIdx]
	if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
		c := s.combatants[targetKey]
		for _, expired := range c.providers {
			if expired.DefinitionRef == definitionRef && expired.Source == sourceKey && expired.Owner == targetKey && expired.Expired(s.nowMs) {
				s.removeProviderInstance(targetKey, expired.ProviderRef, s.evalContextForCombatants(sourceKey, targetKey), model.EvidenceKindProviderExpire)
				c = s.combatants[targetKey]
				break
			}
		}
		if inst, idx, found := findSourceTargetProvider(c.providers, definitionRef, sourceKey, targetKey, s.nowMs); found {
			return s.replaceProviderInstance(targetKey, idx, inst, expireAt, hasExpireAt, contributions, model.EvidenceKindProviderRefresh)
		}
	}
	providerRef := s.nextProviderRef(definitionRef)
	stacks := 1
	if !hasExpireAt {
		expireAt = 0
	}
	inst := status.ProviderInstance{
		ProviderRef:         providerRef,
		DefinitionRef:       definitionRef,
		Source:              sourceKey,
		Owner:               targetKey,
		Stacks:              stacks,
		ExpireAt:            expireAt,
		State:               map[string]interface{}{},
		DefinitionIndex:     defIdx,
		StatusContributions: cloneStatusContributions(contributions),
	}
	c := s.combatants[targetKey]
	c.providers = append(c.providers, inst)
	s.combatants[targetKey] = c
	mountProviderModifiersAcross(s.combatants, targetKey, inst, s.compiled)
	s.reResolveAfterProviderChange(targetKey, sourceKey)
	if expireAt > 0 {
		s.enqueueExpireCleanup(expireAt, expireCleanupPayload{
			combatantKey: targetKey,
			providerRef:  providerRef,
			kind:         "provider",
		})
	}
	s.scheduleInitialProviderTick(targetKey, providerRef, defIdx, expireAt, inst.Source)
	s.recordProviderLifecycleEvidence(model.EvidenceKindProviderApply, inst)
	s.bindProviderInstanceListeners(inst)
	return nil
}

func (s *genericRunState) replaceProviderInstance(targetKey string, idx int, inst status.ProviderInstance, expireAt int64, hasExpireAt bool, contributions []status.StatusContribution, kind model.EvidenceKind) *model.EngineError {
	if hasExpireAt {
		inst.ExpireAt = expireAt
		if expireAt > 0 {
			s.enqueueExpireCleanup(expireAt, expireCleanupPayload{
				combatantKey: targetKey,
				providerRef:  inst.ProviderRef,
				kind:         "provider",
			})
		}
	}
	if contributions != nil {
		inst.StatusContributions = cloneStatusContributions(contributions)
	}
	c := s.combatants[targetKey]
	c.providers[idx] = inst
	s.combatants[targetKey] = c
	s.reResolveAfterProviderChange(targetKey, inst.Source)
	s.recordProviderLifecycleEvidence(kind, inst)
	return nil
}

func (s *genericRunState) refreshProviderInstance(targetKey, providerRef string, expireAt int64, hasExpireAt bool, contributions []status.StatusContribution) *model.EngineError {
	c, ok := s.combatants[targetKey]
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown combatant: "+targetKey, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	inst, idx, ok := status.FindByRef(c.providers, providerRef)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown providerRef: "+providerRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	provider := s.compiled.Providers[inst.DefinitionIndex]
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
			s.enqueueExpireCleanup(expireAt, expireCleanupPayload{
				combatantKey: targetKey,
				providerRef:  providerRef,
				kind:         "provider",
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
				s.enqueueExpireCleanup(inst.ExpireAt, expireCleanupPayload{
					combatantKey: targetKey,
					providerRef:  providerRef,
					kind:         "provider",
				})
			}
		}
		if inst.Stacks < maxStacks {
			inst.Stacks = maxStacks
		}
	}
	if contributions != nil {
		inst.StatusContributions = cloneStatusContributions(contributions)
	}
	c.providers[idx] = inst
	s.combatants[targetKey] = c
	s.reResolveAfterProviderChange(targetKey, inst.Source)
	s.recordProviderLifecycleEvidence(model.EvidenceKindProviderRefresh, inst)
	return nil
}

func (s *genericRunState) reResolveAfterProviderChange(targetKey, sourceKey string) {
	evalCtx := s.evalContextForCombatants(sourceKey, targetKey)
	if sourceKey == "" {
		evalCtx = s.evalContextForCombatants(model.SelectorSource, model.SelectorTarget)
	}
	c := s.combatants[targetKey]
	c.attributes = s.resolveAttributesFor(targetKey, c.attributes, evalCtx, "")
	s.combatants[targetKey] = c
	if opp := opponentCombatantKey(targetKey); opp != "" {
		if oc, ok := s.combatants[opp]; ok {
			oc.attributes = s.resolveAttributesFor(opp, oc.attributes, evalCtx, "")
			s.combatants[opp] = oc
		}
	}
}

func (s *genericRunState) expireProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext) {
	s.removeProviderInstance(targetKey, providerRef, evalCtx, model.EvidenceKindProviderRemove)
}

func (s *genericRunState) removeProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext, kind model.EvidenceKind) {
	c, ok := s.combatants[targetKey]
	if !ok {
		return
	}
	inst, _, ok := status.FindByRef(c.providers, providerRef)
	if !ok {
		return
	}
	s.unbindProviderInstanceListeners(targetKey, providerRef)
	c.providers = status.RemoveByRef(c.providers, providerRef)
	delete(c.providerState, providerRef)
	s.combatants[targetKey] = c
	unmountProviderModifiersAcross(s.combatants, targetKey, providerRef)
	c = s.combatants[targetKey]
	c.attributes = s.resolveAttributesFor(targetKey, c.attributes, evalCtx, "")
	s.combatants[targetKey] = c
	if opp := opponentCombatantKey(targetKey); opp != "" {
		if oc, ok := s.combatants[opp]; ok {
			oc.attributes = s.resolveAttributesFor(opp, oc.attributes, evalCtx, "")
			s.combatants[opp] = oc
		}
	}
	if kind != "" {
		s.recordProviderLifecycleEvidence(kind, inst)
	}
}

func (s *genericRunState) handleExpireCleanup(ev scheduler.GenericEvent) {
	if ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= len(s.expireCleanupPayloads) {
		s.sweepExpiredInstances()
		return
	}
	payload := s.expireCleanupPayloads[ev.DriverEntryIndex]
	switch payload.kind {
	case "provider":
		if payload.providerRef != "" {
			if c, ok := s.combatants[payload.combatantKey]; ok {
				if inst, _, found := status.FindByRef(c.providers, payload.providerRef); found {
					if inst.ExpireAt > s.nowMs {
						return
					}
				}
			}
			evalCtx := s.evalContextForCombatants(model.SelectorSource, model.SelectorTarget)
			s.removeProviderInstance(payload.combatantKey, payload.providerRef, evalCtx, model.EvidenceKindProviderExpire)
		}
	case "provider_target_state":
		s.applyProviderTargetStateExpiry(payload)
	case "shield":
		s.removeShieldInstance(payload.combatantKey, payload.shieldRef)
	default:
		s.sweepExpiredInstances()
	}
}

func (s *genericRunState) sweepExpiredInstances() {
	evalCtx := s.evalContextForCombatants(model.SelectorSource, model.SelectorTarget)
	for key, c := range s.combatants {
		changed := false
		active := make([]status.ProviderInstance, 0, len(c.providers))
		expiredRefs := make([]string, 0)
		expiredInsts := make([]status.ProviderInstance, 0)
		for _, inst := range c.providers {
			if inst.Expired(s.nowMs) {
				expiredRefs = append(expiredRefs, inst.ProviderRef)
				expiredInsts = append(expiredInsts, inst)
				delete(c.providerState, inst.ProviderRef)
				changed = true
				continue
			}
			active = append(active, inst)
		}
		if changed {
			c.providers = active
			s.combatants[key] = c
			for _, ref := range expiredRefs {
				unmountProviderModifiersAcross(s.combatants, key, ref)
			}
			c = s.combatants[key]
			c.attributes = s.resolveAttributesFor(key, c.attributes, evalCtx, "")
			s.combatants[key] = c
			if opp := opponentCombatantKey(key); opp != "" {
				if oc, ok := s.combatants[opp]; ok {
					oc.attributes = s.resolveAttributesFor(opp, oc.attributes, evalCtx, "")
					s.combatants[opp] = oc
				}
			}
			for _, inst := range expiredInsts {
				s.recordProviderLifecycleEvidence(model.EvidenceKindProviderExpire, inst)
			}
			continue
		}
		c.shields = shieldpkg.RemoveExpired(c.shields, s.nowMs)
		s.combatants[key] = c
	}
}

func (s *genericRunState) removeShieldInstance(combatantKey, shieldRef string) {
	c, ok := s.combatants[combatantKey]
	if !ok {
		return
	}
	out := c.shields[:0]
	for _, sh := range c.shields {
		if sh.ShieldRef != shieldRef {
			out = append(out, sh)
		}
	}
	c.shields = out
	s.combatants[combatantKey] = c
}

func (s *genericRunState) addShieldInstance(targetKey, sourceKey string, amount float64, shieldRef string, priority int16, expireAt int64) {
	c := s.combatants[targetKey]
	if shieldRef == "" {
		shieldRef = fmt.Sprintf("shield#%d", len(c.shields)+1)
	}
	c.shields = append(c.shields, shieldpkg.Instance{
		ShieldRef: shieldRef,
		Source:    sourceKey,
		Owner:     targetKey,
		Remaining: amount,
		Priority:  priority,
		ExpireAt:  expireAt,
		State:     map[string]interface{}{},
	})
	s.combatants[targetKey] = c
	if expireAt > 0 {
		s.enqueueExpireCleanup(expireAt, expireCleanupPayload{
			combatantKey: targetKey,
			shieldRef:    shieldRef,
			kind:         "shield",
		})
	}
}

func (s *genericRunState) seedExpireCleanups() {
	for key, c := range s.combatants {
		for _, inst := range c.providers {
			if inst.ExpireAt > 0 && inst.ExpireAt > s.nowMs {
				s.enqueueExpireCleanup(inst.ExpireAt, expireCleanupPayload{
					combatantKey: key,
					providerRef:  inst.ProviderRef,
					kind:         "provider",
				})
			}
		}
		for _, sh := range c.shields {
			if sh.ExpireAt > 0 && sh.ExpireAt > s.nowMs {
				s.enqueueExpireCleanup(sh.ExpireAt, expireCleanupPayload{
					combatantKey: key,
					shieldRef:    sh.ShieldRef,
					kind:         "shield",
				})
			}
		}
	}
}

func (s *genericRunState) enqueueProviderTickAt(atMs int64, combatantKey, providerRef string, intervalMs, expireAt int64) {
	if intervalMs <= 0 {
		return
	}
	if atMs > s.startMs+s.durationMs {
		return
	}
	if expireAt > 0 && atMs > expireAt {
		return
	}
	_ = s.heap.Push(scheduler.GenericEvent{
		TimeMs:   atMs,
		Category: scheduler.GenericCategoryProviderTick,
		Kind:     scheduler.GenericEventProviderTick,
		ProviderInstanceRef: scheduler.ProviderInstanceRef{
			CombatantKey: combatantKey,
			ProviderRef:  providerRef,
		},
	})
	_ = intervalMs
}

func (s *genericRunState) evalContextForCombatants(sourceKey, targetKey string) formula.GenericEvalContext {
	ctx := formula.GenericEvalContext{AbilityParams: map[string]float64{}}
	if c, ok := s.combatants[sourceKey]; ok {
		ctx.SourceAttrs = c.attributes
		ctx.SourceResources = c.resources
	}
	if c, ok := s.combatants[targetKey]; ok {
		ctx.TargetAttrs = c.attributes
		ctx.TargetResources = c.resources
	}
	return ctx
}

// providerFormulaContextFromBag builds the H2a provider overlay. Attrs/resources/ability/event
// are intentionally left unset so ResolveAttributesWithProviderContext keeps them from base.
func providerFormulaContextFromBag(bag *providerStateBag, activeTargetKey string) formula.GenericEvalContext {
	if bag == nil {
		return formula.GenericEvalContext{
			HasProviderContext:  true,
			ProviderState:       map[string]float64{},
			ProviderTargetState: map[string]float64{},
		}
	}
	ctx := formula.GenericEvalContext{
		HasProviderContext:    true,
		ProviderState:         bag.state,
		ProviderStateDefaults: bag.defaultsForFormula(),
	}
	if activeTargetKey != "" && bag.targetKey == activeTargetKey {
		ctx.ProviderTargetState = bag.targetStateForFormula()
	} else {
		ctx.ProviderTargetState = map[string]float64{}
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

func (s *genericRunState) resolveProviderStateFieldDefs(combatantKey, providerRef string, providers []status.ProviderInstance) map[string]providerStateFieldDef {
	if s == nil || providerRef == "" {
		return nil
	}
	return compiledStateFieldsForProvider(s.compiled, combatantKey, providerRef, providers)
}

func compiledStateFieldsForProvider(
	compiled compilebundle.CompiledSession,
	combatantKey, providerRef string,
	providers []status.ProviderInstance,
) map[string]providerStateFieldDef {
	if providerRef == "" {
		return nil
	}
	for _, inst := range providers {
		if inst.ProviderRef != providerRef {
			continue
		}
		if int(inst.DefinitionIndex) < len(compiled.Providers) {
			return compiledStateFieldsToRuntime(compiled.Providers[inst.DefinitionIndex].StateFields)
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
				return compiledStateFieldsToRuntime(compiled.Providers[mount.DefinitionIndex].StateFields)
			}
		}
	}
	for _, p := range compiled.Providers {
		if p.ProviderKey == providerRef {
			return compiledStateFieldsToRuntime(p.StateFields)
		}
	}
	return nil
}

func (s *genericRunState) providerFormulaContextFunc(combatantKey, castTargetKey string) pipeline.ProviderFormulaContextFunc {
	return func(ownerCombatantKey, providerRef string) formula.GenericEvalContext {
		bagOwnerKey := ownerCombatantKey
		if bagOwnerKey == "" {
			bagOwnerKey = combatantKey
		}
		c, ok := s.combatants[bagOwnerKey]
		if !ok {
			return providerFormulaContextFromBag(nil, providerTargetActiveKey(combatantKey, ownerCombatantKey, castTargetKey))
		}
		bag := c.providerState[providerRef]
		if bag == nil {
			return providerFormulaContextFromBag(nil, providerTargetActiveKey(combatantKey, ownerCombatantKey, castTargetKey))
		}
		bag.bindFieldDefs(s.resolveProviderStateFieldDefs(bagOwnerKey, providerRef, c.providers))
		bag.lazyExpireProviderState(s.nowMs)
		bag.lazyExpireProviderTargetState(s.nowMs)
		s.combatants[bagOwnerKey] = c
		return providerFormulaContextFromBag(bag, providerTargetActiveKey(combatantKey, ownerCombatantKey, castTargetKey))
	}
}

func (s *genericRunState) resolveAttributesFor(combatantKey string, attrs map[string]model.AttributeSlotDef, evalCtx formula.GenericEvalContext, activeTargetKey string) map[string]model.AttributeSlotDef {
	c, ok := s.combatants[combatantKey]
	if !ok {
		return attrs
	}
	return c.resolver.ResolveAttributesWithProviderContext(
		attrs,
		evalCtx,
		s.compiled.Formulas,
		s.providerFormulaContextFunc(combatantKey, activeTargetKey),
	)
}

// refreshProviderAwareAttributes lazy-expires provider timed state and re-resolves attributes
// so the next run event reflects recovered resolved values without a state write.
func (s *genericRunState) refreshProviderAwareAttributes(sourceKey, targetKey string) {
	evalCtx := s.evalContextForCombatants(sourceKey, targetKey)
	for key, c := range s.combatants {
		c.attributes = s.resolveAttributesFor(key, c.attributes, evalCtx, targetKey)
		s.combatants[key] = c
	}
}

func materializeProviders(snapshot []model.CombatantProviderSnapshot, combatantKey string, compiled compilebundle.CompiledSession, combatantKeys map[string]bool, path string, schemaHash, rulesHash, sessionID string) ([]status.ProviderInstance, pipeline.AttributeResolver, *model.EngineError) {
	// Resolver stays empty here; cross-combatant mounts happen in remountAllProviderModifiers.
	resolver := pipeline.AttributeResolver{}
	if len(snapshot) == 0 {
		return nil, resolver, nil
	}
	instances := make([]status.ProviderInstance, 0, len(snapshot))
	seenRefs := map[string]bool{}
	seenSourceTargets := map[string]bool{}
	for i, snap := range snapshot {
		p := path + ".providers[" + itoa(uint32(i)) + "]"
		defIdx, ok := findProviderDefIndex(compiled, snap.DefinitionRef)
		if !ok {
			if len(snap.StatusContributions) > 0 {
				return nil, resolver, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition with statusContributions", p+".definitionRef", snap.DefinitionRef, schemaHash, rulesHash, sessionID)
			}
			continue
		}
		provider := compiled.Providers[defIdx]
		strictIdentity := provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse()
		if strictIdentity {
			invalid := func(field, message string) *model.EngineError {
				return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, p+"."+field, snap.ProviderRef, schemaHash, rulesHash, sessionID)
			}
			if snap.Source == "" || !combatantKeys[snap.Source] {
				return nil, resolver, invalid("source", "source_target snapshot requires the actual source combatant")
			}
			if snap.Owner != combatantKey {
				return nil, resolver, invalid("owner", "source_target snapshot owner must equal its recipient combatant")
			}
			if snap.ProviderRef == "" {
				return nil, resolver, invalid("providerRef", "source_target snapshot requires an explicit instance reference")
			}
			if snap.Stacks != 1 {
				return nil, resolver, invalid("stacks", "source_target snapshot must have exactly one stack")
			}
			if snap.ExpireAt == nil || *snap.ExpireAt <= 0 {
				return nil, resolver, invalid("expireAt", "source_target snapshot requires a positive expiry timestamp")
			}
			identity := snap.DefinitionRef + "\x00" + snap.Source + "\x00" + snap.Owner
			if seenSourceTargets[identity] {
				return nil, resolver, invalid("providerRef", "duplicate source_target snapshot instance")
			}
			seenSourceTargets[identity] = true
		}
		if priorStrict, duplicate := seenRefs[snap.ProviderRef]; duplicate && (priorStrict || strictIdentity) {
			return nil, resolver, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "duplicate providerRef involving a source_target instance", p+".providerRef", snap.ProviderRef, schemaHash, rulesHash, sessionID)
		}
		seenRefs[snap.ProviderRef] = strictIdentity
		owner := snap.Owner
		if owner == "" {
			owner = combatantKey
		}
		source := snap.Source
		if source == "" {
			source = owner
		}
		expireAt := int64(0)
		if snap.ExpireAt != nil && *snap.ExpireAt > 0 {
			expireAt = *snap.ExpireAt
		}
		if len(provider.StatusContributions) > 0 && expireAt <= 0 {
			return nil, resolver, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "status contribution duration must be positive", p+".expireAt", snap.ProviderRef, schemaHash, rulesHash, sessionID)
		}
		state := snap.State
		if state == nil {
			state = map[string]interface{}{}
		}
		contribs, err := restoreStatusContributions(snap, provider, p, schemaHash, rulesHash, sessionID)
		if err != nil {
			return nil, resolver, err
		}
		inst := status.ProviderInstance{
			ProviderRef:         snap.ProviderRef,
			DefinitionRef:       snap.DefinitionRef,
			Source:              source,
			Owner:               owner,
			Stacks:              snap.Stacks,
			ExpireAt:            expireAt,
			State:               state,
			DefinitionIndex:     defIdx,
			StatusContributions: contribs,
		}
		if inst.Stacks <= 0 {
			inst.Stacks = 1
		}
		instances = append(instances, inst)
	}
	return instances, resolver, nil
}

// remountAllProviderModifiers clears then remounts every provider modifier onto the correct
// combatant resolver (including opponent.attr.* cross-combatant mounts).
func remountAllProviderModifiers(combatants map[string]combatantRuntime, compiled compilebundle.CompiledSession) {
	for key, c := range combatants {
		c.resolver = pipeline.AttributeResolver{}
		c.damageResolver = pipeline.DamageModifierResolver{}
		combatants[key] = c
	}
	for ownerKey, c := range combatants {
		for _, inst := range c.providers {
			mountProviderModifiersAcross(combatants, ownerKey, inst, compiled)
		}
	}
}

func materializeShields(snapshot []model.CombatantShieldSnapshot, combatantKey string) []shieldpkg.Instance {
	if len(snapshot) == 0 {
		return nil
	}
	out := make([]shieldpkg.Instance, 0, len(snapshot))
	for i, snap := range snapshot {
		ref := snap.ShieldRef
		if ref == "" {
			ref = fmt.Sprintf("shield#%d", i+1)
		}
		owner := snap.Owner
		if owner == "" {
			owner = combatantKey
		}
		source := snap.Source
		if source == "" {
			source = owner
		}
		expireAt := int64(0)
		if snap.ExpireAt != nil && *snap.ExpireAt > 0 {
			expireAt = *snap.ExpireAt
		}
		state := snap.State
		if state == nil {
			state = map[string]interface{}{}
		}
		if snap.Remaining > 0 {
			out = append(out, shieldpkg.Instance{
				ShieldRef: ref,
				Source:    source,
				Owner:     owner,
				Remaining: snap.Remaining,
				Priority:  snap.Priority,
				ExpireAt:  expireAt,
				State:     state,
			})
		}
	}
	return out
}

func findProviderDefIndex(compiled compilebundle.CompiledSession, definitionRef string) (uint16, bool) {
	for i, p := range compiled.Providers {
		if p.ProviderKey == definitionRef {
			return uint16(i), true
		}
	}
	return 0, false
}

func providersToSnapshot(instances []status.ProviderInstance) []model.CombatantProviderSnapshot {
	if instances == nil {
		return []model.CombatantProviderSnapshot{}
	}
	out := make([]model.CombatantProviderSnapshot, 0, len(instances))
	for _, inst := range instances {
		state := inst.State
		if state == nil {
			state = map[string]interface{}{}
		}
		source := inst.Source
		if source == "" {
			source = inst.Owner
		}
		snap := model.CombatantProviderSnapshot{
			ProviderRef:         inst.ProviderRef,
			DefinitionRef:       inst.DefinitionRef,
			Source:              source,
			Owner:               inst.Owner,
			Stacks:              inst.Stacks,
			ExpireAt:            expireAtPtr(inst.ExpireAt),
			State:               state,
			StatusContributions: contributionsToSnapshot(inst.StatusContributions),
		}
		out = append(out, snap)
	}
	return out
}

func shieldsToSnapshot(instances []shieldpkg.Instance) []model.CombatantShieldSnapshot {
	if instances == nil {
		return []model.CombatantShieldSnapshot{}
	}
	out := make([]model.CombatantShieldSnapshot, 0, len(instances))
	for _, sh := range instances {
		state := sh.State
		if state == nil {
			state = map[string]interface{}{}
		}
		source := sh.Source
		if source == "" {
			source = sh.Owner
		}
		out = append(out, model.CombatantShieldSnapshot{
			ShieldRef: sh.ShieldRef,
			Source:    source,
			Owner:     sh.Owner,
			Remaining: sh.Remaining,
			Priority:  sh.Priority,
			ExpireAt:  expireAtPtr(sh.ExpireAt),
			State:     state,
		})
	}
	return out
}

func expireAtPtr(expireAt int64) *int64 {
	if expireAt <= 0 {
		return nil
	}
	v := expireAt
	return &v
}
