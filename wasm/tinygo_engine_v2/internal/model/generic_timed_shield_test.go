package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"testing"
)

func TestOperationDefinitionShieldDurationMsJSONRoundTrip(t *testing.T) {
	dur := GenericFormulaExpr{Op: "const", Value: Float64Ptr(2000)}
	op := OperationDefinition{
		Operation:        "shield",
		Target:           "self",
		Amount:           &GenericFormulaExpr{Op: "const", Value: Float64Ptr(80)},
		ShieldRef:        "eclipse",
		ShieldDurationMs: &dur,
	}
	raw, err := json.Marshal(op)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"shieldDurationMs"`)) {
		t.Fatalf("missing shieldDurationMs in %s", raw)
	}
	var got OperationDefinition
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.ShieldDurationMs == nil || got.ShieldDurationMs.Value == nil || *got.ShieldDurationMs.Value != 2000 {
		t.Fatalf("roundtrip=%+v", got.ShieldDurationMs)
	}

	omitted := OperationDefinition{Operation: "shield", Target: "self", Amount: op.Amount, ShieldRef: "eclipse"}
	omittedRaw, err := json.Marshal(omitted)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(omittedRaw, []byte("shieldDurationMs")) {
		t.Fatalf("omitempty failed: %s", omittedRaw)
	}

	withHash := sha256.Sum256(raw)
	withoutHash := sha256.Sum256(omittedRaw)
	if withHash == withoutHash {
		t.Fatal("shieldDurationMs must participate in JSON hash")
	}
}
