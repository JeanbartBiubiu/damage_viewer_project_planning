package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func statusConst(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func sourceTargetLifecycle(duration float64) *model.ProviderLifecycle {
	d := statusConst(duration)
	return &model.ProviderLifecycle{
		DurationMs:    &d,
		MaxStacks:     1,
		RefreshPolicy: model.RefreshPolicyReplace,
		InstanceScope: model.InstanceScopeSourceTarget,
	}
}

func slowContribution(resultRef, statusKey string, strength float64) model.StatusContributionDefinition {
	return model.StatusContributionDefinition{
		ResultRef:  resultRef,
		StatusKey:  statusKey,
		StatusKind: model.StatusKindMovementSlow,
		Strength:   statusConst(strength),
	}
}

func TestCompileSourceTargetLifecycleAndStatusContributions(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "status:slow",
		Kind:        "status",
		StableID:    "slow",
		Lifecycle:   sourceTargetLifecycle(1000),
		StatusContributions: []model.StatusContributionDefinition{
			slowContribution("result:slow", "slow_q", 0.3),
			slowContribution("result:slow_zero", "slow_zero", 0),
		},
	})
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	var found *CompiledProvider
	for i := range result.Session.Providers {
		if result.Session.Providers[i].ProviderKey == "status:slow" {
			found = &result.Session.Providers[i]
			break
		}
	}
	if found == nil || found.Lifecycle == nil || !found.Lifecycle.AllowsSourceTargetReuse() {
		t.Fatalf("source_target not compiled: %+v", found)
	}
	if found.Lifecycle.MaxStacks != 1 || found.Lifecycle.RefreshPolicy != model.RefreshPolicyReplace || !found.Lifecycle.HasDuration {
		t.Fatalf("lifecycle=%+v", found.Lifecycle)
	}
	if len(found.StatusContributions) != 2 || !found.StatusContributions[0].HasStrength || !found.StatusContributions[1].HasStrength {
		t.Fatalf("contributions=%+v", found.StatusContributions)
	}
	if found.StatusContributions[1].ResultRef != "result:slow_zero" {
		t.Fatalf("zero contribution dropped: %+v", found.StatusContributions)
	}
}

func TestCompileUnspecifiedScopeStillCreatesIndependentInstances(t *testing.T) {
	req := minimalValidCompileRequest()
	d := statusConst(500)
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "status:old",
		Kind:        "status",
		StableID:    "old",
		Lifecycle:   &model.ProviderLifecycle{DurationMs: &d},
	})
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	p := result.Session.Providers[len(result.Session.Providers)-1]
	if p.Lifecycle == nil || p.Lifecycle.InstanceScope != "" || p.Lifecycle.AllowsSourceTargetReuse() {
		t.Fatalf("unspecified scope should not reuse: %+v", p.Lifecycle)
	}
}

