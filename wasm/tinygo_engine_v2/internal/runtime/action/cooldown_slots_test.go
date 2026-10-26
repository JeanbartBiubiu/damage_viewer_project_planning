package action

import "tinygo_engine_v2/internal/runtime/contract"

import (
	"fmt"
	"reflect"
	"testing"
)

func TestCooldownSlotsThresholdAndCompleteIdentity(t *testing.T) {
	for _, size := range []int{16, 17} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			ledger := NewCooldownLedger()
			base := contract.CooldownIdentity{Owner: "source", ProviderRef: "shared", AbilityRef: "ability", StateKey: "state", Scope: "provider_target", Target: "target"}
			ids := []contract.CooldownIdentity{base, base, base, base, base, base, base}
			ids[1].Owner, ids[2].ProviderRef, ids[3].AbilityRef = "target", "other", "other"
			ids[4].StateKey, ids[5].Scope, ids[6].Target = "other", "provider", "source"
			emptyProvider := base
			emptyProvider.ProviderRef, emptyProvider.AbilityRef = "", "shared"
			ids = append(ids, emptyProvider)
			for len(ids) < size {
				id := base
				id.StateKey = fmt.Sprintf("state-%02d", len(ids))
				ids = append(ids, id)
			}
			keys := make([]CooldownWaitKey, size)
			for index, id := range ids {
				ledger.Set(id, int64(1000+index), 0)
				keys[index] = CooldownWaitKey{Kind: fmt.Sprintf("kind-%02d", index), Owner: "source", Key: "same-key"}
				if index == 1 {
					keys[index] = CooldownWaitKey{Kind: "kind-00", Owner: "target", Key: "same-key"}
				}
				if index == 2 {
					keys[index] = CooldownWaitKey{Kind: "kind-00", Owner: "source", Key: "other-key"}
				}
				if index == 4 {
					keys[index] = CooldownWaitKey{Kind: "kind-00", Owner: "source", Key: ""}
				}
				ledger.RegisterWait(keys[index], []contract.CooldownIdentity{id}, 0, 0)
			}
			for index, id := range ids {
				entry, exists := ledger.Entry(id)
				if !exists || ledger.entryIndex(id) != index || entry.ReadyAt != int64(1000+index) || ledger.waitIndex(keys[index]) != index || ledger.WaitValue(keys[index]).ReadyAt != entry.ReadyAt {
					t.Fatalf("complete identity aliased at %d: entry=%+v", index, entry)
				}
				ledger.Set(id, int64(2000+index), 0)
			}
			missing := base
			missing.StateKey = "missing"
			if _, exists := ledger.Entry(missing); exists || ledger.entryIndex(missing) != -1 || ledger.waitIndex(CooldownWaitKey{Key: "missing"}) != -1 {
				t.Fatal("missing identity became slot zero")
			}
			if len(ledger.entries) != size || len(ledger.waits) != size {
				t.Fatal("updating a slot appended a second identity")
			}
		})
	}
}

func TestCooldownSlotsCloneBranchesAppendToSharedBuckets(t *testing.T) {
	base := NewCooldownLedger()
	baseIDs, baseKeys := []contract.CooldownIdentity{}, []CooldownWaitKey{}
	for index := 0; index < 17; index++ {
		bucket := "A"
		if index >= 10 {
			bucket = "B"
		}
		id := contract.CooldownIdentity{Owner: "source", ProviderRef: bucket, StateKey: fmt.Sprintf("base-%02d", index)}
		key := CooldownWaitKey{Kind: fmt.Sprintf("kind-%02d", index), Owner: "source", Key: "wait-" + bucket}
		base.Set(id, int64(1000+index), 0)
		base.RegisterWait(key, []contract.CooldownIdentity{id}, 0, 0)
		baseIDs, baseKeys = append(baseIDs, id), append(baseKeys, key)
	}
	left, right := base.Clone(), base.Clone()
	leftID := contract.CooldownIdentity{Owner: "source", ProviderRef: "A", StateKey: "left-A"}
	leftKey := CooldownWaitKey{Kind: "left-A", Owner: "source", Key: "wait-A"}
	left.Set(leftID, 2100, 0)
	left.RegisterWait(leftKey, []contract.CooldownIdentity{leftID}, 0, 0)
	child := left.Clone()
	branches := []struct {
		name   string
		ledger *CooldownLedger
	}{
		{"base", base}, {"left", left}, {"right", right}, {"child", child},
	}
	type added struct {
		branch string
		id     contract.CooldownIdentity
		key    CooldownWaitKey
		ready  int64
	}
	additions := []added{}
	for index, branch := range branches[1:] {
		for _, bucket := range []string{"B", "A", "B"} {
			name := fmt.Sprintf("%s-%s-%d", branch.name, bucket, len(additions))
			id := contract.CooldownIdentity{Owner: "source", ProviderRef: bucket, StateKey: name}
			key := CooldownWaitKey{Kind: name, Owner: "source", Key: "wait-" + bucket}
			ready := int64(3000 + index*100 + len(additions))
			branch.ledger.Set(id, ready, 0)
			branch.ledger.RegisterWait(key, []contract.CooldownIdentity{id}, 0, 0)
			additions = append(additions, added{branch.name, id, key, ready})
		}
	}
	for _, branch := range branches {
		for index, id := range baseIDs {
			if branch.ledger.ReadyAt(id) != int64(1000+index) || branch.ledger.WaitValue(baseKeys[index]).ReadyAt != int64(1000+index) {
				t.Fatalf("%s changed a frozen base bucket", branch.name)
			}
		}
		for _, item := range additions {
			entry, exists := branch.ledger.Entry(item.id)
			_, waiting := branch.ledger.Wait(item.key)
			want := branch.name == item.branch
			if exists != want || waiting != want || (want && entry.ReadyAt != item.ready) {
				t.Fatalf("%s lookup followed sibling %s: exists=%v waiting=%v", branch.name, item.branch, exists, waiting)
			}
		}
		_, inherited := branch.ledger.Entry(leftID)
		if inherited != (branch.name == "left" || branch.name == "child") {
			t.Fatalf("%s changed the fork point", branch.name)
		}
	}
	left.Set(baseIDs[0], 9999, 0)
	left.CancelWait(baseKeys[0])
	if base.ReadyAt(baseIDs[0]) != 1000 || right.ReadyAt(baseIDs[0]) != 1000 || child.ReadyAt(baseIDs[0]) != 1000 {
		t.Fatal("a value write leaked across independent slot slices")
	}
	if _, active := child.Wait(baseKeys[0]); !active {
		t.Fatal("cancelling a waiter changed a frozen child")
	}
}

