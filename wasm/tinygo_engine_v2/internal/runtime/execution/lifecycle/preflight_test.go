package lifecycle

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func TestPreflightSequentialReuseAndRemovalLeaveBaseUntouched(t *testing.T) {
	compiled := plan.CompiledSession{Providers: []plan.CompiledProvider{{ProviderKey: "periodic", AbilityCount: 1,
		Lifecycle: &plan.CompiledProviderLifecycle{InstanceScope: model.InstanceScopeSourceTarget}}},
		Abilities: []plan.CompiledAbility{{Kind: "tick", TickSpec: &plan.CompiledTickSpec{IntervalMs: 10}}}}
	executor := New(&compiled, nil, nil, "session")
	base := effectpkg.ProviderList{}.Append(effectpkg.Provider{ProviderRef: "old", DefinitionRef: "periodic", Source: "source", Owner: "target", ExpireAt: 100})
	before := base.Snapshot()
	mutations := []Mutation{
		{Kind: "apply", ProviderRef: "new", DefinitionRef: "periodic", SourceKey: "source", TargetKey: "target", HasExpireAt: true, ExpireAt: 200},
		{Kind: "apply", ProviderRef: "unused", DefinitionRef: "periodic", SourceKey: "source", TargetKey: "target", HasExpireAt: true, ExpireAt: 300},
		{Kind: "ensure_remaining", ProviderRef: "new", DefinitionRef: "periodic", SourceKey: "source", TargetKey: "target", ExpireAt: 350},
		{Kind: "expire", ProviderRef: "new", DefinitionRef: "periodic", Strict: true},
	}
	count, err := executor.PreflightMutations(base, mutations, MutationPreflight{Now: 100, Stop: 500, ParticipantsAlive: true})
	if err != nil || count != 4 || !reflect.DeepEqual(base.Snapshot(), before) {
		t.Fatalf("count=%d error=%+v base=%+v", count, err, base.Snapshot())
	}
	mutations = append(mutations, mutations[len(mutations)-1])
	_, err = executor.PreflightMutations(base, mutations, MutationPreflight{Now: 100, Stop: 500, ParticipantsAlive: true})
	if err == nil || err.Code != model.GenericErrUnknownRef || err.Message != "expire_provider instance is missing" || err.Ref != "new" || !reflect.DeepEqual(base.Snapshot(), before) {
		t.Fatalf("later operation did not observe prior removal: %+v", err)
	}
}

func TestPreflightFailurePreservesIdentityAndOriginalList(t *testing.T) {
	compiled := plan.CompiledSession{SchemaHash: "schema", RulesHash: "rules", Providers: []plan.CompiledProvider{{ProviderKey: "p"}}}
	executor := New(&compiled, nil, nil, "session")
	base := effectpkg.ProviderList{}.Append(effectpkg.Provider{ProviderRef: "live", DefinitionRef: "p", Source: "source", Owner: "target", ExpireAt: 200})
	_, err := executor.PreflightMutations(base, []Mutation{
		{Kind: "refresh", ProviderRef: "live", HasExpireAt: true, ExpireAt: 300},
		{Kind: "ensure_remaining", ProviderRef: "live", DefinitionRef: "p", SourceKey: "target", TargetKey: "target", ExpireAt: 400},
	}, MutationPreflight{Now: 100})
	want := model.NewEngineError(model.GenericPhaseRun, model.GenericErrUnknownRef, "provider duration change has a foreign instance owner")
	want.Path, want.Ref, want.SchemaHash, want.RulesHash, want.SessionID = "providers", "live", "schema", "rules", "session"
	if err == nil || !reflect.DeepEqual(*err, want) || base.At(0).ExpireAt != 200 {
		t.Fatalf("error=%+v want=%+v base=%+v", err, want, base.At(0))
	}
}

func TestShieldCandidateProjectionUsesOnlyExistingRefreshAndRemoval(t *testing.T) {
	compiled := plan.CompiledSession{Providers: []plan.CompiledProvider{{ProviderKey: "p"}}}
	executor := New(&compiled, nil, nil, "")
	base := effectpkg.ProviderList{}.Append(effectpkg.Provider{ProviderRef: "live", DefinitionRef: "p", ExpireAt: 100})
	projected, err := executor.ProjectShieldCandidates(base, []Mutation{
		{Kind: "apply", DefinitionRef: "missing", ProviderRef: "uncommitted"},
		{Kind: "ensure_remaining", ProviderRef: "live", ExpireAt: 1000},
		{Kind: "refresh", ProviderRef: "live", HasExpireAt: true, ExpireAt: 200},
	}, 10)
	if err != nil || projected.Len() != 1 || projected.At(0).ExpireAt != 200 || base.At(0).ExpireAt != 100 {
		t.Fatalf("projection=%+v base=%+v error=%+v", projected.Snapshot(), base.Snapshot(), err)
	}
	projected, err = executor.ProjectShieldCandidates(base, []Mutation{{Kind: "expire", ProviderRef: "live", Strict: true}}, 10)
	if err != nil || projected.Len() != 0 || base.Len() != 1 {
		t.Fatalf("removal projection=%+v base=%+v error=%+v", projected.Snapshot(), base.Snapshot(), err)
	}
}

func TestPreflightFirstTickBoundaries(t *testing.T) {
	for _, test := range []struct {
		name         string
		basic, alive bool
		stop, expiry int64
		want         int
	}{
		{"expiry_excludes_tick", false, true, 20, 10, 1},
		{"attack_includes_tick", true, true, 20, 10, 2},
		{"dead_attack", true, false, 20, 10, 1},
		{"before_stop", false, true, 9, 20, 1},
		{"at_stop", false, true, 10, 20, 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			compiled := plan.CompiledSession{Providers: []plan.CompiledProvider{{ProviderKey: "p", AbilityCount: 1}},
				Abilities: []plan.CompiledAbility{{Kind: "tick", TickSpec: &plan.CompiledTickSpec{IntervalMs: 10}}}}
			executor := New(&compiled, nil, nil, "")
			count, err := executor.PreflightMutations(effectpkg.ProviderList{}, []Mutation{{Kind: "apply", DefinitionRef: "p", HasExpireAt: true, ExpireAt: test.expiry}},
				MutationPreflight{Stop: test.stop, BasicAttack: test.basic, ParticipantsAlive: test.alive})
			if err != nil || count != test.want {
				t.Fatalf("count=%d want=%d error=%+v", count, test.want, err)
			}
		})
	}
}
