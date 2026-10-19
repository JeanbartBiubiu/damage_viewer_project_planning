package model

import (
	"encoding/json"
	"testing"
)

func TestDynamicModifierStrictShapeAndRecordBudget(t *testing.T) {
	for _, row := range []struct {
		raw   string
		valid bool
	}{
		{`{"modifierKey":"h","kind":"resource_max","target":"self.attr.hp","valuePolicy":"add","value":{"op":"const","value":300},"currentValuePolicy":"grant_positive_delta_clamp"}`, true},
		{`{"modifierKey":"h","kind":"resource_max","target":"self.attr.hp","valuePolicy":"add","value":{"op":"const","value":300}}`, false},
		{`{"modifierKey":"d","kind":"cooldown_duration","target":"self","valuePolicy":"multiply","value":{"op":"const","value":0.5},"affectedAbilityRefs":[]}`, true},
		{`{"modifierKey":"d","kind":"cooldown_duration","target":"self","valuePolicy":"multiply","value":{"op":"const","value":0.5},"affectedAbilityRefs":null}`, false},
		{`{"modifierKey":"a","kind":"attribute","target":"self.attr.armor","valuePolicy":"add","value":{"op":"const","value":1},"currentValuePolicy":null}`, false},
		{`{"modifierKey":"a","kind":"attribute","target":"self.attr.armor","valuePolicy":"add","value":{"op":"const","value":1},"affectedAbilityRefs":[]}`, false},
	} {
		var v ModifierDefinition
		err := json.Unmarshal([]byte(row.raw), &v)
		if (err == nil) != row.valid {
			t.Fatal(row.raw, err)
		}
	}
	for _, row := range []struct {
		raw   string
		valid bool
	}{{`{}`, true}, {`{"maxResourceChangeRecords":0}`, true}, {`{"maxResourceChangeRecords":10000}`, true}, {`{"maxResourceChangeRecords":10001}`, false}, {`{"maxResourceChangeRecords":-1}`, false}, {`{"maxResourceChangeRecords":null}`, false}, {`{"maxResourceChangeRecords":0.5}`, false}} {
		var v RecordBudget
		err := json.Unmarshal([]byte(row.raw), &v)
		if (err == nil) != row.valid {
			t.Fatal(row.raw, err)
		}
	}
}
