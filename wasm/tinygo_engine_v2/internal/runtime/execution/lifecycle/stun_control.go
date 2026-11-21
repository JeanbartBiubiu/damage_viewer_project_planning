package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ActiveStunDeadline 从实际拥有方及原顺序暂存变更读取有限眩晕期限，不保留借用或发布状态。
func ActiveStunDeadline(owner string, now int64, providers []planbundle.CompiledProvider, instances effectpkg.ProviderList, mutations []Mutation) (int64, *model.EngineError) {
	failure := func(ref string) *model.EngineError {
		err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "action stun requires a valid actual owner and finite safe expiry")
		err.Path, err.Ref = "providers", ref
		return &err
	}
	until := int64(0)
	add := func(expiry int64, ref string, removed bool) *model.EngineError {
		if expiry <= 0 || expiry > maxJSONSafeInteger {
			return failure(ref)
		}
		if !removed && expiry > now && expiry > until {
			until = expiry
		}
		return nil
	}
	definition := func(ref string) (planbundle.CompiledProvider, bool) {
		for _, provider := range providers {
			if provider.ProviderKey == ref {
				return provider, true
			}
		}
		return planbundle.CompiledProvider{}, false
	}
	for index := 0; index < instances.Len(); index++ {
		instance := instances.At(index)
		if int(instance.DefinitionIndex) >= len(providers) || instance.Owner != owner || providers[instance.DefinitionIndex].ProviderKey != instance.DefinitionRef {
			return 0, failure(instance.ProviderRef)
		}
		provider := providers[instance.DefinitionIndex]
		if !provider.ActionStun {
			continue
		}
		// 同刻刷新可以延续刚到期的实际实例，存在性由最终期限判断。
		expiry, removed := instance.ExpireAt, false
		for _, mutation := range mutations {
			if mutation.Projected || mutation.TargetKey != owner {
				continue
			}
			if mutation.Kind == "expire" && mutation.ProviderRef == instance.ProviderRef {
				removed = true
			}
			if mutation.Kind == "refresh" && mutation.ProviderRef == instance.ProviderRef && mutation.HasExpireAt {
				expiry = mutation.ExpireAt
			}
			if mutation.Kind == "apply" && mutation.DefinitionRef == instance.DefinitionRef && mutation.SourceKey == instance.Source && provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
				removed = true // 新施加的最终期限在下面按真实变更加入。
			}
		}
		if !removed {
			if err := add(expiry, instance.ProviderRef, false); err != nil {
				return 0, err
			}
		}
	}
	for index, mutation := range mutations {
		if mutation.Projected || mutation.TargetKey != owner || mutation.Kind != "apply" {
			continue
		}
		provider, exists := definition(mutation.DefinitionRef)
		if !exists {
			return 0, failure(mutation.DefinitionRef)
		}
		if !provider.ActionStun {
			continue
		}
		replaced, removed := false, false
		if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
			for _, later := range mutations[index+1:] {
				if later.Projected || later.TargetKey != owner {
					continue
				}
				if later.Kind == "apply" && later.SourceKey == mutation.SourceKey && later.DefinitionRef == mutation.DefinitionRef {
					replaced = true
					break
				}
				if !removed && later.Kind == "expire" && later.ProviderRef != "" &&
					later.ProviderRef == reusedStunReference(instances, mutation, mutations[:index], now) {
					removed = true
				}
			}
		}
		if !replaced {
			if !mutation.HasExpireAt {
				return 0, failure(mutation.DefinitionRef)
			}
			// 移除只取消对等待的贡献。末次施加仍经过原期限校验。
			if err := add(mutation.ExpireAt, mutation.DefinitionRef, removed); err != nil {
				return 0, err
			}
		}
	}
	return until, nil
}

func reusedStunReference(instances effectpkg.ProviderList, application Mutation, earlier []Mutation, now int64) string {
	for index := 0; index < instances.Len(); index++ {
		instance := instances.At(index)
		if instance.DefinitionRef != application.DefinitionRef || instance.Source != application.SourceKey || instance.Owner != application.TargetKey {
			continue
		}
		present := true
		for _, previous := range earlier {
			if previous.Projected || previous.TargetKey != instance.Owner {
				continue
			}
			switch {
			case previous.Kind == "expire" && previous.ProviderRef == instance.ProviderRef:
				present = false
			case previous.Kind == "refresh" && previous.ProviderRef == instance.ProviderRef && previous.HasExpireAt:
				instance.ExpireAt = previous.ExpireAt
			case previous.Kind == "apply" && previous.DefinitionRef == instance.DefinitionRef && previous.SourceKey == instance.Source:
				if instance.Expired(now) {
					present = false
				} else if previous.HasExpireAt {
					instance.ExpireAt = previous.ExpireAt
				}
			}
			if !present {
				break
			}
		}
		if present && !instance.Expired(now) {
			return instance.ProviderRef
		}
	}
	return ""
}
