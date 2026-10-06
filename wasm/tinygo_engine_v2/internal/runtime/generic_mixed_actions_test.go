package runtime

import (
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func addMixedSpell(input *model.CompileRequest, request *model.RunRequest, name string, at int64, delay int64, occupies bool) {
	spell, cast := singleSkillInput(false)
	encoded, _ := json.Marshal(spell.SharedProviders[0])
	encoded = []byte(strings.NewReplacer("skill_source", name+"_definition", "configured_spell", name, "damage/physical", "damage/physics").Replace(string(encoded)))
	provider := model.ProviderDefinition{}
	if err := json.Unmarshal(encoded, &provider); err != nil {
		panic(err)
	}
	provider.Processes[0].Steps[0].DelayMs = timedShieldExpr(float64(delay))
	provider.Processes[0].Steps[0].OccupiesAction = &occupies
	input.SharedProviders = append(input.SharedProviders, provider)
	input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: name, DefinitionRef: provider.ProviderKey})
	request.InitialSnapshot.Combatants[0].Providers = append(request.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: name, DefinitionRef: provider.ProviderKey, Owner: "source", Source: "source", Stacks: 1})
	for _, entry := range spell.TypeCatalog.Types {
		found := false
		for _, existing := range input.TypeCatalog.Types {
			found = found || existing.Key == entry.Key
		}
		if !found {
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, entry)
		}
	}
	binding := spell.Rules.SkillActionBindings[0]
	binding.BindingKey, binding.SkillKey, binding.ProviderRef, binding.ProviderDefinitionRef = name+"_binding", name, name, provider.ProviderKey
	binding.Controls[0].AbilityRef = "source.provider[" + name + "].ability[initial]"
	binding.HitBindings[0].HitAbilityRef = "source.provider[" + name + "].ability[hit]"
	input.Rules.SkillActionBindings = append(input.Rules.SkillActionBindings, binding)
	plan := cast.DriverPlan.SkillActions[0]
	plan.InstructionKey, plan.SkillKey, plan.BindingKey, plan.AbilityRef, plan.FirstAtMs = name+"_first", name, binding.BindingKey, binding.Controls[0].AbilityRef, at
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, plan)
}

func TestMixedActionOccupancyAndUniqueNextAttack(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 3000)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	addMixedSpell(&input, &request, "second", 1000, 500, true)
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.SkillActions.AcceptedCount != 2 || done.Summary.SkillUses.HitCount != 2 || done.Summary.BasicAttack.StartedCount != 3 {
		test.Fatal(done.Summary)
	}
	for index, expected := range []int64{250, 1500, 2500} {
		if done.AttackRecords[index].StartAtMs != expected {
			test.Fatal(done.AttackRecords)
		}
	}
	if done.Summary.BasicAttack.InitialActionReadyAtMs == nil || *done.Summary.BasicAttack.InitialActionReadyAtMs != 250 || *done.AttackRecords[0].ActionReadyAtMs != 1500 || *done.AttackRecords[0].FinalReadyAtMs != 1250 || *done.AttackRecords[0].NextStartAtMs != 1500 || done.AttackRecords[1].ActionReadyAtMs != nil {
		test.Fatal(done.Summary.BasicAttack, done.AttackRecords)
	}
	if done.Summary.SourceDamageDealt != 230 {
		test.Fatal(done.DamageRecords)
	}
}

func TestMixedActionRejectsBusyAttemptWithoutRetry(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1500)
	addMixedSpell(&input, &request, "first", 0, 500, true)
	addMixedSpell(&input, &request, "second", 499, 250, true)
	done := authoringRun(test, input, request)
	if done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillActions.RejectedCount != 1 || done.SkillActionRecords[1].UseRef != nil || *done.SkillActionRecords[1].Reason != "action_occupied" || done.Summary.SkillUses.StartedCount != 1 {
		test.Fatal(done.Summary, done.SkillActionRecords)
	}
}

func TestMixedActionStableFullSortAndUseIdentity(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1000)
	request.DriverPlan.BasicAttack = nil
	addMixedSpell(&input, &request, "first", 0, 500, false)
	addMixedSpell(&input, &request, "second", 0, 250, false)
	request.DriverPlan.SkillActions[0].SortOrder = 70000
	request.DriverPlan.SkillActions[1].SortOrder = 60000
	done := authoringRun(test, input, request)
	firstHitUse := ""
	for _, record := range done.SkillUseRecords {
		if record.Kind == "HIT" {
			firstHitUse = record.UseRef
			break
		}
	}
	if done.SkillActionRecords[0].SkillKey != "second" || firstHitUse != "skill:second_first" || done.DamageRecords[0]["instructionKey"] != "second_first" || done.DamageRecords[1]["instructionKey"] != "first_first" || done.DamageRecords[0]["attackIndex"] != nil || done.Summary.SkillUses.HitCount != 2 {
		test.Fatal(done.SkillActionRecords, done.SkillUseRecords, done.DamageRecords)
	}
	request.DriverPlan.SkillActions[0], request.DriverPlan.SkillActions[1] = request.DriverPlan.SkillActions[1], request.DriverPlan.SkillActions[0]
	reordered := authoringRun(test, input, request)
	if !reflect.DeepEqual(done, reordered) {
		test.Fatal("author array ordering changed actual results")
	}
}

