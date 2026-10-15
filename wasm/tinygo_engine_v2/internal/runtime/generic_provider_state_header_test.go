package runtime

import (
	"math"
	"testing"
)

func TestProviderStateHeaderSharingChangesOnlyTheUsedBag(t *testing.T) {
	original, idle := providerStateOwnershipBag(), providerStateOwnershipBag()
	source := map[string]*providerStateBag{"used": original, "idle": idle}
	first := shareProviderStateMap(source)
	second := shareProviderStateMap(first)
	initial := providerStateOwnershipSnapshot(original)
	if first["used"] != original || second["used"] != original || first["idle"] != idle || !original.headerShared {
		t.Fatal("sharing copied a bag before use or failed to freeze its head")
	}
	write := func(bags map[string]*providerStateBag, value float64, target string) *providerStateBag {
		bag := writableProviderStateBag(bags, "used", false)
		bag.writableState()["stacks"] = value
		bag.writableExpireAt()["stacks"] = int64(value * 100)
		bag.writableTargetValues()["hits"] = value + 1
		bag.writableTargetExpireAt()["hits"] = int64(value*100 + 1)
		bag.writableAnchoredTickGeneration()["hits"] = uint64(value + 2)
		bag.targetKey = target
		bag.setInclusiveAtExpiryHold(target, "hits")
		return bag
	}
	firstBag := write(first, 10, "first")
	firstWritten := providerStateOwnershipSnapshot(firstBag)
	if firstBag == original || firstBag.headerShared || !original.headerShared || first["idle"] != idle || source["idle"] != idle {
		t.Fatal("first use did not obtain just one independent writable head")
	}
	assertProviderStateOwnershipView(t, "source after first writes", source["used"], initial)
	assertProviderStateOwnershipView(t, "second after first writes", second["used"], initial)
	write(source, 20, "source")
	sourceWritten := providerStateOwnershipSnapshot(source["used"])
	write(second, 30, "second")
	assertProviderStateOwnershipView(t, "first after source and second writes", first["used"], firstWritten)
	assertProviderStateOwnershipView(t, "source after second writes", source["used"], sourceWritten)
	assertProviderStateOwnershipView(t, "original frozen head", original, initial)

	third := shareProviderStateMap(first)
	write(first, 40, "first-after-publication")
	assertProviderStateOwnershipView(t, "third after first writes again", third["used"], firstWritten)
	if third["idle"] != idle || first["idle"] != idle {
		t.Fatal("another publication copied an unused bag")
	}
	delete(first, "idle")
	first["new"] = &providerStateBag{}
	if source["idle"] != idle || second["idle"] != idle || third["idle"] != idle || len(source) != 2 {
		t.Fatal("shared outer maps did not keep independent entries")
	}
}

func TestProviderStateHeaderAliasedEntriesDetachIndividually(t *testing.T) {
	original := providerStateOwnershipBag()
	source := map[string]*providerStateBag{"first": original, "second": original}
	shared := shareProviderStateMap(source)
	initial := providerStateOwnershipSnapshot(original)
	first := writableProviderStateBag(shared, "first", false)
	first.targetKey = "first-target"
	first.writableState()["stacks"] = 10
	if first == original || shared["second"] != original || source["first"] != original || source["second"] != original {
		t.Fatal("detaching one alias replaced another entry")
	}
	assertProviderStateOwnershipView(t, "second alias", shared["second"], initial)
	second := writableProviderStateBag(shared, "second", false)
	second.targetKey = "second-target"
	second.writableState()["stacks"] = 20
	if second == first || second == original || first.targetKey != "first-target" || first.state["stacks"] != 10 {
		t.Fatal("writable aliases did not obtain independent heads and values")
	}
	assertProviderStateOwnershipView(t, "aliased source", original, initial)
}

