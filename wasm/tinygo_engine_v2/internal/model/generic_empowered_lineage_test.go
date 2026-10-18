package model

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestEmpoweredPredecessorSnapshotJSONOptionalAndStrict(t *testing.T) {
	row := ProcessInstanceSnapshot{ActualCosts: map[string]float64{}, ActionOccupancies: []ProcessActionOccupancy{}}
	legacy, err := json.Marshal(row)
	if err != nil || bytes.Contains(legacy, []byte("empoweredPredecessorUseRef")) {
		t.Fatal(err, string(legacy))
	}
	var decoded ProcessInstanceSnapshot
	if err := json.Unmarshal(legacy, &decoded); err != nil {
		t.Fatal(err)
	}
	ref := "skill:real_direct_grantor"
	row.EmpoweredPredecessorUseRef = &ref
	encoded, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil || decoded.EmpoweredPredecessorUseRef == nil || *decoded.EmpoweredPredecessorUseRef != ref {
		t.Fatal(err, decoded)
	}
	for _, invalid := range []json.RawMessage{json.RawMessage(`null`), json.RawMessage(`""`), json.RawMessage(`"  "`), json.RawMessage(`1`), json.RawMessage(`{}`)} {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(encoded, &fields); err != nil {
			t.Fatal(err)
		}
		fields["empoweredPredecessorUseRef"] = invalid
		bad, err := json.Marshal(fields)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(bad, &decoded); err == nil {
			t.Fatal("invalid causal reference accepted", string(invalid))
		}
	}
}
