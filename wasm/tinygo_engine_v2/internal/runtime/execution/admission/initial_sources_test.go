package admission

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type initialSourceFixture struct {
	input      Input
	normalized string
	driver     string
	matched    bool
	sources    ListenerSources
	provider   InitialProvider
	visits     []string
}

func (r *initialSourceFixture) InitialAbilityReference(reference, source, target string) string {
	r.visits = append(r.visits, "reference")
	return r.normalized
}
func (r *initialSourceFixture) InitialListenerMatches(listener planbundle.CompiledListener, event, source, target string, types typeset.TypeSet) bool {
	r.visits = append(r.visits, "match")
	return r.matched
}
func (r *initialSourceFixture) InitialProviderView(owner, reference string) InitialProvider {
	r.visits = append(r.visits, "provider")
	return r.provider
}
func (r *initialSourceFixture) InitialListenerSources(listener planbundle.CompiledListener) ListenerSources {
	r.visits = append(r.visits, "sources")
	return r.sources
}
func (r *initialSourceFixture) InitialActors(owner string) [2]Actor {
	r.visits = append(r.visits, "actors")
	return r.input.Actors
}
func (r *initialSourceFixture) InitialDriverReference(entry model.DriverEntry) string {
	r.visits = append(r.visits, "driver")
	return r.driver
}

func initialSourceListener(t *testing.T, event string) (Input, planbundle.CompiledListener, *initialSourceFixture) {
	t.Helper()
	addError := func(code model.GenericErrCode, path, message, reference string) {
		t.Fatalf("catalog: %s %s %s %s", code, path, message, reference)
	}
	catalog := typeset.CompileTypeCatalog(model.TypeCatalog{Types: []model.TypeCatalogEntry{
		{Key: model.EventTypeBasicAttackStart, Domain: "event"},
		{Key: model.EventTypeSourceInitialized, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
	}}, addError)
	start, _ := catalog.Registry.Lookup(model.EventTypeBasicAttackStart)
	initialized, _ := catalog.Registry.Lookup(model.EventTypeSourceInitialized)
	owner, _ := catalog.Registry.Lookup("event/source_owner")
	compiled := &planbundle.CompiledSession{RuntimeTypes: planbundle.RuntimeTypeBindings{
		BasicAttackStart:  planbundle.DeclaredType{ID: start, Declared: true},
		SourceInitialized: planbundle.DeclaredType{ID: initialized, Declared: true},
		SourceOwner:       planbundle.DeclaredType{ID: owner, Declared: true},
	}}
	input := Input{Compiled: compiled, Formulas: &formula.Library{}, Identity: Identity{SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}}
	listener := planbundle.CompiledListener{ListenerKey: "listener", OwnerCombatantKey: "source", OwnerProviderRef: "selected", MaxTriggersPerEvent: 1,
		EventMatcher: typeset.CompileGenericMatcher(model.TypeMatcher{All: []string{event, "event/source_owner"}}, catalog, typeset.EntityListener, "matcher", addError)}
	return input, listener, &initialSourceFixture{input: input, matched: true}
}

func idleInitialSource(t *testing.T) (Input, planbundle.CompiledProvider, *initialSourceFixture) {
	t.Helper()
	input, listener, reads := initialSourceListener(t, model.EventTypeBasicAttackStart)
	listener.HasAbilityRef, listener.AbilityRef = true, "self.provider[selected].ability[initial]"
	input.Compiled.Listeners = []planbundle.CompiledListener{listener}
	input.Compiled.Operations = []planbundle.CompiledOperation{{Operation: model.OperationKindResolveSkillHit}}
	input.Compiled.Abilities = []planbundle.CompiledAbility{
		{AbilityKey: "start", IsBasicAttack: true, SkillKey: "attack", Kind: "active"},
		{AbilityKey: "initial", IsBasicAttack: true, SkillKey: "attack", Kind: "active", ProcessControl: &planbundle.CompiledProcessControl{ProcessControlDefinition: model.ProcessControlDefinition{Action: "INITIAL", UseRefFromEvent: true}}},
		{AbilityKey: "hit", IsBasicAttack: true, SkillKey: "attack", Kind: "active", HasSkillHit: true, OperationCount: 1},
	}
	provider := planbundle.CompiledProvider{AbilityCount: 3, Processes: []planbundle.CompiledProcess{{SkillKey: "attack", Cooldown: &planbundle.CompiledProcessCooldown{RoundPositiveMs: true, StartMoment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}}}}}
	reads.normalized = "source.provider[selected].ability[initial]"
	return input, provider, reads
}