func TestProviderStateHeaderNilBagsAndMissingCreationKeepTheirMeaning(t *testing.T) {
	source := map[string]*providerStateBag{"first": nil, "second": nil}
	shared := shareProviderStateMap(source)
	first, second := shared["first"], shared["second"]
	if first == nil || second == nil || first == second || first.headerShared || second.headerShared || source["first"] != nil || source["second"] != nil {
		t.Fatal("nil entries were not independently normalized without changing the source")
	}
	for key, bag := range shared {
		if bag.state == nil || bag.expireAt == nil || bag.fieldDefs == nil || bag.targetValues == nil || bag.targetExpireAt == nil || bag.anchoredTickGeneration == nil {
			t.Fatalf("%s lost an initialized empty map", key)
		}
	}
	first.writableState()["stacks"] = 2
	first.targetKey = "target"
	if len(second.state) != 0 || second.targetKey != "" {
		t.Fatal("normalized nil bags share mutable data")
	}
	if writableProviderStateBag(shared, "missing", false) != nil || len(shared) != 2 {
		t.Fatal("missing read inserted a provider bag")
	}
	created := writableProviderStateBag(shared, "missing", true)
	if created == nil || shared["missing"] != created || created.headerShared || created.state == nil || created.targetValues == nil || created.anchoredTickGeneration == nil {
		t.Fatal("explicit creation did not install an owned initialized bag")
	}
	if writableProviderStateBag(source, "first", false) != nil || source["first"] != nil {
		t.Fatal("nil read created a bag")
	}
	if writableProviderStateBag(nil, "missing", true) != nil {
		t.Fatal("an uninitialized outer map must not return an uninstalled bag")
	}
	for _, empty := range []map[string]*providerStateBag{nil, {}} {
		one, two := shareProviderStateMap(empty), shareProviderStateMap(empty)
		if one == nil || two == nil {
			t.Fatal("empty sharing must return writable outer maps")
		}
		writableProviderStateBag(one, "created", true)
		if len(empty) != 0 || len(two) != 0 {
			t.Fatal("empty outer maps share new entries")
		}
	}
}

func TestProviderStateHeaderDeepCloneKeepsItsIndependentHeadContract(t *testing.T) {
	original := providerStateOwnershipBag()
	source := map[string]*providerStateBag{"item": original}
	shared := shareProviderStateMap(source)
	initial := providerStateOwnershipSnapshot(original)
	cloned := cloneProviderStateMap(shared)
	bag := cloned["item"]
	if bag == original || bag.headerShared || shared["item"] != original || !original.headerShared {
		t.Fatal("deep clone kept a shared header or changed the source sharing state")
	}
	if allocations := testing.AllocsPerRun(50, func() {
		if writableProviderStateBag(cloned, "item", false) != bag {
			t.Fatal("access copied a head already owned by the deep clone")
		}
	}); allocations != 0 {
		t.Fatalf("owned header access allocated %v objects", allocations)
	}
	bag.writableState()["stacks"] = 10
	bag.targetKey = "deep-clone-target"
	bag.bumpAnchoredTickGeneration("hits")
	assertProviderStateOwnershipView(t, "shared after deep clone writes", shared["item"], initial)
	assertProviderStateOwnershipView(t, "source after deep clone writes", source["item"], initial)
}

func TestProviderStateHeaderLazyExpirationKeepsFrozenValuesAndHold(t *testing.T) {
	original := providerStateOwnershipBag()
	original.setInclusiveAtExpiryHold("target", "hits")
	source := map[string]*providerStateBag{"item": original}
	frozen := shareProviderStateMap(source)
	initial := providerStateOwnershipSnapshot(original)
	if allocations := testing.AllocsPerRun(50, func() {
		if original.needsLazyExpiration(99) {
			t.Fatal("future expiry requires an unnecessary writable head")
		}
	}); allocations != 0 {
		t.Fatalf("unchanged expiry check allocated %v objects", allocations)
	}
	if source["item"] != original || frozen["item"] != original || !original.needsLazyExpiration(100) {
		t.Fatal("unchanged check copied a head or missed the source expiry boundary")
	}
	bag := writableProviderStateBag(source, "item", false)
	bag.lazyExpireProviderState(100)
	bag.lazyExpireProviderTargetState(100)
	if bag.state["stacks"] != 0 || bag.expireAt["stacks"] != 0 || bag.targetValues["hits"] != 3 || bag.targetExpireAt["hits"] != 100 || bag.needsLazyExpiration(100) {
		t.Fatal("source expiry or target inclusive hold changed meaning")
	}
	assertProviderStateOwnershipView(t, "frozen after expiry", frozen["item"], initial)
	targetView := bag.targetStateForFormula()
	bag.clearInclusiveAtExpiryHold()
	if !bag.needsLazyExpiration(100) {
		t.Fatal("clearing the hold failed to enable target expiry at the same timestamp")
	}
	bag.lazyExpireProviderTargetState(100)
	if bag.targetValues["hits"] != 0 || bag.targetExpireAt["hits"] != 0 || targetView["hits"] != 3 {
		t.Fatal("expiry changed a frozen formula view or failed to reset the timer")
	}
	assertProviderStateOwnershipView(t, "frozen after hold release", frozen["item"], initial)
}

