package effect

import "testing"

// 原注册表与包头不变量随实现迁移，保持原先的零分配和隔离断言。
func TestProviderStateOuterReadonlyBorrowAndFirstWrite(t *testing.T) {
	bag := providerStateOwnershipBag()
	bag.fieldDefaults = map[string]float64{"stacks": 0}
	original := BagState{bags: map[string]*bagData{"attack": bag}}
	frame := StageBags(&original)
	initial := providerStateOwnershipSnapshot(bag)
	if count := testing.AllocsPerRun(100, func() {
		if got := frame.PrepareRead("attack", false, nil, 0, ReadOptions{}); got.data != bag {
			t.Fatal("prepared read copied a header")
		}
		if frame.PrepareRead("missing", false, nil, 0, ReadOptions{}).Present() {
			t.Fatal("missing read inserted a bag")
		}
	}); count != 0 {
		t.Fatalf("readonly borrowing allocated %v", count)
	}
	owned := frame.Edit("attack", false)
	owned.SetStateValue("stacks", 33)
	frame.Edit("created", true)
	if frame.state.shared || original.Len() != 1 || original.Lookup("attack").data != bag || owned.data == bag || frame.Len() != 2 {
		t.Fatal("first write did not detach outer and header")
	}
	assertProviderStateOwnershipView(t, "original after first write", bag, initial)
	view := frame.Publish()
	frame.Remove("created")
	if view.Len() != 2 || frame.Len() != 1 {
		t.Fatal("post-publication delete changed old outer view")
	}
}

func TestProviderStateOuterNilNormalizationKeepsLiveSource(t *testing.T) {
	original := BagState{bags: map[string]*bagData{"empty": nil}}
	staged := StageBags(&original)
	empty := staged.Lookup("empty")
	if original.bags["empty"] != nil || !empty.Present() || !empty.data.headerShared {
		t.Fatal("nil normalization changed live source or published an owned header")
	}
	published := staged.Publish()
	owned := staged.Edit("empty", false)
	owned.SetStateValue("new", 1)
	if owned.data == empty.data || published.Lookup("empty") != empty || empty.State().Len() != 0 {
		t.Fatal("normalized empty header was writable across publication")
	}
}
