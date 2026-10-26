package execution

import (
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	actorpkg "tinygo_engine_v2/internal/runtime/actor"
	scheduler "tinygo_engine_v2/internal/scheduler"
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

func TestEmpoweredPredecessorCooldownWakePrecedesSameTimeBasicAttack(t *testing.T) {
	input, run := empoweredLineageInput(t, "same_time", false)
	state, err := newGenericRunState(authoringCompile(t, input), run)
	if err != nil {
		t.Fatal(err)
	}
	*state.loop.Queue() = scheduler.NewGenericHeap(2)
	if code := state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 1000, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventBasicAttack}); code != model.ErrOK {
		t.Fatal(code)
	}
	state.queueAutomaticSkills(2000)
	state.queueAutomaticSkills(1000)
	first, firstPresent := state.loop.Queue().Pop()
	second, secondPresent := state.loop.Queue().Pop()
	if !firstPresent || !secondPresent || first.Kind != scheduler.GenericEventAutomaticSkill || second.Kind != scheduler.GenericEventBasicAttack || first.TimeMs != 1000 || second.TimeMs != 1000 || first.Seq != 2 || second.Seq != 1 || first.AutomaticGeneration != state.actions.AutomaticGeneration() {
		t.Fatal("automatic cooldown wake must precede an already queued same-time attack while preserving event sequence", first, second)
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
			setTestLoopDuration(state, 0)
			if err := state.runLoop(); err != nil {
				t.Fatal(err)
			}
			b := state.actions.AutomaticAt(1)
			if b.Qualification().RemainingCount != 1 || !b.HasEmpoweredPredecessor() {
				t.Fatal("real seed did not grant lineage", b.Qualification())
			}
			grant := b.EmpoweredPredecessor()
			if gate != "cost" {
				actor := state.combatants["source"]
				changes := actorpkg.Stage(actor.numbers)
				changes.SetResource("energy", model.ResourceSlotDef{Current: 1, Max: 1})
				actor.numbers = changes.Publish(actor.numbers)
				state.combatants["source"] = actor
			}
			if gate == "queue" {
				*state.loop.Queue() = scheduler.NewGenericHeap(1)
				state.loop.Queue().SetLimit(1)
				state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 10000, Kind: scheduler.GenericEventSample})
			}
			key := "failed_start"
			action := actionpkg.NewSkillAction(actionpkg.SkillActionSeed{AutomaticRule: b, Plan: model.SkillActionPlan{InstructionKey: key, AbilityRef: b.AbilityRef()}, UseRef: "skill:" + key})
			state.actions.BindActionUse(action.UseRef(), action)
			state.actions.SetCurrentAction(action)
			state.actions.SetProcessFact(key, model.ProcessCommandFact{DriverEntryKey: key, UseRef: action.UseRef()})
			err = state.handleProcessCommand(model.DriverEntry{EntryKey: key, AbilityRef: b.AbilityRef(), Source: "source", Target: "target"}, -1, state.compiled.Abilities[b.ControlIndex()], b.AbilityRef())
			if action.Accepted() || b.Qualification().RemainingCount != 1 || b.Qualification().ConsumedCount != 0 || !b.HasEmpoweredPredecessor() || b.EmpoweredPredecessor() != grant || gate != "cost" && err == nil {
				t.Fatal("failed start changed the real pending grant", gate, err, b.Qualification())
			}
			for processSlot := 0; processSlot < state.actions.ProcessCount(); processSlot++ {
				p := state.actions.ProcessAt(processSlot)
				if p.UseKey() == action.UseRef() || p.EmpoweredPredecessorUseRef() != nil {
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
	for processSlot := 0; processSlot < state.actions.ProcessCount(); processSlot++ {
		p := state.actions.ProcessAt(processSlot)
		if p.EmpoweredPredecessorUseRef() == nil {
			continue
		}
		for _, ref := range []string{*p.EmpoweredPredecessorUseRef(), "forged_predecessor", ""} {
			row := p.Snapshot()
			row.EmpoweredPredecessorUseRef = &ref
			if _, err := state.restoreProcess(row, "snapshot"); err == nil || !strings.Contains(err.Message, "empowered predecessor provenance cannot be restored") {
				t.Fatal("new causal snapshot restored", ref, err)
			}
		}
	}
}
