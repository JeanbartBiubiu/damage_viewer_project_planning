// Package report owns committed output, retention budgets and observation cursors.
// It consumes values and never schedules or changes combat state.
package report

import "tinygo_engine_v2/internal/model"

type Totals struct {
	SourceDamageDealt, SourceDamageTaken, TargetDamageDealt, TargetDamageTaken     float64
	SourceHpLoss, TargetHpLoss, SourceOverheal, TargetOverheal                     float64
	SourceVampHealing, TargetVampHealing, SourceDirectHealing, TargetDirectHealing float64
	AbilityAttemptCount, AttemptSkippedCount                                       int
}

type abilityStatAcc struct {
	abilityRef                         string
	attemptCount, castCount, skipCount int
	damageDealt, healingDone           *float64
}

type damageRecord struct {
	timeMs               int64
	sourceKey, targetKey string
	amount               float64
}

type damageBreakdownKey struct{ owner, source, target, ability, operation, damageType, definition string }

type State struct {
	totals                                                          Totals
	abilityStats                                                    map[string]*abilityStatAcc
	damageHistory                                                   []damageRecord
	targetMarkSummary                                               model.TargetMarkSummary
	resourceChangeRecords                                           []model.ResourceChangeRecord
	resourceChangeSummary                                           *model.ResourceChangeSummary
	maxResourceChangeRecords                                        int
	skillActionRecords                                              []model.SkillActionRecord
	skillUseRecords                                                 []model.SkillUseRecord
	healingRecords                                                  []model.DirectHealingRecord
	skillActionRecordCount, skillUseRecordCount, healingRecordCount int
	maxSkillActionRecords, maxSkillUseRecords, maxHealingRecords    int
	attackRecords                                                   []model.BasicAttackRecord
	mechanicRecords                                                 []model.MechanicRecord
	mechanicRecordCount, maxMechanicRecords                         int
	damageRecords                                                   []map[string]interface{}
	damageBreakdown                                                 []model.DamageBreakdown
	damageBreakdownIndex                                            map[damageBreakdownKey]int
	damageRecordCount, maxAttackRecords, maxDamageRecords           int
	evidence                                                        []model.EvidenceItem
	evidenceTruncated                                               bool
	truncatedEvidenceCount, evidenceRetainedCount                   int
	evidenceCountsByKind, evidenceRetainedByKind                    map[string]int
	series                                                          []model.SeriesPoint
	sampling                                                        model.SamplingConfig
	effectiveSampleEveryMs, nextSampleAtMs, startMs, durationMs     int64
	automaticRecords                                                []model.AutomaticSkillRecord
	automaticRecordCount, maxAutomaticRecords                       int
}

func (s *State) Totals() Totals { return s.totals }

func (s *State) InitBasicRecords(b *model.RecordBudget) bool {
	s.maxAttackRecords, s.maxDamageRecords = 1000, 2000
	s.attackRecords = []model.BasicAttackRecord{}
	s.mechanicRecords = []model.MechanicRecord{}
	s.damageRecords = []map[string]interface{}{}
	s.damageBreakdown = []model.DamageBreakdown{}
	if b != nil {
		if b.MaxMechanicRecords != nil {
			s.maxMechanicRecords = *b.MaxMechanicRecords
		}
		if b.MaxAttackRecords != nil {
			s.maxAttackRecords = *b.MaxAttackRecords
		}
		if b.MaxDamageRecords != nil {
			s.maxDamageRecords = *b.MaxDamageRecords
		}
	}
	return s.maxAttackRecords >= 0 && s.maxAttackRecords <= 4096 && s.maxDamageRecords >= 0 && s.maxDamageRecords <= 10000 && s.maxMechanicRecords >= 0 && s.maxMechanicRecords <= 10000
}

func (s *State) InitSkillRecords(b *model.RecordBudget) bool {
	s.skillActionRecords = []model.SkillActionRecord{}
	s.skillUseRecords = []model.SkillUseRecord{}
	s.healingRecords = []model.DirectHealingRecord{}
	s.maxSkillActionRecords, s.maxSkillUseRecords, s.maxHealingRecords = 1000, 2000, 2000
	if b != nil {
		if b.MaxSkillActionRecords != nil {
			s.maxSkillActionRecords = *b.MaxSkillActionRecords
		}
		if b.MaxSkillUseRecords != nil {
			s.maxSkillUseRecords = *b.MaxSkillUseRecords
		}
		if b.MaxHealingRecords != nil {
			s.maxHealingRecords = *b.MaxHealingRecords
		}
	}
	return s.maxSkillActionRecords >= 0 && s.maxSkillActionRecords <= 4096 && s.maxSkillUseRecords >= 0 && s.maxSkillUseRecords <= 10000 && s.maxHealingRecords >= 0 && s.maxHealingRecords <= 10000
}

func (s *State) InitResourceRecords(b *model.RecordBudget, enabled bool) bool {
	s.maxResourceChangeRecords = 1000
	if b != nil && b.MaxResourceChangeRecords != nil {
		s.maxResourceChangeRecords = *b.MaxResourceChangeRecords
	}
	if s.maxResourceChangeRecords < 0 || s.maxResourceChangeRecords > 10000 {
		return false
	}
	if enabled {
		s.resourceChangeSummary = &model.ResourceChangeSummary{}
		s.resourceChangeRecords = []model.ResourceChangeRecord{}
	}
	return true
}

func (s *State) InitAutomaticRecords(b *model.RecordBudget) bool {
	s.automaticRecords = []model.AutomaticSkillRecord{}
	s.maxAutomaticRecords = model.DefaultMaxAutomaticSkillRecords
	if b != nil && b.MaxAutomaticSkillRecords != nil {
		s.maxAutomaticRecords = *b.MaxAutomaticSkillRecords
	}
	return s.maxAutomaticRecords >= 0 && s.maxAutomaticRecords <= model.MaxAutomaticSkillRecords
}

func RetainedRecordCount(total, returned, limit int, detailed bool) int {
	if detailed {
		return returned
	}
	if total < limit {
		return total
	}
	return limit
}