func TestMixedActionCooldownBoundaryAndConfiguredHaste(test *testing.T) {
	for _, haste := range []float64{0, 100} {
		period := int64(1000 / (1 + haste/100))
		for _, offset := range []int64{-1, 0, 1} {
			input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
			addMixedSpell(&input, &request, "first", 0, 250, false)
			input.Combatants[0].Attributes["ability_haste"] = authoringSlot(haste)
			request.InitialSnapshot.Combatants[0].Attributes["ability_haste"] = authoringSlot(haste)
			input.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringBinary("div", authoringConst(1000), authoringBinary("add", authoringConst(1), authoringBinary("div", authoringRead("source.attr.ability_haste.resolved"), authoringConst(100))))
			attempt := request.DriverPlan.SkillActions[0]
			attempt.InstructionKey, attempt.FirstAtMs = "again", period+offset
			request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, attempt)
			done := authoringRun(test, input, request)
			wantAccepted := 2
			if offset < 0 {
				wantAccepted = 1
			}
			if done.Summary.SkillActions.AcceptedCount != wantAccepted || done.Summary.BasicAttack.StartedCount != 3 || done.AttackRecords[1].StartAtMs != 1000 {
				test.Fatal(haste, offset, done.Summary, done.SkillActionRecords)
			}
		}
	}
}

func TestMixedActionInitialEmptyAmmoAndOccupancyOverlap(test *testing.T) {
	for _, delay := range []int64{250, 3000} {
		input, request := ammoAttackInput(0, 1000, 4000)
		addMixedSpell(&input, &request, "first", 0, delay, true)
		done := authoringRun(test, input, request)
		want := int64(2500)
		if delay > want {
			want = delay
		}
		if *done.Summary.BasicAttack.InitialMechanicReadyAtMs != 2500 || *done.Summary.BasicAttack.InitialActionReadyAtMs != delay || done.AttackRecords[0].StartAtMs != want || done.MechanicRecords[0].TimeMs != 0 || done.MechanicRecords[0].UseRef != nil {
			test.Fatal(done.Summary, done.AttackRecords, done.MechanicRecords)
		}
	}
}

func TestMixedActionDeathBeforeSameTimeAttackAndLaterInstruction(test *testing.T) {
	input, request := continuousAttackInput(1, 55, 10, 0, 0, 2000)
	addMixedSpell(&input, &request, "first", 0, 1000, true)
	attempt := request.DriverPlan.SkillActions[0]
	attempt.InstructionKey, attempt.FirstAtMs = "after_death", 1000
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, attempt)
	done := authoringRun(test, input, request)
	if done.Summary.BasicAttack.StartedCount != 0 || done.Summary.SkillActions.UnreachedCount != 1 || done.Summary.SkillUses.HitCount != 1 || *done.Summary.Execution.TargetKilledAtMs != 1000 || !done.Summary.Execution.Complete {
		test.Fatal(done.Summary)
	}
}

func TestMixedActionZeroRecordsSamplingAndRepeatIsolation(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 4000)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	complete := authoringRun(test, input, request)
	zero := 0
	request.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero, MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxHealingRecords: &zero, MaxMechanicRecords: &zero}
	request.Sampling = model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 1000, MaxSeriesPoints: 5}
	compiled := authoringCompile(test, input)
	var previous model.DoneResult
	for iteration := 0; iteration < 100; iteration++ {
		done, err := RunGeneric(compiled, request)
		settlement := done.Summary
		settlement.SeriesDownsampled = complete.Summary.SeriesDownsampled
		settlement.WarningCount = complete.Summary.WarningCount
		if err != nil || len(done.Warnings) != 1 || done.Warnings[0].Code != string(model.WarningCodeSeriesDownsampled) || !reflect.DeepEqual(settlement, complete.Summary) || len(done.AttackRecords)+len(done.DamageRecords)+len(done.SkillUseRecords)+len(done.SkillActionRecords) != 0 || (iteration > 0 && !reflect.DeepEqual(done, previous)) {
			test.Fatal(iteration, err, done.Summary)
		}
		previous = done
	}
}

