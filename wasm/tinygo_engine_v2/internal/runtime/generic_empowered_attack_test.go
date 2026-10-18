package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func addEmpoweredAttack(t *testing.T, input *model.CompileRequest, run *model.RunRequest, family string, at, window int64, damage float64) {
	t.Helper()
	addMixedSpell(input, run, family, at, 1, false)
	provider := &input.SharedProviders[len(input.SharedProviders)-1]
	consume, self := "ATTACK_HIT", true
	step := &provider.Processes[0].Steps[0]
	step.StepType, step.DelayMs, step.WindowMs, step.ConsumeMoment = empoweredAttackStep, nil, timedShieldExpr(float64(window)), &consume
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

func TestEmpoweredAttackCompileAndRunGates(t *testing.T) {
	for _, change := range []string{"occupancy", "consume_start", "no_window", "prefix", "wrong_payload", "execution_operations"} {
		input, _ := empoweredInput(t, "gate", 200, 1500, 2500)
		p := &input.SharedProviders[len(input.SharedProviders)-1]
		switch change {
		case "occupancy":
			value := true
			p.Processes[0].Steps[0].OccupiesAction = &value
		case "consume_start":
			value := "ATTACK_START"
			p.Processes[0].Steps[0].ConsumeMoment = &value
		case "no_window":
			p.Processes[0].Steps[0].WindowMs = nil
		case "prefix":
			p.Processes[0].Steps = append([]model.ProcessStepDefinition{{StepKey: "prefix", StepType: "IMMEDIATE"}}, p.Processes[0].Steps...)
		case "wrong_payload":
			input.Rules.SkillActionBindings[0].HitBindings[0].HitAbilityRef = runOtherPayload()
		case "execution_operations":
			p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &p.Processes[0].Steps[0].StepKey}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(1)}}}}
		}
		if result := compilebundle.CompileGeneric(input); result.OK {
			t.Fatal(change, "unexpectedly compiled")
		}
	}
	for _, change := range []string{"no_attack", "preset", "wrong_target"} {
		input, run := empoweredInput(t, "gate", 200, 1500, 2500)
		switch change {
		case "no_attack":
			run.DriverPlan.BasicAttack = nil
		case "preset":
			run.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "TARGET_HIT"}}
		case "wrong_target":
			run.DriverPlan.SkillActions[0].Target = "target"
		}
		_, err := newGenericRunState(authoringCompile(t, input), run)
		if err == nil {
			t.Fatal(change, "unexpectedly admitted")
		}
	}
}

func runOtherPayload() string { return "source.provider[not_the_mount].ability[hit]" }

func mountEmpoweredSpellShield(input *model.CompileRequest, run *model.RunRequest, heal bool) {
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.ProviderTypeSpellShield, Domain: "provider"}, model.TypeCatalogEntry{Key: model.EventTypeSpellShieldBlocked, Domain: "event"})
	operations := []model.OperationDefinition{{Operation: "expire_provider", Target: "self", ProviderRefFromEvent: true}}
	if heal {
		operations = append([]model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(40)}}, operations...)
	}
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: "ward_definition", Kind: "status", StableID: "ward", Types: []string{model.ProviderTypeSpellShield}, Listeners: []model.ListenerDefinition{{ListenerKey: "ward_consumption", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSpellShieldBlocked}}, Operations: operations}}})
	_ = run
}

