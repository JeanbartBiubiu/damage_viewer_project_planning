package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type ApplyDecision struct {
	DefinitionIndex uint16
	ExpiredRef      string
	Existing        effectpkg.Provider
	ExistingIndex   int
	Replace         bool
}

type RefreshDecision struct {
	Instance      effectpkg.Provider
	EnqueueExpiry bool
}

// EffectMountPair 只借用双方效果状态，不带行动、数值、报告或队列控制。
type EffectMountPair struct {
	Source, Target               *effectpkg.InstanceState
	SourcePresent, TargetPresent bool
}

func (e *Executor) DecideApplication(definition, source, owner string, instances effectpkg.ProviderList, now int64) (ApplyDecision, *model.EngineError) {
	index, exists := e.FindDefinition(definition)
	if !exists {
		return ApplyDecision{}, e.fail(model.GenericErrUnknownRef, "", "unknown provider definition: "+definition, "")
	}
	provider := e.compiled.Providers[index]
	if provider.ShieldDefinitionRef != "" {
		return ApplyDecision{}, e.invariant("providerDefinitionRef", "shield lifecycle provider can only be created by its shield", definition)
	}
	result := ApplyDecision{DefinitionIndex: index}
	if provider.Lifecycle == nil || !provider.Lifecycle.AllowsSourceTargetReuse() {
		return result, nil
	}
	for slot := 0; slot < instances.Len(); slot++ {
		instance := instances.At(slot)
		if instance.DefinitionRef == definition && instance.Source == source && instance.Owner == owner && instance.Expired(now) {
			result.ExpiredRef = instance.ProviderRef
			return result, nil
		}
	}
	result.Existing, result.ExistingIndex, result.Replace = instances.FindSourceTarget(definition, source, owner, now)
	return result, nil
}

func (e *Executor) FreshProvider(index uint16, reference, source, owner string, expiry, now int64, contributions effectpkg.ContributionView) effectpkg.Provider {
	provider := e.compiled.Providers[index]
	instance := effectpkg.Provider{ProviderRef: reference, DefinitionRef: provider.ProviderKey,
		Source: source, Owner: owner, Stacks: 1, ExpireAt: expiry,
		State: effectpkg.ObjectState(map[string]interface{}{}), DefinitionIndex: index, StatusContributions: contributions}
	if provider.NeedsElapsedTime {
		instance.AppliedAtMs, instance.HasAppliedAt = now, true
	}
	return instance
}

func (e *Executor) ReplaceProvider(instance effectpkg.Provider, expiry int64, hasExpiry bool, contributions effectpkg.ContributionView, now int64) RefreshDecision {
	if e.compiled.Providers[instance.DefinitionIndex].NeedsElapsedTime {
		instance.AppliedAtMs, instance.HasAppliedAt = now, true
	}
	if hasExpiry {
		instance.ExpireAt = expiry
	}
	if contributions.Present() {
		instance.StatusContributions = contributions
	}
	return RefreshDecision{Instance: instance, EnqueueExpiry: hasExpiry && expiry > 0}
}

func (e *Executor) RefreshProvider(instance effectpkg.Provider, expiry int64, hasExpiry bool, contributions effectpkg.ContributionView, now int64) (RefreshDecision, *model.EngineError) {
	provider := e.compiled.Providers[instance.DefinitionIndex]
	if provider.ShieldDefinitionRef != "" {
		return RefreshDecision{}, e.invariant("providerRef", "linked shield provider must be refreshed by applying its shield", instance.ProviderRef)
	}
	if provider.NeedsElapsedTime || provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
		return e.ReplaceProvider(instance, expiry, hasExpiry, contributions, now), nil
	}
	policy, maximum := model.RefreshPolicyReplace, 1
	if provider.Lifecycle != nil {
		if provider.Lifecycle.RefreshPolicy != "" {
			policy = provider.Lifecycle.RefreshPolicy
		}
		if provider.Lifecycle.MaxStacks > 0 {
			maximum = provider.Lifecycle.MaxStacks
		}
	}
	enqueue := false
	switch policy {
	case "extend":
		if hasExpiry && expiry > instance.ExpireAt {
			instance.ExpireAt, enqueue = expiry, true
		}
	case "add_stack":
		if instance.Stacks < maximum {
			instance.Stacks++
		}
	default:
		if hasExpiry {
			instance.ExpireAt, enqueue = expiry, expiry > 0
		}
		if instance.Stacks < maximum {
			instance.Stacks = maximum
		}
	}
	if contributions.Present() {
		instance.StatusContributions = contributions
	}
	return RefreshDecision{Instance: instance, EnqueueExpiry: enqueue}, nil
}

func (pair EffectMountPair) instance(key string) *effectpkg.InstanceState {
	switch key {
	case model.SelectorSource:
		if pair.SourcePresent {
			return pair.Source
		}
	case model.SelectorTarget:
		if pair.TargetPresent {
			return pair.Target
		}
	}
	return nil
}

func (e *Executor) MountProvider(pair EffectMountPair, owner string, instance effectpkg.Provider) {
	if int(instance.DefinitionIndex) >= len(e.compiled.Providers) {
		return
	}
	for _, modifier := range e.compiled.Providers[instance.DefinitionIndex].Modifiers {
		switch {
		case modifier.Kind == "pipeline":
			if host := pair.instance(owner); host != nil {
				host.MountDamageCompiled(owner, instance.ProviderRef, modifier)
			}
		case modifier.Kind == "attribute" || modifier.Kind == "":
			if host := pair.instance(ModifierHost(owner, modifier.Target)); host != nil {
				if modifier.ValueReadMode == "APPLICATION_SNAPSHOT" {
					host.MountAttributeSnapshot(owner, instance.ProviderRef, modifier, instance.ModifierSnapshots.At(modifier.ModifierKey))
				} else {
					host.MountAttributeCompiled(owner, instance.ProviderRef, modifier)
				}
			}
		}
	}
}

// UnmountProvider 按实际拥有者和实例身份卸载双方效果解析器，不更改角色数值。
func UnmountProvider(pair EffectMountPair, owner, reference string) {
	for _, host := range [2]*effectpkg.InstanceState{pair.instance(model.SelectorSource), pair.instance(model.SelectorTarget)} {
		if host != nil {
			host.UnmountAttribute(owner, reference)
			host.UnmountDamage(owner, reference)
		}
	}
}
