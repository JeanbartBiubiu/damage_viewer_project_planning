package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

// The duration-only session can combine a pure linked shield with projected
// attributes. Resource maximum/cooldown-duration batches keep their old guard.
func (f *Frame) canProjectDurationLinkedShield(p plan.CompiledProvider) bool {
	if p.AtomicLinkedShield {
		return true
	}
	return f.run.compiled.HasProviderDurationChange && !f.run.compiled.HasResourceMax && !f.run.compiled.HasCooldownDuration &&
		p.ShieldDefinitionRef != "" && p.Kind == "status" && p.TypeSet.Empty() && p.AbilityCount == 0 &&
		len(p.Modifiers)+len(p.Listeners)+len(p.StateFields)+len(p.Processes)+len(p.StatusContributions) == 0 &&
		p.AmmoBinding == nil && !p.NeedsElapsedTime && !p.HasResourceMax && !p.HasCooldownDuration &&
		(p.Lifecycle == nil || p.Lifecycle.MaxStacks == 1 && p.Lifecycle.RefreshPolicy == model.RefreshPolicyReplace && p.Lifecycle.TickIntervalMs == 0)
}

func (f *Frame) projectDurationLinkedShield(owner string, sc *stagedCombatant, definition plan.CompiledProvider, index uint16,
	old effectpkg.Provider, oldIndex int, mut *stagedProviderMutation) bool {
	if !f.canProjectDurationLinkedShield(definition) || mut.targetKey != owner {
		return false
	}
	if mut.kind == "shield_apply" && !f.validateStagedProviderAttributeSlots(owner, definition) {
		return true
	}
	if mut.kind == "shield_apply" {
		// The shield operation has already assigned both fresh identities and
		// evaluated amount/duration in the original authored operation order.
		paired := false
		for instanceIndex, instanceValues := 0, sc.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			shield := instanceValues.At(instanceIndex)
			paired = paired || shield.LifecycleProviderRef == mut.providerRef && shield.DefinitionRef == definition.ShieldDefinitionRef &&
				shield.Owner == owner && shield.Source == mut.sourceKey && shield.ExpireAt == mut.expireAt
		}
		if !paired || mut.providerRef == "" || mut.definitionRef != definition.ProviderKey || mut.contributions.Len() != 0 {
			return false
		}
		sc.projectProviderList()
		instance := effectpkg.Provider{ProviderRef: mut.providerRef, DefinitionRef: definition.ProviderKey, DefinitionIndex: index,
			Source: mut.sourceKey, Owner: owner, Stacks: 1, ExpireAt: mut.expireAt, State: effectpkg.ObjectState(map[string]interface{}{})}
		sc.instances.AppendProvider(instance)
		f.mountStagedProviderModifiers(instance, definition)
		f.projectedLifecycles = append(f.projectedLifecycles, projectedProviderLifecycle{instance: instance,
			kind: model.EvidenceKindProviderApply, enqueueExpiry: mut.hasExpireAt})
	} else if mut.kind == "expire" {
		if oldIndex < 0 || old.Owner != owner || mut.strict && mut.definitionRef != "" && mut.definitionRef != old.DefinitionRef {
			return false
		}
		sc.projectProviderList()
		sc.instances.RemoveProvider(oldIndex)
		f.unmountStagedProviderModifiers(owner, old.ProviderRef)
		sc.providerState.Remove(old.ProviderRef)
		kept := sc.instances.Shields().Slice(0, 0)
		for instanceIndex, instanceValues := 0, sc.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			shield := instanceValues.At(instanceIndex)
			if shield.LifecycleProviderRef != old.ProviderRef {
				kept = kept.Append(shield)
			}
		}
		sc.instances.SetShields(kept)
		kind := mut.evidenceKind
		if kind == "" {
			kind = model.EvidenceKindProviderRemove
		}
		f.projectedLifecycles = append(f.projectedLifecycles, projectedProviderLifecycle{instance: old, kind: kind})
	} else {
		return false
	}
	mut.projected = true
	return true
}
