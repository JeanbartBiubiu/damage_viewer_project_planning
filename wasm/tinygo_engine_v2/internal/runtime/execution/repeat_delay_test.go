package execution

import (
	testing "testing"
	attribute "tinygo_engine_v2/internal/base/attribute"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actor "tinygo_engine_v2/internal/runtime/actor"
	scheduler "tinygo_engine_v2/internal/scheduler"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestFlushImmediateCompletesBeforeDelayedEnqueue(t *testing.T) {
	s := &Engine{
		budget: model.DefaultSafetyBudget(),
		loop:   newTestLoopAt(1000),

		continuations: make(map[uint64]*triggeredContinuationPayload),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				numbers: actor.New(model.SelectorSource, attribute.Table{}, nil),
				providerState: testProviderStates(providerStateTestSeeds{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				}),
			},
			model.SelectorTarget: {numbers: actor.New(model.SelectorTarget,
				attribute.FromMap(map[string]model.AttributeSlotDef{
					"hp": {Base: 10000, Current: 10000, Max: 10000, Resolved: 10000},
				}), nil),
			},
		},
	}
	registerTestDefense(t, s, "damage/true", formuladefinition.ConstantDefense("1"))
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
	if len(reportedDamageHistory(s)) != 1 || reportedDamageHistory(s)[0].timeMs != 1000 {
		t.Fatalf("immediate damageHistory=%+v want one entry at 1000", reportedDamageHistory(s))
	}
	if len(s.continuations) != 1 {
		t.Fatalf("continuations=%d want 1", len(s.continuations))
	}
	ev, ok := s.loop.Queue().Pop()
	if !ok {
		t.Fatal("expected continuation on heap")
	}
	if ev.Kind != scheduler.GenericEventTriggeredContinuation || ev.Category != scheduler.GenericCategoryTriggeredContinuation {
		t.Fatalf("kind/category=%d/%d", ev.Kind, ev.Category)
	}
	if ev.TimeMs != 1200 || ev.ContinuationID == 0 {
		t.Fatalf("continuation TimeMs/ID=%d/%d want 1200/nonzero", ev.TimeMs, ev.ContinuationID)
	}
	if s.loop.Queue().Len() != 0 {
		t.Fatalf("extra heap events=%d", s.loop.Queue().Len())
	}
}

func TestFlushDelayedMultipleDamagesAndSameTimeContinuationsDeterministic(t *testing.T) {
	s := &Engine{
		budget: model.DefaultSafetyBudget(),
		loop:   newTestLoopAt(50),

		continuations: make(map[uint64]*triggeredContinuationPayload),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				numbers: actor.New(model.SelectorSource, attribute.Table{}, nil),
				providerState: testProviderStates(providerStateTestSeeds{
					"prov:a": {state: map[string]float64{"stacks": 4}},
					"prov:z": {state: map[string]float64{"stacks": 4}},
				}),
			},
			model.SelectorTarget: {numbers: actor.New(model.SelectorTarget,
				attribute.FromMap(map[string]model.AttributeSlotDef{
					"hp": {Base: 10000, Current: 10000, Max: 10000, Resolved: 10000},
				}), nil),
			},
		},
	}
	registerTestDefense(t, s, "damage/true", formuladefinition.ConstantDefense("1"))
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
	if len(reportedDamageHistory(s)) != 0 {
		t.Fatalf("delayed path must not apply during flush, got %d", len(reportedDamageHistory(s)))
	}
	first, _ := s.loop.Queue().Pop()
	second, _ := s.loop.Queue().Pop()
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

	s.loop.Advance(150)
	if err := s.handleTriggeredContinuation(first); err != nil {
		t.Fatalf("handle first: %+v", err)
	}
	if err := s.handleTriggeredContinuation(second); err != nil {
		t.Fatalf("handle second: %+v", err)
	}
	if len(reportedDamageHistory(s)) != 4 {
		t.Fatalf("damageHistory len=%d want 4", len(reportedDamageHistory(s)))
	}
	if reportedDamageHistory(s)[0].amount != 2 || reportedDamageHistory(s)[1].amount != 3 {
		t.Fatalf("first continuation amounts=%v,%v want 2,3", reportedDamageHistory(s)[0].amount, reportedDamageHistory(s)[1].amount)
	}
	if len(s.continuations) != 0 {
		t.Fatalf("payloads not consumed: %d left", len(s.continuations))
	}
}

