package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func guinsooCadenceBoilingStrikeOpsWithDelay(delayMs int) []model.OperationDefinition {
	ops := guinsooCadenceBoilingStrikeOps()
	for i := range ops {
		if ops[i].Operation == model.OperationKindRepeat {
			ops[i].RepeatDelayMs = delayMs
		}
	}
	return ops
}

func guinsooCadenceListenersWithDelay(copyableAmt float64, delayMs int) []model.ListenerDefinition {
	return []model.ListenerDefinition{
		guinsooKCopyableListener("guinsoo_wrath", copyableAmt, true),
		{
			ListenerKey:  "guinsoo_boiling_strike",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations:   guinsooCadenceBoilingStrikeOpsWithDelay(delayMs),
		},
	}
}

func phantomEvidenceTimes(done model.DoneResult) []int64 {
	var times []int64
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataBool(item.Data, "phantom") {
			times = append(times, item.TimeMs)
		}
	}
	return times
}

// TestGenericRunRepeatDelayOmittedMatchesImmediate proves omitted delay keeps Guinsoo cadence
// timestamps/order/totals/evidence identical to the immediate path.
func TestGenericRunRepeatDelayOmittedMatchesImmediate(t *testing.T) {
	baseListeners := guinsooCadenceListeners(guinsooKCopyableAmt)
	zeroListeners := guinsooCadenceListenersWithDelay(guinsooKCopyableAmt, 0)

	cOmit, rOmit := loadGuinsooCadenceFixture(t, baseListeners, nil, 7)
	cZero, rZero := loadGuinsooCadenceFixture(t, zeroListeners, nil, 7)
	doneOmit := runGuinsooK(t, cOmit, rOmit)
	doneZero := runGuinsooK(t, cZero, rZero)

	if math.Abs(doneOmit.Summary.SourceDamageDealt-doneZero.Summary.SourceDamageDealt) > 1e-6 {
		t.Fatalf("dealt omit=%v zero=%v", doneOmit.Summary.SourceDamageDealt, doneZero.Summary.SourceDamageDealt)
	}
	omitTimes := phantomEvidenceTimes(doneOmit)
	zeroTimes := phantomEvidenceTimes(doneZero)
	if len(omitTimes) != 1 || len(zeroTimes) != 1 {
		t.Fatalf("phantom counts omit=%d zero=%d", len(omitTimes), len(zeroTimes))
	}
	if omitTimes[0] != zeroTimes[0] || omitTimes[0] != 600 {
		t.Fatalf("phantom times omit=%v zero=%v want [600]", omitTimes, zeroTimes)
	}
	var phantomTag string
	for _, item := range damageEvidenceItems(doneOmit) {
		if evidenceDataBool(item.Data, "phantom") {
			phantomTag = evidenceDataString(item.Data, "repeatTag")
			break
		}
	}
	if phantomTag != "phantom_hit" {
		t.Fatalf("repeatTag=%q want phantom_hit", phantomTag)
	}
}

