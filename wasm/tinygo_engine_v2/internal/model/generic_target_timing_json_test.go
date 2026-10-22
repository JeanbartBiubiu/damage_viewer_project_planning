package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTargetTimingStrictJSONAndOldTickUnchanged(t *testing.T) {
	tick := `{"intervalMs":250,"startDelayMs":0,"anchorScope":"state_scope/provider_target","anchorStateKey":"a","onTick":[],"phasePolicy":"preserve_on_extend"}`
	for _, bad := range []string{`null`, `""`, `"restart"`, `7`, `false`} {
		var value TickSpec
		if err := json.Unmarshal([]byte(strings.Replace(tick, `"preserve_on_extend"`, bad, 1)), &value); err == nil {
			t.Fatal("invalid phasePolicy accepted", bad)
		}
	}
	for _, raw := range []string{tick, strings.Replace(tick, `,"phasePolicy":"preserve_on_extend"`, "", 1)} {
		var value TickSpec
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			t.Fatal("new or legacy tick rejected", err)
		}
	}
	expiry := `{"abilityKey":"e","kind":"stateful","targetExpirySpec":{"anchorScope":"state_scope/provider_target","anchorStateKey":"a","onExpire":[]}}`
	for _, raw := range []string{strings.Replace(expiry, `"onExpire":[]`, `"onExpire":null`, 1), strings.Replace(expiry, `"anchorStateKey":"a",`, "", 1), strings.Replace(expiry, `"onExpire":[]`, `"onExpire":[],"extra":1`, 1), `{"abilityKey":"e","kind":"stateful","targetExpirySpec":null}`} {
		var value AbilityDefinition
		if err := json.Unmarshal([]byte(raw), &value); err == nil {
			t.Fatal("invalid target expiry shape accepted", raw)
		}
	}
	var value AbilityDefinition
	if err := json.Unmarshal([]byte(expiry), &value); err != nil {
		t.Fatal(err)
	}
}
