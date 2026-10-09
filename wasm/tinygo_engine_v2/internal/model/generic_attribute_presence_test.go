package model

import (
	"encoding/json"
	"testing"
)

func TestAttributeJSONPresenceSurvivesValueCopyAndTransport(t *testing.T) {
	var slot AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"base":0,"current":0}`), &slot); err != nil {
		t.Fatal(err)
	}
	if !slot.HasBase() || !slot.HasCurrent() || slot.HasMax() || slot.HasResolved() {
		t.Fatal("JSON presence lost")
	}
	copy := slot
	copy.Resolved = 123
	encoded, err := json.Marshal(copy)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 2 || fields["base"] != float64(0) || fields["current"] != float64(0) {
		t.Fatal("copy invented missing fields", string(encoded))
	}
	if err := json.Unmarshal(encoded, &copy); err != nil {
		t.Fatal(err)
	}
	if copy.HasResolved() || copy.HasMax() {
		t.Fatal("roundtrip invented presence")
	}
	native := AttributeSlotDef{}
	if !native.HasBase() || !native.HasCurrent() || !native.HasMax() || !native.HasResolved() {
		t.Fatal("explicit native zero was made absent")
	}
}

func TestAttributeJSONNullAndNonNumericFieldsRejected(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `{"base":null}`, `{"resolved":"0"}`, `{"current":false}`, `{"max":{}}`} {
		var slot AttributeSlotDef
		if err := json.Unmarshal([]byte(raw), &slot); err == nil {
			t.Fatal("invalid number accepted", raw)
		}
	}
}
