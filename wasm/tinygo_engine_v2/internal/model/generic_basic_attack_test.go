package model

import (
	"encoding/json"
	"testing"
)

func TestContinuousBudgetAndSamplingStrictInput(t *testing.T) {
	for _, raw := range []string{`{"disabled":null}`, `{"sampleEveryMs":null}`, `{"sampleEveryMs":0}`, `{"sampleEveryMs":-1}`, `{"sampleEveryMs":0.5}`, `{"dpsWindowMs":-1}`, `{"maxSeriesPoints":1}`, `{"maxSeriesPoints":5001}`, `{"disabled":"true"}`, `{"other":1}`} {
		var value SamplingConfig
		if json.Unmarshal([]byte(raw), &value) == nil {
			t.Fatalf("accepted invalid sampling %s", raw)
		}
	}
	for _, raw := range []string{`{"maxAttackRecords":null}`, `{"maxDamageRecords":-1}`, `{"maxAttackRecords":4097}`, `{"maxAttackRecords":0.5}`, `{"other":1}`} {
		var value RecordBudget
		if json.Unmarshal([]byte(raw), &value) == nil {
			t.Fatalf("accepted invalid record budget %s", raw)
		}
	}
	var empty SamplingConfig
	if err := json.Unmarshal([]byte(`{}`), &empty); err != nil {
		t.Fatal(err)
	}
	var zero RecordBudget
	if err := json.Unmarshal([]byte(`{"maxAttackRecords":0,"maxDamageRecords":0}`), &zero); err != nil || zero.MaxAttackRecords == nil || *zero.MaxAttackRecords != 0 {
		t.Fatal(err, zero)
	}
}
func TestProcessCooldownOptionalRoundFlagIsStrict(t *testing.T) {
	for _, flag := range []string{"null", `"true"`, "1"} {
		var v ProcessCooldownDefinition
		raw := `{"durationMs":{"op":"const","value":1},"startMoment":{"momentType":"PROCESS_START","stepKey":null,"failureReason":null},"roundPositiveMs":` + flag + `}`
		if json.Unmarshal([]byte(raw), &v) == nil {
			t.Fatalf("accepted flag %s", flag)
		}
	}
}
