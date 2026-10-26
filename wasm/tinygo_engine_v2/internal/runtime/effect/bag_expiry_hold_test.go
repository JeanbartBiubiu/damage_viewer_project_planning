package effect

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestInclusiveAtExpiryHoldSkipsOnlyMatchedKey(t *testing.T) {
	bag := &bagData{
		fieldDefs: map[string]FieldDefinition{
			"venom_stacks": {DefaultValue: 0, MaxValue: 6, HasCap: true, DurationMs: 1000, RefreshPolicy: model.ProviderStateRefreshOnWrite},
			"other":        {DefaultValue: 0, MaxValue: 1, HasCap: true, DurationMs: 1000, RefreshPolicy: model.ProviderStateRefreshOnWrite},
		},
		targetKey: "target",
		targetValues: map[string]float64{
			"venom_stacks": 3,
			"other":        1,
		},
		targetExpireAt: map[string]int64{
			"venom_stacks": 1000,
			"other":        1000,
		},
	}
	bag.setInclusiveAtExpiryHold("target", "venom_stacks")
	bag.lazyExpireProviderTargetState(1000)
	if bag.targetValues["venom_stacks"] != 3 {
		t.Fatalf("held key expired: %v", bag.targetValues["venom_stacks"])
	}
	if bag.targetValues["other"] != 0 {
		t.Fatalf("unmatched key must still expire globally: %v", bag.targetValues["other"])
	}
	bag.clearInclusiveAtExpiryHold()
	bag.targetValues["venom_stacks"] = 3
	bag.targetExpireAt["venom_stacks"] = 1000
	bag.lazyExpireProviderTargetState(1000)
	if bag.targetValues["venom_stacks"] != 0 {
		t.Fatalf("without hold, global now>=exp must clear: %v", bag.targetValues["venom_stacks"])
	}
}
