package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPlannedStepOccupancyShape(test *testing.T) {
	for _, declaration := range []string{"true", "false", "null"} {
		var step ProcessStepDefinition
		if err := json.Unmarshal([]byte(`{"stepKey":"cast","stepType":"IMMEDIATE","occupiesAction":`+declaration+`}`), &step); err != nil {
			test.Fatal(declaration, err)
		}
	}
	for _, declaration := range []string{`"true"`, `1`, `{}`} {
		var step ProcessStepDefinition
		if err := json.Unmarshal([]byte(`{"stepKey":"cast","stepType":"IMMEDIATE","occupiesAction":`+declaration+`}`), &step); err == nil {
			test.Fatal("invalid boolean shape", declaration)
		}
	}
}

func TestSkillActionBindingStrictShape(test *testing.T) {
	valid := `{"bindingKey":"bind","source":"source","providerRef":"mount","providerDefinitionRef":"definition","skillKey":"skill","controls":[{"action":"INITIAL","processKey":"cast","abilityRef":"ref"}],"hitBindings":[{"hitBindingKey":"hit","processKey":"cast","moment":{"momentType":"PROCESS_COMPLETE","stepKey":null,"failureReason":null},"hitAbilityRef":"hit_ref"}]}`
	var binding SkillActionBinding
	if err := json.Unmarshal([]byte(valid), &binding); err != nil {
		test.Fatal(err)
	}
	for _, invalid := range []string{strings.Replace(valid, `"controls":[`, `"unknown":0,"controls":[`, 1), strings.Replace(valid, `"hitBindings":[`, `"hitBindings":null,"removed":[`, 1), strings.Replace(valid, `"processKey":"cast"`, `"processKey":null`, 1), strings.Replace(valid, `"stepKey":null,`, "", 1)} {
		if json.Unmarshal([]byte(invalid), &binding) == nil {
			test.Fatal("invalid binding shape accepted")
		}
	}
}

func TestSkillActionPlanAndRetentionShape(test *testing.T) {
	valid := `{"instructionKey":"once","firstAtMs":0,"sortOrder":0,"source":"source","target":"target","skillKey":"skill","bindingKey":"bind","action":"INITIAL","abilityRef":"ref","parentInstructionKey":null,"hitBindings":[]}`
	var plan SkillActionPlan
	if err := json.Unmarshal([]byte(valid), &plan); err != nil {
		test.Fatal(err)
	}
	for _, invalid := range []string{strings.Replace(valid, `"firstAtMs":0`, `"firstAtMs":null`, 1), strings.Replace(valid, `"sortOrder":0,`, "", 1), strings.Replace(valid, `"hitBindings":[]`, `"hitBindings":null`, 1), strings.Replace(valid, `"action":"INITIAL"`, `"extra":true,"action":"INITIAL"`, 1)} {
		if json.Unmarshal([]byte(invalid), &plan) == nil {
			test.Fatal("invalid plan shape accepted")
		}
	}
	var budget RecordBudget
	if err := json.Unmarshal([]byte(`{"maxSkillActionRecords":0,"maxSkillUseRecords":0,"maxHealingRecords":0}`), &budget); err != nil {
		test.Fatal(err)
	}
	for _, invalid := range []string{`{"maxSkillActionRecords":null}`, `{"maxSkillUseRecords":10001}`, `{"maxHealingRecords":-1}`} {
		if json.Unmarshal([]byte(invalid), &budget) == nil {
			test.Fatal("invalid skill retention budget accepted")
		}
	}
}
