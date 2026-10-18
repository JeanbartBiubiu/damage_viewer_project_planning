package runtime

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
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

func resetAttackState(t *testing.T, input model.CompileRequest, request model.RunRequest) *genericRunState {
	t.Helper()
	state, err := newGenericRunState(authoringCompile(t, input), request)
	if err != nil {
		t.Fatal(err)
	}
	first, found := state.heap.Pop()
	if !found || first.Kind != scheduler.GenericEventBasicAttack || first.TimeMs != 0 {
		t.Fatal("expected real first native attack", first)
	}
	state.nowMs = first.TimeMs
	if err := state.handleBasicAttack(); err != nil {
		t.Fatal(err)
	}
	if state.basicAttackReadyAt() != 1000 || state.basicAttack.wait == nil {
		t.Fatal("first attack did not publish its actual interval", state.basicAttack.wait)
	}
	return state
}

func resetAttackFrame(t *testing.T, state *genericRunState, at int64) *executionFrame {
	t.Helper()
	state.nowMs = at
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

func resetQueuedAttack(t *testing.T, state *genericRunState) scheduler.GenericEvent {
	t.Helper()
	var attack scheduler.GenericEvent
	found := 0
	var queued []scheduler.GenericEvent
	for state.heap.Len() > 0 {
		event, _ := state.heap.Pop()
		queued = append(queued, event)
		if event.Kind == scheduler.GenericEventBasicAttack {
			attack, found = event, found+1
		}
	}
	for _, event := range queued {
		if state.heap.Push(event) != model.ErrOK {
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

func TestBasicAttackResetLoweredOperationUsesSelectedInitialControl(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		t.Run(family, func(t *testing.T) {
			input, request := resetAttackInput(t, family, false, 2200)
			compiled := authoringCompile(t, input)
			ref := request.DriverPlan.BasicAttack.InitialControlAbilityRef
			selected := compiled.Abilities[compiled.AbilityRefIndex[ref].AbilityIndex]
			if selected.ProcessControl == nil || selected.ProcessControl.Action != "INITIAL" || !selected.ProcessControl.UseRefFromEvent {
				t.Fatal("reset target must be the selected actual native INITIAL", ref, selected)
			}
			done, err := RunGeneric(compiled, request)
			if err != nil {
				t.Fatal(err)
			}
			resetAssertStarts(t, done, 0, 200, 1200, 2200)
			first := done.AttackRecords[0]
			if *first.ReadyAtMs != 1000 || *first.FinalReadyAtMs != 200 || *first.NextStartAtMs != 200 || done.Summary.SourceDamageDealt != 40 || done.Summary.SkillActions.AcceptedCount != 1 {
				t.Fatal("reset duplicated damage or changed the wrong cooldown", first, done.Summary)
			}
			for _, mode := range []model.RunOutputMode{model.RunOutputDetailed, model.RunOutputSummary} {
				request.OutputMode = mode
				for iteration := 0; iteration < 3; iteration++ {
					repeat, issue := RunGeneric(compiled, request)
					if issue != nil || !reflect.DeepEqual(done.Summary, repeat.Summary) || !reflect.DeepEqual(done.FinalSnapshot, repeat.FinalSnapshot) {
						t.Fatal("output profile or repeated session changed calculation", mode, iteration, issue)
					}
				}
			}
		})
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
				key := basicAttackCooldownWaitKey(state.basicAttack)
				if next.TimeMs != want || next.Seq != old.Seq || next.BasicAttackGeneration == old.BasicAttackGeneration || state.basicAttackReadyAt() != want || !state.basicAttackEventCurrent(next) || state.basicAttackEventCurrent(old) || !state.combatants["source"].cooldowns.waitCurrent(key, want, next.BasicAttackGeneration) {
					t.Fatal("same-frame final ledger value or old event version disagrees", order, old, next, state.basicAttack.wait)
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

func TestBasicAttackResetPreservesActionAndAmmoGates(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		for _, gate := range []string{"action", "ammo", "action_and_ammo"} {
			t.Run(family+"/"+gate, func(t *testing.T) {
				input, request := resetAttackInput(t, family, gate != "action", 3500)
				want := int64(2500)
				if gate != "ammo" {
					step := &input.SharedProviders[len(input.SharedProviders)-1].Processes[0].Steps[0]
					step.StepType, step.DelayMs = "DELAY", timedShieldExpr(600)
					occupied := true
					step.OccupiesAction = &occupied
				}
				if gate == "action" {
					want = 800
				}
				done := authoringRun(t, input, request)
				if gate == "action" {
					resetAssertStarts(t, done, 0, 800, 1800, 2800)
					if done.AttackRecords[0].ActionReadyAtMs == nil || *done.AttackRecords[0].ActionReadyAtMs != 800 {
						t.Fatal("reset removed real action occupancy", done.AttackRecords)
					}
				} else {
					resetAssertStarts(t, done, 0, want, want+1000)
					if done.AttackRecords[0].MechanicReadyAtMs == nil || *done.AttackRecords[0].MechanicReadyAtMs != 2500 {
						t.Fatal("reset refilled or bypassed the empty magazine", done.AttackRecords, done.MechanicRecords)
					}
				}
				if *done.AttackRecords[0].FinalReadyAtMs != 200 {
					t.Fatal("ordinary attack interval was not reset independently", done.AttackRecords[0])
				}
			})
		}
	}
}

func TestBasicAttackResetAndSameFrameSpeedChangeKeepZeroRemaining(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		for _, resetFirst := range []bool{false, true} {
			t.Run(family+map[bool]string{false: "/speed_first", true: "/reset_first"}[resetFirst], func(t *testing.T) {
				input, request := resetAttackInput(t, family, false, 1200)
				process := &input.SharedProviders[len(input.SharedProviders)-1].Processes[0]
				reset := process.MomentOperations[0].Operations[0]
				speedRef := family + "_speed"
				speed := model.OperationDefinition{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: speedRef}
				process.MomentOperations[0].Operations = []model.OperationDefinition{speed, reset}
				if resetFirst {
					process.MomentOperations[0].Operations = []model.OperationDefinition{reset, speed}
				}
				input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: speedRef, Kind: "status", StableID: speedRef,
					Modifiers: []model.ModifierDefinition{{ModifierKey: "speed", Kind: "attribute", Target: "self.attr.attack_speed", ValuePolicy: "add", Value: *timedShieldExpr(1)}}})
				done := authoringRun(t, input, request)
				resetAssertStarts(t, done, 0, 200, 700, 1200)
				if *done.AttackRecords[0].FinalReadyAtMs != 200 || done.AttackRecords[1].AttackSpeed != 2 || *done.AttackRecords[1].ReadyAtMs != 700 {
					t.Fatal("speed change restored an obsolete pre-reset progress fraction", done.AttackRecords)
				}
			})
		}
	}
}

func TestBasicAttackResetRepeatedRealUsesDoNotDuplicateOldWait(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		t.Run(family, func(t *testing.T) {
			input, request := resetAttackInput(t, family, false, 1201)
			sameTime, nextTime := request.DriverPlan.SkillActions[0], request.DriverPlan.SkillActions[0]
			sameTime.InstructionKey += "_rejected"
			sameTime.SortOrder = 1
			nextTime.InstructionKey += "_next"
			nextTime.FirstAtMs = 201
			request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, sameTime, nextTime)
			done := authoringRun(t, input, request)
			resetAssertStarts(t, done, 0, 200, 201, 1201)
			if done.Summary.SkillActions.AcceptedCount != 2 || done.Summary.SkillActions.RejectedCount != 1 || *done.AttackRecords[1].ReadyAtMs != 1200 || *done.AttackRecords[1].FinalReadyAtMs != 201 {
				t.Fatal("repeat changed the wrong interval or bypassed its own cast cooldown", done.Summary, done.AttackRecords, done.SkillActionRecords)
			}
		})
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
			if !frame.fatal || frame.committed || frame.fatalErr.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || state.basicAttackReadyAt() != 1000 || resetQueuedAttack(t, state) != old || !state.basicAttackEventCurrent(old) || state.basicAttack.wait.remaining != 1 {
				t.Fatal("failed commit published a reset or a new waiter version", frame.fatalErr, state.basicAttack.wait)
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
			if _, issue := RunGeneric(state.compiled, resumed); issue == nil {
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
			if !restored.combatants["source"].cooldowns.isReady(genericAbilityCooldownIdentity("source", ref), snapshot.TimeMs) || len(restored.combatants["source"].cooldowns.waits) != 0 {
				t.Fatal("restore recreated a stale cadence waiter", restored.combatants["source"].cooldowns)
			}
		})
	}
}

