package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func internalCooldownInput(t *testing.T, scope string, subtract float64, arm bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, request := sdcLoad(t, scope, subtract, arm)
	provider := &input.SharedProviders[len(input.SharedProviders)-1]
	key := sdcTimedKey
	if scope == stateScopeProviderTarget {
		key = sdcTargetKey
	}
	field := provider.InitialStateSchema[key].(map[string]interface{})
	field["stateKind"] = model.ProviderStateKindCooldown
	field["refreshPolicy"] = model.ProviderStateRefreshStartOnFirstWrite
	return input, request
}

func internalCooldownRunState(t *testing.T, input model.CompileRequest, request model.RunRequest) *genericRunState {
	t.Helper()
	compiled := compileMigrated(&input, &request)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	state, err := newGenericRunState(compiled.Session, request)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestGenericInternalCooldownHasOnlyLedgerDeadlineWithoutBackgroundAttack(t *testing.T) {
	for _, scope := range []string{stateScopeProvider, stateScopeProviderTarget} {
		t.Run(scope, func(t *testing.T) {
			input, request := internalCooldownInput(t, scope, 0, true)
			request.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "first", AbilityRef: sdcAARef(), Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "repeat-start", AbilityRef: sdcAARef(), Source: "source", Target: "target", FirstAtMs: 100},
			}
			request.StopPolicy.DurationMs = 6100
			state := internalCooldownRunState(t, input, request)
			key, target := sdcTimedKey, ""
			if scope == stateScopeProviderTarget {
				key, target = sdcTargetKey, "target"
			}
			owner := state.combatants["source"]
			id := genericStateCooldownIdentity("source", sdcProviderRef, key, scope, target)
			if owner.cooldowns.readyAt(id) != 6000 || !owner.cooldowns.isReady(id, state.nowMs) {
				t.Fatal("START renewed an active cooldown or its expiry did not execute", owner.cooldowns.entries[id], state.nowMs)
			}
			bag := owner.providerState[sdcProviderRef]
			if _, exists := bag.expireAt[key]; exists {
				t.Fatal("source CD retained a second writable expiry")
			}
			if _, exists := bag.targetExpireAt[key]; exists {
				t.Fatal("target CD retained a second writable expiry")
			}
			if math.Abs(owner.attributes.At("attack_speed").Resolved-.6) > 1e-9 {
				t.Fatal("expiry did not refresh provider-dependent attributes", owner.attributes.At("attack_speed"))
			}
		})
	}
}

func TestGenericInternalCooldownAllowsReductionListenerInsideCooldown(t *testing.T) {
	input, request := internalCooldownInput(t, stateScopeProvider, 1000, true)
	request.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "start-reduce", AbilityRef: sdcAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "reduce-inside-cd", AbilityRef: sdcAARef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	request.StopPolicy.DurationMs = 4100
	state := internalCooldownRunState(t, input, request)
	id := genericStateCooldownIdentity("source", sdcProviderRef, sdcTimedKey, stateScopeProvider, "")
	if state.combatants["source"].cooldowns.readyAt(id) != 4000 || !state.combatants["source"].cooldowns.isReady(id, 4000) {
		t.Fatal("CD gating swallowed its legal reduction listener", state.combatants["source"].cooldowns.entries[id])
	}
}

func TestGenericInternalCooldownOldTriggerDoesNotReplayAtExpiry(t *testing.T) {
	for _, lastEvent := range []int64{100, 6000} {
		t.Run(itoa(uint32(lastEvent)), func(t *testing.T) {
			input, request := internalCooldownInput(t, stateScopeProvider, 0, false)
			provider := &input.SharedProviders[len(input.SharedProviders)-1]
			provider.InitialStateSchema["accepted_events"] = float64(0)
			ready := model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.state." + sdcTimedKey}, authoringConst(0)}}
			provider.Listeners[0].Condition = &ready
			provider.Listeners[0].Operations = []model.OperationDefinition{
				{Operation: "state_change", Target: "self", Ref: "accepted_events", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))},
				{Operation: "state_change", Target: "self", Ref: sdcTimedKey, Types: []string{stateScopeProvider}, ValuePolicy: "override", Amount: authoringAmount(authoringConst(1))},
			}
			request.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "first", AbilityRef: sdcAARef(), Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "inside-cd", AbilityRef: sdcAARef(), Source: "source", Target: "target", FirstAtMs: 100},
			}
			if lastEvent == 6000 {
				request.DriverPlan.Entries = append(request.DriverPlan.Entries, model.DriverEntry{EntryKey: "new-at-expiry", AbilityRef: sdcAARef(), Source: "source", Target: "target", FirstAtMs: 6000})
			}
			request.StopPolicy.DurationMs = 6100
			state := internalCooldownRunState(t, input, request)
			want := float64(1)
			if lastEvent == 6000 {
				want = 2
			}
			if actual := state.combatants["source"].providerState[sdcProviderRef].state["accepted_events"]; actual != want {
				t.Fatal("CD replayed an old event or rejected a new event at the exact boundary", actual, want)
			}
		})
	}
}

