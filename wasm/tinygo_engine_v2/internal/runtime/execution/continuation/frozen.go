// Package continuation 承接可复制伤害、重复请求及仅在本场有效的续接执行。
package continuation

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

// FrozenDamage 保存原事件入口及已决定的暴击分支；共享消费集合只属于同次施放。
type FrozenDamage struct {
	RawAmount            float64
	DamageType           string
	SourceKey            string
	TargetKey            string
	ProviderRef          string
	OriginRef            string // abilityRef 或 listener:<key>
	OperationRef         string // op.Ref；有则写入 evidence / replayedFrom
	EntrySourceAttrs     attribute.Table
	EntryTargetAttrs     attribute.Table
	EntrySourceResources model.ResourceView
	EntryTargetResources model.ResourceView
	EventSourceKey       string
	EventTargetKey       string
	Crit                 contract.CritEvidence
	Ability              planbundle.CompiledAbility
	Operation            planbundle.CompiledOperation
	CastInstanceID       uint64
	CastOrigin           string
	ConsumedFirstPerCast map[string]bool
	OwnerCombatantKey    string
	EventCtx             *contract.EventSnapshot
}

// deferredRepeatRequest 登记 phantom replay 门槛；不立即执行。
type RepeatRequest struct {
	OwnerCombatantKey string
	OwnerProviderRef  string
	TriggerStateKey   string
	Threshold         float64
	RepeatCount       int
	RepeatScope       string
	RepeatTag         string
	RepeatDelayMs     int
}

// DefenseContext 从原事件入口准备共同防御读值；当前盾血仍由数值结算读取。
func DefenseContext(d FrozenDamage) formula.GenericEvalContext {
	return formula.GenericEvalContext{SourceAttrs: entryAttrsForCombatant(d, d.SourceKey), TargetAttrs: entryAttrsForCombatant(d, d.TargetKey), SourceResources: entryResourcesForCombatant(d, d.SourceKey), TargetResources: entryResourcesForCombatant(d, d.TargetKey), StrictReads: true}
}
func entryAttrsForCombatant(d FrozenDamage, combatantKey string) attribute.Table {
	// entry_* 对应原始 emitted event 的 source/target；damage target 可能经 owner remap。
	// 优先按 damage target 与 frame event keys 对齐；若无匹配则回退 entryTarget（常见 on-hit 受害方）。
	if combatantKey == d.EventTargetKey {
		return d.EntryTargetAttrs
	}
	if combatantKey == d.EventSourceKey {
		return d.EntrySourceAttrs
	}
	if d.EntryTargetAttrs.Len() > 0 {
		return d.EntryTargetAttrs
	}
	return d.EntrySourceAttrs
}

func entryResourcesForCombatant(d FrozenDamage, key string) model.ResourceView {
	if key == d.EventTargetKey {
		return d.EntryTargetResources
	}
	if key == d.EventSourceKey {
		return d.EntrySourceResources
	}
	if d.EntryTargetResources.Len() > 0 {
		return d.EntryTargetResources
	}
	return d.EntrySourceResources
}
