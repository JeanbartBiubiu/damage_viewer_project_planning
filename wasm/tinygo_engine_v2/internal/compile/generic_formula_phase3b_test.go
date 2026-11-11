package compile

import (
	"math"
	"strings"
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func phase3BCompileInput() model.CompileRequest {
	return model.CompileRequest{SchemaVersion: model.GenericSchemaVersion, SchemaHash: "3b.schema", RulesHash: "3b.rules", Rules: model.RulesContainer{DamageTypeFormulas: []model.DamageTypeFormulaDefinition{{DamageType: "heat", Formula: formuladefinition.Constant("defense", "", 1).Expression}}}, TypeCatalog: model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "heat", Domain: "damage"}, {Key: "armor", Domain: "attribute"}}}, Combatants: []model.CombatantDefinition{{Key: "source", Attributes: map[string]model.AttributeSlotDef{}, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{{ProviderRef: "p", DefinitionRef: "p"}}}, {Key: "target", Attributes: map[string]model.AttributeSlotDef{}, Resources: map[string]model.ResourceSlotDef{}}}, SharedProviders: []model.ProviderDefinition{{ProviderKey: "p", Kind: "skill", StableID: "p", SkillKey: "probe", Abilities: []model.AbilityDefinition{{AbilityKey: "hit", Kind: "active", SkillKey: "probe", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "heat", Amount: &model.GenericFormulaExpr{Op: "ref", Ref: "value"}}}}}}}, Formulas: []model.NamedFormula{formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "read", Path: "ability.param.basis"}, map[string]float64{"basis": 0})}}
}

func TestPhase3BCompileParameterCatalogAndAllDeclarationsFailClosed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*model.NamedFormula)
	}{
		{"missing_selected", func(d *model.NamedFormula) { d.Parameters[0].Value = nil }},
		{"nonfinite", func(d *model.NamedFormula) { *d.Parameters[0].Value = math.Inf(1) }},
		{"unknown_mode", func(d *model.NamedFormula) { d.Parameters[0].ValueMode = "guess" }},
		{"wrong_type", func(d *model.NamedFormula) { d.Parameters[0].ValueType = "STRING" }},
		{"runtime_default", func(d *model.NamedFormula) { d.Parameters[0].ValueMode = "RUNTIME_INPUT" }},
		{"static_runtime_source", func(d *model.NamedFormula) {
			d.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "use_charge_duration"}
		}},
		{"duplicate", func(d *model.NamedFormula) { d.Parameters = append(d.Parameters, d.Parameters[0]) }},
		{"missing_catalog", func(d *model.NamedFormula) { d.Parameters = []model.FormulaParameter{} }},
		{"foreign_skill", func(d *model.NamedFormula) {
			d.Expression.(map[string]any)["inputs"].([]any)[0].(map[string]any)["binding"].(map[string]any)["skillKey"] = "foreign"
		}},
		{"unused_unauthorized", func(d *model.NamedFormula) {
			root := d.Expression.(map[string]any)
			root["inputs"] = append(root["inputs"].([]any), map[string]any{"key": "unused", "binding": map[string]any{"kind": "attribute", "object": "owner", "attributeKey": "armor", "valueKind": "TOTAL", "view": "current_frame"}})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := phase3BCompileInput()
			tc.change(&r.Formulas[0])
			result := CompileGeneric(r)
			if result.OK || result.Session.Formulas.Metadata.Count() != 0 {
				t.Fatal(result.Result.Errors)
			}
		})
	}
	r := phase3BCompileInput()
	result := CompileGeneric(r)
	if !result.OK || result.Result.Metadata.ApprovedStaticValues["value"] != 0 {
		t.Fatal(result.Result.Errors, result.Result.Metadata)
	}
}

func TestPhase3BStaticStateLifecycleRefFrozenAndRangeConstraints(t *testing.T) {
	for _, value := range []float64{0, 3, .5, -1, 9007199254740992} {
		r := phase3BCompileInput()
		r.Formulas[0] = formuladefinition.Constant("value", "probe", value)
		r.SharedProviders[0].InitialStateSchema = map[string]any{"count": map[string]any{"valueType": "integer", "defaultValue": map[string]any{"op": "ref", "ref": "value"}, "maxValue": 3, "durationMs": 0}}
		result := CompileGeneric(r)
		valid := value == 0 || value == 3
		if result.OK != valid {
			t.Fatal(value, result.Result.Errors)
		}
		if valid && result.Session.Providers[0].StateFields["count"].DefaultValue != value {
			t.Fatal(result.Session.Providers[0].StateFields)
		}
	}
	r := phase3BCompileInput()
	r.Formulas[0] = formuladefinition.Constant("value", "probe", 1)
	r.SharedProviders[0].Lifecycle = &model.ProviderLifecycle{MaxStacks: map[string]any{"op": "ref", "ref": "value"}, TickIntervalMs: map[string]any{"op": "ref", "ref": "value"}}
	result := CompileGeneric(r)
	if !result.OK || result.Session.Providers[0].Lifecycle.MaxStacks != 1 || result.Session.Providers[0].Lifecycle.TickIntervalMs != 1 {
		t.Fatal(result.Result.Errors)
	}
	for _, bad := range []any{map[string]any{"op": "add", "args": []any{}}, map[string]any{"op": "ref", "ref": "value", "extra": true}, map[string]any{"op": "ref", "ref": "value", "value": nil}} {
		r.SharedProviders[0].Lifecycle.MaxStacks = bad
		if result := CompileGeneric(r); result.OK {
			t.Fatal("non-strict static external ref accepted", bad)
		}
	}
	r.SharedProviders[0].Lifecycle = nil
	r.Formulas[0] = formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "read", Path: "source.attr.armor.resolved"}, nil)
	r.SharedProviders[0].InitialStateSchema = map[string]any{"count": map[string]any{"defaultValue": 0, "maxValue": map[string]any{"op": "ref", "ref": "value"}, "durationMs": 0}}
	if result := CompileGeneric(r); result.OK {
		t.Fatal("dynamic state cap accepted")
	}
}

