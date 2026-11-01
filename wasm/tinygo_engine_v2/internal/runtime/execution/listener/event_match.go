package listener

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// EventMatchFacts 是父层在当前匹配点已核定的事实，不携带效果、命中或执行对象。
type EventMatchFacts struct {
	EventType, SourceKey, TargetKey string
	Types                           typeset.TypeSet
	MountLive                       bool
	HasBlockedHit                   bool
	ShieldOwner, ShieldProviderRef  string
}

// Matches 按当前挂载资格、原阻挡盾身份和拥有者相对类型判断监听是否匹配，不执行条件或操作。
func Matches(definition planbundle.CompiledListener, facts EventMatchFacts, bindings planbundle.RuntimeTypeBindings) bool {
	if !facts.MountLive {
		return false
	}
	if facts.EventType == model.EventTypeSpellShieldBlocked && facts.HasBlockedHit && definition.OwnerProviderRef != "" &&
		(definition.OwnerCombatantKey != facts.ShieldOwner || definition.OwnerProviderRef != facts.ShieldProviderRef) {
		return false
	}
	eventTypes := facts.Types
	if definition.OwnerCombatantKey != "" {
		eventTypes = ownerRelativeTypes(facts.Types, facts.SourceKey, definition.OwnerCombatantKey, bindings)
		if facts.TargetKey == definition.OwnerCombatantKey {
			if identity, declared := bindings.TargetOwner.Lookup(); declared {
				eventTypes.Add(identity)
			}
		}
	}
	return definition.EventMatcher.Match(eventTypes)
}

func ownerRelativeTypes(base typeset.TypeSet, eventSourceKey, ownerKey string, bindings planbundle.RuntimeTypeBindings) typeset.TypeSet {
	out := base
	relation := bindings.SourceOpponent
	if eventSourceKey == ownerKey {
		relation = bindings.SourceOwner
	}
	if id, ok := relation.Lookup(); ok {
		out.Add(id)
	}
	return out
}

// Combatants 保留初始化事件的原双方；其他拥有者监听沿既有规则重映射来源及目标。
func Combatants(eventType, eventSourceKey, eventTargetKey, ownerKey string) (sourceKey, targetKey string) {
	sourceKey = eventSourceKey
	targetKey = eventTargetKey
	if eventType == model.EventTypeSourceInitialized {
		return sourceKey, targetKey
	}
	if ownerKey != "" {
		sourceKey = ownerKey
		if targetKey == sourceKey {
			if sourceKey == model.SelectorSource {
				targetKey = model.SelectorTarget
			} else {
				targetKey = model.SelectorSource
			}
		}
	}
	return sourceKey, targetKey
}
