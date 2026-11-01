package effect

import "testing"

func TestRemoveExpiredShieldRefKeepsRefreshedAndUnrelatedInstances(t *testing.T) {
	original := Shields([]Shield{
		{ShieldRef: "same", ExpireAt: 50, Remaining: 10},
		{ShieldRef: "same", ExpireAt: 100, Remaining: 20},
		{ShieldRef: "other", ExpireAt: 50, Remaining: 30},
		{ShieldRef: "depleted", Remaining: 0},
	})
	filtered := original.RemoveExpiredRef("same", 50)
	if original.Len() != 4 || original.At(0).Remaining != 10 ||
		filtered.Len() != 3 || filtered.At(0).ShieldRef != "same" || filtered.At(0).Remaining != 20 ||
		filtered.At(1).ShieldRef != "other" || filtered.At(2).ShieldRef != "depleted" {
		t.Fatal("an old expiry changed a newer shield, another reference, or the prior list", original.Snapshot(), filtered.Snapshot())
	}
	if filtered.HasExpiredRef("same", 50) || !filtered.HasExpiredRef("same", 100) || filtered.HasExpiredRef("depleted", 100) {
		t.Fatal("shield expiry lookup changed actual expiry semantics")
	}
}
