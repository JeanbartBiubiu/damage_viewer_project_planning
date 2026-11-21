package usage

import (
	"math"
	"reflect"
	"strconv"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func testAmountKey() AmountKey {
	return AmountKey{Key: testKey(), SubjectRef: "source.provider[spell].ability[start]"}
}

func mustReserveAmount(t *testing.T, ledger *Ledger, key AmountKey, requested float64) AmountReservation {
	t.Helper()
	reservation, err := ledger.ReserveAmount(key, "author:e", .39, requested)
	if err != nil {
		t.Fatalf("reserve amount: %+v", err)
	}
	return reservation
}

func requireAmount(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-12 {
		t.Fatalf("amount: got %.17g, want %.17g", got, want)
	}
}

func TestAmountReservationPartiallyAuthorizesAgainstCommittedAndPending(t *testing.T) {
	ledger := New(testIdentity())
	first := mustReserveAmount(t, &ledger, testAmountKey(), .26)
	second := mustReserveAmount(t, &ledger, testAmountKey(), .26)
	requireAmount(t, first.Previous(), 0)
	requireAmount(t, first.Granted(), .26)
	requireAmount(t, first.Current(), .26)
	requireAmount(t, second.Previous(), .26)
	requireAmount(t, second.Granted(), .13)
	requireAmount(t, second.Current(), .39)
	if ledger.Len() != 1 || ledger.Pending() != 2 || len(ledger.SnapshotAmounts()) != 0 || len(ledger.Snapshot()) != 0 {
		t.Fatal("pending quantities were published or counted as separate identities", ledger.Len(), ledger.Pending(), ledger.SnapshotAmounts())
	}
	ledger.CommitAmount(first)
	requireAmount(t, ledger.SnapshotAmounts()[0].UsedValue, .26)
	blocked := mustReserveAmount(t, &ledger, testAmountKey(), .39)
	requireAmount(t, blocked.Granted(), 0)
	requireAmount(t, blocked.Previous(), .39)
	ledger.CommitAmount(second)
	if ledger.Pending() != 0 || ledger.Len() != 1 || len(ledger.SnapshotAmounts()) != 1 {
		t.Fatal("committed quantity accounting changed", ledger.Pending(), ledger.Len(), ledger.SnapshotAmounts())
	}
	requireAmount(t, ledger.SnapshotAmounts()[0].UsedValue, .39)
	if ledger.SnapshotAmounts()[0].UsedValue > .39 {
		t.Fatal("committed amount exceeded the declared maximum")
	}
}

func TestAmountReservationPreservesUnspentQuantityAndZeroDoesNotAllocate(t *testing.T) {
	for _, requests := range [][]float64{{.13, .26}, {.39, .39}} {
		ledger := New(testIdentity())
		for _, amount := range requests {
			ledger.CommitAmount(mustReserveAmount(t, &ledger, testAmountKey(), amount))
		}
		requireAmount(t, ledger.SnapshotAmounts()[0].UsedValue, .39)
		if ledger.Len() != 1 || ledger.Pending() != 0 {
			t.Fatal("exhausted amount created another reservation", ledger.Len(), ledger.Pending())
		}
	}
	ledger := New(testIdentity())
	zero := mustReserveAmount(t, &ledger, testAmountKey(), 0)
	ledger.CommitAmount(zero)
	ledger.ReleaseAmount(zero)
	if zero.Previous() != 0 || zero.Granted() != 0 || zero.Current() != 0 || ledger.Len() != 0 || ledger.Pending() != 0 {
		t.Fatal("zero request allocated or consumed quantity", zero, ledger.Len(), ledger.Pending())
	}
	if rows := ledger.SnapshotAmounts(); rows == nil || len(rows) != 0 {
		t.Fatal("empty quantity snapshot must be an independent empty collection", rows)
	}
}

func TestAmountReleaseWithdrawsOnlyItsPendingQuantity(t *testing.T) {
	ledger := New(testIdentity())
	first := mustReserveAmount(t, &ledger, testAmountKey(), .26)
	second := mustReserveAmount(t, &ledger, testAmountKey(), .26)
	ledger.ReleaseAmount(first)
	ledger.CommitAmount(first)
	ledger.ReleaseAmount(first)
	if ledger.Len() != 1 || ledger.Pending() != 1 || len(ledger.SnapshotAmounts()) != 0 {
		t.Fatal("release removed another pending token", ledger.Len(), ledger.Pending(), ledger.SnapshotAmounts())
	}
	// 凭据保留授予时的视图；调用方负责同帧失败时释放该帧其余预留。
	requireAmount(t, second.Previous(), .26)
	requireAmount(t, second.Current(), .39)
	ledger.CommitAmount(second)
	requireAmount(t, ledger.SnapshotAmounts()[0].UsedValue, .13)
	retry := mustReserveAmount(t, &ledger, testAmountKey(), .26)
	requireAmount(t, retry.Previous(), .13)
	requireAmount(t, retry.Granted(), .26)
	ledger.CommitAmount(retry)
	ledger.CommitAmount(retry)
	ledger.ReleaseAmount(retry)
	requireAmount(t, ledger.SnapshotAmounts()[0].UsedValue, .39)
	if ledger.Len() != 1 || ledger.Pending() != 0 {
		t.Fatal("stale tokens changed committed quantities", ledger.Len(), ledger.Pending())
	}
	fresh := testAmountKey()
	fresh.UseKey = "fresh"
	pending := mustReserveAmount(t, &ledger, fresh, .13)
	ledger.ReleaseAmount(pending)
	if ledger.Len() != 1 || ledger.Pending() != 0 {
		t.Fatal("fully released amount did not reclaim its record", ledger.Len(), ledger.Pending())
	}
}

func TestAmountReservationBelongsToOneLedger(t *testing.T) {
	first, other := New(testIdentity()), New(testIdentity())
	reservation := mustReserveAmount(t, &first, testAmountKey(), .13)
	other.CommitAmount(reservation)
	other.ReleaseAmount(reservation)
	first.CommitAmount(AmountReservation{})
	first.ReleaseAmount(AmountReservation{})
	if first.Pending() != 1 || first.Len() != 1 || other.Pending() != 0 || other.Len() != 0 {
		t.Fatal("foreign or missing token changed either ledger")
	}
	first.ReleaseAmount(reservation)
	retry := mustReserveAmount(t, &first, testAmountKey(), .39)
	first.CommitAmount(reservation)
	first.ReleaseAmount(reservation)
	if first.Pending() != 1 || retry.Granted() != .39 || len(first.SnapshotAmounts()) != 0 {
		t.Fatal("released token changed the next record with the same identity")
	}
	first.CommitAmount(retry)
	requireAmount(t, first.SnapshotAmounts()[0].UsedValue, .39)
}

func TestAmountReservationUsesEveryIdentityField(t *testing.T) {
	ledger := New(testIdentity())
	key := testAmountKey()
	changes := []func(*AmountKey){
		func(k *AmountKey) { k.Owner = "target" },
		func(k *AmountKey) { k.ProviderRef = "other_mount" },
		func(k *AmountKey) { k.GroupKey = "other_group" },
		func(k *AmountKey) { k.Scope = model.OncePerUseScopeProvider; k.Target = "" },
		func(k *AmountKey) { k.UseSource = "target" },
		func(k *AmountKey) { k.UseKey = "other_use" },
		func(k *AmountKey) { k.Target = "source" },
		func(k *AmountKey) { k.SubjectRef = "source.provider[other_spell].ability[start]" },
	}
	ledger.CommitAmount(mustReserveAmount(t, &ledger, key, .39))
	for _, change := range changes {
		changed := key
		change(&changed)
		ledger.CommitAmount(mustReserveAmount(t, &ledger, changed, .39))
	}
	if ledger.Len() != 1+len(changes) || len(ledger.SnapshotAmounts()) != 1+len(changes) {
		t.Fatal("different complete quantity identities shared a budget", ledger.Len(), ledger.SnapshotAmounts())
	}
}

func TestAmountRequestsRejectInvalidNumbersAndIdentityDriftWithoutMutation(t *testing.T) {
	ledger := New(testIdentity())
	ledger.CommitAmount(mustReserveAmount(t, &ledger, testAmountKey(), .13))
	want := ledger.SnapshotAmounts()
	for _, numbers := range [][2]float64{{0, .13}, {-1, .13}, {math.NaN(), .13}, {math.Inf(1), .13}, {.39, -1}, {.39, math.NaN()}, {.39, math.Inf(1)}} {
		if _, err := ledger.ReserveAmount(testAmountKey(), "author:e", numbers[0], numbers[1]); err == nil {
			t.Fatal("invalid amount request succeeded", numbers)
		} else {
			checkErrorIdentity(t, err)
		}
	}
	for _, change := range []struct {
		maximum float64
		skill   string
	}{{.4, "author:e"}, {.39, "author:q"}} {
		if _, err := ledger.ReserveAmount(testAmountKey(), change.skill, change.maximum, .13); err == nil {
			t.Fatal("same quantity identity changed its maximum or originating skill", change)
		}
	}
	invalidKey := testAmountKey()
	invalidKey.SubjectRef = " "
	if _, err := ledger.ReserveAmount(invalidKey, "author:e", .39, 0); err == nil {
		t.Fatal("zero request hid a missing subject identity")
	}
	if ledger.Len() != 1 || ledger.Pending() != 0 || !reflect.DeepEqual(ledger.SnapshotAmounts(), want) {
		t.Fatal("invalid request changed a committed prefix", ledger.Len(), ledger.Pending(), ledger.SnapshotAmounts())
	}
}

func TestAmountAndOnceReservationsShareDedicatedCapacity(t *testing.T) {
	ledger := New(testIdentity())
	var first Reservation
	for index := 0; index < MaxEntries/2; index++ {
		key := testKey()
		key.UseKey = "once_" + strconv.Itoa(index)
		reservation := mustReserve(t, &ledger, key)
		if index == 0 {
			first = reservation
		} else {
			ledger.Commit(reservation)
		}
		amount := testAmountKey()
		amount.UseKey = "amount_" + strconv.Itoa(index)
		ledger.CommitAmount(mustReserveAmount(t, &ledger, amount, .39))
	}
	if ledger.Len() != MaxEntries || ledger.Pending() != 1 {
		t.Fatal("quota kinds did not share record accounting", ledger.Len(), ledger.Pending())
	}
	if _, skip, err := ledger.Reserve(testKey(), "author:q"); skip || err == nil || err.BudgetCause != model.BudgetCauseMaxUseTriggerLedger {
		t.Fatal("amount records did not constrain the original once budget", skip, err)
	}
	if _, err := ledger.ReserveAmount(testAmountKey(), "author:e", .39, .13); err == nil || err.BudgetCause != model.BudgetCauseMaxUseTriggerLedger {
		t.Fatal("once records did not constrain the amount budget", err)
	}
	if zero, err := ledger.ReserveAmount(testAmountKey(), "author:e", .39, 0); err != nil || zero.Granted() != 0 {
		t.Fatal("zero request incorrectly needed a record slot", zero, err)
	}
	existing := testAmountKey()
	existing.UseKey = "amount_0"
	if exhausted, err := ledger.ReserveAmount(existing, "author:e", .39, .13); err != nil || exhausted.Granted() != 0 {
		t.Fatal("existing exhausted quantity was treated as a new record", exhausted, err)
	}
	ledger.Release(first)
	newAmount := mustReserveAmount(t, &ledger, testAmountKey(), .13)
	if newAmount.Granted() != .13 || ledger.Len() != MaxEntries || ledger.Pending() != 1 {
		t.Fatal("released once slot was unavailable to quantity reservation", newAmount, ledger.Len(), ledger.Pending())
	}
}

func TestRestoreOnceRowsCannotExceedCapacityHeldByAmounts(t *testing.T) {
	ledger := New(testIdentity())
	var first AmountReservation
	for index := 0; index < MaxEntries; index++ {
		key := testAmountKey()
		key.UseKey = strconv.Itoa(index)
		reservation := mustReserveAmount(t, &ledger, key, .39)
		if index == 0 {
			first = reservation
		} else {
			ledger.CommitAmount(reservation)
		}
	}
	row, facts := restoreFixture()
	err := ledger.Restore([]model.UseTriggerLedgerEntry{row}, facts)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxUseTriggerLedger || ledger.Len() != MaxEntries || len(ledger.Snapshot()) != 0 {
		t.Fatal("restored once quota exceeded the common record budget", err, ledger.Len(), ledger.Snapshot())
	}
	ledger.ReleaseAmount(first)
	if err := ledger.Restore([]model.UseTriggerLedgerEntry{row}, facts); err != nil {
		t.Fatal("released amount slot was unavailable to restored once quota", err)
	}
	if ledger.Len() != MaxEntries || ledger.Pending() != 0 || len(ledger.Snapshot()) != 1 {
		t.Fatal("restore changed shared capacity accounting", ledger.Len(), ledger.Pending(), ledger.Snapshot())
	}
}

func TestAmountSnapshotOwnsSortedValuesAndKeepsOnceOutputUnchanged(t *testing.T) {
	ledger := New(testIdentity())
	second, first := testAmountKey(), testAmountKey()
	second.SubjectRef = "source.provider[z].ability[start]"
	first.SubjectRef = "source.provider[a].ability[start]"
	ledger.CommitAmount(mustReserveAmount(t, &ledger, second, .26))
	ledger.CommitAmount(mustReserveAmount(t, &ledger, first, .13))
	pending := testAmountKey()
	pending.UseKey = "pending"
	mustReserveAmount(t, &ledger, pending, .39)
	rows := ledger.SnapshotAmounts()
	once := ledger.Snapshot()
	if len(rows) != 2 || cap(rows) != 3 || rows[0].Key != first || rows[1].Key != second || len(once) != 0 || cap(once) != 0 {
		t.Fatal("snapshot lost stable subject ordering, exposed pending quantity or changed once rows", rows, ledger.Snapshot())
	}
	rows[0].Key.SubjectRef = "changed"
	rows[0].UsedValue = 100
	if next := ledger.SnapshotAmounts(); next[0].Key != first || next[0].UsedValue != .13 {
		t.Fatal("snapshot mutation changed private budget state", next)
	}
}

func TestAmountHashCollisionKeepsFullIdentityAndReleasedCapacity(t *testing.T) {
	ledger := New(testIdentity())
	first, second := testAmountKey(), testAmountKey()
	first.Owner, first.ProviderRef = "a\x00b", "c"
	second.Owner, second.ProviderRef = "a", "b\x00c"
	if amountKeyHash(first) != amountKeyHash(second) {
		t.Fatal("fixture does not exercise a shared hash bucket")
	}
	original := mustReserveAmount(t, &ledger, first, .26)
	other := mustReserveAmount(t, &ledger, second, .39)
	ledger.CommitAmount(other)
	ledger.ReleaseAmount(original)
	rows := ledger.SnapshotAmounts()
	if ledger.Len() != 1 || ledger.Pending() != 0 || len(rows) != 1 || rows[0].Key != second {
		t.Fatal("colliding identities shared quantity or a failed release removed its neighbor", ledger.Len(), ledger.Pending(), rows)
	}
	retry := mustReserveAmount(t, &ledger, first, .39)
	ledger.CommitAmount(retry)
	if ledger.Len() != 2 || len(ledger.SnapshotAmounts()) != 2 {
		t.Fatal("released colliding identity could not receive a new independent allowance", ledger.SnapshotAmounts())
	}
}

func TestAmountAndOnceKeepDistinctConsumptionForTheSameBaseKey(t *testing.T) {
	ledger := New(testIdentity())
	key := testAmountKey()
	ledger.Commit(mustReserve(t, &ledger, key.Key))
	ledger.CommitAmount(mustReserveAmount(t, &ledger, key, .39))
	if ledger.Len() != 2 || len(ledger.Snapshot()) != 1 || len(ledger.SnapshotAmounts()) != 1 {
		t.Fatal("numeric allowance changed the existing one-shot consumption", ledger.Len(), ledger.Snapshot(), ledger.SnapshotAmounts())
	}
	if _, skip, err := ledger.Reserve(key.Key, "author:q"); err != nil || !skip {
		t.Fatal("numeric allowance made a committed one-shot quota reusable", skip, err)
	}
	requireAmount(t, ledger.SnapshotAmounts()[0].UsedValue, .39)
}
