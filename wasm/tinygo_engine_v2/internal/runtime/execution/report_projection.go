package execution

import (
	"strconv"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	reportpkg "tinygo_engine_v2/internal/runtime/report"
)

func (s *Engine) recordEvidence(item model.EvidenceItem) {
	s.report.RecordEvidence(item, s.detailedOutput(), s.budget.MaxEvidenceItems)
}

func (s *Engine) handleSample() { s.report.AppendSample(s.buildSeriesPoint(s.loop.TimeMs())) }

func (s *Engine) buildSeriesPoint(timeMs int64) model.SeriesPoint {
	if s.compiled.HasResourceMax && timeMs == s.loop.TimeMs() {
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

	rawSeriesCount := s.report.SeriesCount()
	sampling := s.report.Sampling()
	effectiveSampleEveryMs := s.report.EffectiveSampleEveryMs()
	totals := s.report.Totals()
	series, downsampled := s.report.FinalizeSeries(final)
	if series == nil {
		series = []model.SeriesPoint{}
	}
	droppedSeriesPoints := 0
	if downsampled && rawSeriesCount > len(series) {
		droppedSeriesPoints = rawSeriesCount - len(series)
	}

	abilityStats := s.report.AbilityStats()

	requestedPoints := 0
	method := "disabled"
	if !sampling.Disabled {
		method = "uniform_time"
		span := s.loop.TimeMs() - s.loop.StartMs()
		requestedPoints = int(span/int64(sampling.SampleEveryMs)) + 1
		if span%int64(sampling.SampleEveryMs) != 0 {
			requestedPoints++
		}
		downsampled = effectiveSampleEveryMs > int64(sampling.SampleEveryMs)
		droppedSeriesPoints = requestedPoints - len(series)
	}
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

	s.appendTerminalEvidence(downsampled, requestedPoints, len(series))

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
	if s.compiled.HasResourceMax {
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
		FinalSnapshot: finalSnapshot,
		Series:        series,
		Warnings:      warnings,
		Evidence:      output.Evidence,
		SeriesSamplingEvidence: model.SeriesSamplingEvidence{
			RequestedSampleEveryMs: sampling.SampleEveryMs,
			EffectiveSampleEveryMs: int(effectiveSampleEveryMs),
			RequestedPointCount:    requestedPoints,
			FinalPointCount:        len(series),
			MaxSeriesPoints:        sampling.MaxSeriesPoints,
			Downsampled:            downsampled,
			Method:                 method,
		},
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
	snapshot.ProcessInstances = s.snapshotProcesses()
	if snapshot.UseTriggerLedger == nil {
		snapshot.UseTriggerLedger = []model.UseTriggerLedgerEntry{}
	}
	return snapshot
}

func (s *Engine) appendTerminalEvidence(downsampled bool, requestedPoints, finalPointCount int) {
	if downsampled {
		s.recordEvidenceLazy(model.EvidenceKindDownsampled, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: s.loop.TimeMs(),
				Kind:   model.EvidenceKindDownsampled,
				Data: map[string]interface{}{
					"requestedPointCount": requestedPoints,
					"finalPointCount":     finalPointCount,
					"maxSeriesPoints":     s.report.Sampling().MaxSeriesPoints,
					"method":              "uniform_time",
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
	if len(s.continuations) > 0 {
		pendingCopies := 0
		for _, payload := range s.continuations {
			if payload == nil {
				continue
			}
			times := payload.req.repeatCount
			if times <= 0 {
				times = 1
			}
			pendingCopies += times * len(payload.damages)
		}
		candidates = append(candidates, model.WarningItem{
			Code:     "pending_continuations_not_in_snapshot",
			Message:  "finalSnapshot omits " + strconv.Itoa(pendingCopies) + " pending delayed damage copies across " + strconv.Itoa(len(s.continuations)) + " continuations; restoring it will not replay them",
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
