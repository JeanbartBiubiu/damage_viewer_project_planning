package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// MutationPreflight 是原预检位置取得的时刻与暂存生命事实，不携带队列或发布能力。
type MutationPreflight struct {
	Now, Stop         int64
	BasicAttack       bool
	ParticipantsAlive bool
}

func (e *Executor) ValidateProjectedMutations(projection *Projection, mutations []Mutation) *model.EngineError {
	if len(projection.changes) == 0 {
		return nil
	}
	for _, mutation := range mutations {
		if !mutation.Projected {
			return e.invariant("providers", "atomic dynamic provider batch cannot mix unsupported non-pure provider lifecycle operations", mutation.ProviderRef)
		}
	}
	return nil
}

func (e *Executor) PreflightOwner(instances effectpkg.InstanceChangeSet, mutations []Mutation, input MutationPreflight) (int, *model.EngineError) {
	base := instances.Providers()
	if instances.Projected() {
		base = instances.BaseProviders()
	}
	return e.PreflightMutations(base, mutations, input)
}

func (e *Executor) PreflightMutations(base effectpkg.ProviderList, mutations []Mutation, input MutationPreflight) (int, *model.EngineError) {
	if len(mutations) == 0 {
		return 0, nil
	}
	providers := effectpkg.ProviderList{}.AppendList(base)
	count := 0
	for _, mutation := range mutations {
		added, next, err := e.preflightMutation(providers, mutation, input)
		if err != nil {
			return 0, err
		}
		count += added
		providers = next
	}
	return count, nil
}

func (e *Executor) ProjectShieldCandidates(base effectpkg.ProviderList, mutations []Mutation, now int64) (effectpkg.ProviderList, *model.EngineError) {
	providers := base
	if len(mutations) != 0 {
		providers = effectpkg.ProviderList{}.AppendList(base)
	}
	for _, mutation := range mutations {
		// 新挂载只在提交后生效；现有实例的移除与刷新沿原序影响同组后续选盾。
		if mutation.Kind != "expire" && mutation.Kind != "refresh" {
			continue
		}
		_, next, err := e.preflightMutation(providers, mutation, MutationPreflight{Now: now})
		if err != nil {
			return effectpkg.ProviderList{}, err
		}
		providers = next
	}
	return providers, nil
}

func (e *Executor) preflightMutation(providers effectpkg.ProviderList, mutation Mutation, input MutationPreflight) (int, effectpkg.ProviderList, *model.EngineError) {
	badRef := func(message, ref string) (int, effectpkg.ProviderList, *model.EngineError) {
		return 0, providers, e.fail(model.GenericErrUnknownRef, "providers", message, ref)
	}
	if mutation.Kind == "apply" || mutation.Kind == "shield_apply" {
		defIndex, exists := mutation.DefinitionIndex, mutation.Kind == "shield_apply"
		if !exists {
			defIndex, exists = e.FindDefinition(mutation.DefinitionRef)
		}
		if !exists {
			return badRef("unknown provider definition", mutation.DefinitionRef)
		}
		definition := e.compiled.Providers[defIndex]
		if definition.PermanentResourceMax {
			return badRef("permanent HP instance is only installed by cold initialization", mutation.DefinitionRef)
		}
		if mutation.Kind != "shield_apply" && definition.Lifecycle != nil && definition.Lifecycle.AllowsSourceTargetReuse() {
			for i, instanceValues := 0, providers; i < instanceValues.Len(); i++ {
				inst := instanceValues.At(i)
				if inst.DefinitionRef == mutation.DefinitionRef && inst.Source == mutation.SourceKey && inst.Owner == mutation.TargetKey && inst.Expired(input.Now) {
					providers = providers.Slice(0, i).AppendList(providers.Slice(i+1, providers.Len()))
					break
				}
			}
			if inst, index, found := providers.FindSourceTarget(mutation.DefinitionRef, mutation.SourceKey, mutation.TargetKey, input.Now); found {
				added := 0
				if mutation.HasExpireAt {
					inst.ExpireAt = mutation.ExpireAt
					if mutation.ExpireAt > 0 {
						added++
					}
				}
				providers = providers.With(index, inst)
				return added, providers, nil
			}
		}
		expires := int64(0)
		if mutation.HasExpireAt {
			expires = mutation.ExpireAt
		}
		added := 0
		if expires > 0 {
			added++
		}
		tick, hasTick := FindTickAbility(definition, *e.compiled)
		if !hasTick || tick.TickSpec == nil || !tick.TickSpec.IsAnchored() {
			interval, delay, ok := e.TickSchedule(defIndex)
			if ok && interval > 0 && delay <= input.Stop-input.Now && input.ParticipantsAlive {
				first := input.Now + delay
				if input.BasicAttack || expires <= 0 || first < expires {
					added++
				}
			}
		}
		providers = providers.Append(effectpkg.Provider{ProviderRef: mutation.ProviderRef, DefinitionRef: mutation.DefinitionRef, DefinitionIndex: defIndex,
			Source: mutation.SourceKey, Owner: mutation.TargetKey, Stacks: 1, ExpireAt: expires})
		return added, providers, nil
	}
	inst, index, exists := providers.Find(mutation.ProviderRef)
	if exists && e.compiled.Providers[inst.DefinitionIndex].PermanentResourceMax {
		return badRef("permanent HP initialization instance cannot be changed in combat", mutation.ProviderRef)
	}
	if mutation.Kind == "ensure_remaining" {
		if !exists || inst.Expired(input.Now) {
			return 0, providers, nil
		}
		if inst.Owner != mutation.TargetKey || inst.Source != mutation.SourceKey || inst.DefinitionRef != mutation.DefinitionRef {
			return badRef("provider duration change has a foreign instance owner", mutation.ProviderRef)
		}
		if mutation.ExpireAt <= inst.ExpireAt {
			return 0, providers, nil
		}
		inst.ExpireAt = mutation.ExpireAt
		providers = providers.With(index, inst)
		return 1, providers, nil
	}
	if mutation.Kind == "expire" {
		if !exists {
			if mutation.Strict {
				return badRef("expire_provider instance is missing", mutation.ProviderRef)
			}
			return 0, providers, nil
		}
		if mutation.Strict && mutation.DefinitionRef != "" && mutation.DefinitionRef != inst.DefinitionRef {
			return badRef("expire_provider definitionRef mismatch", mutation.ProviderRef)
		}
		return 0, providers.Slice(0, index).AppendList(providers.Slice(index+1, providers.Len())), nil
	}
	if !exists {
		return badRef("unknown providerRef", mutation.ProviderRef)
	}
	definition := e.compiled.Providers[inst.DefinitionIndex]
	if definition.ShieldDefinitionRef != "" {
		return badRef("linked shield provider must be refreshed by applying its shield", mutation.ProviderRef)
	}
	policy := model.RefreshPolicyReplace
	if definition.Lifecycle != nil && definition.Lifecycle.RefreshPolicy != "" {
		policy = definition.Lifecycle.RefreshPolicy
	}
	if definition.Lifecycle != nil && definition.Lifecycle.AllowsSourceTargetReuse() {
		policy = model.RefreshPolicyReplace
	}
	added := 0
	switch policy {
	case "extend":
		if mutation.HasExpireAt && mutation.ExpireAt > inst.ExpireAt {
			inst.ExpireAt = mutation.ExpireAt
			added++
		}
	case "add_stack":
	default:
		if mutation.HasExpireAt {
			inst.ExpireAt = mutation.ExpireAt
			if mutation.ExpireAt > 0 {
				added++
			}
		}
	}
	providers = providers.With(index, inst)
	return added, providers, nil
}