func TestMixedActionInvalidKeysAndMissingOccupationRejected(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1000)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, request.DriverPlan.SkillActions[0])
	compiled := authoringCompile(test, input)
	if _, err := RunGeneric(compiled, request); err == nil {
		test.Fatal("duplicate instruction key admitted")
	}
	input.SharedProviders[1].Processes[0].Steps[0].OccupiesAction = nil
	if compiled := compilebundle.CompileGeneric(input); compiled.OK {
		test.Fatal("missing action declaration admitted")
	}
}

func TestMixedActionSpeedChangePreservesCooldownProgressDuringLock(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 2
	addMixedSpell(&input, &request, "first", 500, 1000, true)
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: "spell_speed", Kind: "status", StableID: "speed",
		Modifiers: []model.ModifierDefinition{{ModifierKey: "speed", Kind: "attribute", Target: "self.attr.attack_speed", ValuePolicy: "add", Value: *timedShieldExpr(1)}}})
	step := "delay"
	input.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_START", StepKey: &step},
		Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "spell_speed"}}}}
	done := authoringRun(test, input, request)
	if done.AttackRecords[1].StartAtMs != 1500 || *done.AttackRecords[0].FinalReadyAtMs != 750 || *done.AttackRecords[0].ActionReadyAtMs != 1500 || *done.AttackRecords[0].NextStartAtMs != 1500 || done.AttackRecords[1].AttackSpeed != 2 {
		test.Fatal(done.AttackRecords)
	}
}

func TestMixedActionStepQueueFailureDoesNotUnlockOrSpawnExtraAttack(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	compiled := authoringCompile(test, input)
	state, err := newGenericRunState(compiled, request)
	if err != nil {
		test.Fatal(err)
	}
	state.heap.Pop()
	state.heap.SetLimit(1)
	if err := state.handleSkillAction(0); err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		test.Fatal(err)
	}
	if state.actionOccupied("source") || state.heap.Len() != 1 || state.skillActions[0].uses.StartedCount != 1 || state.skillActions[0].uses.HitCount != 0 {
		test.Fatal("failed step transaction changed action ownership or attack queue")
	}
}

func TestMixedActionCommittedDeathCannotReawakenAfterFailureHeal(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	input.Combatants[0].Attributes["armor"] = authoringSlot(0)
	request.InitialSnapshot.Combatants[0].Attributes["armor"] = authoringSlot(0)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	addMixedSpell(&input, &request, "second", 100, 250, false)
	reason := "SOURCE_DIED"
	input.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{
		{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", DamageType: "damage/physics", Ref: "self_death", Amount: timedShieldExpr(1000)}}},
		{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_FAILURE", FailureReason: &reason}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Ref: "failure_heal", Amount: timedShieldExpr(100)}}},
	}
	done := authoringRun(test, input, request)
	if done.Summary.SourceFinalHp != 100 || done.Summary.StopReason != model.StopReasonSourceDead || done.Summary.BasicAttack.StartedCount != 0 || done.Summary.SkillActions.UnreachedCount != 1 || done.Summary.SkillUses.FailedCount != 1 || !done.Summary.Execution.Complete {
		test.Fatal(done.Summary)
	}
}

func TestMixedActionCrossFrameCommandBudgetAndPartialAcceptance(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	input.SharedProviders[1].InitialStateSchema = map[string]interface{}{"count": map[string]interface{}{"defaultValue": float64(0), "maxValue": float64(10), "durationMs": float64(0)}}
	input.SharedProviders[1].Listeners = []model.ListenerDefinition{{ListenerKey: "tail_commands", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}},
		Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "count", ValuePolicy: "add", Amount: timedShieldExpr(1)}}}}
	request.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
	done := authoringRun(test, input, request)
	if done.Summary.Execution.Complete || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillActions.AbortedBeforeAcceptCount != 0 || done.Summary.SkillUses.StartedCount != 1 || done.Summary.BasicAttack.StartedCount != 0 {
		test.Fatal(done.Summary)
	}
}

func TestMixedActionUnboundActiveSiblingFailsClosed(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1000)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	input.SharedProviders[1].Abilities = append(input.SharedProviders[1].Abilities, model.AbilityDefinition{AbilityKey: "unbound_active", Kind: "active", SkillKey: "first"})
	compiled := authoringCompile(test, input)
	if _, err := RunGeneric(compiled, request); err == nil {
		test.Fatal("planned mount hid an unbound active sibling")
	}
}

