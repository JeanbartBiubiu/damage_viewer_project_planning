package scheduler

import "testing"

func TestGenericHeapCategoryOrderSameTimeMs(t *testing.T) {
	heap := NewGenericHeap(8)
	events := []GenericEvent{
		{TimeMs: 10, Category: GenericCategorySample, Priority: 0, Seq: 1, Kind: GenericEventSample},
		{TimeMs: 10, Category: GenericCategoryAbilityAttempt, Priority: 5, Seq: 2, Kind: GenericEventAbilityAttempt},
		{TimeMs: 10, Category: GenericCategoryAbilityAttempt, Priority: 1, Seq: 3, Kind: GenericEventAbilityAttempt},
		{TimeMs: 10, Category: GenericCategoryProviderTick, Priority: 0, Seq: 4, Kind: GenericEventProviderTick},
		{TimeMs: 10, Category: GenericCategoryExpireCleanup, Priority: 0, Seq: 6, Kind: GenericEventExpireCleanup},
		{TimeMs: 5, Category: GenericCategorySample, Priority: 0, Seq: 5, Kind: GenericEventSample},
	}
	for _, ev := range events {
		if code := heap.Push(ev); code != "OK" {
			t.Fatalf("push failed: %s", code)
		}
	}
	var got []GenericEvent
	for heap.Len() > 0 {
		ev, _ := heap.Pop()
		got = append(got, ev)
	}
	wantCategories := []GenericEventCategory{
		GenericCategorySample, // t=5
		GenericCategoryExpireCleanup,
		GenericCategoryProviderTick,
		GenericCategoryAbilityAttempt, // priority 1
		GenericCategoryAbilityAttempt, // priority 5
		GenericCategorySample,
	}
	if len(got) != len(wantCategories) {
		t.Fatalf("got %d events, want %d", len(got), len(wantCategories))
	}
	for i, want := range wantCategories {
		if got[i].Category != want {
			t.Fatalf("at %d category=%d want=%d (timeMs=%d priority=%d seq=%d kind=%d)",
				i, got[i].Category, want, got[i].TimeMs, got[i].Priority, got[i].Seq, got[i].Kind)
		}
	}
	if got[3].Priority != 1 || got[3].Seq != 3 {
		t.Fatalf("ability_attempt tie-break: priority=%d seq=%d", got[3].Priority, got[3].Seq)
	}
	if got[4].Priority != 5 || got[4].Seq != 2 {
		t.Fatalf("ability_attempt tie-break: priority=%d seq=%d", got[4].Priority, got[4].Seq)
	}
}

func TestGenericEventKindsDistinct(t *testing.T) {
	if GenericEventExpireCleanup == GenericEventProviderTick ||
		GenericEventProviderTick == GenericEventAbilityAttempt ||
		GenericEventAbilityAttempt == GenericEventTriggeredContinuation ||
		GenericEventTriggeredContinuation == GenericEventSample {
		t.Fatal("generic event kinds must be distinct")
	}
}

func TestGenericLessAbilityAttemptBeforeSample(t *testing.T) {
	attempt := GenericEvent{TimeMs: 0, Category: GenericCategoryAbilityAttempt, Priority: 0, Seq: 1}
	sample := GenericEvent{TimeMs: 0, Category: GenericCategorySample, Priority: 0, Seq: 2}
	if !GenericLess(attempt, sample) {
		t.Fatal("ability_attempt should sort before sample at same timeMs")
	}
	if GenericLess(sample, attempt) {
		t.Fatal("sample should not sort before ability_attempt")
	}
}

func TestGenericLessTriggeredContinuationBetweenAttemptAndSample(t *testing.T) {
	attempt := GenericEvent{TimeMs: 10, Category: GenericCategoryAbilityAttempt, Priority: 0, Seq: 1, Kind: GenericEventAbilityAttempt}
	cont := GenericEvent{TimeMs: 10, Category: GenericCategoryTriggeredContinuation, Priority: 0, Seq: 2, Kind: GenericEventTriggeredContinuation, ContinuationID: 7}
	sample := GenericEvent{TimeMs: 10, Category: GenericCategorySample, Priority: 0, Seq: 3, Kind: GenericEventSample}
	if !GenericLess(attempt, cont) || !GenericLess(cont, sample) {
		t.Fatal("order must be ability_attempt < triggered_continuation < sample")
	}
	heap := NewGenericHeap(4)
	for _, ev := range []GenericEvent{sample, cont, attempt} {
		if code := heap.Push(ev); code != "OK" {
			t.Fatalf("push: %s", code)
		}
	}
	got1, _ := heap.Pop()
	got2, _ := heap.Pop()
	got3, _ := heap.Pop()
	if got1.Kind != GenericEventAbilityAttempt || got2.Kind != GenericEventTriggeredContinuation || got3.Kind != GenericEventSample {
		t.Fatalf("kinds=%d,%d,%d", got1.Kind, got2.Kind, got3.Kind)
	}
	if got2.ContinuationID != 7 {
		t.Fatalf("ContinuationID=%d want 7", got2.ContinuationID)
	}
}

func TestGenericLessSameTimeContinuationsBySeq(t *testing.T) {
	heap := NewGenericHeap(4)
	a := GenericEvent{TimeMs: 200, Category: GenericCategoryTriggeredContinuation, Kind: GenericEventTriggeredContinuation, ContinuationID: 2, Seq: 2}
	b := GenericEvent{TimeMs: 200, Category: GenericCategoryTriggeredContinuation, Kind: GenericEventTriggeredContinuation, ContinuationID: 1, Seq: 1}
	_ = heap.Push(a)
	_ = heap.Push(b)
	first, _ := heap.Pop()
	second, _ := heap.Pop()
	if first.ContinuationID != 1 || second.ContinuationID != 2 {
		t.Fatalf("seq order ContinuationID=%d,%d want 1,2", first.ContinuationID, second.ContinuationID)
	}
}