func TestInitialIdleSourceKeepsFirstErrorAndUniqueListener(t *testing.T) {
	input, provider, reads := idleInitialSource(t)
	if err := ValidateIdleBasicAttackProvider(input, provider, "source", "selected", true, reads); err != nil {
		t.Fatalf("complete idle source rejected: %+v", err)
	}
	input.Compiled.Listeners = append(input.Compiled.Listeners, input.Compiled.Listeners[0])
	requireSourceAdmissionError(t, ValidateIdleBasicAttackProvider(input, provider, "source", "selected", true, reads), "idle opponent binding must contain its complete static basic attack and unique owner-start listener", "initialSnapshot.combatants.providers")
	reads.visits = nil
	provider.AbilityCount = 2
	requireSourceAdmissionError(t, ValidateIdleBasicAttackProvider(input, provider, "source", "selected", true, reads), "idle opponent binding must contain its complete static basic attack and unique owner-start listener", "initialSnapshot.combatants.providers")
	if len(reads.visits) != 0 {
		t.Fatal("invalid abilities reached later listener reads", reads.visits)
	}
}

func TestInitialStaticListenerKeepsShortCircuitAndOperationError(t *testing.T) {
	input, listener, reads := initialSourceListener(t, model.EventTypeSourceInitialized)
	listener.OperationCount = 1
	input.Compiled.Operations = []planbundle.CompiledOperation{{Operation: "damage", Path: "operations.first"}}
	listener.HasCondition = true
	requireSourceAdmissionError(t, ValidateStaticInitializationListener(input, listener, reads), "this stage accepts only unconditional owner source initialization listeners", "listeners.listener")
	if len(reads.visits) != 0 {
		t.Fatal("invalid header reached matching or state reads", reads.visits)
	}
	listener.HasCondition = false
	requireSourceAdmissionError(t, ValidateStaticInitializationListener(input, listener, reads), "initialization may only mount a complete permanent modifier on its own source", "operations.first")
	if !reflect.DeepEqual(reads.visits, []string{"match", "actors"}) {
		t.Fatal("general operation must not read the pure shield mount", reads.visits)
	}
	reads.visits = nil
	reads.matched = false
	input.Compiled.Features |= planbundle.FeatureStateOnExpire
	input.Compiled.Providers = []planbundle.CompiledProvider{{HasStateOnExpire: true}}
	input.Compiled.Operations[0] = planbundle.CompiledOperation{Operation: "shield", Target: "self", HasAmount: true, HasShieldLifecycleProvider: true, OwnerProviderIndex: 0}
	input.Compiled.Listeners = []planbundle.CompiledListener{listener}
	compile.BuildStaticAdmissionFacts(input.Compiled)
	if err := ValidateStaticInitializationListener(input, input.Compiled.Listeners[0], reads); err != nil || len(reads.visits) != 0 {
		t.Fatal("existing expiry initialization exception reached generic checks", err, reads.visits)
	}
}

func TestInitialTriggeredSourceKeepsStaticFallbackAndActualFields(t *testing.T) {
	input, listener, sources := sourceListenerInput(t, model.EventTypeBasicAttackHit, planbundle.CompiledOperation{Operation: "state_change", StateScope: "state_scope/provider", Target: "self", HasAmount: true, Ref: "count", Path: "operations.state"})
	input.Compiled.Listeners = []planbundle.CompiledListener{listener}
	provider := planbundle.CompiledProvider{Kind: "character", StableID: "passive"}
	reads := &initialSourceFixture{input: input, sources: sources}
	requireSourceAdmissionError(t, ValidateEquipmentHitProvider(input, provider, "source", "selected", reads), "source state operation requires its complete declared field", "operations.state")
	reads.sources.StateFields = map[string]planbundle.CompiledProviderStateField{"count": {DefaultValue: 0}}
	if err := ValidateEquipmentHitProvider(input, provider, "source", "selected", reads); err != nil {
		t.Fatalf("generic listener fallback rejected a declared zero field: %+v", err)
	}
}

