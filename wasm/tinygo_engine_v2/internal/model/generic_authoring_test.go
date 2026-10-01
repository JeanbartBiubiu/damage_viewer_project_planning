package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAuthoringDamageFormulaJSONRequiresAllStagesAndExactNodes(t *testing.T) {
	valid := `{"damageType":"damage/custom","formula":{"resistanceBeforePenetration":{"op":"const","value":0},"penetrationPercent":{"op":"const","value":0},"penetrationFlat":{"op":"const","value":0},"effectiveResistance":{"op":"const","value":0},"resistanceFactor":{"op":"const","value":1}}}`
	var def DamageTypeFormulaDefinition
	if err := json.Unmarshal([]byte(valid), &def); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		strings.Replace(valid, `,"resistanceFactor":{"op":"const","value":1}`, "", 1),
		strings.Replace(valid, `"op":"const","value":1`, `"op":"const","value":1,"unknown":0`, 1),
		strings.Replace(valid, `"op":"const","value":1`, `"op":"ref","ref":"other"`, 1),
		strings.Replace(valid, `"op":"const","value":1`, `"op":"add","args":[{"op":"const","value":1}]`, 1),
	} {
		if err := json.Unmarshal([]byte(invalid), &def); err == nil {
			t.Fatal("invalid defense declaration decoded", invalid)
		}
	}
}

func TestAuthoringProcessEventBindingRejectsNull(t *testing.T) {
	var control ProcessControlDefinition
	if err := json.Unmarshal([]byte(`{"processKey":"p","action":"INITIAL","useRefFromEvent":true}`), &control); err != nil || !control.UseRefFromEvent {
		t.Fatal(control, err)
	}
	if err := json.Unmarshal([]byte(`{"processKey":"p","action":"INITIAL","useRefFromEvent":null}`), &control); err == nil {
		t.Fatal("null event binding silently became the driver path")
	}
}
