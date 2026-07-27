package model

import (
	"encoding/json"
	"testing"
)

func TestAbilityCastOriginAndListenerThrottleJSONRoundTrip(t *testing.T) {
	raw := []byte(`{
		"abilityKey":"spell_a",
		"kind":"active",
		"castOrigin":"champion",
		"operations":[]
	}`)
	var ability AbilityDefinition
	if err := json.Unmarshal(raw, &ability); err != nil {
		t.Fatal(err)
	}
	if ability.CastOrigin != CastOriginChampion {
		t.Fatalf("castOrigin=%q", ability.CastOrigin)
	}
	out, err := json.Marshal(ability)
	if err != nil {
		t.Fatal(err)
	}
	var again AbilityDefinition
	if err := json.Unmarshal(out, &again); err != nil {
		t.Fatal(err)
	}
	if again.CastOrigin != CastOriginChampion {
		t.Fatalf("round-trip castOrigin=%q", again.CastOrigin)
	}

	legacy := []byte(`{"abilityKey":"spell_b","kind":"active"}`)
	var legacyAbility AbilityDefinition
	if err := json.Unmarshal(legacy, &legacyAbility); err != nil {
		t.Fatal(err)
	}
	if legacyAbility.CastOrigin != "" {
		t.Fatalf("omitted castOrigin should be empty, got %q", legacyAbility.CastOrigin)
	}

	listenerRaw := []byte(`{
		"listenerKey":"l1",
		"eventMatcher":{"all":["event/damage_instance"]},
		"perCastThrottleMs":1000,
		"operations":[]
	}`)
	var listener ListenerDefinition
	if err := json.Unmarshal(listenerRaw, &listener); err != nil {
		t.Fatal(err)
	}
	if listener.PerCastThrottleMs != 1000 {
		t.Fatalf("perCastThrottleMs=%d", listener.PerCastThrottleMs)
	}
	legacyListener := []byte(`{"listenerKey":"l2","eventMatcher":{"all":["event/damage_instance"]}}`)
	var legacyL ListenerDefinition
	if err := json.Unmarshal(legacyListener, &legacyL); err != nil {
		t.Fatal(err)
	}
	if legacyL.PerCastThrottleMs != 0 {
		t.Fatalf("omitted throttle should be 0, got %d", legacyL.PerCastThrottleMs)
	}
}
