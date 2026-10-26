package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func sameHealthMaximum(a, b float64) bool {
	return !math.IsNaN(a) && !math.IsInf(a, 0) && !math.IsNaN(b) && !math.IsInf(b, 0) && math.Abs(a-b) <= 1e-9*math.Max(1, math.Abs(b))
}

// Only actual selected static equipment may contribute to the cold HP anchor.
// Resolved is still the native equipped value here, before HP switches to Current.
func (s *Engine) permanentHealthAnchor(owner string) (float64, *model.EngineError) {
	c := s.combatants[owner]
	hp := c.attributesView().At("hp")
	anchor := hp.Base
	if math.IsNaN(anchor) || math.IsInf(anchor, 0) || anchor <= 0 {
		return 0, s.basicAttackErr("permanent health initialization requires finite positive natural base HP", "initialSnapshot.combatants.attributes.hp.base")
	}
	for _, mod := range s.compiled.RuleModifiers {
		if mod.Kind == "attribute" && pipeline.AttributeKeyFromModifierTarget(mod.Target) == "hp" {
			return 0, s.basicAttackErr("cold HP initialization does not admit rule HP corrections", "rules.modifiers")
		}
	}
	for _, derivation := range s.compiled.AttributeDerivations {
		if derivation.AttributeKey == "hp" {
			return 0, s.basicAttackErr("cold HP initialization does not admit HP derivations", derivation.Path)
		}
	}
	for _, actor := range s.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			provider := s.compiled.Providers[mount.DefinitionIndex]
			for _, mod := range provider.Modifiers {
				if mod.Kind != "attribute" || pipeline.AttributeKeyFromModifierTarget(mod.Target) != "hp" {
					continue
				}
				selector := pipeline.ModifierTargetCombatantSelector(mod.Target)
				if actor.Key != owner && (selector == "" || selector == model.SelectorSelf) {
					continue
				}
				if actor.Key != owner || (selector != "" && selector != model.SelectorSelf) || provider.Kind != "item" || provider.StableID == "" || provider.Lifecycle != nil || provider.AbilityCount != 0 || len(provider.Listeners) != 0 || mod.HasCondition || !mod.HasValue || mod.ValuePolicy != "add" || mod.Stage != "" {
					return 0, s.basicAttackErr("cold HP anchor only accepts actual own static equipment flat HP", "initialSnapshot.combatants.providers")
				}
				value, static := s.formulas.FoldStatic(mod.ValueProgram)
				if !static || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
					return 0, s.basicAttackErr("equipped HP contribution must be a finite nonnegative static add", "initialSnapshot.combatants.providers")
				}
				anchor += value
			}
		}
	}
	if !sameHealthMaximum(anchor, hp.Resolved) {
		return 0, s.basicAttackErr("native equipped HP does not match its independently verified static anchor", "initialSnapshot.combatants.attributes.hp")
	}
	return anchor, nil
}

