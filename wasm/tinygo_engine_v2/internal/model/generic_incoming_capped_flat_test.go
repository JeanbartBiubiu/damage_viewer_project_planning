package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestIncomingCappedFlatJSONPresenceAndScope(t *testing.T) {
	base := `{"modifierKey":"cap","kind":"pipeline","command":"damage","channel":"all_damage","stage":"incoming_pre_mitigation","bucket":"all_instances","valuePolicy":"subtract","value":{"op":"const","value":13},"condition":{"op":"read","path":"damage.type.physics"},"maximumReductionRatio":0.5}`
	for _, ratio := range []string{"0", "0.5", "1"} {
		var value ModifierDefinition
		input := strings.Replace(base, `"maximumReductionRatio":0.5`, `"maximumReductionRatio":`+ratio, 1)
		if err := json.Unmarshal([]byte(input), &value); err != nil {
			t.Fatal(ratio, err)
		}
		encoded, err := json.Marshal(value)
		if err != nil || !strings.Contains(string(encoded), `"maximumReductionRatio":`+ratio) {
			t.Fatal("explicit cap did not round trip", string(encoded), err)
		}
	}
	for name, input := range map[string]string{
		"missing":        strings.Replace(base, `,"maximumReductionRatio":0.5`, "", 1),
		"null":           strings.Replace(base, `"maximumReductionRatio":0.5`, `"maximumReductionRatio":null`, 1),
		"negative":       strings.Replace(base, `"maximumReductionRatio":0.5`, `"maximumReductionRatio":-0.1`, 1),
		"large":          strings.Replace(base, `"maximumReductionRatio":0.5`, `"maximumReductionRatio":1.1`, 1),
		"hidden":         strings.Replace(base, `"modifierKey":`, `"hidden":true,"modifierKey":`, 1),
		"null_condition": strings.Replace(base, `"condition":{"op":"read","path":"damage.type.physics"}`, `"condition":null`, 1),
		"other_stage":    strings.Replace(base, `incoming_pre_mitigation`, `incoming_post_mitigation`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			var value ModifierDefinition
			if err := json.Unmarshal([]byte(input), &value); err == nil {
				t.Fatal("invalid cap decoded", input)
			}
		})
	}
	var legacy ModifierDefinition
	if err := json.Unmarshal([]byte(`{"modifierKey":"old","kind":"pipeline","command":"damage","channel":"all_damage","stage":"incoming_post_mitigation","bucket":"all_instances","valuePolicy":"subtract","value":{"op":"const","value":3}}`), &legacy); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(legacy)
	if err != nil || strings.Contains(string(encoded), "maximumReductionRatio") {
		t.Fatal("old modifier acquired a cap field", string(encoded), err)
	}
}

func TestIncomingCappedFlatUsesActualTopLevelJSONField(t *testing.T) {
	for name, input := range map[string]string{
		"legacy_key_value":       `{"modifierKey":"maximumReductionRatio","kind":"attribute","target":"self.attr.armor","valuePolicy":"add","value":{"op":"const","value":3}}`,
		"legacy_reference_value": `{"modifierKey":"old","kind":"attribute","target":"self.attr.armor","valuePolicy":"add","value":{"op":"ref","ref":"maximumReductionRatio"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			var value ModifierDefinition
			if err := json.Unmarshal([]byte(input), &value); err != nil || value.MaximumReductionRatio != nil {
				t.Fatal("legacy string value misclassified as a cap field", err)
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &fields); err != nil || fields["maximumReductionRatio"] != nil {
				t.Fatal("legacy modifier acquired a top-level cap", err)
			}
		})
	}
	for name, input := range map[string]string{
		"escaped_null":        `{"modifierKey":"old","kind":"attribute","target":"self.attr.armor","valuePolicy":"add","value":{"op":"const","value":3},"\u006daximumReductionRatio":null}`,
		"escaped_wrong_shape": `{"modifierKey":"old","kind":"attribute","target":"self.attr.armor","valuePolicy":"add","value":{"op":"const","value":3},"\u006daximumReductionRatio":0.5}`,
	} {
		t.Run(name, func(t *testing.T) {
			var value ModifierDefinition
			if err := json.Unmarshal([]byte(input), &value); err == nil {
				t.Fatal("actual escaped cap field bypassed the strict cap shape")
			}
		})
	}
}
