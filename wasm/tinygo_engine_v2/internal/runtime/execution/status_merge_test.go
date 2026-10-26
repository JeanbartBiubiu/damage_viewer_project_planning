package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func statusConst(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func statusDuration(v float64) *model.GenericFormulaExpr {
	e := statusConst(v)
	return &e
}

func sourceTargetLifecycle(duration float64) *model.ProviderLifecycle {
	return &model.ProviderLifecycle{
		DurationMs:    statusDuration(duration),
		MaxStacks:     1,
		RefreshPolicy: model.RefreshPolicyReplace,
		InstanceScope: model.InstanceScopeSourceTarget,
	}
}

func slowProvider(key, resultRef, statusKey string, strength, duration float64) model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: key,
		Kind:        "status",
		StableID:    key,
		Lifecycle:   sourceTargetLifecycle(duration),
		StatusContributions: []model.StatusContributionDefinition{{
			ResultRef:  resultRef,
			StatusKey:  statusKey,
			StatusKind: model.StatusKindMovementSlow,
			Strength:   statusConst(strength),
		}},
	}
}

func applyOp(def string) model.OperationDefinition {
	return model.OperationDefinition{Operation: "apply_provider", Target: model.SelectorTarget, ProviderDefinitionRef: def}
}

func statusAbility(key string, params map[string]float64, ops ...model.OperationDefinition) model.AbilityDefinition {
	return model.AbilityDefinition{AbilityKey: key, Kind: "active", Params: params, Operations: ops}
}

func withSlowProviders(t *testing.T, providers []model.ProviderDefinition, abilities []model.AbilityDefinition, entries []model.DriverEntry, durationMs int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := loadBasicFixture(t)
	c.SharedProviders = append(c.SharedProviders, providers...)
	c.SharedProviders[0].Abilities = abilities
	r.DriverPlan.Entries = entries
	r.StopPolicy.DurationMs = durationMs
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	return c, r
}

func effectiveSlow(t *testing.T, done model.DoneResult) model.EffectiveStatusSnapshot {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			if len(c.EffectiveStatuses) != 0 && c.Key == model.SelectorSource && len(c.EffectiveStatuses) == 0 {
				continue
			}
			continue
		}
		if len(c.EffectiveStatuses) == 0 {
			return model.EffectiveStatusSnapshot{Contributions: []model.EffectiveStatusContribution{}}
		}
		if c.EffectiveStatuses[0].StatusKind != model.StatusKindMovementSlow {
			t.Fatalf("statusKind=%q", c.EffectiveStatuses[0].StatusKind)
		}
		return c.EffectiveStatuses[0]
	}
	t.Fatal("missing target snapshot")
	return model.EffectiveStatusSnapshot{}
}

func providerEvidence(done model.DoneResult, kind model.EvidenceKind) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind == kind {
			out = append(out, item)
		}
	}
	return out
}
