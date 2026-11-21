// 已提交事实的报告、采样及最终结果投影。
package execution

import (
	"strconv"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
)

// This hook sees only committed damage; retention limits never affect totals.
func (s *Engine) recordCommittedDamage(f *Frame, ev genericDamageEvidence) {
	if ev.Outcome == nil {
		return
	}
	s.actions.ObserveAttackDamage(ev.Source, ev.Target, ev.Outcome.MitigatedAmount, ev.Outcome.HPDamage, ev.HpBefore, ev.HpAfter, s.loop.TimeMs())
	if s.hasSkillPlan() && ev.Target == model.SelectorTarget && ev.HpBefore > 0 && ev.HpAfter <= 0 {
		s.actions.RecordSkillTargetKilled(s.loop.TimeMs())
	}
	vampHealing := 0.0
	if ev.HasSourceHp && s.automatedRun() {
		vampHealing = ev.SourceHpAfter - ev.SourceHpBefore
	}
	if !s.report.RecordCommittedDamage(reportpkg.DamageFact{Owner: ev.Owner, Source: ev.Source, Target: ev.Target, AbilityRef: ev.AbilityRef, OperationRef: ev.OperationRef, DamageType: ev.DamageType, ProviderDefinitionRef: ev.ProviderDefinitionRef, MitigatedAmount: ev.Outcome.MitigatedAmount, ShieldAbsorbed: ev.Outcome.ShieldAbsorbed, HPLoss: ev.Outcome.HPDamage, VampHealing: vampHealing}, s.detailedOutput()) {
		return
	}
	ownership := reportpkg.DamageDetailOwnership{SkillPlan: s.hasSkillPlan()}
	if ownership.SkillPlan {
		hit := f.skillHitOccurrenceID
		if hit == 0 && f.eventCtx != nil && f.eventCtx.SkillHit != nil {
			hit = f.eventCtx.SkillHit.OccurrenceID
		}
		if hit == 0 && f.activeProcess != nil {
			if origin, passive := f.activeProcess.PassiveOrigin(); passive {
				// 尾结果保留原命中归属，不重建或重新派发旧命中事件。
				hit = origin.HitOccurrenceID
			}
		}
		ownership.HitOccurrenceID = hit
	}
	if use := f.skillActionUseRef(); use != "" {
		ownership.UseRef = use
		if action := s.skillActionForUse(use); action != nil {
			ownership.InstructionKey, ownership.HasInstructionKey = action.Plan().InstructionKey(), true
		}
	}
	timeMs := s.loop.TimeMs()
	if s.actions.BasicAttack() != nil && s.actions.BasicAttack().Current() != nil && s.actions.AttackActive() {
		row := s.actions.BasicAttack().Current()
		ownership.UseRef, ownership.AttackIndex, ownership.HasAttackIndex = row.UseRef(), row.AttackIndex(), true
	}
	if ev.EmpoweredAttack != nil {
		ownership.UseRef = ev.ActivationUseRef
		if action := s.actions.ActionForUse(ev.ActivationUseRef); action != nil {
			ownership.InstructionKey, ownership.HasInstructionKey = action.Plan().InstructionKey(), true
		}
	}
	s.report.AppendDamageDetails(reportpkg.CommittedDamageDetails(ev, timeMs, ownership))
}

