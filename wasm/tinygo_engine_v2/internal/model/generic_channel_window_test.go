package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProcessChannelWindowStepShape(test *testing.T) {
	valid := `{"stepKey":"channel","stepType":"CHANNEL","occupiesAction":true,"durationMs":{"op":"const","value":3000},"executionCount":{"op":"const","value":14},"firstExecution":"CUSTOM_WINDOW","firstExecutionOffsetMs":{"op":"const","value":50},"lastExecutionOffsetMs":{"op":"const","value":2900}}`
	var step ProcessStepDefinition
	if err := json.Unmarshal([]byte(valid), &step); err != nil || step.FirstExecutionOffsetMs == nil || step.LastExecutionOffsetMs == nil {
		test.Fatal(step, err)
	}
	encoded, err := json.Marshal(step)
	if err != nil || json.Unmarshal(encoded, &step) != nil {
		test.Fatal("channel window shape did not round-trip", err)
	}
	for name, invalid := range map[string]string{
		"missing_first":  strings.Replace(valid, `"firstExecutionOffsetMs":{"op":"const","value":50},`, "", 1),
		"missing_last":   strings.Replace(valid, `,"lastExecutionOffsetMs":{"op":"const","value":2900}`, "", 1),
		"null_first":     strings.Replace(valid, `"firstExecutionOffsetMs":{"op":"const","value":50}`, `"firstExecutionOffsetMs":null`, 1),
		"null_last":      strings.Replace(valid, `"lastExecutionOffsetMs":{"op":"const","value":2900}`, `"lastExecutionOffsetMs":null`, 1),
		"immediate":      strings.Replace(valid, `"CUSTOM_WINDOW"`, `"IMMEDIATE"`, 1),
		"after_interval": strings.Replace(valid, `"CUSTOM_WINDOW"`, `"AFTER_INTERVAL"`, 1),
		"multi_hit":      strings.Replace(valid, `"CHANNEL"`, `"MULTI_HIT"`, 1),
		"unknown":        strings.Replace(valid, `"stepKey"`, `"extra":0,"stepKey"`, 1),
		"scalar_first":   strings.Replace(valid, `"firstExecutionOffsetMs":{"op":"const","value":50}`, `"firstExecutionOffsetMs":50`, 1),
	} {
		test.Run(name, func(test *testing.T) {
			if err := json.Unmarshal([]byte(invalid), &step); err == nil {
				test.Fatal("invalid channel window shape accepted", invalid)
			}
		})
	}
}

func TestProcessChannelWindowRepeatShapeRequiresFrozenOffsets(test *testing.T) {
	valid := `{"executionCount":14,"executionIndex":2,"intervalMs":0,"firstExecutionOffsetMs":50,"lastExecutionOffsetMs":2900,"nextExecutionAtMs":488}`
	var repeat ProcessRepeatSnapshot
	if err := json.Unmarshal([]byte(valid), &repeat); err != nil || repeat.FirstExecutionOffsetMs != 50 || repeat.LastExecutionOffsetMs != 2900 {
		test.Fatal(repeat, err)
	}
	for name, invalid := range map[string]string{
		"missing_first": strings.Replace(valid, `"firstExecutionOffsetMs":50,`, "", 1),
		"missing_last":  strings.Replace(valid, `"lastExecutionOffsetMs":2900,`, "", 1),
		"null_first":    strings.Replace(valid, `"firstExecutionOffsetMs":50`, `"firstExecutionOffsetMs":null`, 1),
		"null_last":     strings.Replace(valid, `"lastExecutionOffsetMs":2900`, `"lastExecutionOffsetMs":null`, 1),
		"fraction":      strings.Replace(valid, `"lastExecutionOffsetMs":2900`, `"lastExecutionOffsetMs":2900.5`, 1),
		"missing_next":  strings.Replace(valid, `,"nextExecutionAtMs":488`, "", 1),
	} {
		test.Run(name, func(test *testing.T) {
			if err := json.Unmarshal([]byte(invalid), &repeat); err == nil {
				test.Fatal("incomplete frozen repeat shape accepted", invalid)
			}
		})
	}
	for _, valid := range []string{
		`{"executionCount":1,"executionIndex":1,"intervalMs":0,"firstExecutionOffsetMs":0,"lastExecutionOffsetMs":0,"nextExecutionAtMs":null}`,
		`{"executionCount":2,"executionIndex":0,"intervalMs":0,"firstExecutionOffsetMs":0,"lastExecutionOffsetMs":9007199254740991,"nextExecutionAtMs":0}`,
	} {
		if err := json.Unmarshal([]byte(valid), &repeat); err != nil {
			test.Fatal(err)
		}
		encoded, err := json.Marshal(repeat)
		if err != nil || json.Unmarshal(encoded, &repeat) != nil {
			test.Fatal(err)
		}
	}
}
