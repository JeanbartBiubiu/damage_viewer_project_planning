package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"errors"
	"math"

	"tinygo_engine_v2/internal/model"

	planbundle "tinygo_engine_v2/internal/plan"
)

func (f *Frame) LinkedShieldPresent(index uint16) (float64, error) {
	if int(index) >= len(f.run.compiled.Providers) || f.ownerProviderRef == "" {
		return 0, errors.New("linked shield presence requires a bound actual provider")
	}
	definition := f.run.compiled.Providers[index]
	owner := f.providerOwnerKey()
	sc := f.stageFor(owner)
	origin, _, found := sc.instances.Providers().Find(f.ownerProviderRef)
	if !found || origin.Expired(f.run.loop.TimeMs()) || origin.Owner != owner || origin.Source == "" || definition.ShieldDefinitionRef == "" {
		return 0, errors.New("linked shield presence provider does not own the compiled definition")
	}
	for instanceIndex, instanceValues := 0, sc.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		sh := instanceValues.At(instanceIndex)
		if sh.DefinitionRef != definition.ShieldDefinitionRef || sh.Source != origin.Source || sh.Owner != origin.Owner || sh.LifecycleProviderRef == "" || sh.Remaining <= 0 || (sh.ExpireAt > 0 && sh.ExpireAt <= f.run.loop.TimeMs()) {
			continue
		}
		inst, _, alive := sc.instances.Providers().Find(sh.LifecycleProviderRef)
		alive = alive && !inst.Expired(f.run.loop.TimeMs()) && inst.DefinitionIndex == index && inst.Source == sh.Source && inst.Owner == sh.Owner && inst.ExpireAt == sh.ExpireAt
		for _, mutation := range sc.providerOps {
			if mutation.providerRef != sh.LifecycleProviderRef {
				continue
			}
			if mutation.kind == "shield_apply" {
				alive = mutation.definitionIndex == index && mutation.sourceKey == sh.Source && mutation.targetKey == sh.Owner && mutation.expireAt == sh.ExpireAt
			}
			if mutation.kind == "expire" {
				alive = false
			}
		}
		if alive {
			return 1, nil
		}
	}
	return 0, nil
}