func TestInitialExpirySourcesValidateMountsBeforeDriverRestrictions(t *testing.T) {
	input, listener, reads := initialSourceListener(t, model.EventTypeSourceInitialized)
	listener.OperationCount = 1
	input.Compiled.Features |= planbundle.FeatureStateOnExpire
	input.Compiled.Combatants = []planbundle.CompiledCombatant{{Key: "source", ProviderMounts: []planbundle.CompiledProviderMount{{DefinitionIndex: 0, ProviderRef: "selected"}}}}
	input.Compiled.Providers = []planbundle.CompiledProvider{{HasStateOnExpire: true}}
	input.Compiled.Listeners = []planbundle.CompiledListener{listener}
	input.Compiled.Operations = []planbundle.CompiledOperation{{Operation: "shield", Target: "self", HasAmount: true, HasShieldLifecycleProvider: true, OwnerProviderIndex: 0}}
	input.Compiled.Abilities = []planbundle.CompiledAbility{{ProviderIndex: 0}}
	input.Compiled.AbilityRefIndex = map[string]planbundle.CompiledAbilityRef{"direct": {AbilityIndex: 0}}
	reads.driver = "direct"
	entries := []model.DriverEntry{{AbilityRef: "direct"}}
	compile.BuildStaticAdmissionFacts(input.Compiled)
	requireSourceAdmissionError(t, ValidateStateOnExpireSources(input, entries, reads), "state expiry source requires complete permanent own shield initialization and damage-driven state writes", "initialSnapshot.combatants.providers")
	if !reflect.DeepEqual(reads.visits, []string{"actors"}) {
		t.Fatal("driver restriction ran before invalid source", reads.visits)
	}
	input.Compiled.Providers[0].Kind, input.Compiled.Providers[0].StableID = "character", "passive"
	reads.visits = nil
	compile.BuildStaticAdmissionFacts(input.Compiled)
	requireSourceAdmissionError(t, ValidateStateOnExpireSources(input, entries, reads), "state expiry source abilities can only run through their actual initialization or received-damage listeners", "driverPlan.entries")
	if !reflect.DeepEqual(reads.visits, []string{"actors", "driver"}) {
		t.Fatal("valid source did not reach original driver phase", reads.visits)
	}
}

type initialHealthFixture struct {
	attributes attribute.Table
	owners     []string
}

func (r *initialHealthFixture) InitialHealthAttributes(owner string) attribute.Table {
	r.owners = append(r.owners, owner)
	return r.attributes
}

func TestFixedEquipmentHealthKeepsContributionFilterToleranceAndOwner(t *testing.T) {
	input, _ := initialSelectionInput()
	input.Compiled.Providers = []planbundle.CompiledProvider{{Kind: "item", Modifiers: []planbundle.CompiledModifier{{Kind: "attribute", Target: "self.attr.hp"}}}}
	for index := range input.Compiled.Combatants {
		input.Compiled.Combatants[index].ProviderMounts = []planbundle.CompiledProviderMount{{DefinitionIndex: 0}}
	}
	reads := &initialHealthFixture{attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Max: 100, Current: 50, Resolved: 100 + 5e-8}})}
	if err := ValidateFixedEquipmentHealth(input, reads); err != nil {
		t.Fatalf("original tolerance rejected a valid maximum: %+v", err)
	}
	hp := reads.attributes.At("hp")
	hp.Resolved = 100 + 2e-7
	reads.attributes = reads.attributes.With("hp", hp)
	reads.owners = nil
	requireSourceAdmissionError(t, ValidateFixedEquipmentHealth(input, reads), "equipped HP maximum must match native contributions and current HP must remain within it", "initialSnapshot.combatants.source.attributes.hp")
	if !reflect.DeepEqual(reads.owners, []string{"source"}) {
		t.Fatal("equipment failure did not retain compiled owner order", reads.owners)
	}
	input.Compiled.Providers[0].Kind = "status"
	reads.owners = nil
	if err := ValidateFixedEquipmentHealth(input, reads); err != nil || len(reads.owners) != 0 {
		t.Fatal("non-equipment source caused health admission", err, reads.owners)
	}
}
