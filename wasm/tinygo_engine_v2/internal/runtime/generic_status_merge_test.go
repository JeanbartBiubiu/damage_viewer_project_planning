package runtime

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
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

func TestSlowCrossSourceMaxAndWeakerRecovery(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow30", "result:slow30", "slow_a", 0.3, 3000),
		slowProvider("status:slow70", "result:slow70", "slow_b", 0.7, 1000),
	}, []model.AbilityDefinition{
		statusAbility("apply_both", nil, applyOp("status:slow30"), applyOp("status:slow70")),
	}, []model.DriverEntry{{
		EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply_both]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 1500)
	done := c1Run(t, c, r)
	got := effectiveSlow(t, done)
	if got.Strength != 0.3 || len(got.Contributions) != 1 || got.Contributions[0].Strength != 0.3 {
		t.Fatalf("after 70%% expire want 30%% remaining: %+v", got)
	}
	if len(providerEvidence(done, model.EvidenceKindProviderApply)) != 2 {
		t.Fatalf("apply evidence=%d", len(providerEvidence(done, model.EvidenceKindProviderApply)))
	}
	if len(providerEvidence(done, model.EvidenceKindProviderExpire)) == 0 {
		t.Fatal("missing expire evidence")
	}
}

func TestSlowSameSourceWeakerReapplyReplaces(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow", "result:slow", "slow_q", 0.7, 1000),
	}, []model.AbilityDefinition{
		statusAbility("apply_strong", map[string]float64{"strength": 0.7}, model.OperationDefinition{
			Operation: "apply_provider", Target: model.SelectorTarget, ProviderDefinitionRef: "status:slow",
		}),
		statusAbility("apply_weak", map[string]float64{"strength": 0.3}, model.OperationDefinition{
			Operation: "apply_provider", Target: model.SelectorTarget, ProviderDefinitionRef: "status:slow",
		}),
	}, []model.DriverEntry{
		{EntryKey: "strong", AbilityRef: "source.provider[champion:source_demo].ability[apply_strong]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "weak", AbilityRef: "source.provider[champion:source_demo].ability[apply_weak]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 500},
	}, 1200)
	c.SharedProviders[1].StatusContributions[0].Strength = model.GenericFormulaExpr{Op: "read", Path: "ability.param.strength"}
	done := c1Run(t, c, r)
	got := effectiveSlow(t, done)
	if got.Strength != 0.3 {
		t.Fatalf("weaker reapply must replace, got %+v", got)
	}
	var target model.CombatantSnapshot
	for _, snap := range done.FinalSnapshot.Combatants {
		if snap.Key == model.SelectorTarget {
			target = snap
		}
	}
	if len(target.Providers) != 1 {
		t.Fatalf("same source must reuse instance: %+v", target.Providers)
	}
	if target.Providers[0].ExpireAt == nil || *target.Providers[0].ExpireAt != 1500 {
		t.Fatalf("expireAt=%v want 1500", target.Providers[0].ExpireAt)
	}
	if len(providerEvidence(done, model.EvidenceKindProviderRefresh)) == 0 {
		t.Fatal("reapply should record refresh")
	}
	if len(providerEvidence(done, model.EvidenceKindProviderExpire)) != 0 {
		t.Fatalf("stale expire must not remove: %+v", providerEvidence(done, model.EvidenceKindProviderExpire))
	}
}

func TestSlowParamAndAttributeSnapshot(t *testing.T) {
	c, r := loadBasicFixture(t)
	c.Combatants[0].Attributes["slow_power"] = model.AttributeSlotDef{Base: 0.4, Current: 0.4, Max: 1, Resolved: 0.4}
	r.InitialSnapshot.Combatants[0].Attributes["slow_power"] = model.AttributeSlotDef{Base: 0.4, Current: 0.4, Max: 1, Resolved: 0.4}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{
		ProviderKey: "status:slow", Kind: "status", StableID: "slow", Lifecycle: sourceTargetLifecycle(3000),
		StatusContributions: []model.StatusContributionDefinition{{
			ResultRef: "result:slow", StatusKey: "slow_q", StatusKind: model.StatusKindMovementSlow,
			Strength: model.GenericFormulaExpr{Op: "read", Path: "source.attr.slow_power.resolved"},
		}},
	})
	one := 1.0
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		statusAbility("apply", nil, applyOp("status:slow"), model.OperationDefinition{
			Operation: "attribute_change", Target: model.SelectorSource, AttributeKey: "slow_power",
			Amount: &model.GenericFormulaExpr{Op: "const", Value: &one}, ValuePolicy: "set",
		}),
	}
	r.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}
	r.StopPolicy.DurationMs = 200
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	done := c1Run(t, c, r)
	got := effectiveSlow(t, done)
	if got.Strength != 0.4 {
		t.Fatalf("must snapshot apply-time attribute, got %+v", got)
	}
}

