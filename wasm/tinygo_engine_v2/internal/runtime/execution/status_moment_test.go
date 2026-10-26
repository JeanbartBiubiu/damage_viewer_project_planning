package execution

import (
	json "encoding/json"
	strings "strings"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func momentSlowValue(late model.GenericFormulaExpr) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{
		{Op: "lt", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.elapsed_ms"}, statusConst(1000)}},
		statusConst(0), late,
	}}
}

func momentSlowProvider() model.ProviderDefinition {
	provider := slowProvider("landing_slow", "slow", "landing", 0, 2500)
	provider.StatusContributions[0].ValueReadMode = model.StatusValueReadMomentEvaluation
	provider.StatusContributions[0].Strength = momentSlowValue(statusConst(.6))
	return provider
}

func momentSlowInput(t *testing.T, endpoint int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	return withSlowProviders(t, []model.ProviderDefinition{momentSlowProvider()},
		[]model.AbilityDefinition{statusAbility("apply", nil, applyOp("landing_slow"))},
		[]model.DriverEntry{{EntryKey: "apply", AbilityRef: timedShieldRef("apply"), Source: "source", Target: "target", FirstAtMs: 1125}}, endpoint)
}

func momentTargetProvider(t *testing.T, done model.DoneResult, definition string) (model.CombatantProviderSnapshot, bool) {
	t.Helper()
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key == "target" {
			for _, instance := range actor.Providers {
				if instance.DefinitionRef == definition {
					return instance, true
				}
			}
		}
	}
	return model.CombatantProviderSnapshot{}, false
}

