package compile

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func phase3BDeriveCompileInput() model.CompileRequest {
	r := phase3BCompileInput()
	for _, key := range []string{"attack_damage", "attack_speed"} {
		r.TypeCatalog.Types = append(r.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
	}
	for i := range r.Combatants {
		r.Combatants[i].Attributes["attack_damage"] = model.AttributeSlotDef{Base: 100, Resolved: 100, Current: 100, Max: 100}
		r.Combatants[i].Attributes["attack_speed"] = model.AttributeSlotDef{Base: 1, Resolved: 1, Current: 1, Max: 5}
		r.Combatants[i].Attributes["armor"] = model.AttributeSlotDef{Base: 10, Resolved: 10, Current: 10, Max: 100}
	}
	r.Formulas[0] = formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "read", Path: "source.attr.armor.resolved"}, nil)
	r.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{CombatantKey: "target", SkillKey: "probe", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: model.GenericFormulaExpr{Op: "ref", Ref: "value"}}}
	return r
}

func TestPhase3BDerivationIndependentSkillScopeAndRuntimeInputsRejected(t *testing.T) {
	for _, skill := range []string{"", "foreign"} {
		r := phase3BDeriveCompileInput()
		r.Rules.AttributeDerivations[0].SkillKey = skill
		result := CompileGeneric(r)
		if result.OK || !hasErrorPath(result.Result.Errors, "attributeDerivations[0].value") {
			t.Fatal(skill, result.Result.Errors)
		}
	}
	for _, runtime := range []string{"ability.param.dynamic", "use.charge_duration_ms", "process.actual_cost.mana"} {
		r := phase3BDeriveCompileInput()
		r.Formulas[0] = formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "read", Path: runtime}, nil)
		result := CompileGeneric(r)
		if result.OK || !hasErrorPath(result.Result.Errors, "attributeDerivations[0].value") {
			t.Fatal(runtime, result.Result.Errors)
		}
	}
	r := phase3BDeriveCompileInput()
	r.Rules.AttributeDerivations = append(r.Rules.AttributeDerivations, model.AttributeDerivationDefinition{CombatantKey: "source", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: model.GenericFormulaExpr{Op: "ref", Ref: "value"}})
	result := CompileGeneric(r)
	if result.OK || !hasErrorPath(result.Result.Errors, "attributeDerivations[1].value") {
		t.Fatal("following derivation inherited prior skill identity", result.Result.Errors)
	}
}

func TestPhase3BDerivationDependencyActorMappingChecksOutputReadsAndMissingSlots(t *testing.T) {
	r := phase3BDeriveCompileInput()
	delete(r.Combatants[1].Attributes, "armor")
	if result := CompileGeneric(r); result.OK {
		t.Fatal("target's authored source was checked against global source directory")
	}
	for _, field := range []string{"resolved", "current", "max"} {
		r = phase3BDeriveCompileInput()
		r.Formulas[0] = formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage." + field}, nil)
		if result := CompileGeneric(r); result.OK {
			t.Fatal("own derived output nonbase read accepted", field)
		}
	}
	r = phase3BDeriveCompileInput()
	r.Formulas[0] = formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.base"}, nil)
	if result := CompileGeneric(r); !result.OK {
		t.Fatal("owner frozen base wrongly rejected", result.Result.Errors)
	}
	r = phase3BDeriveCompileInput()
	r.Formulas[0] = formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "read", Path: "target.attr.attack_damage.resolved"}, nil)
	// target作者的TARGET对应全局source；它仍是普通未派生属性时允许。
	if result := CompileGeneric(r); !result.OK {
		t.Fatal(result.Result.Errors)
	}
	r.Rules.AttributeDerivations = append(r.Rules.AttributeDerivations, model.AttributeDerivationDefinition{CombatantKey: "source", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(1)}})
	if result := CompileGeneric(r); result.OK {
		t.Fatal("foreign derived output escaped owner-mapped cycle prohibition")
	}
}
