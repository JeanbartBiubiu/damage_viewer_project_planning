package admission

import (
	"testing"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func initializedSpellShield(t *testing.T) (Input, *initialSourceFixture) {
	t.Helper()
	fail := func(code model.GenericErrCode, path, message, ref string) {
		t.Fatalf("catalog %s %s %s %s", code, path, message, ref)
	}
	catalog := typeset.CompileTypeCatalog(model.TypeCatalog{Types: []model.TypeCatalogEntry{
		{Key: model.EventTypeSourceInitialized, Domain: "event"}, {Key: model.EventTypeSpellShieldBlocked, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"}, {Key: model.ProviderTypeSpellShield, Domain: "provider"},
	}}, fail)
	initialized, _ := catalog.Registry.Lookup(model.EventTypeSourceInitialized)
	owner, _ := catalog.Registry.Lookup("event/source_owner")
	spell, _ := catalog.Registry.Lookup(model.ProviderTypeSpellShield)
	listener := planbundle.CompiledListener{ListenerKey: "initialize", SourceAbilityIndex: 0, OperationCount: 1, MaxTriggersPerEvent: 1,
		EventMatcher: typeset.CompileGenericMatcher(model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}}, catalog, typeset.EntityListener, "init", fail)}
	consume := planbundle.CompiledListener{ListenerKey: "consume", SourceAbilityIndex: -1, OperationStart: 1, OperationCount: 1, MaxTriggersPerEvent: 1,
		EventMatcher: typeset.CompileGenericMatcher(model.TypeMatcher{All: []string{model.EventTypeSpellShieldBlocked}}, catalog, typeset.EntityListener, "consume", fail)}
	bound := listener
	bound.OwnerCombatantKey = "source"
	bound.OwnerProviderRef = "guard"
	var spellTypes typeset.TypeSet
	spellTypes.Add(spell)
	compiled := &planbundle.CompiledSession{Types: catalog, RuntimeTypes: planbundle.RuntimeTypeBindings{SourceInitialized: planbundle.DeclaredType{ID: initialized, Declared: true}, SourceOwner: planbundle.DeclaredType{ID: owner, Declared: true}, SpellShield: planbundle.DeclaredType{ID: spell, Declared: true}},
		Combatants: []planbundle.CompiledCombatant{{Key: "source", ProviderMounts: []planbundle.CompiledProviderMount{{ProviderRef: "guard", DefinitionIndex: 0}}}},
		Abilities:  []planbundle.CompiledAbility{{Kind: "passive_listener", SkillKey: "guard_skill", ProviderIndex: 0}},
		Providers: []planbundle.CompiledProvider{
			{ProviderKey: "parent", Kind: "item", StableID: "item", SkillKey: "guard_skill", AbilityCount: 1, Listeners: []planbundle.CompiledListener{listener}},
			{ProviderKey: "shield", Kind: "status", StableID: "shield", SkillKey: "guard_skill", TypeSet: spellTypes,
				Lifecycle: &planbundle.CompiledProviderLifecycle{MaxStacks: 1, RefreshPolicy: "replace"}, Listeners: []planbundle.CompiledListener{consume}},
		}, Listeners: []planbundle.CompiledListener{bound}, Operations: []planbundle.CompiledOperation{
			{Operation: "apply_provider", Target: "self", OwnerProviderIndex: 0, ProviderDefinitionRef: "shield", ProviderRef: "own_shield"},
			{Operation: "expire_provider", Target: "self", OwnerProviderIndex: 1, ProviderRefFromEvent: true},
		},
	}
	input := Input{Compiled: compiled}
	reads := &initialSourceFixture{input: input, matched: true, provider: InitialProvider{Present: true, DefinitionIndex: 0, DefinitionRef: "parent", Source: "source", Owner: "source", Stacks: 1}}
	return input, reads
}

func TestOwnedSpellShieldInitializationKeepsCompleteFrozenClosure(t *testing.T) {
	input, reads := initializedSpellShield(t)
	if err := ValidateStaticInitializer(input, input.Compiled.Providers[0], "source", "guard", reads); err != nil {
		t.Fatalf("valid frozen shield initialization rejected: %+v", err)
	}
	if err := ValidateStaticInitializationListener(input, input.Compiled.Listeners[0], reads); err != nil {
		t.Fatalf("valid frozen shield initialization listener rejected: %+v", err)
	}
	input.Compiled.Abilities[0].OperationStart = input.Compiled.Listeners[0].OperationStart
	input.Compiled.Abilities[0].OperationCount = input.Compiled.Listeners[0].OperationCount
	if !ownedSpellShieldInitializer(input, input.Compiled.Providers[0], "source", "guard", reads) {
		t.Fatal("shared inline operation range rejected")
	}
	for _, kind := range []string{"extra_parent_listener", "extra_parent_operation", "independent_ability_operation", "parent_state", "foreign_mount", "child_modifier", "child_duration", "static_remove", "missing_freeze", "child_condition", "conflicting_matcher", "extra_required_event", "extra_any_event", "wrong_skill", "unbound_parent"} {
		t.Run(kind, func(t *testing.T) {
			input, reads := initializedSpellShield(t)
			session := input.Compiled
			switch kind {
			case "extra_parent_listener":
				session.Providers[0].Listeners = append(session.Providers[0].Listeners, session.Providers[0].Listeners[0])
			case "extra_parent_operation":
				session.Listeners[0].OperationCount++
			case "independent_ability_operation":
				session.Abilities[0].OperationStart = 1
				session.Abilities[0].OperationCount = 1
			case "parent_state":
				session.Providers[0].StateFields = map[string]planbundle.CompiledProviderStateField{"x": {}}
			case "foreign_mount":
				session.Combatants[0].ProviderMounts[0].ProviderRef = "other"
			case "child_modifier":
				session.Providers[1].Modifiers = []planbundle.CompiledModifier{{}}
			case "child_duration":
				session.Providers[1].Lifecycle.HasDuration = true
			case "static_remove":
				session.Operations[1].ProviderRef = "another_shield"
			case "missing_freeze":
				session.Operations[1].ProviderRefFromEvent = false
			case "child_condition":
				session.Providers[1].Listeners[0].HasCondition = true
			case "conflicting_matcher", "extra_required_event", "extra_any_event":
				matcher := model.TypeMatcherV2{All: []string{model.EventTypeSpellShieldBlocked}}
				if kind == "conflicting_matcher" {
					matcher.None = []string{model.EventTypeSpellShieldBlocked}
				} else if kind == "extra_required_event" {
					matcher.All = append(matcher.All, model.EventTypeSourceInitialized)
				} else {
					matcher.Any = []string{model.EventTypeSourceInitialized}
				}
				compiled, problems := typeset.CompileDomainMatcher(matcher, session.Types.Registry, "event")
				if len(problems) != 0 {
					t.Fatal(problems)
				}
				session.Providers[1].Listeners[0].EventMatcher = compiled
			case "wrong_skill":
				session.Providers[1].SkillKey = "foreign"
			case "unbound_parent":
				session.Listeners = nil
			}
			if ownedSpellShieldInitializer(input, session.Providers[0], "source", "guard", reads) {
				t.Fatalf("invalid closure accepted: %s", kind)
			}
			if len(session.Listeners) != 0 && ownedSpellShieldInitializationListener(input, session.Listeners[0], reads) {
				t.Fatalf("invalid listener closure accepted: %s", kind)
			}
		})
	}
	entry := input.Compiled.Listeners[0]
	entry.HasCondition = true
	if ownedSpellShieldInitializationListener(input, entry, reads) {
		t.Fatal("listener override accepted despite its extra condition")
	}
}
