package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func empoweredLineageInput(t *testing.T, family string, transitive bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, run := empoweredInput(t, family+"_seed", 0, 1500, 2250)
	input.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringConst(1000)
	addMixedSpell(&input, &run, family+"_relay", 0, 100, true)
	if transitive {
		step := &input.SharedProviders[2].Processes[0].Steps[0]
		step.StepType, step.DelayMs = "IMMEDIATE", nil
		occupies := false
		step.OccupiesAction = &occupies
		addMixedSpell(&input, &run, family+"_consumer", 0, 100, true)
	}
	run.DriverPlan.SkillActions = []model.SkillActionPlan{}
	run.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{}}
	for i, binding := range input.Rules.SkillActionBindings {
		key := family + "_" + binding.SkillKey
		rule := model.AutomaticSkillRule{RuleKey: key, BindingKey: binding.BindingKey, SortOrder: i, Target: "target", HitBindings: []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "TARGET_HIT"}}, WaitForCooldowns: []string{}}
		if i == 0 {
			rule.Target, rule.HitBindings = "source", []model.SkillActionHitPreset{}
		} else {
			previous := run.DriverPlan.AutomaticSkills.Rules[i-1].RuleKey
			rule.ReleaseAfterRuleKey = &previous
		}
		run.DriverPlan.AutomaticSkills.Rules = append(run.DriverPlan.AutomaticSkills.Rules, rule)
	}
	return input, run
}

func TestEmpoweredPredecessorDirectAndTransitiveAcrossRecords(t *testing.T) {
	for _, family := range []string{"cobalt", "topaz"} {
		for _, transitive := range []bool{false, true} {
			var baseline model.DoneResult
			for _, mode := range []string{"detailed", "zero", "summary"} {
				t.Run(family+"/"+map[bool]string{false: "direct", true: "transitive"}[transitive]+"/"+mode, func(t *testing.T) {
					input, run := empoweredLineageInput(t, family, transitive)
					if mode == "summary" {
						run.OutputMode = model.RunOutputSummary
					}
					if mode == "zero" {
						zero := 0
						run.RecordBudget = &model.RecordBudget{MaxAutomaticSkillRecords: &zero, MaxAttackRecords: &zero, MaxDamageRecords: &zero}
					}
					done := authoringRun(t, input, run)
					if !done.Summary.Execution.Complete || done.Summary.BasicAttack.StartedCount != 3 {
						t.Fatal(done.Summary)
					}
					byUse := map[string]model.ProcessInstanceSnapshot{}
					for _, p := range done.FinalSnapshot.ProcessInstances {
						byUse[p.UseKey] = p
					}
					counts := map[string]int{}
					for _, p := range done.FinalSnapshot.ProcessInstances {
						if p.SkillKey == "test_attack" || p.SkillKey == family+"_seed" {
							if p.EmpoweredPredecessorUseRef != nil {
								t.Fatal("unqualified process gained provenance", p)
							}
							continue
						}
						if p.EmpoweredPredecessorUseRef == nil || p.Status != "complete" {
							t.Fatal("missing consumed predecessor", p)
						}
						parent := byUse[*p.EmpoweredPredecessorUseRef]
						wantSkill := family + "_seed"
						if p.SkillKey == family+"_consumer" {
							wantSkill = family + "_relay"
						}
						if parent.UseKey == "" || parent.SkillKey != wantSkill || parent.Owner != p.Owner || parent.Status != "complete" || *parent.FinishedAtMs != p.StartedAtMs {
							t.Fatal("not the real direct grantor", p, parent)
						}
						seed := parent
						if parent.EmpoweredPredecessorUseRef != nil {
							seed = byUse[*parent.EmpoweredPredecessorUseRef]
						}
						if seed.EmpoweredAttack == nil || *seed.LastExecutionAtMs != p.StartedAtMs {
							t.Fatal("lineage lacks real same-time empowered seed", p, seed)
						}
						attack := byUse[seed.EmpoweredAttack.UseRef]
						if attack.SkillKey != "test_attack" || attack.StartedAtMs != p.StartedAtMs {
							t.Fatal("lineage lacks the actual already-started attack", p, seed, attack)
						}
						counts[p.SkillKey]++
					}
					if counts[family+"_relay"] != 3 || transitive && counts[family+"_consumer"] != 3 {
						t.Fatal("multi-round chain did not execute", counts)
					}
					if mode == "detailed" {
						baseline = done
					} else if !reflect.DeepEqual(done.FinalSnapshot, baseline.FinalSnapshot) || !reflect.DeepEqual(done.AutomaticSkillSummary, baseline.AutomaticSkillSummary) || len(done.AutomaticSkillRecords)+len(done.AttackRecords)+len(done.DamageRecords) != 0 {
						t.Fatal("record limits changed causal snapshots", mode)
					}
					if os.Getenv("DAMAGE_EMPOWERED_LINEAGE_DUMP") == "1" {
						dir := filepath.Join("..", "..", "target", "priority-adaptation-2026-10-18", "empowered-lineage-v1")
						if err := os.MkdirAll(dir, 0755); err != nil {
							t.Fatal(err)
						}
						name := family + "_" + map[bool]string{false: "direct", true: "transitive"}[transitive] + "_" + mode
						for suffix, value := range map[string]any{"input": map[string]any{"compileRequest": input, "runRequest": run}, "done": done} {
							bytes, err := json.MarshalIndent(value, "", "  ")
							if err != nil {
								t.Fatal(err)
							}
							if err := os.WriteFile(filepath.Join(dir, name+"-"+suffix+".json"), bytes, 0644); err != nil {
								t.Fatal(err)
							}
						}
					}
				})
			}
		}
	}
}

