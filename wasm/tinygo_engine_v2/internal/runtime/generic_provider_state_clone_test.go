package runtime

import (
	"strconv"
	"testing"
)

func TestProviderStateCloneAliasedInputKeepsEachEntryIndependent(t *testing.T) {
	original := providerStateOwnershipBag()
	original.setInclusiveAtExpiryHold("target", "hits")
	source := map[string]*providerStateBag{"first": original, "second": original}
	cloned := cloneProviderStateMap(source)
	first, second := cloned["first"], cloned["second"]
	if first == original || second == original || first == second {
		t.Fatal("each cloned entry must have its own mutable bag head")
	}
	initial := providerStateOwnershipSnapshot(original)
	next := cloneProviderStateMap(cloned)
	write := func(bag *providerStateBag, value float64, target string) {
		bag.writableState()["stacks"] = value
		bag.writableExpireAt()["stacks"] = int64(value * 100)
		bag.writableTargetValues()["hits"] = value + 1
		bag.writableTargetExpireAt()["hits"] = int64(value*100 + 1)
		bag.writableAnchoredTickGeneration()["hits"] = uint64(value + 2)
		bag.targetKey = target
		bag.setInclusiveAtExpiryHold(target, "hits")
	}
	write(first, 10, "first-target")
	firstWritten := providerStateOwnershipSnapshot(first)
	assertProviderStateOwnershipView(t, "source after first entry writes", original, initial)
	assertProviderStateOwnershipView(t, "aliased sibling after first entry writes", second, initial)
	assertProviderStateOwnershipView(t, "next first entry", next["first"], initial)
	assertProviderStateOwnershipView(t, "next second entry", next["second"], initial)

	write(second, 20, "second-target")
	secondWritten := providerStateOwnershipSnapshot(second)
	write(original, 30, "source-target")
	assertProviderStateOwnershipView(t, "first after sibling and source writes", first, firstWritten)
	assertProviderStateOwnershipView(t, "second after source writes", second, secondWritten)
	assertProviderStateOwnershipView(t, "next first after all writes", next["first"], initial)
	assertProviderStateOwnershipView(t, "next second after all writes", next["second"], initial)
	if source["first"] != original || source["second"] != original {
		t.Fatal("clone replaced source map entries")
	}
}

func TestProviderStateCloneNilBagsStayIndependentAndWritable(t *testing.T) {
	source := map[string]*providerStateBag{"first": nil, "second": nil}
	cloned := cloneProviderStateMap(source)
	first, second := cloned["first"], cloned["second"]
	if first == nil || second == nil || first == second {
		t.Fatal("nil entries must become distinct writable bags")
	}
	for key, bag := range cloned {
		if bag.state == nil || bag.expireAt == nil || bag.fieldDefs == nil || bag.targetValues == nil || bag.targetExpireAt == nil || bag.anchoredTickGeneration == nil {
			t.Fatalf("%s lost initialized maps", key)
		}
	}
	initial := providerStateOwnershipSnapshot(second)
	first.writableState()["stacks"] = 2
	first.writableExpireAt()["stacks"] = 100
	first.writableTargetValues()["hits"] = 3
	first.writableTargetExpireAt()["hits"] = 101
	first.writableAnchoredTickGeneration()["hits"] = 4
	first.fieldDefs["stacks"] = providerStateFieldDef{defaultValue: 5}
	first.targetKey = "target"
	first.setInclusiveAtExpiryHold("target", "hits")
	assertProviderStateOwnershipView(t, "nil sibling", second, initial)
	if len(second.fieldDefs) != 0 || source["first"] != nil || source["second"] != nil {
		t.Fatal("initializing or writing a cloned nil bag changed another entry")
	}

	// 外层条目移除后，已借出的包头仍是独立有效的版本。
	delete(cloned, "first")
	first.writableState()["stacks"] = 6
	cloned["third"] = &providerStateBag{}
	if len(source) != 2 || first.state["stacks"] != 6 {
		t.Fatal("outer map mutation affected source or borrowed bag")
	}
	assertProviderStateOwnershipView(t, "remaining nil sibling", second, initial)
}

func TestProviderStateCloneEmptyInputReturnsIndependentWritableMaps(t *testing.T) {
	for _, source := range []map[string]*providerStateBag{nil, {}} {
		first, second := cloneProviderStateMap(source), cloneProviderStateMap(source)
		if first == nil || second == nil {
			t.Fatal("empty clone must return a writable non-nil map")
		}
		first["new"] = providerStateOwnershipBag()
		if len(source) != 0 || len(second) != 0 {
			t.Fatal("empty clone maps share writable entries")
		}
	}
}

var providerStateCloneBenchmarkResult map[string]*providerStateBag

func BenchmarkProviderStateCloneTwelveBags(b *testing.B) {
	source := make(map[string]*providerStateBag, 12)
	for index := 0; index < 12; index++ {
		source[strconv.Itoa(index)] = providerStateOwnershipBag()
	}
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		providerStateCloneBenchmarkResult = cloneProviderStateMap(source)
	}
}