func TestProviderStateHeaderLazyInitializationDoesNotSeedDefaults(t *testing.T) {
	missingMaps := []struct {
		name  string
		clear func(*providerStateBag)
	}{
		{"state", func(bag *providerStateBag) { bag.state = nil }},
		{"expiry", func(bag *providerStateBag) { bag.expireAt = nil }},
		{"target", func(bag *providerStateBag) { bag.targetValues = nil }},
		{"target_expiry", func(bag *providerStateBag) { bag.targetExpireAt = nil }},
		{"generation", func(bag *providerStateBag) { bag.anchoredTickGeneration = nil }},
	}
	for _, missing := range missingMaps {
		t.Run(missing.name, func(t *testing.T) {
			original := providerStateOwnershipBag()
			original.expireAt, original.targetExpireAt = map[string]int64{}, map[string]int64{}
			missing.clear(original)
			source := map[string]*providerStateBag{"item": original}
			frozen := shareProviderStateMap(source)
			initial := providerStateOwnershipSnapshot(original)
			if !original.needsLazyExpiration(1) {
				t.Fatal("lazy expiry missed an initialization write")
			}
			bag := writableProviderStateBag(source, "item", false)
			bag.lazyExpireProviderState(1)
			bag.lazyExpireProviderTargetState(1)
			if bag.state == nil || bag.expireAt == nil || bag.targetValues == nil || bag.targetExpireAt == nil || bag.anchoredTickGeneration == nil || bag.needsLazyExpiration(1) || bag.fieldDefaults != nil {
				t.Fatal("lazy initialization left missing maps or inserted formula defaults")
			}
			assertProviderStateOwnershipView(t, "frozen after initialization", frozen["item"], initial)
		})
	}
	var zero *providerStateBag
	if zero.needsLazyExpiration(100) || (&providerStateBag{}).needsLazyExpiration(100) {
		t.Fatal("bags without field definitions must retain their existing lazy no-op")
	}
	bag := providerStateOwnershipBag()
	bag.state, bag.expireAt, bag.targetExpireAt = map[string]float64{}, map[string]int64{}, map[string]int64{}
	if bag.needsLazyExpiration(100) {
		t.Fatal("missing values or uncached formula defaults are not lazy-expiry writes")
	}
	bag.lazyExpireProviderState(100)
	bag.lazyExpireProviderTargetState(100)
	if len(bag.state) != 0 || bag.fieldDefaults != nil {
		t.Fatal("lazy sweep introduced default binding not present in the original behavior")
	}
}

func TestProviderStateHeaderFormulaPreparationKeepsTheOtherBranch(t *testing.T) {
	original := providerStateOwnershipBag()
	original.fieldDefs = nil
	source := map[string]*providerStateBag{"item": original}
	shared := shareProviderStateMap(source)
	initial := providerStateOwnershipSnapshot(original)
	bag := writableProviderStateBag(shared, "item", false)
	bag.bindFieldDefs(newProviderStateFieldMetadata(map[string]providerStateFieldDef{"new": {defaultValue: 4}}))
	defaults := bag.defaultsForFormula()
	if bag.state["new"] != 4 || defaults["new"] != 4 {
		t.Fatal("first formula use failed to bind its state defaults")
	}
	bag.activateProviderTarget("new-target")
	bag.seedTargetValueIfAbsent("new")
	targetView := bag.targetStateForFormula()
	bag.writableTargetValues()["new"] = 6
	if targetView["new"] != 4 || bag.targetValues["new"] != 6 || original.fieldDefs != nil || original.fieldDefaults != nil {
		t.Fatal("formula preparation or later target write changed a frozen header/view")
	}
	assertProviderStateOwnershipView(t, "source after formula preparation", source["item"], initial)
}