func TestCompileStatusContributionRejects(t *testing.T) {
	cases := []struct {
		name, path string
		mutate     func(*model.CompileRequest)
	}{
		{"unsupported scope", "instanceScope", func(r *model.CompileRequest) {
			r.SharedProviders[1].Lifecycle.InstanceScope = "global"
		}},
		{"implicit stacks", "maxStacks", func(r *model.CompileRequest) {
			r.SharedProviders[1].Lifecycle.MaxStacks = 0
		}},
		{"implicit refresh", "refreshPolicy", func(r *model.CompileRequest) {
			r.SharedProviders[1].Lifecycle.RefreshPolicy = ""
		}},
		{"missing duration", "durationMs", func(r *model.CompileRequest) {
			r.SharedProviders[1].Lifecycle.DurationMs = nil
		}},
		{"contributions without scope", "statusContributions", func(r *model.CompileRequest) {
			r.SharedProviders[1].Lifecycle.InstanceScope = ""
		}},
		{"missing resultRef", "resultRef", func(r *model.CompileRequest) {
			r.SharedProviders[1].StatusContributions[0].ResultRef = ""
		}},
		{"duplicate resultRef", "resultRef", func(r *model.CompileRequest) {
			r.SharedProviders[1].StatusContributions = append(r.SharedProviders[1].StatusContributions, r.SharedProviders[1].StatusContributions[0])
		}},
		{"missing statusKey", "statusKey", func(r *model.CompileRequest) {
			r.SharedProviders[1].StatusContributions[0].StatusKey = ""
		}},
		{"wrong kind", "statusKind", func(r *model.CompileRequest) {
			r.SharedProviders[1].StatusContributions[0].StatusKind = "stun"
		}},
		{"missing strength", "strength", func(r *model.CompileRequest) {
			r.SharedProviders[1].StatusContributions[0].Strength = model.GenericFormulaExpr{}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := minimalValidCompileRequest()
			req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
				ProviderKey:         "status:slow",
				Kind:                "status",
				StableID:            "slow",
				Lifecycle:           sourceTargetLifecycle(1000),
				StatusContributions: []model.StatusContributionDefinition{slowContribution("result:slow", "slow_q", 0.3)},
			})
			tc.mutate(&req)
			result := CompileGeneric(req)
			if result.OK {
				t.Fatal("expected compile failure")
			}
			for _, e := range result.Result.Errors {
				if strings.Contains(e.Path, tc.path) {
					return
				}
			}
			t.Fatalf("missing path %q: %+v", tc.path, result.Result.Errors)
		})
	}
}

func TestCompileHealGroupModeConsumedAndConflictListsBothPaths(t *testing.T) {
	req := loadGenericFixtureCompileRequest(t, "generic_vamp_damage.json")
	req.SharedProviders[0].Modifiers[0].HealGroupCalculationMode = model.HealGroupRatioAdd
	req.SharedProviders[0].Modifiers[1].HealGroupCalculationMode = model.HealGroupRatioMax
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected conflict")
	}
	var paths []string
	for _, e := range result.Result.Errors {
		if strings.Contains(e.Path, "healGroupCalculationMode") && e.Ref == "general" {
			paths = append(paths, e.Path)
		}
	}
	if len(paths) < 2 {
		t.Fatalf("expected both conflict paths, got %+v from %+v", paths, result.Result.Errors)
	}
	if !strings.Contains(paths[0], "modifiers[0]") || !strings.Contains(paths[1], "modifiers[1]") {
		if !(strings.Contains(strings.Join(paths, ","), "modifiers[0]") && strings.Contains(strings.Join(paths, ","), "modifiers[1]")) {
			t.Fatalf("conflict paths=%v", paths)
		}
	}
}

func TestCompileHealRatioMaxRequiresReceived(t *testing.T) {
	req := loadGenericFixtureCompileRequest(t, "generic_vamp_damage.json")
	req.SharedProviders[0].Modifiers[0].HealGroupCalculationMode = model.HealGroupRatioMax
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected ratio_max DONE reject")
	}
	found := false
	for _, e := range result.Result.Errors {
		if strings.Contains(e.Path, "healDirection") {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing healDirection error: %+v", result.Result.Errors)
	}
}

func TestCompileHealRatioMaxIsConsumed(t *testing.T) {
	req := loadGenericFixtureCompileRequest(t, "generic_vamp_damage.json")
	for i := range req.SharedProviders[0].Modifiers {
		req.SharedProviders[0].Modifiers[i].HealGroupKey = "wound_" + req.SharedProviders[0].Modifiers[i].ModifierKey
		if req.SharedProviders[0].Modifiers[i].HealDirection == model.HealReceived {
			req.SharedProviders[0].Modifiers[i].HealGroupCalculationMode = model.HealGroupRatioMax
		}
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	found := false
	for _, mod := range result.Session.Providers[0].Modifiers {
		if mod.HealGroupCalculationMode == model.HealGroupRatioMax {
			found = true
		}
		if mod.Command == "heal" && mod.HealGroupCalculationMode == "" {
			t.Fatalf("heal mode not consumed: %+v", mod)
		}
	}
	if !found {
		t.Fatal("ratio_max not present on compiled modifiers")
	}
}
