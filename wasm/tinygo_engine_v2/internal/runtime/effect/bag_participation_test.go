package effect

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestParticipationTargetCounterProjectionIsReadOnlyAndExcludesAnchors(t *testing.T) {
	ordinary := FieldDefinition{ValueType: model.ProviderStateValueInteger, DefaultValue: 0, MaxValue: 3, HasCap: true, DurationMs: 100}
	bag := &bagData{targetKey: "target", fieldDefs: map[string]FieldDefinition{},
		targetValues: map[string]float64{}, targetExpireAt: map[string]int64{}, anchoredTickGeneration: map[string]uint64{"anchored": 0},
		timing: &timingState{{Key: "phased"}, {Key: "reservation"}}}
	for _, key := range []string{"ordinary", "future", "no_deadline", "untimed", "number", "cooldown", "ammo", "on_expire", "anchored", "phased", "reservation"} {
		bag.fieldDefs[key], bag.targetValues[key], bag.targetExpireAt[key] = ordinary, 1, 100
	}
	bag.targetExpireAt["future"], bag.targetExpireAt["no_deadline"] = 101, 0
	for key, modify := range map[string]func(*FieldDefinition){
		"untimed":   func(def *FieldDefinition) { def.DurationMs = 0 },
		"number":    func(def *FieldDefinition) { def.ValueType = model.ProviderStateValueNumber },
		"cooldown":  func(def *FieldDefinition) { def.StateKind = model.ProviderStateKindCooldown },
		"ammo":      func(def *FieldDefinition) { def.StateKind = model.ProviderStateKindAmmo },
		"on_expire": func(def *FieldDefinition) { def.HasOnExpire = true },
	} {
		def := bag.fieldDefs[key]
		modify(&def)
		bag.fieldDefs[key] = def
	}
	beforeValues, beforeExpiry, beforeTiming := CloneFloatMap(bag.targetValues), CloneInt64Map(bag.targetExpireAt), *bag.timing
	if before := bag.targetStateForParticipation(99); reflect.ValueOf(before).Pointer() != reflect.ValueOf(bag.targetValues).Pointer() {
		t.Fatal("unexpired participation unnecessarily copied the target values")
	}
	view := bag.targetStateForParticipation(100)
	for key := range bag.targetValues {
		want := 1.0
		if key == "ordinary" {
			want = 0
		}
		if view[key] != want {
			t.Fatalf("key=%s participation=%v want=%v", key, view[key], want)
		}
	}
	if !reflect.DeepEqual(bag.targetValues, beforeValues) || !reflect.DeepEqual(bag.targetExpireAt, beforeExpiry) || *bag.timing != beforeTiming {
		t.Fatal("participation changed original values, expiry or timing facts")
	}
	view["ordinary"] = 2
	if bag.targetValues["ordinary"] != 1 {
		t.Fatal("projected values alias the actual target state")
	}
	bag.activateProviderTarget("source")
	if len(bag.targetValues) != 0 || len(bag.targetExpireAt) != 0 || bag.targetKey != "source" {
		t.Fatal("target switch retained the previous target's count or deadline")
	}
	if view := bag.targetStateForParticipation(100); len(view) != 0 {
		t.Fatal("participation resurrected values after a real target switch")
	}
}
