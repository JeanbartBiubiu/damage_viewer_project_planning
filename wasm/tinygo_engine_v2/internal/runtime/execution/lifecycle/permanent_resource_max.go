package lifecycle

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type InitialResourceOwner struct {
	Owner      string
	Attributes attribute.Table
	Providers  effectpkg.ProviderList
}

type PermanentResourcePlan struct {
	Owner         string
	Anchor, Total float64
}

type PermanentResourceInstallation struct {
	Contributors    []map[string]interface{}
	HasContribution bool
	Current         float64
}

func SameHealthMaximum(a, b float64) bool {
	return !math.IsNaN(a) && !math.IsInf(a, 0) && !math.IsNaN(b) && !math.IsInf(b, 0) && math.Abs(a-b) <= 1e-9*math.Max(1, math.Abs(b))
}

// Only actual selected static equipment may contribute to the cold HP anchor.
// Resolved is still the native equipped value here, before HP switches to Current.
func (e *Executor) PermanentHealthAnchor(owner string, attributes attribute.Table) (float64, *model.EngineError) {
	hp := attributes.At("hp")
	anchor := hp.Base
	if math.IsNaN(anchor) || math.IsInf(anchor, 0) || anchor <= 0 {
		return 0, e.invariant("initialSnapshot.combatants.attributes.hp.base", "permanent health initialization requires finite positive natural base HP", "")
	}
	for _, mod := range e.compiled.RuleModifiers {
		if mod.Kind == "attribute" && pipeline.AttributeKeyFromModifierTarget(mod.Target) == "hp" {
			return 0, e.invariant("rules.modifiers", "cold HP initialization does not admit rule HP corrections", "")
		}
	}
	for _, derivation := range e.compiled.AttributeDerivations {
		if derivation.AttributeKey == "hp" {
			return 0, e.invariant(derivation.Path, "cold HP initialization does not admit HP derivations", "")
		}
	}
	for _, actor := range e.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			provider := e.compiled.Providers[mount.DefinitionIndex]
			for _, mod := range provider.Modifiers {
				if mod.Kind != "attribute" || pipeline.AttributeKeyFromModifierTarget(mod.Target) != "hp" {
					continue
				}
				selector := pipeline.ModifierTargetCombatantSelector(mod.Target)
				if actor.Key != owner && (selector == "" || selector == model.SelectorSelf) {
					continue
				}
				if actor.Key != owner || (selector != "" && selector != model.SelectorSelf) || provider.Kind != "item" || provider.StableID == "" || provider.Lifecycle != nil || provider.AbilityCount != 0 || len(provider.Listeners) != 0 || mod.HasCondition || !mod.HasValue || mod.ValuePolicy != "add" || mod.Stage != "" {
					return 0, e.invariant("initialSnapshot.combatants.providers", "cold HP anchor only accepts actual own static equipment flat HP", "")
				}
				value, static := e.formulas.FoldStatic(mod.ValueProgram)
				if !static || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
					return 0, e.invariant("initialSnapshot.combatants.providers", "equipped HP contribution must be a finite nonnegative static add", "")
				}
				anchor += value
			}
		}
	}
	if !SameHealthMaximum(anchor, hp.Resolved) {
		return 0, e.invariant("initialSnapshot.combatants.attributes.hp", "native equipped HP does not match its independently verified static anchor", "")
	}
	return anchor, nil
}

func (e *Executor) ValidatePermanentResourceFresh(now int64, snapshot model.Snapshot) *model.EngineError {
	if now != 0 || len(snapshot.ProcessInstances)+len(snapshot.UseTriggerLedger) != 0 {
		return e.invariant("initialSnapshot", "permanent HP requires a fresh unused time-zero scene", "")
	}
	return nil
}

