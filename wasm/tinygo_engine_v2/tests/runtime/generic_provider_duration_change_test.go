// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func providerDurationInput(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := timedShieldLoad(t)
	for _, attributes := range []map[string]model.AttributeSlotDef{c.Combatants[0].Attributes, r.InitialSnapshot.Combatants[0].Attributes} {
		attributes["attack_damage"] = authoringSlot(100)
	}
	for _, attributes := range []map[string]model.AttributeSlotDef{c.Combatants[1].Attributes, r.InitialSnapshot.Combatants[1].Attributes} {
		attributes["hp"] = authoringSlot(10000)
	}
	parent := &c.SharedProviders[0]
	parent.SkillKey = "clock_skill"
	parent.Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply", []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "attribute_window"}}),
		timedShieldAbility("ensure", []model.OperationDefinition{{Operation: "provider_duration_change", Target: "self", ProviderDefinitionRef: "attribute_window", ValuePolicy: "ensure_remaining", Amount: timedShieldExpr(2500)}}),
		timedShieldAbility("other_bonus", []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "other_window"}}),
		timedShieldAbility("sample", []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: authoringAmount(authoringRead("source.attr.attack_damage.resolved"))}}),
	}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "attribute_window", SkillKey: "clock_skill", StableID: "attribute_window", Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(3000), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{
			{ModifierKey: "flat", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: authoringConst(10)},
			{ModifierKey: "total", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "multiply", Stage: "total", Value: authoringConst(1.25)},
		}})
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "other_window", SkillKey: "clock_skill", StableID: "other_window", Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(1000), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{{ModifierKey: "other", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: authoringConst(20)}}})
	r.DriverPlan.Entries = []model.DriverEntry{}
	r.StopPolicy.DurationMs = 5100
	return c, r
}

func TestProviderEnsureRemainingRejectsUnsafeAmountsAndSharedApplyingMounts(t *testing.T) {
	for _, mode := range []string{"negative", "fractional", "unsafe", "dynamic", "foreign_skill", "double_mount", "hp", "no_duration", "overflow"} {
		t.Run(mode, func(t *testing.T) {
			c, r := providerDurationInput(t)
			switch mode {
			case "negative":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(-1)
			case "fractional":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(.5)
			case "unsafe":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(9007199254740992)
			case "dynamic":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = authoringAmount(authoringRead("source.attr.hp.current"))
			case "foreign_skill":
				c.SharedProviders[1].SkillKey = "foreign"
			case "double_mount":
				c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "other_mount", DefinitionRef: c.SharedProviders[0].ProviderKey})
			case "hp":
				c.SharedProviders[1].Modifiers[0].Target = "self.attr.hp"
			case "no_duration":
				c.SharedProviders[1].Lifecycle.DurationMs = nil
			case "overflow":
				c.SharedProviders[0].Abilities[1].Operations[0].Amount = timedShieldExpr(9007199254740991)
				r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "overflow", AbilityRef: timedShieldRef("ensure"), Source: "source", Target: "target", FirstAtMs: 10}}
			}
			result := compilebundle.CompileGeneric(c)
			if !result.OK {
				return
			}
			if mode != "overflow" {
				t.Fatal("invalid duration operation compiled", mode)
			}
			if _, err := runtimeengine.RunGeneric(result.Session, r); err == nil {
				t.Fatal("deadline overflow was accepted")
			}
		})
	}
}
