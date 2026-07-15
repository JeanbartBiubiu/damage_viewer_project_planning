package runtime

import (
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/status"
)

// opponentCombatantKey returns the 1v1 opponent of ownerKey.
func opponentCombatantKey(ownerKey string) string {
	switch ownerKey {
	case model.SelectorSource:
		return model.SelectorTarget
	case model.SelectorTarget:
		return model.SelectorSource
	default:
		return ""
	}
}

// modifierMountCombatantKey chooses which combatant resolver receives a provider modifier.
// Bare / self keys stay on the owner; opponent.attr.* mounts on the owner's opponent.
// Absolute source.attr.* / target.attr.* mount on that combatant key.
func modifierMountCombatantKey(ownerKey, modTarget string) string {
	selector := pipeline.ModifierTargetCombatantSelector(modTarget)
	switch selector {
	case "":
		return ownerKey
	case model.SelectorSelf:
		return ownerKey
	case model.SelectorOpponent:
		if opp := opponentCombatantKey(ownerKey); opp != "" {
			return opp
		}
		return ownerKey
	case model.SelectorSource, model.SelectorTarget:
		return selector
	default:
		return ownerKey
	}
}

// mountProviderModifiersAcross mounts each attribute modifier onto the combatant selected by
// its target path, carrying ownerCombatantKey + providerRef for formula provenance.
func mountProviderModifiersAcross(
	combatants map[string]combatantRuntime,
	ownerKey string,
	inst status.ProviderInstance,
	compiled compilebundle.CompiledSession,
) {
	if int(inst.DefinitionIndex) >= len(compiled.Providers) {
		return
	}
	provider := compiled.Providers[inst.DefinitionIndex]
	for _, mod := range provider.Modifiers {
		if mod.Kind != "attribute" && mod.Kind != "" {
			continue
		}
		mountKey := modifierMountCombatantKey(ownerKey, mod.Target)
		host, ok := combatants[mountKey]
		if !ok {
			continue
		}
		host.resolver.MountCompiledModifierOwned(ownerKey, inst.ProviderRef, mod)
		combatants[mountKey] = host
	}
}

// unmountProviderModifiersAcross removes mounts identified by ownerCombatantKey + providerRef
// from every combatant resolver (same-side and cross-combatant).
func unmountProviderModifiersAcross(combatants map[string]combatantRuntime, ownerKey, providerRef string) {
	for key, c := range combatants {
		c.resolver.UnmountProviderOwned(ownerKey, providerRef)
		combatants[key] = c
	}
}
