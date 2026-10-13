package model

import (
	"encoding/json"
	"testing"
)

func TestAuthoringDamageFormulaTransportPreservesCommonRawDefinition(t *testing.T) {
	valid := []byte(`{"damageType":"heat","formula":{"inputs":[],"stages":[{"key":"factor","name":"倍率","expression":{"op":"const","value":"0.000"}}],"outputStageKey":"factor"}}`)
	var def DamageTypeFormulaDefinition
	if err := json.Unmarshal(valid, &def); err != nil {
		t.Fatal(err)
	}
	root := def.Formula.(map[string]any)
	literal := root["stages"].([]any)[0].(map[string]any)["expression"].(map[string]any)["value"]
	if def.DamageType != "heat" || literal != "0.000" {
		t.Fatal(def)
	}
	for _, raw := range []string{`{"damageType":"heat"}`, `{"damageType":"heat","formula":null}`, `{"damageType":"heat","formula":{},"extra":0}`} {
		if err := json.Unmarshal([]byte(raw), &def); err == nil {
			t.Fatal("invalid outer transport accepted", raw)
		}
	}
}

func TestAuthoringProcessEventBindingRejectsNull(t *testing.T) {
	var control ProcessControlDefinition
	if err := json.Unmarshal([]byte(`{"processKey":"p","action":"INITIAL","useRefFromEvent":true}`), &control); err != nil || !control.UseRefFromEvent {
		t.Fatal(control, err)
	}
	if err := json.Unmarshal([]byte(`{"processKey":"p","action":"INITIAL","useRefFromEvent":null}`), &control); err == nil {
		t.Fatal("null event binding silently became the driver path")
	}
}