func TestGenericRunRepeatDelay200ExactTiming(t *testing.T) {
	listeners := guinsooCadenceListenersWithDelay(guinsooKCopyableAmt, 200)
	c, r := loadGuinsooCadenceFixture(t, listeners, nil, 7)
	// Hit 7 at 600ms; continuation at 800. Duration must cover 800.
	r.StopPolicy.DurationMs = 900
	done := runGuinsooK(t, c, r)

	times := phantomEvidenceTimes(done)
	if len(times) != 1 {
		t.Fatalf("phantom count=%d want 1", len(times))
	}
	if times[0] != 800 {
		t.Fatalf("phantom TimeMs=%d want 800", times[0])
	}
	wantDealt := guinsooKAAAmt*7 + guinsooKCopyableAmt*7 + guinsooKCopyableAmt
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

func TestGenericRunRepeatDelayNoDamageBeforeDelayOrPastDuration(t *testing.T) {
	listeners := guinsooCadenceListenersWithDelay(guinsooKCopyableAmt, 200)

	t.Run("duration_ends_before_continuation", func(t *testing.T) {
		c, r := loadGuinsooCadenceFixture(t, listeners, nil, 7)
		// Hit 7 at 600; continuation would be 800; end before that.
		r.StopPolicy.DurationMs = 700
		done := runGuinsooK(t, c, r)
		if got := phantomDamageEvidenceCount(done); got != 0 {
			t.Fatalf("phantom count=%d want 0 when duration ends before +200ms", got)
		}
	})

	t.Run("no_phantom_at_plus_199", func(t *testing.T) {
		c, r := loadGuinsooCadenceFixture(t, listeners, nil, 7)
		r.StopPolicy.DurationMs = 600 + 199
		done := runGuinsooK(t, c, r)
		if got := phantomDamageEvidenceCount(done); got != 0 {
			t.Fatalf("phantom count=%d want 0 at +199ms", got)
		}
		for _, tm := range phantomEvidenceTimes(done) {
			if tm == 600+199 {
				t.Fatalf("unexpected phantom at +199ms")
			}
		}
	})
}

func TestFlushImmediateCompletesBeforeDelayedEnqueue(t *testing.T) {
	s := &genericRunState{
		budget:        model.DefaultSafetyBudget(),
		nowMs:         1000,
		heap:          scheduler.NewGenericHeap(8),
		continuations: make(map[uint64]*triggeredContinuationPayload),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				key: model.SelectorSource,
				providerState: map[string]*providerStateBag{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				},
			},
			model.SelectorTarget: {
				key: model.SelectorTarget,
				attributes: map[string]model.AttributeSlotDef{
					"hp": {Base: 10000, Current: 10000, Max: 10000, Resolved: 10000},
				},
			},
		},
	}
	collector := &eventCopyableCollector{
		damages: []copyableDamageFrozen{{
			providerRef: "prov:a", originRef: "listener:a", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget,
			damageType: "damage/true", rawAmount: 11,
		}},
		repeats: []deferredRepeatRequest{
			{
				ownerCombatantKey: model.SelectorSource, ownerProviderRef: "prov:gate",
				triggerStateKey: "stacks", threshold: 4, repeatCount: 1,
				repeatScope: model.RepeatScopeCopyableOnHit, repeatTag: "immediate",
				repeatDelayMs: 0,
			},
			{
				ownerCombatantKey: model.SelectorSource, ownerProviderRef: "prov:gate",
				triggerStateKey: "stacks", threshold: 4, repeatCount: 1,
				repeatScope: model.RepeatScopeCopyableOnHit, repeatTag: "delayed",
				repeatDelayMs: 200,
			},
		},
	}
	if err := s.flushDeferredPhantomReplay(collector); err != nil {
		t.Fatalf("flush: %+v", err)
	}
	if len(s.damageHistory) != 1 || s.damageHistory[0].timeMs != 1000 {
		t.Fatalf("immediate damageHistory=%+v want one entry at 1000", s.damageHistory)
	}
	if len(s.continuations) != 1 {
		t.Fatalf("continuations=%d want 1", len(s.continuations))
	}
	ev, ok := s.heap.Pop()
	if !ok {
		t.Fatal("expected continuation on heap")
	}
	if ev.Kind != scheduler.GenericEventTriggeredContinuation || ev.Category != scheduler.GenericCategoryTriggeredContinuation {
		t.Fatalf("kind/category=%d/%d", ev.Kind, ev.Category)
	}
	if ev.TimeMs != 1200 || ev.ContinuationID == 0 {
		t.Fatalf("continuation TimeMs/ID=%d/%d want 1200/nonzero", ev.TimeMs, ev.ContinuationID)
	}
	if s.heap.Len() != 0 {
		t.Fatalf("extra heap events=%d", s.heap.Len())
	}
}

