package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMultiplierGroupJSONPresenceAndRoundTrip(t *testing.T) {
	base := `{"modifierKey":"gain","kind":"pipeline","command":"damage","stage":"outgoing_pre_mitigation","channel":"all_damage","bucket":"all_instances","valuePolicy":"multiply","value":{"op":"const","value":1.2}`
	var independent ModifierDefinition
	if err := json.Unmarshal([]byte(base+`}`), &independent); err != nil || independent.MultiplierGroupKey != nil {
		t.Fatal("omission is independent", independent, err)
	}
	var grouped ModifierDefinition
	if err := json.Unmarshal([]byte(base+`,"multiplierGroupKey":"amplification_0"}`), &grouped); err != nil || grouped.MultiplierGroupKey == nil || *grouped.MultiplierGroupKey != "amplification_0" {
		t.Fatal("group key not retained", grouped, err)
	}
	bytes, err := json.Marshal(grouped)
	if err != nil || !strings.Contains(string(bytes), `"multiplierGroupKey":"amplification_0"`) {
		t.Fatal("group key omitted on marshal", string(bytes), err)
	}
	for _, suffix := range []string{`,"multiplierGroupKey":null}`, `,"multiplierGroupKey":1}`, `,"multiplierGroupKey":true}`, `,"multiplierGroupKey":[]}`, `,"multiplierGroupKey":"a","multiplierGroupKey":"a"}`, `,"multiplierGroupKey":"a","multiplier\u0047roupKey":"b"}`} {
		var value ModifierDefinition
		if err := json.Unmarshal([]byte(base+suffix), &value); err == nil {
			t.Fatal("invalid or duplicate group field accepted", suffix)
		}
	}
}

func TestGroupedAttributeJSONDoesNotAddNullableConditionCapability(t *testing.T) {
	for _, condition := range []string{"null", `{"op":"const","value":0}`} {
		var modifier ModifierDefinition
		data := `{"modifierKey":"gain","kind":"attribute","target":"self.attr.power","stage":"total","valuePolicy":"multiply","value":{"op":"const","value":1.2},"multiplierGroupKey":"gain","condition":` + condition + `}`
		if err := json.Unmarshal([]byte(data), &modifier); err == nil {
			t.Fatal("grouped attribute condition accepted", condition)
		}
	}
}
