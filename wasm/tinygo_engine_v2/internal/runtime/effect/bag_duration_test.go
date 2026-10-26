package effect

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestSubtractProviderExpireAtSemantics(t *testing.T) {
	bag := &bagData{
		state:    map[string]float64{"timed_flag": 1},
		expireAt: map[string]int64{"timed_flag": 6000},
		fieldDefs: map[string]FieldDefinition{
			"timed_flag": {DefaultValue: 0, MaxValue: 1, HasCap: true, DurationMs: 6000, RefreshPolicy: model.ProviderStateRefreshOnWrite},
		},
	}

	empty := &bagData{expireAt: map[string]int64{}}
	applied, expired, exp := empty.subtractProviderExpireAt("timed_flag", 0, 1000)
	if applied || expired || exp != 0 {
		t.Fatalf("inactive=%v/%v/%d", applied, expired, exp)
	}

	applied, expired, exp = bag.subtractProviderExpireAt("timed_flag", 0, 1000)
	if !applied || expired || exp != 5000 || bag.expireAt["timed_flag"] != 5000 {
		t.Fatalf("shorten=%v/%v/%d bag=%d", applied, expired, exp, bag.expireAt["timed_flag"])
	}
	if bag.state["timed_flag"] != 1 {
		t.Fatalf("value mutated=%v", bag.state["timed_flag"])
	}

	bag.expireAt["timed_flag"] = 5500
	applied, expired, exp = bag.subtractProviderExpireAt("timed_flag", 5000, 1000)
	if !applied || !expired || exp != 0 || bag.expireAt["timed_flag"] != 0 {
		t.Fatalf("immediate=%v/%v/%d bag=%d", applied, expired, exp, bag.expireAt["timed_flag"])
	}
}

func TestSubtractTargetExpireAtSemantics(t *testing.T) {
	bag := &bagData{
		targetKey:      "target",
		targetValues:   map[string]float64{"target_flag": 1},
		targetExpireAt: map[string]int64{"target_flag": 8000},
		fieldDefs: map[string]FieldDefinition{
			"target_flag": {DefaultValue: 0, MaxValue: 1, HasCap: true, DurationMs: 8000, RefreshPolicy: model.ProviderStateRefreshOnWrite},
		},
	}
	applied, expired, exp := bag.subtractTargetExpireAt("target_flag", 1000, 2000)
	if !applied || expired || exp != 6000 {
		t.Fatalf("target shorten=%v/%v/%d", applied, expired, exp)
	}
	if bag.targetValues["target_flag"] != 1 {
		t.Fatalf("target value mutated=%v", bag.targetValues["target_flag"])
	}
	applied, expired, exp = bag.subtractTargetExpireAt("target_flag", 6000, 5000)
	if !applied || !expired || exp != 0 || bag.targetExpireAt["target_flag"] != 0 {
		t.Fatalf("target immediate=%v/%v/%d", applied, expired, exp)
	}
}
