package model

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

const automaticRuleJSON = `{"ruleKey":"a","bindingKey":"binding_a","sortOrder":0,"target":"target","hitBindings":[],"waitForCooldowns":[],"releaseAfterRuleKey":null}`

func TestAutomaticSkillPlanStrictShape(t *testing.T) {
	valid := `{"rules":[` + automaticRuleJSON + `]}`
	var plan AutomaticSkillPlan
	if err := json.Unmarshal([]byte(valid), &plan); err != nil || len(plan.Rules) != 1 || plan.Rules[0].ReleaseAfterRuleKey != nil {
		t.Fatal(err, plan)
	}
	invalid := []string{
		`null`, `[]`, `{}`, `{"rules":null}`, `{"rules":[]}`, `{"rules":[null]}`,
		strings.Replace(valid, `"rules":`, `"extra":1,"rules":`, 1),
		strings.Replace(valid, `"rules":`, `"rules":[],"rules":`, 1),
		strings.Replace(valid, `"sortOrder":0`, `"sortOrder":0.5`, 1),
		strings.Replace(valid, `"sortOrder":0`, `"sortOrder":16`, 1),
		strings.Replace(valid, `"target":"target"`, `"target":"other"`, 1),
		strings.Replace(valid, `"ruleKey":"a"`, `"ruleKey":" a"`, 1),
		strings.Replace(valid, `"ruleKey":"a"`, `"ruleKey":"b","ruleKey":"a"`, 1),
		strings.Replace(valid, `"ruleKey":"a"`, `"extra":true,"ruleKey":"a"`, 1),
		strings.Replace(valid, `"waitForCooldowns":[]`, `"waitForCooldowns":["a"]`, 1),
		strings.Replace(valid, `"waitForCooldowns":[]`, `"waitForCooldowns":["b","b"]`, 1),
		strings.Replace(valid, `"waitForCooldowns":[]`, `"waitForCooldowns":[null]`, 1),
		strings.Replace(valid, `"releaseAfterRuleKey":null`, `"releaseAfterRuleKey":"a"`, 1),
		strings.Replace(valid, `"hitBindings":[]`, `"hitBindings":[{"hitBindingKey":"hit","preset":"UNKNOWN"}]`, 1),
		strings.Replace(valid, `"hitBindings":[]`, `"hitBindings":[{"hitBindingKey":"hit","preset":"MISS"},{"hitBindingKey":"hit","preset":"TARGET_HIT"}]`, 1),
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(automaticRuleJSON), &fields); err != nil {
		t.Fatal(err)
	}
	for key := range fields {
		copy := make(map[string]json.RawMessage, len(fields))
		for k, v := range fields {
			copy[k] = v
		}
		delete(copy, key)
		raw, _ := json.Marshal(copy)
		invalid = append(invalid, `{"rules":[`+string(raw)+`]}`)
		if key != "releaseAfterRuleKey" {
			copy[key] = json.RawMessage(`null`)
			raw, _ = json.Marshal(copy)
			invalid = append(invalid, `{"rules":[`+string(raw)+`]}`)
		}
	}
	for _, raw := range invalid {
		if err := json.Unmarshal([]byte(raw), &plan); err == nil {
			t.Fatalf("accepted invalid automatic shape %s", raw)
		}
	}
}

func TestAutomaticSkillPlanRuleBoundAndUniqueIdentity(t *testing.T) {
	for _, count := range []int{1, 16, 17} {
		plan := AutomaticSkillPlan{Rules: []AutomaticSkillRule{}}
		for index := 0; index < count; index++ {
			key := strconv.Itoa(index)
			plan.Rules = append(plan.Rules, AutomaticSkillRule{RuleKey: "rule_" + key, BindingKey: "binding_" + key, SortOrder: index, Target: "target", HitBindings: []SkillActionHitPreset{}, WaitForCooldowns: []string{}})
		}
		if (plan.Validate() == nil) != (count <= 16) {
			t.Fatal(count, plan.Validate())
		}
	}
	for _, key := range []string{"ruleKey", "bindingKey", "sortOrder"} {
		rule := strings.Replace(automaticRuleJSON, `"ruleKey":"a"`, `"ruleKey":"b"`, 1)
		if key != "bindingKey" {
			rule = strings.Replace(rule, `"bindingKey":"binding_a"`, `"bindingKey":"binding_b"`, 1)
		}
		if key != "sortOrder" {
			rule = strings.Replace(rule, `"sortOrder":0`, `"sortOrder":1`, 1)
		}
		if key == "ruleKey" {
			rule = strings.Replace(rule, `"ruleKey":"b"`, `"ruleKey":"a"`, 1)
		}
		var plan AutomaticSkillPlan
		if err := json.Unmarshal([]byte(`{"rules":[`+automaticRuleJSON+`,`+rule+`]}`), &plan); err == nil || !strings.Contains(err.Error(), "."+key) {
			t.Fatal(key, err)
		}
	}
}

