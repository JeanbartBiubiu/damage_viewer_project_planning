package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

func (bridge cooldownRefundBridge) ReserveRefundRatio(limit model.CumulativeRatioLimit, subjectRef string, requested float64) (float64, float64, *model.EngineError) {
	frame := bridge.frame
	event := frame.eventCtx
	fail := func() (float64, float64, *model.EngineError) {
		return 0, 0, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"cumulative refund requires an accepted registered original use and its actual owned target",
			"operation.cumulativeLimit", subjectRef, frame.run.compiled.SchemaHash, frame.run.compiled.RulesHash, frame.run.req.SessionID)
	}
	if !frame.mountedListener || event == nil || !event.HasUse || event.UseKey == "" || event.UseSource != frame.ownerCombatantKey || event.EventTargetKey == "" || frame.ownerProviderRef == "" {
		return fail()
	}
	actual := frame.run.actions.Use(event.UseKey)
	if actual == nil || actual.CastID() == 0 || actual.Source() != event.UseSource || actual.SkillKey() != event.UseSkillKey {
		return fail()
	}
	process := frame.run.actions.Process(actual.ProcessReference())
	if process == nil || process.CastID() != actual.CastID() || process.Owner() != actual.Source() || process.SkillKey() != actual.SkillKey() || process.CastUseKey() != actual.UseKey() {
		return fail()
	}
	key := usage.AmountKey{Key: usage.Key{Owner: frame.ownerCombatantKey, ProviderRef: frame.ownerProviderRef,
		GroupKey: limit.GroupKey, Scope: model.OncePerUseScopeProviderTarget, UseSource: event.UseSource, UseKey: event.UseKey, Target: event.EventTargetKey}, SubjectRef: subjectRef}
	reservation, err := frame.run.useTriggerLedger.ReserveAmount(key, event.UseSkillKey, limit.MaxRatio, requested)
	if err != nil {
		return 0, 0, err
	}
	if reservation.Granted() > 0 {
		frame.pendingAmountBudgets = append(frame.pendingAmountBudgets, reservation)
		// 取整为0也须在实际状态发布点提交比例，不能被空帧优化漏掉。
		frame.stageFor(frame.ownerCombatantKey).dirty = true
	}
	return reservation.Previous(), reservation.Current(), nil
}

func (f *Frame) commitAmountBudgets() {
	for _, reservation := range f.pendingAmountBudgets {
		f.run.useTriggerLedger.CommitAmount(reservation)
	}
	f.pendingAmountBudgets = f.pendingAmountBudgets[:0]
}

func (f *Frame) releasePendingAmountBudgets() {
	for _, reservation := range f.pendingAmountBudgets {
		f.run.useTriggerLedger.ReleaseAmount(reservation)
	}
	f.pendingAmountBudgets = f.pendingAmountBudgets[:0]
}

func (s *Engine) snapshotUseAmountBudgets() []model.UseAmountBudgetEntry {
	if !s.compiled.HasCumulativeCooldownRefund {
		return nil
	}
	rows := s.useTriggerLedger.SnapshotAmounts()
	result := make([]model.UseAmountBudgetEntry, 0, len(rows))
	for _, row := range rows {
		target := row.Key.Target
		result = append(result, model.UseAmountBudgetEntry{UseTriggerLedgerEntry: model.UseTriggerLedgerEntry{
			Owner: row.Key.Owner, ProviderRef: row.Key.ProviderRef, GroupKey: row.Key.GroupKey, Scope: row.Key.Scope,
			UseSource: row.Key.UseSource, UseSkillKey: row.UseSkillKey, UseKey: row.Key.UseKey, Target: &target},
			SubjectRef: row.Key.SubjectRef, MaxValue: row.MaxValue, UsedValue: row.UsedValue})
	}
	return result
}
