package status

import "testing"

func TestProviderExpired(t *testing.T) {
	inst := ProviderInstance{ExpireAt: 500}
	if !inst.Expired(500) {
		t.Fatal("expected expired at boundary")
	}
	if inst.Expired(499) {
		t.Fatal("expected not expired before boundary")
	}
	never := ProviderInstance{ExpireAt: 0}
	if never.Expired(1000) {
		t.Fatal("zero expireAt should never expire")
	}
}

func TestFindAndRemoveByRef(t *testing.T) {
	list := []ProviderInstance{
		{ProviderRef: "a"},
		{ProviderRef: "b"},
	}
	_, idx, ok := FindByRef(list, "b")
	if !ok || idx != 1 {
		t.Fatalf("find idx=%d ok=%v", idx, ok)
	}
	list = RemoveByRef(list, "a")
	if len(list) != 1 || list[0].ProviderRef != "b" {
		t.Fatalf("remove result=%+v", list)
	}
}
