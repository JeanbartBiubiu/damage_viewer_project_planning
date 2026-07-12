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
	combatantKey string
	providerRef  string
	shieldRef    string
	kind         string // "provider" | "shield" | "sweep"
}

func (s *genericRunState) nextProviderRef(definitionRef string) string {
	s.nextProviderInstanceID++
	return fmt.Sprintf("%s#%d", definitionRef, s.nextProviderInstanceID)
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

func (s *genericRunState) applyProviderInstance(targetKey, sourceKey, definitionRef string, evalCtx formula.GenericEvalContext) *model.EngineError {
	defIdx, ok := s.findProviderDefinitionIndex(definitionRef)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition: "+definitionRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	provider := s.compiled.Providers[defIdx]
	providerRef := s.nextProviderRef(definitionRef)
	stacks := 1
	expireAt := int64(0)
	if provider.Lifecycle != nil {
		if provider.Lifecycle.HasDuration {
			duration, err := s.compiled.Formulas.Eval(provider.Lifecycle.DurationProgram, evalCtx)
			if err != nil {
				return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
			}
			expireAt = s.nowMs + int64(duration)
		}
	}
	inst := status.ProviderInstance{
		ProviderRef:     providerRef,
		DefinitionRef:   definitionRef,
		Source:          sourceKey,
		Owner:           targetKey,
		Stacks:          stacks,
		ExpireAt:        expireAt,
		State:           map[string]interface{}{},
		DefinitionIndex: defIdx,
	}
	c := s.combatants[targetKey]
	c.providers = append(c.providers, inst)
	c.resolver.MountProviderModifiers(providerRef, provider, s.compiled.Formulas)
	c.attributes = c.resolver.ResolveAttributes(c.attributes, evalCtx, s.compiled.Formulas)
	s.combatants[targetKey] = c
	if expireAt > 0 {
		s.enqueueExpireCleanup(expireAt, expireCleanupPayload{
			combatantKey: targetKey,
			providerRef:  providerRef,
			kind:         "provider",
		})
	}
	s.scheduleInitialProviderTick(targetKey, providerRef, defIdx, expireAt, inst.Source)
	return nil
}

func (s *genericRunState) refreshProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext) *model.EngineError {
	c, ok := s.combatants[targetKey]
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown combatant: "+targetKey, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	inst, idx, ok := status.FindByRef(c.providers, providerRef)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown providerRef: "+providerRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	provider := s.compiled.Providers[inst.DefinitionIndex]
	policy := "replace"
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
		if provider.Lifecycle != nil && provider.Lifecycle.HasDuration {
			duration, err := s.compiled.Formulas.Eval(provider.Lifecycle.DurationProgram, evalCtx)
			if err != nil {
				return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
			}
			newExpire := s.nowMs + int64(duration)
			if newExpire > inst.ExpireAt {
				inst.ExpireAt = newExpire
				s.enqueueExpireCleanup(newExpire, expireCleanupPayload{
					combatantKey: targetKey,
					providerRef:  providerRef,
					kind:         "provider",
				})
			}
		}
	case "add_stack":
		if inst.Stacks < maxStacks {
			inst.Stacks++
		}
	default: // replace
		if provider.Lifecycle != nil && provider.Lifecycle.HasDuration {
			duration, err := s.compiled.Formulas.Eval(provider.Lifecycle.DurationProgram, evalCtx)
			if err != nil {
				return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
			}
			inst.ExpireAt = s.nowMs + int64(duration)
			s.enqueueExpireCleanup(inst.ExpireAt, expireCleanupPayload{
				combatantKey: targetKey,
				providerRef:  providerRef,
				kind:         "provider",
			})
		}
		if inst.Stacks < maxStacks {
			inst.Stacks = maxStacks
		}
	}
	c.providers[idx] = inst
	c.attributes = c.resolver.ResolveAttributes(c.attributes, evalCtx, s.compiled.Formulas)
	s.combatants[targetKey] = c
	return nil
}

func (s *genericRunState) expireProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext) {
	s.removeProviderInstance(targetKey, providerRef, evalCtx)
}

func (s *genericRunState) removeProviderInstance(targetKey, providerRef string, evalCtx formula.GenericEvalContext) {
	c, ok := s.combatants[targetKey]
	if !ok {
		return
	}
	if _, _, ok := status.FindByRef(c.providers, providerRef); !ok {
		return
	}
	c.providers = status.RemoveByRef(c.providers, providerRef)
	c.resolver.UnmountProvider(providerRef)
	delete(c.providerState, providerRef)
	c.attributes = c.resolver.ResolveAttributes(c.attributes, evalCtx, s.compiled.Formulas)
	s.combatants[targetKey] = c
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
			s.removeProviderInstance(payload.combatantKey, payload.providerRef, evalCtx)
		}
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
		for _, inst := range c.providers {
			if inst.Expired(s.nowMs) {
				c.resolver.UnmountProvider(inst.ProviderRef)
				delete(c.providerState, inst.ProviderRef)
				changed = true
				continue
			}
			active = append(active, inst)
		}
		if changed {
			c.providers = active
			c.attributes = c.resolver.ResolveAttributes(c.attributes, evalCtx, s.compiled.Formulas)
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

func materializeProviders(snapshot []model.CombatantProviderSnapshot, combatantKey string, compiled compilebundle.CompiledSession) ([]status.ProviderInstance, pipeline.AttributeResolver) {
	resolver := pipeline.AttributeResolver{}
	if len(snapshot) == 0 {
		return nil, resolver
	}
	instances := make([]status.ProviderInstance, 0, len(snapshot))
	for _, snap := range snapshot {
		defIdx, ok := findProviderDefIndex(compiled, snap.DefinitionRef)
		if !ok {
			continue
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
		inst := status.ProviderInstance{
			ProviderRef:     snap.ProviderRef,
			DefinitionRef:   snap.DefinitionRef,
			Source:          source,
			Owner:           owner,
			Stacks:          snap.Stacks,
			ExpireAt:        expireAt,
			State:           state,
			DefinitionIndex: defIdx,
		}
		if inst.Stacks <= 0 {
			inst.Stacks = 1
		}
		instances = append(instances, inst)
		resolver.MountProviderModifiers(inst.ProviderRef, compiled.Providers[defIdx], compiled.Formulas)
	}
	return instances, resolver
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
			ProviderRef:   inst.ProviderRef,
			DefinitionRef: inst.DefinitionRef,
			Source:        source,
			Owner:         inst.Owner,
			Stacks:        inst.Stacks,
			ExpireAt:      expireAtPtr(inst.ExpireAt),
			State:         state,
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
