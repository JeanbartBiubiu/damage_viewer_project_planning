package listener

import (
	"testing"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestEventMatchUsesDeclaredOwnerRelationsWithoutChangingBaseTypes(t *testing.T) {
	registry := typeset.NewRegistry()
	sourceOwner, _ := registry.Intern("event/source_owner")
	event, _ := registry.Intern("event/damage")
	sourceOpponent, _ := registry.Intern("event/source_opponent")
	targetOwner, _ := registry.Intern("event/target_owner")
	bindings := planbundle.RuntimeTypeBindings{
		SourceOwner:    planbundle.DeclaredType{ID: sourceOwner, Declared: true},
		SourceOpponent: planbundle.DeclaredType{ID: sourceOpponent, Declared: true},
		TargetOwner:    planbundle.DeclaredType{ID: targetOwner, Declared: true},
	}
	var base typeset.TypeSet
	base.Add(event)
	facts := EventMatchFacts{SourceKey: "source", TargetKey: "target", Types: base, MountLive: true}
	for _, tc := range []struct {
		owner string
		all   []string
	}{{"source", []string{"event/damage", "event/source_owner"}}, {"target", []string{"event/damage", "event/source_opponent", "event/target_owner"}}} {
		matcher, unknown := typeset.CompileMatcher(model.TypeMatcherV2{All: tc.all}, registry)
		if len(unknown) != 0 || !Matches(planbundle.CompiledListener{OwnerCombatantKey: tc.owner, EventMatcher: matcher}, facts, bindings) {
			t.Fatalf("owner relation did not match: %+v, unknown=%v", tc, unknown)
		}
	}
	matcher, _ := typeset.CompileMatcher(model.TypeMatcherV2{All: []string{"event/source_owner"}}, registry)
	definition := planbundle.CompiledListener{OwnerCombatantKey: "source", EventMatcher: matcher}
	bindings.SourceOwner.Declared = false
	if Matches(definition, facts, bindings) || facts.Types != base || facts.Types.Contains(sourceOwner) || sourceOwner != 0 {
		t.Fatal("undeclared zero type was added or owner matching mutated the base event")
	}
	facts.MountLive = false
	if Matches(planbundle.CompiledListener{}, facts, bindings) {
		t.Fatal("matching admitted an inactive mount")
	}
}

func TestSpellShieldBlockedMatchRetainsActualShieldOwner(t *testing.T) {
	facts := EventMatchFacts{EventType: model.EventTypeSpellShieldBlocked, MountLive: true, HasBlockedHit: true, ShieldOwner: "target", ShieldProviderRef: "shield"}
	definition := planbundle.CompiledListener{OwnerCombatantKey: "target", OwnerProviderRef: "shield"}
	if !Matches(definition, facts, planbundle.RuntimeTypeBindings{}) {
		t.Fatal("actual blocking shield did not receive its event")
	}
	definition.OwnerProviderRef = "other"
	if Matches(definition, facts, planbundle.RuntimeTypeBindings{}) {
		t.Fatal("blocked event reached another shield mount")
	}
	definition.OwnerProviderRef, definition.OwnerCombatantKey = "shield", "source"
	if Matches(definition, facts, planbundle.RuntimeTypeBindings{}) {
		t.Fatal("blocked event reached a shield owned by another actor")
	}
	if !Matches(planbundle.CompiledListener{}, facts, planbundle.RuntimeTypeBindings{}) {
		t.Fatal("ownerless rule listener acquired a shield-only restriction")
	}
}

func TestListenerCombatantMappingPreservesInitializationAndSelfTarget(t *testing.T) {
	for _, tc := range []struct {
		eventType, source, target, owner string
		wantSource, wantTarget           string
	}{
		{model.EventTypeSourceInitialized, "source", "target", "target", "source", "target"},
		{"event/damage", "source", "target", "target", "target", "source"},
		{"event/damage", "target", "source", "source", "source", "target"},
		{"event/damage", "source", "target", "", "source", "target"},
	} {
		source, target := Combatants(tc.eventType, tc.source, tc.target, tc.owner)
		if source != tc.wantSource || target != tc.wantTarget {
			t.Fatalf("combatant mapping changed for %+v: %s/%s", tc, source, target)
		}
	}
}