func TestBasicAttackResetUnboundReferencesDoNotResetTheSelectedClock(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		for _, reference := range []string{"unknown_provider", "unknown_ability", "hit_ability", "other_owner"} {
			t.Run(family+"/"+reference, func(t *testing.T) {
				input, request := resetAttackInput(t, family, false, 1200)
				reset := &input.SharedProviders[len(input.SharedProviders)-1].Processes[0].MomentOperations[0].Operations[0]
				switch reference {
				case "unknown_provider":
					reset.AbilityRef = "source.provider[does_not_exist].ability[initial]"
				case "unknown_ability":
					reset.AbilityRef = strings.Replace(reset.AbilityRef, family+"_control", "unknown_initial", 1)
				case "hit_ability":
					reset.AbilityRef = request.DriverPlan.BasicAttack.HitAbilityRef
				case "other_owner":
					reset.AbilityRef = strings.Replace(reset.AbilityRef, "source.", "target.", 1)
				}
				compiled := compilebundle.CompileGeneric(input)
				if reference != "hit_ability" {
					if compiled.OK {
						t.Fatal("unknown provider, ability or mount escaped final reference validation", reference)
					}
					found := false
					for _, issue := range compiled.Result.Errors {
						found = found || issue.Code == model.GenericErrUnknownRef && strings.HasSuffix(issue.Path, ".abilityRef")
					}
					if !found {
						t.Fatal("reference rejected without the expected compile error", compiled.Result.Errors)
					}
					return
				}
				if !compiled.OK {
					t.Fatal(compiled.Result.Errors)
				}
				_, issue := RunGeneric(compiled.Session, request)
				if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || !strings.Contains(issue.Message, "original mounted initial ability") {
					t.Fatal("unbound cooldown target escaped the original process gate", reference, issue)
				}
			})
		}
	}
}

