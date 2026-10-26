package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func TestPerCastThrottleCapacityBounds(t *testing.T) {
	if got := perCastThrottleCapacity(1); got != 256 {
		t.Fatalf("capacity(1)=%d want 256", got)
	}
	if got := perCastThrottleCapacity(512); got != 512 {
		t.Fatalf("capacity(512)=%d want 512", got)
	}
	if got := perCastThrottleCapacity(100000); got != 4096 {
		t.Fatalf("capacity(100000)=%d want 4096", got)
	}
}

func TestPerCastThrottleAllowBoundaries(t *testing.T) {
	s := &Engine{
		loop:            newTestLoopAt(0),
		perCastThrottle: map[perCastThrottleKey]int64{},
	}
	if !s.allowPerCastThrottle(0, "source", "p", 1, 0) {
		t.Fatal("throttle 0 must always allow")
	}
	s.notePerCastThrottleTrigger(0, "source", "p", 1)
	s.loop.Advance(999)
	if !s.allowPerCastThrottle(0, "source", "p", 1, 999) {
		t.Fatal("elapsed 999 with throttle 999 must allow")
	}
	s.loop.Advance(998)
	if s.allowPerCastThrottle(0, "source", "p", 1, 999) {
		t.Fatal("elapsed 998 with throttle 999 must block")
	}
	s.loop.Advance(999)
	if s.allowPerCastThrottle(0, "source", "p", 1, 1000) {
		t.Fatal("elapsed 999 with throttle 1000 must block")
	}
	s.loop.Advance(1000)
	if !s.allowPerCastThrottle(0, "source", "p", 1, 1000) {
		t.Fatal("elapsed 1000 with throttle 1000 must allow")
	}
	// Overlapping casts are independent.
	s.loop.Advance(500)
	if !s.allowPerCastThrottle(0, "source", "p", 2, 1000) {
		t.Fatal("distinct castInstanceId must not share throttle")
	}
	if s.allowPerCastThrottle(0, "source", "p", 0, 1000) {
		t.Fatal("missing cast id must fail closed when throttle>0")
	}
}

func TestPerCastThrottleOverflowEvictsSmallestAndWarnsOnce(t *testing.T) {
	s := &Engine{
		loop:                    newTestLoopAt(0),
		budget:                  model.SafetyBudget{MaxEvents: 1},
		perCastThrottle:         map[perCastThrottleKey]int64{},
		perCastThrottleCapacity: 4,
	}
	for id := uint64(1); id <= 4; id++ {
		s.notePerCastThrottleTrigger(0, "source", "p", id)
	}
	if len(s.perCastThrottle) != 4 {
		t.Fatalf("len=%d want 4", len(s.perCastThrottle))
	}
	s.notePerCastThrottleTrigger(0, "source", "p", 5)
	if len(s.perCastThrottle) != 4 {
		t.Fatalf("after overflow len=%d want 4", len(s.perCastThrottle))
	}
	if _, ok := s.perCastThrottle[perCastThrottleKey{0, "source", "p", 1}]; ok {
		t.Fatal("smallest castInstanceId=1 should be evicted")
	}
	if !s.perCastThrottleOverflowWarned || s.perCastThrottleOverflowCount != 1 {
		t.Fatalf("warned=%v count=%d", s.perCastThrottleOverflowWarned, s.perCastThrottleOverflowCount)
	}
	s.notePerCastThrottleTrigger(0, "source", "p", 6)
	if s.perCastThrottleOverflowCount != 2 {
		t.Fatalf("count=%d want 2", s.perCastThrottleOverflowCount)
	}
	w := s.perCastThrottleOverflowWarning()
	if w == nil || w.Code != string(model.WarningCodePerCastThrottleOverflow) || w.Count != 2 {
		t.Fatalf("warning=%+v", w)
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