func TestEmpoweredPredecessorAbsentOnOrdinaryChain(t *testing.T) {
	input, run := automaticChainInput(t, 3, false)
	done := authoringRun(t, input, run)
	for _, p := range done.FinalSnapshot.ProcessInstances {
		if p.EmpoweredPredecessorUseRef != nil {
			t.Fatal("ordinary chain gained empowered lineage", p)
		}
	}
	bytes, err := json.Marshal(done)
	if err != nil || strings.Contains(string(bytes), "empoweredPredecessorUseRef") {
		t.Fatal("ordinary output gained an optional field", err)
	}
}

func TestEmpoweredPredecessorFailedStartKeepsPendingGrant(t *testing.T) {
	for _, gate := range []string{"cost", "formula", "queue"} {
		t.Run(gate, func(t *testing.T) {
			input, run := empoweredLineageInput(t, "failed_cause", false)
			input.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 0, Max: 1}
			run.InitialSnapshot.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 0, Max: 1}
			input.SharedProviders[2].Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "energy", Amount: authoringConst(1)}}
			if gate == "formula" {
				input.SharedProviders[2].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Amount: authoringAmount(model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(0)}})}}}}
			}
			state, err := newGenericRunState(authoringCompile(t, input), run)
			if err != nil {
				t.Fatal(err)
			}
			state.durationMs = 0
			if err := state.runLoop(); err != nil {
				t.Fatal(err)
			}
			b := state.automaticSkills.rules[1]
			if b.qualification.RemainingCount != 1 || b.empoweredPredecessorUseRef == nil {
				t.Fatal("real seed did not grant lineage", b.qualification)
			}
			grant := *b.empoweredPredecessorUseRef
			if gate != "cost" {
				actor := state.combatants["source"]
				actor.resources["energy"] = model.ResourceSlotDef{Current: 1, Max: 1}
				state.combatants["source"] = actor
			}
			if gate == "queue" {
				state.heap = scheduler.NewGenericHeap(1)
				state.heap.SetLimit(1)
				state.heap.Push(scheduler.GenericEvent{TimeMs: 10000, Kind: scheduler.GenericEventSample})
			}
			key := "failed_start"
			action := &skillActionRuntime{automaticRule: b, plan: model.SkillActionPlan{InstructionKey: key, AbilityRef: b.abilityRef}, useRef: "skill:" + key}
			state.skillActionByUse[action.useRef], state.skillAction = action, action
			state.processFacts[key] = model.ProcessCommandFact{DriverEntryKey: key, UseRef: action.useRef}
			err = state.handleProcessCommand(model.DriverEntry{EntryKey: key, AbilityRef: b.abilityRef, Source: "source", Target: "target"}, -1, state.compiled.Abilities[b.controlIndex], b.abilityRef)
			if action.accepted || b.qualification.RemainingCount != 1 || b.qualification.ConsumedCount != 0 || b.empoweredPredecessorUseRef == nil || *b.empoweredPredecessorUseRef != grant || gate != "cost" && err == nil {
				t.Fatal("failed start changed the real pending grant", gate, err, b.qualification)
			}
			for _, p := range state.processInstances {
				if p.UseKey == action.useRef || p.EmpoweredPredecessorUseRef != nil {
					t.Fatal("failed start published lineage", p)
				}
			}
		})
	}
}

func TestEmpoweredPredecessorSnapshotRestoreRejected(t *testing.T) {
	input, run := empoweredLineageInput(t, "restore_cause", true)
	state, err := newGenericRunState(authoringCompile(t, input), run)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	for _, p := range state.processInstances {
		if p.EmpoweredPredecessorUseRef == nil {
			continue
		}
		for _, ref := range []string{*p.EmpoweredPredecessorUseRef, "forged_predecessor", ""} {
			row := p.ProcessInstanceSnapshot
			row.EmpoweredPredecessorUseRef = &ref
			if _, err := state.restoreProcess(row, "snapshot"); err == nil || !strings.Contains(err.Message, "empowered predecessor provenance cannot be restored") {
				t.Fatal("new causal snapshot restored", ref, err)
			}
		}
	}
}
