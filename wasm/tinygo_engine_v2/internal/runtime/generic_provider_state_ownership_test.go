package runtime

import (
	"maps"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
)

type providerStateOwnershipView struct {
	state, targetValues    map[string]float64
	expireAt, targetExpire map[string]int64
	generation             map[string]uint64
	target, holdTarget     string
	holdKey                string
	holdAt                 int64
	holdGeneration         uint64
}

func providerStateOwnershipBag() *providerStateBag {
	return &providerStateBag{
		state: map[string]float64{"stacks": 2, "hits": 0}, expireAt: map[string]int64{"stacks": 100},
		targetKey: "target", targetValues: map[string]float64{"hits": 3}, targetExpireAt: map[string]int64{"hits": 100},
		anchoredTickGeneration: map[string]uint64{"hits": 7},
		fieldDefs: map[string]providerStateFieldDef{
			"stacks": {defaultValue: 0, durationMs: 100, refreshPolicy: model.ProviderStateRefreshOnWrite},
			"hits":   {defaultValue: 0, durationMs: 100, refreshPolicy: model.ProviderStateRefreshOnWrite},
		},
	}
}

func providerStateOwnershipSnapshot(bag *providerStateBag) providerStateOwnershipView {
	return providerStateOwnershipView{
		maps.Clone(bag.state), maps.Clone(bag.targetValues), maps.Clone(bag.expireAt), maps.Clone(bag.targetExpireAt),
		maps.Clone(bag.anchoredTickGeneration), bag.targetKey, bag.inclusiveAtExpiryTarget, bag.inclusiveAtExpiryKey,
		bag.inclusiveAtExpiryAt, bag.inclusiveAtExpiryGen,
	}
}

func assertProviderStateOwnershipView(t *testing.T, label string, bag *providerStateBag, want providerStateOwnershipView) {
	t.Helper()
	if got := providerStateOwnershipSnapshot(bag); !reflect.DeepEqual(got, want) {
		t.Fatalf("%s changed another version: got %+v want %+v", label, got, want)
	}
}

func TestProviderStateOwnershipWritesStayInTheirVersionAcrossClones(t *testing.T) {
	original := providerStateOwnershipBag()
	originalMap := map[string]*providerStateBag{"item": original}
	firstMap := cloneProviderStateMap(originalMap)
	secondMap := cloneProviderStateMap(firstMap)
	first, second := firstMap["item"], secondMap["item"]
	initial := providerStateOwnershipSnapshot(original)
	writeAll := func(bag *providerStateBag, value float64, target string) {
		bag.writableState()["stacks"] = value
		bag.writableExpireAt()["stacks"] = int64(value * 100)
		bag.writableTargetValues()["hits"] = value + 1
		bag.writableTargetExpireAt()["hits"] = int64(value*100 + 1)
		bag.writableAnchoredTickGeneration()["hits"] = uint64(value + 2)
		bag.targetKey = target
		bag.setInclusiveAtExpiryHold(target, "hits")
	}
	writeAll(original, 10, "original")
	originalWritten := providerStateOwnershipSnapshot(original)
	assertProviderStateOwnershipView(t, "first after original writes", first, initial)
	assertProviderStateOwnershipView(t, "second after original writes", second, initial)
	writeAll(first, 20, "first")
	firstWritten := providerStateOwnershipSnapshot(first)
	assertProviderStateOwnershipView(t, "original after first writes", original, originalWritten)
	assertProviderStateOwnershipView(t, "second after first writes", second, initial)
	writeAll(second, 30, "second")
	assertProviderStateOwnershipView(t, "original after second writes", original, originalWritten)
	assertProviderStateOwnershipView(t, "first after second writes", first, firstWritten)
	firstMap["new"] = &providerStateBag{}
	delete(secondMap, "item")
	if len(originalMap) != 1 || originalMap["item"] != original || firstMap["item"] != first {
		t.Fatal("cloned outer maps lost independent entries")
	}
}

