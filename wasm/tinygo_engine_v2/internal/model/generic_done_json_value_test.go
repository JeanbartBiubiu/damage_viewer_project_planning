package model

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
)

// 冻结优化前的输出形态，独立核对流式入口与现有序列化契约。
func frozenDoneJSON(value DoneResult) ([]byte, error) {
	type plain DoneResult
	if value.AutomaticSkillSummary == nil {
		return json.Marshal(plain(value))
	}
	value.Summary.SkillActions = nil
	records := value.AutomaticSkillRecords
	if records == nil {
		records = []AutomaticSkillRecord{}
	}
	return json.Marshal(struct {
		plain
		SkillActionRecords    *struct{}              `json:"skillActionRecords,omitempty"`
		SkillUseRecords       *struct{}              `json:"skillUseRecords,omitempty"`
		AutomaticSkillRecords []AutomaticSkillRecord `json:"automaticSkillRecords"`
	}{plain: plain(value), AutomaticSkillRecords: records})
}

func TestDoneJSONValueMatchesFrozenManualAutomaticBytes(t *testing.T) {
	for _, mode := range []RunOutputMode{"", "summary"} {
		for _, automatic := range []bool{false, true} {
			for _, records := range [][]AutomaticSkillRecord{nil, {}, {{}}} {
				value := DoneResult{OK: true, OutputMode: mode, DamageRecords: []map[string]interface{}{{"text": "<>&\u2028\u2029\"\\中文"}}, AutomaticSkillRecords: records}
				if automatic {
					value.AutomaticSkillSummary = &AutomaticSkillSummary{}
				}
				before, err := frozenDoneJSON(value)
				if err != nil {
					t.Fatal(err)
				}
				var output bytes.Buffer
				if err := json.NewEncoder(&output).Encode(value.JSONValue()); err != nil {
					t.Fatal(err)
				}
				if actual := bytes.TrimSuffix(output.Bytes(), []byte{'\n'}); !bytes.Equal(actual, before) {
					t.Fatalf("mode=%s auto=%v: actual %s expected %s", mode, automatic, actual, before)
				}
				ordinary, err := json.Marshal(value)
				if err != nil || !bytes.Equal(ordinary, before) {
					t.Fatal("ordinary encoding changed", err)
				}
			}
		}
	}
}

func TestDoneJSONValueRejectsNonFiniteBeforeWriting(t *testing.T) {
	for _, number := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		for _, automatic := range []bool{false, true} {
			value := DoneResult{DamageRecords: []map[string]interface{}{{"amount": number}}}
			if automatic {
				value.AutomaticSkillSummary = &AutomaticSkillSummary{}
			}
			var output bytes.Buffer
			if err := json.NewEncoder(&output).Encode(value.JSONValue()); err == nil || output.Len() != 0 {
				t.Fatal("failed result partially written", err, output.Len())
			}
		}
	}
}