func TestMomentSlowQuietEndpointAndInclusiveExpiry(t *testing.T) {
	for _, endpoint := range []int64{1124, 1125, 2124, 2125, 3624, 3625} {
		t.Run(itoa(uint32(endpoint)), func(t *testing.T) {
			c, r := momentSlowInput(t, endpoint)
			done := c1Run(t, c, r)
			got := effectiveSlow(t, done)
			provider, present := momentTargetProvider(t, done, "landing_slow")
			wantPresent := endpoint >= 1125 && endpoint < 3625
			if present != wantPresent || len(got.Contributions) != boolInt(wantPresent) || done.FinalSnapshot.TimeMs != endpoint {
				t.Fatal(endpoint, provider, present, got, done.FinalSnapshot.TimeMs)
			}
			if !present {
				return
			}
			want := 0.0
			if endpoint >= 2125 {
				want = .6
			}
			if provider.AppliedAtMs == nil || *provider.AppliedAtMs != 1125 || provider.ExpireAt == nil || *provider.ExpireAt != 3625 || len(provider.StatusContributions) != 1 || provider.StatusContributions[0].Strength == nil || *provider.StatusContributions[0].Strength != want || got.Strength != want || got.Contributions[0].Strength != want {
				t.Fatal("current output and max contribution diverged", endpoint, provider, got)
			}
			applied := providerEvidence(done, model.EvidenceKindProviderApply)
			if len(applied) != 1 || applied[0].TimeMs != 1125 || applied[0].Data["statusContributions"].([]map[string]interface{})[0]["strength"] != 0.0 {
				t.Fatal("observation rewrote the true application snapshot", applied)
			}
		})
	}
	// There is only the original apply and its existing expiry, no landing tick.
	c, r := momentSlowInput(t, 3625)
	s := frameCommitState(t, c, r)
	if err := s.runLoop(); err != nil || s.loop.ProcessedEvents() != 2 {
		t.Fatal("elapsed slow added an event", s.loop.ProcessedEvents(), err)
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func TestMomentSlowSnapshotRequiresAppliedAtAndObservationsDoNotMutate(t *testing.T) {
	c, r := momentSlowInput(t, 3624)
	r.DriverPlan.Entries[0].FirstAtMs = 0
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	before, _ := json.Marshal(s.combatants["target"].instances.Providers())
	s.loop.Advance(999)
	first := s.buildFinalSnapshot()
	s.loop.Advance(1000)
	second := s.buildFinalSnapshot()
	after, _ := json.Marshal(s.combatants["target"].instances.Providers())
	if string(before) != string(after) || effectiveSlow(t, model.DoneResult{FinalSnapshot: first}).Strength != 0 || effectiveSlow(t, model.DoneResult{FinalSnapshot: second}).Strength != .6 {
		t.Fatal("observation changed live application data or an older view", string(before), string(after), first, second)
	}
	compiled := compile.CompileGeneric(c)
	r.InitialSnapshot = second
	r.DriverPlan.Entries = nil
	r.StopPolicy.DurationMs = 1
	for _, applied := range []*int64{nil, int64PtrForElapsed(-1), int64PtrForElapsed(1001)} {
		bad := r
		bad.InitialSnapshot = model.Snapshot{}
		raw, _ := json.Marshal(second)
		if err := json.Unmarshal(raw, &bad.InitialSnapshot); err != nil {
			t.Fatal(err)
		}
		bad.InitialSnapshot.Combatants[1].Providers[0].AppliedAtMs = applied
		if done, err := runForTest(compiled.Session, bad); err == nil || done.OK || !strings.Contains(err.Path, "appliedAtMs") {
			t.Fatal("snapshot invented actual elapsed context", applied, err)
		}
	}
	if done, err := runForTest(compiled.Session, r); err != nil || !done.OK || effectiveSlow(t, done).Strength != .6 {
		t.Fatal("valid zero application time could not restore", err, done.Summary)
	}
	actor := s.combatants["target"]
	instance := actor.instances.Providers().At(0)
	instance.HasAppliedAt = false
	actor.instances.ReplaceProvider(0, instance)
	s.combatants["target"] = actor
	if done := s.buildDoneResult(false); done.OK || s.processFailure == nil {
		t.Fatal("internal observation fabricated missing instance context", done.OK, s.processFailure)
	}
}

func TestMomentSlowConstantStillRequiresAnActualInstance(t *testing.T) {
	c, r := momentSlowInput(t, 2125)
	c.SharedProviders[1].StatusContributions[0].Strength = statusConst(.6)
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	actor := s.combatants["target"]
	instance := actor.instances.Providers().At(0)
	instance.HasAppliedAt = false
	actor.instances.ReplaceProvider(0, instance)
	s.combatants["target"] = actor
	if done := s.buildDoneResult(false); done.OK || s.processFailure == nil {
		t.Fatal("constant MOMENT_EVALUATION bypassed the instance gate")
	}
}

func TestMomentSlowExpireAirborneKeepsIndependentSlow(t *testing.T) {
	c, r := momentSlowInput(t, 2125)
	airborne := stunProvider()
	airborne.ProviderKey, airborne.StableID = "airborne", "airborne"
	airborne.Types = []string{model.ClosedStatusKindProviderType[model.StatusKindAirborne]}
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: airborne.Types[0], Domain: "provider"})
	c.SharedProviders = append(c.SharedProviders, airborne)
	c.SharedProviders[0].Abilities[0].Operations = append(c.SharedProviders[0].Abilities[0].Operations, applyOp("airborne"))
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	s.loop.Advance(500)
	airRef := ""
	for instanceIndex, instanceValues := 0, s.combatants["target"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		instance := instanceValues.At(instanceIndex)
		if instance.DefinitionRef == "airborne" {
			airRef = instance.ProviderRef
		}
	}
	if airRef == "" {
		t.Fatal("no actual airborne instance")
	}
	f := s.newExecutionFrame("source", "target", "")
	if err := f.executeOperations(planbundle.CompiledAbility{}, []planbundle.CompiledOperation{{Operation: "expire_provider", Target: "target", ProviderRef: airRef}}); err != nil {
		t.Fatal(err)
	}
	f.commit()
	if f.fatal || !f.committed {
		t.Fatal("existing expire operation failed", f.fatalErr)
	}
	s.loop.Advance(1000)
	done := s.buildDoneResult(false)
	if _, airbornePresent := momentTargetProvider(t, done, "airborne"); airbornePresent || effectiveSlow(t, done).Strength != .6 {
		t.Fatal("clearing the independent airborne removed the slow", done.FinalSnapshot)
	}
}
