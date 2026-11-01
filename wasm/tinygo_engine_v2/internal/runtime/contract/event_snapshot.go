package contract

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// EventSnapshot 保存帧入口与事件发出时的有限冻结事实。
// event 参与者始终是原始 emittedEvent source/target，不随 listener owner-relative 重映射。
type EventSnapshot struct {
	DamageStateBefore    []DamageStateBefore
	DamageID             uint64
	ShieldAbsorptions    *pipeline.ShieldAbsorptionSnapshot
	HasUse               bool
	UseKey               string
	UseSource            string
	UseSkillKey          string
	HasUseContactCount   bool
	UseContactCount      int
	HasLink              bool
	LinkIndex            int
	LinkCount            int
	EventType            string
	EventSourceKey       string
	EventTargetKey       string
	EntrySourceAttrs     attribute.Table
	EntryTargetAttrs     attribute.Table
	EntrySourceResources model.ResourceView
	EntryTargetResources model.ResourceView
	SourceAttrs          attribute.Table
	TargetAttrs          attribute.Table
	SourceResources      model.ResourceView
	TargetResources      model.ResourceView
	HasDamageSnapshot    bool
	DamageSnapshot       formula.EventDamageSnapshot
	DamageTraits         []string
	DamageTypeKey        string
	CastInstanceID       uint64
	CastOrigin           string
	HasSkillHit          bool
	SkillHit             *SkillHitFacts
}