func TestEmpoweredAttackSpellShieldConsumedOnceAcrossSources(t *testing.T) {
	input, run := empoweredInput(t, "blocked_source", 100, 2000, 1300)
	addEmpoweredAttack(t, &input, &run, "later_source", 200, 2000, 200)
	for i := 1; i <= 2; i++ {
		candidate := &input.SharedProviders[i].Abilities[1].Operations[0].SkillHit.Candidates[0]
		candidate.SpellShieldBlockScope = hitScope(model.SpellShieldScopeSkill)
		candidate.EventValueConditions = []model.SkillHitEventValueCondition{{Key: "blocked", Comparator: "eq", Value: authoringConst(0)}}
	}
	mountEmpoweredSpellShield(&input, &run, true)
	// The old continuous-input admission intentionally excludes unmounted
	// status operations. Build the unchanged allowed selection first, then add
	// the already compiled status definition through the real runtime API.
	compiled := authoringCompile(t, input)
	plain := input
	plain.SharedProviders = append([]model.ProviderDefinition(nil), input.SharedProviders[:len(input.SharedProviders)-1]...)
	state, err := newGenericRunState(authoringCompile(t, plain), run)
	if err != nil {
		t.Fatal(err)
	}
	state.compiled = compiled
	state.formulas = compiled.Formulas
	if err := state.applyProviderInstance("target", "target", "ward_definition", 5000, true, nil); err != nil {
		t.Fatal(err)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult()
	if done.Summary.SourceDamageDealt != 220 || done.Summary.TargetFinalHp != 99800 || done.Summary.SourceFinalHp != 1000 || done.Summary.SkillUses.CompletedCount != 2 || done.Summary.SkillUses.HitCount != 2 || len(done.FinalSnapshot.Combatants[1].Providers) != 0 {
		t.Fatal(done.Summary, done.FinalSnapshot.Combatants[1])
	}
	if len(emittedEventsByRef(done, model.EventTypeSpellShieldBlocked)) != 1 {
		t.Fatal(done.Evidence)
	}
	if empoweredProcess(t, done, "skill:blocked_source_first").Status != "complete" || empoweredProcess(t, done, "skill:later_source_first").Status != "complete" {
		t.Fatal(done.FinalSnapshot.ProcessInstances)
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

func TestEmpoweredAttackFailedRefreshPreservesOldWindow(t *testing.T) {
	for _, gate := range []string{"cooldown", "cost", "formula", "queue"} {
		t.Run(gate, func(t *testing.T) {
			input, run := empoweredInput(t, "replace_guard", 100, 1500, 1300)
			p := &input.SharedProviders[1]
			second := run.DriverPlan.SkillActions[0]
			second.InstructionKey, second.FirstAtMs = "bad_refresh", 500
			run.DriverPlan.SkillActions = append(run.DriverPlan.SkillActions, second)
			switch gate {
			case "cooldown":
				p.Processes[0].Cooldown.DurationMs = authoringConst(1000)
			case "cost":
				input.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 1, Max: 1}
				run.InitialSnapshot.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 1, Max: 1}
				p.Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "energy", Amount: authoringConst(1)}}
			case "formula":
				p.Processes[0].Steps[0].WindowMs = authoringAmount(model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{{Op: "eq", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.state.ready"}, authoringConst(0)}}, authoringConst(1500), {Op: "div", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(0)}}}})
				p.InitialStateSchema = map[string]interface{}{"ready": float64(0)}
				p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_START", StepKey: &p.Processes[0].Steps[0].StepKey}, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{stateScopeProvider}, Ref: "ready", ValuePolicy: "override", Amount: timedShieldExpr(1)}}}}
				input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"})
			}
			state, err := newGenericRunState(authoringCompile(t, input), run)
			if err != nil {
				t.Fatal(err)
			}
			if gate == "queue" {
				// Execute the first activation through the real loop, then fill only
				// the bounded queue before the second real scheduled activation.
				state.durationMs = 499
				if err := state.runLoop(); err != nil {
					t.Fatal(err)
				}
				state.durationMs, state.nowMs = 1300, 500
				for state.heap.RemainingCapacity() > 0 {
					state.heap.Push(scheduler.GenericEvent{TimeMs: 99999, Kind: scheduler.GenericEventSample})
				}
				err = state.handleSkillAction(1)
			} else {
				err = state.runLoop()
			}
			if gate == "formula" || gate == "queue" {
				old := state.processInstances[1]
				if err == nil || old.Status != "active" || old.UseKey != "skill:replace_guard_first" || *old.ExpiresAtMs != 1600 || len(state.processInstances) != 2 || len(state.empoweredWaits) != 1 {
					t.Fatal(gate, err, state.snapshotProcesses())
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				done := state.buildDoneResult()
				old := empoweredProcess(t, done, "skill:replace_guard_first")
				if old.Status != "complete" || done.Summary.SkillActions.RejectedCount != 1 || done.Summary.SkillUses.StartedCount != 1 {
					t.Fatal(gate, old, done.Summary)
				}
			}
		})
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

func TestEmpoweredAttackFrozenIdentity(t *testing.T) {
	input, run := empoweredInput(t, "historical", 100, 2000, 1300)
	second := run.DriverPlan.SkillActions[0]
	second.InstructionKey, second.FirstAtMs = "new_activation", 1000
	run.DriverPlan.SkillActions = append(run.DriverPlan.SkillActions, second)
	state, err := newGenericRunState(authoringCompile(t, input), run)
	if err != nil {
		t.Fatal(err)
	}
	state.durationMs = 999
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	waits := state.freezeEmpoweredWaits("source")
	if len(waits) != 1 {
		t.Fatal(waits)
	}
	state.nowMs, state.durationMs = 1000, 1300
	if err := state.handleSkillAction(1); err != nil {
		t.Fatal(err)
	}
	if state.empoweredWaitCurrent(waits[0], "source") || len(state.empoweredWaits) != 1 || state.empoweredWaits[0].UseKey != "skill:new_activation" {
		t.Fatal(state.snapshotProcesses())
	}
	if _, err := state.restoreProcess(state.empoweredWaits[0].ProcessInstanceSnapshot, "snapshot"); err == nil {
		t.Fatal("active empowered restore admitted")
	}
}

func TestEmpoweredAttackRestoreRejectsEveryStatusAndForgedHistory(t *testing.T) {
	for _, family := range []string{"amber_restore", "quartz_restore"} {
		for _, status := range []string{"active", "complete", "failed", "forged"} {
			t.Run(family+"/"+status, func(t *testing.T) {
				window, duration := int64(2000), int64(1300)
				if status == "active" {
					duration = 999
				}
				if status == "failed" {
					window = 500
				}
				input, run := empoweredInput(t, family, 200, window, duration)
				state, err := newGenericRunState(authoringCompile(t, input), run)
				if err != nil {
					t.Fatal(err)
				}
				if err := state.runLoop(); err != nil {
					t.Fatal(err)
				}
				row := empoweredProcess(t, state.buildDoneResult(), "skill:"+family+"_first")
				expected := status
				if status == "forged" {
					expected = "complete"
					copy := *row.EmpoweredAttack
					copy.HitRef = "hit:999999"
					row.EmpoweredAttack = &copy
				}
				if row.Status != expected {
					t.Fatal("unexpected real execution status", row)
				}
				if _, err := state.restoreProcess(row, "snapshot"); err == nil || !strings.Contains(err.Message, "empowered attack process snapshots cannot be restored") {
					t.Fatal("empowered snapshot restore was not explicitly rejected", status, err)
				}
			})
		}
	}
}