func TestFlushDelayedMultipleDamagesAndSameTimeContinuationsDeterministic(t *testing.T) {
	s := &genericRunState{
		budget:        model.DefaultSafetyBudget(),
		nowMs:         50,
		heap:          scheduler.NewGenericHeap(8),
		continuations: make(map[uint64]*triggeredContinuationPayload),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				key: model.SelectorSource,
				providerState: map[string]*providerStateBag{
					"prov:a": {state: map[string]float64{"stacks": 4}},
					"prov:z": {state: map[string]float64{"stacks": 4}},
				},
			},
			model.SelectorTarget: {
				key: model.SelectorTarget,
				attributes: map[string]model.AttributeSlotDef{
					"hp": {Base: 10000, Current: 10000, Max: 10000, Resolved: 10000},
				},
			},
		},
	}
	collector := &eventCopyableCollector{
		damages: []copyableDamageFrozen{
			{providerRef: "prov:z", originRef: "o:z", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget, damageType: "damage/true", rawAmount: 3},
			{providerRef: "prov:a", originRef: "o:a", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget, damageType: "damage/true", rawAmount: 2},
		},
		repeats: []deferredRepeatRequest{
			{
				ownerCombatantKey: model.SelectorSource, ownerProviderRef: "prov:z",
				triggerStateKey: "stacks", threshold: 4, repeatCount: 1,
				repeatScope: model.RepeatScopeCopyableOnHit, repeatTag: "tag_z", repeatDelayMs: 100,
			},
			{
				ownerCombatantKey: model.SelectorSource, ownerProviderRef: "prov:a",
				triggerStateKey: "stacks", threshold: 4, repeatCount: 1,
				repeatScope: model.RepeatScopeCopyableOnHit, repeatTag: "tag_a", repeatDelayMs: 100,
			},
		},
	}
	if err := s.flushDeferredPhantomReplay(collector); err != nil {
		t.Fatalf("flush: %+v", err)
	}
	if len(s.damageHistory) != 0 {
		t.Fatalf("delayed path must not apply during flush, got %d", len(s.damageHistory))
	}
	first, _ := s.heap.Pop()
	second, _ := s.heap.Pop()
	if first.TimeMs != 150 || second.TimeMs != 150 {
		t.Fatalf("times=%d,%d want 150,150", first.TimeMs, second.TimeMs)
	}
	// Sorted repeats: prov:a before prov:z → first enqueued gets lower Seq.
	pFirst := s.continuations[first.ContinuationID]
	pSecond := s.continuations[second.ContinuationID]
	if pFirst == nil || pSecond == nil {
		t.Fatal("missing continuation payloads")
	}
	if pFirst.req.ownerProviderRef != "prov:a" || pSecond.req.ownerProviderRef != "prov:z" {
		t.Fatalf("enqueue order=%s,%s want prov:a,prov:z", pFirst.req.ownerProviderRef, pSecond.req.ownerProviderRef)
	}
	if pFirst.damages[0].providerRef != "prov:a" || pFirst.damages[1].providerRef != "prov:z" {
		t.Fatalf("frozen damage order=%s,%s", pFirst.damages[0].providerRef, pFirst.damages[1].providerRef)
	}

	s.nowMs = 150
	if err := s.handleTriggeredContinuation(first); err != nil {
		t.Fatalf("handle first: %+v", err)
	}
	if err := s.handleTriggeredContinuation(second); err != nil {
		t.Fatalf("handle second: %+v", err)
	}
	if len(s.damageHistory) != 4 {
		t.Fatalf("damageHistory len=%d want 4", len(s.damageHistory))
	}
	if s.damageHistory[0].amount != 2 || s.damageHistory[1].amount != 3 {
		t.Fatalf("first continuation amounts=%v,%v want 2,3", s.damageHistory[0].amount, s.damageHistory[1].amount)
	}
	if len(s.continuations) != 0 {
		t.Fatalf("payloads not consumed: %d left", len(s.continuations))
	}
}

