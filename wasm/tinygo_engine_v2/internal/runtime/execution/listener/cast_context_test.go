package listener

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestPerCastThrottleCapacityBounds(t *testing.T) {
	for _, tc := range []struct{ maxEvents, capacity int }{{1, 256}, {512, 512}, {100000, 4096}} {
		state := New(tc.maxEvents)
		if state.capacity != tc.capacity || perCastThrottleCapacity(tc.maxEvents) != tc.capacity {
			t.Fatalf("capacity(%d)=%d want %d", tc.maxEvents, state.capacity, tc.capacity)
		}
	}
}

func TestPerCastThrottleAllowBoundariesAndCompleteIdentity(t *testing.T) {
	var state State
	if !state.Allow(0, "source", "p", 1, 0, 0) {
		t.Fatal("throttle 0 must always allow")
	}
	state.Triggered(0, "source", "p", 1, 0)
	for _, tc := range []struct {
		now, throttle int
		allowed       bool
	}{{999, 999, true}, {998, 999, false}, {999, 1000, false}, {1000, 1000, true}} {
		if got := state.Allow(0, "source", "p", 1, tc.throttle, int64(tc.now)); got != tc.allowed {
			t.Fatalf("at %d with throttle %d: %v", tc.now, tc.throttle, got)
		}
	}
	for _, tc := range []struct {
		index      int
		owner, ref string
		castID     uint64
	}{{0, "source", "p", 2}, {1, "source", "p", 1}, {0, "target", "p", 1}, {0, "source", "other", 1}} {
		if !state.Allow(tc.index, tc.owner, tc.ref, tc.castID, 1000, 500) {
			t.Fatalf("distinct listener, owner, mount or cast shared throttle: %+v", tc)
		}
	}
	if state.Allow(0, "source", "p", 0, 1000, 1000) {
		t.Fatal("missing cast id must fail closed when throttle>0")
	}
	state.Triggered(0, "source", "p", 0, 1000)
	if len(state.throttle) != 1 || state.capacity != 256 {
		t.Fatal("zero value changed its default capacity or recorded a missing cast")
	}
}

func TestPerCastThrottleOverflowEvictsSmallestAndWarnsOnce(t *testing.T) {
	state := State{throttle: map[perCastThrottleKey]int64{}, capacity: 4}
	for id := uint64(1); id <= 4; id++ {
		state.Triggered(0, "source", "p", id, 0)
	}
	state.Triggered(0, "source", "p", 1, 123)
	if len(state.throttle) != 4 || state.OverflowWarning() != nil {
		t.Fatal("updating an existing throttle evicted another cast")
	}
	state.Triggered(0, "source", "p", 5, 124)
	if len(state.throttle) != 4 {
		t.Fatalf("after overflow len=%d want 4", len(state.throttle))
	}
	if _, ok := state.throttle[perCastThrottleKey{0, "source", "p", 1}]; ok {
		t.Fatal("smallest cast identity must be evicted even after a later trigger")
	}
	if !state.overflowWarned || state.overflowCount != 1 {
		t.Fatalf("warned=%v count=%d", state.overflowWarned, state.overflowCount)
	}
	state.Triggered(0, "source", "p", 6, 125)
	warning := state.OverflowWarning()
	if warning == nil || warning.Code != string(model.WarningCodePerCastThrottleOverflow) || warning.Count != 2 || warning.Severity != model.WarningSeverityWarning {
		t.Fatalf("warning=%+v", warning)
	}
	warning.Count = 99
	if state.OverflowWarning().Count != 2 {
		t.Fatal("warning export changed listener-owned state")
	}
}

func TestPerCastThrottleLessTieBreak(t *testing.T) {
	a := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "b", ownerProviderRef: "q", castInstanceID: 1}
	b := perCastThrottleKey{listenerIndex: 2, ownerCombatantKey: "a", ownerProviderRef: "p", castInstanceID: 1}
	if !perCastThrottleLess(a, b) {
		t.Fatal("same cast id: smaller listenerIndex must win")
	}
	c := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "a", ownerProviderRef: "z", castInstanceID: 1}
	d := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "b", ownerProviderRef: "a", castInstanceID: 1}
	if !perCastThrottleLess(c, d) {
		t.Fatal("tie: smaller combatant key must win")
	}
	e := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "a", ownerProviderRef: "p", castInstanceID: 1}
	f := perCastThrottleKey{listenerIndex: 1, ownerCombatantKey: "a", ownerProviderRef: "q", castInstanceID: 1}
	if !perCastThrottleLess(e, f) {
		t.Fatal("tie: smaller provider ref must win")
	}
}
