// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func phase3BDerivationInput() (model.CompileRequest, model.RunRequest) {
	c, r := phase3BSkillInput()
	for _, key := range []string{"hp", "attack_damage", "attack_speed"} {
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
	}
	c.Combatants[0].Attributes = map[string]model.AttributeSlotDef{"armor": {Base: 10, Current: 10, Resolved: 10, Max: 1000}, "hp": {Base: 1000, Current: 800, Resolved: 800, Max: 1000}, "attack_damage": authoringSlot(100), "attack_speed": authoringSlot(1)}
	c.Combatants[1].Attributes = map[string]model.AttributeSlotDef{"armor": {Base: 30, Current: 30, Resolved: 30, Max: 1000}, "hp": {Base: 1000, Current: 600, Resolved: 600, Max: 1000}, "attack_damage": authoringSlot(50), "attack_speed": authoringSlot(2)}
	for i := range c.Combatants {
		r.InitialSnapshot.Combatants[i].Attributes = copyAttributeInput(c.Combatants[i].Attributes)
	}
	factor := authoringBinary("div", authoringBinary("add", authoringRead("source.attr.armor.resolved"), authoringBinary("div", authoringRead("target.attr.hp.current"), authoringConst(100))), authoringConst(10))
	c.Formulas = append(c.Formulas, formuladefinition.FromExpr("owner_dynamic", "probe", factor, nil), formuladefinition.FromExpr("read_damage", "probe", authoringRead("source.attr.attack_damage.resolved"), nil))
	for _, side := range []string{"source", "target"} {
		legacy := "target.attr.armor.base"
		if side == "target" {
			legacy = "source.attr.armor.base"
		}
		value := authoringBinary("add", model.GenericFormulaExpr{Op: "ref", Ref: "owner_dynamic"}, authoringBinary("div", authoringRead(legacy), authoringConst(100)))
		c.Rules.AttributeDerivations = append(c.Rules.AttributeDerivations, model.AttributeDerivationDefinition{ValueType: "DECIMAL", CombatantKey: side, AttributeKey: "attack_damage", SkillKey: "probe", ValuePolicy: "multiply", Value: value})
	}
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "attribute_change", Target: "source", AttributeKey: "armor", ValuePolicy: "add", Amount: authoringAmount(authoringConst(10))}, {Operation: "attribute_change", Target: "target", AttributeKey: "armor", ValuePolicy: "add", Amount: authoringAmount(authoringConst(5))}, {Operation: "damage", Target: "target", DamageType: "heat", Amount: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "read_damage"})}}
	return c, r
}

func TestPhase3BDerivationTypedErrorIncludesActualActorAndOriginalProgramPointer(t *testing.T) {
	c, r := phase3BDerivationInput()
	// source缺CURRENT而target完整；target作者读取它作为自己的对手。
	var missing model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"base":1000,"max":1000,"resolved":800}`), &missing); err != nil {
		t.Fatal(err)
	}
	r.InitialSnapshot.Combatants[0].Attributes["hp"] = missing
	_, err := runtimeengine.RunGeneric(authoringCompile(t, c), r)
	if err == nil || err.Code != "FORMULA_MISSING_INPUT" || err.Details["combatantKey"] != "target" || err.Details["formulaKey"] != "owner_dynamic" || !strings.HasPrefix(err.Path, "/formulas/1/expression/") {
		t.Fatal(err)
	}
}

func TestPhase3BDerivationLegacyWithoutAuthorIdentityKeepsBattleSideSemantics(t *testing.T) {
	c, r := phase3BDerivationInput()
	c.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{ValuePolicy: "set", ValueType: "DECIMAL", CombatantKey: "source", AttributeKey: "attack_speed", Value: authoringConst(2)}, {ValueType: "DECIMAL", CombatantKey: "target", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: authoringBinary("div", authoringRead("source.attr.armor.base"), authoringConst(10))}}
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "heal", Target: "source", Amount: authoringAmount(authoringConst(0))}}
	done := authoringRun(t, c, r)
	if done.FinalSnapshot.Combatants[0].Attributes["attack_speed"].Resolved != 2 || done.FinalSnapshot.Combatants[1].Attributes["attack_damage"].Resolved != 50 {
		t.Fatal("legacy target derivation remapped its source read", done.FinalSnapshot)
	}
}
