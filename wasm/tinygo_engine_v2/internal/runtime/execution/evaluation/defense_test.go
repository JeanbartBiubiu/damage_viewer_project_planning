package evaluation

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/expression"
	"tinygo_engine_v2/internal/base/inputbinding"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func defenseFixture(t *testing.T, definition map[string]any) (formula.GenericRegistry, planbundle.CompiledDamageTypeFormula) {
	t.Helper()
	var allowed []any
	var catalog []expression.Binding
	var reads []planbundle.CompiledDamageAttributeRead
	for _, input := range definition["inputs"].([]any) {
		binding := input.(map[string]any)["binding"].(map[string]any)
		allowed = append(allowed, binding)
		catalog = append(catalog, expression.Binding{Kind: "attribute", Object: binding["object"].(string), AttributeKey: binding["attributeKey"].(string), ValueKind: "TOTAL", View: "current_frame"})
		reads = append(reads, planbundle.CompiledDamageAttributeRead{Object: binding["object"].(string), AttributeKey: binding["attributeKey"].(string)})
	}
	program, issue := expression.CompileDefinition(definition, allowed)
	if issue != nil {
		t.Fatal(issue)
	}
	bound, issue := inputbinding.Bind(program, catalog)
	if issue != nil {
		t.Fatal(issue)
	}
	var formulas formula.GenericRegistry
	id, err := formulas.Register(formula.GenericProgram{Key: "defense", Authored: program, BindingBytes: bound.ChargedBytes()})
	if err != nil {
		t.Fatal(err)
	}
	return formulas, planbundle.CompiledDamageTypeFormula{DamageType: "damage/configured", Program: id, Binding: bound, Reads: reads, Path: "rules.damageTypeFormulas[0].formula", OutputPath: "rules.damageTypeFormulas[0].formula.stages[0].expression"}
}

func TestDefenseUsesSuppliedResolvedViewsAndRetainsMissingInputIdentity(t *testing.T) {
	formulas, def := defenseFixture(t, formuladefinition.ResistanceDefense("armor"))
	identity := DefenseIdentity{AbilityRef: "source.provider[skill].ability[hit]", SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}
	source := attribute.FromMap(map[string]model.AttributeSlotDef{"armor": authoringSlot(0)})
	target := attribute.FromMap(map[string]model.AttributeSlotDef{"armor": {Base: 80, Current: 200, Max: 300, Resolved: 100}})
	out, issue := ResolveConfiguredDefense(formulas, def, 100, source, target, identity)
	if issue != nil || out.Amount != 50 || out.Factor != 0.5 || target.At("armor").Current != 200 {
		t.Fatal("supplied resolved view was not used without publishing", out, issue)
	}
	_, issue = ResolveConfiguredDefense(formulas, def, 100, source, target.Without("armor"), identity)
	if issue == nil || issue.Code != "FORMULA_MISSING_INPUT" || !strings.HasPrefix(issue.Path, def.Path) || issue.Ref != identity.AbilityRef || issue.SchemaHash != identity.SchemaHash || issue.RulesHash != identity.RulesHash || issue.SessionID != identity.SessionID || issue.Phase != model.GenericPhaseRun {
		t.Fatalf("missing defense input lost original author/call identity: %+v", issue)
	}
}

func TestDefensePlanGuardAndOutputFailureKeepDifferentReferences(t *testing.T) {
	identity := DefenseIdentity{AbilityRef: "actual-ability", SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}
	_, issue := RequireConfiguredDefense(nil, formula.GenericRegistry{}, "damage/configured", "operations[2]", identity)
	if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != "operations[2].damageType" || issue.Ref != "damage/configured" || issue.SessionID != "session" {
		t.Fatalf("plan guard lost the actual operation and damage type: %+v", issue)
	}
	for _, test := range []struct {
		name, factor, code string
		amount             float64
	}{
		{name: "negative_factor", factor: "-1", amount: 100, code: "FORMULA_INVALID_OUTPUT"},
		{name: "amount_overflow", factor: "2", amount: math.MaxFloat64, code: "FORMULA_NON_FINITE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			formulas, def := defenseFixture(t, formuladefinition.ConstantDefense(test.factor))
			defs := map[string]planbundle.CompiledDamageTypeFormula{def.DamageType: def}
			if _, issue := RequireConfiguredDefense(defs, formulas, def.DamageType, "operations[2]", identity); issue != nil {
				t.Fatal(issue)
			}
			_, issue := ResolveConfiguredDefense(formulas, def, test.amount, attribute.Table{}, attribute.Table{}, identity)
			if issue == nil || string(issue.Code) != test.code || issue.Path != def.OutputPath || issue.Ref != identity.AbilityRef || issue.SchemaHash != identity.SchemaHash || issue.RulesHash != identity.RulesHash || issue.SessionID != identity.SessionID {
				t.Fatalf("output failure lost original formula or call identity: %+v", issue)
			}
		})
	}
}
