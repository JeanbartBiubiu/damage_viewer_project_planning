package execution

import (
	"testing"

	"tinygo_engine_v2/internal/formula"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestPreparedDamageStateFactsKeepReadOrderAndFrozenZero(t *testing.T) {
	request := formula.FactRequest{Kind: formula.ReadEventProviderTargetStateBefore, Key: "mark"}
	missing := formula.FactRequest{Kind: formula.ReadEventProviderTargetStateBefore, Key: "other"}
	f := Frame{
		run: &Engine{compiled: planbundle.CompiledSession{DamageStateReaders: []planbundle.CompiledDamageStateReader{
			{Owner: "source", ProviderRef: "own", StateKey: "mark"},
		}}},
		evalScope: evalScope{ownerCombatantKey: "source", ownerProviderRef: "own",
			eventCtx: &eventFormulaSnapshot{EventType: eventTypeDamageInstance, EventSourceKey: "source", EventTargetKey: "target", DamageID: 1,
				DamageStateBefore: []frozenDamageStateBefore{{Reader: 0, Value: 0}, {Reader: ^uint16(0), Value: 9}}}},
	}
	facts := f.prepareFormulaFacts([]formula.FactRequest{request, missing})
	if value, err, exists := facts.Lookup(request); !exists || err != nil || value != 0 {
		t.Fatal("later invalid row contaminated first matching frozen zero", value, err, exists)
	}
	if _, err, exists := facts.Lookup(missing); !exists || err == nil {
		t.Fatal("missing read did not retain its own deferred error", err, exists)
	}
	f.eventCtx.DamageStateBefore[0].Value = 8
	if value, err, _ := facts.Lookup(request); err != nil || value != 0 {
		t.Fatal("prepared formula facts retained the mutable frame", value, err)
	}
	f.eventCtx.DamageStateBefore[0], f.eventCtx.DamageStateBefore[1] = f.eventCtx.DamageStateBefore[1], f.eventCtx.DamageStateBefore[0]
	failed := f.prepareFormulaFacts([]formula.FactRequest{request})
	if _, err, exists := failed.Lookup(request); !exists || err == nil {
		t.Fatal("invalid earlier row was skipped while preparing the same read", err, exists)
	}
}

func TestPreparedReceivedShieldFactsKeepReceiptAfterDepletion(t *testing.T) {
	s := receivedShieldInitializedState(t)
	event := actualReceivedShieldEvent(t, s, receivedDamageFrame(t, s, 100))
	f, index := actualReceivedShieldReader(s, event)
	request := formula.FactRequest{Kind: formula.ReadReceivedLinkedShieldAbsorbed, Index: index}
	facts := f.prepareFormulaFacts([]formula.FactRequest{request})
	f.eventCtx = nil
	if value, err, exists := facts.Lookup(request); !exists || err != nil || value != 100 {
		t.Fatal("prepared receipt queried current shields or retained the frame", value, err, exists)
	}
	missing := f.prepareFormulaFacts([]formula.FactRequest{request})
	if _, err, exists := missing.Lookup(request); !exists || err == nil {
		t.Fatal("missing frozen receipt became valid zero", err, exists)
	}
}

func TestPreparingTwoFrozenStateFactsDoesNotAllocate(t *testing.T) {
	requests := []formula.FactRequest{
		{Kind: formula.ReadEventProviderTargetStateBefore, Key: "mark"},
		{Kind: formula.ReadEventProviderTargetStateBefore, Key: "count"},
	}
	f := Frame{run: &Engine{compiled: planbundle.CompiledSession{DamageStateReaders: []planbundle.CompiledDamageStateReader{
		{Owner: "source", ProviderRef: "own", StateKey: "mark"},
		{Owner: "source", ProviderRef: "own", StateKey: "count"},
	}}}, evalScope: evalScope{ownerCombatantKey: "source", ownerProviderRef: "own",
		eventCtx: &eventFormulaSnapshot{EventType: eventTypeDamageInstance, EventSourceKey: "source", EventTargetKey: "target", DamageID: 1,
			DamageStateBefore: []frozenDamageStateBefore{{Reader: 0, Value: 0}, {Reader: 1, Value: 2}}}}}
	if allocations := testing.AllocsPerRun(100, func() {
		facts := f.prepareFormulaFacts(requests)
		if value, err, exists := facts.Lookup(requests[1]); !exists || err != nil || value != 2 {
			t.Fatal(value, err, exists)
		}
	}); allocations != 0 {
		t.Fatal("two prepared facts added per-evaluation allocations", allocations)
	}
}