func (s *Engine) executionSummary() *model.RunExecutionSummary {
	if s.hasSkillPlan() && s.actions.BasicAttack() == nil {
		killedAt, killed := s.actions.SkillTargetKilledAt()
		var killedAtPtr *int64
		if killed {
			killedAtPtr = &killedAt
		}
		result := &model.RunExecutionSummary{RequestedDurationMs: s.loop.DurationMs(), Complete: s.budgetCause == "" && (s.loop.TimeMs() >= s.loop.StartMs()+s.loop.DurationMs() || s.loop.Reason() == model.StopReasonNoEvents || s.actions.Dead(model.SelectorSource) || s.actions.Dead(model.SelectorTarget) || s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0), TargetKilled: killed, TargetKilledAtMs: killedAtPtr}
		if s.budgetCause != "" {
			cause := s.budgetCause
			result.BudgetCause = &cause
			reason := "budget_exceeded"
			result.IncompleteReason = &reason
		}
		return result
	}
	if s.actions.BasicAttack() == nil {
		return nil
	}
	b := s.actions.BasicAttack()
	dead := s.actions.Dead(b.Plan().Source) || s.actions.Dead(b.Plan().Target) || s.combatantHp(b.Plan().Source) <= 0 || s.combatantHp(b.Plan().Target) <= 0
	complete := s.budgetCause == "" && !b.UnfinishedTail() && (dead || s.loop.TimeMs() >= s.loop.StartMs()+s.loop.DurationMs())
	result := &model.RunExecutionSummary{RequestedDurationMs: s.loop.DurationMs(), Complete: complete, TargetKilled: b.TargetKilledAt() != nil, TargetKilledAtMs: b.TargetKilledAt()}
	if s.budgetCause != "" {
		cause := s.budgetCause
		result.BudgetCause = &cause
	}
	if !complete {
		reason := "unfinished_tail"
		if s.budgetCause != "" && (b.Current() == nil || b.Current().HitAtMs() == nil || b.Current().Completed()) {
			reason = "budget_exceeded"
		}
		result.IncompleteReason = &reason
	}
	return result
}

func (s *Engine) recordingSummary() model.RecordingSummary {
	attacks := 0
	if s.actions.BasicAttack() != nil {
		attacks = s.actions.BasicAttack().StartedCount()
	}
	return s.report.Recording(attacks, s.detailedOutput())
}

func itoa(value uint32) string {
	if value == 0 {
		return "0"
	}
	buf := [10]byte{}
	pos := len(buf)
	for value > 0 {
		pos--
		buf[pos] = byte('0' + value%10)
		value /= 10
	}
	return string(buf[pos:])
}

func (s *Engine) detailedOutput() bool {
	return s.req.OutputMode != model.RunOutputSummary
}

func (s *Engine) resultOutputMode() model.RunOutputMode {
	if !s.detailedOutput() {
		return model.RunOutputSummary
	}
	return ""
}

// 工厂同步调用，完整模式保持原记录时点；汇总模式不创建展示字典。
func (s *Engine) recordEvidenceLazy(kind model.EvidenceKind, factory func() model.EvidenceItem) {
	if !s.detailedOutput() {
		s.recordEvidence(model.EvidenceItem{Kind: kind})
		return
	}
	s.recordEvidence(factory())
}

func (f *Frame) recordEvidenceLazy(kind model.EvidenceKind, factory func() model.EvidenceItem) {
	if !f.run.detailedOutput() {
		f.recordEvidenceKind(kind)
		return
	}
	f.recordEvidence(factory())
}

// 汇总模式仍核对原明细预算，未请求明细不计作预算丢弃。
func (s *Engine) retainedRecordCount(total, returned, limit int) int {
	return reportpkg.RetainedRecordCount(total, returned, limit, s.detailedOutput())
}

func (s *Engine) recordEvidence(item model.EvidenceItem) {
	s.report.RecordEvidence(item, s.detailedOutput(), s.budget.MaxEvidenceItems)
}

func (s *Engine) handleSample() { s.report.AppendSample(s.buildSeriesPoint(s.loop.TimeMs())) }

func (s *Engine) buildSeriesPoint(timeMs int64) model.SeriesPoint {
	if s.compiled.Features.Has(plan.FeatureResourceMax) && timeMs == s.loop.TimeMs() {
		s.settleLiveResourceExpiry()
	}
	return s.report.SeriesPoint(timeMs, s.combatantHp(model.SelectorSource), s.combatantHp(model.SelectorTarget))
}

