package inputbinding

import (
	"fmt"
	"math"
	"testing"

	"tinygo_engine_v2/internal/expression"
)

func bindingDefinition(binding expression.Binding, lazy bool) (any, any) {
	item := map[string]any{"kind": binding.Kind}
	switch binding.Kind {
	case "attribute":
		item["object"], item["attributeKey"], item["valueKind"], item["view"] = binding.Object, binding.AttributeKey, binding.ValueKind, binding.View
	case "parameter":
		item["skillKey"], item["parameterKey"] = binding.SkillKey, binding.ParameterKey
	case "context":
		item["contextKey"] = binding.ContextKey
	}
	var expr any = map[string]any{"op": "read", "inputKey": "value"}
	if lazy {
		expr = map[string]any{"op": "if", "args": []any{map[string]any{"op": "const", "value": "1"}, map[string]any{"op": "const", "value": "8"}, expr}}
	}
	return map[string]any{"inputs": []any{map[string]any{"key": "value", "binding": item}}, "stages": []any{map[string]any{"key": "result", "name": "结果", "expression": expr}}, "outputStageKey": "result"}, item
}

func compileBinding(t *testing.T, binding expression.Binding, lazy bool) *expression.Program {
	t.Helper()
	raw, allowed := bindingDefinition(binding, lazy)
	p, issue := expression.CompileDefinition(raw, []any{allowed})
	if issue != nil {
		t.Fatal(issue)
	}
	return p
}

func TestAttributeValueKindsAndLegalZero(t *testing.T) {
	value := Value{Base: Scalar{0, true}, Total: Scalar{200, true}, Current: Scalar{50, true}, Max: Scalar{100, true}}
	for kind, want := range map[string]float64{"BASE": 0, "BONUS": 200, "TOTAL": 200, "CURRENT": 50, "MAX": 100, "MISSING": 50, "CURRENT_RATIO": 0.5, "MISSING_RATIO": 0.5} {
		t.Run(kind, func(t *testing.T) {
			binding := expression.Binding{Kind: "attribute", Object: "target", AttributeKey: "heat_resistance", ValueKind: kind, View: "current_frame"}
			p := compileBinding(t, binding, false)
			plan, issue := Bind(p, []expression.Binding{binding})
			if issue != nil {
				t.Fatal(issue)
			}
			reader, issue := plan.Reader([]Value{value})
			if issue != nil {
				t.Fatal(issue)
			}
			got, issue := p.Evaluate(reader)
			if issue != nil || got.Value != want {
				t.Fatalf("got %+v %+v want%v", got, issue, want)
			}
		})
	}
}

func TestBindingMissingNonfiniteAndLazyBranches(t *testing.T) {
	binding := expression.Binding{Kind: "attribute", Object: "event_source", AttributeKey: "health", ValueKind: "CURRENT_RATIO", View: "event_snapshot"}
	for _, sample := range []struct {
		name  string
		value Value
		code  string
	}{
		{"missing", Value{}, "FORMULA_MISSING_INPUT"},
		{"zero_max", Value{Current: Scalar{0, true}, Max: Scalar{0, true}}, "FORMULA_DIVISION_BY_ZERO"},
		{"infinity", Value{Current: Scalar{math.Inf(1), true}, Max: Scalar{100, true}}, "FORMULA_NON_FINITE"},
	} {
		t.Run(sample.name, func(t *testing.T) {
			for _, lazy := range []bool{false, true} {
				p := compileBinding(t, binding, lazy)
				plan, issue := Bind(p, []expression.Binding{binding})
				if issue != nil {
					t.Fatal(issue)
				}
				reader, issue := plan.Reader([]Value{sample.value})
				if issue != nil {
					t.Fatal(issue)
				}
				got, issue := p.Evaluate(reader)
				if lazy {
					if issue != nil || got.Value != 8 || got.ReadInputs != 0 {
						t.Fatalf("lazy input read %+v %+v", got, issue)
					}
				} else if issue == nil || issue.Code != sample.code || issue.Path != "/stages/0/expression/inputKey" {
					t.Fatalf("got %+v", issue)
				}
			}
		})
	}
}

func TestBindingObjectViewParameterIdentityAndFrozenReader(t *testing.T) {
	for _, binding := range []expression.Binding{
		{Kind: "parameter", SkillKey: "heat_spell", ParameterKey: "amount"},
		{Kind: "context", ContextKey: "charge_duration_ms"},
	} {
		p := compileBinding(t, binding, false)
		catalog := []expression.Binding{binding}
		plan, issue := Bind(p, catalog)
		if issue != nil {
			t.Fatal(issue)
		}
		catalog[0].SkillKey = "changed"
		values := []Value{{Number: Scalar{0, true}}}
		reader, issue := plan.Reader(values)
		if issue != nil {
			t.Fatal(issue)
		}
		values[0].Number.Value = 99
		got, issue := p.Evaluate(reader)
		if issue != nil || got.Value != 0 {
			t.Fatal("reader or plan was not frozen", issue)
		}
		if _, issue := Bind(p, catalog); issue == nil || issue.Code != "FORMULA_UNKNOWN_BINDING" {
			t.Fatal("changed catalog accepted")
		}
	}
	binding := expression.Binding{Kind: "attribute", Object: "source", AttributeKey: "heat_resistance", ValueKind: "TOTAL", View: "event_snapshot"}
	p := compileBinding(t, binding, false)
	for _, mismatch := range []expression.Binding{
		{Kind: "attribute", Object: "owner", AttributeKey: "heat_resistance", ValueKind: "TOTAL", View: "event_snapshot"},
		{Kind: "attribute", Object: "source", AttributeKey: "heat_resistance", ValueKind: "TOTAL", View: "current_frame"},
	} {
		if _, issue := Bind(p, []expression.Binding{mismatch}); issue == nil || issue.Code != "FORMULA_UNKNOWN_BINDING" {
			t.Fatal("object/view changed silently")
		}
	}
}

func TestBindingActualCatalogIndexBoundary(t *testing.T) {
	catalog := make([]expression.Binding, MaxCatalogEntries)
	for i := range catalog {
		catalog[i] = expression.Binding{Kind: "context", ContextKey: fmt.Sprintf("value%d", i)}
	}
	p := compileBinding(t, catalog[len(catalog)-1], false)
	plan, issue := Bind(p, catalog)
	if issue != nil {
		t.Fatal(issue)
	}
	values := make([]Value, MaxCatalogEntries)
	values[MaxCatalogEntries-1].Number = Scalar{19, true}
	reader, issue := plan.Reader(values)
	if issue != nil {
		t.Fatal(issue)
	}
	result, issue := p.Evaluate(reader)
	if issue != nil || result.Value != 19 {
		t.Fatalf("last binding %+v %+v", result, issue)
	}
	catalog = append(catalog, expression.Binding{Kind: "context", ContextKey: "overflow"})
	if _, issue := Bind(p, catalog); issue == nil || issue.Code != "FORMULA_LIMIT" {
		t.Fatal("catalog did not stop at real limit")
	}
	if _, issue := Bind(p, []expression.Binding{catalog[0], catalog[0]}); issue == nil || issue.Code != "FORMULA_DUPLICATE_KEY" {
		t.Fatal("duplicate binding did not fail")
	}
}
