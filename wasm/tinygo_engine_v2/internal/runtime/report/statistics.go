package report

import (
	"math"
	"sort"
	"tinygo_engine_v2/internal/model"
)

// DamageFact 只携带已经提交的数值结果与归属身份。
type DamageFact struct {
	Owner, Source, Target, AbilityRef, OperationRef, DamageType, ProviderDefinitionRef string
	MitigatedAmount, ShieldAbsorbed, HPLoss, VampHealing                               float64
}

func (s *State) statFor(ref string) *abilityStatAcc {
	if s.abilityStats == nil {
		s.abilityStats = map[string]*abilityStatAcc{}
	}
	if value := s.abilityStats[ref]; value != nil {
		return value
	}
	value := &abilityStatAcc{abilityRef: ref}
	s.abilityStats[ref] = value
	return value
}

func (s *State) EnsureAbility(ref string) { s.statFor(ref) }
func (s *State) Attempt(ref string)       { s.totals.AbilityAttemptCount++; s.statFor(ref).attemptCount++ }
func (s *State) Skip(ref string)          { s.totals.AttemptSkippedCount++; s.statFor(ref).skipCount++ }
func (s *State) Cast(ref string)          { s.statFor(ref).castCount++ }

func (s *State) AbilityOutput(ref string, damage, healing float64) {
	value := s.statFor(ref)
	if damage != 0 {
		if value.damageDealt == nil {
			value.damageDealt = new(float64)
		}
		*value.damageDealt += damage
	}
	if healing != 0 {
		if value.healingDone == nil {
			value.healingDone = new(float64)
		}
		*value.healingDone += healing
	}
}

func (s *State) AbilityStats() []model.AbilityStat {
	out := make([]model.AbilityStat, 0, len(s.abilityStats))
	for _, value := range s.abilityStats {
		row := model.AbilityStat{AbilityRef: value.abilityRef, AttemptCount: value.attemptCount, CastCount: value.castCount, SkipCount: value.skipCount}
		if value.damageDealt != nil {
			amount := *value.damageDealt
			row.DamageDealt = &amount
		}
		if value.healingDone != nil {
			amount := *value.healingDone
			row.HealingDone = &amount
		}
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AbilityRef < out[j].AbilityRef })
	return out
}

func (s *State) RecordDamage(source, target string, amount float64, timeMs int64) {
	if amount <= 0 {
		return
	}
	if !s.sampling.Disabled {
		s.damageHistory = append(s.damageHistory, damageRecord{timeMs, source, target, amount})
	}
	if source == model.SelectorSource {
		s.totals.SourceDamageDealt += amount
	}
	if source == model.SelectorTarget {
		s.totals.TargetDamageDealt += amount
	}
	if target == model.SelectorSource {
		s.totals.SourceDamageTaken += amount
	}
	if target == model.SelectorTarget {
		s.totals.TargetDamageTaken += amount
	}
}

func (s *State) RecordOverheal(source string, amount float64) {
	if amount <= 0 {
		return
	}
	if source == model.SelectorSource {
		s.totals.SourceOverheal += amount
	}
	if source == model.SelectorTarget {
		s.totals.TargetOverheal += amount
	}
}

func (s *State) RecordCommittedDamage(fact DamageFact, detailed bool) bool {
	if fact.Source == model.SelectorSource {
		s.totals.SourceVampHealing += fact.VampHealing
	}
	if fact.Source == model.SelectorTarget {
		s.totals.TargetVampHealing += fact.VampHealing
	}
	if fact.Target == model.SelectorSource {
		s.totals.SourceHpLoss += fact.HPLoss
	}
	if fact.Target == model.SelectorTarget {
		s.totals.TargetHpLoss += fact.HPLoss
	}
	if s.damageBreakdownIndex == nil {
		s.damageBreakdownIndex = map[damageBreakdownKey]int{}
	}
	key := damageBreakdownKey{fact.Owner, fact.Source, fact.Target, fact.AbilityRef, fact.OperationRef, fact.DamageType, fact.ProviderDefinitionRef}
	index, ok := s.damageBreakdownIndex[key]
	if !ok {
		index = len(s.damageBreakdown)
		s.damageBreakdownIndex[key] = index
		s.damageBreakdown = append(s.damageBreakdown, model.DamageBreakdown{Owner: fact.Owner, Source: fact.Source, Target: fact.Target, AbilityRef: fact.AbilityRef, OperationRef: fact.OperationRef, DamageType: fact.DamageType, ProviderDefinitionRef: fact.ProviderDefinitionRef})
	}
	row := &s.damageBreakdown[index]
	row.DamageCount++
	row.PostDefenseDamage += fact.MitigatedAmount
	row.ShieldAbsorbed += fact.ShieldAbsorbed
	row.ActualHpLoss += fact.HPLoss
	row.OverkillDamage += math.Max(0, fact.MitigatedAmount-fact.ShieldAbsorbed-fact.HPLoss)
	s.damageRecordCount++
	return detailed && len(s.damageRecords) < s.maxDamageRecords
}

func (s *State) AppendDamageDetails(data map[string]interface{}) {
	s.damageRecords = append(s.damageRecords, data)
}

func (s *State) AddTargetMark(value model.TargetMarkSummary) {
	s.targetMarkSummary.ConsumedCount += value.ConsumedCount
	s.targetMarkSummary.AttackCount += value.AttackCount
	s.targetMarkSummary.SkillCount += value.SkillCount
	s.targetMarkSummary.DamageBlockedCount += value.DamageBlockedCount
}

func (s *State) TargetMarkSummary() model.TargetMarkSummary { return s.targetMarkSummary }
