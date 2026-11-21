package lifecycle

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func TestActiveStunDeadlineReadsActualFiniteInstancesAndOrderedChanges(t *testing.T) {
	providers := []planbundle.CompiledProvider{{ProviderKey: "stun", ActionStun: true}, {ProviderKey: "slow"}}
	instance := func(ref string, definition uint16, expiry int64) effectpkg.Provider {
		return effectpkg.Provider{ProviderRef: ref, DefinitionRef: providers[definition].ProviderKey, DefinitionIndex: definition, Source: "target", Owner: "source", ExpireAt: expiry}
	}
	for _, test := range []struct {
		name      string
		now, want int64
		instances []effectpkg.Provider
		changes   []Mutation
		rejected  bool
	}{
		{name: "overlap", now: 100, want: 700, instances: []effectpkg.Provider{instance("a", 0, 300), instance("b", 0, 700), instance("ordinary_slow", 1, 900)}},
		{name: "exact_expiry", now: 300, instances: []effectpkg.Provider{instance("a", 0, 300)}},
		{name: "refresh_at_exact_expiry", now: 300, want: 800, instances: []effectpkg.Provider{instance("a", 0, 300)}, changes: []Mutation{{Kind: "refresh", TargetKey: "source", ProviderRef: "a", HasExpireAt: true, ExpireAt: 800}}},
		{name: "refresh_shortens", now: 100, want: 200, instances: []effectpkg.Provider{instance("a", 0, 700)}, changes: []Mutation{{Kind: "refresh", TargetKey: "source", ProviderRef: "a", HasExpireAt: true, ExpireAt: 200}}},
		{name: "remove_longer", now: 100, want: 300, instances: []effectpkg.Provider{instance("a", 0, 300), instance("b", 0, 700)}, changes: []Mutation{{Kind: "expire", TargetKey: "source", ProviderRef: "b"}}},
		{name: "staged_apply", now: 100, want: 500, changes: []Mutation{{Kind: "apply", TargetKey: "source", DefinitionRef: "stun", HasExpireAt: true, ExpireAt: 500}}},
		{name: "projected_not_repeated", now: 100, want: 300, instances: []effectpkg.Provider{instance("a", 0, 300)}, changes: []Mutation{{Kind: "apply", TargetKey: "source", DefinitionRef: "stun", Projected: true, HasExpireAt: true, ExpireAt: 900}}},
		{name: "permanent_rejected", now: 100, instances: []effectpkg.Provider{instance("a", 0, 0)}, rejected: true},
		{name: "unsafe_rejected", now: 100, instances: []effectpkg.Provider{instance("a", 0, maxJSONSafeInteger+1)}, rejected: true},
		{name: "wrong_definition_rejected", now: 100, instances: []effectpkg.Provider{{ProviderRef: "a", DefinitionRef: "foreign", Owner: "source", ExpireAt: 500}}, rejected: true},
		{name: "wrong_owner_rejected", now: 100, instances: []effectpkg.Provider{{ProviderRef: "a", DefinitionRef: "stun", Owner: "target", ExpireAt: 500}}, rejected: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			actual, err := ActiveStunDeadline("source", test.now, providers, effectpkg.Providers(test.instances), test.changes)
			if (err != nil) != test.rejected || err == nil && actual != test.want {
				t.Fatalf("deadline=%d want=%d err=%+v", actual, test.want, err)
			}
		})
	}
	providers[0].Lifecycle = &planbundle.CompiledProviderLifecycle{InstanceScope: model.InstanceScopeSourceTarget, RefreshPolicy: model.RefreshPolicyReplace}
	changes := []Mutation{{Kind: "apply", TargetKey: "source", SourceKey: "target", DefinitionRef: "stun", HasExpireAt: true, ExpireAt: 900}, {Kind: "apply", TargetKey: "source", SourceKey: "target", DefinitionRef: "stun", HasExpireAt: true, ExpireAt: 200}}
	base := effectpkg.Providers([]effectpkg.Provider{instance("original", 0, 700)})
	if actual, err := ActiveStunDeadline("source", 100, providers, base, changes); err != nil || actual != 200 {
		t.Fatal("same-source replacement retained a previous control", actual, err)
	}
	expire := Mutation{Kind: "expire", TargetKey: "source", ProviderRef: "original"}
	if actual, err := ActiveStunDeadline("source", 100, providers, base, []Mutation{changes[0], expire}); err != nil || actual != 0 {
		t.Fatal("same-frame removal left the reused stun active", actual, err)
	}
	if actual, err := ActiveStunDeadline("source", 100, providers, base, []Mutation{expire, changes[0]}); err != nil || actual != 900 {
		t.Fatal("removal dropped a separate later application", actual, err)
	}
	providers[0].Lifecycle = &planbundle.CompiledProviderLifecycle{RefreshPolicy: "extend"}
	refresh := Mutation{Kind: "refresh", TargetKey: "source", ProviderRef: "original", HasExpireAt: true, ExpireAt: 400}
	if actual, err := ActiveStunDeadline("source", 100, providers, base, []Mutation{refresh}); err != nil || actual != 400 {
		t.Fatal("temporary extend query changed", actual, err)
	}
	executor := Executor{compiled: &planbundle.CompiledSession{Providers: providers}}
	decision, err := executor.refreshProvider(base.At(0), 400, true, effectpkg.ContributionView{}, 100)
	if err != nil || decision.Instance.ExpireAt != 700 {
		t.Fatal("actual extend publication changed", decision, err)
	}
}
