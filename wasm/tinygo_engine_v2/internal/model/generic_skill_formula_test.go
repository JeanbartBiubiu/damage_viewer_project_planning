package model

import (
	"encoding/json"
	"testing"
)

func TestPhase3BTransportRejectsOldTreeUnknownNullAndRuntimeSourceShape(t *testing.T) {
	for _, raw := range []string{
		`{"key":"x","expression":{"op":"const","value":1}}`,
		`{"key":"x","scope":"skill","skillKey":"s","expression":{},"parameters":null}`,
		`{"key":"x","scope":"skill","skillKey":"s","expression":{},"parameters":[],"extra":0}`,
		`{"key":"x","scope":"skill","skillKey":"s","expression":{},"parameters":[{"parameterKey":"p","valueMode":"FIXED","valueType":"DECIMAL","value":null}]}`,
		`{"key":"x","scope":"skill","skillKey":"s","expression":{},"parameters":[{"parameterKey":"p","valueMode":"RUNTIME_INPUT","valueType":"DECIMAL","runtimeSource":null}]}`,
		`{"key":"x","scope":"skill","skillKey":"s","expression":{},"parameters":[{"parameterKey":"p","valueMode":"RUNTIME_INPUT","valueType":"DECIMAL","runtimeSource":{"kind":"use_charge_duration","resourceKey":""}}]}`,
		`{"key":"x","scope":"skill","skillKey":"s","expression":{},"parameters":[{"parameterKey":"p","valueMode":"RUNTIME_INPUT","valueType":"DECIMAL","runtimeSource":{"kind":"process_actual_cost"}}]}`,
	} {
		var def NamedFormula
		if err := json.Unmarshal([]byte(raw), &def); err == nil {
			t.Fatal("invalid transport accepted", raw)
		}
	}
	var def NamedFormula
	if err := json.Unmarshal([]byte(`{"key":"x","scope":"skill","skillKey":"s","expression":{},"parameters":[{"parameterKey":"p","valueMode":"FIXED","valueType":"DECIMAL","value":0}]}`), &def); err != nil || def.Parameters[0].Value == nil || *def.Parameters[0].Value != 0 {
		t.Fatal(def, err)
	}
}
