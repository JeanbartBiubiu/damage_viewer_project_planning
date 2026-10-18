package model

import (
	"encoding/json"
	"testing"
)

func TestSceneParameterSourceTransportHasExactExplicitValueShape(t *testing.T) {
	for _, raw := range []string{
		`{"kind":"scene_parameter","value":0}`,
		`{"kind":"scene_parameter","value":-5}`,
		`{"kind":"scene_parameter","value":1.25}`,
		`{"kind":"scene_parameter","value":1e100}`,
	} {
		var source FormulaRuntimeSource
		if err := json.Unmarshal([]byte(raw), &source); err != nil || source.Value == nil || source.Kind != "scene_parameter" {
			t.Fatal(raw, source, err)
		}
		roundtrip, err := json.Marshal(source)
		if err != nil {
			t.Fatal(err)
		}
		var copy FormulaRuntimeSource
		if err := json.Unmarshal(roundtrip, &copy); err != nil || copy.Value == nil || *copy.Value != *source.Value {
			t.Fatal("explicit value, including zero, was lost", string(roundtrip), err)
		}
	}
	for _, raw := range []string{
		`null`, `[]`, `0`,
		`{"kind":"scene_parameter"}`,
		`{"kind":"scene_parameter","value":null}`,
		`{"kind":"scene_parameter","value":"0"}`,
		`{"kind":"scene_parameter","value":false}`,
		`{"kind":"scene_parameter","value":[]}`,
		`{"kind":"scene_parameter","value":{}}`,
		`{"kind":"scene_parameter","value":1e400}`,
		`{"kind":"scene_parameter","value":NaN}`,
		`{"kind":"scene_parameter","value":Infinity}`,
		`{"kind":"scene_parameter","value":0,"resourceKey":"mana"}`,
		`{"kind":"scene_parameter","value":0,"resourceKey":""}`,
		`{"kind":"scene_parameter","value":0,"resourceKey":null}`,
		`{"kind":"scene_parameter","value":0,"extra":0}`,
		`{"kind":"scene_parameter","value":0,"value":1}`,
		`{"kind":"scene_parameter","kind":"ability_parameter","value":0}`,
		`{"value":0}`,
	} {
		var source FormulaRuntimeSource
		if err := json.Unmarshal([]byte(raw), &source); err == nil {
			t.Fatal("invalid frozen source accepted", raw)
		}
	}
}

func TestSceneParameterDoesNotRelaxOtherSourceTransport(t *testing.T) {
	for _, source := range []string{
		`{"kind":"use_charge_duration"`,
		`{"kind":"ability_parameter"`,
		`{"kind":"process_actual_cost","resourceKey":"mana"`,
	} {
		var decoded FormulaRuntimeSource
		if err := json.Unmarshal([]byte(source+`}`), &decoded); err != nil {
			t.Fatal("existing source rejected", source, err)
		}
		for _, value := range []string{`0`, `null`, `"0"`} {
			if err := json.Unmarshal([]byte(source+`,"value":`+value+`}`), &decoded); err == nil {
				t.Fatal("frozen value leaked into another source", source, value)
			}
		}
	}
}
