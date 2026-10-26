package execution

import (
	json "encoding/json"
	math "math"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
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
		r.InitialSnapshot.Combatants[i].Attributes = cloneAttributeMap(c.Combatants[i].Attributes)
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

func TestPhase3BDerivationOwnerContextBothSidesDynamicWritesAndLegacyReads(t *testing.T) {
	c, r := phase3BDerivationInput()
	raw, marshalErr := json.Marshal(c)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	var transport model.CompileRequest
	if err := json.Unmarshal(raw, &transport); err != nil {
		t.Fatal("new owner scope field failed strict JSON transport", err)
	}
	c = transport
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	for _, row := range compiled.Session.AttributeDerivations {
		if row.SkillKey != "probe" {
			t.Fatal("compiled derivation lost independent owning skill", row)
		}
	}
	for _, scenario := range []struct{ sourceHP, targetHP, raw, targetAD float64 }{{800, 600, 295, 225}, {900, 500, 285, 230}} {
		request := r
		request.InitialSnapshot = cloneSnapshot(r.InitialSnapshot)
		sourceHP := request.InitialSnapshot.Combatants[0].Attributes["hp"]
		sourceHP.Current, sourceHP.Resolved = scenario.sourceHP, scenario.sourceHP
		request.InitialSnapshot.Combatants[0].Attributes["hp"] = sourceHP
		targetHP := request.InitialSnapshot.Combatants[1].Attributes["hp"]
		targetHP.Current, targetHP.Resolved = scenario.targetHP, scenario.targetHP
		request.InitialSnapshot.Combatants[1].Attributes["hp"] = targetHP
		done, err := runForTest(compiled.Session, request)
		if err != nil {
			t.Fatal(err)
		}
		expectedHP := scenario.targetHP - (scenario.raw*100/130 - 30)
		expectedSourceAD := ((20+expectedHP/100)/10 + .35) * 100
		if math.Abs(done.Summary.TargetFinalHp-expectedHP) > 1e-9 || math.Abs(done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Resolved-expectedSourceAD) > 1e-9 || math.Abs(done.FinalSnapshot.Combatants[1].Attributes["attack_damage"].Resolved-scenario.targetAD) > 1e-9 {
			t.Fatal(scenario, done.Summary, done.FinalSnapshot)
		}
		found := false
		for _, e := range done.Evidence.Items {
			if e.Kind == "damage" {
				found = true
				if evidenceDataFloat(e.Data, "rawAmount") != scenario.raw {
					t.Fatal("common amount did not see preceding actor-relative derivation", e)
				}
			}
		}
		if !found {
			t.Fatal("missing real damage")
		}
	}
	// 编译和运行都不改作者SOURCE/TARGET绑定。
	inputs := c.Formulas[1].Expression.(map[string]any)["inputs"].([]any)
	if inputs[0].(map[string]any)["binding"].(map[string]any)["object"] != "source" || inputs[1].(map[string]any)["binding"].(map[string]any)["object"] != "target" {
		t.Fatal("author binding was rewritten")
	}
}
