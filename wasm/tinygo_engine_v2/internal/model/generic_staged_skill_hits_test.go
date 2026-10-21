package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStagedSkillHitDependencyJSONShape(t *testing.T) {
	base := `{"hitBindingKey":"later","processKey":"cast","moment":{"momentType":"STEP_EXECUTION","stepKey":"later","failureReason":null},"hitAbilityRef":"source.provider[p].ability[hit]"}`
	for _, extra := range []string{"", `,"requiresPriorHitBindingKey":null`, `,"requiresPriorHitBindingKey":"first"`} {
		var hit SkillActionHitBinding
		if err := json.Unmarshal([]byte(strings.TrimSuffix(base, "}")+extra+"}"), &hit); err != nil {
			t.Fatal(extra, err)
		}
		encoded, err := json.Marshal(hit)
		if err != nil || extra == "" && strings.Contains(string(encoded), "requiresPriorHitBindingKey") {
			t.Fatal(string(encoded), err)
		}
	}
	for _, extra := range []string{`,"requiresPriorHitBindingKey":""`, `,"requiresPriorHitBindingKey":" "`, `,"requiresPriorHitBindingKey":1`, `,"requiresPriorHitBindingKey":{}`, `,"requiresPriorHitBindingKey":"first","requiresPriorHitBindingKey":"other"`} {
		var hit SkillActionHitBinding
		if json.Unmarshal([]byte(strings.TrimSuffix(base, "}")+extra+"}"), &hit) == nil {
			t.Fatal("invalid dependency shape accepted", extra)
		}
	}
}

func TestStagedSkillFactsJSONShape(t *testing.T) {
	valid := `{"hitBindingKey":"first","stepKey":"first","timeMs":0,"released":false,"contact":false,"completed":true}`
	for _, raw := range []string{valid, strings.Replace(valid, `"released":false,"contact":false`, `"released":true,"contact":true`, 1)} {
		var stage ProcessSkillHitStage
		if err := json.Unmarshal([]byte(raw), &stage); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{strings.Replace(valid, `"released":false,`, "", 1), strings.Replace(valid, `"released":false`, `"released":null`, 1), strings.Replace(valid, `"contact":false`, `"contact":true`, 1), strings.Replace(valid, `"timeMs":0`, `"timeMs":-1`, 1), strings.Replace(valid, `"stepKey":"first"`, `"stepKey":""`, 1)} {
		var stage ProcessSkillHitStage
		if json.Unmarshal([]byte(raw), &stage) == nil {
			t.Fatal("invalid output fact admitted", raw)
		}
	}
	base, err := json.Marshal(ProcessInstanceSnapshot{ActualCosts: map[string]float64{}, ActionOccupancies: []ProcessActionOccupancy{}})
	if err != nil || strings.Contains(string(base), "skillHitStages") {
		t.Fatal(string(base), err)
	}
	for _, raw := range []string{"null", "[" + strings.TrimSuffix(strings.Repeat(valid+",", 65), ",") + "]"} {
		var row ProcessInstanceSnapshot
		if json.Unmarshal([]byte(strings.TrimSuffix(string(base), "}")+`,"skillHitStages":`+raw+"}"), &row) == nil {
			t.Fatal("invalid stage list admitted", raw)
		}
	}
}
