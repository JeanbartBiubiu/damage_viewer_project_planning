package effect

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

// TestProviderTargetStateMixedScopeFormulaOverlayNoLeak: formula overlay must expose only
// specifically seeded/written target keys — never inject untouched provider-scope fieldDefs
// defaults into ProviderTargetState.
func TestProviderTargetStateMixedScopeFormulaOverlayNoLeak(t *testing.T) {
	const (
		providerOnlyDef = 7.0
		targetKeyDef    = 3.0
	)
	bag := &bagData{}
	bag.bindFieldDefs(NewFields(map[string]FieldDefinition{
		"provider_only": {
			DefaultValue: providerOnlyDef,
		},
		"target_key": {
			DefaultValue:  targetKeyDef,
			MaxValue:      10,
			HasCap:        true,
			DurationMs:    1000,
			RefreshPolicy: model.ProviderStateRefreshOnWrite,
		},
	}))
	if bag.state["provider_only"] != providerOnlyDef {
		t.Fatalf("provider_only seeded in state=%v want %v", bag.state["provider_only"], providerOnlyDef)
	}
	if _, exists := bag.targetValues["provider_only"]; exists {
		t.Fatalf("bindFieldDefs must not seed provider_only into targetValues: %+v", bag.targetValues)
	}

	bag.activateProviderTarget("target")
	if overlay := bag.targetStateForFormula(); len(overlay) != 0 {
		t.Fatalf("before touch formula overlay must be empty, got %+v", overlay)
	}

	if got := bag.readTargetValue("target_key"); got != targetKeyDef {
		t.Fatalf("read before seed target_key=%v want default %v", got, targetKeyDef)
	}
	bag.seedTargetValueIfAbsent("target_key")
	next, ok := ApplyStatePolicy(bag.readTargetValue("target_key"), 1, "add")
	if !ok {
		t.Fatal("applyStatePolicy failed")
	}
	bag.targetValues["target_key"] = bag.clampProviderStateValue("target_key", next)
	if bag.targetValues["target_key"] != targetKeyDef+1 {
		t.Fatalf("first add target_key=%v want %v", bag.targetValues["target_key"], targetKeyDef+1)
	}

	overlay := bag.targetStateForFormula()
	if got, ok := overlay["target_key"]; !ok || got != targetKeyDef+1 {
		t.Fatalf("formula overlay target_key=%v ok=%v want %v", got, ok, targetKeyDef+1)
	}
	if _, leaked := overlay["provider_only"]; leaked {
		t.Fatalf("provider_only must not leak into formula overlay: %+v", overlay)
	}
	if len(overlay) != 1 {
		t.Fatalf("formula overlay keys=%d want 1 (only touched target_key): %+v", len(overlay), overlay)
	}

	bag.refreshTargetExpireAtOnWrite("target_key", 0)
	bag.lazyExpireProviderTargetState(1000)
	if bag.targetValues["target_key"] != targetKeyDef {
		t.Fatalf("after expire target_key=%v want default %v", bag.targetValues["target_key"], targetKeyDef)
	}
	overlay = bag.targetStateForFormula()
	if got, ok := overlay["target_key"]; !ok || got != targetKeyDef {
		t.Fatalf("after expire formula overlay target_key=%v ok=%v want %v", got, ok, targetKeyDef)
	}
	if _, leaked := overlay["provider_only"]; leaked {
		t.Fatalf("after expire provider_only must not leak into formula overlay: %+v", overlay)
	}
	if bag.state["provider_only"] != providerOnlyDef {
		t.Fatalf("provider-scope state must stay untouched: provider_only=%v want %v", bag.state["provider_only"], providerOnlyDef)
	}
}
