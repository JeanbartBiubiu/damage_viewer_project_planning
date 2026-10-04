package model

import (
	"encoding/json"
	"testing"
)

func TestAttributeDerivationJSONRejectsUnknownAndMissingFields(t *testing.T) {
	for _, payload := range []string{
		`{"combatantKey":"source","attributeKey":"attack_speed","value":{"op":"const","value":1},"computed":true}`,
		`{"attributeKey":"attack_speed","value":{"op":"const","value":1}}`,
		`{"combatantKey":"source","attributeKey":"attack_speed","value":null}`,
	} {
		var definition AttributeDerivationDefinition
		if err := json.Unmarshal([]byte(payload), &definition); err == nil {
			t.Fatal("invalid derivation decoded:", payload)
		}
	}
	var definition AttributeDerivationDefinition
	if err := json.Unmarshal([]byte(`{"combatantKey":"source","attributeKey":"attack_speed","value":{"op":"const","value":1}}`), &definition); err != nil {
		t.Fatal(err)
	}
}
