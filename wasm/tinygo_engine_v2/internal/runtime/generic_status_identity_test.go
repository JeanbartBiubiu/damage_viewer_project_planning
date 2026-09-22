package runtime

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/status"
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

func TestSlowRestoreRequiresActualIdentity(t *testing.T) {
	cases := []struct {
		name, path string
		mutate     func(*model.CombatantProviderSnapshot)
	}{
		{"missing_source", ".source", func(p *model.CombatantProviderSnapshot) { p.Source = "" }},
		{"unknown_source", ".source", func(p *model.CombatantProviderSnapshot) { p.Source = "absent" }},
		{"missing_owner", ".owner", func(p *model.CombatantProviderSnapshot) { p.Owner = "" }},
		{"wrong_owner", ".owner", func(p *model.CombatantProviderSnapshot) { p.Owner = "source" }},
		{"missing_ref", ".providerRef", func(p *model.CombatantProviderSnapshot) { p.ProviderRef = "" }},
		{"zero_stacks", ".stacks", func(p *model.CombatantProviderSnapshot) { p.Stacks = 0 }},
		{"multiple_stacks", ".stacks", func(p *model.CombatantProviderSnapshot) { p.Stacks = 2 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, r := restoredSlowIdentityCase(t)
			tc.mutate(&r.InitialSnapshot.Combatants[1].Providers[0])
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatalf("compile: %+v", compiled.Result.Errors)
			}
			_, err := RunGeneric(compiled.Session, r)
			if err == nil || !strings.HasSuffix(err.Path, tc.path) {
				t.Fatalf("want %s error, got %+v", tc.path, err)
			}
		})
	}
}

func TestSlowRestoreRejectsDuplicateSourceInstance(t *testing.T) {
	for _, sameRef := range []bool{true, false} {
		c, r := restoredSlowIdentityCase(t)
		duplicate := r.InitialSnapshot.Combatants[1].Providers[0]
		if !sameRef {
			duplicate.ProviderRef = "second_ref"
		}
		r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, duplicate)
		compiled := compile.CompileGeneric(c)
		_, err := RunGeneric(compiled.Session, r)
		if err == nil {
			t.Fatalf("duplicate same source_target instance accepted, sameRef=%v", sameRef)
		}
	}
}

func TestSlowGeneratedRefDoesNotAliasRestoredInstance(t *testing.T) {
	c, r := restoredSlowIdentityCase(t)
	compiled := compile.CompileGeneric(c)
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	// Same definition and recipient, but a distinct real source: two independent instances.
	err = s.applyProviderInstance("target", "target", "status:slow", 2000, true,
		[]status.StatusContribution{{ResultRef: "slow", StatusKey: "slow_q", StatusKind: model.StatusKindMovementSlow, Strength: .7}})
	if err != nil {
		t.Fatal(err)
	}
	instances := s.combatants["target"].providers
	if len(instances) != 2 || instances[0].ProviderRef == instances[1].ProviderRef {
		t.Fatalf("new instance aliases restored one: %+v", instances)
	}
}

func TestSlowRestoreCannotReferToAbsentCombatant(t *testing.T) {
	c, r := restoredSlowIdentityCase(t)
	r.InitialSnapshot.Combatants = r.InitialSnapshot.Combatants[1:]
	compiled := compile.CompileGeneric(c)
	_, err := RunGeneric(compiled.Session, r)
	if err == nil || !strings.HasSuffix(err.Path, ".source") {
		t.Fatalf("missing real source must fail, got %+v", err)
	}
}

func TestSlowExpiredInstanceIsNotRefreshed(t *testing.T) {
	c, r := restoredSlowIdentityCase(t)
	compiled := compile.CompileGeneric(c)
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	s.nowMs = 1000
	err = s.applyProviderInstance("target", "source", "status:slow", 2000, true,
		[]status.StatusContribution{{ResultRef: "slow", StatusKey: "slow_q", StatusKind: model.StatusKindMovementSlow, Strength: .7}})
	if err != nil {
		t.Fatal(err)
	}
	var active []status.ProviderInstance
	for _, p := range s.combatants["target"].providers {
		if !p.Expired(s.nowMs) {
			active = append(active, p)
		}
	}
	if len(active) != 1 || active[0].ProviderRef == "status:slow#1" {
		t.Fatalf("expired lifetime was resurrected: %+v", active)
	}
	r.InitialSnapshot = s.buildFinalSnapshot()
	if _, err := RunGeneric(compiled.Session, r); err != nil {
		t.Fatalf("engine-produced snapshot must restore: %+v", err)
	}
}

func TestSourceTargetDurationRequiresRepresentableIntegerDeadline(t *testing.T) {
	for _, duration := range []float64{1.5, 1e30} {
		c, r := withSlowProviders(t, []model.ProviderDefinition{slowProvider("status:slow", "slow", "slow_q", .3, duration)},
			[]model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow"))},
			[]model.DriverEntry{{EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]", Source: "source", Target: "target"}}, 10)
		compiled := compile.CompileGeneric(c)
		_, err := RunGeneric(compiled.Session, r)
		if err == nil || !strings.HasSuffix(err.Path, ".durationMs") {
			t.Fatalf("duration=%v must fail, got %+v", duration, err)
		}
	}
}