func TestProviderStateHeaderCleanupReacquiresThePublishedBag(t *testing.T) {
	before := providerStateOwnershipBag()
	before.setInclusiveAtExpiryHold("target", "hits")
	live := map[string]*providerStateBag{"item": before}
	staged := shareProviderStateMap(live)
	stagedBag := writableProviderStateBag(staged, "item", false)
	stagedBag.writableTargetValues()["hits"] = 5
	live = shareProviderStateMap(staged)
	published := shareProviderStateMap(live)
	initial := providerStateOwnershipSnapshot(stagedBag)
	// 清理必须重新取得当前运行态的头，不能写提交前借出的before或已发布stagedBag。
	current := writableProviderStateBag(live, "item", false)
	current.clearInclusiveAtExpiryHold()
	if current == before || current == stagedBag || current.inclusiveAtExpiryKey != "" || current.targetValues["hits"] != 5 {
		t.Fatal("cleanup did not use the current owned published version")
	}
	assertProviderStateOwnershipView(t, "published after cleanup", published["item"], initial)
	assertProviderStateOwnershipView(t, "staged after cleanup", staged["item"], initial)
	if before.inclusiveAtExpiryKey != "hits" || before.targetValues["hits"] != 3 {
		t.Fatal("cleanup changed a borrowed pre-commit bag")
	}
}

func TestProviderStateHeaderReadBorrowsPreparedSharedBagWithoutAllocation(t *testing.T) {
	original := providerStateOwnershipBag()
	negativeZero := math.Copysign(0, -1)
	original.fieldDefs["zero"] = providerStateFieldDef{defaultValue: negativeZero}
	original.state["zero"], original.targetValues["zero"] = negativeZero, negativeZero
	original.defaultsForFormula()
	source := map[string]*providerStateBag{"item": original}
	shared := shareProviderStateMap(source)
	initial := providerStateOwnershipSnapshot(original)
	options := providerStateReadOptions{expireTarget: true, defaults: true, targetView: true, targetKey: "target"}
	fields := newProviderStateFieldMetadata(original.fieldDefs)
	if allocations := testing.AllocsPerRun(50, func() {
		bag := readProviderStateBag(shared, "item", false, fields, 99, options)
		if bag != original || !bag.headerShared {
			t.Fatal("a prepared read copied its shared bag head")
		}
		context := providerFormulaContextFromBag(bag, "target")
		if math.Float64bits(context.ProviderState["zero"]) != math.Float64bits(negativeZero) || math.Float64bits(context.ProviderTargetState["zero"]) != math.Float64bits(negativeZero) || math.Float64bits(context.ProviderStateDefaults["zero"]) != math.Float64bits(negativeZero) {
			t.Fatal("borrowing a prepared context changed negative zero")
		}
	}); allocations != 0 {
		t.Fatalf("prepared shared reads allocated %v objects", allocations)
	}
	assertProviderStateOwnershipView(t, "source after borrowed reads", source["item"], initial)
	assertProviderStateOwnershipView(t, "shared after borrowed reads", shared["item"], initial)
	owned := writableProviderStateBag(shared, "item", false)
	owned.writableState()["stacks"] = 5
	owned.writableTargetValues()["hits"] = 6
	assertProviderStateOwnershipView(t, "borrowed after subsequent owned writes", original, initial)
}