func TestTriggeredContinuationNoRecursionAndFreshCommandBudget(t *testing.T) {
	s := &genericRunState{
		budget: model.SafetyBudget{MaxCommandsPerEvent: 1, MaxEvents: 1000, MaxChainDepth: 8},
		nowMs:  0,
		heap:   scheduler.NewGenericHeap(4),
		continuations: make(map[uint64]*triggeredContinuationPayload),
		compiled: compileSessionStubForRepeatDelay(),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				key: model.SelectorSource,
				providerState: map[string]*providerStateBag{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				},
			},
			model.SelectorTarget: {
				key: model.SelectorTarget,
				attributes: map[string]model.AttributeSlotDef{
					"hp": {Base: 10000, Current: 10000, Max: 10000, Resolved: 10000},
				},
			},
		},
	}
	// Exhaust original collector budget first; delayed continuation must use a fresh counter.
	orig := &eventCopyableCollector{
		commandCount: 1,
		damages: []copyableDamageFrozen{
			{providerRef: "prov:a", originRef: "o", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget, damageType: "damage/true", rawAmount: 5},
			{providerRef: "prov:b", originRef: "o", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget, damageType: "damage/true", rawAmount: 7},
		},
		repeats: []deferredRepeatRequest{{
			ownerCombatantKey: model.SelectorSource, ownerProviderRef: "prov:gate",
			triggerStateKey: "stacks", threshold: 4, repeatCount: 1,
			repeatScope: model.RepeatScopeCopyableOnHit, repeatTag: "delayed",
			repeatDelayMs: 10,
		}},
	}
	if err := s.flushDeferredPhantomReplay(orig); err != nil {
		t.Fatalf("flush: %+v", err)
	}
	ev, ok := s.heap.Pop()
	if !ok {
		t.Fatal("expected continuation")
	}
	// Two damages with MaxCommandsPerEvent=1 → first applies, second fails.
	err := s.handleTriggeredContinuation(ev)
	if err == nil {
		t.Fatal("expected command budget failure on continuation")
	}
	if len(s.continuations) != 0 {
		t.Fatalf("failed handler must still consume payload, left=%d", len(s.continuations))
	}
	if len(s.damageHistory) != 1 {
		t.Fatalf("damageHistory=%d want 1 before budget fail", len(s.damageHistory))
	}

	// Recursion: handler must not re-register delayed repeats (phantomDepth / no collector repeats).
	s2 := &genericRunState{
		budget:        model.DefaultSafetyBudget(),
		nowMs:         10,
		heap:          scheduler.NewGenericHeap(4),
		continuations: make(map[uint64]*triggeredContinuationPayload),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				key: model.SelectorSource,
				providerState: map[string]*providerStateBag{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				},
			},
			model.SelectorTarget: {
				key: model.SelectorTarget,
				attributes: map[string]model.AttributeSlotDef{
					"hp": {Base: 10000, Current: 10000, Max: 10000, Resolved: 10000},
				},
			},
		},
	}
	id := uint64(1)
	s2.continuations[id] = &triggeredContinuationPayload{
		damages: []copyableDamageFrozen{{
			providerRef: "prov:a", originRef: "o", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget,
			damageType: "damage/true", rawAmount: 9,
		}},
		req: deferredRepeatRequest{
			ownerCombatantKey: model.SelectorSource, ownerProviderRef: "prov:gate",
			triggerStateKey: "stacks", threshold: 4, repeatCount: 1,
			repeatScope: model.RepeatScopeCopyableOnHit, repeatTag: "once",
			repeatDelayMs: 10,
		},
	}
	if err := s2.handleTriggeredContinuation(scheduler.GenericEvent{
		TimeMs: 10, Category: scheduler.GenericCategoryTriggeredContinuation,
		Kind: scheduler.GenericEventTriggeredContinuation, ContinuationID: id,
	}); err != nil {
		t.Fatalf("handle: %+v", err)
	}
	if s2.heap.Len() != 0 || len(s2.continuations) != 0 {
		t.Fatalf("continuation must not recurse: heap=%d payloads=%d", s2.heap.Len(), len(s2.continuations))
	}
}

func TestTriggeredContinuationHeapPushFailureIsRunError(t *testing.T) {
	s := &genericRunState{
		budget:        model.DefaultSafetyBudget(),
		nowMs:         0,
		heap:          scheduler.NewGenericHeap(1),
		continuations: make(map[uint64]*triggeredContinuationPayload),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				key: model.SelectorSource,
				providerState: map[string]*providerStateBag{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				},
			},
			model.SelectorTarget: {
				key:        model.SelectorTarget,
				attributes: map[string]model.AttributeSlotDef{"hp": {Base: 100, Current: 100, Max: 100, Resolved: 100}},
			},
		},
	}
	for i := 0; i < scheduler.MaxGenericEventHeap; i++ {
		if code := s.heap.Push(scheduler.GenericEvent{TimeMs: int64(i), Category: scheduler.GenericCategorySample, Kind: scheduler.GenericEventSample}); code != model.ErrOK {
			t.Fatalf("seed push %d: %s", i, code)
		}
	}
	err := s.enqueueTriggeredContinuation(nil, deferredRepeatRequest{
		ownerCombatantKey: model.SelectorSource, ownerProviderRef: "prov:gate",
		triggerStateKey: "stacks", threshold: 4, repeatCount: 1,
		repeatScope: model.RepeatScopeCopyableOnHit, repeatTag: "x",
		repeatDelayMs: 1,
	})
	if err == nil {
		t.Fatal("expected queue overflow run error")
	}
	if len(s.continuations) != 0 {
		t.Fatalf("overflow must not leave payload, left=%d", len(s.continuations))
	}
}

func compileSessionStubForRepeatDelay() compile.CompiledSession {
	return compile.CompiledSession{
		SchemaHash: "s",
		RulesHash:  "r",
	}
}
