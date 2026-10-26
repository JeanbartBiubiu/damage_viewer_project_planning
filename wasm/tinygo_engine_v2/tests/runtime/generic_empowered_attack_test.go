// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	os "os"
	filepath "path/filepath"
	reflect "reflect"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func addEmpoweredAttack(t *testing.T, input *model.CompileRequest, run *model.RunRequest, family string, at, window int64, damage float64) {
	t.Helper()
	addMixedSpell(input, run, family, at, 1, false)
	provider := &input.SharedProviders[len(input.SharedProviders)-1]
	consume, self := "ATTACK_HIT", true
	step := &provider.Processes[0].Steps[0]
	step.StepType, step.DelayMs, step.WindowMs, step.ConsumeMoment = "EMPOWERED_BASIC_ATTACK", nil, timedShieldExpr(float64(window)), &consume
	provider.Processes[0].Cooldown.DurationMs = authoringConst(1)
	provider.Abilities[0].ProcessControl.RequireExplicitSelfTarget = &self
	provider.Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(damage)
	binding := &input.Rules.SkillActionBindings[len(input.Rules.SkillActionBindings)-1]
	binding.HitBindings[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &step.StepKey}
	plan := &run.DriverPlan.SkillActions[len(run.DriverPlan.SkillActions)-1]
	plan.Target, plan.HitBindings = "source", []model.SkillActionHitPreset{}
}

func empoweredInput(t *testing.T, family string, at, window, duration int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, run := continuousAttackInput(1, 100000, 10, 0, 0, duration)
	addEmpoweredAttack(t, &input, &run, family, at, window, 100)
	return input, run
}

func empoweredProcess(t *testing.T, done model.DoneResult, use string) model.ProcessInstanceSnapshot {
	t.Helper()
	for _, p := range done.FinalSnapshot.ProcessInstances {
		if p.UseKey == use {
			return p
		}
	}
	t.Fatalf("missing process %s: %+v", use, done.FinalSnapshot.ProcessInstances)
	return model.ProcessInstanceSnapshot{}
}

func TestEmpoweredAttackNativeTwoFamilies(t *testing.T) {
	for _, family := range []string{"amber_window", "quartz_promise"} {
		t.Run(family, func(t *testing.T) {
			for _, duration := range []int64{999, 2500} {
				input, run := empoweredInput(t, family, 200, 1500, duration)
				done := authoringRun(t, input, run)
				if duration == 2500 && os.Getenv("DAMAGE_EMPOWERED_DUMP") == "1" {
					dir := filepath.Join("..", "..", "target", "priority-adaptation-2026-10-18", "empowered-native")
					if err := os.MkdirAll(dir, 0755); err != nil {
						t.Fatal(err)
					}
					for _, value := range []struct {
						name  string
						value any
					}{{"compile", input}, {"request", run}, {"done", done}} {
						raw, err := json.MarshalIndent(value.value, "", "  ")
						if err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(filepath.Join(dir, family+"-"+value.name+".json"), raw, 0644); err != nil {
							t.Fatal(err)
						}
					}
				}
				p := empoweredProcess(t, done, "skill:"+family+"_first")
				if duration == 999 {
					if p.Status != "active" || p.StepExecutionIndex != 0 || p.EmpoweredAttack != nil || done.Summary.SourceDamageDealt != 10 || done.Summary.SkillUses.CompletedCount != 0 {
						t.Fatal(p, done.Summary)
					}
					continue
				}
				if p.Status != "complete" || p.StepExecutionIndex != 1 || p.EmpoweredAttack == nil || p.Target != "source" || p.EmpoweredAttack.Target != "target" || p.EmpoweredAttack.UseRef != done.AttackRecords[1].UseRef || p.EmpoweredAttack.HitRef != "hit:2" || *p.LastExecutionAtMs != 1000 || *p.FinishedAtMs != 1000 {
					t.Fatal(p, done.AttackRecords)
				}
				if done.Summary.SourceDamageDealt != 130 || done.Summary.SkillUses.StartedCount != 1 || done.Summary.SkillUses.HitCount != 1 || done.Summary.SkillUses.CompletedCount != 1 || done.Summary.SkillUses.StepExecutedCount != 1 || done.Summary.SkillUses.StepCompletedCount != 1 || done.Summary.BasicAttack.HitCount != 3 {
					t.Fatal(done.Summary)
				}
				found := 0
				for _, row := range done.DamageRecords {
					if row["useRef"] == p.UseKey {
						found++
						if row["hitRef"] != "hit:2" || !strings.Contains(row["abilityRef"].(string), "provider["+family+"]") || row["empoweredAttack"] == nil {
							t.Fatal(row)
						}
					}
				}
				if found != 1 {
					t.Fatal(done.DamageRecords)
				}
				for _, record := range done.SkillUseRecords {
					if record.Kind == "HIT" && (record.EmpoweredAttack == nil || record.HitRef == nil || *record.HitRef != "hit:2" || record.Target != "target") {
						t.Fatal(record)
					}
				}
			}
		})
	}
}