func (s *Engine) buildDoneResult(final bool) model.DoneResult {
	s.refreshActionContributions()
	finalSnapshot := s.buildFinalSnapshot()
	if s.processFailure != nil {
		return model.DoneResult{}
	}

	totals := s.report.Totals()
	sampling := s.report.CompleteSampling(s.loop.TimeMs(), final)
	series := sampling.Series
	downsampled := sampling.Evidence.Downsampled
	droppedSeriesPoints := sampling.DroppedPoints
	abilityStats := s.report.AbilityStats()
	var basicSummary *model.BasicAttackSummary
	var sourceVampHealing, targetVampHealing *float64
	var actionSummary *model.SkillActionSummary
	var useSummary *model.SkillUseSummary
	var sourceDirectHealing, targetDirectHealing *float64
	if s.actions.ManualCount() > 0 {
		actions, uses := s.skillSummaries()
		actionSummary, useSummary = &actions, &uses
	}
	automaticSummary, automaticRecords, automaticRecording, automaticUses := s.automaticSkillResults()
	if automaticUses != nil {
		useSummary = automaticUses
	}
	if s.automatedRun() {
		sourceDirectHealing, targetDirectHealing = &totals.SourceDirectHealing, &totals.TargetDirectHealing
		sourceVampHealing, targetVampHealing = &totals.SourceVampHealing, &totals.TargetVampHealing
	}
	if s.actions.BasicAttack() != nil {
		summary := s.actions.BasicAttack().Summary()
		basicSummary = &summary
		sourceVampHealing, targetVampHealing = &totals.SourceVampHealing, &totals.TargetVampHealing
	}

	s.appendTerminalEvidence(sampling.Evidence)

	warnings, warningCount := s.buildWarnings(downsampled, droppedSeriesPoints)
	recording := s.recordingSummary()
	targetMarkSummary := s.targetMarkSummaryOutput()
	resourceChangeSummary := s.resourceSummaryOutput()
	var output reportpkg.Output
	if final {
		output = s.report.Finish()
	} else {
		output = s.report.Snapshot()
	}
	if automaticSummary != nil {
		automaticRecords = output.AutomaticRecords
	}
	var resourceRecords *[]model.ResourceChangeRecord
	if s.compiled.Features.Has(plan.FeatureResourceMax) {
		resourceRecords = &output.ResourceChangeRecords
	}

	return model.DoneResult{
		TargetMarkSummary:       targetMarkSummary,
		ResourceChangeRecords:   resourceRecords,
		ResourceChangeSummary:   resourceChangeSummary,
		AutomaticSkillSummary:   automaticSummary,
		AutomaticSkillRecords:   automaticRecords,
		AutomaticSkillRecording: automaticRecording,
		OutputMode:              s.resultOutputMode(),
		SkillActionRecords:      output.SkillActionRecords,
		SkillUseRecords:         output.SkillUseRecords,
		HealingRecords:          output.HealingRecords,
		OK:                      true,
		AttackRecords:           output.AttackRecords,
		DamageRecords:           output.DamageRecords,
		MechanicRecords:         output.MechanicRecords,
		Recording:               recording,
		Summary: model.RunSummary{
			SkillActions:        actionSummary,
			SkillUses:           useSummary,
			SourceDirectHealing: sourceDirectHealing,
			TargetDirectHealing: targetDirectHealing,
			BasicAttack:         basicSummary,
			Execution:           s.executionSummary(),
			SourceHpLoss:        totals.SourceHpLoss,
			TargetHpLoss:        totals.TargetHpLoss,
			SourceVampHealing:   sourceVampHealing,
			TargetVampHealing:   targetVampHealing,
			DamageBreakdown:     output.DamageBreakdown,
			DurationMs:          s.loop.TimeMs() - s.loop.StartMs(),
			StopReason:          s.loop.Reason(),
			SourceFinalHp:       s.combatantHp(model.SelectorSource),
			TargetFinalHp:       s.combatantHp(model.SelectorTarget),
			SourceDamageDealt:   totals.SourceDamageDealt,
			SourceDamageTaken:   totals.SourceDamageTaken,
			TargetDamageDealt:   totals.TargetDamageDealt,
			TargetDamageTaken:   totals.TargetDamageTaken,
			SourceOverheal:      totals.SourceOverheal,
			TargetOverheal:      totals.TargetOverheal,
			AbilityAttemptCount: totals.AbilityAttemptCount,
			AbilityCastCount:    s.abilityCastCount,
			AttemptSkippedCount: totals.AttemptSkippedCount,
			WarningCount:        warningCount,
			EvidenceTruncated:   output.Evidence.Truncated,
			SeriesDownsampled:   downsampled,
			AbilityStats:        abilityStats,
		},
		FinalSnapshot:          finalSnapshot,
		Series:                 series,
		Warnings:               warnings,
		Evidence:               output.Evidence,
		SeriesSamplingEvidence: sampling.Evidence,
	}
}

