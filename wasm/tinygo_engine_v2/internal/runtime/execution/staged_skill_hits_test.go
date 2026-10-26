package execution

import (
	fmt "fmt"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// 三段各100，时间250/1000/1750；后两段只依赖第一段真实接触。
func stagedSkillInput(count int) (model.CompileRequest, model.RunRequest) {
	c, r := singleSkillInput(false)
	p, binding := &c.SharedProviders[0], &c.Rules.SkillActionBindings[0]
	p.Processes[0].Steps = nil
	p.Processes[0].Cooldown.DurationMs = *timedShieldExpr(10000)
	p.Abilities = p.Abilities[:1]
	binding.HitBindings = nil
	r.DriverPlan.SkillActions[0].FirstAtMs = 0
	r.DriverPlan.SkillActions[0].HitBindings = nil
	r.StopPolicy.DurationMs = 1900
	r.Sampling.Disabled = true
	for index := 0; index < count; index++ {
		key := fmt.Sprintf("phase_%02d", index)
		delay := float64(750)
		if index == 0 {
			delay = 250
		}
		p.Processes[0].Steps = append(p.Processes[0].Steps, model.ProcessStepDefinition{StepKey: key, StepType: "DELAY", DelayMs: timedShieldExpr(delay), OccupiesAction: model.BoolPtr(index == 0)})
		candidate := damageCand(key, key, key, model.SpellShieldScopeDamageInstance, 0)
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: key, Kind: "active", SkillKey: binding.SkillKey,
			Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: binding.SkillKey, Candidates: []model.SkillHitCandidate{candidate}}}}})
		hit := model.SkillActionHitBinding{HitBindingKey: key, ProcessKey: "cast", Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: hitUse(key)}, HitAbilityRef: "source.provider[caster].ability[" + key + "]"}
		if index > 0 {
			hit.RequiresPriorHitBindingKey = hitUse("phase_00")
		}
		binding.HitBindings = append(binding.HitBindings, hit)
		r.DriverPlan.SkillActions[0].HitBindings = append(r.DriverPlan.SkillActions[0].HitBindings, model.SkillActionHitPreset{HitBindingKey: key, Preset: "TARGET_HIT"})
	}
	return c, r
}

func TestStagedSkillContactIsolationAcrossUsesAndBindings(t *testing.T) {
	c, r := stagedSkillInput(3)
	c.SharedProviders[0].Processes[0].Cooldown.DurationMs = *timedShieldExpr(2000)
	second := r.DriverPlan.SkillActions[0]
	second.InstructionKey, second.FirstAtMs = "second_use", 2000
	second.HitBindings = append([]model.SkillActionHitPreset(nil), second.HitBindings...)
	second.HitBindings[0].Preset = "MISS"
	r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, second)
	r.StopPolicy.DurationMs = 3900
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil || s.runLoop() != nil {
		t.Fatal(err)
	}
	if !stagedAllHitContacts(s.actions.ActionForUse("skill:cast_once"), true) || !stagedAllHitContacts(s.actions.ActionForUse("skill:second_use"), false) || s.actions.ActionForUse("skill:second_use").NextHitSequence() != 0 || s.buildDoneResult(false).Summary.SourceDamageDealt != 300 {
		t.Fatal("contact leaked between uses", s.buildDoneResult(false).Summary)
	}
	// 先前同挂载的使用不能给本次未命中的使用提供前置位。
	a := s.actions.ActionForUse("skill:second_use")
	if a.HasRequiredHitContact(a.Binding().HitBindings[1]) {
		t.Fatal("another committed source qualified the missed use")
	}
	for iteration := 0; iteration < 5; iteration++ {
		done, runError := runForTest(compiled.Session, r)
		if runError != nil || done.Summary.SourceDamageDealt != 300 {
			t.Fatal("compiled session retained an earlier run's contact", runError, done.Summary)
		}
	}
}