func (s *Engine) initPermanentResourceMax() *model.EngineError {
	plans := s.compiled.PermanentResourceMax
	if len(plans) == 0 {
		return nil
	}
	if s.loop.StartMs() != 0 || len(s.req.InitialSnapshot.ProcessInstances)+len(s.req.InitialSnapshot.UseTriggerLedger) != 0 {
		return s.basicAttackErr("permanent HP requires a fresh unused time-zero scene", "initialSnapshot")
	}
	if err := s.validateInitialSelection(false); err != nil {
		return err
	}
	for _, actor := range s.req.InitialSnapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 || !sameHealthMaximum(actor.Attributes["hp"].Resolved, actor.Attributes["hp"].Max) {
			return s.basicAttackErr("permanent HP requires unused state and an explicit initial capacity", "initialSnapshot.combatants")
		}
	}
	var anchors, totals [2]float64
	for i, owner := range []string{"source", "target"} {
		anchor, err := s.permanentHealthAnchor(owner)
		if err != nil {
			return err
		}
		anchors[i], totals[i] = anchor, anchor
		for index, plan := range plans {
			if plan.Owner != owner {
				continue
			}
			for _, earlier := range plans[:index] {
				if earlier.Owner == owner && earlier.ProviderIndex == plan.ProviderIndex {
					return s.basicAttackErr("permanent HP initialization cannot install its single layer twice", "initialSnapshot.combatants.providers")
				}
			}
			if !s.processMounted(owner, plan.SourceProviderRef, uint16(s.compiled.Operations[plan.OperationIndex].OwnerProviderIndex)) {
				return s.basicAttackErr("permanent HP initializer is not actually mounted", "initialSnapshot.combatants.providers")
			}
			totals[i] += s.compiled.Providers[plan.ProviderIndex].Modifiers[0].StaticValue
		}
		hp := s.combatants[owner].attributesView().At("hp")
		if !sameHealthMaximum(totals[i], hp.Max) || totals[i] <= 0 || hp.Current < 0 || hp.Current > totals[i] {
			return s.basicAttackErr("initial HP must equal natural base plus real equipment and permanent contributions", "initialSnapshot.combatants.attributes.hp")
		}
	}
	// All raw selection and both capacities passed. Install every contribution atomically.
	for i, owner := range []string{"source", "target"} {
		c := s.combatants[owner]

		c.setHPMaxAnchor(anchors[i])
		contributions := []map[string]interface{}{}
		for _, plan := range plans {
			if plan.Owner != owner {
				continue
			}
			effect := s.compiled.Providers[plan.ProviderIndex]
			modifier, op := effect.Modifiers[0], s.compiled.Operations[plan.OperationIndex]
			ref := s.nextProviderRef(effect.ProviderKey)
			c.instances.AppendProvider(effectpkg.Provider{ProviderRef: ref, DefinitionRef: effect.ProviderKey, Source: owner, Owner: owner, Stacks: 1, DefinitionIndex: plan.ProviderIndex, State: effectpkg.ObjectState(map[string]interface{}{})})
			c.instances.SetResourceContributions(c.instances.ResourceContributions().Append(effectpkg.ResourceContribution{ProviderRef: ref, Source: owner, DefinitionIndex: plan.ProviderIndex, Value: modifier.StaticValue}))
			if s.detailedOutput() {
				contributions = append(contributions, map[string]interface{}{"owner": owner, "source": owner, "target": owner,
					"sourceProviderRef": plan.SourceProviderRef, "sourceDefinitionRef": plan.SourceDefinitionRef, "listenerKey": plan.ListenerKey,
					"opRef": op.Ref, "opPath": op.Path, "abilityRef": nil, "useRef": nil,
					"providerRef": ref, "definitionRef": effect.ProviderKey, "modifierKey": modifier.ModifierKey, "value": modifier.StaticValue})
			}
		}
		hp := c.attributesView().At("hp")
		hp.Max, hp.Resolved = totals[i], totals[i]

		c.setAttributes(c.attributesView().With("hp", hp))
		s.combatants[owner] = c
		if totals[i] != anchors[i] || len(contributions) != 0 || hasPermanentHealthOwner(plans, owner) {
			s.recordEvidenceLazy("resource_max_initialized", func() model.EvidenceItem {
				return model.EvidenceItem{TimeMs: 0, Kind: "resource_max_initialized", Ref: owner,
					Data: map[string]interface{}{"resourceKey": "hp", "owner": owner, "target": owner, "anchorMax": anchors[i], "permanentIncrease": totals[i] - anchors[i], "max": totals[i], "current": hp.Current, "contributions": contributions}}
			})
		}
	}
	return nil
}

func hasPermanentHealthOwner(plans []planbundle.CompiledPermanentResourceMax, owner string) bool {
	for _, p := range plans {
		if p.Owner == owner {
			return true
		}
	}
	return false
}

func (f *Frame) skipInstalledPermanentResourceMax(op planbundle.CompiledOperation) *model.EngineError {
	if f.run.initializationEventActive && f.run.loop.TimeMs() == 0 {
		for _, p := range f.run.compiled.PermanentResourceMax {
			if p.Owner == f.ownerCombatantKey && p.SourceProviderRef == f.ownerProviderRef && f.run.compiled.Operations[p.OperationIndex].Path == op.Path {
				return nil
			}
		}
	}
	return f.run.basicAttackErr("permanent HP operation is only consumed by its actual cold initializer", op.Path)
}