func TestSlowZeroStrengthDistinctFromMissing(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow0", "result:slow0", "slow_zero", 0, 1000),
	}, []model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow0"))}, []model.DriverEntry{{
		EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 200)
	done := c1Run(t, c, r)
	got := effectiveSlow(t, done)
	if got.Strength != 0 || len(got.Contributions) != 1 {
		t.Fatalf("zero must remain: %+v", got)
	}
	if got.Contributions[0].Strength != 0 {
		t.Fatalf("zero contribution dropped: %+v", got.Contributions)
	}
}

func TestSlowDifferentStatusKeyStillTakesMax(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow_a", "result:a", "slow_a", 0.3, 2000),
		slowProvider("status:slow_b", "result:b", "slow_b", 0.5, 2000),
	}, []model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow_a"), applyOp("status:slow_b"))}, []model.DriverEntry{{
		EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 200)
	done := c1Run(t, c, r)
	got := effectiveSlow(t, done)
	if got.Strength != 0.5 || len(got.Contributions) != 2 {
		t.Fatalf("different statusKey still take max: %+v", got)
	}
}

func TestSlowInclusiveExpiryBoundary(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow", "result:slow", "slow_q", 0.4, 1000),
	}, []model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow"))}, []model.DriverEntry{{
		EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 1000)
	done := c1Run(t, c, r)
	got := effectiveSlow(t, done)
	if len(got.Contributions) != 0 {
		t.Fatalf("expireAt==now must exclude: %+v", got)
	}
}

func TestSlowSnapshotRestoreRejectsAndAllowsExpiredTimestamp(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow", "result:slow", "slow_q", 0.3, 1000),
	}, []model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow"))}, []model.DriverEntry{}, 100)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("%+v", compiled.Result.Errors)
	}
	expire := int64(50)
	strength := 0.3
	r.InitialSnapshot.TimeMs = 100
	r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{
		ProviderRef: "status:slow#1", DefinitionRef: "status:slow", Source: "source", Owner: "target", Stacks: 1, ExpireAt: &expire,
		State: map[string]interface{}{},
		StatusContributions: []model.ProviderStatusContributionSnapshot{{
			ResultRef: "result:slow", StatusKey: "slow_q", StatusKind: model.StatusKindMovementSlow, Strength: &strength,
		}},
	}}
	done, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatalf("expired timestamp must be legal: %+v", err)
	}
	got := effectiveSlow(t, done)
	if len(got.Contributions) != 0 {
		t.Fatalf("already expired must be excluded: %+v", got)
	}

	r.InitialSnapshot.Combatants[1].Providers[0].StatusContributions[0].Strength = nil
	if _, err := RunGeneric(compiled.Session, r); err == nil || !strings.Contains(err.Path, "strength") {
		t.Fatalf("missing strength must path-error, err=%+v", err)
	}
}

func TestSlowUnknownDefinitionWithContributionsRejected(t *testing.T) {
	c, r := loadBasicFixture(t)
	strength := 0.2
	expire := int64(1000)
	r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{
		ProviderRef: "ghost#1", DefinitionRef: "status:missing", Source: "source", Owner: "target", Stacks: 1, ExpireAt: &expire,
		StatusContributions: []model.ProviderStatusContributionSnapshot{{
			ResultRef: "r", StatusKey: "k", StatusKind: model.StatusKindMovementSlow, Strength: &strength,
		}},
	}}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("%+v", compiled.Result.Errors)
	}
	_, err := RunGeneric(compiled.Session, r)
	if err == nil || !strings.Contains(err.Path, "definitionRef") {
		t.Fatalf("unknown definition with contributions must fail, err=%+v", err)
	}
}

func TestSlowRunIsolation(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow", "result:slow", "slow_q", 0.4, 2000),
	}, []model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow"))}, []model.DriverEntry{{
		EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 200)
	first := c1Run(t, c, r)
	second := c1Run(t, c, r)
	a := effectiveSlow(t, first)
	b := effectiveSlow(t, second)
	if a.Strength != b.Strength || len(a.Contributions) != len(b.Contributions) {
		t.Fatalf("runs not isolated: %+v vs %+v", a, b)
	}
}

func TestSlowFormulaErrorDoesNotMount(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow", "result:slow", "slow_q", 0.4, 1000),
	}, []model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow"))}, []model.DriverEntry{{
		EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 200)
	c.SharedProviders[1].StatusContributions[0].Strength = model.GenericFormulaExpr{Op: "read", Path: "source.attr.absent.resolved"}
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("%+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, r)
	if err == nil || err.Path == "" {
		t.Fatalf("expected path error, got %+v", err)
	}
}

func TestSlowNegativeDurationRejected(t *testing.T) {
	c, r := withSlowProviders(t, []model.ProviderDefinition{
		slowProvider("status:slow", "result:slow", "slow_q", 0.4, 1000),
	}, []model.AbilityDefinition{statusAbility("apply", nil, applyOp("status:slow"))}, []model.DriverEntry{{
		EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 200)
	neg := -10.0
	c.SharedProviders[1].Lifecycle.DurationMs = &model.GenericFormulaExpr{Op: "const", Value: &neg}
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("%+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, r)
	if err == nil || !strings.Contains(err.Message, "positive") {
		t.Fatalf("expected positive duration error, got %+v", err)
	}
}