func TestProviderStateHeaderReadCachesDefaultsOnlyWhenRequested(t *testing.T) {
	original := providerStateOwnershipBag()
	fields := newProviderStateFieldMetadata(original.fieldDefs)
	source := map[string]*providerStateBag{"item": original}
	shared := shareProviderStateMap(source)
	bag := readProviderStateBag(shared, "item", false, fields, 99, providerStateReadOptions{})
	if bag != original || bag.fieldDefaults != nil || original.fieldDefaults != nil {
		t.Fatal("a read without defaults changed cache preparation timing")
	}
	bag = readProviderStateBag(shared, "item", false, fields, 99, providerStateReadOptions{defaults: true})
	if bag == original || bag.fieldDefaults == nil || original.fieldDefaults != nil || len(bag.fieldDefaults) != len(original.fieldDefs) {
		t.Fatal("a defaults read failed to prepare its own cache")
	}
	child := shareProviderStateMap(shared)
	if allocations := testing.AllocsPerRun(50, func() {
		if readProviderStateBag(child, "item", false, fields, 99, providerStateReadOptions{defaults: true}) != bag {
			t.Fatal("cached defaults caused another bag-head copy")
		}
	}); allocations != 0 {
		t.Fatalf("cached defaults reads allocated %v objects", allocations)
	}
	if original.fieldDefaults != nil {
		t.Fatal("later reads populated the frozen source defaults cache")
	}
}

func TestProviderStateHeaderReadKeepsNilTargetPreparationAtItsOriginalBoundary(t *testing.T) {
	original := &providerStateBag{}
	source := map[string]*providerStateBag{"item": original, "nil": nil}
	shared := shareProviderStateMap(source)
	for _, options := range []providerStateReadOptions{{}, {defaults: true}, {targetView: true, targetKey: "other"}} {
		if bag := readProviderStateBag(shared, "item", false, nil, 100, options); bag != original || bag.targetValues != nil || bag.state != nil || bag.fieldDefaults != nil {
			t.Fatal("an inactive target read initialized unrelated maps or defaults")
		}
	}
	// 空目标键仍沿原evalContext的相等条件准备目标视图。
	bag := readProviderStateBag(shared, "item", false, nil, 100, providerStateReadOptions{targetView: true})
	if bag == original || bag.targetValues == nil || !bag.targetValuesShared || bag.state != nil || bag.expireAt != nil || bag.targetExpireAt != nil || bag.anchoredTickGeneration != nil || bag.fieldDefs != nil || bag.fieldDefaults != nil || original.targetValues != nil {
		t.Fatal("matching target preparation changed the wrong bag or initialized unrelated tables")
	}
	if readProviderStateBag(source, "nil", false, nil, 100, providerStateReadOptions{}) != nil || source["nil"] != nil || readProviderStateBag(source, "missing", false, nil, 100, providerStateReadOptions{}) != nil || len(source) != 2 {
		t.Fatal("a missing or nil read created a bag")
	}
	created := readProviderStateBag(source, "missing", true, nil, 100, providerStateReadOptions{defaults: true})
	if created == nil || source["missing"] != created || created.fieldDefaults != nil {
		t.Fatal("explicit empty-bag creation changed empty defaults semantics")
	}
}

func TestProviderStateHeaderReadBindsOnlyDeclaredMissingValues(t *testing.T) {
	negativeZero := math.Copysign(0, -1)
	original := providerStateOwnershipBag()
	original.fieldDefs["stacks"] = providerStateFieldDef{defaultValue: negativeZero}
	delete(original.state, "stacks")
	original.state["unknown"] = negativeZero
	source := map[string]*providerStateBag{"item": original}
	shared := shareProviderStateMap(source)
	initial := providerStateOwnershipSnapshot(original)
	if bag := readProviderStateBag(shared, "item", false, nil, 99, providerStateReadOptions{}); bag != original {
		t.Fatal("an empty field binding seeded missing values")
	}
	if _, exists := original.state["stacks"]; exists {
		t.Fatal("an empty field binding changed missing-key semantics")
	}
	// 已有字段定义不被调用方另一组定义覆盖；仍只补已有定义中的缺值。
	fields := map[string]providerStateFieldDef{"new": {defaultValue: 4}}
	bag := readProviderStateBag(shared, "item", false, newProviderStateFieldMetadata(fields), 99, providerStateReadOptions{})
	if bag == original || math.Float64bits(bag.state["stacks"]) != math.Float64bits(negativeZero) || math.Float64bits(bag.state["unknown"]) != math.Float64bits(negativeZero) || bag.fieldDefaults != nil {
		t.Fatal("binding changed zero bits, unknown stored values, or defaults cache timing")
	}
	if _, exists := bag.state["new"]; exists {
		t.Fatal("a later binding replaced existing field definitions")
	}
	if _, exists := bag.state["undeclared"]; exists {
		t.Fatal("a read introduced an undeclared numeric key")
	}
	assertProviderStateOwnershipView(t, "source after missing default binding", original, initial)

	unbound := providerStateOwnershipBag()
	unbound.fieldDefs = nil
	unboundSource := map[string]*providerStateBag{"item": unbound}
	unboundShared := shareProviderStateMap(unboundSource)
	bound := readProviderStateBag(unboundShared, "item", false, newProviderStateFieldMetadata(fields), 99, providerStateReadOptions{})
	if bound == unbound || bound.fieldDefs["new"].defaultValue != 4 || bound.state["new"] != 4 || bound.fieldDefaults != nil || unbound.fieldDefs != nil {
		t.Fatal("first field binding did not preserve branch and cache isolation")
	}
}

