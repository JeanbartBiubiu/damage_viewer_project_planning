package effect

import "tinygo_engine_v2/internal/runtime/contract"

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestProviderCooldownMetadataDefinitionTraits(t *testing.T) {
	for _, test := range []struct {
		name   string
		fields map[string]FieldDefinition
		want   bool
	}{
		{name: "nil"},
		{name: "empty", fields: map[string]FieldDefinition{}},
		{name: "ordinary name", fields: map[string]FieldDefinition{"cooldown": {DurationMs: 10}}},
		{name: "ammo", fields: map[string]FieldDefinition{"charge": {StateKind: model.ProviderStateKindAmmo}}},
		{name: "internal", fields: map[string]FieldDefinition{"ready": {StateKind: model.ProviderStateKindCooldown}}, want: true},
		{name: "mixed", fields: map[string]FieldDefinition{"first": {}, "ready": {StateKind: model.ProviderStateKindCooldown}, "last": {}}, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			metadata := NewFields(test.fields)
			if metadata.hasInternalCooldowns != test.want || len(metadata.fields) != len(test.fields) {
				t.Fatalf("metadata = %+v, want cooldowns %v", metadata, test.want)
			}
			compiled := make(map[string]planbundle.CompiledProviderStateField, len(test.fields))
			for key, field := range test.fields {
				compiled[key] = planbundle.CompiledProviderStateField{StateKind: field.StateKind, DurationMs: field.DurationMs}
			}
			converted := CompileFields(compiled)
			if converted.hasInternalCooldowns != test.want || len(converted.fields) != len(test.fields) {
				t.Fatalf("compiled metadata = %+v, want cooldowns %v", converted, test.want)
			}
		})
	}
	var absent *FieldMetadata
	if absent.definitions() != nil {
		t.Fatal("nil metadata must preserve absent definitions")
	}
}

func TestProviderCooldownMetadataPreparationUsesIncomingDefinition(t *testing.T) {
	plain := NewFields(map[string]FieldDefinition{"ready": {}})
	internal := NewFields(map[string]FieldDefinition{"ready": {StateKind: model.ProviderStateKindCooldown}})
	empty := NewFields(map[string]FieldDefinition{})
	ledger := contract.BorrowCooldownView(nil, nil, 0)
	options := ReadOptions{Cooldowns: ledger, OwnerKey: "source"}
	for _, test := range []struct {
		name     string
		bound    *FieldMetadata
		incoming *FieldMetadata
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
			bag := &bagData{}
			bag.bindFieldDefs(test.bound)
			bags := freezeProviderStateView(map[string]*bagData{"mounted": bag})
			before := *bag
			if got := bag.needsReadPreparation(test.incoming, 10, options); got != test.want {
				t.Fatalf("preparation = %v, want %v", got, test.want)
			}
			shared := true
			prepared := readSharedProviderStateBag(&bags, &shared, "mounted", false, test.incoming, 10, options)
			if (prepared != bag) != test.want || bag.hasInternalCooldowns != before.hasInternalCooldowns || bag.cooldownProjectionBound != before.cooldownProjectionBound {
				t.Fatal("preparation changed the wrong shared header")
			}
			if prepared.hasInternalCooldowns != test.bound.hasInternalCooldowns || prepared.fieldDefs["ready"].StateKind != test.bound.fields["ready"].StateKind {
				t.Fatal("a later input replaced the bag's bound definition")
			}
		})
	}
}

func TestProviderCooldownMetadataSurvivesCloneAndExpiry(t *testing.T) {
	fields := NewFields(map[string]FieldDefinition{
		"ready": {StateKind: model.ProviderStateKindCooldown, DurationMs: 100},
		"timed": {DefaultValue: 2, DurationMs: 10},
	})
	bag := &bagData{}
	bag.bindFieldDefs(fields)
	bag.state["timed"], bag.expireAt["timed"] = 7, 10
	ledger := contract.BorrowCooldownView(nil, nil, 0)
	id := contract.CooldownIdentity{Owner: "source", ProviderRef: "mounted", StateKey: "ready", Scope: StateScopeProvider}
	ledger = contract.BorrowCooldownView([]contract.CooldownSlot{{Identity: id, Entry: contract.CooldownEntry{ReadyAt: 100, Active: true, Version: 1}}}, nil, 1)
	bag.projectInternalCooldowns(ledger, "source", "mounted", 9)
	view := freezeProviderStateView(map[string]*bagData{"mounted": bag})
	clone := cloneProviderStateMap(view)["mounted"]
	if !clone.hasInternalCooldowns || clone.fieldDefs["ready"].StateKind != model.ProviderStateKindCooldown {
		t.Fatal("clone lost immutable cooldown metadata")
	}
	changed := contract.BorrowCooldownView([]contract.CooldownSlot{{Identity: id, Entry: contract.CooldownEntry{ReadyAt: 10, Version: 2}}}, nil, 2)

	shared := true
	prepared := readSharedProviderStateBag(&view, &shared, "mounted", false, nil, 10, ReadOptions{Cooldowns: changed, OwnerKey: "source"})
	if prepared == bag || !prepared.hasInternalCooldowns || prepared.state["ready"] != 0 || prepared.state["timed"] != 2 || prepared.expireAt["timed"] != 0 {
		t.Fatal("expiry or cooldown refresh lost bound metadata or writable isolation")
	}
	if bag.state["ready"] != 1 || bag.state["timed"] != 7 || clone.state["ready"] != 1 || clone.state["timed"] != 7 {
		t.Fatal("preparing a later view changed a frozen or cloned snapshot")
	}
}
