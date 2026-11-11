package listener

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

type useOriginFixture struct {
	calls    int
	accepted bool
}

func (f *useOriginFixture) AcceptedListenerOrigin(int) bool { f.calls++; return f.accepted }

func TestListenerPayloadSeparatesEntryAndOwnedReferenceAndKeepsRangeErrorFirst(t *testing.T) {
	definition := planbundle.CompiledListener{ListenerKey: "l", OperationCount: 1, SourceAbilityIndex: 0, OwnerCombatantKey: "source", OwnerProviderRef: "p", HasCondition: true}
	payload, err := PrepareOperations(definition, []planbundle.CompiledOperation{{Ref: "op"}}, []planbundle.CompiledAbility{{AbilityKey: "a"}}, false, Identity{SessionID: "session"})
	if err != nil || payload.EntryReference != "listener:l" || payload.Reference != "source.provider[p].ability[a]" || !payload.StrictReads || !payload.Mounted || len(payload.Operations) != 1 {
		t.Fatal(payload, err)
	}
	definition.OperationCount = 2
	if _, err = PrepareOperations(definition, nil, nil, true, Identity{SessionID: "session"}); err == nil || err.Path != "" || err.Ref != "" || err.SessionID != "session" {
		t.Fatal("range error identity changed", err)
	}
}

func TestListenerUseRemapsIncomingTargetAndOnlyChecksAcceptedStartWhenNeeded(t *testing.T) {
	ledger := usage.New(usage.Identity{})
	definition := planbundle.CompiledListener{ListenerKey: "l", OwnerCombatantKey: "target", OwnerProviderRef: "p", HasOncePerUse: true, OncePerUseScope: model.OncePerUseScopeProviderTarget, OncePerUseGroup: "g"}
	facts := UseEvent{EventType: model.EventTypeDamageTaken, Source: "source", Target: "target", HasUse: true, UseSource: "source", UseKey: "u", UseSkillKey: "q"}
	origin := &useOriginFixture{}
	token, skip, err := ReserveUse(&ledger, definition, facts, 1, origin, Identity{})
	if err != nil || skip || token == (usage.Reservation{}) || origin.calls != 0 {
		t.Fatal(token, skip, err, origin)
	}
	FinishUse(&ledger, token, true, true)
	rows := ledger.Snapshot()
	if len(rows) != 1 || rows[0].Target == nil || *rows[0].Target != "source" {
		t.Fatal("incoming listener quota targeted its owner", rows)
	}
	// Failure after a prior commit must not free the already used identity.
	FinishUse(&ledger, token, true, false)
	if ledger.Len() != 1 || ledger.Pending() != 0 {
		t.Fatal("committed prefix released", ledger.Snapshot())
	}
	facts.EventType = "event/custom"
	facts.UseKey = "u2"
	if _, _, err = ReserveUse(&ledger, definition, facts, 1, origin, Identity{}); err == nil || origin.calls != 1 || ledger.Len() != 1 {
		t.Fatal(err, origin, ledger.Len())
	}
	facts.HasUse = false
	if _, _, err = ReserveUse(&ledger, definition, facts, 1, origin, Identity{}); err == nil || origin.calls != 1 || err.Code != model.GenericErrMissingRequiredField {
		t.Fatal("origin checked before required use", err, origin)
	}
}