func (s *Engine) buildFinalSnapshot() model.Snapshot {
	snapshot := cloneSnapshot(s.req.InitialSnapshot)
	snapshot.TimeMs = s.loop.TimeMs()
	snapshot.SchemaHash = s.compiled.SchemaHash
	snapshot.RulesHash = s.compiled.RulesHash
	for i, c := range snapshot.Combatants {
		rt, ok := s.combatants[c.Key]
		if !ok {
			continue
		}
		snapshot.Combatants[i].Attributes = rt.attributesView().ToMap()
		snapshot.Combatants[i].Resources = rt.resourceView().ToMap()
		snapshot.Combatants[i].Cooldowns = cooldownsToSnapshot(rt.cooldowns, s.loop.TimeMs())
		snapshot.Combatants[i].Providers = effectpkg.ProvidersToSnapshot(rt.instances.Providers())
		if err := s.observeMomentStatusContributions(rt.instances.Providers(), snapshot.Combatants[i].Providers); err != nil {
			s.processFailure = err
			return model.Snapshot{}
		}
		snapshot.Combatants[i].Shields = effectpkg.ShieldsToSnapshot(rt.instances.Shields())
		snapshot.Combatants[i].ProviderState = rt.providerState.Snapshot(rt.cooldowns.View(), rt.numbers.Key(), s.loop.TimeMs())
		snapshot.Combatants[i].EffectiveStatuses = reportpkg.BuildEffectiveStatuses(snapshot.Combatants[i].Providers, s.loop.TimeMs())
		if snapshot.Combatants[i].EffectiveStatuses == nil {
			snapshot.Combatants[i].EffectiveStatuses = []model.EffectiveStatusSnapshot{}
		}
		if snapshot.Combatants[i].AbilityState == nil {
			snapshot.Combatants[i].AbilityState = map[string]interface{}{}
		}
		if snapshot.Combatants[i].ProviderState == nil {
			snapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		if snapshot.Combatants[i].Vars == nil {
			snapshot.Combatants[i].Vars = map[string]interface{}{}
		}
	}
	if !s.automatedRun() || s.budgetCause == "" {
		s.lazyExpireAllProviderState()
	}
	for i, c := range snapshot.Combatants {
		rt, ok := s.combatants[c.Key]
		if !ok {
			continue
		}
		snapshot.Combatants[i].ProviderState = rt.providerState.Snapshot(rt.cooldowns.View(), rt.numbers.Key(), s.loop.TimeMs())
	}
	snapshot.UseTriggerLedger = s.snapshotUseTriggerLedger()
	snapshot.UseAmountBudgets = s.snapshotUseAmountBudgets()
	snapshot.ProcessInstances = s.snapshotProcesses()
	if snapshot.UseTriggerLedger == nil {
		snapshot.UseTriggerLedger = []model.UseTriggerLedgerEntry{}
	}
	return snapshot
}

func (s *Engine) appendTerminalEvidence(sampling model.SeriesSamplingEvidence) {
	if sampling.Downsampled {
		s.recordEvidenceLazy(model.EvidenceKindDownsampled, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: s.loop.TimeMs(),
				Kind:   model.EvidenceKindDownsampled,
				Data: map[string]interface{}{
					"requestedPointCount": sampling.RequestedPointCount,
					"finalPointCount":     sampling.FinalPointCount,
					"maxSeriesPoints":     sampling.MaxSeriesPoints,
					"method":              sampling.Method,
				},
			}
		})
	}
	if s.loop.Reason() == model.StopReasonBudgetExceeded {
		s.recordEvidenceLazy(model.EvidenceKindBudgetExceeded, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: s.loop.TimeMs(),
				Kind:   model.EvidenceKindBudgetExceeded,
				Data: map[string]interface{}{
					"processedEvents": s.loop.ProcessedEvents(),
					"maxEvents":       s.budget.MaxEvents,
				},
			}
		})
	}
}

