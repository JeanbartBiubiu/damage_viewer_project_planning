package hit

import (
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

// RuleOrigin 只借用规则准入所需的编译定义、原使用身份和当前来源挂载视图。
type RuleOrigin struct {
	Reference                               planbundle.CompiledAbilityRef
	HasReference                            bool
	Combatants                              []planbundle.CompiledCombatant
	Abilities                               []planbundle.CompiledAbility
	Providers                               []planbundle.CompiledProvider
	Operations                              []planbundle.CompiledOperation
	LiveProviders                           effectpkg.ProviderList
	EventType                               string
	HasUse                                  bool
	UseKey, UseSource, UseSkillKey          string
	TargetKey                               string
	KnownUse                                bool
	RegisteredUseSource, RegisteredSkillKey string
}

// RuleGrant 是命中已核定的共同额度身份，不借用监听定义或建立第二份账。
type RuleGrant struct {
	Key         usage.Key
	UseSkillKey string
}

// ruleQuota 核对真实技能命中、静态原挂载及原使用后，生成唯一共同额度所需的既有身份。
func ruleQuota(context *Context, group planbundle.CompiledSkillHitRuleGroup, origin RuleOrigin, identity Identity) (RuleGrant, *model.EngineError) {
	ref := origin.Reference
	parsed, parsedOK := planbundle.ParseAbilityRef(context.abilityRef)
	if origin.EventType != model.EventTypeSkillHit || context.ability.IsBasicAttack || !origin.HasReference || !parsedOK || int(ref.CombatantIndex) >= len(origin.Combatants) || int(ref.AbilityIndex) >= len(origin.Abilities) {
		return ruleQuotaError(identity, group, "rule group requires its actual engine-produced SKILL_HIT and parent ability")
	}
	actor := origin.Combatants[ref.CombatantIndex]
	if actor.Key != context.facts.SourceKey || parsed.Combatant != actor.Key {
		return ruleQuotaError(identity, group, "rule group parent must belong to the actual hit source")
	}
	ability := origin.Abilities[ref.AbilityIndex]
	mounted := false
	for _, mount := range actor.ProviderMounts {
		if mount.ProviderRef == parsed.ProviderRef && mount.DefinitionIndex == ref.ProviderIndex {
			mounted = true
			break
		}
	}
	if !mounted || int(ref.ProviderIndex) != context.plan.OwnerProviderIndex || ref.ProviderIndex != context.ability.ProviderIndex || ability.ProviderIndex != ref.ProviderIndex || parsed.AbilityKey != ability.AbilityKey || !ability.HasSkillHit || ability.OperationCount != 1 || int(ability.OperationStart) >= len(origin.Operations) || origin.Operations[ability.OperationStart].SkillHit != context.plan || !RuleMountLive(actor.Key, parsed.ProviderRef, ref.ProviderIndex, origin.Providers, origin.LiveProviders) {
		return ruleQuotaError(identity, group, "rule group requires its complete original static parent mount")
	}
	parent := origin.Providers[ref.ProviderIndex]
	if parent.Kind == "status" || parent.Lifecycle != nil {
		return ruleQuotaError(identity, group, "rule group parent must be static")
	}
	if !origin.HasUse || context.facts.UseRef == "" || origin.UseKey != context.facts.UseRef || origin.UseSource != actor.Key || origin.UseSkillKey != context.facts.SkillKey || !origin.KnownUse || origin.RegisteredUseSource != actor.Key || origin.RegisteredSkillKey != context.facts.SkillKey {
		return ruleQuotaError(identity, group, "rule group requires its actual declared originating skill use")
	}
	if actor.Key == "" || parsed.ProviderRef == "" {
		return RuleGrant{}, hitError(identity, model.GenericErrUnknownRef, "oncePerUse requires a mounted provider listener", group.RuleKey, group.OncePerUseGroup)
	}
	if strings.TrimSpace(origin.UseKey) == "" {
		return RuleGrant{}, hitError(identity, model.GenericErrMissingRequiredField, "oncePerUse requires a real use fact on the triggering event", "listeners["+group.RuleKey+"].oncePerUse", group.OncePerUseGroup)
	}
	key := usage.Key{Owner: actor.Key, ProviderRef: parsed.ProviderRef, GroupKey: group.OncePerUseGroup,
		Scope: group.OncePerUseScope, UseSource: origin.UseSource, UseKey: origin.UseKey}
	if group.OncePerUseScope == model.OncePerUseScopeProviderTarget {
		key.Target = origin.TargetKey
	}
	return RuleGrant{Key: key, UseSkillKey: origin.UseSkillKey}, nil
}

// RuleMountLive 核对实际静态挂载的完整身份、唯一性和永久期限，不仅检查定义存在。
func RuleMountLive(owner, provider string, definition uint16, definitions []planbundle.CompiledProvider, instances effectpkg.ProviderList) bool {
	if int(definition) >= len(definitions) {
		return false
	}
	found := false
	for index := 0; index < instances.Len(); index++ {
		instance := instances.At(index)
		if instance.ProviderRef != provider {
			continue
		}
		if found || instance.Owner != owner || instance.Source != owner || instance.DefinitionIndex != definition || instance.DefinitionRef != definitions[definition].ProviderKey || instance.ExpireAt != 0 {
			return false
		}
		found = true
	}
	return found
}

func ruleQuotaError(identity Identity, group planbundle.CompiledSkillHitRuleGroup, message string) (RuleGrant, *model.EngineError) {
	return RuleGrant{}, hitError(identity, model.GenericErrUnknownRef, message, group.Path, group.RuleKey)
}
