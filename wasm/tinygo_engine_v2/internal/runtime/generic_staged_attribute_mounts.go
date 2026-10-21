package runtime

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/status"
)

func (f *executionFrame) validateStagedProviderAttributeSlots(owner string, definition plan.CompiledProvider) bool {
	for _, modifier := range definition.Modifiers {
		if modifier.Kind != "attribute" {
			continue
		}
		key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		host := modifierMountCombatantKey(owner, modifier.Target)
		if _, found := f.stageFor(host).attributes.Lookup(key); !found {
			f.fatal = true
			f.fatalErr = f.providerLifecycleError(model.GenericErrMissingRequiredField, "combatants."+host+".attributes."+key, "dynamic provider requires its actual attribute slot", key)
			return false
		}
	}
	return true
}

func (f *executionFrame) mountStagedProviderModifiers(instance status.ProviderInstance, definition plan.CompiledProvider) {
	for _, modifier := range definition.Modifiers {
		if modifier.Kind != "attribute" {
			continue
		}
		host := modifierMountCombatantKey(instance.Owner, modifier.Target)
		staged := f.stageFor(host)
		if modifier.ValueReadMode == "APPLICATION_SNAPSHOT" {
			staged.resolver.MountSnapshotModifierOwned(instance.Owner, instance.ProviderRef, modifier, instance.ModifierSnapshots[modifier.ModifierKey])
		} else {
			staged.resolver.MountCompiledModifierOwned(instance.Owner, instance.ProviderRef, modifier)
		}
		staged.dirty = true
	}
}

func (f *executionFrame) unmountStagedProviderModifiers(owner, reference string) {
	for _, key := range []string{"source", "target"} {
		staged := f.stageFor(key)
		staged.resolver.UnmountProviderOwned(owner, reference)
		staged.dirty = true
	}
}