func TestTriggeredContinuationNoRecursionAndFreshCommandBudget(t *testing.T) {
	s := &Engine{
		budget: model.SafetyBudget{MaxCommandsPerEvent: 1, MaxEvents: 1000, MaxChainDepth: 8, MaxEvidenceItems: 1000},
		loop:   newTestLoopAt(0),

		continuations: make(map[uint64]*triggeredContinuationPayload),
		compiled:      compileSessionStubForRepeatDelay(),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				numbers: actor.New(model.SelectorSource, attribute.Table{}, nil),
				providerState: testProviderStates(providerStateTestSeeds{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				}),
			},
			model.SelectorTarget: {numbers: actor.New(model.SelectorTarget,
				attribute.FromMap(map[string]model.AttributeSlotDef{
					"hp": {Base: 10000, Current: 10000, Max: 10000, Resolved: 10000},
				}), nil),
			},
		},
	}
	registerTestDefense(t, s, "damage/true", formuladefinition.ConstantDefense("1"))
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
	ev, ok := s.loop.Queue().Pop()
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
	if len(reportedDamageHistory(s)) != 1 {
		t.Fatalf("damageHistory=%d want 1 before budget fail", len(reportedDamageHistory(s)))
	}

	// Recursion: handler must not re-register delayed repeats (phantomDepth / no collector repeats).
	s2 := &Engine{
		budget: model.DefaultSafetyBudget(),
		loop:   newTestLoopAt(10),

		continuations: make(map[uint64]*triggeredContinuationPayload),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				numbers: actor.New(model.SelectorSource, attribute.Table{}, nil),
				providerState: testProviderStates(providerStateTestSeeds{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				}),
			},
			model.SelectorTarget: {numbers: actor.New(model.SelectorTarget,
				attribute.FromMap(map[string]model.AttributeSlotDef{
					"hp": {Base: 10000, Current: 10000, Max: 10000, Resolved: 10000},
				}), nil),
			},
		},
	}
	registerTestDefense(t, s2, "damage/true", formuladefinition.ConstantDefense("1"))
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
	if s2.loop.Queue().Len() != 0 || len(s2.continuations) != 0 {
		t.Fatalf("continuation must not recurse: heap=%d payloads=%d", s2.loop.Queue().Len(), len(s2.continuations))
	}
}

func TestTriggeredContinuationHeapPushFailureIsRunError(t *testing.T) {
	s := &Engine{
		budget: model.DefaultSafetyBudget(),
		loop:   newTestLoopAt(0),

		continuations: make(map[uint64]*triggeredContinuationPayload),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				numbers: actor.New(model.SelectorSource, attribute.Table{}, nil),
				providerState: testProviderStates(providerStateTestSeeds{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				}),
			},
			model.SelectorTarget: {numbers: actor.New(model.SelectorTarget,
				attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Base: 100, Current: 100, Max: 100, Resolved: 100}}), nil),
			},
		},
	}
	for i := 0; i < scheduler.MaxGenericEventHeap; i++ {
		if code := s.loop.Queue().Push(scheduler.GenericEvent{TimeMs: int64(i), Category: scheduler.GenericCategorySample, Kind: scheduler.GenericEventSample}); code != model.ErrOK {
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

func compileSessionStubForRepeatDelay() planbundle.CompiledSession {
	return planbundle.CompiledSession{
		SchemaHash: "s",
		RulesHash:  "r",
	}
}
