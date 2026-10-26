package execution

import (
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	scheduler "tinygo_engine_v2/internal/scheduler"
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
	if err := state.applyProviderInstance("target", "target", "ward_definition", 5000, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
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
				setTestLoopDuration(state, 499)
				if err := state.runLoop(); err != nil {
					t.Fatal(err)
				}
				setTestLoopDuration(state, 1300)
				state.loop.Advance(500)
				for state.loop.Queue().RemainingCapacity() > 0 {
					state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 99999, Kind: scheduler.GenericEventSample})
				}
				err = state.handleSkillAction(1)
			} else {
				err = state.runLoop()
			}
			if gate == "formula" || gate == "queue" {
				old := state.actions.ProcessAt(1)
				if err == nil || old.Status() != "active" || old.UseKey() != "skill:replace_guard_first" || *old.ExpiresAtMs() != 1600 || state.actions.ProcessCount() != 2 || state.actions.EmpoweredCount() != 1 {
					t.Fatal(gate, err, state.snapshotProcesses())
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				done := state.buildDoneResult(false)
				old := empoweredProcess(t, done, "skill:replace_guard_first")
				if old.Status != "complete" || done.Summary.SkillActions.RejectedCount != 1 || done.Summary.SkillUses.StartedCount != 1 {
					t.Fatal(gate, old, done.Summary)
				}
			}
		})
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
	setTestLoopDuration(state, 999)
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	waits := state.freezeEmpoweredWaits("source")
	if len(waits) != 1 {
		t.Fatal(waits)
	}
	state.loop.Advance(1000)
	setTestLoopDuration(state, 1300)
	if err := state.handleSkillAction(1); err != nil {
		t.Fatal(err)
	}
	if state.empoweredWaitCurrent(waits[0], "source") || state.actions.EmpoweredCount() != 1 || state.actions.EmpoweredAt(0).UseKey() != "skill:new_activation" {
		t.Fatal(state.snapshotProcesses())
	}
	if _, err := state.restoreProcess(state.actions.EmpoweredAt(0).Snapshot(), "snapshot"); err == nil {
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
				row := empoweredProcess(t, state.buildDoneResult(false), "skill:"+family+"_first")
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
