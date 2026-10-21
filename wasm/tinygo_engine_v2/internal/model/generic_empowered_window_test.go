package model

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestEmpoweredWindowOptionalCountKeepsOldWireAndRejectsForeignFields(t *testing.T) {
	old := `{"stepKey":"wait","stepType":"EMPOWERED_BASIC_ATTACK","occupiesAction":false,"windowMs":{"op":"const","value":6000},"consumeMoment":"ATTACK_HIT"}`
	var step ProcessStepDefinition
	if err := json.Unmarshal([]byte(old), &step); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(step)
	if err != nil || strings.Contains(string(raw), "maximumAttackCount") {
		t.Fatal(err, string(raw))
	}
	for _, extra := range []string{`,"maximumAttackCount":null`, `,"maximumAttackCount":3`, `,"maximumAttackCount":{"op":"const","value":3},"foreign":1`} {
		if err := json.Unmarshal([]byte(strings.TrimSuffix(old, "}")+extra+"}"), &step); err == nil {
			t.Fatal("invalid optional count accepted", extra)
		}
	}
	valid := strings.Replace(old, `"ATTACK_HIT"`, `"ATTACK_START"`, 1)
	valid = strings.TrimSuffix(valid, "}") + `,"maximumAttackCount":{"op":"const","value":3}}`
	if err := json.Unmarshal([]byte(valid), &step); err != nil || step.MaximumAttackCount == nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(strings.Replace(valid, "EMPOWERED_BASIC_ATTACK", "IMMEDIATE", 1)), &step); err == nil {
		t.Fatal("count leaked to another step")
	}
}

func TestEmpoweredWindowLedgerRoundtripAndRejectsIncompleteOrUnboundedFacts(t *testing.T) {
	valid := `{"maximumAttackCount":3,"consumptionCount":1,"pendingHitCount":1,"consumptions":[{"consumptionIndex":1,"useRef":"basic:actual:1","target":"target","startedAtMs":2000,"hitRef":null,"hitSequence":null,"resolvedAtMs":null}]}`
	var window ProcessEmpoweredAttackWindow
	if err := json.Unmarshal([]byte(valid), &window); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(window)
	var again ProcessEmpoweredAttackWindow
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &again); err != nil || !reflect.DeepEqual(window, again) {
		t.Fatal(err, string(raw))
	}
	for _, bad := range []string{
		strings.Replace(valid, `"maximumAttackCount":3`, `"maximumAttackCount":65`, 1),
		strings.Replace(valid, `"consumptionCount":1`, `"consumptionCount":0`, 1),
		strings.Replace(valid, `"pendingHitCount":1`, `"pendingHitCount":0`, 1),
		strings.Replace(valid, `"hitRef":null,`, "", 1),
		strings.Replace(valid, `"useRef":"basic:actual:1"`, `"useRef":""`, 1),
		strings.Replace(valid, `"hitRef":null`, `"hitRef":"hit:1"`, 1),
		strings.Replace(valid, `"resolvedAtMs":null`, `"resolvedAtMs":1999`, 1),
		strings.Replace(valid, `"consumptionIndex":1`, `"consumptionIndex":2`, 1),
		strings.Replace(valid, `"target":"target"`, `"target":"other"`, 1),
	} {
		if err := json.Unmarshal([]byte(bad), &window); err == nil {
			t.Fatal("incomplete window fact accepted", bad)
		}
	}
}
