package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/plan"
)

func (f *Frame) validateStagedProviderAttributeSlots(owner string, definition plan.CompiledProvider) bool {
	for _, modifier := range definition.Modifiers {
		if modifier.Kind != "attribute" {
			continue
		}
		key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		host := modifierMountCombatantKey(owner, modifier.Target)
		if _, found := f.stageFor(host).attributesView().Lookup(key); !found {
			f.fatal = true
			f.fatalErr = f.providerLifecycleError(model.GenericErrMissingRequiredField, "combatants."+host+".attributes."+key, "dynamic provider requires its actual attribute slot", key)
			return false
		}
	}
	return true
}

func (f *Frame) mountStagedProviderModifiers(instance effectpkg.Provider, definition plan.CompiledProvider) {
	for _, modifier := range definition.Modifiers {
		if modifier.Kind != "attribute" {
			continue
		}
		host := modifierMountCombatantKey(instance.Owner, modifier.Target)
		staged := f.stageFor(host)
		if modifier.ValueReadMode == "APPLICATION_SNAPSHOT" {
			staged.instances.MountAttributeSnapshot(instance.Owner, instance.ProviderRef, modifier, instance.ModifierSnapshots.At(modifier.ModifierKey))
		} else {
			staged.instances.MountAttributeCompiled(instance.Owner, instance.ProviderRef, modifier)
		}
		staged.dirty = true
	}
}

func (f *Frame) unmountStagedProviderModifiers(owner, reference string) {
	for _, key := range []string{"source", "target"} {
		staged := f.stageFor(key)
		staged.instances.UnmountAttribute(owner, reference)
		staged.dirty = true
	}
}
