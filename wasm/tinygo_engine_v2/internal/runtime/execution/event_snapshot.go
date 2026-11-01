package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// eventFormulaSnapshot 保存父 frame entry 快照与 emit 当点 staged 深拷贝。
// event 参与者始终是原始 emittedEvent source/target，不随 listener owner-relative 重映射。
type eventFormulaSnapshot struct {
	damageStateBefore    []frozenDamageStateBefore
	damageID             uint64
	shieldAbsorptions    *pipeline.ShieldAbsorptionSnapshot
	hasUse               bool
	useKey               string
	useSource            string
	useSkillKey          string
	hasUseContactCount   bool
	useContactCount      int
	hasLink              bool
	linkIndex            int
	linkCount            int
	eventType            string
	eventSourceKey       string
	eventTargetKey       string
	entrySourceAttrs     attribute.Table
	entryTargetAttrs     attribute.Table
	entrySourceResources model.ResourceView
	entryTargetResources model.ResourceView
	sourceAttrs          attribute.Table
	targetAttrs          attribute.Table
	sourceResources      model.ResourceView
	targetResources      model.ResourceView
	hasDamageSnapshot    bool
	damageSnapshot       formula.EventDamageSnapshot
	damageTraits         []string
	damageTypeKey        string
	castInstanceID       uint64
	castOrigin           string
	hasSkillHit          bool
	skillHit             *frozenSkillHitContext
}

func (f *Frame) captureEmitSnapshot(eventType, eventSourceKey, eventTargetKey string) eventFormulaSnapshot {
	src := f.stageFor(eventSourceKey)
	tgt := f.stageFor(eventTargetKey)
	entrySrcAttrs, entrySrcRes := f.entryMapsForKey(eventSourceKey)
	entryTgtAttrs, entryTgtRes := f.entryMapsForKey(eventTargetKey)
	snap := eventFormulaSnapshot{
		eventType:            eventType,
		eventSourceKey:       eventSourceKey,
		eventTargetKey:       eventTargetKey,
		entrySourceAttrs:     entrySrcAttrs,
		entryTargetAttrs:     entryTgtAttrs,
		entrySourceResources: entrySrcRes,
		entryTargetResources: entryTgtRes,
		sourceAttrs:          src.attributesView(),
		targetAttrs:          tgt.attributesView(),
		sourceResources:      src.readonlyResources(),
		targetResources:      tgt.readonlyResources(),
		castInstanceID:       f.castInstanceID,
		castOrigin:           f.castOrigin,
	}
	if f.eventCtx != nil && f.eventCtx.hasSkillHit {
		snap.hasSkillHit = true
		snap.skillHit = f.eventCtx.skillHit
	}
	return snap
}

func cloneEventSnapshot(src *eventFormulaSnapshot) *eventFormulaSnapshot {
	if src == nil {
		return nil
	}
	cp := eventFormulaSnapshot{
		shieldAbsorptions:    src.shieldAbsorptions,
		hasUse:               src.hasUse,
		useKey:               src.useKey,
		useSource:            src.useSource,
		useSkillKey:          src.useSkillKey,
		hasUseContactCount:   src.hasUseContactCount,
		useContactCount:      src.useContactCount,
		hasLink:              src.hasLink,
		linkIndex:            src.linkIndex,
		linkCount:            src.linkCount,
		eventType:            src.eventType,
		eventSourceKey:       src.eventSourceKey,
		eventTargetKey:       src.eventTargetKey,
		entrySourceAttrs:     src.entrySourceAttrs,
		entryTargetAttrs:     src.entryTargetAttrs,
		entrySourceResources: src.entrySourceResources,
		entryTargetResources: src.entryTargetResources,
		sourceAttrs:          src.sourceAttrs,
		targetAttrs:          src.targetAttrs,
		sourceResources:      src.sourceResources,
		targetResources:      src.targetResources,
		hasDamageSnapshot:    src.hasDamageSnapshot,
		damageSnapshot:       src.damageSnapshot,
		damageStateBefore:    src.damageStateBefore, damageID: src.damageID,
		damageTraits:   append([]string(nil), src.damageTraits...),
		damageTypeKey:  src.damageTypeKey,
		castInstanceID: src.castInstanceID,
		castOrigin:     src.castOrigin,
		hasSkillHit:    src.hasSkillHit,
		skillHit:       src.skillHit,
	}
	return &cp
}
