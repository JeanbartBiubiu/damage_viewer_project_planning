package action

import "tinygo_engine_v2/internal/runtime/contract"

import "testing"

func TestCooldownWaitOwnsDependencies(t *testing.T) {
	ledger := NewCooldownLedger()
	id := AbilityCooldownIdentity("source", "source.provider[x].ability[initial]")
	other := AbilityCooldownIdentity("target", "target.provider[x].ability[initial]")
	dependencies := []contract.CooldownIdentity{id}
	key := CooldownWaitKey{Kind: "while_ready", Owner: "source", Key: "waiting-cast"}
	ledger.Set(id, 1000, 0)
	wait := ledger.RegisterWait(key, dependencies, 0, 0)
	dependencies[0] = other
	if len(wait.dependencies) != 1 || wait.dependencies[0] != id {
		t.Fatal("registration did not freeze the actual owner's dependency", wait)
	}
	ledger.Reset(id, 200)
	if ledger.WaitValue(key).ReadyAt != 200 {
		t.Fatal("later caller writes changed the registered dependency")
	}
}

func TestCommonCooldownLedgerMultipleWaitersReplanAndClone(t *testing.T) {
	ledger := NewCooldownLedger()
	id := AbilityCooldownIdentity("source", "source.provider[mounted].ability[start]")
	ledger.Set(id, 1000, 0)
	attackKey := CooldownWaitKey{Kind: "basic_attack", Owner: "source", Key: "attack"}
	autoKey := CooldownWaitKey{Kind: "automatic", Owner: "source", Key: "auto"}
	attack := ledger.RegisterWait(attackKey, []contract.CooldownIdentity{id}, 0, 0)
	auto := ledger.RegisterWait(autoKey, []contract.CooldownIdentity{id}, 0, 0)
	frozen := ledger.Clone()
	ledger.Set(id, 600, 400)
	for _, key := range []CooldownWaitKey{attackKey, autoKey} {
		wait, exists := ledger.Wait(key)
		if !exists || wait.ReadyAt != 600 || ledger.WaitCurrent(key, 1000, frozen.WaitValue(key).Version) {
			t.Fatal("shortened CD did not replan every waiter", key, wait)
		}
	}
	if !frozen.WaitCurrent(attackKey, 1000, attack.Version) || !frozen.WaitCurrent(autoKey, 1000, auto.Version) || frozen.ReadyAt(id) != 1000 {
		t.Fatal("a frozen ledger followed a later write")
	}
	before := ledger.Clone()
	ledger.Set(id, 2000, 400)
	if len(ledger.ChangedKeys(before)) != 1 || len(ledger.ChangedWaits(before)) != 2 || ledger.WaitValue(autoKey).ReadyAt != 2000 {
		t.Fatal("extended CD did not publish the actual common deadline")
	}
	ledger.Reset(id, 500)
	if !ledger.IsReady(id, 500) || ledger.Remaining(id, 500) != 0 || ledger.WaitValue(attackKey).ReadyAt != 500 || ledger.WaitValue(autoKey).ReadyAt != 500 {
		t.Fatal("RESET did not make all waiters ready")
	}
}

func TestCommonCooldownStartSubtractAndExactBoundary(t *testing.T) {
	ledger := NewCooldownLedger()
	id := StateCooldownIdentity("source", "mounted@1", "icd", stateScopeProvider, "")
	changed, valid := ledger.Start(id, 1000, 100)
	version := ledger.Version(id)
	if !changed || !valid || ledger.Remaining(id, 100) != 1000 || ledger.IsReady(id, 1099) || !ledger.IsReady(id, 1100) {
		t.Fatal("incorrect ready boundary")
	}
	changed, valid = ledger.Start(id, 1000, 400)
	if changed || !valid || ledger.ReadyAt(id) != 1100 || ledger.Version(id) != version {
		t.Fatal("START during CD renewed or rewrote it")
	}
	changed, expired, ready := ledger.Subtract(id, 700, 400)
	if !changed || !expired || ready != 0 || !ledger.IsReady(id, 400) {
		t.Fatal("subtracting the remaining time did not reset")
	}
}

func TestCommonCooldownTargetAndProviderRemovalInvalidateOldEvents(t *testing.T) {
	ledger := NewCooldownLedger()
	first := StateCooldownIdentity("source", "same-instance", "icd", stateScopeProviderTarget, "target")
	other := StateCooldownIdentity("source", "same-instance", "icd", stateScopeProviderTarget, "source")
	otherOwner := StateCooldownIdentity("target", "same-instance", "icd", stateScopeProviderTarget, "target")
	for _, id := range []contract.CooldownIdentity{first, other, otherOwner} {
		ledger.Start(id, 1000, 0)
	}
	wait := ledger.RegisterWait(InternalCooldownWaitKey(first), []contract.CooldownIdentity{first}, 0, 0)
	ledger.RemoveTarget("source", "same-instance", "target", 100)
	if !ledger.IsReady(first, 100) || ledger.IsReady(other, 100) || ledger.IsReady(otherOwner, 100) || ledger.WaitCurrent(wait.Key, wait.ReadyAt, wait.Version) {
		t.Fatal("target identity leaked or its old event remained active")
	}
	ledger.Start(first, 1000, 100)
	newWait := ledger.RegisterWait(wait.Key, []contract.CooldownIdentity{first}, 0, 100)
	ledger.RemoveProvider("source", "same-instance", 200)
	ledger.Start(first, 1000, 200)
	if ledger.WaitCurrent(newWait.Key, newWait.ReadyAt, newWait.Version) || ledger.IsReady(otherOwner, 200) {
		t.Fatal("remounted provider reused an old event or changed another owner")
	}
}

func TestCommonCooldownCompositeWaitUsesActualDeadlines(t *testing.T) {
	ledger := NewCooldownLedger()
	one := AbilityCooldownIdentity("source", "one")
	two := AbilityCooldownIdentity("source", "two")
	ledger.Set(one, 500, 0)
	ledger.Set(two, 900, 0)
	key := CooldownWaitKey{Kind: "automatic", Owner: "source", Key: "one"}
	wait := ledger.RegisterWait(key, []contract.CooldownIdentity{one, two}, 0, 0)
	if wait.ReadyAt != 900 {
		t.Fatal(wait)
	}
	ledger.Reset(two, 100)
	if ledger.WaitValue(key).ReadyAt != 500 {
		t.Fatal(ledger.WaitValue(key))
	}
	wait = ledger.RegisterWait(key, []contract.CooldownIdentity{one}, 700, 100)
	ledger.Reset(one, 200)
	if ledger.WaitValue(key).ReadyAt != 700 {
		t.Fatal("action allowance was overwritten by a CD reset", ledger.WaitValue(key))
	}
	ledger.CancelWait(key)
	if ledger.WaitCurrent(key, 700, wait.Version) {
		t.Fatal("cancelled waiter was still current")
	}
}