func TestProviderStateOwnershipExpiryHoldAndTargetSwitchKeepSiblingViews(t *testing.T) {
	original := providerStateOwnershipBag()
	initial := providerStateOwnershipSnapshot(original)
	firstMap := cloneProviderStateMap(map[string]*providerStateBag{"item": original})
	first := firstMap["item"]
	second := cloneProviderStateMap(firstMap)["item"]
	if first.bumpAnchoredTickGeneration("hits") != 8 || second.currentAnchoredTickGeneration("hits") != 7 || original.currentAnchoredTickGeneration("hits") != 7 {
		t.Fatal("generation advance changed another cloned bag")
	}
	first.setInclusiveAtExpiryHold("target", "hits")
	frozenTarget := first.targetStateForFormula()
	first.lazyExpireProviderState(100)
	first.lazyExpireProviderTargetState(100)
	if first.state["stacks"] != 0 || first.expireAt["stacks"] != 0 || first.targetValues["hits"] != 3 || first.targetExpireAt["hits"] != 100 {
		t.Fatal("provider expiry or inclusive target hold changed meaning")
	}
	second.lazyExpireProviderTargetState(100)
	if second.targetValues["hits"] != 0 || second.targetExpireAt["hits"] != 0 || first.targetValues["hits"] != 3 || first.inclusiveAtExpiryKey != "hits" {
		t.Fatal("target expiry or scalar hold leaked between cloned bags")
	}
	first.clearInclusiveAtExpiryHold()
	first.lazyExpireProviderTargetState(101)
	if first.targetValues["hits"] != 0 || frozenTarget["hits"] != 3 {
		t.Fatal("target expiry changed the previously frozen formula view")
	}
	assertProviderStateOwnershipView(t, "original after sibling expiry", original, initial)
	switched := cloneProviderStateMap(map[string]*providerStateBag{"item": original})["item"]
	switched.activateProviderTarget("source")
	if len(switched.targetValues) != 0 || len(switched.targetExpireAt) != 0 || switched.currentAnchoredTickGeneration("hits") != 0 || switched.targetKey != "source" {
		t.Fatal("target switch retained old target values, timers or generation")
	}
	switched.seedTargetValueIfAbsent("hits")
	if switched.bumpAnchoredTickGeneration("hits") != 1 || switched.readTargetValue("hits") != 0 {
		t.Fatal("new target failed to start an independent default/generation")
	}
	assertProviderStateOwnershipView(t, "original after target switch", original, initial)
}

func TestProviderStateOwnershipTimerWritesKeepOtherVersions(t *testing.T) {
	original := providerStateOwnershipBag()
	initial := providerStateOwnershipSnapshot(original)
	clone := cloneProviderStateMap(map[string]*providerStateBag{"item": original})["item"]
	if !clone.refreshExpireAtOnWrite("stacks", 50) {
		t.Fatal("provider timer refresh failed")
	}
	if expiry, ok := clone.refreshTargetExpireAtOnWrite("hits", 50); !ok || expiry != 150 {
		t.Fatal(expiry, ok)
	}
	if applied, expired, expiry := clone.subtractProviderExpireAt("stacks", 60, 25); !applied || expired || expiry != 125 {
		t.Fatal(applied, expired, expiry)
	}
	if applied, expired, expiry := clone.subtractTargetExpireAt("hits", 60, 100); !applied || !expired || expiry != 0 {
		t.Fatal(applied, expired, expiry)
	}
	if clone.expireAt["stacks"] != 125 || clone.targetExpireAt["hits"] != 0 || clone.state["stacks"] != 2 || clone.targetValues["hits"] != 3 {
		t.Fatal("timer update changed state values")
	}
	assertProviderStateOwnershipView(t, "original after timer writes", original, initial)
	// 首次写入计时既要保留活跃期限，也要在期限已过后独立重建。
	start := providerStateOwnershipBag()
	for key, def := range start.fieldDefs {
		def.refreshPolicy = model.ProviderStateRefreshStartOnFirstWrite
		start.fieldDefs[key] = def
	}
	startClone := cloneProviderStateMap(map[string]*providerStateBag{"item": start})["item"]
	if !startClone.refreshExpireAtOnWrite("stacks", 100) {
		t.Fatal("provider start-on-first-write failed")
	}
	if expiry, ok := startClone.refreshTargetExpireAtOnWrite("hits", 100); !ok || expiry != 200 {
		t.Fatal(expiry, ok)
	}
	if startClone.expireAt["stacks"] != 200 || start.expireAt["stacks"] != 100 || start.targetExpireAt["hits"] != 100 {
		t.Fatal("start-on-first-write used a shared timer alias")
	}
}

func TestProviderStateOwnershipDefaultsSeedOnlyTheirWritableVersion(t *testing.T) {
	original := providerStateOwnershipBag()
	original.fieldDefs = nil
	initial := providerStateOwnershipSnapshot(original)
	clone := cloneProviderStateMap(map[string]*providerStateBag{"item": original})["item"]
	clone.bindFieldDefs(newProviderStateFieldMetadata(map[string]providerStateFieldDef{"stacks": {defaultValue: 0}, "new": {defaultValue: 4}}))
	clone.seedTargetValueIfAbsent("new")
	if clone.state["new"] != 4 || clone.targetValues["new"] != 4 || clone.state["stacks"] != 2 || len(original.fieldDefs) != 0 {
		t.Fatal("binding or seeding defaults changed the wrong bag")
	}
	assertProviderStateOwnershipView(t, "original after defaults", original, initial)
}

