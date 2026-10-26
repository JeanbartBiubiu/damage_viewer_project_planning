// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	reflect "reflect"
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
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
			done, err := runtimeengine.RunGeneric(compiled, request)
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
					repeat, issue := runtimeengine.RunGeneric(compiled, request)
					if issue != nil || !reflect.DeepEqual(done.Summary, repeat.Summary) || !reflect.DeepEqual(done.FinalSnapshot, repeat.FinalSnapshot) {
						t.Fatal("output profile or repeated session changed calculation", mode, iteration, issue)
					}
				}
			}
		})
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
				_, issue := runtimeengine.RunGeneric(compiled.Session, request)
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
				_, issue := runtimeengine.RunGeneric(compiled, request)
				if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || !strings.Contains(issue.Message, "original mounted initial ability") {
					t.Fatal("cross-process reset exception admitted a broader change", boundary, issue)
				}
			})
		}
	}
}
