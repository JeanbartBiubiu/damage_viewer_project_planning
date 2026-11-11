package lifecycle

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func TestFrozenShieldRemovalKeepsOwnerThenLiveInstanceThenDefinitionPriority(t *testing.T) {
	input := FrozenShieldRemoval{AbilityRef: "ability", ListenerOwner: "source", ListenerRef: "wrong", Source: "source", SessionID: "session",
		Event: &contract.EventSnapshot{EventType: model.EventTypeSpellShieldBlocked, SkillHit: &contract.SkillHitFacts{ShieldOwner: "target", ShieldProviderRef: "shield", ShieldDefinitionRef: "declared"}}}
	if _, err := PrepareFrozenShieldRemoval(input); err == nil || err.Message != "listener owner must equal the frozen spell shield bearer" || err.Path != "wrong" || err.Ref != "source" {
		t.Fatal(err)
	}
	input.ListenerOwner = "target"
	if _, err := PrepareFrozenShieldRemoval(input); err == nil || err.Message != "frozen spell shield owner is missing" {
		t.Fatal(err)
	}
	input.OwnerPresent = true
	if _, err := PrepareFrozenShieldRemoval(input); err == nil || err.Message != "frozen spell shield instance is missing" {
		t.Fatal(err)
	}
	input.Providers = effectpkg.Providers([]effectpkg.Provider{{ProviderRef: "shield", DefinitionRef: "actual"}})
	if _, err := PrepareFrozenShieldRemoval(input); err == nil || err.Message != "frozen spell shield definitionRef mismatch" || err.Ref != "actual" || err.SessionID != "session" {
		t.Fatal(err)
	}
	input.Event.SkillHit.ShieldDefinitionRef = "actual"
	if _, err := PrepareFrozenShieldRemoval(input); err == nil || err.Message != "listener providerRef must equal the frozen shield instance" {
		t.Fatal(err)
	}
	input.ListenerRef = "shield"
	mutation, err := PrepareFrozenShieldRemoval(input)
	if err != nil || mutation.Kind != "expire" || !mutation.Strict || mutation.TargetKey != "target" || mutation.SourceKey != "source" || mutation.ProviderRef != "shield" || input.Providers.Len() != 1 {
		t.Fatal(mutation, err)
	}
}
