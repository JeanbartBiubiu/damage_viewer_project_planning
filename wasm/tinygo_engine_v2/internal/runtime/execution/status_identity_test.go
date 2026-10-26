package execution

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func restoredSlowIdentityCase(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := withSlowProviders(t, []model.ProviderDefinition{slowProvider("status:slow", "slow", "slow_q", .3, 1000)}, nil, nil, 10)
	expire := int64(1000)
	strength := .3
	r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{
		ProviderRef: "status:slow#1", DefinitionRef: "status:slow", Source: "source", Owner: "target", Stacks: 1, ExpireAt: &expire,
		StatusContributions: []model.ProviderStatusContributionSnapshot{{ResultRef: "slow", StatusKey: "slow_q", StatusKind: model.StatusKindMovementSlow, Strength: &strength}},
	}}
	return c, r
}

func TestSlowGeneratedRefDoesNotAliasRestoredInstance(t *testing.T) {
	c, r := restoredSlowIdentityCase(t)
	compiled := compile.CompileGeneric(c)
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	// Same definition and recipient, but a distinct real source: two independent instances.
	err = s.applyProviderInstance("target", "target", "status:slow", 2000, true, effectpkg.StatusContributions([]effectpkg.StatusContribution{{ResultRef: "slow", StatusKey: "slow_q", StatusKind: model.StatusKindMovementSlow, Strength: .7}}))
	if err != nil {
		t.Fatal(err)
	}
	instances := s.combatants["target"].instances.Providers()
	if instances.Len() != 2 || instances.At(0).ProviderRef == instances.At(1).ProviderRef {
		t.Fatalf("new instance aliases restored one: %+v", instances)
	}
}

func TestSlowExpiredInstanceIsNotRefreshed(t *testing.T) {
	c, r := restoredSlowIdentityCase(t)
	compiled := compile.CompileGeneric(c)
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	s.loop.Advance(1000)
	err = s.applyProviderInstance("target", "source", "status:slow", 2000, true, effectpkg.StatusContributions([]effectpkg.StatusContribution{{ResultRef: "slow", StatusKey: "slow_q", StatusKind: model.StatusKindMovementSlow, Strength: .7}}))
	if err != nil {
		t.Fatal(err)
	}
	var active effectpkg.ProviderList
	for instanceIndex, instanceValues := 0, s.combatants["target"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		p := instanceValues.At(instanceIndex)
		if !p.Expired(s.loop.TimeMs()) {
			active = active.Append(p)
		}
	}
	if active.Len() != 1 || active.At(0).ProviderRef == "status:slow#1" {
		t.Fatalf("expired lifetime was resurrected: %+v", active)
	}
	r.InitialSnapshot = s.buildFinalSnapshot()
	if _, err := runForTest(compiled.Session, r); err != nil {
		t.Fatalf("engine-produced snapshot must restore: %+v", err)
	}
}
