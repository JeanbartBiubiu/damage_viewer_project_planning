// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func TestContinuousAttackBudgetWinsCommittedDeathWithUnfinishedTail(t *testing.T) {
	c, r := continuousAttackInput(1, 20, 100, 0, 0, 1000)
	r.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 4}
	done := authoringRun(t, c, r)
	e := done.Summary.Execution
	if done.Summary.StopReason != model.StopReasonBudgetExceeded || !e.TargetKilled || *e.TargetKilledAtMs != 0 || e.Complete || *e.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || *e.IncompleteReason != "unfinished_tail" {
		t.Fatal(done.Summary)
	}
	if done.Summary.SourceDamageDealt != 100 || done.Summary.TargetHpLoss != 20 || done.Summary.BasicAttack.HitCount != 1 || done.Summary.BasicAttack.CompletedCount != 0 || done.AttackRecords[0].Completed {
		t.Fatal(done.Summary, done.AttackRecords)
	}
}
