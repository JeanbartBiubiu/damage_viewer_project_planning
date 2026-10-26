package action

import (
	"fmt"
	"testing"

	"tinygo_engine_v2/internal/runtime/contract"
)

func TestCooldownViewKeepsPresenceAndFrozenIndexedSlots(t *testing.T) {
	var absent *CooldownLedger
	if absent.View().Present() || absent.View().Len() != 0 || absent.View().Revision() != 0 {
		t.Fatal("absent ledger became present")
	}
	base := NewCooldownLedger()
	if !base.View().Present() {
		t.Fatal("empty ledger lost presence")
	}
	var first contract.CooldownIdentity
	for index := 0; index < 17; index++ {
		id := StateCooldownIdentity("source", "mounted", fmt.Sprint(index), stateScopeProvider, "")
		if index == 0 {
			first = id
		}
		base.Set(id, int64(1000+index), 0)
	}
	frozen := base.View()
	branch := base.Clone()
	branch.Set(first, 500, 100)
	branch.Set(StateCooldownIdentity("source", "mounted", "appended", stateScopeProvider, ""), 3000, 100)
	entry, exists := frozen.Lookup(first)
	if !exists || entry.ReadyAt != 1000 || frozen.Len() != 17 || frozen.Remaining(first, 999) != 1 || frozen.Remaining(first, 1000) != 0 {
		t.Fatal("frozen view followed a staged edit", entry)
	}
	id, original := frozen.At(0)
	original.ReadyAt = 0
	again, exists := frozen.Lookup(id)
	if !exists || again.ReadyAt != 1000 {
		t.Fatal("a returned entry changed its ledger", again)
	}
	if _, exists := frozen.Lookup(contract.CooldownIdentity{StateKey: "missing"}); exists {
		t.Fatal("missing identity became slot zero")
	}
}
