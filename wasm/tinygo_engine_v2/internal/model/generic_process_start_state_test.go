package model

import (
	"encoding/json"
	"testing"
)

func TestProcessStartStateRuntimeSourceStrictJSON(t *testing.T) {
	for _, raw := range []string{
		`{"kind":"process_start_state","stateKey":"capture"}`,
		`{"kind":"process_start_state"}`,
		`{"kind":"process_start_state","stateKey":null}`,
		`{"kind":"process_start_state","stateKey":"capture","value":null}`,
		`{"kind":"process_start_state","stateKey":"capture","resourceKey":"hp"}`,
		`{"kind":"process_start_state","stateKey":"capture","default":0}`,
		`{"kind":"ability_parameter","stateKey":"capture"}`,
	} {
		var source FormulaRuntimeSource
		err := json.Unmarshal([]byte(raw), &source)
		if (err == nil) != (raw == `{"kind":"process_start_state","stateKey":"capture"}`) {
			t.Fatal(raw, err)
		}
	}
}
