// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func TestInternalCooldownFrozenFormulaViewDoesNotFollowReset(t *testing.T) {
	ledger := actionpkg.NewCooldownLedger()
	id := actionpkg.StateCooldownIdentity("source", "mounted", "cd", "state_scope/provider", "")
	ledger.Start(id, 1000, 0)
	fields := effectpkg.NewFields(map[string]effectpkg.FieldDefinition{"cd": {StateKind: model.ProviderStateKindCooldown, DefaultValue: 0, MaxValue: 1, HasCap: true, DurationMs: 1000, RefreshPolicy: model.ProviderStateRefreshStartOnFirstWrite}})
	var bags effectpkg.BagState
	first := bags.PrepareRead("mounted", true, fields, 100, effectpkg.ReadOptions{Cooldowns: ledger.View(), OwnerKey: "source"})
	frozenValues := first.State()
	bags = bags.Freeze()
	changed := ledger.Clone()
	changed.Reset(id, 100)
	second := bags.PrepareRead("mounted", true, fields, 100, effectpkg.ReadOptions{Cooldowns: changed.View(), OwnerKey: "source"})
	if frozenValues.At("cd") != 1 || second.State().At("cd") != 0 || first.State().At("cd") != 1 {
		t.Fatal("frozen provider state followed a later CD reset")
	}

}