func TestAutomaticRunRequiresExplicitEmptyFacts(t *testing.T) {
	valid := `{"driverPlan":{"entries":[],"skillActions":[],"automaticSkills":{"rules":[` + automaticRuleJSON + `]}},"skillUses":[],"skillHitFacts":[],"attackStartFacts":[],"processCommandFacts":[]}`
	var request RunRequest
	if err := json.Unmarshal([]byte(valid), &request); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"entries", "skillActions", "skillUses", "skillHitFacts", "attackStartFacts", "processCommandFacts"} {
		for _, invalid := range []string{
			strings.Replace(valid, `"`+key+`":[],`, "", 1),
			strings.Replace(valid, `,"`+key+`":[]`, "", 1),
			strings.Replace(valid, `"`+key+`":[]`, `"`+key+`":null`, 1),
			strings.Replace(valid, `"`+key+`":[]`, `"`+key+`":[{}]`, 1),
		} {
			if invalid != valid && json.Unmarshal([]byte(invalid), &request) == nil {
				t.Fatalf("accepted invalid %s: %s", key, invalid)
			}
		}
	}
	for _, raw := range []string{
		strings.Replace(valid, `"automaticSkills":{`, `"automaticSkills":null,"removed":{`, 1),
		strings.Replace(valid, `"entries":[]`, `"entries":[],"entries":[]`, 1),
		strings.Replace(valid, `"entries":[]`, `"basicAttack":null,"entries":[]`, 1),
		strings.Replace(valid, `"skillUses":[]`, `"skillUses":[],"skillUses":[]`, 1),
	} {
		if json.Unmarshal([]byte(raw), &request) == nil {
			t.Fatal("accepted invalid automatic run", raw)
		}
	}
	encoded, err := json.Marshal(requestFromAutomaticJSON(t, valid))
	if err != nil || json.Unmarshal(encoded, &request) != nil {
		t.Fatal("automatic empty arrays lost during canonical transport", string(encoded), err)
	}
}

func requestFromAutomaticJSON(t *testing.T, raw string) RunRequest {
	t.Helper()
	var request RunRequest
	if err := json.Unmarshal([]byte(raw), &request); err != nil {
		t.Fatal(err)
	}
	return request
}

func TestAutomaticRecordBudgetStrictZeroAndOmission(t *testing.T) {
	for _, raw := range []string{`{}`, `{"maxAutomaticSkillRecords":0}`, `{"maxAutomaticSkillRecords":4096}`} {
		var budget RecordBudget
		if err := json.Unmarshal([]byte(raw), &budget); err != nil {
			t.Fatal(raw, err)
		}
		if (budget.MaxAutomaticSkillRecords == nil) != (raw == `{}`) {
			t.Fatal("omission and zero were conflated", raw, budget)
		}
	}
	for _, raw := range []string{`{"maxAutomaticSkillRecords":null}`, `{"maxAutomaticSkillRecords":-1}`, `{"maxAutomaticSkillRecords":4097}`, `{"maxAutomaticSkillRecords":0.5}`, `{"maxAutomaticSkillRecords":"0"}`, `{"maxAutomaticSkillRecords":0,"maxAutomaticSkillRecords":1}`} {
		var budget RecordBudget
		if json.Unmarshal([]byte(raw), &budget) == nil {
			t.Fatal("accepted invalid automatic record budget", raw)
		}
	}
}

func TestAutomaticResultShapeKeepsNullFactsAndHidesManualRecords(t *testing.T) {
	result := DoneResult{
		AutomaticSkillSummary:   &AutomaticSkillSummary{RuleCount: 1, Rules: []AutomaticSkillRuleSummary{{RuleKey: "a"}}, Qualifications: []AutomaticSkillQualification{{GrantorRuleKey: "a", ConsumerRuleKey: "b"}}},
		AutomaticSkillRecording: &AutomaticSkillRecording{},
		Summary:                 RunSummary{SkillActions: &SkillActionSummary{}, SourceHpLoss: 37},
		SkillActionRecords:      []SkillActionRecord{}, SkillUseRecords: []SkillUseRecord{},
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if string(fields["automaticSkillRecords"]) != `[]` || fields["automaticSkillSummary"] == nil || fields["automaticSkillRecording"] == nil || fields["skillActionRecords"] != nil || fields["skillUseRecords"] != nil {
		t.Fatal(string(encoded))
	}
	var summary map[string]json.RawMessage
	if err := json.Unmarshal(fields["summary"], &summary); err != nil || summary == nil {
		t.Fatalf("missing or invalid summary: %s (%v)", fields["summary"], err)
	}
	if summary["skillActions"] != nil || string(summary["sourceHpLoss"]) != "37" {
		t.Fatal(string(encoded))
	}
	for _, fragment := range []string{`"waiting":null`, `"lastGrantUseRef":null`, `"lastConsumeUseRef":null`} {
		if !strings.Contains(string(encoded), fragment) {
			t.Fatal("missing nullable automatic result field", fragment, string(encoded))
		}
	}
	record, err := json.Marshal(AutomaticSkillRecord{Sequence: 1, Kind: AutomaticRecordWaitChanged, RuleKey: "a"})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"useRef", "relatedRuleKey", "relatedUseRef", "reason", "nextCheckAtMs"} {
		if !strings.Contains(string(record), `"`+key+`":null`) {
			t.Fatal(string(record))
		}
	}
	manual, err := json.Marshal(DoneResult{})
	if err != nil || strings.Contains(string(manual), "automaticSkill") {
		t.Fatal("automatic fields leaked to a nonautomatic run", string(manual), err)
	}
}
