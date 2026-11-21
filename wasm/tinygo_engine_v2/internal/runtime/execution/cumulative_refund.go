package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

func (bridge cooldownRefundBridge) RefundProviderRef() string {
	return bridge.frame.ownerProviderRef
}

func (bridge cooldownRefundBridge) ReserveRefundRatio(identity actionflow.CumulativeRefundIdentity, limit model.CumulativeRatioLimit, requested float64) (float64, float64, *model.EngineError) {
	frame := bridge.frame
	key := usage.AmountKey{Key: usage.Key{Owner: identity.Owner, ProviderRef: identity.ProviderRef,
		GroupKey: limit.GroupKey, Scope: model.OncePerUseScopeProviderTarget, UseSource: identity.UseSource, UseKey: identity.UseKey, Target: identity.Target},
		SubjectRef: identity.SubjectRef}
	reservation, err := frame.run.useTriggerLedger.ReserveAmount(key, identity.UseSkillKey, limit.MaxRatio, requested)
	if err != nil {
		if err.BudgetCause != "" && frame.run.budgetCause == "" {
			frame.run.budgetCause = err.BudgetCause
		}
		return 0, 0, err
	}
	if reservation.Granted() > 0 {
		frame.pendingAmountBudgets = append(frame.pendingAmountBudgets, reservation)
		// 取整为0也须在实际状态发布点提交比例，不能被空帧优化漏掉。
		frame.stageFor(identity.Owner).dirty = true
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
	if !s.compiled.Features.Has(plan.FeatureCumulativeCooldownRefund) {
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
