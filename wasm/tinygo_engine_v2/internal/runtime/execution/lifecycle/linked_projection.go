package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (e *Executor) canProjectDurationLinkedShield(p plan.CompiledProvider) bool {
	if p.AtomicLinkedShield {
		return true
	}
	return e.compiled.HasProviderDurationChange && !e.compiled.HasResourceMax && !e.compiled.HasCooldownDuration &&
		p.ShieldDefinitionRef != "" && p.Kind == "status" && p.TypeSet.Empty() && p.AbilityCount == 0 &&
		len(p.Modifiers)+len(p.Listeners)+len(p.StateFields)+len(p.Processes)+len(p.StatusContributions) == 0 &&
		p.AmmoBinding == nil && !p.NeedsElapsedTime && !p.HasResourceMax && !p.HasCooldownDuration &&
		(p.Lifecycle == nil || p.Lifecycle.MaxStacks == 1 && p.Lifecycle.RefreshPolicy == model.RefreshPolicyReplace && p.Lifecycle.TickIntervalMs == 0)
}

func (e *Executor) projectLinkedShield(input *ProjectionInput, owner string, sc *OwnerProjection, definition plan.CompiledProvider, index uint16,
	old effectpkg.Provider, oldIndex int, mut *Mutation) (bool, *model.EngineError) {
	if !e.canProjectDurationLinkedShield(definition) || mut.TargetKey != owner {
		return false, nil
	}
	if mut.Kind == "shield_apply" {
		if err := e.validateAttributeSlots(input, owner, definition); err != nil {
			return true, err
		}
	}
	if mut.Kind == "shield_apply" {
		// The shield operation has already assigned both fresh identities and
		// evaluated amount/duration in the original authored operation order.
		paired := false
		for instanceIndex, instanceValues := 0, sc.Instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			shield := instanceValues.At(instanceIndex)
			paired = paired || shield.LifecycleProviderRef == mut.ProviderRef && shield.DefinitionRef == definition.ShieldDefinitionRef &&
				shield.Owner == owner && shield.Source == mut.SourceKey && shield.ExpireAt == mut.ExpireAt
		}
		if !paired || mut.ProviderRef == "" || mut.DefinitionRef != definition.ProviderKey || mut.Contributions.Len() != 0 {
			return false, nil
		}
		sc.Instances.ProjectProviders()
		instance := effectpkg.Provider{ProviderRef: mut.ProviderRef, DefinitionRef: definition.ProviderKey, DefinitionIndex: index,
			Source: mut.SourceKey, Owner: owner, Stacks: 1, ExpireAt: mut.ExpireAt, State: effectpkg.ObjectState(map[string]interface{}{})}
		sc.Instances.AppendProvider(instance)
		mountAttributes(input, instance, definition)
		*input.changes = append(*input.changes, ProjectedChange{Instance: instance,
			Kind: model.EvidenceKindProviderApply, EnqueueExpiry: mut.HasExpireAt})
	} else if mut.Kind == "expire" {
		if oldIndex < 0 || old.Owner != owner || mut.Strict && mut.DefinitionRef != "" && mut.DefinitionRef != old.DefinitionRef {
			return false, nil
		}
		sc.Instances.ProjectProviders()
		sc.Instances.RemoveProvider(oldIndex)
		unmountAttributes(input, owner, old.ProviderRef)
		sc.Bags.Remove(old.ProviderRef)
		kept := sc.Instances.Shields().Slice(0, 0)
		for instanceIndex, instanceValues := 0, sc.Instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			shield := instanceValues.At(instanceIndex)
			if shield.LifecycleProviderRef != old.ProviderRef {
				kept = kept.Append(shield)
			}
		}
		sc.Instances.SetShields(kept)
		kind := mut.EvidenceKind
		if kind == "" {
			kind = model.EvidenceKindProviderRemove
		}
		*input.changes = append(*input.changes, ProjectedChange{Instance: old, Kind: kind})
	} else {
		return false, nil
	}
	mut.Projected = true
	return true, nil
}
