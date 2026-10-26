package report

import (
	"math"
	"tinygo_engine_v2/internal/model"
)

func (s *State) AppendAttack(record model.BasicAttackRecord, detailed bool) int {
	if !detailed || len(s.attackRecords) >= s.maxAttackRecords {
		return -1
	}
	index := len(s.attackRecords)
	s.attackRecords = append(s.attackRecords, record)
	return index
}
func (s *State) AttackRecordCount() int { return len(s.attackRecords) }
func (s *State) AttackStartAt(index int) (int64, bool) {
	if index < 0 || index >= len(s.attackRecords) {
		return 0, false
	}
	return s.attackRecords[index].StartAtMs, true
}

func (s *State) SetAttackActionReadyAt(index int, readyAt *int64) {
	if index >= 0 && index < len(s.attackRecords) {
		s.attackRecords[index].ActionReadyAtMs = readyAt
	}
}
func (s *State) ReplaceAttackRecord(index int, row model.BasicAttackRecord) {
	if index >= 0 && index < len(s.attackRecords) {
		s.attackRecords[index] = row
	}
}

func (s *State) RecordMechanic(row model.MechanicRecord, detailed bool) {
	s.mechanicRecordCount++
	if detailed && len(s.mechanicRecords) < s.maxMechanicRecords {
		s.mechanicRecords = append(s.mechanicRecords, row)
	}
}
func (s *State) RecordSkillAction(row model.SkillActionRecord, detailed bool) {
	s.skillActionRecordCount++
	if detailed && len(s.skillActionRecords) < s.maxSkillActionRecords {
		s.skillActionRecords = append(s.skillActionRecords, row)
	}
}
func (s *State) BeginSkillUse(detailed bool) bool {
	s.skillUseRecordCount++
	return detailed && len(s.skillUseRecords) < s.maxSkillUseRecords
}
func (s *State) AppendSkillUse(row model.SkillUseRecord) {
	s.skillUseRecords = append(s.skillUseRecords, row)
}

func (s *State) RecordDirectHealing(row model.DirectHealingRecord, detailed bool) {
	if row.Target == model.SelectorSource {
		s.totals.SourceDirectHealing += row.ActualHealing
	}
	if row.Target == model.SelectorTarget {
		s.totals.TargetDirectHealing += row.ActualHealing
	}
	s.healingRecordCount++
	if detailed && len(s.healingRecords) < s.maxHealingRecords {
		s.healingRecords = append(s.healingRecords, row)
	}
}

func (s *State) RecordResourceChange(row model.ResourceChangeRecord, detailed bool) {
	s.resourceChangeSummary.ChangeCount++
	totals := &s.resourceChangeSummary.Source
	if row.Target == model.SelectorTarget {
		totals = &s.resourceChangeSummary.Target
	}
	totals.CurrentIncrease += math.Max(0, row.CurrentDelta)
	totals.CurrentDecrease += math.Max(0, -row.CurrentDelta)
	totals.MaxIncrease += math.Max(0, row.MaxDelta)
	totals.MaxDecrease += math.Max(0, -row.MaxDelta)
	if detailed && len(s.resourceChangeRecords) < s.maxResourceChangeRecords {
		s.resourceChangeRecords = append(s.resourceChangeRecords, row)
	}
}

func (s *State) ResourceSummary(sourceMax, targetMax float64) *model.ResourceChangeSummary {
	if s.resourceChangeSummary == nil {
		return nil
	}
	out := *s.resourceChangeSummary
	out.Source.FinalMax, out.Target.FinalMax = sourceMax, targetMax
	return &out
}

func (s *State) RecordAutomatic(row model.AutomaticSkillRecord, timeMs int64, detailed bool) {
	s.automaticRecordCount++
	row.Sequence, row.TimeMs = int64(s.automaticRecordCount), timeMs
	if detailed && len(s.automaticRecords) < s.maxAutomaticRecords {
		s.automaticRecords = append(s.automaticRecords, row)
	}
}
func (s *State) AutomaticRecording(detailed bool) *model.AutomaticSkillRecording {
	out := &model.AutomaticSkillRecording{TotalCount: s.automaticRecordCount, ReturnedCount: len(s.automaticRecords)}
	if !detailed {
		out.OmittedCount = s.automaticRecordCount
	} else {
		out.DroppedCount = s.automaticRecordCount - len(s.automaticRecords)
		out.Truncated = out.DroppedCount > 0
	}
	return out
}

func (s *State) Recording(attacks int, detailed bool) model.RecordingSummary {
	mechanicsKept := RetainedRecordCount(s.mechanicRecordCount, len(s.mechanicRecords), s.maxMechanicRecords, detailed)
	attacksKept := RetainedRecordCount(attacks, len(s.attackRecords), s.maxAttackRecords, detailed)
	damagesKept := RetainedRecordCount(s.damageRecordCount, len(s.damageRecords), s.maxDamageRecords, detailed)
	out := model.RecordingSummary{MechanicRecordCount: s.mechanicRecordCount, ReturnedMechanicRecords: len(s.mechanicRecords), DroppedMechanicRecords: s.mechanicRecordCount - mechanicsKept, MechanicRecordsTruncated: s.mechanicRecordCount > mechanicsKept, AttackRecordCount: attacks, ReturnedAttackRecords: len(s.attackRecords), DroppedAttackRecords: attacks - attacksKept, AttackRecordsTruncated: attacks > attacksKept, DamageRecordCount: s.damageRecordCount, ReturnedDamageRecords: len(s.damageRecords), DroppedDamageRecords: s.damageRecordCount - damagesKept, DamageRecordsTruncated: s.damageRecordCount > damagesKept}
	out.SkillActionRecordCount, out.ReturnedSkillActionRecords = s.skillActionRecordCount, len(s.skillActionRecords)
	out.DroppedSkillActionRecords = out.SkillActionRecordCount - RetainedRecordCount(out.SkillActionRecordCount, out.ReturnedSkillActionRecords, s.maxSkillActionRecords, detailed)
	out.SkillActionRecordsTruncated = out.DroppedSkillActionRecords > 0
	out.SkillUseRecordCount, out.ReturnedSkillUseRecords = s.skillUseRecordCount, len(s.skillUseRecords)
	out.DroppedSkillUseRecords = out.SkillUseRecordCount - RetainedRecordCount(out.SkillUseRecordCount, out.ReturnedSkillUseRecords, s.maxSkillUseRecords, detailed)
	out.SkillUseRecordsTruncated = out.DroppedSkillUseRecords > 0
	out.HealingRecordCount, out.ReturnedHealingRecords = s.healingRecordCount, len(s.healingRecords)
	out.DroppedHealingRecords = out.HealingRecordCount - RetainedRecordCount(out.HealingRecordCount, out.ReturnedHealingRecords, s.maxHealingRecords, detailed)
	out.HealingRecordsTruncated = out.DroppedHealingRecords > 0
	if s.resourceChangeSummary != nil {
		count, returned := s.resourceChangeSummary.ChangeCount, len(s.resourceChangeRecords)
		kept := RetainedRecordCount(count, returned, s.maxResourceChangeRecords, detailed)
		dropped, truncated := count-kept, count > kept
		out.ResourceChangeRecordCount, out.ReturnedResourceChangeRecords = &count, &returned
		out.DroppedResourceChangeRecords, out.ResourceChangeRecordsTruncated = &dropped, &truncated
	}
	return out
}
