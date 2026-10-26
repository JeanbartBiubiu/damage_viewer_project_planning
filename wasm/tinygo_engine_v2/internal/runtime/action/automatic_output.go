package action

import "tinygo_engine_v2/internal/model"

func (s *State) AutomaticWaiting(rule *AutomaticRuleView, reason string, related []string, at, now int64) (model.AutomaticSkillRecord, bool) {
	var next *int64
	if at > now {
		value := at
		next = &value
	}
	var waiting *model.AutomaticSkillWaiting
	if reason != "" {
		if related == nil {
			related = []string{}
		}
		waiting = &model.AutomaticSkillWaiting{Reason: reason, RelatedRuleKeys: related, NextCheckAtMs: next}
	}
	if sameAutomaticWaiting(rule.data.summary.Waiting, waiting) {
		return model.AutomaticSkillRecord{}, false
	}
	rule.data.summary.Waiting = waiting
	record := model.AutomaticSkillRecord{Kind: model.AutomaticRecordWaitChanged, RuleKey: rule.Plan().RuleKey(), NextCheckAtMs: next}
	if reason != "" {
		record.Reason = &reason
	}
	if len(related) != 0 {
		key := related[0]
		record.RelatedRuleKey = &key
	}
	return record, true
}

func sameAutomaticWaiting(a, b *model.AutomaticSkillWaiting) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Reason != b.Reason || len(a.RelatedRuleKeys) != len(b.RelatedRuleKeys) || (a.NextCheckAtMs == nil) != (b.NextCheckAtMs == nil) {
		return false
	}
	if a.NextCheckAtMs != nil && *a.NextCheckAtMs != *b.NextCheckAtMs {
		return false
	}
	for i, key := range a.RelatedRuleKeys {
		if key != b.RelatedRuleKeys[i] {
			return false
		}
	}
	return true
}

func (s *State) AutomaticSummary() (*model.AutomaticSkillSummary, *model.SkillUseSummary) {
	if !s.HasAutomatic() {
		return nil, nil
	}
	summary := &model.AutomaticSkillSummary{RuleCount: s.AutomaticCount(), Rules: []model.AutomaticSkillRuleSummary{}, Qualifications: []model.AutomaticSkillQualification{}}
	for _, r := range s.automatic.rules {
		d := r.data
		d.summary.InFlightCount = d.summary.StartedCount - d.summary.CompletedCount - d.summary.FailedCount
		summary.Rules = append(summary.Rules, r.Summary())
		summary.AttemptCount += d.summary.AttemptCount
		summary.StartedCount += d.summary.StartedCount
		summary.RejectedCount += d.summary.RejectedCount
		summary.AbortedBeforeStartCount += d.summary.AbortedBeforeStartCount
		summary.CompletedCount += d.summary.CompletedCount
		summary.FailedCount += d.summary.FailedCount
		summary.InFlightCount += d.summary.InFlightCount
		if d.predecessor != nil {
			summary.Qualifications = append(summary.Qualifications, r.Qualification())
		}
	}
	uses := &model.SkillUseSummary{}
	for _, a := range s.actionsByUse {
		u := a.data.uses
		uses.StartedCount += u.StartedCount
		uses.ReleasedCount += u.ReleasedCount
		uses.HitCount += u.HitCount
		uses.CompletedCount += u.CompletedCount
		uses.FailedCount += u.FailedCount
		uses.StepEnteredCount += u.StepEnteredCount
		uses.StepExecutedCount += u.StepExecutedCount
		uses.StepCompletedCount += u.StepCompletedCount
	}
	uses.InFlightCount = uses.StartedCount - uses.CompletedCount - uses.FailedCount
	return summary, uses
}
