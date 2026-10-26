package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestProviderCooldownMetadataCacheReusesDefinition(t *testing.T) {
	run := Engine{loop: newTestLoopAt(0), compiled: planbundle.CompiledSession{Providers: []planbundle.CompiledProvider{
		{StateFields: map[string]planbundle.CompiledProviderStateField{"ready": {StateKind: model.ProviderStateKindCooldown}}},
		{},
	}}}
	providers := effectpkg.Providers([]effectpkg.Provider{{ProviderRef: "mounted", DefinitionIndex: 0}, {ProviderRef: "empty", DefinitionIndex: 1}})
	first := run.resolveProviderStateFieldDefs("source", "mounted", providers)
	empty := run.resolveProviderStateFieldDefs("source", "empty", providers)
	if !first.HasInternalCooldowns() || empty == nil || empty.Definitions().Len() != 0 || empty.HasInternalCooldowns() {
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
