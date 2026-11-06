package scheduler

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestLoopCandidateRoundTripPreservesOrderWithoutAcceptingEvents(t *testing.T) {
	loop := NewLoop(7, 30, model.StopPolicy{})
	loop.SetQueueLimit(3)
	inputs := []GenericEvent{
		{TimeMs: 10, Kind: GenericEventProviderTick, Category: GenericCategoryProviderTick, Priority: -1},
		{TimeMs: 10, Kind: GenericEventProviderTick, Category: GenericCategoryProviderTick, Priority: -1},
		{TimeMs: 20, Kind: GenericEventAbilityAttempt, Category: GenericCategoryAbilityAttempt},
	}
	for _, event := range inputs {
		if code := loop.Enqueue(event); code != model.ErrOK {
			t.Fatal(code)
		}
	}
	if _, found := loop.TakeAt(11); found || loop.QueuedEvents() != 3 {
		t.Fatal("a different time removed the next candidate")
	}
	first, found := loop.TakeAt(10)
	if !found {
		t.Fatal("first same-time candidate is missing")
	}
	second, found := loop.TakeAt(10)
	if !found {
		t.Fatal("second same-time candidate is missing")
	}
	if code := loop.RestoreCandidate(second); code != model.ErrOK {
		t.Fatal(code)
	}
	if code := loop.RestoreCandidate(first); code != model.ErrOK {
		t.Fatal(code)
	}
	var restored []GenericEvent
	for next, found := loop.NextEventAt(); found; next, found = loop.NextEventAt() {
		event, taken := loop.TakeAt(next)
		if !taken {
			t.Fatal("visible candidate could not be taken")
		}
		restored = append(restored, event)
	}
	want := append([]GenericEvent(nil), inputs...)
	for index := range want {
		want[index].Seq = uint64(index + 1)
	}
	if !reflect.DeepEqual(restored, want) || loop.TimeMs() != 7 || loop.ProcessedEvents() != 0 || loop.PeakQueuedEvents() != 3 {
		t.Fatal("lookahead changed event identity, order, time or accounting", restored, loop.TimeMs(), loop.ProcessedEvents())
	}
	if code := loop.Enqueue(inputs[0]); code != model.ErrOK {
		t.Fatal(code)
	}
	newEvent, found := loop.TakeAt(10)
	if !found || newEvent.Seq != 4 {
		t.Fatal("restoration consumed or reset the next new-event sequence", newEvent)
	}
}

func TestLoopCandidateRestoreRejectsMissingIdentityAndReportsCapacity(t *testing.T) {
	loop := NewLoop(0, 20, model.StopPolicy{})
	loop.SetQueueLimit(1)
	if loop.CanEnqueue(-1) || !loop.CanEnqueue(1) || loop.RemainingCapacity() != 1 {
		t.Fatal("invalid initial capacity preflight")
	}
	event := GenericEvent{TimeMs: 10, Kind: GenericEventProviderTick}
	if code := loop.RestoreCandidate(event); code != model.ErrInvalidInput || loop.QueuedEvents() != 0 {
		t.Fatal("restoration manufactured a new event", code)
	}
	if code := loop.Enqueue(event); code != model.ErrOK {
		t.Fatal(code)
	}
	if loop.CanEnqueue(1) || loop.RemainingCapacity() != 0 || loop.Enqueue(event) != model.ErrQueueOverflow {
		t.Fatal("full queue accepted a new event")
	}
	held, found := loop.TakeAt(10)
	if !found || held.Seq != 1 {
		t.Fatal("invalid restoration advanced the sequence", held)
	}
	if code := loop.Enqueue(GenericEvent{TimeMs: 11, Kind: GenericEventSample}); code != model.ErrOK {
		t.Fatal(code)
	}
	if code := loop.RestoreCandidate(held); code != model.ErrQueueOverflow || loop.QueuedEvents() != 1 {
		t.Fatal("candidate restoration concealed capacity failure", code)
	}
	remaining, found := loop.TakeAt(11)
	if !found || remaining.Kind != GenericEventSample || remaining.Seq != 2 || loop.TimeMs() != 0 || loop.ProcessedEvents() != 0 {
		t.Fatal("failed restore changed the remaining queue or accepted an event", remaining)
	}
}

func TestLoopWakeupQueriesAndReschedulingDoNotRequireNewCapacity(t *testing.T) {
	loop := NewLoop(0, 30, model.StopPolicy{})
	loop.SetQueueLimit(4)
	inputs := []GenericEvent{
		{TimeMs: 20, Kind: GenericEventBasicAttack, BasicAttackGeneration: 1},
		{TimeMs: 20, Kind: GenericEventAutomaticSkill, AutomaticGeneration: 2},
		{TimeMs: 20, Kind: GenericEventAbilityAttempt, DriverEntryIndex: 2, CooldownWaitVersion: 3},
		{TimeMs: 20, Kind: GenericEventAbilityAttempt, DriverEntryIndex: 99},
	}
	for _, event := range inputs {
		if code := loop.Enqueue(event); code != model.ErrOK {
			t.Fatal(code)
		}
	}
	if !loop.HasBasicAttack() || !loop.HasAutomaticSkill() || !loop.HasCooldownAttempt(2) || loop.HasCooldownAttempt(99) || loop.HasCooldownAttempt(8) || loop.CanEnqueue(1) {
		t.Fatal("wakeup existence lost its actual kind, index or wait version")
	}
	if !loop.RescheduleBasicAttack(5, 11) || !loop.RescheduleAutomaticSkill(6, 12) || !loop.RescheduleCooldownAttempt(2, 7, 13) || loop.RescheduleCooldownAttempt(99, 1, 14) {
		t.Fatal("existing wakeup could not be rescheduled in a full queue")
	}
	if loop.QueuedEvents() != 4 || loop.PeakQueuedEvents() != 4 || loop.RemainingCapacity() != 0 {
		t.Fatal("rescheduling changed queue occupancy")
	}
	for index, at := range []int64{5, 6, 7} {
		event, found := loop.TakeAt(at)
		if !found || event.Seq != uint64(index+1) {
			t.Fatal("rescheduling changed sequence or time", event)
		}
		switch index {
		case 0:
			if event.Kind != GenericEventBasicAttack || event.BasicAttackGeneration != 11 {
				t.Fatal(event)
			}
		case 1:
			if event.Kind != GenericEventAutomaticSkill || event.AutomaticGeneration != 12 {
				t.Fatal(event)
			}
		case 2:
			if event.Kind != GenericEventAbilityAttempt || event.DriverEntryIndex != 2 || event.CooldownWaitVersion != 13 {
				t.Fatal(event)
			}
		}
	}
	if loop.HasBasicAttack() || loop.HasAutomaticSkill() || loop.HasCooldownAttempt(2) {
		t.Fatal("removed wakeup remained present")
	}
}
