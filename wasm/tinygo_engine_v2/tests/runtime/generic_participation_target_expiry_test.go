// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
)

// A real process starts at 100ms. Its sibling's ordinary target counter lasts
// 250ms, so the same-time ProcessTimer must see the declared default at 350ms.
func participationTargetCounterInput(delay, duration int64, arm bool) (model.CompileRequest, model.RunRequest) {
	compile, run := singleSkillInput(false)
	run.StopPolicy.DurationMs = 500
	compile.SharedProviders[0].Processes[0].Steps[0].DelayMs = timedShieldExpr(float64(delay))
	condition := model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{
		{Op: "read", Path: "provider.target_state.mark"}, *timedShieldExpr(0),
	}}
	candidate := &compile.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0]
	candidate.ParticipationProviderRef = "counter_mount"
	candidate.ParticipationCondition = &condition
	compile.TypeCatalog.Types = append(compile.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "state_scope/provider_target", Domain: "state_scope"},
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	counter := model.ProviderDefinition{ProviderKey: "counter_source", SkillKey: "sibling_counter", Kind: "character", StableID: "sibling_counter",
		InitialStateSchema: map[string]any{"mark": map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 1,
			"durationMs": duration}}}
	if duration > 0 {
		counter.InitialStateSchema["mark"].(map[string]any)["refreshPolicy"] = "refresh_on_write"
	}
	if arm {
		counter.Listeners = []model.ListenerDefinition{{ListenerKey: "arm_on_real_start",
			EventMatcher: model.TypeMatcher{All: []string{"event/ability_started", "event/source_owner"}}, MaxTriggersPerEvent: 1,
			Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "mark", Types: []string{"state_scope/provider_target"}, ValuePolicy: "set", Amount: timedShieldExpr(1)}}}}
	}
	compile.SharedProviders = append(compile.SharedProviders, counter)
	compile.Combatants[0].Providers = append(compile.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "counter_mount", DefinitionRef: counter.ProviderKey})
	run.InitialSnapshot.Combatants[0].Providers = append(run.InitialSnapshot.Combatants[0].Providers,
		model.CombatantProviderSnapshot{ProviderRef: "counter_mount", DefinitionRef: counter.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	return compile, run
}

func TestParticipationTargetCounterExactExpiry(t *testing.T) {
	for _, row := range []struct {
		name            string
		delay, duration int64
		wantDamage      float64
	}{
		{"before", 249, 250, 0},
		{"exact", 250, 250, 100},
		{"after", 251, 250, 100},
		{"untimed", 250, 0, 0},
	} {
		t.Run(row.name, func(t *testing.T) {
			compile, run := participationTargetCounterInput(row.delay, row.duration, true)
			done := timedShieldMustRun(t, compile, run)
			if done.Summary.SourceDamageDealt != row.wantDamage || !done.Summary.Execution.Complete {
				t.Fatalf("start=100 duration=%d hit=%d damage=%v want=%v complete=%v", row.duration, 100+row.delay,
					done.Summary.SourceDamageDealt, row.wantDamage, done.Summary.Execution.Complete)
			}
		})
	}
}

func TestParticipationTargetCounterWrongTargetDoesNotBorrowValues(t *testing.T) {
	for _, row := range []struct {
		name, storedTarget string
		wantDamage         float64
	}{
		{"same_target", "target", 0},
		{"other_target", "source", 100},
		{"new_target", "", 100},
	} {
		t.Run(row.name, func(t *testing.T) {
			compile, run := participationTargetCounterInput(249, 250, false)
			run.DriverPlan.SkillActions = nil
			run.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "contact", AbilityRef: "source.provider[caster].ability[hit]", Source: "source", Target: "target", FirstAtMs: 349}}
			run.SkillUses = []model.SkillUseFact{{UseKey: "current_contact", Source: "source", SkillKey: "configured_spell", HistoryState: "complete"}}
			run.SkillHitFacts = []model.SkillHitFact{{DriverEntryKey: "contact", UseRef: hitUse("current_contact"), Sequence: seqN(1)}}
			if row.storedTarget != "" {
				compile.SharedProviders[1].Abilities = []model.AbilityDefinition{{AbilityKey: "arm", Kind: "active", SkillKey: "sibling_counter", Types: []string{"ability/spell"},
					Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "mark", Types: []string{"state_scope/provider_target"}, ValuePolicy: "set", Amount: timedShieldExpr(1)}}}}
				run.DriverPlan.Entries = append(run.DriverPlan.Entries, model.DriverEntry{EntryKey: "arm", AbilityRef: "source.provider[counter_mount].ability[arm]", Source: "source", Target: row.storedTarget, FirstAtMs: 100})
			}
			done := timedShieldMustRun(t, compile, run)
			if done.Summary.SourceDamageDealt != row.wantDamage {
				t.Fatalf("target=%q damage=%v want=%v", row.storedTarget, done.Summary.SourceDamageDealt, row.wantDamage)
			}
		})
	}
}

func TestParticipationTargetCounterStillRequiresSameOriginalOwner(t *testing.T) {
	for _, variant := range []string{"other_owner", "missing_mount", "unknown_ref"} {
		t.Run(variant, func(t *testing.T) {
			request, _ := participationTargetCounterInput(250, 250, true)
			if variant == "unknown_ref" {
				request.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].ParticipationProviderRef = "not_mounted"
			} else {
				mount := request.Combatants[0].Providers[1]
				request.Combatants[0].Providers = request.Combatants[0].Providers[:1]
				if variant == "other_owner" {
					request.Combatants[1].Providers = append(request.Combatants[1].Providers, mount)
				}
			}
			compiled := compilebundle.CompileGeneric(request)
			if compiled.OK {
				t.Fatal("participation must stay bound to an original mount of the actual source")
			}
		})
	}
}