func TestPhase3BOwningSkillUsePointAndLegalForeignStaticDefinition(t *testing.T) {
	r := phase3BCompileInput()
	r.SharedProviders[0].SkillKey = ""
	r.SharedProviders[0].Abilities[0].SkillKey = ""
	if result := CompileGeneric(r); result.OK {
		t.Fatal("common call borrowed its own self-declared skill")
	}
	r = phase3BCompileInput()
	r.SharedProviders[0].Abilities[0].SkillKey = ""
	if result := CompileGeneric(r); result.OK {
		t.Fatal("ability common formula borrowed provider skill instead of its own")
	}
	r = phase3BCompileInput()
	r.SharedProviders[0].Abilities[0].SkillKey = "foreign"
	if result := CompileGeneric(r); result.OK {
		t.Fatal("ability/provider skill mismatch accepted")
	}
	r = phase3BCompileInput()
	r.Formulas[0] = formuladefinition.Constant("foreign_static", "foreign", 2)
	r.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "foreign_state"}}
	r.SharedProviders = append(r.SharedProviders, model.ProviderDefinition{ProviderKey: "foreign_state", SkillKey: "foreign", StableID: "foreign_state", Kind: "status", Lifecycle: &model.ProviderLifecycle{DurationMs: &model.GenericFormulaExpr{Op: "ref", Ref: "foreign_static"}}, Modifiers: []model.ModifierDefinition{{ModifierKey: "armor", Kind: "attribute", Target: "armor", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "ref", Ref: "foreign_static"}}}})
	if result := CompileGeneric(r); !result.OK {
		t.Fatal("legal foreign static definition was blanket-rejected", result.Result.Errors)
	}
	r.Formulas[0] = formuladefinition.FromExpr("foreign_static", "foreign", model.GenericFormulaExpr{Op: "read", Path: "ability.param.runtime"}, nil)
	result := CompileGeneric(r)
	if result.OK || !hasErrorPath(result.Result.Errors, "operations[0]") {
		t.Fatal("foreign runtime state borrowed invocation context", result.Result.Errors)
	}
}

func TestPhase3BOutputDependenciesKeepConditionAndStaticRestrictions(t *testing.T) {
	r := phase3BCompileInput()
	r.Formulas[0] = formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{{Op: "const", Value: model.Float64Ptr(0)}, {Op: "read", Path: "ability.param.runtime"}, {Op: "const", Value: model.Float64Ptr(1)}}}, nil)
	r.SharedProviders[0].Abilities[0].CastCondition = &model.GenericFormulaExpr{Op: "ref", Ref: "value"}
	result := CompileGeneric(r)
	if result.OK || !hasErrorPath(result.Result.Errors, "castCondition") {
		t.Fatal("unselected runtime branch escaped condition check", result.Result.Errors)
	}
	r.SharedProviders[0].Abilities[0].CastCondition = nil
	r.SharedProviders[0].InitialStateSchema = map[string]any{"n": map[string]any{"op": "ref", "ref": "value"}}
	result = CompileGeneric(r)
	if result.OK || !hasErrorPath(result.Result.Errors, "initialStateSchema.n") {
		t.Fatal("unselected runtime branch escaped static check", result.Result.Errors)
	}
	// 任意程序临时包装键不能作为外部ref。
	r = phase3BCompileInput()
	r.SharedProviders[0].Abilities = append(r.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "temp_call", SkillKey: "probe", Kind: "active", Cost: &model.AbilityCost{ResourceKey: "mana", Amount: model.GenericFormulaExpr{Op: "ref", Ref: "sharedProviders[0].abilities[0].operations[0].amount"}}})
	result = CompileGeneric(r)
	if result.OK {
		t.Fatal("temporary wrapper exposed to host")
	}
	found := false
	for _, issue := range result.Result.Errors {
		if strings.Contains(issue.Path, "cost.amount.ref") {
			found = true
		}
	}
	if !found {
		t.Fatal(result.Result.Errors)
	}
}
