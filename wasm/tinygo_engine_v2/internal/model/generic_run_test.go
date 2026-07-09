package model

import (
	"encoding/json"
	"testing"
)

func TestStopPolicyDefaultsTrueWhenOmitted(t *testing.T) {
	raw := []byte(`{"durationMs":100}`)
	var policy StopPolicy
	if err := json.Unmarshal(raw, &policy); err != nil {
		t.Fatal(err)
	}
	if !policy.StopOnTargetDeathOrDefault() {
		t.Fatal("stopOnTargetDeath should default true")
	}
	if !policy.StopWhenNoEventsOrDefault() {
		t.Fatal("stopWhenNoEvents should default true")
	}
}

func TestStopPolicyExplicitFalse(t *testing.T) {
	raw := []byte(`{"durationMs":100,"stopOnTargetDeath":false,"stopWhenNoEvents":false}`)
	var policy StopPolicy
	if err := json.Unmarshal(raw, &policy); err != nil {
		t.Fatal(err)
	}
	if policy.StopOnTargetDeathOrDefault() {
		t.Fatal("stopOnTargetDeath should be false when set")
	}
	if policy.StopWhenNoEventsOrDefault() {
		t.Fatal("stopWhenNoEvents should be false when set")
	}
}
