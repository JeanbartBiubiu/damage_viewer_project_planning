package effect

import "testing"

func TestTimeStateRetainsRegisteredIdentityAndSameTimeTerminalMultiplicity(t *testing.T) {
	var state TimeState
	first := state.RegisterExpiry(ExpiryPayload{Kind: "provider", ProviderRef: "one", ExpectedExpireAt: 100})
	second := state.RegisterExpiry(ExpiryPayload{Kind: "shield", ShieldRef: "two", ExpectedExpireAt: 100})
	anchor := state.RegisterAnchored(AnchoredPayload{OwnerKey: "target", ProviderRef: "three", Generation: 9, ExpectedExpireAt: 100})
	if first != 0 || second != 1 || anchor != 0 || state.ExpiryAt(first).ProviderRef != "one" || state.AnchoredAt(anchor).Generation != 9 {
		t.Fatal("registered payload indices or identities changed")
	}
	state.AddTerminal(100)
	state.AddTerminal(100)
	state.AddTerminal(200)
	state.DecrementTerminal(100)
	if state.TerminalCount(100) != 1 || state.TerminalCount(200) != 1 {
		t.Fatal("one same-time completion consumed another terminal")
	}
	state.DecrementTerminal(100)
	if state.TerminalCount(100) != 0 || !state.HasTerminals() {
		t.Fatal("completed terminal erased another deadline")
	}
	state.ClearTerminal(200)
	if state.HasTerminals() || state.ExpiryCount() != 2 || state.AnchoredCount() != 1 {
		t.Fatal("terminal cleanup erased registered history")
	}
}

func TestTimeStatePayloadRegistrationKeepsTerminalIndexUnallocated(t *testing.T) {
	var state TimeState
	state.RegisterExpiry(ExpiryPayload{Kind: "provider", ExpectedExpireAt: 100})
	state.RegisterAnchored(AnchoredPayload{ExpectedExpireAt: 100})
	if state.terminal != nil {
		t.Fatal("payload preparation allocated or granted a queued terminal")
	}
	// 只有统一排程成功后的显式事实才能建立终点索引。
	state.AddTerminal(100)
	if state.terminal == nil || state.TerminalCount(100) != 1 {
		t.Fatal("committed terminal was not recorded")
	}
}
