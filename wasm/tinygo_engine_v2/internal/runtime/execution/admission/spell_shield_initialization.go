package admission

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func ownedSpellShieldInitializer(input Input, parent planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads) bool {
	listener, found := input.Compiled.AdmissionFacts.SpellShieldInitializer(parent.ProviderKey)
	return found && listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == reference &&
		matchesInitialSpellShield(input, parent, listener, reads)
}

func ownedSpellShieldInitializationListener(input Input, listener planbundle.CompiledListener, reads InitialSourceReads) bool {
	if listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(input.Compiled.Abilities) {
		return false
	}
	index := input.Compiled.Abilities[listener.SourceAbilityIndex].ProviderIndex
	if int(index) >= len(input.Compiled.Providers) {
		return false
	}
	parent := input.Compiled.Providers[index]
	bound, found := input.Compiled.AdmissionFacts.SpellShieldInitializer(parent.ProviderKey)
	return found && bound == listener && matchesInitialSpellShield(input, parent, listener, reads)
}

func matchesInitialSpellShield(input Input, parent planbundle.CompiledProvider, listener planbundle.CompiledListener, reads InitialSourceReads) bool {
	owner, reference := listener.OwnerCombatantKey, listener.OwnerProviderRef
	initialized, _ := input.Compiled.RuntimeTypes.SourceInitialized.Lookup()
	var eventTypes typeset.TypeSet
	eventTypes.Add(initialized)
	if !reads.InitialListenerMatches(listener, model.EventTypeSourceInitialized, owner, owner, eventTypes) {
		return false
	}
	instance := reads.InitialProviderView(owner, reference)
	return instance.Present && instance.DefinitionRef == parent.ProviderKey && instance.Owner == owner &&
		instance.Source == owner && instance.Stacks == 1 && instance.ExpireAt == 0 && instance.StateCount == 0 &&
		instance.DefinitionIndex == input.Compiled.Abilities[listener.SourceAbilityIndex].ProviderIndex
}