func TestEmpoweredAttackExpiryAndManualReplacement(t *testing.T) {
	for _, window := range []int64{799, 800, 801} {
		input, run := empoweredInput(t, "window", 200, window, 1200)
		done := authoringRun(t, input, run)
		p := empoweredProcess(t, done, "skill:window_first")
		if window <= 800 {
			if p.Status != "failed" || *p.FailureReason != "EVENT_ABORTED" || p.StepExecutionIndex != 0 || done.Summary.SourceDamageDealt != 20 || done.Summary.SkillUses.CompletedCount != 0 {
				t.Fatal(window, p, done.Summary)
			}
		} else if p.Status != "complete" || done.Summary.SourceDamageDealt != 120 {
			t.Fatal(window, p, done.Summary)
		}
	}
	input, run := empoweredInput(t, "replacement", 100, 700, 1300)
	again := run.DriverPlan.SkillActions[0]
	again.InstructionKey, again.FirstAtMs = "replacement_second", 500
	run.DriverPlan.SkillActions = append(run.DriverPlan.SkillActions, again)
	done := authoringRun(t, input, run)
	old := empoweredProcess(t, done, "skill:replacement_first")
	next := empoweredProcess(t, done, "skill:replacement_second")
	if old.Status != "failed" || *old.FinishedAtMs != 500 || *old.FailureReason != "EVENT_ABORTED" || old.EmpoweredAttack != nil || next.Status != "complete" || *next.ExpiresAtMs != 1200 || *next.LastExecutionAtMs != 1000 || done.Summary.SourceDamageDealt != 120 || done.Summary.SkillUses.FailedCount != 1 {
		t.Fatal(old, next, done.Summary)
	}
}

func TestEmpoweredAttackMultipleSourcesAndAtomicBudget(t *testing.T) {
	for _, budget := range []int{0, 6} {
		input, run := empoweredInput(t, "first_source", 100, 2000, 1300)
		addEmpoweredAttack(t, &input, &run, "other_source", 200, 2000, 200)
		if budget != 0 {
			run.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: budget}
		}
		done := authoringRun(t, input, run)
		first := empoweredProcess(t, done, "skill:first_source_first")
		other := empoweredProcess(t, done, "skill:other_source_first")
		if budget == 0 {
			if done.Summary.SourceDamageDealt != 320 || first.Status != "complete" || other.Status != "complete" || done.Summary.SkillUses.CompletedCount != 2 {
				t.Fatal(done.Summary, first, other)
			}
		} else {
			if done.Summary.Execution.BudgetCause == nil || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || first.Status != "active" || other.Status != "active" || first.EmpoweredAttack != nil || other.EmpoweredAttack != nil || done.Summary.SourceDamageDealt != 20 || done.Summary.SkillUses.CompletedCount != 0 || done.Summary.SkillUses.HitCount != 0 {
				t.Fatal(done.Summary, first, other)
			}
			if len(done.DamageRecords) != 2 {
				t.Fatal(done.DamageRecords)
			}
		}
	}
}

func TestEmpoweredAttackSummaryAndJSONAssociation(t *testing.T) {
	input, run := empoweredInput(t, "retained", 200, 1500, 2500)
	detailed := authoringRun(t, input, run)
	run.OutputMode = model.RunOutputSummary
	summary := authoringRun(t, input, run)
	if !reflect.DeepEqual(detailed.Summary, summary.Summary) || !reflect.DeepEqual(detailed.FinalSnapshot, summary.FinalSnapshot) {
		t.Fatal("recording changed execution")
	}
	raw, err := json.Marshal(detailed.FinalSnapshot.ProcessInstances)
	if err != nil {
		t.Fatal(err)
	}
	var roundtrip []model.ProcessInstanceSnapshot
	if err := json.Unmarshal(raw, &roundtrip); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(roundtrip, detailed.FinalSnapshot.ProcessInstances) {
		t.Fatal(string(raw))
	}
}

