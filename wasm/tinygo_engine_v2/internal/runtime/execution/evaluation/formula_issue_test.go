package evaluation

import (
	"errors"
	"fmt"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/expression"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

func formulaIssueFallback() *model.EngineError {
	return &model.EngineError{
		Phase: model.GenericPhaseRun, Code: model.GenericErrFormulaTypeError,
		Message: "original calculation failure", Path: "operations[2].amount", Ref: "original-reference",
		Severity: model.GenericSeverityError, SchemaHash: "schema", RulesHash: "rules", SessionID: "session",
	}
}

func TestPreserveFormulaIssueKeepsAuthorLocationAndActualReferencePriority(t *testing.T) {
	authored := &formula.AuthoredEvaluationError{
		Issue:      expression.ContractIssue{Code: "FORMULA_MISSING_INPUT", Path: "/stages/0/expression"},
		ProgramKey: "game:armor", DefinitionPath: "/formulas/2/expression", CombatantKey: "target",
	}
	member := pipeline.MountedAttributeModifier{OwnerCombatantKey: "target", ProviderRef: "armor-effect", ModifierKey: "boost"}
	authorDetails := map[string]interface{}{
		"usePoint": "operations[2].amount", "formulaKey": "game:armor", "combatantKey": "target",
	}
	groupDetails := map[string]interface{}{
		"attributeGroupSource": true, "attributeKey": "armor", "providerOwner": "target", "providerRef": "armor-effect", "modifierKey": "boost",
	}
	combinedDetails := map[string]interface{}{
		"usePoint": "operations[2].amount", "formulaKey": "game:armor", "combatantKey": "target",
		"attributeGroupSource": true, "attributeKey": "armor", "providerOwner": "target", "providerRef": "armor-effect", "modifierKey": "boost",
	}
	cases := []struct {
		name    string
		err     error
		ability string
		want    model.EngineError
	}{
		{
			name: "ordinary_error", err: errors.New("plain failure"), ability: "actual-ability", want: *formulaIssueFallback(),
		},
		{
			name: "wrapped_author_error", err: fmt.Errorf("calculation: %w", authored), ability: "actual-ability",
			want: model.EngineError{
				Phase: model.GenericPhaseRun, Code: "FORMULA_MISSING_INPUT", Message: "FORMULA_MISSING_INPUT in game:armor",
				Path: "/formulas/2/expression/stages/0/expression", Ref: "actual-ability", Severity: model.GenericSeverityError,
				SchemaHash: "schema", RulesHash: "rules", SessionID: "session", Details: authorDetails,
			},
		},
		{
			name: "author_without_local_ability", err: authored,
			want: model.EngineError{
				Phase: model.GenericPhaseRun, Code: "FORMULA_MISSING_INPUT", Message: "FORMULA_MISSING_INPUT in game:armor",
				Path: "/formulas/2/expression/stages/0/expression", Ref: "original-reference", Severity: model.GenericSeverityError,
				SchemaHash: "schema", RulesHash: "rules", SessionID: "session", Details: authorDetails,
			},
		},
		{
			name: "group_wraps_author", ability: "actual-ability",
			err: &pipeline.AttributeGroupIssue{AttributeKey: "armor", Member: member, ValuePath: "modifier.value", Cause: fmt.Errorf("wrapped: %w", authored)},
			want: model.EngineError{
				Phase: model.GenericPhaseRun, Code: "FORMULA_MISSING_INPUT", Message: "FORMULA_MISSING_INPUT in game:armor",
				Path: "/formulas/2/expression/stages/0/expression", Ref: "target.provider[armor-effect].modifier[boost]", Severity: model.GenericSeverityError,
				SchemaHash: "schema", RulesHash: "rules", SessionID: "session", Details: combinedDetails,
			},
		},
		{
			name: "group_without_author", ability: "actual-ability",
			err: fmt.Errorf("wrapped: %w", &pipeline.AttributeGroupIssue{AttributeKey: "armor", Member: member, ValuePath: "modifier.value", Cause: errors.New("product overflow")}),
			want: model.EngineError{
				Phase: model.GenericPhaseRun, Code: model.GenericErrFormulaTypeError, Message: "original calculation failure",
				Path: "modifier.value", Ref: "target.provider[armor-effect].modifier[boost]", Severity: model.GenericSeverityError,
				SchemaHash: "schema", RulesHash: "rules", SessionID: "session", Details: groupDetails,
			},
		},
	}
	for _, scenario := range cases {
		t.Run(scenario.name, func(t *testing.T) {
			fallback := formulaIssueFallback()
			got := PreserveFormulaIssue(scenario.err, fallback, scenario.ability)
			if got != fallback || !reflect.DeepEqual(*got, scenario.want) {
				t.Fatalf("error location, identity or reference changed: got %+v details=%#v; want %+v details=%#v", got, got.Details, scenario.want, scenario.want.Details)
			}
		})
	}
}

func TestPreserveFormulaIssueUsesDetailPresenceWithoutManufacturingFields(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		details map[string]interface{}
		wantRef string
	}{
		{name: "no_details", wantRef: "original-reference"},
		{name: "existing_formula_key", details: map[string]interface{}{"formulaKey": "original-formula"}, wantRef: "actual-ability"},
		{name: "present_group_marker", details: map[string]interface{}{"formulaKey": "original-formula", "attributeGroupSource": false}, wantRef: "original-reference"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fallback := formulaIssueFallback()
			fallback.Details = scenario.details
			want := *fallback
			want.Ref = scenario.wantRef
			got := PreserveFormulaIssue(errors.New("unrelated error"), fallback, "actual-ability")
			if got != fallback || !reflect.DeepEqual(*got, want) {
				t.Fatalf("ordinary error manufactured details or changed reference priority: %+v details=%#v", got, got.Details)
			}
		})
	}
}

func TestPreserveFormulaIssueRetainsThirtyTwoLayerUnwrapBoundary(t *testing.T) {
	for _, wrappers := range []int{31, 32} {
		t.Run(fmt.Sprint(wrappers), func(t *testing.T) {
			var cause error = &formula.AuthoredEvaluationError{
				Issue:      expression.ContractIssue{Code: "FORMULA_LIMIT", Path: "/result"},
				ProgramKey: "nested", DefinitionPath: "/formulas/3/expression",
			}
			for depth := 0; depth < wrappers; depth++ {
				cause = fmt.Errorf("layer: %w", cause)
			}
			fallback := formulaIssueFallback()
			want := *formulaIssueFallback()
			if wrappers == 31 {
				want.Code, want.Path, want.Message, want.Ref = "FORMULA_LIMIT", "/formulas/3/expression/result", "FORMULA_LIMIT in nested", "actual-ability"
				want.Details = map[string]interface{}{"usePoint": "operations[2].amount", "formulaKey": "nested"}
			}
			got := PreserveFormulaIssue(cause, fallback, "actual-ability")
			if got != fallback || !reflect.DeepEqual(*got, want) {
				t.Fatalf("unwrap boundary changed after %d wrappers: got %+v details=%#v; want %+v", wrappers, got, got.Details, want)
			}
		})
	}
}
