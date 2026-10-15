package compile

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/typeset"
)

// BindRuntimeTypes 只查已有完整目录；缺失引用保留原运行期检查。
func BindRuntimeTypes(registry typeset.Registry) plan.RuntimeTypeBindings {
	bind := func(domain, key string) plan.DeclaredType {
		id, declared := registry.LookupDomain(domain, key)
		return plan.DeclaredType{ID: id, Declared: declared}
	}
	return plan.RuntimeTypeBindings{
		BasicAttack:            bind("ability", "ability/basic_attack"),
		SpellShield:            bind("provider", model.ProviderTypeSpellShield),
		SourceInitialized:      bind("event", model.EventTypeSourceInitialized),
		AbilityStarted:         bind("event", "event/ability_started"),
		BasicAttackStart:       bind("event", model.EventTypeBasicAttackStart),
		BasicAttackHit:         bind("event", model.EventTypeBasicAttackHit),
		SkillHit:               bind("event", model.EventTypeSkillHit),
		DamageInstance:         bind("event", "event/damage_instance"),
		DamageDealt:            bind("event", "event/damage_dealt"),
		DamageDealtBasicAttack: bind("event", "event/damage_dealt/basic_attack"),
		BasicAttackReceived:    bind("event", model.EventTypeBasicAttackReceived),
		DamageTaken:            bind("event", model.EventTypeDamageTaken),
		AttackLinkApplied:      bind("event", model.EventTypeAttackLinkApplied),
		HitLinkApplied:         bind("event", model.EventTypeHitLinkApplied),
		SourceOwner:            bind("event", "event/source_owner"),
		SourceOpponent:         bind("event", "event/source_opponent"),
		TargetOwner:            bind("event", "event/target_owner"),
	}
}
