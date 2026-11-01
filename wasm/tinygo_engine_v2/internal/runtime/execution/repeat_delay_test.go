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
	collector := newTestCopyableCollector(collectorTestSeed{
		damages: []copyableDamageFrozen{{
			ProviderRef: "prov:a", OriginRef: "listener:a", SourceKey: model.SelectorSource, TargetKey: model.SelectorTarget,
			DamageType: "damage/true", RawAmount: 11,
		}},
		repeats: []deferredRepeatRequest{
			{
				OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "prov:gate",
				TriggerStateKey: "stacks", Threshold: 4, RepeatCount: 1,
				RepeatScope: model.RepeatScopeCopyableOnHit, RepeatTag: "immediate",
				RepeatDelayMs: 0,
			},
			{
				OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "prov:gate",
				TriggerStateKey: "stacks", Threshold: 4, RepeatCount: 1,
				RepeatScope: model.RepeatScopeCopyableOnHit, RepeatTag: "delayed",
				RepeatDelayMs: 200,
			},
		},
	})
	if err := s.flushDeferredPhantomReplay(collector); err != nil {
		t.Fatalf("flush: %+v", err)
	}
	if len(reportedDamageHistory(s)) != 1 || reportedDamageHistory(s)[0].TimeMs != 1000 {
		t.Fatalf("immediate damageHistory=%+v want one entry at 1000", reportedDamageHistory(s))
	}
	if pendingContinuations(s) != 1 {
		t.Fatalf("continuations=%d want 1", pendingContinuations(s))
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
	collector := newTestCopyableCollector(collectorTestSeed{
		damages: []copyableDamageFrozen{
			{ProviderRef: "prov:z", OriginRef: "o:z", SourceKey: model.SelectorSource, TargetKey: model.SelectorTarget, DamageType: "damage/true", RawAmount: 3},
			{ProviderRef: "prov:a", OriginRef: "o:a", SourceKey: model.SelectorSource, TargetKey: model.SelectorTarget, DamageType: "damage/true", RawAmount: 2},
		},
		repeats: []deferredRepeatRequest{
			{
				OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "prov:z",
				TriggerStateKey: "stacks", Threshold: 4, RepeatCount: 1,
				RepeatScope: model.RepeatScopeCopyableOnHit, RepeatTag: "tag_z", RepeatDelayMs: 100,
			},
			{
				OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "prov:a",
				TriggerStateKey: "stacks", Threshold: 4, RepeatCount: 1,
				RepeatScope: model.RepeatScopeCopyableOnHit, RepeatTag: "tag_a", RepeatDelayMs: 100,
			},
		},
	})
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
	// 相同时间按登记身份执行，逐笔结果在下文断言。
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
	if reportedDamageHistory(s)[0].Amount != 2 || reportedDamageHistory(s)[1].Amount != 3 {
		t.Fatalf("first continuation amounts=%v,%v want 2,3", reportedDamageHistory(s)[0].Amount, reportedDamageHistory(s)[1].Amount)
	}
	if pendingContinuations(s) != 0 {
		t.Fatalf("payloads not consumed: %d left", pendingContinuations(s))
	}
}

func TestTriggeredContinuationNoRecursionAndFreshCommandBudget(t *testing.T) {
	s := &Engine{
		budget:   model.SafetyBudget{MaxCommandsPerEvent: 1, MaxEvents: 1000, MaxChainDepth: 8, MaxEvidenceItems: 1000},
		loop:     newTestLoopAt(0),
		compiled: compileSessionStubForRepeatDelay(),
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
	orig := newTestCopyableCollector(collectorTestSeed{
		commandCount: 1,
		damages: []copyableDamageFrozen{
			{ProviderRef: "prov:a", OriginRef: "o", SourceKey: model.SelectorSource, TargetKey: model.SelectorTarget, DamageType: "damage/true", RawAmount: 5},
			{ProviderRef: "prov:b", OriginRef: "o", SourceKey: model.SelectorSource, TargetKey: model.SelectorTarget, DamageType: "damage/true", RawAmount: 7},
		},
		repeats: []deferredRepeatRequest{{
			OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "prov:gate",
			TriggerStateKey: "stacks", Threshold: 4, RepeatCount: 1,
			RepeatScope: model.RepeatScopeCopyableOnHit, RepeatTag: "delayed",
			RepeatDelayMs: 10,
		}},
	})
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
	if pendingContinuations(s) != 0 {
		t.Fatalf("failed handler must still consume payload, left=%d", pendingContinuations(s))
	}
	if len(reportedDamageHistory(s)) != 1 {
		t.Fatalf("damageHistory=%d want 1 before budget fail", len(reportedDamageHistory(s)))
	}

	// Recursion: handler must not re-register delayed repeats (phantomDepth / no collector repeats).
	s2 := &Engine{
		budget: model.DefaultSafetyBudget(),
		loop:   newTestLoopAt(10),
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
	seed := newTestCopyableCollector(collectorTestSeed{
		damages: []copyableDamageFrozen{{
			ProviderRef: "prov:a", OriginRef: "o", SourceKey: model.SelectorSource, TargetKey: model.SelectorTarget,
			DamageType: "damage/true", RawAmount: 9,
		}},
		repeats: []deferredRepeatRequest{{
			OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "prov:gate",
			TriggerStateKey: "stacks", Threshold: 4, RepeatCount: 1,
			RepeatScope: model.RepeatScopeCopyableOnHit, RepeatTag: "once",
			RepeatDelayMs: 10,
		}},
	})
	if err := s2.flushDeferredPhantomReplay(seed); err != nil {
		t.Fatal(err)
	}
	scheduled, _ := s2.loop.Queue().Pop()
	id := scheduled.ContinuationID
	if err := s2.handleTriggeredContinuation(scheduler.GenericEvent{
		TimeMs: 10, Category: scheduler.GenericCategoryTriggeredContinuation,
		Kind: scheduler.GenericEventTriggeredContinuation, ContinuationID: id,
	}); err != nil {
		t.Fatalf("handle: %+v", err)
	}
	if s2.loop.Queue().Len() != 0 || pendingContinuations(s2) != 0 {
		t.Fatalf("continuation must not recurse: heap=%d payloads=%d", s2.loop.Queue().Len(), pendingContinuations(s2))
	}
}

func TestTriggeredContinuationHeapPushFailureIsRunError(t *testing.T) {
	s := &Engine{
		budget: model.DefaultSafetyBudget(),
		loop:   newTestLoopAt(0),
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
	err := s.flushDeferredPhantomReplay(newTestCopyableCollector(collectorTestSeed{repeats: []deferredRepeatRequest{{
		OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "prov:gate",
		TriggerStateKey: "stacks", Threshold: 4, RepeatCount: 1,
		RepeatScope: model.RepeatScopeCopyableOnHit, RepeatTag: "x",
		RepeatDelayMs: 1,
	}}}))
	if err == nil {
		t.Fatal("expected queue overflow run error")
	}
	if pendingContinuations(s) != 0 {
		t.Fatalf("overflow must not leave payload, left=%d", pendingContinuations(s))
	}
}

func compileSessionStubForRepeatDelay() planbundle.CompiledSession {
	return planbundle.CompiledSession{
		SchemaHash: "s",
		RulesHash:  "r",
	}
}