func TestCooldownSlotsChangedFallsBackAcrossInsertionOrders(t *testing.T) {
	const size = 20
	ids, keys := make([]contract.CooldownIdentity, size), make([]CooldownWaitKey, size)
	for index := range ids {
		ids[index] = contract.CooldownIdentity{Owner: "source", ProviderRef: fmt.Sprintf("provider-%02d", index), StateKey: "state"}
		keys[index] = CooldownWaitKey{Kind: "automatic", Owner: "source", Key: fmt.Sprintf("key-%02d", index)}
	}
	makeLedger := func(reverse bool) *CooldownLedger {
		ledger := NewCooldownLedger()
		for position := range ids {
			index := position
			if reverse {
				index = size - 1 - position
			}
			ledger.appendEntry(ids[index], contract.CooldownEntry{ReadyAt: int64(1000 + index), Active: true, Version: uint64(index + 1)})
			ledger.appendWait(CooldownWait{Key: keys[index], dependencies: []contract.CooldownIdentity{ids[index]}, ReadyAt: int64(1000 + index), Active: true, Version: uint64(index + 100)})
		}
		ledger.revision = 200
		return ledger
	}
	before, after := makeLedger(false), makeLedger(true)
	if len(after.ChangedKeys(before)) != 0 || len(after.ChangedWaits(before)) != 0 {
		t.Fatal("insertion order changed equal logical ledgers")
	}
	after.Set(ids[9], 9000, 0)
	after.RegisterWait(keys[2], []contract.CooldownIdentity{ids[2]}, 8000, 0)
	if got := after.ChangedKeys(before); !reflect.DeepEqual(got, []contract.CooldownIdentity{ids[9]}) {
		t.Fatalf("changed entries=%+v", got)
	}
	if got := after.ChangedWaits(before); len(got) != 2 || got[0].Key != keys[2] || got[1].Key != keys[9] {
		t.Fatalf("changed waits lost original key ordering: %+v", got)
	}
	zero := NewCooldownLedger()
	zero.appendEntry(ids[0], contract.CooldownEntry{})
	if len(zero.ChangedKeys(nil)) != 1 || len(zero.ChangedKeys(NewCooldownLedger())) != 0 {
		t.Fatal("nil baseline or absent zero-value comparison changed")
	}
}

func TestCooldownSlotsInactiveVersionsAndRemovalOrder(t *testing.T) {
	ledger := NewCooldownLedger()
	ids := []contract.CooldownIdentity{
		AbilityCooldownIdentity("source", "source.provider[mounted].ability[z]"),
		AbilityCooldownIdentity("source", "source.provider[mounted].ability[a]"),
		AbilityCooldownIdentity("source", "source.provider[mounted].ability[m]"),
	}
	for _, id := range ids {
		ledger.Set(id, 1000, 0)
	}
	key := CooldownWaitKey{Kind: "basic_attack", Owner: "source", Key: "attack"}
	wait := ledger.RegisterWait(key, []contract.CooldownIdentity{ids[0]}, 0, 0)
	ledger.CancelWait(key)
	inactive := ledger.WaitValue(key)
	if inactive.Active || inactive.Version <= wait.Version || ledger.Clone().WaitValue(key).Version != inactive.Version {
		t.Fatal("cancelled wait lost its raw observable version")
	}
	if _, active := ledger.Wait(key); active || ledger.WaitCurrent(key, wait.ReadyAt, wait.Version) {
		t.Fatal("cancelled wait remained current")
	}
	beforeRevision := ledger.revision
	ledger.RemoveProvider("source", "mounted", 100)
	for offset, id := range []contract.CooldownIdentity{ids[1], ids[2], ids[0]} {
		value, exists := ledger.Entry(id)
		if !exists || value.ReadyAt != 0 || value.Active || value.Version != beforeRevision+uint64(offset+1) {
			t.Fatalf("removal changed lexicographic revision assignment: %+v %+v", id, value)
		}
	}
	if len(ledger.entries) != 3 || len(ledger.waits) != 1 || len(ledger.AbilityDeadlines()) != 3 {
		t.Fatal("removal deleted observable history")
	}
	if ledger.WaitValue(key).Version != inactive.Version {
		t.Fatal("removing a provider rewrote an already inactive wait")
	}
	var absent *CooldownLedger
	if absent.entryIndex(ids[0]) != -1 || absent.waitIndex(key) != -1 || absent.EntryValue(ids[0]) != (contract.CooldownEntry{}) || absent.WaitValue(key).Version != 0 {
		t.Fatal("zero ledger lost safe lookup behavior")
	}
}
