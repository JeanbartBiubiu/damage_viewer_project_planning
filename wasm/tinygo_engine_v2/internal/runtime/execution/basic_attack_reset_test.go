package execution

import (
	json "encoding/json"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

// The authoring ATTACK_TIMER_RESET result is lowered to an existing operation.
// These arbitrary identities test that neither a hero key nor a conventional
// attack provider/control name is necessary. No new operation is introduced.
func resetAttackInput(t *testing.T, family string, ammo bool, duration int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, request := continuousAttackInput(1, 100000, 10, 0, 0, duration)
	if ammo {
		input, request = ammoAttackInput(1, 1000, duration)
	}
	rename := strings.NewReplacer(
		`"test_attack"`, `"`+family+`_strike"`,
		`"attack"`, `"`+family+`_mount"`,
		`provider[attack]`, `provider[`+family+`_mount]`,
		`"native_start"`, `"`+family+`_begin"`, `ability[native_start]`, `ability[`+family+`_begin]`,
		`"initial"`, `"`+family+`_control"`, `ability[initial]`, `ability[`+family+`_control]`,
		`"native_hit"`, `"`+family+`_impact"`, `ability[native_hit]`, `ability[`+family+`_impact]`,
	)
	for _, value := range []any{&input, &request} {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(rename.Replace(string(raw))), value); err != nil {
			t.Fatal(err)
		}
	}
	request.DriverPlan.BasicAttack.PlanKey = family + "_cadence"
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
	addMixedSpell(&input, &request, family+"_release", 200, 1, false)
	provider := &input.SharedProviders[len(input.SharedProviders)-1]
	provider.Abilities = provider.Abilities[:1]
	provider.Processes[0].Steps[0].StepType = "IMMEDIATE"
	provider.Processes[0].Steps[0].DelayMs = nil
	provider.Processes[0].Cooldown.DurationMs = authoringConst(1)
	provider.Processes[0].MomentOperations = []model.ProcessMomentOperations{{
		Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"},
		Operations: []model.OperationDefinition{{Operation: "cooldown_change", Target: "self",
			AbilityRef:  request.DriverPlan.BasicAttack.InitialControlAbilityRef,
			ValuePolicy: "set_remaining", Amount: timedShieldExpr(0)}},
	}}
	input.Rules.SkillActionBindings[0].HitBindings = []model.SkillActionHitBinding{}
	request.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{}
	return input, request
}

func resetAttackState(t *testing.T, input model.CompileRequest, request model.RunRequest) *Engine {
	t.Helper()
	state, err := newGenericRunState(authoringCompile(t, input), request)
	if err != nil {
		t.Fatal(err)
	}
	first, found := takeNextEventForTest(state.loop)
	if !found || first.Kind != scheduler.GenericEventBasicAttack || first.TimeMs != 0 {
		t.Fatal("expected real first native attack", first)
	}
	state.loop.Advance(first.TimeMs)
	if err := state.handleBasicAttack(); err != nil {
		t.Fatal(err)
	}
	if state.basicAttackReadyAt() != 1000 || state.actions.BasicAttack().Wait() == nil {
		t.Fatal("first attack did not publish its actual interval", state.actions.BasicAttack().Wait())
	}
	return state
}

func resetAttackFrame(t *testing.T, state *Engine, at int64) *Frame {
	t.Helper()
	state.loop.Advance(at)
	action := state.req.DriverPlan.SkillActions[0]
	reference := state.compiled.AbilityRefIndex[action.AbilityRef]
	ability := state.compiled.Abilities[reference.AbilityIndex]
	provider := state.compiled.Providers[reference.ProviderIndex]
	process := provider.Processes[ability.ProcessControl.ProcessIndex]
	parsed, ok := planbundle.ParseAbilityRef(action.AbilityRef)
	if !ok {
		t.Fatal(action)
	}
	frame := state.newExecutionFrame("source", "target", action.AbilityRef)
	frame.ownerCombatantKey, frame.ownerProviderRef = "source", parsed.ProviderRef
	for _, moment := range process.MomentOperations {
		if moment.Moment.MomentType == "PROCESS_START" {
			ops := state.compiled.Operations[int(moment.OperationStart) : int(moment.OperationStart)+int(moment.OperationCount)]
			if err := frame.executeOperations(ability, ops); err != nil {
				t.Fatal(err)
			}
		}
	}
	frame.commit()
	return frame
}

func resetQueuedAttack(t *testing.T, state *Engine) scheduler.GenericEvent {
	t.Helper()
	var attack scheduler.GenericEvent
	found := 0
	var queued []scheduler.GenericEvent
	for state.loop.QueuedEvents() > 0 {
		event, _ := takeNextEventForTest(state.loop)
		queued = append(queued, event)
		if event.Kind == scheduler.GenericEventBasicAttack {
			attack, found = event, found+1
		}
	}
	for _, event := range queued {
		if state.loop.Enqueue(event) != model.ErrOK {
			t.Fatal("could not return original queue event")
		}
	}
	if found != 1 {
		t.Fatal("expected one actual queued attack", found, queued)
	}
	return attack
}

func resetAssertStarts(t *testing.T, done model.DoneResult, expected ...int64) {
	t.Helper()
	if !done.Summary.Execution.Complete || len(done.AttackRecords) != len(expected) || done.Summary.BasicAttack.StartedCount != len(expected) {
		t.Fatal(done.Summary, done.AttackRecords)
	}
	for index, at := range expected {
		row := done.AttackRecords[index]
		if row.StartAtMs != at || row.HitAtMs == nil || *row.HitAtMs != at || !row.Completed {
			t.Fatal("unexpected real start or hit", row, expected)
		}
	}
}

