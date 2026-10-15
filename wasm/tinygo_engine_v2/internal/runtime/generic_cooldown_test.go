package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCommonCooldownLedgerMultipleWaitersReplanAndClone(t *testing.T) {
	ledger := newGenericCooldownLedger()
	id := genericAbilityCooldownIdentity("source", "source.provider[mounted].ability[start]")
	ledger.set(id, 1000, 0)
	attackKey := genericCooldownWaitKey{kind: "basic_attack", owner: "source", key: "attack"}
	autoKey := genericCooldownWaitKey{kind: "automatic", owner: "source", key: "auto"}
	attack := ledger.registerWait(attackKey, []genericCooldownIdentity{id}, 0, 0)
	auto := ledger.registerWait(autoKey, []genericCooldownIdentity{id}, 0, 0)
	frozen := ledger.clone()
	ledger.set(id, 600, 400)
	for _, key := range []genericCooldownWaitKey{attackKey, autoKey} {
		wait, exists := ledger.wait(key)
		if !exists || wait.readyAt != 600 || ledger.waitCurrent(key, 1000, frozen.waits[key].version) {
			t.Fatal("shortened CD did not replan every waiter", key, wait)
		}
	}
	if !frozen.waitCurrent(attackKey, 1000, attack.version) || !frozen.waitCurrent(autoKey, 1000, auto.version) || frozen.readyAt(id) != 1000 {
		t.Fatal("a frozen ledger followed a later write")
	}
	before := ledger.clone()
	ledger.set(id, 2000, 400)
	if len(ledger.changedKeys(before)) != 1 || len(ledger.changedWaits(before)) != 2 || ledger.waits[autoKey].readyAt != 2000 {
		t.Fatal("extended CD did not publish the actual common deadline")
	}
	ledger.reset(id, 500)
	if !ledger.isReady(id, 500) || ledger.remaining(id, 500) != 0 || ledger.waits[attackKey].readyAt != 500 || ledger.waits[autoKey].readyAt != 500 {
		t.Fatal("RESET did not make all waiters ready")
	}
}

func TestCommonCooldownStartSubtractAndExactBoundary(t *testing.T) {
	ledger := newGenericCooldownLedger()
	id := genericStateCooldownIdentity("source", "mounted@1", "icd", stateScopeProvider, "")
	changed, valid := ledger.start(id, 1000, 100)
	version := ledger.version(id)
	if !changed || !valid || ledger.remaining(id, 100) != 1000 || ledger.isReady(id, 1099) || !ledger.isReady(id, 1100) {
		t.Fatal("incorrect ready boundary")
	}
	changed, valid = ledger.start(id, 1000, 400)
	if changed || !valid || ledger.readyAt(id) != 1100 || ledger.version(id) != version {
		t.Fatal("START during CD renewed or rewrote it")
	}
	changed, expired, ready := ledger.subtract(id, 700, 400)
	if !changed || !expired || ready != 0 || !ledger.isReady(id, 400) {
		t.Fatal("subtracting the remaining time did not reset")
	}
}

func TestCommonCooldownTargetAndProviderRemovalInvalidateOldEvents(t *testing.T) {
	ledger := newGenericCooldownLedger()
	first := genericStateCooldownIdentity("source", "same-instance", "icd", stateScopeProviderTarget, "target")
	other := genericStateCooldownIdentity("source", "same-instance", "icd", stateScopeProviderTarget, "source")
	otherOwner := genericStateCooldownIdentity("target", "same-instance", "icd", stateScopeProviderTarget, "target")
	for _, id := range []genericCooldownIdentity{first, other, otherOwner} {
		ledger.start(id, 1000, 0)
	}
	wait := ledger.registerWait(internalCooldownWaitKey(first), []genericCooldownIdentity{first}, 0, 0)
	ledger.removeTarget("source", "same-instance", "target", 100)
	if !ledger.isReady(first, 100) || ledger.isReady(other, 100) || ledger.isReady(otherOwner, 100) || ledger.waitCurrent(wait.key, wait.readyAt, wait.version) {
		t.Fatal("target identity leaked or its old event remained active")
	}
	ledger.start(first, 1000, 100)
	newWait := ledger.registerWait(wait.key, []genericCooldownIdentity{first}, 0, 100)
	ledger.removeProvider("source", "same-instance", 200)
	ledger.start(first, 1000, 200)
	if ledger.waitCurrent(newWait.key, newWait.readyAt, newWait.version) || ledger.isReady(otherOwner, 200) {
		t.Fatal("remounted provider reused an old event or changed another owner")
	}
}

