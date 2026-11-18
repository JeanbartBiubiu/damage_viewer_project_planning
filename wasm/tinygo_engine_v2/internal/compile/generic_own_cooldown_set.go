package compile

import (
	"math"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	plan "tinygo_engine_v2/internal/plan"
)

// 结束冷却只绑定实际同拥有者、同来源的唯一INITIAL；不要求该即时过程提前提交普通冷却。
func ownInitialCooldownTarget(operation plan.CompiledOperation, owner string, ctx *genericCompileContext) (*plan.CompiledCooldownDurationTarget, bool) {
	if operation.Operation != "cooldown_change" || operation.ValuePolicy != "set_remaining" || operation.Target != model.SelectorSelf ||
		!operation.HasAmount || !operation.HasAbilityRef || operation.HasCondition || operation.OwnerProviderIndex < 0 {
		return nil, false
	}
	parsed, valid := plan.ParseAbilityRef(operation.AbilityRefStr)
	if !valid || owner != model.SelectorSource || parsed.Combatant != owner && parsed.Combatant != model.SelectorSelf {
		return nil, false
	}
	ref, exists := ctx.session.AbilityRefIndex[owner+".provider["+parsed.ProviderRef+"].ability["+parsed.AbilityKey+"]"]
	if !exists || int(ref.ProviderIndex) != operation.OwnerProviderIndex {
		return nil, false
	}
	ability := ctx.session.Abilities[ref.AbilityIndex]
	provider := ctx.session.Providers[ref.ProviderIndex]
	if provider.Kind != "character" || provider.StableID == "" || provider.SkillKey == "" || provider.Lifecycle != nil ||
		ability.Kind != "active" || ability.IsBasicAttack || ability.HasSkillHit || ability.SkillKey != provider.SkillKey ||
		ability.ProcessControl == nil || ability.ProcessControl.Action != "INITIAL" || ability.ProcessControl.UseRefFromEvent {
		return nil, false
	}
	matched := 0
	for _, binding := range ctx.session.SkillActionBindings {
		if binding.Source == owner && binding.ProviderRef == parsed.ProviderRef && binding.ProviderDefinitionRef == provider.ProviderKey &&
			binding.SkillKey == provider.SkillKey && binding.InitialAbilityIndex == ref.AbilityIndex {
			matched++
		}
	}
	if matched != 1 || !ownedCooldownAmount(operation, ability, ctx) {
		return nil, false
	}
	return &plan.CompiledCooldownDurationTarget{CombatantKey: owner, ProviderRef: parsed.ProviderRef, ProviderIndex: ref.ProviderIndex, AbilityIndex: ref.AbilityIndex}, true
}

func ownedCooldownAmount(operation plan.CompiledOperation, ability plan.CompiledAbility, ctx *genericCompileContext) bool {
	if int(operation.AmountProgram) >= ctx.formulas.Count() {
		return false
	}
	if value, static := ctx.formulas.FoldStatic(operation.AmountProgram); static {
		return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
	}
	for _, read := range ctx.formulas.ReadDependencies(operation.AmountProgram) {
		switch read.ReadKind {
		case formula.ReadSourceAttr:
			key, _, _ := strings.Cut(read.ReadKey, ".")
			if key == "" || key == "hp" {
				return false
			}
			for _, actor := range ctx.session.Combatants {
				if actor.Key == model.SelectorSource {
					if _, resource := actor.Resources[key]; resource {
						return false
					}
				}
			}
		case formula.ReadAbilityParam:
			if value, present := ability.Params[read.ReadKey]; !present || math.IsNaN(value) || math.IsInf(value, 0) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func finalizeOwnedHitCooldownSets(ctx *genericCompileContext) {
	owner, hasOwner := ctx.session.RuntimeTypes.SourceOwner.Lookup()
	attack, hasAttack := ctx.session.RuntimeTypes.BasicAttackHit.Lookup()
	skill, hasSkill := ctx.session.RuntimeTypes.SkillHit.Lookup()
	for _, listener := range ctx.session.Listeners {
		if !hasOwner || !listener.EventMatcher.RequiresAllType(owner) ||
			!(hasAttack && listener.EventMatcher.RequiresAllType(attack) || hasSkill && listener.EventMatcher.RequiresAllType(skill)) {
			continue
		}
		for index := int(listener.OperationStart); index < int(listener.OperationStart)+int(listener.OperationCount); index++ {
			operation := &ctx.session.Operations[index]
			if operation.Operation != "cooldown_change" || operation.ValuePolicy != "set_remaining" {
				continue
			}
			target, valid := ownInitialCooldownTarget(*operation, listener.OwnerCombatantKey, ctx)
			if !valid {
				ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "hit cooldown set requires its owned actual INITIAL and only static or owned-attribute amount", operation.AbilityRefStr)
				continue
			}
			operation.OwnCooldownTarget = target
		}
	}
}

func finalizeCooldownStateExpiry(providerIndex int, ctx *genericCompileContext) {
	provider := &ctx.session.Providers[providerIndex]
	keys := make([]string, 0, len(provider.StateFields))
	for key := range provider.StateFields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		field := provider.StateFields[key]
		if field.OnExpireCount == 0 {
			continue
		}
		operation := &ctx.session.Operations[field.OnExpireStart]
		target, valid := ownInitialCooldownTarget(*operation, model.SelectorSource, ctx)
		if !field.OnExpireBeforeCombat || field.OnExpireCount != 1 || !valid {
			ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "cooldown expiry requires one complete owned INITIAL cooldown set and cannot mix shield expiry", key)
			continue
		}
		operation.OwnCooldownTarget = target
		field.OnExpireAbilityIndex = target.AbilityIndex
		provider.StateFields[key] = field
	}
	for _, operation := range ctx.session.Operations {
		if operation.ProviderDefinitionRef == provider.ProviderKey {
			ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "cooldown expiry source cannot be dynamically applied", provider.ProviderKey)
		}
		if operation.OwnerProviderIndex != providerIndex {
			continue
		}
		if field := provider.StateFields[operation.Ref]; field.OnExpireCount > 0 && operation.Operation == "state_change" {
			value, static := ctx.formulas.FoldStatic(operation.AmountProgram)
			if operation.StateScope != "state_scope/provider" || operation.Target != "self" || operation.HasCondition || !static ||
				(value != 0 && value != 1) || operation.ValuePolicy != "set" && operation.ValuePolicy != "override" {
				ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "cooldown expiry field requires own explicit zero-or-one writes", operation.Ref)
			}
		}
		if field := provider.StateFields[operation.Ref]; field.OnExpireCount > 0 && operation.Operation == model.OperationKindStateDurationChange {
			ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "cooldown expiry field cannot mutate remaining duration", operation.Ref)
		}
	}
	for _, actor := range ctx.session.Combatants {
		for _, mount := range actor.ProviderMounts {
			if int(mount.DefinitionIndex) == providerIndex && actor.Key != model.SelectorSource {
				ctx.collector.addError(model.GenericErrFormulaTypeError, "sharedProviders["+itoa(providerIndex)+"]", "cooldown expiry source must be mounted only on its actual action owner", provider.ProviderKey)
			}
		}
	}
}