func TestProviderStateHeaderReadInitializesMissingTablesInItsOwnBranch(t *testing.T) {
	original := providerStateOwnershipBag()
	original.state = nil
	source := map[string]*providerStateBag{"item": original}
	shared := shareProviderStateMap(source)
	initial := providerStateOwnershipSnapshot(original)
	bag := readProviderStateBag(shared, "item", false, newProviderStateFieldMetadata(original.fieldDefs), 99, providerStateReadOptions{})
	if bag == original || bag.state == nil || bag.expireAt == nil || bag.targetValues == nil || bag.targetExpireAt == nil || bag.anchoredTickGeneration == nil || bag.fieldDefaults != nil {
		t.Fatal("missing-table preparation was shared or populated unrequested defaults")
	}
	if value, exists := bag.state["stacks"]; !exists || value != 0 {
		t.Fatal("field binding failed to insert the declared default")
	}
	assertProviderStateOwnershipView(t, "source after missing-table preparation", original, initial)
}

func TestProviderStateHeaderReadExpiryRespectsScopeAndInclusiveHold(t *testing.T) {
	original := providerStateOwnershipBag()
	original.expireAt["stacks"] = 0
	original.setInclusiveAtExpiryHold("target", "hits")
	original.defaultsForFormula()
	source := map[string]*providerStateBag{"item": original}
	shared := shareProviderStateMap(source)
	initial := providerStateOwnershipSnapshot(original)
	options := providerStateReadOptions{expireTarget: true, defaults: true, targetView: true, targetKey: "target"}
	if readProviderStateBag(shared, "item", false, newProviderStateFieldMetadata(original.fieldDefs), 100, options) != original {
		t.Fatal("the exact inclusive expiry boundary copied a held bag")
	}
	options.expireTarget = false
	if readProviderStateBag(shared, "item", false, newProviderStateFieldMetadata(original.fieldDefs), 101, options) != original || original.targetValues["hits"] != 3 {
		t.Fatal("a source-only read expired target state")
	}
	options.expireTarget = true
	bag := readProviderStateBag(shared, "item", false, newProviderStateFieldMetadata(original.fieldDefs), 101, options)
	if bag == original || bag.targetValues["hits"] != 0 || bag.targetExpireAt["hits"] != 0 || bag.state["stacks"] != 2 {
		t.Fatal("a real target expiry failed to prepare its own branch")
	}
	assertProviderStateOwnershipView(t, "source after target expiry", original, initial)

	negativeZero := math.Copysign(0, -1)
	provider := providerStateOwnershipBag()
	provider.fieldDefs["stacks"] = providerStateFieldDef{defaultValue: negativeZero, durationMs: 100}
	providerSource := map[string]*providerStateBag{"item": provider}
	providerShared := shareProviderStateMap(providerSource)
	providerInitial := providerStateOwnershipSnapshot(provider)
	prepared := readProviderStateBag(providerShared, "item", false, newProviderStateFieldMetadata(provider.fieldDefs), 100, providerStateReadOptions{})
	if prepared == provider || math.Float64bits(prepared.state["stacks"]) != math.Float64bits(negativeZero) || prepared.expireAt["stacks"] != 0 || prepared.targetValues["hits"] != 3 || prepared.targetExpireAt["hits"] != 100 {
		t.Fatal("source expiry lost default bits or expired the unrequested target scope")
	}
	assertProviderStateOwnershipView(t, "source after provider expiry", provider, providerInitial)
}
