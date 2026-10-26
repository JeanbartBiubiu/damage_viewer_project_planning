package effect

import (
	"testing"
)

func TestSourceExpiryHoldProtectsOnlyItsExactActiveBagField(t *testing.T) {
	makeBag := func() *bagData {
		bag := &bagData{state: map[string]float64{"wait": 1}, expireAt: map[string]int64{"wait": 500},
			fieldDefs:         map[string]FieldDefinition{"wait": {HasOnExpire: true, DurationMs: 500}},
			sourceExpiryFacts: map[string]SourceExpiryFact{"wait": {Generation: 1, Deadline: 500}}}
		bag.ensure()
		return bag
	}
	active := makeBag()
	active.state["ordinary"], active.expireAt["ordinary"] = 1, 500
	active.fieldDefs["ordinary"] = FieldDefinition{DurationMs: 500}

	active.sourceExpiryFacts["ordinary"] = SourceExpiryFact{Generation: 1, Deadline: 500}
	for _, tc := range []struct {
		name   string
		change func(*bagData)
	}{
		{"other_instance_without_fact", func(b *bagData) { b.sourceExpiryFacts = nil }},
		{"stale_deadline", func(b *bagData) {
			b.sourceExpiryFacts["wait"] = SourceExpiryFact{Generation: 2, Deadline: 1000}
		}},
		{"missing_generation", func(b *bagData) { b.sourceExpiryFacts["wait"] = SourceExpiryFact{Deadline: 500} }},
		{"already_cleared", func(b *bagData) { b.state["wait"] = 0 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			other := makeBag()
			tc.change(other)
			if !other.needsLazyExpiration(500) || !other.needsReadPreparation(nil, 500, ReadOptions{}) {
				t.Fatal("unprotected state skipped expiry")
			}
			other.lazyExpireProviderState(500)
			if other.state["wait"] != 0 || other.expireAt["wait"] != 0 {
				t.Fatal("unrelated or inactive state was protected", other)
			}
			if active.state["wait"] != 1 || active.expireAt["wait"] != 500 {
				t.Fatal("another instance changed the pending field", active)
			}
		})
	}
	active.lazyExpireProviderState(500)
	if active.state["wait"] != 1 || active.expireAt["wait"] != 500 || active.state["ordinary"] != 0 || active.expireAt["ordinary"] != 0 {
		t.Fatal("callback hold leaked into ordinary expiry", active)
	}
	if active.needsLazyExpiration(500) || active.needsReadPreparation(nil, 500, ReadOptions{}) {
		t.Fatal("exact callback hold disagreed between read paths")
	}
	active.lazyExpireProviderState(501)
	if active.state["wait"] != 0 || active.expireAt["wait"] != 0 {
		t.Fatal("callback protection extended beyond its exact deadline", active)
	}
}
