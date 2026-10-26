// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func frameCommitInput(ops ...model.OperationDefinition) (model.CompileRequest, model.RunRequest) {
	c, r := authoringInput()
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "damage/physical", Formula: formuladefinition.ConstantDefense("1")}}
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "damage/physical", Domain: "damage"})
	c.SharedProviders[0].Processes = nil
	c.SharedProviders[0].Listeners = nil
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{{AbilityKey: "atomic", Kind: "active", Operations: ops}}
	c.Combatants[1].Attributes["armor"] = authoringSlot(0)
	r.InitialSnapshot.Combatants[1].Attributes["armor"] = authoringSlot(0)
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "atomic", AbilityRef: authoringRef("atomic"), Source: "source", Target: "target"}}
	r.SkillUses, r.SkillHitFacts, r.AttackStartFacts = nil, nil, nil
	return c, r
}

func frameCommitDamage(amount float64) model.OperationDefinition {
	return model.OperationDefinition{Operation: "damage", Target: "target", Ref: "damage", DamageType: "damage/physical", Amount: authoringAmount(authoringConst(amount))}
}