func TestStagedSkillFactsUseActualDynamicTimeAndAreCopied(t *testing.T) {
	c, r := stagedSkillInput(3)
	c.SharedProviders[0].Processes[0].Steps[1].DelayMs = &model.GenericFormulaExpr{Op: "read", Path: "source.attr.hp.current"}
	c.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: hitUse("phase_00")}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(10)}}}}
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil || s.runLoop() != nil {
		t.Fatal(err)
	}
	row := s.snapshotProcesses()[0]
	for index, at := range []int64{250, 760, 1510} {
		if (*row.SkillHitStages)[index].TimeMs != at {
			t.Fatal("stage time was guessed from initial attributes", row.SkillHitStages)
		}
	}
	(*row.SkillHitStages)[0].Contact = false
	if !(*s.actions.ProcessAt(0).SkillHitStages())[0].Contact {
		t.Fatal("output aliases runtime facts")
	}
	var frame Frame
	s.initProcessFrame(&frame, s.actions.ProcessAt(0))
	(*frame.pendingProcess.SkillHitStages())[0].Contact = false
	if !(*s.actions.ProcessAt(0).SkillHitStages())[0].Contact {
		t.Fatal("uncommitted clone changed runtime facts")
	}
	if _, err := s.restoreProcess(row, "restored"); err == nil {
		t.Fatal("external contact facts restored")
	}
	row.SkillHitStages = nil
	if _, err := s.restoreProcess(row, "restored"); err == nil {
		t.Fatal("explicit staged use restored without its actual runtime qualification")
	}
	// 单个早期显式命中同样保留实际时刻，不依赖最后步骤快照。
	c, r = stagedSkillInput(3)
	c.Rules.SkillActionBindings[0].HitBindings = c.Rules.SkillActionBindings[0].HitBindings[:1]
	c.SharedProviders[0].Abilities = c.SharedProviders[0].Abilities[:2]
	r.DriverPlan.SkillActions[0].HitBindings = r.DriverPlan.SkillActions[0].HitBindings[:1]
	done := timedShieldMustRun(t, c, r)
	if facts := *done.FinalSnapshot.ProcessInstances[0].SkillHitStages; len(facts) != 1 || facts[0].TimeMs != 250 || !facts[0].Contact {
		t.Fatal(facts)
	}
}

func TestStagedSkillFailedContactDoesNotQualify(t *testing.T) {
	for _, kind := range []string{"cast_gate", "formula", "commands"} {
		t.Run(kind, func(t *testing.T) {
			c, r := stagedSkillInput(3)
			switch kind {
			case "cast_gate":
				c.SharedProviders[0].Abilities[1].CastCondition = timedShieldExpr(0)
			case "formula":
				c.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{{Op: "read", Path: "source.attr.hp.current"}, hitConst(0)}}
			case "commands":
				r.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
			}
			compiled := compilebundle.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result)
			}
			s, err := newGenericRunState(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			runError := s.runLoop()
			if kind == "formula" && runError == nil || kind == "commands" && s.budgetCause != model.BudgetCauseMaxCommandsPerEvent || kind == "cast_gate" && runError != nil {
				t.Fatal(kind, runError, s.budgetCause)
			}
			a := s.actions.ActionForUse("skill:cast_once")
			if !stagedAllHitContacts(a, false) || s.combatantHp("target") != 500 || a.Uses().ReleasedCount != 1 {
				t.Fatal("failed contact qualified a later stage or committed damage", a, s.buildDoneResult(false).Summary)
			}
			stage := (*s.actions.ProcessAt(0).SkillHitStages())[0]
			wantHits := 1
			if kind == "cast_gate" {
				wantHits = 0
			}
			if !stage.Released || stage.Contact != (kind != "cast_gate") || stage.Completed != (kind == "cast_gate") || a.Uses().HitCount != wantHits {
				t.Fatal("root fact, complete stage and dependency qualification were conflated", kind, stage, a.Uses())
			}
		})
	}
}

func stagedAllHitContacts(action *actionpkg.SkillActionView, want bool) bool {
	for _, hit := range action.Binding().HitBindings {
		key := hit.HitBindingKey
		if action.HasRequiredHitContact(model.SkillActionHitBinding{RequiresPriorHitBindingKey: &key}) != want {
			return false
		}
	}
	return true
}
