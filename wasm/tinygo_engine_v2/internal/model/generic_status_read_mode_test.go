package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStatusContributionReadModePreservesOmissionAndRejectsExplicitInvalid(t *testing.T) {
	base := `{"resultRef":"r","statusKey":"slow","statusKind":"movement_slow","strength":{"op":"const","value":0}`
	for _, mode := range []string{"", StatusValueReadApplicationSnapshot, StatusValueReadMomentEvaluation} {
		raw := base
		if mode != "" {
			raw += `,"valueReadMode":"` + mode + `"`
		}
		raw += `}`
		var value StatusContributionDefinition
		if err := json.Unmarshal([]byte(raw), &value); err != nil || value.ValueReadMode != mode || value.Strength.Value == nil || *value.Strength.Value != 0 {
			t.Fatal(raw, value, err)
		}
		encoded, err := json.Marshal(value)
		if err != nil || mode == "" && strings.Contains(string(encoded), "valueReadMode") {
			t.Fatal("old sender gained a mode field", string(encoded), err)
		}
	}
	for _, invalid := range []string{`null`, `""`, `" "`, `"LIVE"`, `0`, `false`, `{}`, `[]`} {
		var value StatusContributionDefinition
		if err := json.Unmarshal([]byte(base+`,"valueReadMode":`+invalid+`}`), &value); err == nil {
			t.Fatal("invalid explicit mode was silently treated as omission", invalid, value)
		}
	}
}
