package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// OpponentKey 返回当前一对一场景的实际对方；未知角色没有隐式对方。
func OpponentKey(owner string) string {
	switch owner {
	case model.SelectorSource:
		return model.SelectorTarget
	case model.SelectorTarget:
		return model.SelectorSource
	default:
		return ""
	}
}

// ModifierHost 按修正的目标路径确定实际挂载角色，保留自身和跨角色语义。
func ModifierHost(owner, target string) string {
	switch selector := pipeline.ModifierTargetCombatantSelector(target); selector {
	case "", model.SelectorSelf:
		return owner
	case model.SelectorOpponent:
		if opponent := OpponentKey(owner); opponent != "" {
			return opponent
		}
	case model.SelectorSource, model.SelectorTarget:
		return selector
	}
	return owner
}

func (e *Executor) validateAttributeSlots(input *ProjectionInput, owner string, definition plan.CompiledProvider) *model.EngineError {
	for _, modifier := range definition.Modifiers {
		if modifier.Kind != "attribute" {
			continue
		}
		key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		host := ModifierHost(owner, modifier.Target)
		if _, found := projectionAttributes(input.owner(host)).Lookup(key); !found {
			return e.fail(model.GenericErrMissingRequiredField, "combatants."+host+".attributes."+key, "dynamic provider requires its actual attribute slot", key)
		}
	}
	return nil
}

func mountAttributes(input *ProjectionInput, instance effectpkg.Provider, definition plan.CompiledProvider) {
	for _, modifier := range definition.Modifiers {
		if modifier.Kind != "attribute" {
			continue
		}
		host := input.owner(ModifierHost(instance.Owner, modifier.Target))
		if modifier.ValueReadMode == "APPLICATION_SNAPSHOT" {
			host.Instances.MountAttributeSnapshot(instance.Owner, instance.ProviderRef, modifier, instance.ModifierSnapshots.At(modifier.ModifierKey))
		} else {
			host.Instances.MountAttributeCompiled(instance.Owner, instance.ProviderRef, modifier)
		}
		*host.Dirty = true
	}
}

func unmountAttributes(input *ProjectionInput, owner, reference string) {
	for index := range input.Owners {
		host := &input.Owners[index]
		host.Instances.UnmountAttribute(owner, reference)
		*host.Dirty = true
	}
}
