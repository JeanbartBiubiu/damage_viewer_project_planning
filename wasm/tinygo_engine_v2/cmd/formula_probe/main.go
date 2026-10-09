// 独立的纯公式TinyGo验证入口，不提供正式战斗ABI，也不进入Web产物。
package main

import (
	"encoding/json"
	"math"
	"strconv"

	"tinygo_engine_v2/internal/expression"
	"tinygo_engine_v2/internal/inputbinding"
)

const twoStages = `{"inputs":[{"key":"res","binding":{"kind":"attribute","object":"target","attributeKey":"heat_resistance","valueKind":"TOTAL","view":"current_frame"}}],"stages":[{"key":"resistance","name":"抗性","expression":{"op":"read","inputKey":"res"}},{"key":"factor","name":"倍率","expression":{"op":"div","args":[{"op":"const","value":"100"},{"op":"add","args":[{"op":"const","value":"100"},{"op":"ref","stageKey":"resistance"}]}]}}],"outputStageKey":"factor"}`

func compile(raw string) (*expression.Program, *expression.ContractIssue) {
	var definition any
	if err := json.Unmarshal([]byte(raw), &definition); err != nil {
		return nil, &expression.ContractIssue{Code: "FORMULA_INVALID_STRUCTURE"}
	}
	root := definition.(map[string]any)
	allowed := []any{}
	for _, item := range root["inputs"].([]any) {
		allowed = append(allowed, item.(map[string]any)["binding"])
	}
	return expression.CompileDefinition(definition, allowed)
}

//export formula_probe_check
func formulaProbeCheck(index uint32) uint32 {
	p, issue := compile(twoStages)
	if issue != nil {
		return 1
	}
	bindings := []expression.Binding{p.Inputs()[0].Binding}
	if index == 1 || index == 2 {
		var root map[string]any
		if json.Unmarshal([]byte(twoStages), &root) != nil {
			return 2
		}
		stages := root["stages"].([]any)
		if index == 1 {
			for i := 0; i < 4; i++ {
				key := "extra" + strconv.Itoa(i)
				stages = append(stages, map[string]any{"key": key, "name": "普通结果", "expression": map[string]any{"op": "ref", "stageKey": root["outputStageKey"]}})
				root["outputStageKey"] = key
			}
		} else {
			stages[0], stages[1] = stages[1], stages[0]
			stages[0].(map[string]any)["name"] = "新显示名称"
		}
		root["stages"] = stages
		p, issue = expression.CompileDefinition(root, []any{root["inputs"].([]any)[0].(map[string]any)["binding"]})
		if issue != nil {
			return 3
		}
	}
	if index <= 4 {
		plan, issue := inputbinding.Bind(p, bindings)
		if issue != nil {
			return 4
		}
		values := []inputbinding.Value{{Total: inputbinding.Scalar{Value: 50, Present: true}}}
		if index == 3 {
			values[0].Total.Present = false
		}
		if index == 4 {
			values[0].Total.Value = math.Inf(1)
		}
		reader, issue := plan.Reader(values)
		if issue != nil {
			return 5
		}
		got, issue := p.Evaluate(reader)
		if index == 3 {
			if issue != nil && issue.Code == "FORMULA_MISSING_INPUT" {
				return 0
			}
			return 6
		}
		if index == 4 {
			if issue != nil && issue.Code == "FORMULA_NON_FINITE" {
				return 0
			}
			return 7
		}
		if issue != nil || !(math.Abs(got.Value-2.0/3) <= 1e-9) {
			return 8
		}
		return 0
	}
	if index == 5 || index == 6 || index == 7 {
		raw := `{"inputs":[],"stages":[{"key":"out","name":"结果","expression":{"op":"if","args":[{"op":"const","value":"1"},{"op":"const","value":"0"},{"op":"div","args":[{"op":"const","value":"1"},{"op":"const","value":"0"}]}]}}],"outputStageKey":"out"}`
		if index == 6 {
			raw = `{"inputs":[],"stages":[{"key":"out","name":"结果","expression":{"op":"div","args":[{"op":"const","value":"1"},{"op":"const","value":"0"}]}}],"outputStageKey":"out"}`
		}
		if index == 7 {
			raw = `{"inputs":[],"stages":[{"key":"out","name":"结果","expression":{"op":"round","args":[{"op":"const","value":"-1.5"}],"decimals":0}}],"outputStageKey":"out"}`
		}
		p, issue = compile(raw)
		if issue != nil {
			return 9
		}
		got, issue := p.Evaluate(nil)
		if index == 6 {
			if issue != nil && issue.Code == "FORMULA_DIVISION_BY_ZERO" {
				return 0
			}
			return 10
		}
		want := float64(0)
		if index == 7 {
			want = -2
		}
		if issue != nil || got.Value != want {
			return 11
		}
		return 0
	}
	if index == 8 {
		catalog := make([]expression.Binding, inputbinding.MaxCatalogEntries)
		for i := range catalog {
			catalog[i] = expression.Binding{Kind: "context", ContextKey: "key" + strconv.Itoa(i)}
		}
		catalog[len(catalog)-1] = bindings[0]
		plan, issue := inputbinding.Bind(p, catalog)
		if issue != nil {
			return 12
		}
		values := make([]inputbinding.Value, len(catalog))
		values[len(values)-1].Total = inputbinding.Scalar{Value: 50, Present: true}
		reader, issue := plan.Reader(values)
		if issue != nil {
			return 13
		}
		got, issue := p.Evaluate(reader)
		if issue != nil || !(math.Abs(got.Value-2.0/3) <= 1e-9) {
			return 14
		}
		if _, issue = inputbinding.Bind(p, append(catalog, expression.Binding{Kind: "context", ContextKey: "extra"})); issue == nil || issue.Code != "FORMULA_LIMIT" {
			return 15
		}
		return 0
	}
	if index == 9 {
		p, issue = compile(`{"inputs":[],"stages":[{"key":"out","name":"结果","expression":{"op":"const","value":"1"}}],"outputStageKey":"out"}`)
		if issue != nil {
			return 16
		}
		table := expression.Table{}
		for i := 0; i < expression.MaxPrograms; i++ {
			id, issue := table.Register(strconv.Itoa(i), p, "/programs")
			if issue != nil || int(id) != i {
				return 17
			}
		}
		before := table.Stats()
		if _, issue := table.Register("overflow", p, "/over"); issue == nil || issue.Code != "FORMULA_LIMIT" || table.Stats() != before {
			return 18
		}
		got, issue := table.Evaluate(65535, nil)
		if issue != nil || got.Value != 1 {
			return 19
		}
		return 0
	}
	if index == 10 {
		plan, issue := inputbinding.Bind(p, bindings)
		if issue != nil {
			return 21
		}
		for i := 0; i < 20; i++ {
			resistance := float64(50)
			want := 2.0 / 3
			if i%2 == 0 {
				resistance, want = 0, 1
			}
			reader, issue := plan.Reader([]inputbinding.Value{{Total: inputbinding.Scalar{Value: resistance, Present: true}}})
			if issue != nil {
				return 22
			}
			got, issue := p.Evaluate(reader)
			if issue != nil || !(math.Abs(got.Value-want) <= 1e-9) || got.EvaluatedStages != 2 || got.ReadInputs != 1 {
				return 23
			}
		}
		return 0
	}
	return 20
}

func main() {}