func TestEmpoweredAttackAutomaticQualification(t *testing.T) {
	for _, expires := range []bool{false, true} {
		input, run := empoweredInput(t, "automatic_wait", 0, 1500, 1200)
		addMixedSpell(&input, &run, "after_wait", 0, 100, false)
		if expires {
			input.SharedProviders[1].Processes[0].Steps[0].WindowMs = timedShieldExpr(500)
		}
		key := "first_rule"
		input.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringConst(10000)
		if expires {
			input.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringConst(200)
			run.StopPolicy.DurationMs = 900
		}
		run.DriverPlan.SkillActions = []model.SkillActionPlan{}
		run.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{
			{RuleKey: key, BindingKey: input.Rules.SkillActionBindings[0].BindingKey, SortOrder: 0, Target: "source", HitBindings: []model.SkillActionHitPreset{}, WaitForCooldowns: []string{}},
			{RuleKey: "next_rule", BindingKey: input.Rules.SkillActionBindings[1].BindingKey, SortOrder: 1, Target: "target", ReleaseAfterRuleKey: &key, HitBindings: []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "TARGET_HIT"}}, WaitForCooldowns: []string{}},
		}}
		done := authoringRun(t, input, run)
		if !expires {
			if done.AutomaticSkillSummary.Rules[0].CompletedCount < 1 || done.AutomaticSkillSummary.Rules[1].StartedCount != 1 || done.AutomaticSkillSummary.Qualifications[0].GrantedCount < 1 || done.AutomaticSkillSummary.Qualifications[0].ConsumedCount != 1 {
				t.Fatal(done.AutomaticSkillSummary)
			}
		} else if done.AutomaticSkillSummary.Rules[0].CompletedCount != 1 || done.AutomaticSkillSummary.Rules[0].FailedCount < 1 || done.AutomaticSkillSummary.Rules[1].StartedCount != 1 || done.AutomaticSkillSummary.Qualifications[0].GrantedCount != 1 {
			t.Fatal(done.AutomaticSkillSummary)
		}
	}
}

func TestEmpoweredAttackOrderedConditionsAndAlreadyDeadTarget(t *testing.T) {
	input, run := empoweredInput(t, "first_result", 100, 2000, 1300)
	addEmpoweredAttack(t, &input, &run, "following_result", 200, 2000, 200)
	first := &input.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates
	second := (*first)[0]
	second.CandidateKey, second.EffectOccurrenceKey, second.ResultKey = "second_result", "second_occurrence", "second_damage"
	second.Operations = []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "second_damage", Amount: timedShieldExpr(50)}}
	second.ParticipationCondition = authoringAmount(model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{{Op: "read", Path: "target.attr.hp.current"}, authoringConst(99980)}})
	*first = append(*first, second)
	input.SharedProviders[2].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = authoringAmount(model.GenericFormulaExpr{Op: "sub", Args: []model.GenericFormulaExpr{authoringConst(100000), {Op: "read", Path: "target.attr.hp.current"}}})
	done := authoringRun(t, input, run)
	if done.Summary.SourceDamageDealt != 340 {
		t.Fatal(done.Summary, done.DamageRecords)
	}
	for index, damage := range []float64{100, 50, 170} {
		if done.DamageRecords[index+2]["rawAmount"] != damage {
			t.Fatal(done.DamageRecords)
		}
	}
	input, run = empoweredInput(t, "last_contact", 200, 2000, 1300)
	hp := authoringSlot(15)
	input.Combatants[1].Attributes["hp"], run.InitialSnapshot.Combatants[1].Attributes["hp"] = hp, hp
	done = authoringRun(t, input, run)
	p := empoweredProcess(t, done, "skill:last_contact_first")
	if p.Status != "complete" || p.EmpoweredAttack == nil || done.Summary.SourceDamageDealt != 120 || done.Summary.TargetFinalHp != 0 || *p.LastExecutionAtMs != 1000 {
		t.Fatal(p, done.Summary)
	}
}