func TestGenericInternalCooldownResetAndRestartRejectOldExpiry(t *testing.T) {
	input, request := internalCooldownInput(t, stateScopeProvider, 0, false)
	provider := &input.SharedProviders[len(input.SharedProviders)-1]
	for _, config := range []struct {
		key    string
		amount float64
	}{{"start", 1}, {"reset", 0}} {
		provider.Abilities = append(provider.Abilities, model.AbilityDefinition{AbilityKey: config.key, Kind: "active", Types: []string{"ability/spell"}, CastOrigin: model.CastOriginItem,
			Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: sdcTimedKey, Types: []string{stateScopeProvider}, ValuePolicy: "override", Amount: authoringAmount(authoringConst(config.amount))}}})
	}
	ref := func(key string) string { return "source.provider[" + sdcProviderRef + "].ability[" + key + "]" }
	request.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "start", AbilityRef: ref("start"), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "reset", AbilityRef: ref("reset"), Source: "source", Target: "target", FirstAtMs: 1000},
		{EntryKey: "restart", AbilityRef: ref("start"), Source: "source", Target: "target", FirstAtMs: 1100},
	}
	request.StopPolicy.DurationMs = 6100
	state := internalCooldownRunState(t, input, request)
	id := genericStateCooldownIdentity("source", sdcProviderRef, sdcTimedKey, stateScopeProvider, "")
	if actual := state.combatants["source"].cooldowns.readyAt(id); actual != 7100 || state.combatants["source"].cooldowns.isReady(id, state.nowMs) {
		t.Fatal("old expiry cleared the restarted CD", actual, state.nowMs)
	}
	snapshot := providerStateToSnapshot(state.combatants["source"].providerState, state.combatants["source"].cooldowns, "source", state.nowMs)
	bag := snapshot[sdcProviderRef].(map[string]interface{})
	if bag["state"].(map[string]interface{})[sdcTimedKey] != float64(1) || bag["expireAt"].(map[string]interface{})[sdcTimedKey] != float64(7100) {
		t.Fatal("snapshot did not project the actual ledger", bag)
	}
}

func TestInternalCooldownFrozenFormulaViewDoesNotFollowReset(t *testing.T) {
	ledger := newGenericCooldownLedger()
	id := genericStateCooldownIdentity("source", "mounted", "cd", stateScopeProvider, "")
	ledger.start(id, 1000, 0)
	fields := map[string]providerStateFieldDef{"cd": {stateKind: model.ProviderStateKindCooldown, defaultValue: 0, maxValue: 1, hasCap: true, durationMs: 1000, refreshPolicy: model.ProviderStateRefreshStartOnFirstWrite}}
	bags := map[string]*providerStateBag{}
	first := readProviderStateBag(bags, "mounted", true, fields, 100, providerStateReadOptions{cooldowns: ledger, ownerKey: "source"})
	frozenValues := first.state
	bags = freezeProviderStateView(bags)
	shared := true
	changed := ledger.clone()
	changed.reset(id, 100)
	second := readSharedProviderStateBag(&bags, &shared, "mounted", true, fields, 100, providerStateReadOptions{cooldowns: changed, ownerKey: "source"})
	if frozenValues["cd"] != 1 || second.state["cd"] != 0 || first.state["cd"] != 1 {
		t.Fatal("frozen provider state followed a later CD reset")
	}
}

func TestInternalCooldownDoesNotGuessOrdinaryTTLFromName(t *testing.T) {
	bag := &providerStateBag{}
	bag.bindFieldDefs(map[string]providerStateFieldDef{
		"cooldown": {defaultValue: 0, maxValue: 1, hasCap: true, durationMs: 1000, refreshPolicy: model.ProviderStateRefreshOnWrite},
		"marked":   {stateKind: model.ProviderStateKindCooldown, defaultValue: 0, maxValue: 1, hasCap: true, durationMs: 1000, refreshPolicy: model.ProviderStateRefreshStartOnFirstWrite},
		"ammo":     {stateKind: model.ProviderStateKindAmmo, defaultValue: 5, maxValue: 5, hasCap: true},
	})
	bag.writableState()["cooldown"] = 1
	if !bag.refreshExpireAtOnWrite("cooldown", 100) || bag.expireAt["cooldown"] != 1100 || bag.refreshExpireAtOnWrite("marked", 100) {
		t.Fatal("unmarked ordinary TTL or marked CD used the wrong writer")
	}
	ledger := newGenericCooldownLedger()
	bag.projectInternalCooldowns(ledger, "source", "mounted", 100)
	if bag.state["cooldown"] != 1 || bag.state["ammo"] != 5 || len(ledger.entries) != 0 {
		t.Fatal("ordinary state or ammo became a CD")
	}
}
