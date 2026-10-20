package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *genericRunState) isOwnedProviderDurationListener(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	ownerType, ownerDeclared := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	hitType, hitDeclared := s.compiled.RuntimeTypes.BasicAttackHit.Lookup()
	startType, startDeclared := s.compiled.RuntimeTypes.AbilityStarted.Lookup()
	attack := s.req.DriverPlan.BasicAttack
	hit := hitDeclared && listener.EventMatcher.RequiresAllType(hitType) && (attack == nil || attack.Source == listener.OwnerCombatantKey)
	started := startDeclared && listener.EventMatcher.RequiresAllType(startType)
	if !s.compiled.HasProviderDurationChange || listener.OwnerCombatantKey != model.SelectorSource || !ownerDeclared ||
		!listener.EventMatcher.RequiresAllType(ownerType) || (!hit && !started) || operation.Target != model.SelectorSelf || operation.ValuePolicy != "ensure_remaining" ||
		!s.plannedSkillProvider(listener.OwnerCombatantKey, listener.OwnerProviderRef) {
		return false
	}
	for _, actor := range s.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			if actor.Key == listener.OwnerCombatantKey && mount.ProviderRef == listener.OwnerProviderRef && int(mount.DefinitionIndex) == operation.OwnerProviderIndex {
				return true
			}
		}
	}
	return false
}

func (f *executionFrame) applyProviderEnsureRemaining(operation planbundle.CompiledOperation) *model.EngineError {
	fail := func(message string) *model.EngineError {
		return f.run.processErr(operation.Path, message, operation.ProviderDefinitionRef)
	}
	owner := f.providerOwnerKey()
	if !f.run.compiled.HasProviderDurationChange || operation.Target != model.SelectorSelf || operation.ValuePolicy != "ensure_remaining" ||
		owner != f.sourceKey || owner != model.SelectorSource || f.ownerProviderRef == "" || !operation.HasAmount {
		return fail("provider duration change requires its actual source owner and complete definition")
	}
	owned := false
	for _, actor := range f.run.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			owned = owned || actor.Key == owner && mount.ProviderRef == f.ownerProviderRef && int(mount.DefinitionIndex) == operation.OwnerProviderIndex
		}
	}
	index, exists := f.run.findProviderDefinitionIndex(operation.ProviderDefinitionRef)
	if !owned || !exists || !f.run.compiled.Providers[index].AtomicDynamic {
		return fail("provider duration change references an unknown or foreign applying source")
	}
	amount, static := f.run.formulas.FoldStatic(operation.AmountProgram)
	deadline, safe := processTimeAfter(f.run.nowMs, amount, true)
	if !static || !safe || deadline > maxJSONSafeInteger || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount > float64(maxJSONSafeInteger) || math.Trunc(amount) != amount {
		return fail("provider duration change requires safe static nonnegative integer milliseconds")
	}
	f.flushDynamicProviders()
	if f.fatal {
		return f.fatalErr
	}
	sc := f.stageFor(owner)
	ref := ""
	previousExpiry := int64(0)
	for _, instance := range sc.providers {
		if instance.DefinitionRef != operation.ProviderDefinitionRef {
			continue
		}
		if instance.Owner != owner || instance.Source != owner {
			return fail("provider duration change found a foreign instance owner")
		}
		if instance.Expired(f.run.nowMs) {
			continue
		}
		if instance.ExpireAt <= 0 || ref != "" {
			return fail("provider duration change requires one active finite source instance")
		}
		ref = instance.ProviderRef
		previousExpiry = instance.ExpireAt
	}
	if ref == "" || deadline <= previousExpiry {
		return nil
	}
	sc.providerOps = append(sc.providerOps, stagedProviderMutation{kind: "ensure_remaining", definitionRef: operation.ProviderDefinitionRef,
		providerRef: ref, targetKey: owner, sourceKey: owner, expireAt: deadline, hasExpireAt: true})
	sc.dirty, f.dynamicProviderDirty = true, true
	return nil
}
