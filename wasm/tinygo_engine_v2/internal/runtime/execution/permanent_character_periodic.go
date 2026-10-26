package execution

import (
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *Engine) validatePermanentCharacterPeriod(provider planbundle.CompiledProvider) *model.EngineError {
	fail := func() *model.EngineError {
		return s.basicAttackErr("permanent character period requires one complete owned pure opponent-damage tick", "initialSnapshot.combatants.providers")
	}
	if provider.Kind != "character" || provider.SkillKey == "" || provider.StableID == "" || provider.Lifecycle != nil || provider.AmmoBinding != nil ||
		provider.AbilityCount != 1 || len(provider.Processes)+len(provider.Modifiers)+len(provider.Listeners)+len(provider.StateFields)+len(provider.StatusContributions)+len(provider.TargetTimings) != 0 ||
		provider.HasStateOnExpire || provider.NeedsElapsedTime || provider.ShieldDefinitionRef != "" {
		return fail()
	}
	ability := s.compiled.Abilities[provider.AbilityStart]
	ts := ability.TickSpec
	if ability.Kind != "tick" || ability.SkillKey != provider.SkillKey || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil ||
		ability.HasCastCondition || ability.HasSkillHit || ability.IsBasicAttack || ability.OperationCount != 0 || ability.TargetExpirySpec != nil ||
		ts == nil || ts.IntervalMs <= 0 || ts.StartDelayMs != ts.IntervalMs || ts.ImmediateFirst || ts.PhasePolicy != "" ||
		ts.AnchorScope != "" || ts.AnchorStateKey != "" || ts.OnTickCount != 1 {
		return fail()
	}
	operation := s.compiled.Operations[ts.OnTickStart]
	if operation.Operation != "damage" || operation.Target != model.SelectorTarget || !operation.HasAmount || operation.Ref == "" ||
		operation.OwnerProviderIndex != int(ability.ProviderIndex) ||
		operation.HasCondition || operation.CritEligible || operation.HasCritFormula || operation.CopyableOnHit || operation.TargetMark != nil ||
		len(operation.VampOverrides) != 0 || operation.ResourceKey != "" || operation.AttributeKey != "" || operation.ValuePolicy != "" ||
		operation.HasAbilityRef || operation.ProviderRef != "" || operation.ProviderDefinitionRef != "" || operation.ShieldRef != "" || operation.EventType != "" ||
		operation.RepeatScope != "" || operation.RepeatCount != 0 || operation.RepeatTag != "" || operation.RepeatDelayMs != 0 ||
		operation.ProviderRefFromEvent || operation.HasShieldDuration {
		return fail()
	}
	return nil
}

// This gate is shared by mixed and no-basic-attack scenes. The private compiled
// flag never authorizes a restored or dynamically applied copy of the source.
func (s *Engine) initPermanentCharacterPeriods() *model.EngineError {
	if s.loop.StartMs() != 0 || s.loop.DurationMs() < 1 || s.loop.DurationMs() > 600000 || !s.req.StopPolicy.StopOnTargetDeathOrDefault() ||
		len(s.req.SkillUses)+len(s.req.AttackStartFacts)+len(s.req.SkillHitFacts)+len(s.req.ProcessCommandFacts)+
			len(s.req.InitialSnapshot.ProcessInstances)+len(s.req.InitialSnapshot.UseTriggerLedger) != 0 {
		return s.basicAttackErr("permanent character periods require a fresh bounded scene without external use facts", "initialSnapshot")
	}
	if err := s.validateBasicAttackInitialSnapshot(); err != nil {
		return err
	}
	for _, actor := range s.req.InitialSnapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 {
			return s.basicAttackErr("permanent character periods cannot restore previous runtime state", "initialSnapshot.combatants")
		}
		hp := s.combatantHp(actor.Key)
		if math.IsNaN(hp) || math.IsInf(hp, 0) || hp <= 0 || !s.combatantExists(opponentCombatantKey(actor.Key)) {
			return s.basicAttackErr("permanent character periods require two living actual opponents", "initialSnapshot.combatants")
		}
		for i, mount := range actor.Providers {
			var definition *planbundle.CompiledProvider
			for index := range s.compiled.Providers {
				if s.compiled.Providers[index].ProviderKey == mount.DefinitionRef {
					definition = &s.compiled.Providers[index]
					break
				}
			}
			if definition == nil || !definition.PermanentCharacterPeriod {
				continue
			}
			if err := s.validatePermanentCharacterPeriod(*definition); err != nil {
				return err
			}
			if mount.AppliedAtMs != nil || len(mount.ModifierSnapshots) != 0 {
				return s.basicAttackErr("permanent character periods require an untouched actual mount", "initialSnapshot.combatants.providers")
			}
			for _, previous := range actor.Providers[:i] {
				for _, other := range s.compiled.Providers {
					if previous.DefinitionRef == other.ProviderKey && other.StableID == definition.StableID {
						return s.basicAttackErr("duplicate permanent character period source", "initialSnapshot.combatants.providers")
					}
				}
			}
		}
	}
	for _, operation := range s.compiled.Operations {
		if s.referencesPermanentCharacterPeriod(operation.AbilityRefStr) {
			return s.basicAttackErr("permanent character tick cannot be controlled by another operation", operation.Path)
		}
		if operation.Operation == "apply_provider" {
			for _, provider := range s.compiled.Providers {
				if provider.PermanentCharacterPeriod && operation.ProviderDefinitionRef == provider.ProviderKey {
					return s.basicAttackErr("permanent character periods cannot be dynamically applied", operation.Path)
				}
			}
		}
		if operation.Operation == "refresh_provider" || operation.Operation == "expire_provider" {
			for _, actor := range s.compiled.Combatants {
				for _, mount := range actor.ProviderMounts {
					if mount.ProviderRef == operation.ProviderRef && s.compiled.Providers[mount.DefinitionIndex].PermanentCharacterPeriod {
						return s.basicAttackErr("permanent character period cannot be refreshed or expired by another operation", operation.Path)
					}
				}
			}
		}
	}
	for _, listener := range s.compiled.Listeners {
		if listener.HasAbilityRef && s.referencesPermanentCharacterPeriod(listener.AbilityRef) {
			return s.basicAttackErr("permanent character tick cannot be entered through a listener", "listeners.abilityRef")
		}
	}
	for _, entry := range s.req.DriverPlan.Entries {
		if s.referencesPermanentCharacterPeriod(entry.AbilityRef) {
			return s.basicAttackErr("permanent character periods are scheduled only by their actual mounted source", "driverPlan.entries")
		}
	}
	return nil
}

// Incoming author references may use either concrete or owner-relative actors.
// Check both legal 1v1 contexts once at admission, without a new tick-path lookup.
func (s *Engine) referencesPermanentCharacterPeriod(abilityRef string) bool {
	if abilityRef == "" {
		return false
	}
	for _, owner := range []string{model.SelectorSource, model.SelectorTarget} {
		ref := normalizeAbilityRef(abilityRef, owner, opponentCombatantKey(owner))
		if compiled, exists := s.compiled.AbilityRefIndex[ref]; exists && s.compiled.Providers[compiled.ProviderIndex].PermanentCharacterPeriod {
			return true
		}
	}
	return false
}