func TestMixedActionSuccessfulCastArmsOneConfiguredEquipmentHit(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2500)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	attempt := request.DriverPlan.SkillActions[0]
	attempt.InstructionKey, attempt.FirstAtMs = "rejected_again", 500
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, attempt)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	addFixedEquipment(&input, &request, 0, "configured_cast_item", "hp", 0)
	provider := model.ProviderDefinition{ProviderKey: "cast_item_passive", Kind: "item", StableID: "configured_cast_item",
		InitialStateSchema: map[string]interface{}{"armed": map[string]interface{}{"defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(10000), "refreshPolicy": model.ProviderStateRefreshOnWrite}},
		Listeners: []model.ListenerDefinition{
			{ListenerKey: "arm_on_success", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{"event/ability_started", "event/source_owner"}},
				Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "armed", ValuePolicy: "set", Amount: timedShieldExpr(1)}}},
			{ListenerKey: "consume_on_real_attack", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
				Condition: authoringAmount(authoringBinary("eq", authoringRead("provider.state.armed"), authoringConst(1))),
				Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "cast_item_damage", Amount: timedShieldExpr(25)},
					{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "armed", ValuePolicy: "set", Amount: timedShieldExpr(0)}}},
		}}
	input.SharedProviders = append(input.SharedProviders, provider)
	input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: provider.ProviderKey, DefinitionRef: provider.ProviderKey})
	request.InitialSnapshot.Combatants[0].Providers = append(request.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: provider.ProviderKey, DefinitionRef: provider.ProviderKey, Owner: "source", Source: "source", Stacks: 1})
	done := authoringRun(test, input, request)
	if done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillActions.RejectedCount != 1 || done.AttackRecords[0].PostDefenseDamage != 35 || done.AttackRecords[1].PostDefenseDamage != 10 || done.Summary.SourceDamageDealt != 155 {
		test.Fatal(done.Summary, done.AttackRecords)
	}
}

func TestMixedActionConfiguredCooldownChangeReschedulesOnlyExistingWait(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	addMixedSpell(&input, &request, "first", 500, 1000, true)
	step := "delay"
	input.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_START", StepKey: &step},
		Operations: []model.OperationDefinition{{Operation: "cooldown_change", Target: "self", AbilityRef: request.DriverPlan.BasicAttack.InitialControlAbilityRef, ValuePolicy: "reduce", Amount: timedShieldExpr(100)}}}}
	done := authoringRun(test, input, request)
	if done.Summary.BasicAttack.StartedCount != 2 || *done.AttackRecords[0].FinalReadyAtMs != 900 || *done.AttackRecords[0].ActionReadyAtMs != 1500 || done.AttackRecords[1].StartAtMs != 1500 {
		test.Fatal(done.AttackRecords)
	}
}

func TestMixedActionPureSkillRejectsUnsafeStepAndCooldownDeadlines(test *testing.T) {
	for _, cooldown := range []bool{false, true} {
		input, request := singleSkillInput(false)
		if cooldown {
			input.SharedProviders[0].Processes[0].Cooldown.DurationMs = *timedShieldExpr(float64(maxJSONSafeInteger))
		} else {
			input.SharedProviders[0].Processes[0].Steps[0].DelayMs = timedShieldExpr(float64(maxJSONSafeInteger))
		}
		compiled := authoringCompile(test, input)
		if _, err := RunGeneric(compiled, request); err == nil || err.Code != model.GenericErrRuntimeInvariantFailed {
			test.Fatal(cooldown, err)
		}
	}
}

func TestMixedActionFractionalConfiguredHasteUsesDeclaredNativeRounding(test *testing.T) {
	input, request := singleSkillInput(false)
	input.Combatants[0].Attributes["ability_haste"] = authoringSlot(10)
	request.InitialSnapshot.Combatants[0].Attributes["ability_haste"] = authoringSlot(10)
	cooldown := input.SharedProviders[0].Processes[0].Cooldown
	cooldown.DurationMs = authoringBinary("div", authoringConst(4000), authoringBinary("add", authoringConst(1), authoringBinary("div", authoringRead("source.attr.ability_haste.resolved"), authoringConst(100))))
	cooldown.RoundPositiveMs = true
	request.StopPolicy.DurationMs = 4000
	for index, at := range []int64{3735, 3736} {
		attempt := request.DriverPlan.SkillActions[0]
		attempt.InstructionKey, attempt.FirstAtMs = "repeat_"+strconv.Itoa(index), at
		request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, attempt)
	}
	done := authoringRun(test, input, request)
	if done.Summary.SkillActions.AcceptedCount != 2 || done.Summary.SkillActions.RejectedCount != 1 || *done.SkillActionRecords[1].Reason != "cooldown_not_ready" {
		test.Fatal(done.SkillActionRecords)
	}
}
