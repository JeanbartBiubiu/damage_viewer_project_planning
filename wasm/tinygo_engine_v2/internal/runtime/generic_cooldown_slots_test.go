package runtime

import (
	"fmt"
	"reflect"
	"testing"
)

func TestCooldownSlotsThresholdAndCompleteIdentity(t *testing.T) {
	for _, size := range []int{16, 17} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			ledger := newGenericCooldownLedger()
			base := genericCooldownIdentity{owner: "source", providerRef: "shared", abilityRef: "ability", stateKey: "state", scope: "provider_target", target: "target"}
			ids := []genericCooldownIdentity{base, base, base, base, base, base, base}
			ids[1].owner, ids[2].providerRef, ids[3].abilityRef = "target", "other", "other"
			ids[4].stateKey, ids[5].scope, ids[6].target = "other", "provider", "source"
			emptyProvider := base
			emptyProvider.providerRef, emptyProvider.abilityRef = "", "shared"
			ids = append(ids, emptyProvider)
			for len(ids) < size {
				id := base
				id.stateKey = fmt.Sprintf("state-%02d", len(ids))
				ids = append(ids, id)
			}
			keys := make([]genericCooldownWaitKey, size)
			for index, id := range ids {
				ledger.set(id, int64(1000+index), 0)
				keys[index] = genericCooldownWaitKey{kind: fmt.Sprintf("kind-%02d", index), owner: "source", key: "same-key"}
				if index == 1 {
					keys[index] = genericCooldownWaitKey{kind: "kind-00", owner: "target", key: "same-key"}
				}
				if index == 2 {
					keys[index] = genericCooldownWaitKey{kind: "kind-00", owner: "source", key: "other-key"}
				}
				if index == 4 {
					keys[index] = genericCooldownWaitKey{kind: "kind-00", owner: "source", key: ""}
				}
				ledger.registerWait(keys[index], []genericCooldownIdentity{id}, 0, 0)
			}
			for index, id := range ids {
				entry, exists := ledger.entry(id)
				if !exists || ledger.entryIndex(id) != index || entry.readyAt != int64(1000+index) || ledger.waitIndex(keys[index]) != index || ledger.waitValue(keys[index]).readyAt != entry.readyAt {
					t.Fatalf("complete identity aliased at %d: entry=%+v", index, entry)
				}
				ledger.set(id, int64(2000+index), 0)
			}
			missing := base
			missing.stateKey = "missing"
			if _, exists := ledger.entry(missing); exists || ledger.entryIndex(missing) != -1 || ledger.waitIndex(genericCooldownWaitKey{key: "missing"}) != -1 {
				t.Fatal("missing identity became slot zero")
			}
			if len(ledger.entries) != size || len(ledger.waits) != size {
				t.Fatal("updating a slot appended a second identity")
			}
		})
	}
}

func TestCooldownSlotsCloneBranchesAppendToSharedBuckets(t *testing.T) {
	base := newGenericCooldownLedger()
	baseIDs, baseKeys := []genericCooldownIdentity{}, []genericCooldownWaitKey{}
	for index := 0; index < 17; index++ {
		bucket := "A"
		if index >= 10 {
			bucket = "B"
		}
		id := genericCooldownIdentity{owner: "source", providerRef: bucket, stateKey: fmt.Sprintf("base-%02d", index)}
		key := genericCooldownWaitKey{kind: fmt.Sprintf("kind-%02d", index), owner: "source", key: "wait-" + bucket}
		base.set(id, int64(1000+index), 0)
		base.registerWait(key, []genericCooldownIdentity{id}, 0, 0)
		baseIDs, baseKeys = append(baseIDs, id), append(baseKeys, key)
	}
	left, right := base.clone(), base.clone()
	leftID := genericCooldownIdentity{owner: "source", providerRef: "A", stateKey: "left-A"}
	leftKey := genericCooldownWaitKey{kind: "left-A", owner: "source", key: "wait-A"}
	left.set(leftID, 2100, 0)
	left.registerWait(leftKey, []genericCooldownIdentity{leftID}, 0, 0)
	child := left.clone()
	branches := []struct {
		name   string
		ledger *genericCooldownLedger
	}{
		{"base", base}, {"left", left}, {"right", right}, {"child", child},
	}
	type added struct {
		branch string
		id     genericCooldownIdentity
		key    genericCooldownWaitKey
		ready  int64
	}
	additions := []added{}
	for index, branch := range branches[1:] {
		for _, bucket := range []string{"B", "A", "B"} {
			name := fmt.Sprintf("%s-%s-%d", branch.name, bucket, len(additions))
			id := genericCooldownIdentity{owner: "source", providerRef: bucket, stateKey: name}
			key := genericCooldownWaitKey{kind: name, owner: "source", key: "wait-" + bucket}
			ready := int64(3000 + index*100 + len(additions))
			branch.ledger.set(id, ready, 0)
			branch.ledger.registerWait(key, []genericCooldownIdentity{id}, 0, 0)
			additions = append(additions, added{branch.name, id, key, ready})
		}
	}
	for _, branch := range branches {
		for index, id := range baseIDs {
			if branch.ledger.readyAt(id) != int64(1000+index) || branch.ledger.waitValue(baseKeys[index]).readyAt != int64(1000+index) {
				t.Fatalf("%s changed a frozen base bucket", branch.name)
			}
		}
		for _, item := range additions {
			entry, exists := branch.ledger.entry(item.id)
			_, waiting := branch.ledger.wait(item.key)
			want := branch.name == item.branch
			if exists != want || waiting != want || (want && entry.readyAt != item.ready) {
				t.Fatalf("%s lookup followed sibling %s: exists=%v waiting=%v", branch.name, item.branch, exists, waiting)
			}
		}
		_, inherited := branch.ledger.entry(leftID)
		if inherited != (branch.name == "left" || branch.name == "child") {
			t.Fatalf("%s changed the fork point", branch.name)
		}
	}
	left.set(baseIDs[0], 9999, 0)
	left.cancelWait(baseKeys[0])
	if base.readyAt(baseIDs[0]) != 1000 || right.readyAt(baseIDs[0]) != 1000 || child.readyAt(baseIDs[0]) != 1000 {
		t.Fatal("a value write leaked across independent slot slices")
	}
	if _, active := child.wait(baseKeys[0]); !active {
		t.Fatal("cancelling a waiter changed a frozen child")
	}
}

