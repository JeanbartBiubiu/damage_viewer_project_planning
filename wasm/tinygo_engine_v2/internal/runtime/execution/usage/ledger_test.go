package usage

import (
	"reflect"
	"strconv"
	"testing"
	"tinygo_engine_v2/internal/model"
)

func testIdentity() Identity {
	return Identity{SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}
}

func testKey() Key {
	return Key{Owner: "source", ProviderRef: "item", GroupKey: "once", Scope: model.OncePerUseScopeProviderTarget, UseSource: "source", UseKey: "use", Target: "target"}
}

func mustReserve(t *testing.T, ledger *Ledger, key Key) Reservation {
	t.Helper()
	reservation, skip, err := ledger.Reserve(key, "author:q")
	if err != nil || skip || reservation.record == nil {
		t.Fatalf("reserve: skip=%v error=%+v", skip, err)
	}
	return reservation
}

func TestReservationStagesSharedQuotaAndKeepsCommittedPrefix(t *testing.T) {
	ledger := New(testIdentity())
	key := testKey()
	first := mustReserve(t, &ledger, key)
	if ledger.Len() != 1 || ledger.Pending() != 1 || len(ledger.Snapshot()) != 0 {
		t.Fatal("reservation published before its frame committed", ledger.Len(), ledger.Pending(), ledger.Snapshot())
	}
	if _, skip, err := ledger.Reserve(key, "another_skill"); err != nil || !skip {
		t.Fatal("nested shared group reacquired the same complete use identity", skip, err)
	}
	secondKey := key
	secondKey.GroupKey = "committed"
	second := mustReserve(t, &ledger, secondKey)
	ledger.Commit(second)
	ledger.Release(first)
	if ledger.Len() != 1 || ledger.Pending() != 0 || len(ledger.Snapshot()) != 1 || ledger.Snapshot()[0].GroupKey != "committed" {
		t.Fatal("failed later work lost the earlier committed group", ledger.Snapshot(), ledger.Pending())
	}
	retry := mustReserve(t, &ledger, key)
	ledger.Release(first)
	ledger.Commit(first)
	ledger.Release(Reservation{})
	ledger.Commit(Reservation{})
	if ledger.Len() != 2 || ledger.Pending() != 1 || len(ledger.Snapshot()) != 1 {
		t.Fatal("old or missing reservation changed its retry", ledger.Len(), ledger.Pending(), ledger.Snapshot())
	}
	ledger.Commit(retry)
	ledger.Commit(retry)
	ledger.Release(retry)
	ledger.Release(second)
	if ledger.Len() != 2 || ledger.Pending() != 0 || len(ledger.Snapshot()) != 2 {
		t.Fatal("a derived failure released committed quota", ledger.Len(), ledger.Pending(), ledger.Snapshot())
	}
	if _, skip, err := ledger.Reserve(key, "author:q"); err != nil || !skip {
		t.Fatal("committed quota was acquired again", skip, err)
	}
}

func TestReservationBelongsToOneRun(t *testing.T) {
	first, second := New(testIdentity()), New(testIdentity())
	reservation := mustReserve(t, &first, testKey())
	second.Commit(reservation)
	second.Release(reservation)
	if first.Len() != 1 || first.Pending() != 1 || second.Len() != 0 || second.Pending() != 0 {
		t.Fatal("another run changed a borrowed reservation", first.Len(), first.Pending(), second.Len(), second.Pending())
	}
	first.Release(reservation)
	if first.Len() != 0 || first.Pending() != 0 {
		t.Fatal("original run could not release its reservation", first.Len(), first.Pending())
	}
}

func TestReservationUsesEveryIdentityField(t *testing.T) {
	ledger := New(testIdentity())
	key := testKey()
	mustReserve(t, &ledger, key)
	changes := []func(*Key){
		func(k *Key) { k.Owner = "other_owner" },
		func(k *Key) { k.ProviderRef = "other_mount" },
		func(k *Key) { k.GroupKey = "other_group" },
		func(k *Key) { k.Scope = model.OncePerUseScopeProvider; k.Target = "" },
		func(k *Key) { k.UseSource = "other_source" },
		func(k *Key) { k.UseKey = "other_use" },
		func(k *Key) { k.Target = "other_target" },
	}
	for _, change := range changes {
		changed := key
		change(&changed)
		mustReserve(t, &ledger, changed)
	}
	if ledger.Len() != 8 || ledger.Pending() != 8 {
		t.Fatal("different complete identities shared quota", ledger.Len(), ledger.Pending())
	}
}