func (e *Executor) PreparePermanentResourceMax(snapshot model.Snapshot, owners [2]InitialResourceOwner, now int64) ([2]PermanentResourcePlan, *model.EngineError) {
	for _, owner := range snapshot.Combatants {
		if len(owner.Cooldowns)+len(owner.Shields)+len(owner.ProviderState)+len(owner.AbilityState)+len(owner.EffectiveStatuses)+len(owner.Vars) != 0 || !SameHealthMaximum(owner.Attributes["hp"].Resolved, owner.Attributes["hp"].Max) {
			return [2]PermanentResourcePlan{}, e.invariant("initialSnapshot.combatants", "permanent HP requires unused state and an explicit initial capacity", "")
		}
	}
	var prepared [2]PermanentResourcePlan
	for slot, owner := range owners {
		anchor, err := e.PermanentHealthAnchor(owner.Owner, owner.Attributes)
		if err != nil {
			return prepared, err
		}
		prepared[slot] = PermanentResourcePlan{Owner: owner.Owner, Anchor: anchor, Total: anchor}
		for index, item := range e.compiled.PermanentResourceMax {
			if item.Owner != owner.Owner {
				continue
			}
			for _, earlier := range e.compiled.PermanentResourceMax[:index] {
				if earlier.Owner == owner.Owner && earlier.ProviderIndex == item.ProviderIndex {
					return prepared, e.invariant("initialSnapshot.combatants.providers", "permanent HP initialization cannot install its single layer twice", "")
				}
			}
			expectedDefinition := e.compiled.Providers[e.compiled.Operations[item.OperationIndex].OwnerProviderIndex].ProviderKey
			mounted := false
			for i := 0; i < owner.Providers.Len(); i++ {
				instance := owner.Providers.At(i)
				if instance.ProviderRef == item.SourceProviderRef && instance.DefinitionRef == expectedDefinition && (instance.ExpireAt == 0 || instance.ExpireAt > now) {
					mounted = true
					break
				}
			}
			if !mounted {
				return prepared, e.invariant("initialSnapshot.combatants.providers", "permanent HP initializer is not actually mounted", "")
			}
			prepared[slot].Total += e.compiled.Providers[item.ProviderIndex].Modifiers[0].StaticValue
		}
		hp := owner.Attributes.At("hp")
		if !SameHealthMaximum(prepared[slot].Total, hp.Max) || prepared[slot].Total <= 0 || hp.Current < 0 || hp.Current > prepared[slot].Total {
			return prepared, e.invariant("initialSnapshot.combatants.attributes.hp", "initial HP must equal natural base plus real equipment and permanent contributions", "")
		}
	}
	return prepared, nil
}

func (e *Executor) InstallPermanentResourceMax(prepared PermanentResourcePlan, instances *effectpkg.InstanceState, numbers *actor.State, detailed bool) PermanentResourceInstallation {
	*numbers = numbers.WithHPMaxAnchor(prepared.Anchor)
	result := PermanentResourceInstallation{Contributors: []map[string]interface{}{}}
	for _, item := range e.compiled.PermanentResourceMax {
		if item.Owner != prepared.Owner {
			continue
		}
		result.HasContribution = true
		provider := e.compiled.Providers[item.ProviderIndex]
		modifier, operation := provider.Modifiers[0], e.compiled.Operations[item.OperationIndex]
		ref := e.identities.NextProvider(provider.ProviderKey)
		instances.AppendProvider(effectpkg.Provider{ProviderRef: ref, DefinitionRef: provider.ProviderKey, Source: prepared.Owner, Owner: prepared.Owner, Stacks: 1, DefinitionIndex: item.ProviderIndex, State: effectpkg.ObjectState(map[string]interface{}{})})
		instances.SetResourceContributions(instances.ResourceContributions().Append(effectpkg.ResourceContribution{ProviderRef: ref, Source: prepared.Owner, DefinitionIndex: item.ProviderIndex, Value: modifier.StaticValue}))
		if detailed {
			result.Contributors = append(result.Contributors, map[string]interface{}{"owner": prepared.Owner, "source": prepared.Owner, "target": prepared.Owner,
				"sourceProviderRef": item.SourceProviderRef, "sourceDefinitionRef": item.SourceDefinitionRef, "listenerKey": item.ListenerKey,
				"opRef": operation.Ref, "opPath": operation.Path, "abilityRef": nil, "useRef": nil,
				"providerRef": ref, "definitionRef": provider.ProviderKey, "modifierKey": modifier.ModifierKey, "value": modifier.StaticValue})
		}
	}
	hp := numbers.Attributes().At("hp")
	hp.Max, hp.Resolved = prepared.Total, prepared.Total
	*numbers = numbers.WithAttributes(numbers.Attributes().With("hp", hp))
	result.Current = hp.Current
	return result
}

func (e *Executor) PermanentOperationConsumed(op plan.CompiledOperation, owner, provider string, initialization bool, now int64) *model.EngineError {
	if initialization && now == 0 {
		for _, item := range e.compiled.PermanentResourceMax {
			if item.Owner == owner && item.SourceProviderRef == provider && e.compiled.Operations[item.OperationIndex].Path == op.Path {
				return nil
			}
		}
	}
	return e.invariant(op.Path, "permanent HP operation is only consumed by its actual cold initializer", "")
}

func HasPermanentHealthOwner(plans []plan.CompiledPermanentResourceMax, owner string) bool {
	for _, item := range plans {
		if item.Owner == owner {
			return true
		}
	}
	return false
}
