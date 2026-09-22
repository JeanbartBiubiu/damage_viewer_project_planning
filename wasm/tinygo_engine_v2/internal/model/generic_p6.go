package model

// 第6项 authoring-p6-r3：同次使用限制、固定时间窗、前序伤害供值与普通攻击原生事件。

const (
	AbilityTypeBasicAttack = "ability/basic_attack"

	EventTypeBasicAttackHit   = "event/basic_attack_hit"
	EventTypeBasicAttackStart = "event/basic_attack_start"

	ProviderStateRefreshStartOnFirstWrite = "start_on_first_write"

	OncePerUseScopeProvider       = "provider"
	OncePerUseScopeProviderTarget = "provider_target"

	OutputKindPostDefenseDamage = VampPostDefense
	OutputKindShieldAbsorbed    = "SHIELD_ABSORBED"
	OutputKindActualHPLoss      = VampActualHPLoss

	MaxOncePerUseGroupKeyLen = 64
	MaxOutputRefLen          = 64
)

// OncePerUseLimit 是监听器共享的同次使用额度，全组共用，不含 listenerIndex。
type OncePerUseLimit struct {
	GroupKey string `json:"groupKey"`
	Scope    string `json:"scope"`
}

// AttackStartFact 把单次空 operations 的普通攻击开始 driver 映射到已声明 use。
type AttackStartFact struct {
	DriverEntryKey string `json:"driverEntryKey"`
	UseRef         string `json:"useRef"`
}

// UseTriggerLedgerEntry 是本 run 已消费的同次使用额度。历史 useKey 可以不在本 run skillUses。
type UseTriggerLedgerEntry struct {
	Owner       string  `json:"owner"`
	ProviderRef string  `json:"providerRef"`
	GroupKey    string  `json:"groupKey"`
	Scope       string  `json:"scope"`
	UseSource   string  `json:"useSource"`
	UseSkillKey string  `json:"useSkillKey"`
	UseKey      string  `json:"useKey"`
	Target      *string `json:"target"`
}

// ValidOncePerUseScope 是宿主映射后的合法范围。
var ValidOncePerUseScope = map[string]struct{}{
	OncePerUseScopeProvider:       {},
	OncePerUseScopeProviderTarget: {},
}

// ValidOperationOutputKind 是同帧伤害管道封闭口径。
var ValidOperationOutputKind = map[string]struct{}{
	OutputKindPostDefenseDamage: {},
	OutputKindShieldAbsorbed:    {},
	OutputKindActualHPLoss:      {},
}

// EngineProducedEventTypes 禁止 emit_event 伪造。
func EngineProducedEventTypes() map[string]struct{} {
	return map[string]struct{}{
		EventTypeSkillHit:           {},
		EventTypeSpellShieldBlocked: {},
		EventTypeBasicAttackHit:     {},
		EventTypeBasicAttackStart:   {},
	}
}

// IsEngineProducedEvent 报告 eventType 是否只能由引擎产生。
func IsEngineProducedEvent(eventType string) bool {
	_, ok := EngineProducedEventTypes()[eventType]
	return ok
}

// RealUseEventTypes 是 oncePerUse 允许的真实使用事件。
func IsRealUseEvent(eventType string) bool {
	switch eventType {
	case EventTypeSkillHit, EventTypeBasicAttackHit, EventTypeBasicAttackStart:
		return true
	default:
		return false
	}
}