func TestDelimitedIdentityPartsDoNotAlias(t *testing.T) {
	ledger := New(testIdentity())
	first, second := testKey(), testKey()
	first.Owner, first.ProviderRef = "a\x00b", "c"
	second.Owner, second.ProviderRef = "a", "b\x00c"
	original := mustReserve(t, &ledger, first)
	other := mustReserve(t, &ledger, second)
	ledger.Commit(other)
	ledger.Release(original)
	if ledger.Len() != 1 || ledger.Pending() != 0 {
		t.Fatal("releasing one identity changed its colliding neighbor", ledger.Len(), ledger.Pending())
	}
	rows := ledger.Snapshot()
	if len(rows) != 1 || rows[0].Owner != second.Owner || rows[0].ProviderRef != second.ProviderRef {
		t.Fatal("delimited identities shared their committed record", rows)
	}
	if _, skip, err := ledger.Reserve(second, "author:q"); err != nil || !skip {
		t.Fatal("committed collision neighbor disappeared", skip, err)
	}
	retry := mustReserve(t, &ledger, first)
	ledger.Commit(retry)
	if len(ledger.Snapshot()) != 2 {
		t.Fatal("released collision could not be retried", ledger.Snapshot())
	}
}

func TestLedgerBudgetChecksDuplicateBeforeCapacity(t *testing.T) {
	ledger := New(testIdentity())
	var first Reservation
	for index := 0; index < MaxEntries; index++ {
		key := testKey()
		key.UseKey = strconv.Itoa(index)
		reservation := mustReserve(t, &ledger, key)
		if index == 0 {
			first = reservation
		} else {
			ledger.Commit(reservation)
		}
	}
	existing := testKey()
	existing.UseKey = "0"
	if _, skip, err := ledger.Reserve(existing, "author:q"); err != nil || !skip {
		t.Fatal("full budget turned an existing reservation into an error", skip, err)
	}
	_, skip, err := ledger.Reserve(testKey(), "author:q")
	if err == nil || skip || err.BudgetCause != model.BudgetCauseMaxUseTriggerLedger ||
		err.Code != model.GenericErrRuntimeInvariantFailed || err.Message != "useTriggerLedger exceeded dedicated budget" || err.Path != "" || err.Ref != "" {
		t.Fatal("new shared quota lost its exact dedicated budget error", skip, err)
	}
	checkErrorIdentity(t, err)
	if ledger.Len() != MaxEntries || ledger.Pending() != 1 || len(ledger.Snapshot()) != MaxEntries-1 {
		t.Fatal("failed reserve changed existing ledger", ledger.Len(), ledger.Pending())
	}
	ledger.Release(first)
	mustReserve(t, &ledger, testKey())
	if ledger.Len() != MaxEntries || ledger.Pending() != 1 {
		t.Fatal("released slot did not restore shared capacity", ledger.Len(), ledger.Pending())
	}
}

func TestSnapshotIsOwnedAndSortsCompleteSourceIdentity(t *testing.T) {
	ledger := New(testIdentity())
	if snapshot := ledger.Snapshot(); snapshot == nil || len(snapshot) != 0 {
		t.Fatal("empty snapshot changed its non-null representation", snapshot)
	}
	targetUse := testKey()
	targetUse.UseSource = "target"
	ledger.Commit(mustReserve(t, &ledger, targetUse))
	sourceUse := testKey()
	ledger.Commit(mustReserve(t, &ledger, sourceUse))
	providerUse := testKey()
	providerUse.Scope, providerUse.Target = model.OncePerUseScopeProvider, ""
	ledger.Commit(mustReserve(t, &ledger, providerUse))
	pending := testKey()
	pending.UseKey = "pending"
	mustReserve(t, &ledger, pending)
	target := "target"
	want := []model.UseTriggerLedgerEntry{
		{Owner: "source", ProviderRef: "item", GroupKey: "once", Scope: model.OncePerUseScopeProvider, UseSource: "source", UseSkillKey: "author:q", UseKey: "use"},
		{Owner: "source", ProviderRef: "item", GroupKey: "once", Scope: model.OncePerUseScopeProviderTarget, UseSource: "source", UseSkillKey: "author:q", UseKey: "use", Target: &target},
		{Owner: "source", ProviderRef: "item", GroupKey: "once", Scope: model.OncePerUseScopeProviderTarget, UseSource: "target", UseSkillKey: "author:q", UseKey: "use", Target: &target},
	}
	got := ledger.Snapshot()
	if !reflect.DeepEqual(got, want) {
		t.Fatal("snapshot changed complete identity order or exposed pending quota", got, want)
	}
	got[0].UseKey = "changed"
	*got[1].Target = "changed"
	if !reflect.DeepEqual(ledger.Snapshot(), want) {
		t.Fatal("caller mutation changed the private ledger", ledger.Snapshot())
	}
}

func checkErrorIdentity(t *testing.T, err *model.EngineError) {
	t.Helper()
	identity := testIdentity()
	if err == nil || err.Phase != model.GenericPhaseRun || err.SchemaHash != identity.SchemaHash || err.RulesHash != identity.RulesHash || err.SessionID != identity.SessionID {
		t.Fatalf("error lost original run identity: %+v", err)
	}
}