// stageLifecycleShield replaces only the same actual source/owner/static shield.
// Both runtime identities are new, even when the lifecycle permits provider reuse.
func (f *Frame) stageLifecycleShield(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, target string, amount float64) *model.EngineError {
	bad := func(message string) *model.EngineError {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, op.Path, op.ShieldRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return bad("linked shield amount must be finite and non-negative")
	}
	if int(op.ShieldLifecycleProviderIndex) >= len(f.run.compiled.Providers) {
		return bad("linked shield provider is not bound")
	}
	provider := f.run.compiled.Providers[op.ShieldLifecycleProviderIndex]
	if provider.ShieldDefinitionRef != op.ShieldRef || op.ShieldRef == "" {
		return bad("linked shield definition does not match its provider")
	}
	expires := int64(0)
	if op.HasShieldDuration {
		var err *model.EngineError
		expires, err = f.evalShieldDuration(op, ability)
		if err != nil {
			return err
		}
	}
	ctx := f.evalContextForProviderApply(ability, f.sourceKey, target)
	ctx.StrictReads = true
	if provider.Lifecycle != nil && provider.Lifecycle.HasDuration {
		deadline, err := f.evalPreparedDuration(provider, ctx)
		if err != nil {
			return err
		}
		if deadline != expires {
			return bad("linked shield and provider must have the same expiry")
		}
	}
	var contributions effectpkg.ContributionView
	if len(provider.StatusContributions) > 0 {
		if expires <= f.run.loop.TimeMs() {
			return bad("linked status contributions require a positive shield duration")
		}
		var err *model.EngineError
		contributions, err = f.evalPreparedStatusContributions(provider, ctx)
		if err != nil {
			return err
		}
	}
	sc := f.stageFor(target)
	kept := sc.instances.Shields().Slice(0, 0)
	for instanceIndex, instanceValues := 0, sc.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		old := instanceValues.At(instanceIndex)
		if old.LifecycleProviderRef != "" && old.DefinitionRef == op.ShieldRef && old.Source == f.sourceKey && old.Owner == target {
			f.stageShieldProviderRemoval(sc, target, old.LifecycleProviderRef)
			continue
		}
		kept = kept.Append(old)
	}
	sc.instances.SetShields(kept)
	sc.dirty = true
	// Zero replaces the previous shield but never leaves an empty live association.
	if amount == 0 {
		return nil
	}
	shieldRef := f.run.nextShieldRef(op.ShieldRef)
	providerRef := f.run.nextProviderRef(provider.ProviderKey)
	sc.instances.SetShields(sc.instances.Shields().Append(effectpkg.Shield{ShieldRef: shieldRef, DefinitionRef: op.ShieldRef,
		LifecycleProviderRef: providerRef, Source: f.sourceKey, Owner: target, Remaining: amount, ExpireAt: expires,
		State: effectpkg.ObjectState(map[string]interface{}{})}))
	sc.providerOps = append(sc.providerOps, stagedProviderMutation{kind: "shield_apply", definitionIndex: op.ShieldLifecycleProviderIndex,
		definitionRef: provider.ProviderKey, providerRef: providerRef, sourceKey: f.sourceKey, targetKey: target,
		expireAt: expires, hasExpireAt: expires > 0, contributions: contributions})
	f.dynamicProviderDirty = true
	if expires > 0 {
		f.pendingShieldExpires = append(f.pendingShieldExpires, pendingShieldExpire{combatantKey: target, shieldRef: shieldRef, expireAt: expires})
	}
	return nil
}

func (f *Frame) stageShieldProviderRemoval(sc *stagedCombatant, owner, ref string) {
	if ref == "" {
		return
	}
	for _, mutation := range sc.providerOps {
		if mutation.kind == "expire" && mutation.providerRef == ref {
			return
		}
	}
	sc.providerOps = append(sc.providerOps, stagedProviderMutation{kind: "expire", providerRef: ref, targetKey: owner})
	f.dynamicProviderDirty = true
}

// Attribute-bearing shields stop contributing before the next authored number
// or emitted post-damage view is read, while all removals remain frame-local.
func (f *Frame) settleDepletedShieldAttributes() *model.EngineError {
	if !f.run.compiled.HasStagedLinkedShield {
		return nil
	}
	f.prepareShieldLifecycleRemovals()
	f.flushDynamicProviders()
	return f.fatalErr
}

