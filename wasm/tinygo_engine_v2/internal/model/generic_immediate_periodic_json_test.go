package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFinitePeriodicExplicitZeroJSONRoundTrip(t *testing.T) {
	for _, raw := range []string{`{"intervalMs":500,"startDelayMs":0,"onTick":[]}`, `{"intervalMs":500,"startDelayMs":250,"onTick":[]}`} {
		var first, again TickSpec
		if err := json.Unmarshal([]byte(raw), &first); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(first)
		if err != nil || !strings.Contains(string(encoded), `"startDelayMs":`) {
			t.Fatal("explicit delay lost on round trip", string(encoded), err)
		}
		if err := json.Unmarshal(encoded, &again); err != nil || again.StartDelayMs != first.StartDelayMs {
			t.Fatal(again, err)
		}
	}
	var omitted TickSpec
	if err := json.Unmarshal([]byte(`{"intervalMs":500,"onTick":[]}`), &omitted); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(omitted)
	if strings.Contains(string(encoded), "startDelayMs") {
		t.Fatal("omitted delay was made explicit", string(encoded))
	}
}

func TestFinitePeriodicDelayStrictJSON(t *testing.T) {
	for _, delay := range []string{"null", "-1", "0.5", `"0"`, "true", "9007199254740992"} {
		t.Run(delay, func(t *testing.T) {
			var tick TickSpec
			if err := json.Unmarshal([]byte(`{"intervalMs":500,"startDelayMs":`+delay+`,"onTick":[]}`), &tick); err == nil {
				t.Fatal("invalid delay accepted", delay)
			}
		})
	}
	var tick TickSpec
	if err := json.Unmarshal([]byte(`{"intervalMs":500,"startDelayMs":0,"onTick":[],"unknown":0}`), &tick); err == nil {
		t.Fatal("unknown field accepted")
	}
}
