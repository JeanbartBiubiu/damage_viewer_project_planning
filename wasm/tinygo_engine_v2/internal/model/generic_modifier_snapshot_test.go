package model

import (
	"encoding/json"
	"testing"
)

func TestModifierSnapshotJSONRejectsExplicitNullAndInvalidMode(t *testing.T) {
	for _, raw := range []string{`{"modifierSnapshots":null}`, `{"modifierSnapshots":{"gain":null}}`, `{"modifierSnapshots":{"gain":"0"}}`} {
		var provider CombatantProviderSnapshot
		if json.Unmarshal([]byte(raw), &provider) == nil {
			t.Fatal(raw)
		}
	}
	for _, raw := range []string{`{"kind":"attribute","valueReadMode":null}`, `{"kind":"attribute","valueReadMode":""}`, `{"kind":"attribute","valueReadMode":"LIVE"}`} {
		var modifier ModifierDefinition
		if json.Unmarshal([]byte(raw), &modifier) == nil {
			t.Fatal(raw)
		}
	}
	var provider CombatantProviderSnapshot
	if err := json.Unmarshal([]byte(`{"modifierSnapshots":{"gain":0}}`), &provider); err != nil || provider.ModifierSnapshots["gain"] != 0 {
		t.Fatal(err, provider)
	}
}
