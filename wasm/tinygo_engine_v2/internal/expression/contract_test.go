package expression

import (
	"encoding/json"
	"testing"
)

func TestContractSharedCases(t *testing.T) {
	var corpus struct {
		SchemaSHA256 string `json:"schemaSha256"`
		Cases        []struct {
			Name            string         `json:"name"`
			Definition      any            `json:"definition"`
			AllowedBindings []any          `json:"allowedBindings"`
			Expected        *ContractIssue `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal([]byte(contractCasesJSON), &corpus); err != nil {
		t.Fatal(err)
	}
	if corpus.SchemaSHA256 != contractSchemaSHA256 {
		t.Fatal("共同样例和结构规范摘要不一致")
	}
	if len(corpus.Cases) == 0 {
		t.Fatal("共同样例为空")
	}
	for _, sample := range corpus.Cases {
		t.Run(sample.Name, func(t *testing.T) {
			before, err := json.Marshal(sample.Definition)
			if err != nil {
				t.Fatal(err)
			}
			got := ValidateDefinition(sample.Definition, sample.AllowedBindings)
			if sample.Expected == nil && got != nil || sample.Expected != nil && (got == nil || *got != *sample.Expected) {
				t.Fatalf("got %+v, want %+v", got, sample.Expected)
			}
			after, err := json.Marshal(sample.Definition)
			if err != nil || string(after) != string(before) {
				t.Fatal("校验修改了作者定义或十进制原文")
			}
		})
	}
}

func TestContractPreservesDecimalText(t *testing.T) {
	const raw = `{"inputs":[],"stages":[{"key":"result","name":"结果","expression":{"op":"const","value":"1.000000000000000000001"}}],"outputStageKey":"result"}`
	var definition any
	if err := json.Unmarshal([]byte(raw), &definition); err != nil {
		t.Fatal(err)
	}
	if issue := ValidateDefinition(definition, nil); issue != nil {
		t.Fatal(issue)
	}
	stage := contractMap(contractArray(contractMap(definition)["stages"])[0])
	if contractMap(stage["expression"])["value"] != "1.000000000000000000001" {
		t.Fatal("十进制常量被转换")
	}
}

func TestContractExactJSONNumberIntegers(t *testing.T) {
	for _, text := range []string{"1.000000000000000000001", "12.000000000000000000001", "0.000000000000000000000000000000001"} {
		if _, ok := contractInteger(json.Number(text)); ok {
			t.Fatalf("非整数原文被浮点舍入后接受：%s", text)
		}
	}
	for _, text := range []string{"1.0", "12.000", "10e-1", "0.000", "-0.0", "1e0", "0e2147483648", "-0e-2147483649"} {
		if _, ok := contractInteger(json.Number(text)); !ok {
			t.Fatalf("合法数学整数被拒绝：%s", text)
		}
	}

	for _, text := range []string{"1.000000000000000000001", "12.000000000000000000001", "1.0"} {
		definition := map[string]any{
			"inputs": []any{}, "outputStageKey": "result",
			"stages": []any{map[string]any{"key": "result", "name": "结果", "expression": map[string]any{
				"op": "round", "decimals": json.Number(text), "args": []any{map[string]any{"op": "const", "value": "1"}},
			}}},
		}
		issue := ValidateDefinition(definition, nil)
		if text == "1.0" {
			if issue != nil {
				t.Fatal(issue)
			}
		} else if issue == nil || issue.Code != "FORMULA_INVALID_STRUCTURE" || issue.Path != "/stages/0/expression/decimals" {
			t.Fatalf("非法整数问题不符：%+v", issue)
		}
	}
}
