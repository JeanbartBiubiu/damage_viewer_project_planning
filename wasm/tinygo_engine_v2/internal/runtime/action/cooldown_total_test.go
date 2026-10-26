package action

import "testing"

func TestTotalCooldownLedgerPreservesOnlyTheRealActiveOrdinaryCommit(t *testing.T) {
	id := AbilityCooldownIdentity("source", "source.provider[x].ability[initial]")
	ledger := NewCooldownLedger()
	ledger.CommitOrdinary(id, 12000, 0)
	for _, ready := range []int64{11400, 13000, 5000} {
		ledger.Set(id, ready, 100)
		entry := ledger.EntryValue(id)
		if !entry.HasOrdinaryTotal || entry.OrdinaryTotalMs != 12000 {
			t.Fatal("deadline edit lost committed base", entry)
		}
	}
	clone := ledger.Clone()
	clone.Reset(id, 200)
	if clone.EntryValue(id).HasOrdinaryTotal || !ledger.EntryValue(id).HasOrdinaryTotal {
		t.Fatal("reset or staged isolation", clone.EntryValue(id), ledger.EntryValue(id))
	}
	ledger.CommitOrdinary(id, 3200, 200)
	if ledger.EntryValue(id).OrdinaryTotalMs != 3000 {
		t.Fatal("new real commit did not replace old total", ledger.EntryValue(id))
	}
	ledger.Set(id, 10000, 4000)
	if ledger.EntryValue(id).HasOrdinaryTotal {
		t.Fatal("expiry was resurrected as a real base", ledger.EntryValue(id))
	}
}
