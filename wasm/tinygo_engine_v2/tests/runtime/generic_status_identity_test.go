// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	strings "strings"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
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
			_, err := runtimeengine.RunGeneric(compiled.Session, r)
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
		_, err := runtimeengine.RunGeneric(compiled.Session, r)
		if err == nil {
			t.Fatalf("duplicate same source_target instance accepted, sameRef=%v", sameRef)
		}
	}
}

func TestSlowRestoreCannotReferToAbsentCombatant(t *testing.T) {
	c, r := restoredSlowIdentityCase(t)
	r.InitialSnapshot.Combatants = r.InitialSnapshot.Combatants[1:]
	compiled := compile.CompileGeneric(c)
	_, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err == nil || !strings.HasSuffix(err.Path, ".source") {
		t.Fatalf("missing real source must fail, got %+v", err)
	}
}

func TestSourceTargetDurationRequiresRepresentableIntegerDeadline(t *testing.T) {
	for _, duration := range []float64{1.5, 1e30} {
		c, r := withSlowProviders(t, []model.ProviderDefinition{slowProvider("status:slow", "slow", "slow_q", .3, duration)},
			[]model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow"))},
			[]model.DriverEntry{{EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]", Source: "source", Target: "target"}}, 10)
		compiled := compile.CompileGeneric(c)
		_, err := runtimeengine.RunGeneric(compiled.Session, r)
		if err == nil || !strings.HasSuffix(err.Path, ".durationMs") {
			t.Fatalf("duration=%v must fail, got %+v", duration, err)
		}
	}
}
