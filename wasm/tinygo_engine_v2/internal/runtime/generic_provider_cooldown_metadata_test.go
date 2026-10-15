package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/status"
)

func TestProviderCooldownMetadataDefinitionTraits(t *testing.T) {
	for _, test := range []struct {
		name   string
		fields map[string]providerStateFieldDef
		want   bool
	}{
		{name: "nil"},
		{name: "empty", fields: map[string]providerStateFieldDef{}},
		{name: "ordinary name", fields: map[string]providerStateFieldDef{"cooldown": {durationMs: 10}}},
		{name: "ammo", fields: map[string]providerStateFieldDef{"charge": {stateKind: model.ProviderStateKindAmmo}}},
		{name: "internal", fields: map[string]providerStateFieldDef{"ready": {stateKind: model.ProviderStateKindCooldown}}, want: true},
		{name: "mixed", fields: map[string]providerStateFieldDef{"first": {}, "ready": {stateKind: model.ProviderStateKindCooldown}, "last": {}}, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			metadata := newProviderStateFieldMetadata(test.fields)
			if metadata.hasInternalCooldowns != test.want || len(metadata.fields) != len(test.fields) {
				t.Fatalf("metadata = %+v, want cooldowns %v", metadata, test.want)
			}
			compiled := make(map[string]planbundle.CompiledProviderStateField, len(test.fields))
			for key, field := range test.fields {
				compiled[key] = planbundle.CompiledProviderStateField{StateKind: field.stateKind, DurationMs: field.durationMs}
			}
			converted := compiledStateFieldsToRuntime(compiled)
			if converted.hasInternalCooldowns != test.want || len(converted.fields) != len(test.fields) {
				t.Fatalf("compiled metadata = %+v, want cooldowns %v", converted, test.want)
			}
		})
	}
	var absent *providerStateFieldMetadata
	if absent.definitions() != nil {
		t.Fatal("nil metadata must preserve absent definitions")
	}
}

func TestProviderCooldownMetadataCacheReusesDefinition(t *testing.T) {
	run := genericRunState{compiled: planbundle.CompiledSession{Providers: []planbundle.CompiledProvider{
		{StateFields: map[string]planbundle.CompiledProviderStateField{"ready": {StateKind: model.ProviderStateKindCooldown}}},
		{},
	}}}
	providers := []status.ProviderInstance{{ProviderRef: "mounted", DefinitionIndex: 0}, {ProviderRef: "empty", DefinitionIndex: 1}}
	first := run.resolveProviderStateFieldDefs("source", "mounted", providers)
	empty := run.resolveProviderStateFieldDefs("source", "empty", providers)
	if !first.hasInternalCooldowns || empty == nil || len(empty.fields) != 0 || empty.hasInternalCooldowns {
		t.Fatal("definition cache lost internal or empty field metadata")
	}
	if allocations := testing.AllocsPerRun(25, func() {
		if run.resolveProviderStateFieldDefs("source", "mounted", providers) != first || run.resolveProviderStateFieldDefs("source", "empty", providers) != empty {
			t.Fatal("definition lookup rebuilt immutable metadata")
		}
	}); allocations != 0 {
		t.Fatalf("cached metadata lookups allocated %v objects", allocations)
	}
	if run.resolveProviderStateFieldDefs("source", "missing", providers) != nil {
		t.Fatal("missing provider acquired another definition's metadata")
	}
}

func TestProviderCooldownMetadataPreparationUsesIncomingDefinition(t *testing.T) {
	plain := newProviderStateFieldMetadata(map[string]providerStateFieldDef{"ready": {}})
	internal := newProviderStateFieldMetadata(map[string]providerStateFieldDef{"ready": {stateKind: model.ProviderStateKindCooldown}})
	empty := newProviderStateFieldMetadata(map[string]providerStateFieldDef{})
	ledger := newGenericCooldownLedger()
	options := providerStateReadOptions{cooldowns: ledger, ownerKey: "source"}
	for _, test := range []struct {
		name     string
		bound    *providerStateFieldMetadata
		incoming *providerStateFieldMetadata
		want     bool
	}{
		{name: "new internal definition", bound: plain, incoming: internal, want: true},
		{name: "new ordinary definition", bound: internal, incoming: plain},
		{name: "nil uses bound internal", bound: internal, want: true},
		{name: "empty uses bound internal", bound: internal, incoming: empty, want: true},
		{name: "nil uses bound ordinary", bound: plain},
		{name: "empty uses bound ordinary", bound: plain, incoming: empty},
	} {
		t.Run(test.name, func(t *testing.T) {
			bag := &providerStateBag{}
			bag.bindFieldDefs(test.bound)
			bags := freezeProviderStateView(map[string]*providerStateBag{"mounted": bag})
			before := *bag
			if got := bag.needsReadPreparation(test.incoming, 10, options); got != test.want {
				t.Fatalf("preparation = %v, want %v", got, test.want)
			}
			shared := true
			prepared := readSharedProviderStateBag(&bags, &shared, "mounted", false, test.incoming, 10, options)
			if (prepared != bag) != test.want || bag.hasInternalCooldowns != before.hasInternalCooldowns || bag.cooldownProjectionBound != before.cooldownProjectionBound {
				t.Fatal("preparation changed the wrong shared header")
			}
			if prepared.hasInternalCooldowns != test.bound.hasInternalCooldowns || prepared.fieldDefs["ready"].stateKind != test.bound.fields["ready"].stateKind {
				t.Fatal("a later input replaced the bag's bound definition")
			}
		})
	}
}

func TestProviderCooldownMetadataSurvivesCloneAndExpiry(t *testing.T) {
	fields := newProviderStateFieldMetadata(map[string]providerStateFieldDef{
		"ready": {stateKind: model.ProviderStateKindCooldown, durationMs: 100},
		"timed": {defaultValue: 2, durationMs: 10},
	})
	bag := &providerStateBag{}
	bag.bindFieldDefs(fields)
	bag.state["timed"], bag.expireAt["timed"] = 7, 10
	ledger := newGenericCooldownLedger()
	id := genericStateCooldownIdentity("source", "mounted", "ready", stateScopeProvider, "")
	ledger.start(id, 100, 0)
	bag.projectInternalCooldowns(ledger, "source", "mounted", 9)
	view := freezeProviderStateView(map[string]*providerStateBag{"mounted": bag})
	clone := cloneProviderStateMap(view)["mounted"]
	if !clone.hasInternalCooldowns || clone.fieldDefs["ready"].stateKind != model.ProviderStateKindCooldown {
		t.Fatal("clone lost immutable cooldown metadata")
	}
	changed := ledger.clone()
	changed.reset(id, 10)
	shared := true
	prepared := readSharedProviderStateBag(&view, &shared, "mounted", false, nil, 10, providerStateReadOptions{cooldowns: changed, ownerKey: "source"})
	if prepared == bag || !prepared.hasInternalCooldowns || prepared.state["ready"] != 0 || prepared.state["timed"] != 2 || prepared.expireAt["timed"] != 0 {
		t.Fatal("expiry or cooldown refresh lost bound metadata or writable isolation")
	}
	if bag.state["ready"] != 1 || bag.state["timed"] != 7 || clone.state["ready"] != 1 || clone.state["timed"] != 7 {
		t.Fatal("preparing a later view changed a frozen or cloned snapshot")
	}
}
