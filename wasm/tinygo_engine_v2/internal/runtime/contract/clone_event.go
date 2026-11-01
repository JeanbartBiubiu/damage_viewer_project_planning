package contract

// CloneEventSnapshot 复制原事件的有限快照，冻结类型切片；属性与资源页沿原不可变视图借用。
func CloneEventSnapshot(src *EventSnapshot) *EventSnapshot {
	if src == nil {
		return nil
	}
	cp := EventSnapshot{
		ShieldAbsorptions:    src.ShieldAbsorptions,
		HasUse:               src.HasUse,
		UseKey:               src.UseKey,
		UseSource:            src.UseSource,
		UseSkillKey:          src.UseSkillKey,
		HasUseContactCount:   src.HasUseContactCount,
		UseContactCount:      src.UseContactCount,
		HasLink:              src.HasLink,
		LinkIndex:            src.LinkIndex,
		LinkCount:            src.LinkCount,
		EventType:            src.EventType,
		EventSourceKey:       src.EventSourceKey,
		EventTargetKey:       src.EventTargetKey,
		EntrySourceAttrs:     src.EntrySourceAttrs,
		EntryTargetAttrs:     src.EntryTargetAttrs,
		EntrySourceResources: src.EntrySourceResources,
		EntryTargetResources: src.EntryTargetResources,
		SourceAttrs:          src.SourceAttrs,
		TargetAttrs:          src.TargetAttrs,
		SourceResources:      src.SourceResources,
		TargetResources:      src.TargetResources,
		HasDamageSnapshot:    src.HasDamageSnapshot,
		DamageSnapshot:       src.DamageSnapshot,
		DamageStateBefore:    src.DamageStateBefore, DamageID: src.DamageID,
		DamageTraits:   append([]string(nil), src.DamageTraits...),
		DamageTypeKey:  src.DamageTypeKey,
		CastInstanceID: src.CastInstanceID,
		CastOrigin:     src.CastOrigin,
		HasSkillHit:    src.HasSkillHit,
		SkillHit:       src.SkillHit,
	}
	return &cp
}
