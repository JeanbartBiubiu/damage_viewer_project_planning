package listener

import (
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

// UseEvent 是当前监听所需的有限真实事件身份，不复制完整事件或行动状态。
type UseEvent struct {
	EventType, Source, Target      string
	HasUse                         bool
	UseKey, UseSource, UseSkillKey string
}

// UseOrigin 仅在原事件不是内建真实使用事件时核对已接纳开始事件。
type UseOrigin[Event any] interface {
	// AcceptedListenerOrigin 查询已有行动的真实接纳事实，不创建使用或改变冷却。
	AcceptedListenerOrigin(event Event) bool
}

// ReserveUse 拥有监听的额度身份和目标重映射，借用唯一账及原真实来源核验。
func ReserveUse[Event any](ledger *usage.Ledger, definition planbundle.CompiledListener, facts UseEvent, event Event, origin UseOrigin[Event], identity Identity) (usage.Reservation, bool, *model.EngineError) {
	if !definition.HasOncePerUse {
		return usage.Reservation{}, false, nil
	}
	if definition.OwnerCombatantKey == "" || definition.OwnerProviderRef == "" {
		return usage.Reservation{}, false, listenerError(identity, model.GenericErrUnknownRef, "oncePerUse requires a mounted provider listener", definition.ListenerKey, definition.OncePerUseGroup)
	}
	if !facts.HasUse || strings.TrimSpace(facts.UseKey) == "" {
		return usage.Reservation{}, false, listenerError(identity, model.GenericErrMissingRequiredField, "oncePerUse requires a real use fact on the triggering event", "listeners["+definition.ListenerKey+"].oncePerUse", definition.OncePerUseGroup)
	}
	if !model.IsRealUseEvent(facts.EventType) && !origin.AcceptedListenerOrigin(event) {
		return usage.Reservation{}, false, listenerError(identity, model.GenericErrUnknownRef, "oncePerUse requires an engine-produced originating-use event", "listeners["+definition.ListenerKey+"].oncePerUse", facts.EventType)
	}
	key := usage.Key{Owner: definition.OwnerCombatantKey, ProviderRef: definition.OwnerProviderRef,
		GroupKey: definition.OncePerUseGroup, Scope: definition.OncePerUseScope, UseSource: facts.UseSource, UseKey: facts.UseKey}
	if definition.OncePerUseScope == model.OncePerUseScopeProviderTarget {
		key.Target = facts.Target
		if facts.EventType == model.EventTypeDamageTaken || facts.EventType == model.EventTypeBasicAttackReceived {
			_, key.Target = Combatants(facts.EventType, facts.Source, facts.Target, definition.OwnerCombatantKey)
		}
	}
	return ledger.Reserve(key, facts.UseSkillKey)
}

// FinishUse 在原成功边界提交；失败仅释放仍未提交的原凭据。
func FinishUse(ledger *usage.Ledger, reservation usage.Reservation, reserved, triggered bool) {
	if reserved && triggered {
		ledger.Commit(reservation)
	} else if reserved {
		ledger.Release(reservation)
	}
}