func (s *Engine) truncatedEvidenceKinds() []string {
	return s.report.TruncatedEvidenceKinds(s.detailedOutput())
}

func (s *Engine) buildWarnings(seriesDownsampled bool, droppedSeriesPoints int) ([]model.WarningItem, int) {
	var candidates []model.WarningItem
	if pendingCount, pendingCopies := s.continuations.PendingCounts(); pendingCount > 0 {
		candidates = append(candidates, model.WarningItem{
			Code:     "pending_continuations_not_in_snapshot",
			Message:  "finalSnapshot omits " + strconv.Itoa(pendingCopies) + " pending delayed damage copies across " + strconv.Itoa(pendingCount) + " continuations; restoring it will not replay them",
			Severity: model.WarningSeverityWarning,
			Refs:     []string{"finalSnapshot"},
			Count:    pendingCopies,
		})
	}

	if truncated, count := s.report.EvidenceTruncation(); truncated {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeEvidenceTruncated),
			Message:      "evidence items truncated by safety budget",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: s.truncatedEvidenceKinds(),
			Count:        count,
		})
	}
	if seriesDownsampled && droppedSeriesPoints > 0 {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeSeriesDownsampled),
			Message:      "series points downsampled by maxSeriesPoints",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: []string{string(model.EvidenceKindDownsampled)},
			Count:        droppedSeriesPoints,
		})
	}
	if s.loop.Reason() == model.StopReasonBudgetExceeded {
		candidates = append(candidates, model.WarningItem{
			Code:         string(model.WarningCodeBudgetExceeded),
			Message:      "run stopped because event budget was exceeded",
			Severity:     model.WarningSeverityWarning,
			EvidenceRefs: []string{string(model.EvidenceKindBudgetExceeded)},
			Count:        1,
		})
	}
	if w := s.listeners.OverflowWarning(); w != nil {
		candidates = append(candidates, *w)
	}

	totalProduced := len(candidates)
	maxWarnings := s.budget.MaxWarnings
	if maxWarnings <= 0 {
		maxWarnings = model.DefaultSafetyBudget().MaxWarnings
	}
	warnings := candidates
	if len(warnings) > maxWarnings {
		warnings = warnings[:maxWarnings]
	}
	if warnings == nil {
		warnings = []model.WarningItem{}
	}
	return warnings, totalProduced
}

func cooldownsToSnapshot(cooldowns *actionpkg.CooldownLedger, nowMs int64) map[string]interface{} {
	return cooldowns.Snapshot(nowMs)
}

func (s *Engine) recordOverheal(sourceKey string, amount float64) {
	s.report.RecordOverheal(sourceKey, amount)
}

func (s *Engine) recordDamage(sourceKey, targetKey string, amount float64, timeMs int64) {
	s.report.RecordDamage(sourceKey, targetKey, amount, timeMs)
}

func (s *Engine) initSamplingCursor(config model.SamplingConfig) *model.EngineError {
	if !s.report.InitSampling(config, s.loop.StartMs(), s.loop.DurationMs()) {
		return s.basicAttackErr("sampling requires positive intervals, maxSeriesPoints in [2,5000], and requested point count and effective interval within int32", "sampling")
	}
	return nil
}

func (s *Engine) flushSamplesBefore(timeMs int64) {
	for {
		next, ok := s.report.NextSample()
		if !ok || next >= timeMs {
			return
		}
		s.report.AdvanceSample(s.buildSeriesPoint(next))
	}
}

func (s *Engine) flushSamplesThrough(timeMs int64) {
	s.flushSamplesBefore(timeMs)
	if next, ok := s.report.NextSample(); ok && next == timeMs {
		s.report.AdvanceSample(s.buildSeriesPoint(timeMs))
	}
}

func (s *Engine) appendFinalSample() {
	if s.report.NeedsFinalSample(s.loop.TimeMs()) {
		s.report.AppendSample(s.buildSeriesPoint(s.loop.TimeMs()))
	}
}
