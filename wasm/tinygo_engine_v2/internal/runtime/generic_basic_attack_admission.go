package runtime

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *genericRunState) validateBasicAttackInitialSnapshot() *model.EngineError {
	if len(s.req.InitialSnapshot.Combatants) != 2 || len(s.compiled.Combatants) != 2 {
		return s.basicAttackErr("continuous attack requires exactly two compiled initial combatants", "initialSnapshot.combatants")
	}
	seen := map[string]bool{}
	for _, actor := range s.req.InitialSnapshot.Combatants {
		if seen[actor.Key] || (actor.Key != "source" && actor.Key != "target") {
			return s.basicAttackErr("unexpected or duplicate initial combatant", "initialSnapshot.combatants")
		}
		seen[actor.Key] = true
		found := false
		for _, definition := range s.compiled.Combatants {
			if actor.Key != definition.Key {
				continue
			}
			found = true
			if len(actor.Attributes) != len(definition.Attributes) || len(actor.Resources) != len(definition.Resources) {
				return s.basicAttackErr("initial numeric slots must come from this compiled input", "initialSnapshot.combatants")
			}
			for key, value := range definition.Attributes {
				if actual, ok := actor.Attributes[key]; !ok || actual != value {
					return s.basicAttackErr("initial attribute differs from the compiled input", "initialSnapshot.combatants.attributes."+key)
				}
			}
			for key, value := range definition.Resources {
				if actual, ok := actor.Resources[key]; !ok || actual != value {
					return s.basicAttackErr("initial resource differs from the compiled input", "initialSnapshot.combatants.resources."+key)
				}
			}
			if len(actor.Providers) != len(definition.ProviderMounts) {
				return s.basicAttackErr("initial mounts must exactly match the compiled selection", "initialSnapshot.combatants.providers")
			}
			seenMounts := map[string]bool{}
			for _, raw := range actor.Providers {
				matched := false
				for _, mount := range definition.ProviderMounts {
					if raw.ProviderRef == mount.ProviderRef && raw.DefinitionRef == s.compiled.Providers[mount.DefinitionIndex].ProviderKey {
						matched = true
						break
					}
				}
				if !matched || seenMounts[raw.ProviderRef] || raw.Source != actor.Key || raw.Owner != actor.Key || raw.Stacks != 1 || raw.ExpireAt != nil || len(raw.State)+len(raw.StatusContributions) != 0 {
					return s.basicAttackErr("initial providers must match the fresh single-layer selected mounts", "initialSnapshot.combatants.providers")
				}
				seenMounts[raw.ProviderRef] = true
			}
			hp := s.combatants[actor.Key].attributes.At("hp")
			if math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || hp.Max <= 0 || hp.Current < 0 || hp.Current > hp.Max || math.Abs(hp.Max-hp.Resolved) > 1e-9*math.Max(1, math.Abs(hp.Max)) {
				return s.basicAttackErr("initial HP maximum must equal the native equipped maximum and current HP must stay within it", "initialSnapshot.combatants.attributes.hp")
			}
		}
		if !found {
			return s.basicAttackErr("initial combatant is not compiled", "initialSnapshot.combatants")
		}
	}
	return nil
}

func (s *genericRunState) validateIdleBasicAttackProvider(provider planbundle.CompiledProvider, owner, ref string) *model.EngineError {
	fail := func() *model.EngineError {
		return s.basicAttackErr("idle opponent binding must contain its complete static basic attack and unique owner-start listener", "initialSnapshot.combatants.providers")
	}
	if provider.AbilityCount != 3 || len(provider.Processes) != 1 || provider.Lifecycle != nil || len(provider.Modifiers)+len(provider.StatusContributions) != 0 || !validBasicAttackAmmoProvider(provider) {
		return fail()
	}
	process := provider.Processes[0]
	if process.Cooldown == nil || !process.Cooldown.RoundPositiveMs || process.Cooldown.StartMoment.MomentType != "PROCESS_START" || len(process.Costs) != 0 {
		return fail()
	}
	for _, step := range process.Steps {
		if step.StepType != "IMMEDIATE" {
			return fail()
		}
	}
	for _, moment := range process.MomentOperations {
		if moment.Moment.MomentType != "PROCESS_START" {
			return fail()
		}
		for _, operation := range s.compiled.Operations[int(moment.OperationStart) : int(moment.OperationStart)+int(moment.OperationCount)] {
			if provider.AmmoBinding != nil && operation.Path == provider.AmmoBinding.ConsumptionPath {
				continue
			}
			if operation.Operation != model.OperationKindApplyAttackLink && operation.Operation != model.OperationKindApplyHitLink {
				return fail()
			}
		}
	}
	var start planbundle.CompiledAbility
	initialRef := ""
	starts, hits := 0, 0
	for _, ability := range s.compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if !ability.IsBasicAttack || ability.SkillKey != process.SkillKey || ability.Kind != "active" || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.TickSpec != nil {
			return fail()
		}
		if ability.ProcessControl != nil {
			if initialRef != "" || ability.ProcessControl.Action != "INITIAL" || !ability.ProcessControl.UseRefFromEvent || ability.ProcessControl.ProcessIndex != 0 || ability.OperationCount != 0 || ability.HasSkillHit {
				return fail()
			}
			initialRef = owner + ".provider[" + ref + "].ability[" + ability.AbilityKey + "]"
		} else if ability.HasSkillHit {
			if ability.OperationCount != 1 || s.compiled.Operations[ability.OperationStart].Operation != model.OperationKindResolveSkillHit {
				return fail()
			}
			hits++
		} else {
			if ability.OperationCount != 0 {
				return fail()
			}
			start = ability
			starts++
		}
	}
	if initialRef == "" || starts != 1 || hits != 1 {
		return fail()
	}
	startType, declared := s.compiled.RuntimeTypes.BasicAttackStart.Lookup()
	ownerType, ownerDeclared := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	start.TypeSet.Add(startType)
	listeners := 0
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != ref {
			continue
		}
		if !declared || !ownerDeclared || !listener.HasAbilityRef || normalizeAbilityRef(listener.AbilityRef, owner, opponentCombatantKey(owner)) != initialRef || listener.OperationCount != 0 || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || !listener.EventMatcher.RequiresAllType(startType) || !listener.EventMatcher.RequiresAllType(ownerType) || !s.listenerMatchesEvent(listener, emittedEvent{eventType: model.EventTypeBasicAttackStart, sourceKey: owner, targetKey: opponentCombatantKey(owner)}, start.TypeSet) {
			return fail()
		}
		listeners++
	}
	if listeners != 1 {
		return fail()
	}
	return nil
}