func TestProviderStateOwnershipReadOnlyAccessDoesNotCopyMaps(t *testing.T) {
	original := providerStateOwnershipBag()
	for key, def := range original.fieldDefs {
		def.refreshPolicy = model.ProviderStateRefreshStartOnFirstWrite
		original.fieldDefs[key] = def
	}
	original.defaultsForFormula()
	clone := cloneProviderStateMap(map[string]*providerStateBag{"item": original})["item"]
	initial := providerStateOwnershipSnapshot(clone)
	fields := newProviderStateFieldMetadata(clone.fieldDefs)
	allocations := testing.AllocsPerRun(50, func() {
		clone.ensure()
		clone.bindFieldDefs(fields)
		clone.seedTargetValueIfAbsent("hits")
		clone.lazyExpireProviderState(99)
		clone.lazyExpireProviderTargetState(99)
		clone.readTargetValue("stacks")
		clone.targetStateForFormula()
		clone.defaultsForFormula()
		clone.currentAnchoredTickGeneration("hits")
		clone.refreshExpireAtOnWrite("stacks", 99)
		clone.refreshTargetExpireAtOnWrite("hits", 99)
	})
	if allocations != 0 {
		t.Fatalf("reads and unchanged active timers allocated %.1f objects", allocations)
	}
	assertProviderStateOwnershipView(t, "read-only clone", clone, initial)
	assertProviderStateOwnershipView(t, "original after read-only clone", original, initial)
}

func TestProviderStateOwnershipRestoreKeepsSiblingSnapshot(t *testing.T) {
	original := providerStateOwnershipBag()
	initial := providerStateOwnershipSnapshot(original)
	clone := cloneProviderStateMap(map[string]*providerStateBag{"item": original})["item"]
	if err := restoreBagTimers(clone, 100, map[string]bool{"target": true}, "providerState.item", "schema", "rules", "session"); err != nil {
		t.Fatal(err)
	}
	if clone.state["stacks"] != 0 || clone.targetValues["hits"] != 0 || clone.expireAt["stacks"] != 0 || clone.targetExpireAt["hits"] != 0 {
		t.Fatal("snapshot restore failed to reset expired values and timers")
	}
	assertProviderStateOwnershipView(t, "original after restore", original, initial)
}

func TestProviderStateOwnershipFailedFrameDoesNotPublishStateOrTimers(t *testing.T) {
	sourceChange := model.OperationDefinition{Operation: "state_change", Target: "source", Ref: "stacks", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}
	targetChange := model.OperationDefinition{Operation: "state_change", Target: "source", Ref: "hits", Types: []string{stateScopeProviderTarget}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}
	c, r := frameCommitInput(sourceChange, targetChange, frameCommitDamage(1))
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"}, model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"})
	c.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": map[string]interface{}{"defaultValue": float64(0), "maxValue": float64(99), "durationMs": float64(100), "refreshPolicy": model.ProviderStateRefreshOnWrite},
		"hits":   map[string]interface{}{"defaultValue": float64(0), "maxValue": float64(99), "durationMs": float64(100), "refreshPolicy": model.ProviderStateRefreshOnWrite},
	}
	r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"attack": map[string]interface{}{
		"state": map[string]interface{}{"stacks": float64(2), "hits": float64(0)}, "expireAt": map[string]interface{}{"stacks": float64(50)},
		"targetState": map[string]interface{}{"target": "target", "values": map[string]interface{}{"hits": float64(3)}, "expireAt": map[string]interface{}{"hits": float64(50)}},
	}}
	state := frameCommitState(t, c, r)
	liveBag := state.combatants["source"].providerState["attack"]
	want := providerStateOwnershipSnapshot(liveBag)
	previous, _, _ := frameCommitFrame(state)
	previousBag := previous.stageFor("source").providerState["attack"]
	state.budget.MaxCommandsPerEvent = 2
	frame, ability, ops := frameCommitFrame(state)
	err := frame.executeOperations(ability, ops)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("expected budget failure after both state changes: %v", err)
	}
	stagedBag := frame.stageFor("source").providerState["attack"]
	if stagedBag.state["stacks"] != 3 || stagedBag.targetValues["hits"] != 4 || stagedBag.expireAt["stacks"] != 100 || stagedBag.targetExpireAt["hits"] != 100 {
		t.Fatal("failure occurred before the intended state/timer writes", providerStateOwnershipSnapshot(stagedBag))
	}
	frame.commit()
	if frame.committed {
		t.Fatal("failed frame committed")
	}
	assertProviderStateOwnershipView(t, "live after failed frame", state.combatants["source"].providerState["attack"], want)
	assertProviderStateOwnershipView(t, "borrowed live bag", liveBag, want)
	assertProviderStateOwnershipView(t, "previous staged bag", previousBag, want)
}