// Runs before queue/wait preflight. Only touched combatants and their small shield
// lists are inspected; the common unbound-only session bypasses this altogether.
func (f *Frame) prepareShieldLifecycleRemovals() {
	f.staged.Range(func(owner string, sc *stagedCombatant) {
		for _, mutation := range sc.providerOps {
			if mutation.kind != "expire" {
				continue
			}
			kept := sc.instances.Shields().Slice(0, 0)
			for instanceIndex, instanceValues := 0, sc.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
				sh := instanceValues.At(instanceIndex)
				if sh.LifecycleProviderRef != mutation.providerRef {
					kept = kept.Append(sh)
				}
			}
			sc.instances.SetShields(kept)
		}
		has := func(ref string) bool {
			for instanceIndex, instanceValues := 0, sc.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
				sh := instanceValues.At(instanceIndex)
				if sh.LifecycleProviderRef == ref && sh.Remaining > 0 && (sh.ExpireAt <= 0 || sh.ExpireAt > f.run.loop.TimeMs()) {
					return true
				}
			}
			return false
		}
		for instanceIndex, instanceValues := 0, f.run.combatants[owner].instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			sh := instanceValues.At(instanceIndex)
			if sh.LifecycleProviderRef != "" && !has(sh.LifecycleProviderRef) {
				f.stageShieldProviderRemoval(sc, owner, sh.LifecycleProviderRef)
			}
		}
		// A same-frame shield followed by damage may already be empty before it was mounted.
		for i := 0; i < len(sc.providerOps); i++ {
			mutation := sc.providerOps[i]
			if mutation.kind == "shield_apply" && !has(mutation.providerRef) {
				f.stageShieldProviderRemoval(sc, owner, mutation.providerRef)
			}
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
	for i, instanceValues := 0, c.instances.Shields(); i < instanceValues.Len(); i++ {
		sh := instanceValues.At(i)
		if sh.ShieldRef != shieldRef {
			continue
		}
		if instance, _, exists := c.instances.Providers().Find(sh.LifecycleProviderRef); exists && s.compiled.Providers[instance.DefinitionIndex].AtomicLinkedShield {
			var storage Frame
			s.initExecutionFrame(&storage, sh.Source, owner, "shield_expiry:"+shieldRef)
			f := &storage
			if err := f.consumeCommands(1); err != nil {
				s.processFailure = err
				return
			}
			staged := f.stageFor(owner)
			staged.providerOps = append(staged.providerOps, stagedProviderMutation{kind: "expire", providerRef: sh.LifecycleProviderRef, targetKey: owner, evidenceKind: kind})
			staged.dirty, f.dynamicProviderDirty = true, true
			f.commit()
			if f.fatal {
				s.processFailure = f.fatalErr
			}
			return
		}
		out := c.instances.Shields().Remove(i)
		c.instances.SetShields(out)
		s.combatants[owner] = c
		if sh.LifecycleProviderRef != "" {
			s.removeProviderInstance(owner, sh.LifecycleProviderRef, s.evalContextForCombatants(sh.Source, owner), kind)
		}
		return
	}
}

func (s *Engine) sweepExpiredLinkedInstances() {
	for _, owner := range []string{model.SelectorSource, model.SelectorTarget} {
		for instanceIndex,
			// Each remove can copy the live list. Retaining the old read-only list makes
			// iteration stable while modifiers, listeners and the opposite edge disappear.
			instanceValues := 0, s.combatants[owner].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			provider := instanceValues.At(instanceIndex)
			if provider.Expired(s.loop.TimeMs()) {
				s.removeProviderInstance(owner, provider.ProviderRef, s.evalContextForCombatants(provider.Source, owner), model.EvidenceKindProviderExpire)
			}
		}
		for instanceIndex, instanceValues := 0, s.combatants[owner].instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			sh := instanceValues.At(instanceIndex)
			if sh.Expired(s.loop.TimeMs()) || sh.Remaining <= 0 {
				s.removeShieldInstance(owner, sh.ShieldRef, model.EvidenceKindProviderExpire)
			}
		}
	}
}

