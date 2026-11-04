package model

import (
	"encoding/json"
	"testing"
)

func TestAuthorizationIsAnExplicitOptionalString(t *testing.T) {
	for _, raw := range []string{`{}`, `{"authorization":"short-lived-grant"}`} {
		var compile CompileRequest
		var run RunRequest
		if err := json.Unmarshal([]byte(raw), &compile); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(raw), &run); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{
		`{"authorization":null}`, `{"authorization":true}`, `{"authorization":1}`, `{"Authorization":"x"}`,
		`{"authorization":"one","authorization":"two"}`, `{"authorization":"one","\u0061uthorization":"two"}`,
	} {
		var compile CompileRequest
		var run RunRequest
		if json.Unmarshal([]byte(raw), &compile) == nil || json.Unmarshal([]byte(raw), &run) == nil {
			t.Fatalf("invalid authorization shape accepted: %s", raw)
		}
	}
}
