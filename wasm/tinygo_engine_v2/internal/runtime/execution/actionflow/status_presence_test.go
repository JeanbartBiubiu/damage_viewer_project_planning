package actionflow

import (
	"testing"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func TestStatusPresenceUsesBoundActualInstancesAtExactTime(t *testing.T) {
	definitions := []planbundle.CompiledProvider{{ProviderKey: "control", ClosedStatusKey: "bonded"}, {ProviderKey: "provider/status_root"}}
	keys := []string{"bonded", "slow", "root"}
	source := effectpkg.Providers([]effectpkg.Provider{{ProviderRef: "own", DefinitionIndex: 0, Owner: "source", ExpireAt: 1000}})
	target := effectpkg.Providers([]effectpkg.Provider{{ProviderRef: "slow", DefinitionIndex: 1, Owner: "target", ExpireAt: 2000,
		StatusContributions: effectpkg.StatusContributions([]effectpkg.StatusContribution{{StatusKey: "slow", StatusKind: "movement_slow"}})}})
	before := StatusPresence(keys, source, definitions, 999)
	other := StatusPresence(keys, target, definitions, 999)
	if !before["bonded"] || other["bonded"] || !other["slow"] || other["root"] {
		t.Fatal("logical binding, owner isolation or original slow contribution lost", before, other)
	}
	if StatusPresence(keys, source, definitions, 1000)["bonded"] || StatusPresence(keys, effectpkg.ProviderList{}, definitions, 999)["bonded"] {
		t.Fatal("expired or absent instance contributed a logical state")
	}
	if StatusPresence([]string{"slow"}, source, definitions, 999)["bonded"] {
		t.Fatal("undeclared logical state was introduced")
	}
}