func validateShieldLifecycleSnapshot(snapshot model.Snapshot, compiled planbundle.CompiledSession, sessionID string) *model.EngineError {
	if !compiled.HasShieldLifecycle {
		for _, c := range snapshot.Combatants {
			for _, sh := range c.Shields {
				if sh.DefinitionRef != "" || sh.LifecycleProviderRef != "" {
					return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "shield lifecycle definition is not compiled", "initialSnapshot.combatants."+c.Key+".shields", sh.ShieldRef, compiled.SchemaHash, compiled.RulesHash, sessionID)
				}
			}
		}
		return nil
	}
	bad := func(path, message, ref string) *model.EngineError {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path, ref, compiled.SchemaHash, compiled.RulesHash, sessionID)
	}
	combatants := map[string]bool{}
	shieldRefCounts := map[string]int{}
	providerRefCounts := map[string]int{}
	for _, c := range snapshot.Combatants {
		combatants[c.Key] = true
		for _, sh := range c.Shields {
			shieldRefCounts[sh.ShieldRef]++
		}
		for _, provider := range c.Providers {
			providerRefCounts[provider.ProviderRef]++
		}
	}
	seenShields := map[string]bool{}
	seenProviders := map[string]bool{}
	for _, c := range snapshot.Combatants {
		bindings := map[string]bool{}
		for i, sh := range c.Shields {
			path := "initialSnapshot.combatants." + c.Key + ".shields[" + itoa(uint32(i)) + "]"
			linked := sh.DefinitionRef != "" || sh.LifecycleProviderRef != ""
			if !linked {
				continue
			}
			if sh.ShieldRef == "" || sh.DefinitionRef == "" || sh.LifecycleProviderRef == "" {
				return bad(path, "linked shield requires all explicit instance and definition references", sh.ShieldRef)
			}
			if seenShields[sh.ShieldRef] || shieldRefCounts[sh.ShieldRef] != 1 {
				return bad(path+".shieldRef", "duplicate linked shield instance", sh.ShieldRef)
			}
			seenShields[sh.ShieldRef] = true
			if sh.Owner != c.Key || !combatants[sh.Source] {
				return bad(path, "linked shield requires its actual source and recipient", sh.ShieldRef)
			}
			if math.IsNaN(sh.Remaining) || math.IsInf(sh.Remaining, 0) || sh.Remaining <= 0 {
				return bad(path+".remaining", "linked shield remaining must be finite and positive", sh.ShieldRef)
			}
			if sh.ExpireAt != nil && *sh.ExpireAt <= snapshot.TimeMs {
				return bad(path+".expireAt", "linked shield expiry must be in the future or null", sh.ShieldRef)
			}
			if bindings[sh.LifecycleProviderRef] || providerRefCounts[sh.LifecycleProviderRef] != 1 {
				return bad(path+".lifecycleProviderRef", "a provider cannot own multiple shields", sh.LifecycleProviderRef)
			}
			bindings[sh.LifecycleProviderRef] = true
			matches := 0
			for _, p := range c.Providers {
				if p.ProviderRef != sh.LifecycleProviderRef {
					continue
				}
				matches++
				index, exists := effectpkg.FindProviderDefinitionIndex(compiled, p.DefinitionRef)
				if !exists || compiled.Providers[index].ShieldDefinitionRef != sh.DefinitionRef {
					return bad(path+".definitionRef", "linked provider definition does not match shield", sh.ShieldRef)
				}
				if p.Source != sh.Source || p.Owner != sh.Owner || p.Stacks != 1 {
					return bad(path, "linked shield/provider source, owner and stack count must agree", sh.ShieldRef)
				}
				if (p.ExpireAt == nil) != (sh.ExpireAt == nil) || (p.ExpireAt != nil && *p.ExpireAt != *sh.ExpireAt) {
					return bad(path+".expireAt", "linked shield/provider expiry must agree", sh.ShieldRef)
				}
			}
			if matches != 1 {
				return bad(path+".lifecycleProviderRef", "linked shield requires exactly one actual provider", sh.LifecycleProviderRef)
			}
			for j, other := range c.Shields {
				if j != i && other.ShieldRef == sh.ShieldRef {
					return bad(path+".shieldRef", "duplicate actual shield reference", sh.ShieldRef)
				}
				if j != i && other.DefinitionRef == sh.DefinitionRef && other.Source == sh.Source && other.Owner == sh.Owner {
					return bad(path, "duplicate shield source/owner/definition", sh.ShieldRef)
				}
			}
		}
		for _, p := range c.Providers {
			index, known := effectpkg.FindProviderDefinitionIndex(compiled, p.DefinitionRef)
			if !known || compiled.Providers[index].ShieldDefinitionRef == "" {
				continue
			}
			if !bindings[p.ProviderRef] || seenProviders[p.ProviderRef] {
				return bad("initialSnapshot.combatants."+c.Key+".providers", "shield lifecycle provider requires one unique owning shield", p.ProviderRef)
			}
			seenProviders[p.ProviderRef] = true
		}
	}
	return nil
}
