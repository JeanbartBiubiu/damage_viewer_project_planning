// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func elapsedModelValue(initial float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{*timedShieldExpr(initial), {Op: "max", Args: []model.GenericFormulaExpr{*timedShieldExpr(0), {Op: "sub", Args: []model.GenericFormulaExpr{*timedShieldExpr(1), {Op: "div", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.elapsed_ms"}, *timedShieldExpr(1500)}}}}}}}}
}

func elapsedInput(t *testing.T, definition string, initial float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := timedShieldLoad(t)
	for i := range c.Combatants {
		c.Combatants[i].Attributes["attack_damage"] = authoringSlot(100)
		r.InitialSnapshot.Combatants[i].Attributes["attack_damage"] = authoringSlot(100)
	}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: definition, StableID: definition, Kind: "buff",
		Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(1500), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{{ModifierKey: "configured_decay", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: elapsedModelValue(initial)}}})
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply", []model.OperationDefinition{{Operation: "apply_provider", Target: "source", ProviderDefinitionRef: definition}}),
		timedShieldAbility("sample", []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: &model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.resolved"}, DamageType: "damage/physical"}}),
	}
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "apply", AbilityRef: timedShieldRef("apply"), Source: "source", Target: "target"}}
	r.StopPolicy.DurationMs = 2000
	return c, r
}

func TestProviderElapsedQuietFinalSnapshotUsesActualEndpoint(t *testing.T) {
	c, r := elapsedInput(t, "configured_quiet_decay", 20)
	r.StopPolicy.DurationMs = 750
	done := timedShieldMustRun(t, c, r)
	if done.FinalSnapshot.TimeMs != 750 || done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Resolved != 110 {
		t.Fatalf("quiet final view is stale: %+v", done.FinalSnapshot)
	}
	if p := done.FinalSnapshot.Combatants[0].Providers[len(done.FinalSnapshot.Combatants[0].Providers)-1]; p.AppliedAtMs == nil || *p.AppliedAtMs != 0 {
		t.Fatal("legal zero application time omitted", p)
	}
}
