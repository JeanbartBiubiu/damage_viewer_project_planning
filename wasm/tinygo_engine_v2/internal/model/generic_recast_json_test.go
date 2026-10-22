package model

import (
	"encoding/json"
	"testing"
)

func TestFiniteRecastJSONExplicitCountAndOptionalInterval(t *testing.T) {
	for _, raw := range []string{
		`{"stepKey":"again","stepType":"RECAST","windowMs":{"op":"const","value":15000},"maximumRecastCount":{"op":"const","value":2}}`,
		`{"stepKey":"again","stepType":"RECAST","windowMs":{"op":"const","value":15000},"maximumRecastCount":{"op":"const","value":2},"intervalMs":{"op":"const","value":1000}}`,
	} {
		var step ProcessStepDefinition
		if err := json.Unmarshal([]byte(raw), &step); err != nil {
			t.Fatalf("explicit recast rejected: %v", err)
		}
	}
	for _, raw := range []string{
		`{"stepKey":"again","stepType":"RECAST","windowMs":{"op":"const","value":15000}}`,
		`{"stepKey":"again","stepType":"RECAST","windowMs":{"op":"const","value":15000},"maximumRecastCount":null}`,
		`{"stepKey":"again","stepType":"RECAST","windowMs":{"op":"const","value":15000},"maximumRecastCount":{"op":"const","value":2},"intervalMs":null}`,
	} {
		var step ProcessStepDefinition
		if err := json.Unmarshal([]byte(raw), &step); err == nil {
			t.Fatalf("missing/null declaration accepted: %s", raw)
		}
	}
}
