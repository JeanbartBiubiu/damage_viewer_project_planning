package model

import (
	"encoding/json"
	"testing"
)

func TestAbilityParameterSourceTransportRejectsResourceFieldEvenEmptyOrNull(t *testing.T) {
	for _, raw := range []string{
		`{"kind":"ability_parameter","resourceKey":"mana"}`,
		`{"kind":"ability_parameter","resourceKey":""}`,
		`{"kind":"ability_parameter","resourceKey":null}`,
		`{"kind":"ability_parameter","value":0}`,
	} {
		var source FormulaRuntimeSource
		if err := json.Unmarshal([]byte(raw), &source); err == nil {
			t.Fatal("invalid ability parameter source accepted", raw)
		}
	}
	var source FormulaRuntimeSource
	if err := json.Unmarshal([]byte(`{"kind":"ability_parameter"}`), &source); err != nil || source.Kind != "ability_parameter" {
		t.Fatal(source, err)
	}
}
