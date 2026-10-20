package runtime

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/status"
)

type projectedProviderLifecycle struct {
	instance      status.ProviderInstance
	kind          model.EvidenceKind
	enqueueExpiry bool
}

func (f *executionFrame) commitProjectedProviderLifecycles() {
	for _, change := range f.projectedLifecycles {
		inst := change.instance
		if change.enqueueExpiry && inst.ExpireAt > 0 {
			f.run.enqueueExpireCleanup(inst.ExpireAt, expireCleanupPayload{combatantKey: inst.Owner, providerRef: inst.ProviderRef, kind: "provider"})
		}
		f.run.recordProviderLifecycleEvidence(change.kind, inst)
	}
}

func (sc *stagedCombatant) projectProviderList() {
	if sc.projectedProviders {
		return
	}
	sc.projectedProviders = true
	sc.baseProviders = sc.providers
	sc.providers = append([]status.ProviderInstance(nil), sc.providers...)
}

func (f *executionFrame) flushDynamicProviders() {
	if f.fatal || f.committed || f.flushingDynamicProviders || (!f.run.compiled.HasResourceMax && !f.run.compiled.HasCooldownDuration && !f.run.compiled.HasProviderDurationChange) {
		return
	}
	if f.dynamicExpiryChecked && !f.dynamicProviderDirty {
		return
	}
	f.flushingDynamicProviders = true
	defer func() { f.flushingDynamicProviders = false }()
	initialRead := !f.dynamicExpiryChecked
	changed := false
	for _, owner := range []string{"source", "target"} {
		sc := f.stageFor(owner)
		if !f.dynamicExpiryChecked {
			for _, inst := range sc.providers {
				if inst.Expired(f.run.nowMs) {
					p := f.run.compiled.Providers[inst.DefinitionIndex]
					if p.HasResourceMax || p.HasCooldownDuration {
						changed = true
					}
				}
			}
		}
		for i := range sc.providerOps {
			mut := &sc.providerOps[i]
			if mut.projected {
				continue
			}
			var index uint16
			var exists bool
			var old status.ProviderInstance
			oldIndex := -1
			if mut.kind == "apply" {
				index, exists = f.run.findProviderDefinitionIndex(mut.definitionRef)
			} else if mut.kind == "shield_apply" {
				index, exists = mut.definitionIndex, int(mut.definitionIndex) < len(f.run.compiled.Providers)
			} else {
				old, oldIndex, exists = status.FindByRef(sc.providers, mut.providerRef)
				index = old.DefinitionIndex
			}
			if !exists || int(index) >= len(f.run.compiled.Providers) {
				if !exists && mut.kind == "ensure_remaining" {
					mut.projected = true
					continue
				}
				if !exists && mut.kind == "expire" {
					if mut.strict {
						f.fatal = true
						f.fatalErr = f.providerLifecycleError(model.GenericErrUnknownRef, "providers", "expire_provider instance is missing", mut.providerRef)
						return
					}
					mut.projected = true
				}
				continue
			}
			p := f.run.compiled.Providers[index]
			if f.projectDurationLinkedShield(owner, sc, p, index, old, oldIndex, mut) {
				changed, sc.dirty = true, true
				continue
			}
			if !p.AtomicDynamic {
				continue
			}
			if mut.kind == "ensure_remaining" {
				if old.Source != mut.sourceKey || old.Owner != owner || old.DefinitionRef != mut.definitionRef {
					f.fatal = true
					f.fatalErr = f.run.processErr("providers", "provider duration change has a foreign instance owner", old.ProviderRef)
					return
				}
				mut.projected = true
				if old.Expired(f.run.nowMs) || mut.expireAt <= old.ExpireAt {
					continue
				}
				sc.projectProviderList()
				old.ExpireAt = mut.expireAt
				sc.providers[oldIndex] = old
				f.projectedLifecycles = append(f.projectedLifecycles, projectedProviderLifecycle{instance: old, kind: model.EvidenceKindProviderDurationChange, enqueueExpiry: true})
				changed, sc.dirty = true, true
				continue
			}
			if mut.kind != "expire" {
				for _, mod := range p.Modifiers {
					if mod.Kind == "attribute" {
						key := mod.Target[len("self.attr."):]
						if _, found := sc.attributes.Lookup(key); !found {
							f.fatal = true
							f.fatalErr = f.providerLifecycleError(model.GenericErrMissingRequiredField, "combatants."+owner+".attributes."+key, "dynamic provider requires its actual attribute slot", key)
							return
						}
					}
				}
			}
			if mut.kind != "apply" && mut.kind != "refresh" && mut.kind != "expire" {
				continue
			}
			if (p.HasResourceMax || p.HasCooldownDuration) && mut.kind != "expire" && (mut.sourceKey != owner || mut.targetKey != owner) {
				f.fatal = true
				f.fatalErr = f.run.processErr("providers", "dynamic provider requires the actual source owner", p.ProviderKey)
				return
			}
			sc.projectProviderList()
			reason := "apply"
			if mut.kind == "apply" {
				// One replacement has no observable removed intermediate instance.
				for j, inst := range sc.providers {
					if inst.DefinitionIndex == index && inst.Source == mut.sourceKey && inst.Owner == owner && inst.Expired(f.run.nowMs) {
						f.projectedLifecycles = append(f.projectedLifecycles, projectedProviderLifecycle{instance: inst, kind: model.EvidenceKindProviderExpire})
						sc.providers = append(sc.providers[:j], sc.providers[j+1:]...)
						sc.resolver.UnmountProviderOwned(owner, inst.ProviderRef)
						delete(sc.writableProviderStates(), inst.ProviderRef)
						break
					}
				}
				if inst, j, found := findSourceTargetProvider(sc.providers, p.ProviderKey, mut.sourceKey, owner, f.run.nowMs); found {
					old, oldIndex = inst, j
					reason = "refresh"
				} else {
					oldIndex = -1
					old = status.ProviderInstance{ProviderRef: f.run.nextProviderRef(p.ProviderKey), DefinitionRef: p.ProviderKey, DefinitionIndex: index, Source: mut.sourceKey, Owner: owner, Stacks: 1, State: map[string]interface{}{}}
				}
				mut.providerRef = old.ProviderRef
			} else if mut.kind == "refresh" {
				reason = "refresh"
			} else {
				reason = "remove"
				if mut.evidenceKind == model.EvidenceKindProviderExpire {
					reason = "expire"
				}
			}
			mut.projected = true
			if mut.kind == "expire" {
				sc.providers = append(sc.providers[:oldIndex], sc.providers[oldIndex+1:]...)
				sc.resolver.UnmountProviderOwned(owner, old.ProviderRef)
				delete(sc.writableProviderStates(), old.ProviderRef)
			} else {
				if mut.hasExpireAt {
					old.ExpireAt = mut.expireAt
				}
				if mut.useRef != "" {
					old.ActivationUseRef = mut.useRef
				}
				if oldIndex >= 0 {
					sc.providers[oldIndex] = old
				} else {
					sc.providers = append(sc.providers, old)
					for _, mod := range p.Modifiers {
						if mod.Kind == "attribute" {
							sc.resolver.MountCompiledModifierOwned(owner, old.ProviderRef, mod)
						}
					}
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
			f.projectedLifecycles = append(f.projectedLifecycles, projectedProviderLifecycle{instance: old, kind: kind, enqueueExpiry: mut.kind != "expire" && mut.hasExpireAt})
			if p.HasCooldownDuration && mut.kind != "expire" {
				for _, mod := range p.Modifiers {
					for _, ref := range mod.CooldownTargets {
						if ref.CombatantKey != owner {
							f.fatal = true
							f.fatalErr = f.run.processErr("affectedAbilityRefs", "cooldown duration target belongs to another actual owner", p.ProviderKey)
							return
						}
					}
				}
			}
			for mi, mod := range p.Modifiers {
				if mod.Kind == "resource_max" {
					sc.resourceBatchContributors = append(sc.resourceBatchContributors, f.resourceContributor(resourceMaxContribution{old.ProviderRef, old.Source, old.ActivationUseRef, index, uint16(mi), mod.StaticValue}, reason))
				}
			}
			changed = true
			sc.dirty = true
		}
	}
	f.dynamicExpiryChecked = true
	f.dynamicProviderDirty = false
	if !changed {
		return
	}
	for _, owner := range []string{"source", "target"} {
		sc := f.stageFor(owner)
		f.settleResourceMax(owner, sc.resourceBatchContributors)
		sc.resourceBatchContributors = nil
	}
	if !f.fatal {
		f.reResolveStagedAttributesTwoPass(plan.CompiledAbility{})
		if initialRead {
			f.captureEntrySnapshots()
		}
	}
}

func (f *executionFrame) cooldownDurationFactor(p *processRuntime) (float64, *model.EngineError) {
	if !f.run.compiled.HasCooldownDuration {
		return 1, nil
	}
	f.flushDynamicProviders()
	if f.fatal {
		return 0, f.fatalErr
	}
	product := 1.0
	for _, inst := range f.stageFor(p.Owner).providers {
		if inst.Expired(f.run.nowMs) {
			continue
		}
		provider := f.run.compiled.Providers[inst.DefinitionIndex]
		if !provider.HasCooldownDuration {
			continue
		}
		for _, mod := range provider.Modifiers {
			if mod.Kind != "cooldown_duration" {
				continue
			}
			for _, ref := range mod.CooldownTargets {
				if ref.CombatantKey == p.Owner && ref.ProviderRef == p.ProviderRef && ref.ProviderIndex == p.ability.ProviderIndex && int(ref.AbilityIndex) == p.definition.InitialAbilityIndex {
					product *= mod.StaticValue
					break
				}
			}
		}
	}
	return product, nil
}