func TestCommonCooldownCompositeWaitUsesActualDeadlines(t *testing.T) {
	ledger := newGenericCooldownLedger()
	one := genericAbilityCooldownIdentity("source", "one")
	two := genericAbilityCooldownIdentity("source", "two")
	ledger.set(one, 500, 0)
	ledger.set(two, 900, 0)
	key := genericCooldownWaitKey{kind: "automatic", owner: "source", key: "one"}
	wait := ledger.registerWait(key, []genericCooldownIdentity{one, two}, 0, 0)
	if wait.readyAt != 900 {
		t.Fatal(wait)
	}
	ledger.reset(two, 100)
	if ledger.waits[key].readyAt != 500 {
		t.Fatal(ledger.waits[key])
	}
	wait = ledger.registerWait(key, []genericCooldownIdentity{one}, 700, 100)
	ledger.reset(one, 200)
	if ledger.waits[key].readyAt != 700 {
		t.Fatal("action allowance was overwritten by a CD reset", ledger.waits[key])
	}
	ledger.cancelWait(key)
	if ledger.waitCurrent(key, 700, wait.version) {
		t.Fatal("cancelled waiter was still current")
	}
}

func TestCommonCooldownListenerChildUsesActualAbilityOwner(t *testing.T) {
	input, request := loadBasicFixture(t)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/on_hit", Domain: "event"})
	actualRef := "source.provider[champion:source_demo].ability[basic_attack]"
	ability := &input.SharedProviders[0].Abilities[0]
	ability.Cooldown = &model.AbilityCooldown{DurationMs: authoringConst(1000)}
	ability.Operations = []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "counter", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(7))}}
	input.SharedProviders[0].InitialStateSchema = map[string]interface{}{"counter": float64(0)}
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{
		ProviderKey: "utility:child_cast", Kind: "utility", StableID: "child_cast",
		Listeners: []model.ListenerDefinition{{ListenerKey: "cast_source_ability", EventMatcher: model.TypeMatcher{Any: []string{"event/on_hit"}}, AbilityRef: actualRef}},
		Abilities: []model.AbilityDefinition{{AbilityKey: "emit", Kind: "active", Operations: []model.OperationDefinition{{Operation: "emit_event", Target: "target", EventType: "event/on_hit", Ref: "event/on_hit"}}}},
	})
	input.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "utility:child_cast", DefinitionRef: "utility:child_cast"}}
	request.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "utility:child_cast", DefinitionRef: "utility:child_cast", Stacks: 1, State: map[string]interface{}{}}}
	request.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "first", AbilityRef: "target.provider[utility:child_cast].ability[emit]", Source: "target", Target: "target", FirstAtMs: 0},
		{EntryKey: "cd-blocked", AbilityRef: "target.provider[utility:child_cast].ability[emit]", Source: "target", Target: "target", FirstAtMs: 100},
		{EntryKey: "ready-boundary", AbilityRef: "target.provider[utility:child_cast].ability[emit]", Source: "target", Target: "target", FirstAtMs: 1000},
	}
	request.StopPolicy.DurationMs = 1100
	state := internalCooldownRunState(t, input, request)
	owner, executor := state.combatants["source"], state.combatants["target"]
	if actual := owner.providerState["champion:source_demo"].state["counter"]; actual != 14 {
		t.Fatal("child ability bypassed CD or was rejected at exact readiness", actual)
	}
	if owner.cooldowns.abilityReadyAt("source", actualRef) != 2000 || len(executor.cooldowns.entries) != 0 {
		t.Fatal("CD belonged to the execution source instead of the actual ability owner", owner.cooldowns.entries, executor.cooldowns.entries)
	}
}
