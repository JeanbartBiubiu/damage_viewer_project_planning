package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (e *Executor) ProjectDynamic(input ProjectionInput) (bool, *model.EngineError) {
	input.changes = &input.State.changes
	changed := false
	for ownerIndex := range input.Owners {
		sc := &input.Owners[ownerIndex]
		owner := sc.Key
		if input.InitialRead {
			for instanceIndex, instanceValues := 0, sc.Instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
				inst := instanceValues.At(instanceIndex)
				if inst.Expired(input.Now) {
					p := e.compiled.Providers[inst.DefinitionIndex]
					if p.HasResourceMax || p.HasCooldownDuration || p.HasModifierSnapshots || p.AtomicLinkedShield {
						changed = true
					}
				}
			}
		}
		for i := range sc.Mutations {
			mut := &sc.Mutations[i]
			if mut.Projected {
				continue
			}
			var index uint16
			var exists bool
			var old effectpkg.Provider
			oldIndex := -1
			if mut.Kind == "apply" {
				index, exists = e.FindDefinition(mut.DefinitionRef)
			} else if mut.Kind == "shield_apply" {
				index, exists = mut.DefinitionIndex, int(mut.DefinitionIndex) < len(e.compiled.Providers)
			} else {
				old, oldIndex, exists = sc.Instances.Providers().Find(mut.ProviderRef)
				index = old.DefinitionIndex
			}
			if !exists || int(index) >= len(e.compiled.Providers) {
				if !exists && mut.Kind == "ensure_remaining" {
					mut.Projected = true
					continue
				}
				if !exists && mut.Kind == "expire" {
					if mut.Strict {
						return changed, e.fail(model.GenericErrUnknownRef, "providers", "expire_provider instance is missing", mut.ProviderRef)
					}
					mut.Projected = true
				}
				continue
			}
			p := e.compiled.Providers[index]
			handled, linkedErr := e.projectLinkedShield(&input, owner, sc, p, index, old, oldIndex, mut)
			if linkedErr != nil {
				return changed, linkedErr
			}
			if handled {
				changed, *sc.Dirty = true, true
				continue
			}
			if !p.AtomicDynamic {
				continue
			}
			if mut.Kind == "ensure_remaining" {
				if old.Source != mut.SourceKey || old.Owner != owner || old.DefinitionRef != mut.DefinitionRef {
					return changed, e.invariant("providers", "provider duration change has a foreign instance owner", old.ProviderRef)
				}
				mut.Projected = true
				if old.Expired(input.Now) || mut.ExpireAt <= old.ExpireAt {
					continue
				}
				sc.Instances.ProjectProviders()
				old.ExpireAt = mut.ExpireAt
				sc.Instances.ReplaceProvider(oldIndex, old)
				*input.changes = append(*input.changes, ProjectedChange{Instance: old, Kind: model.EvidenceKindProviderDurationChange, EnqueueExpiry: true})
				changed, *sc.Dirty = true, true
				continue
			}
			if mut.Kind != "expire" {
				if err := e.validateAttributeSlots(&input, owner, p); err != nil {
					return changed, err
				}
			}
			if mut.Kind != "apply" && mut.Kind != "refresh" && mut.Kind != "expire" {
				continue
			}
			if (p.HasResourceMax || p.HasCooldownDuration) && mut.Kind != "expire" && (mut.SourceKey != owner || mut.TargetKey != owner) {
				return changed, e.invariant("providers", "dynamic provider requires the actual source owner", p.ProviderKey)
			}
			sc.Instances.ProjectProviders()
			var snapshots map[string]float64
			if p.HasModifierSnapshots && mut.Kind != "expire" {
				var snapshotErr *model.EngineError
				snapshots, snapshotErr = e.FreezeModifierSnapshots(p, mut.SourceKey, owner, input.Reads.ApplicationContext(mut.SourceKey, owner))
				if snapshotErr != nil {
					return changed, snapshotErr
				}
			}
			reason := "apply"
			if mut.Kind == "apply" {
				for
				// One replacement has no observable removed intermediate instance.
				j, instanceValues := 0, sc.Instances.Providers(); j < instanceValues.Len(); j++ {
					inst := instanceValues.At(j)
					if inst.DefinitionIndex == index && inst.Source == mut.SourceKey && inst.Owner == owner && inst.Expired(input.Now) {
						*input.changes = append(*input.changes, ProjectedChange{Instance: inst, Kind: model.EvidenceKindProviderExpire})
						sc.Instances.RemoveProvider(j)
						unmountAttributes(&input, owner, inst.ProviderRef)
						sc.Bags.Remove(inst.ProviderRef)
						break
					}
				}
				if inst, j, found := sc.Instances.Providers().FindSourceTarget(p.ProviderKey, mut.SourceKey, owner, input.Now); found {
					old, oldIndex = inst, j
					reason = "refresh"
				} else {
					oldIndex = -1
					old = effectpkg.Provider{ProviderRef: e.identities.NextProvider(p.ProviderKey), DefinitionRef: p.ProviderKey, DefinitionIndex: index, Source: mut.SourceKey, Owner: owner, Stacks: 1, State: effectpkg.ObjectState(map[string]interface{}{})}
				}
				mut.ProviderRef = old.ProviderRef
			} else if mut.Kind == "refresh" {
				reason = "refresh"
			} else {
				reason = "remove"
				if mut.EvidenceKind == model.EvidenceKindProviderExpire {
					reason = "expire"
				}
			}
			mut.Projected = true
			if mut.Kind == "expire" {
				sc.Instances.RemoveProvider(oldIndex)
				unmountAttributes(&input, owner, old.ProviderRef)
				sc.Bags.Remove(old.ProviderRef)
			} else {
				if p.HasModifierSnapshots {
					old.ModifierSnapshots = model.BorrowNumericView(snapshots)
					unmountAttributes(&input, owner, old.ProviderRef)
				}
				if mut.HasExpireAt {
					old.ExpireAt = mut.ExpireAt
				}
				if mut.UseRef != "" {
					old.ActivationUseRef = mut.UseRef
				}
				if oldIndex >= 0 {
					sc.Instances.ReplaceProvider(oldIndex, old)
				} else {
					sc.Instances.AppendProvider(old)
				}
				if oldIndex < 0 || p.HasModifierSnapshots {
					mountAttributes(&input, old, p)
				}
			}
			kind := model.EvidenceKindProviderApply
			if reason == "refresh" {
				kind = model.EvidenceKindProviderRefresh
			}
			if reason == "remove" {
				kind = model.EvidenceKindProviderRemove
			}
			if reason == "expire" {
				kind = model.EvidenceKindProviderExpire
			}
			*input.changes = append(*input.changes, ProjectedChange{Instance: old, Kind: kind, EnqueueExpiry: mut.Kind != "expire" && mut.HasExpireAt})
			if p.HasCooldownDuration && mut.Kind != "expire" {
				for _, mod := range p.Modifiers {
					for _, ref := range mod.CooldownTargets {
						if ref.CombatantKey != owner {
							return changed, e.invariant("affectedAbilityRefs", "cooldown duration target belongs to another actual owner", p.ProviderKey)
						}
					}
				}
			}
			for mi, mod := range p.Modifiers {
				if mod.Kind == "resource_max" {
					*sc.ResourceContributors = append(*sc.ResourceContributors, model.ResourceChangeContributor{Source: old.Source, ProviderRef: old.ProviderRef, DefinitionRef: p.ProviderKey, ModifierKey: p.Modifiers[mi].ModifierKey, Reason: reason, UseRef: old.ActivationUseRef})
				}
			}
			changed = true
			*sc.Dirty = true
		}
	}
	return changed, nil
}