func TestCooldownSlotsChangedFallsBackAcrossInsertionOrders(t *testing.T) {
	const size = 20
	ids, keys := make([]genericCooldownIdentity, size), make([]genericCooldownWaitKey, size)
	for index := range ids {
		ids[index] = genericCooldownIdentity{owner: "source", providerRef: fmt.Sprintf("provider-%02d", index), stateKey: "state"}
		keys[index] = genericCooldownWaitKey{kind: "automatic", owner: "source", key: fmt.Sprintf("key-%02d", index)}
	}
	makeLedger := func(reverse bool) *genericCooldownLedger {
		ledger := newGenericCooldownLedger()
		for position := range ids {
			index := position
			if reverse {
				index = size - 1 - position
			}
			ledger.appendEntry(ids[index], genericCooldownEntry{readyAt: int64(1000 + index), active: true, version: uint64(index + 1)})
			ledger.appendWait(genericCooldownWait{key: keys[index], dependencies: []genericCooldownIdentity{ids[index]}, readyAt: int64(1000 + index), active: true, version: uint64(index + 100)})
		}
		ledger.revision = 200
		return ledger
	}
	before, after := makeLedger(false), makeLedger(true)
	if len(after.changedKeys(before)) != 0 || len(after.changedWaits(before)) != 0 {
		t.Fatal("insertion order changed equal logical ledgers")
	}
	after.set(ids[9], 9000, 0)
	after.registerWait(keys[2], []genericCooldownIdentity{ids[2]}, 8000, 0)
	if got := after.changedKeys(before); !reflect.DeepEqual(got, []genericCooldownIdentity{ids[9]}) {
		t.Fatalf("changed entries=%+v", got)
	}
	if got := after.changedWaits(before); len(got) != 2 || got[0].key != keys[2] || got[1].key != keys[9] {
		t.Fatalf("changed waits lost original key ordering: %+v", got)
	}
	zero := newGenericCooldownLedger()
	zero.appendEntry(ids[0], genericCooldownEntry{})
	if len(zero.changedKeys(nil)) != 1 || len(zero.changedKeys(newGenericCooldownLedger())) != 0 {
		t.Fatal("nil baseline or absent zero-value comparison changed")
	}
}

func TestCooldownSlotsInactiveVersionsAndRemovalOrder(t *testing.T) {
	ledger := newGenericCooldownLedger()
	ids := []genericCooldownIdentity{
		genericAbilityCooldownIdentity("source", "source.provider[mounted].ability[z]"),
		genericAbilityCooldownIdentity("source", "source.provider[mounted].ability[a]"),
		genericAbilityCooldownIdentity("source", "source.provider[mounted].ability[m]"),
	}
	for _, id := range ids {
		ledger.set(id, 1000, 0)
	}
	key := genericCooldownWaitKey{kind: "basic_attack", owner: "source", key: "attack"}
	wait := ledger.registerWait(key, []genericCooldownIdentity{ids[0]}, 0, 0)
	ledger.cancelWait(key)
	inactive := ledger.waitValue(key)
	if inactive.active || inactive.version <= wait.version || ledger.clone().waitValue(key).version != inactive.version {
		t.Fatal("cancelled wait lost its raw observable version")
	}
	if _, active := ledger.wait(key); active || ledger.waitCurrent(key, wait.readyAt, wait.version) {
		t.Fatal("cancelled wait remained current")
	}
	beforeRevision := ledger.revision
	ledger.removeProvider("source", "mounted", 100)
	for offset, id := range []genericCooldownIdentity{ids[1], ids[2], ids[0]} {
		value, exists := ledger.entry(id)
		if !exists || value.readyAt != 0 || value.active || value.version != beforeRevision+uint64(offset+1) {
			t.Fatalf("removal changed lexicographic revision assignment: %+v %+v", id, value)
		}
	}
	if len(ledger.entries) != 3 || len(ledger.waits) != 1 || len(ledger.abilityDeadlines()) != 3 {
		t.Fatal("removal deleted observable history")
	}
	if ledger.waitValue(key).version != inactive.version {
		t.Fatal("removing a provider rewrote an already inactive wait")
	}
	var absent *genericCooldownLedger
	if absent.entryIndex(ids[0]) != -1 || absent.waitIndex(key) != -1 || absent.entryValue(ids[0]) != (genericCooldownEntry{}) || absent.waitValue(key).version != 0 {
		t.Fatal("zero ledger lost safe lookup behavior")
	}
}
