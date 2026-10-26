package effect

import "tinygo_engine_v2/internal/runtime/contract"

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestInternalCooldownDoesNotGuessOrdinaryTTLFromName(t *testing.T) {
	bag := &bagData{}
	bag.bindFieldDefs(NewFields(map[string]FieldDefinition{
		"cooldown": {DefaultValue: 0, MaxValue: 1, HasCap: true, DurationMs: 1000, RefreshPolicy: model.ProviderStateRefreshOnWrite},
		"marked":   {StateKind: model.ProviderStateKindCooldown, DefaultValue: 0, MaxValue: 1, HasCap: true, DurationMs: 1000, RefreshPolicy: model.ProviderStateRefreshStartOnFirstWrite},
		"ammo":     {StateKind: model.ProviderStateKindAmmo, DefaultValue: 5, MaxValue: 5, HasCap: true},
	}))
	bag.writableState()["cooldown"] = 1
	if !bag.refreshExpireAtOnWrite("cooldown", 100) || bag.expireAt["cooldown"] != 1100 || bag.refreshExpireAtOnWrite("marked", 100) {
		t.Fatal("unmarked ordinary TTL or marked CD used the wrong writer")
	}
	ledger := contract.BorrowCooldownView(nil, nil, 0)
	bag.projectInternalCooldowns(ledger, "source", "mounted", 100)
	if bag.state["cooldown"] != 1 || bag.state["ammo"] != 5 || ledger.Len() != 0 {
		t.Fatal("ordinary state or ammo became a CD")
	}
}