func TestBasicAttackResetCrossProcessExceptionRejectsBroaderChanges(t *testing.T) {
	for _, family := range []string{"amber", "quartz"} {
		for _, boundary := range []string{"wrong_owner", "process_complete", "nonzero", "dynamic_zero", "target_selector", "other_initial", "no_native_plan"} {
			t.Run(family+"/"+boundary, func(t *testing.T) {
				input, request := resetAttackInput(t, family, false, 1200)
				process := &input.SharedProviders[len(input.SharedProviders)-1].Processes[0]
				operation := &process.MomentOperations[0].Operations[0]
				switch boundary {
				case "wrong_owner":
					// A complete real attack provider exists on the other owner;
					// this is not merely an unknown-reference compile rejection.
					input.SharedProviders[0].Listeners[0].AbilityRef = strings.Replace(request.DriverPlan.BasicAttack.InitialControlAbilityRef, "source.", "self.", 1)
					input.Combatants[1].Providers = append(input.Combatants[1].Providers, input.Combatants[0].Providers[0])
					mount := request.InitialSnapshot.Combatants[0].Providers[0]
					mount.Source, mount.Owner = "target", "target"
					request.InitialSnapshot.Combatants[1].Providers = append(request.InitialSnapshot.Combatants[1].Providers, mount)
					operation.AbilityRef = strings.Replace(operation.AbilityRef, "source.", "target.", 1)
				case "process_complete":
					process.MomentOperations[0].Moment.MomentType = "PROCESS_COMPLETE"
				case "nonzero":
					operation.Amount = timedShieldExpr(1)
				case "dynamic_zero":
					operation.Amount = authoringAmount(authoringBinary("sub", authoringRead("source.attr.attack_damage.resolved"), authoringRead("source.attr.attack_damage.resolved")))
				case "target_selector":
					operation.Target = "target"
				case "other_initial":
					other := family + "_other"
					operation.AbilityRef = "source.provider[" + other + "].ability[initial]"
					addMixedSpell(&input, &request, other, 1000, 1, false)
				case "no_native_plan":
					request.DriverPlan.BasicAttack = nil
				}
				compiled := authoringCompile(t, input)
				_, issue := RunGeneric(compiled, request)
				if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || !strings.Contains(issue.Message, "original mounted initial ability") {
					t.Fatal("cross-process reset exception admitted a broader change", boundary, issue)
				}
			})
		}
	}
}
