// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

// A real process timer has priority over an ordinary anchored tick. The terminal
// tick must nevertheless settle the old window before that timer can expire or
// replace its target state.
func anchoredBoundaryFixture(t *testing.T, writeAt int64, refresh bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs: 1000, durationMs: 1000, maxStacks: 1, tickAmount: 10, formulaReadsStacks: true,
	})
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"})
	operations := []model.OperationDefinition{{
		Operation: "damage", Target: "target", Ref: "op:boundary_probe", DamageType: "damage/true",
		Amount: &model.GenericFormulaExpr{Op: "read", Path: "provider.target_state." + anchoredVenomStateKey},
	}}
	if refresh {
		operations = append(operations, c.SharedProviders[0].Abilities[0].Operations[0])
	}
	c.SharedProviders[0].Processes = []model.ProcessDefinition{{
		ProcessKey: "boundary_probe", SkillKey: "skill:boundary_probe",
		Steps:            []model.ProcessStepDefinition{{StepKey: "delay", StepType: "DELAY", DelayMs: timedShieldExpr(1000)}},
		MomentOperations: []model.ProcessMomentOperations{{Moment: processMoment("STEP_EXECUTION", "delay", ""), Operations: operations}},
	}}
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "boundary_probe", Kind: "active", SkillKey: "skill:boundary_probe", Types: []string{"ability/spell"},
		ProcessControl: &model.ProcessControlDefinition{ProcessKey: "boundary_probe", Action: "INITIAL"},
	})
	r.DriverPlan.Entries[0].FirstAtMs = writeAt
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{
		EntryKey: "boundary_probe", AbilityRef: "source.provider[champion:source_demo].ability[boundary_probe]",
		Source: "source", Target: "target", FirstAtMs: writeAt,
	})
	r.SkillUses = []model.SkillUseFact{{UseKey: "boundary_probe_use", Source: "source", SkillKey: "skill:boundary_probe", HistoryState: "complete"}}
	r.ProcessCommandFacts = []model.ProcessCommandFact{{DriverEntryKey: "boundary_probe", UseRef: "boundary_probe_use"}}
	r.StopPolicy.DurationMs = writeAt + 2500
	return c, r
}

func TestAnchoredTerminalBeforeSameTimeProcessRead(t *testing.T) {
	for _, writeAt := range []int64{0, 500} {
		t.Run(map[int64]string{0: "zero_start", 500: "nonzero_start"}[writeAt], func(t *testing.T) {
			c, r := anchoredBoundaryFixture(t, writeAt, false)
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			done, err := runtimeengine.RunGeneric(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			if times := anchoredTickTimes(done); len(times) != 1 || times[0] != writeAt+1000 {
				t.Fatalf("terminal tick swallowed by earlier process read: got %v, want [%d]", times, writeAt+1000)
			}
			if done.Summary.SourceDamageDealt != 10 {
				t.Fatalf("old window must deal 10, expired probe must read zero: %+v", done.Summary)
			}
		})
	}
}

func TestAnchoredTerminalBeforeSameTimeProcessRefresh(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, true)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	done, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	times := anchoredTickTimes(done)
	if len(times) != 2 || times[0] != 1000 || times[1] != 2000 {
		t.Fatalf("old window lost during exact-expiry refresh: got %v, want [1000 2000]", times)
	}
	if done.Summary.SourceDamageDealt != 20 {
		t.Fatalf("old and new windows must each deal 10, with no duplicate or stale probe: %+v", done.Summary)
	}
}

func TestAnchoredNonterminalTickKeepsOriginalProcessOrder(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	c.SharedProviders[0].Abilities[1].TickSpec.IntervalMs = 500
	c.SharedProviders[0].Processes[0].Steps[0].DelayMs = timedShieldExpr(500)
	done := processRun(t, c, r)
	var at500 []string
	for _, evidence := range done.Evidence.Items {
		if evidence.Kind == model.EvidenceKindDamage && evidence.TimeMs == 500 {
			at500 = append(at500, evidence.Ref)
		}
	}
	if !reflect.DeepEqual(at500, []string{"source.provider[champion:source_demo].ability[boundary_probe]", "source.provider[champion:source_demo].ability[venom_tick]"}) || done.Summary.SourceDamageDealt != 21 {
		t.Fatalf("nonterminal tick order changed: at500=%v damage=%v", at500, done.Summary.SourceDamageDealt)
	}
}

func TestAnchoredTerminalDoesNotClearCallbackRefresh(t *testing.T) {
	c, r := loadAnchoredVenomFixture(t, anchoredFixtureOpts{intervalMs: 1000, durationMs: 1000, maxStacks: 1, tickAmount: 10, formulaReadsStacks: true})
	c.SharedProviders[0].Abilities[1].TickSpec.OnTick = append(c.SharedProviders[0].Abilities[1].TickSpec.OnTick, c.SharedProviders[0].Abilities[0].Operations[0])
	r.StopPolicy.DurationMs = 2500
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	for i := 0; i < 3; i++ {
		done, err := runtimeengine.RunGeneric(compiled.Session, r)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(anchoredTickTimes(done), []int64{1000, 2000}) || done.Summary.SourceDamageDealt != 20 {
			t.Fatalf("callback refresh lost or duplicate across repeat %d: %+v", i, done.Summary)
		}
		bag := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")
		target := bag["targetState"].(map[string]interface{})
		if target["values"].(map[string]interface{})[anchoredVenomStateKey] != float64(1) || target["expireAt"].(map[string]interface{})[anchoredVenomStateKey] != float64(3000) {
			t.Fatalf("old terminal cleared newer window: %+v", target)
		}
	}
}

func TestAnchoredWindowEarlyClearInvalidatesOldTerminal(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "clear_window", Kind: "active", Types: []string{"ability/spell"}, Operations: []model.OperationDefinition{{
		Operation: "state_change", Target: "source", Ref: anchoredVenomStateKey, Types: []string{"state_scope/provider_target"}, ValuePolicy: "override", Amount: timedShieldExpr(0),
	}}})
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "clear_window", AbilityRef: "source.provider[champion:source_demo].ability[clear_window]", Source: "source", Target: "target", FirstAtMs: 900})
	done := processRun(t, c, r)
	if len(anchoredTickTimes(done)) != 0 || done.Summary.SourceDamageDealt != 0 {
		t.Fatalf("early-cleared window detonated from stale callback: %+v", done.Summary)
	}
}

func TestAnchoredBlockedTerminalStillExpiresAtomically(t *testing.T) {
	c, r := anchoredBoundaryFixture(t, 0, false)
	c.SharedProviders[0].Abilities[1].CastCondition = timedShieldExpr(0)
	done := processRun(t, c, r)
	if len(anchoredTickTimes(done)) != 0 || done.Summary.SourceDamageDealt != 0 {
		t.Fatalf("blocked callback executed: %+v", done.Summary)
	}
	count := 0
	for _, evidence := range done.Evidence.Items {
		if evidence.Kind == "provider_target_state_expired" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("blocked callback did not publish one real expiry: %d", count)
	}
}