func TestBasicAttackResetSameFrameLastWriteAndUniqueWaitVersion(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		for _, order := range []string{"reset_then_set", "set_then_reset", "reset_twice"} {
			t.Run(family+"/"+order, func(t *testing.T) {
				input, request := resetAttackInput(t, family, false, 1600)
				process := &input.SharedProviders[len(input.SharedProviders)-1].Processes[0]
				reset := process.MomentOperations[0].Operations[0]
				later := reset
				later.Amount = timedShieldExpr(350)
				want := int64(200)
				switch order {
				case "reset_then_set":
					process.MomentOperations[0].Operations = []model.OperationDefinition{reset, later}
					want = 550
				case "set_then_reset":
					process.MomentOperations[0].Operations = []model.OperationDefinition{later, reset}
				case "reset_twice":
					process.MomentOperations[0].Operations = []model.OperationDefinition{reset, reset}
				}
				state := resetAttackState(t, input, request)
				old := resetQueuedAttack(t, state)
				frame := resetAttackFrame(t, state, 200)
				if frame.fatal || !frame.committed {
					t.Fatal(frame.fatalErr)
				}
				next := resetQueuedAttack(t, state)
				key := basicAttackCooldownWaitKey(state.actions.BasicAttack())
				if next.TimeMs != want || next.Seq != old.Seq || next.BasicAttackGeneration == old.BasicAttackGeneration || state.basicAttackReadyAt() != want || !state.basicAttackEventCurrent(next) || state.basicAttackEventCurrent(old) || !state.combatants["source"].cooldowns.WaitCurrent(key, want, next.BasicAttackGeneration) {
					t.Fatal("same-frame final ledger value or old event version disagrees", order, old, next, state.actions.BasicAttack().Wait())
				}
				// Repeating the same successful reset before executing the next attack
				// must reuse the one node; it cannot preserve an earlier 350ms write.
				frame = resetAttackFrame(t, state, 200)
				if frame.fatal || resetQueuedAttack(t, state).TimeMs != want {
					t.Fatal(frame.fatalErr)
				}
				if order == "reset_twice" {
					done := authoringRun(t, input, request)
					resetAssertStarts(t, done, 0, want, want+1000)
				}
			})
		}
	}
}

func TestBasicAttackResetFailedPreflightLeavesOldClockAndQueue(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		t.Run(family, func(t *testing.T) {
			input, request := resetAttackInput(t, family, false, 2200)
			state := resetAttackState(t, input, request)
			old := resetQueuedAttack(t, state)
			state.currentEventCommands = 0
			state.budget.MaxCommandsPerEvent = 1
			frame := resetAttackFrame(t, state, 200)
			if !frame.fatal || frame.committed || frame.fatalErr.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || state.basicAttackReadyAt() != 1000 || resetQueuedAttack(t, state) != old || !state.basicAttackEventCurrent(old) || state.actions.BasicAttack().Wait().Remaining() != 1 {
				t.Fatal("failed commit published a reset or a new waiter version", frame.fatalErr, state.actions.BasicAttack().Wait())
			}
		})
	}
}

func TestBasicAttackResetSnapshotAndRestoreBoundaries(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		t.Run(family, func(t *testing.T) {
			input, request := resetAttackInput(t, family, false, 2200)
			state := resetAttackState(t, input, request)
			if frame := resetAttackFrame(t, state, 200); frame.fatal {
				t.Fatal(frame.fatalErr)
			}
			ref := request.DriverPlan.BasicAttack.InitialControlAbilityRef
			snapshot := state.buildFinalSnapshot()
			encoded, err := json.Marshal(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(encoded, &snapshot); err != nil {
				t.Fatal(err)
			}
			reset, found := snapshot.Combatants[0].Cooldowns[ref].(map[string]interface{})
			if !found || reset["readyAtMs"] != float64(200) || reset["remainingMs"] != float64(0) {
				t.Fatal("reset must export its actual deadline and zero remaining time", snapshot.Combatants[0].Cooldowns)
			}
			// Continuous plans explicitly require a new initial snapshot. Do not
			// invent restoration of pending cadence or serialize waiter versions.
			resumed := request
			resumed.InitialSnapshot = snapshot
			if _, issue := runForTest(state.compiled, resumed); issue == nil {
				t.Fatal("continuous attack silently accepted an already-used snapshot")
			}
			// Ordinary driver restore reads the public cooldown state, not stale
			// run-local wait generations. The selected control is ready at t=200.
			resumed.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{}}
			resumed.SkillUses, resumed.SkillHitFacts, resumed.AttackStartFacts, resumed.ProcessCommandFacts = nil, nil, nil, nil
			restored, issue := newGenericRunState(state.compiled, resumed)
			if issue != nil {
				t.Fatal(issue)
			}
			if _, waiting := restored.combatants["source"].cooldowns.Wait(basicAttackCooldownWaitKey(state.actions.BasicAttack())); !restored.combatants["source"].cooldowns.IsReady(actionpkg.AbilityCooldownIdentity("source", ref), snapshot.TimeMs) || waiting {
				t.Fatal("restore recreated a stale cadence waiter", restored.combatants["source"].cooldowns)
			}
		})
	}
}
