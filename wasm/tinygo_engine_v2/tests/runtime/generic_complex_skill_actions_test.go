// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	reflect "reflect"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func complexSkillInput(kind string, occupies bool) (model.CompileRequest, model.RunRequest) {
	input, request := singleSkillInput(false)
	step := model.ProcessStepDefinition{StepKey: "complex", StepType: kind, OccupiesAction: &occupies}
	switch kind {
	case "MULTI_HIT":
		step.RepeatCount, step.IntervalMs = timedShieldExpr(4), timedShieldExpr(100)
	case "CHANNEL":
		first := "IMMEDIATE"
		step.DurationMs, step.ExecutionCount, step.FirstExecution = timedShieldExpr(1000), timedShieldExpr(4), &first
	case "CHARGE":
		step.MinimumChargeMs, step.MaximumChargeMs, step.ReleaseAtMaximum = timedShieldExpr(200), timedShieldExpr(800), model.BoolPtr(false)
	case "RECAST":
		step.WindowMs = timedShieldExpr(800)
		step.MaximumRecastCount = timedShieldExpr(1)
	}
	input.SharedProviders[0].Processes[0].Steps = []model.ProcessStepDefinition{step}
	input.Rules.SkillActionBindings[0].HitBindings[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &step.StepKey}
	request.StopPolicy.DurationMs = 1200
	return input, request
}

func addComplexControl(input *model.CompileRequest, request *model.RunRequest, key, action string, at int64, order int) {
	binding := &input.Rules.SkillActionBindings[0]
	var provider *model.ProviderDefinition
	for index := range input.SharedProviders {
		if input.SharedProviders[index].ProviderKey == binding.ProviderDefinitionRef {
			provider = &input.SharedProviders[index]
		}
	}
	step := provider.Processes[0].Steps[0]
	control := &model.ProcessControlDefinition{Action: action, ProcessKey: "cast"}
	if action == "CANCEL" {
		control.FailureReason = "ACTIVE_CANCELLED"
	} else {
		control.StepKey = step.StepKey
	}
	abilityKey := "control_" + action
	ref := "source.provider[" + binding.ProviderRef + "].ability[" + abilityKey + "]"
	found := false
	for _, existing := range binding.Controls {
		found = found || existing.Action == action
	}
	if !found {
		provider.Abilities = append(provider.Abilities, model.AbilityDefinition{AbilityKey: abilityKey, Kind: "active", SkillKey: binding.SkillKey, ProcessControl: control})
		binding.Controls = append(binding.Controls, model.SkillActionControl{Action: action, ProcessKey: "cast", AbilityRef: ref})
	}
	parent := request.DriverPlan.SkillActions[0].InstructionKey
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, model.SkillActionPlan{InstructionKey: key, FirstAtMs: at, SortOrder: order, Source: "source", Target: "target", SkillKey: binding.SkillKey, BindingKey: binding.BindingKey, Action: action, AbilityRef: ref, ParentInstructionKey: &parent, HitBindings: []model.SkillActionHitPreset{}})
}

func TestComplexSkillParentControlAndEarlyLateRejection(test *testing.T) {
	input, request := complexSkillInput("CHARGE", true)
	addComplexControl(&input, &request, "early", "CHARGE_RELEASE", 299, 1)
	addComplexControl(&input, &request, "release", "CHARGE_RELEASE", 400, 1)
	addComplexControl(&input, &request, "late", "CHARGE_RELEASE", 950, 1)
	done := timedShieldMustRun(test, input, request)
	starts := 0
	for _, event := range done.Evidence.Items {
		if string(event.Kind) == "emitted_event" && event.Ref == "event/ability_started" {
			starts++
		}
	}
	if done.Summary.SkillActions.AcceptedCount != 2 || done.Summary.SkillActions.RejectedCount != 2 || *done.SkillActionRecords[1].Reason != "advance_too_early" || *done.SkillActionRecords[3].Reason != "process_already_finished" || *done.SkillActionRecords[2].UseRef != "skill:cast_once" || done.Summary.SkillUses.StartedCount != 1 || done.Summary.SkillUses.HitCount != 1 || done.DamageRecords[0]["timeMs"] != int64(400) || starts != 1 {
		test.Fatal(done.Summary, done.SkillActionRecords, done.SkillUseRecords)
	}
	process := done.FinalSnapshot.ProcessInstances[0]
	if *process.ActionOccupancies[0].FinishedAtMs != 400 || process.ActionOccupancies[0].ExpectedEndAtMs != 900 {
		test.Fatal(process)
	}
}

func TestComplexSkillSameClockParentOrderAndChargeRead(test *testing.T) {
	input, request := complexSkillInput("CHARGE", true)
	input.SharedProviders[0].Processes[0].Steps[0].MinimumChargeMs = timedShieldExpr(0)
	request.DriverPlan.SkillActions[0].FirstAtMs = 0
	addComplexControl(&input, &request, "release", "CHARGE_RELEASE", 0, 1)
	input.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{*timedShieldExpr(10), {Op: "read", Path: "use.charge_duration_ms"}}}
	done := timedShieldMustRun(test, input, request)
	if done.Summary.SkillActions.AcceptedCount != 2 || done.Summary.SkillUses.StartedCount != 1 || done.Summary.SourceDamageDealt != 10 || done.Summary.SkillUses.ReleasedCount != 1 {
		test.Fatal(done.Summary, done.SkillActionRecords)
	}
	request.DriverPlan.SkillActions[1].SortOrder = 0
	request.DriverPlan.SkillActions[1].InstructionKey = "aaa_release"
	compiled := compilebundle.CompileGeneric(input)
	if !compiled.OK {
		test.Fatal(compiled.Result)
	}
	request.ExpectedRulesHash = compiled.Session.RulesHash
	if _, err := runtimeengine.RunGeneric(compiled.Session, request); err == nil {
		test.Fatal("forward same-clock parent accepted")
	}
}

func TestComplexSkillTimeoutCancelAndAutoMaximum(test *testing.T) {
	for _, kind := range []string{"CHARGE", "RECAST"} {
		input, request := complexSkillInput(kind, true)
		done := timedShieldMustRun(test, input, request)
		if done.Summary.SkillUses.FailedCount != 1 || done.Summary.SkillUses.CompletedCount != 0 || done.Summary.SkillUses.ReleasedCount != 0 || done.Summary.SkillUses.HitCount != 0 || *done.FinalSnapshot.ProcessInstances[0].FailureReason != "EVENT_ABORTED" {
			test.Fatal(kind, done.Summary)
		}
		input, request = complexSkillInput(kind, true)
		addComplexControl(&input, &request, "cancel", "CANCEL", 350, 1)
		done = timedShieldMustRun(test, input, request)
		if done.Summary.SkillActions.AcceptedCount != 2 || done.Summary.SkillUses.FailedCount != 1 || done.Summary.SkillUses.HitCount != 0 || *done.FinalSnapshot.ProcessInstances[0].FailureReason != "ACTIVE_CANCELLED" {
			test.Fatal(kind, done.Summary)
		}
	}
	input, request := complexSkillInput("CHARGE", true)
	input.SharedProviders[0].Processes[0].Steps[0].ReleaseAtMaximum = model.BoolPtr(true)
	addComplexControl(&input, &request, "late_release", "CHARGE_RELEASE", 900, 1)
	done := timedShieldMustRun(test, input, request)
	if done.Summary.SkillUses.HitCount != 1 || done.DamageRecords[0]["timeMs"] != int64(900) || done.Summary.SkillActions.RejectedCount != 1 || done.Summary.SkillUses.CompletedCount != 1 {
		test.Fatal(done.Summary)
	}
}

func TestComplexSkillObservationRecordingAndSessionRepeat(test *testing.T) {
	input, request := complexSkillInput("MULTI_HIT", true)
	request.StopPolicy.DurationMs = 250
	compiled := compilebundle.CompileGeneric(input)
	if !compiled.OK {
		test.Fatal(compiled.Result)
	}
	request.ExpectedRulesHash = compiled.Session.RulesHash
	done, err := runtimeengine.RunGeneric(compiled.Session, request)
	if err != nil || done.Summary.SkillUses.HitCount != 2 || done.Summary.SkillUses.InFlightCount != 1 || done.FinalSnapshot.ProcessInstances[0].Repeat.ExecutionIndex != 2 || *done.FinalSnapshot.ProcessInstances[0].Repeat.NextExecutionAtMs != 300 {
		test.Fatal(err, done.Summary)
	}
	for iteration := 0; iteration < 20; iteration++ {
		repeated, repeatErr := runtimeengine.RunGeneric(compiled.Session, request)
		if repeatErr != nil || !reflect.DeepEqual(done, repeated) {
			test.Fatal(iteration, repeatErr)
		}
	}
	zero := 0
	request.RecordBudget = &model.RecordBudget{MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxDamageRecords: &zero}
	request.Sampling = model.SamplingConfig{Disabled: true}
	limited, err := runtimeengine.RunGeneric(compiled.Session, request)
	if err != nil || !reflect.DeepEqual(done.Summary.SkillUses, limited.Summary.SkillUses) || !reflect.DeepEqual(done.FinalSnapshot, limited.FinalSnapshot) || len(limited.SkillUseRecords)+len(limited.SkillActionRecords)+len(limited.DamageRecords) != 0 {
		test.Fatal(err, limited.Summary)
	}
	encoded, encodeErr := json.Marshal(done.FinalSnapshot)
	var restored model.Snapshot
	if encodeErr != nil || json.Unmarshal(encoded, &restored) != nil {
		test.Fatal("complex snapshot shape", encodeErr)
	}
}

func TestComplexSkillEarlyReleaseAndCancelWakeUniqueAttack(test *testing.T) {
	for _, action := range []string{"CHARGE_RELEASE", "CANCEL"} {
		input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1600)
		addMixedSpell(&input, &request, "first", 0, 2000, true)
		step := model.ProcessStepDefinition{StepKey: "charge", StepType: "CHARGE", OccupiesAction: model.BoolPtr(true), MinimumChargeMs: timedShieldExpr(0), MaximumChargeMs: timedShieldExpr(2000), ReleaseAtMaximum: model.BoolPtr(false)}
		input.SharedProviders[1].Processes[0].Steps = []model.ProcessStepDefinition{step}
		input.Rules.SkillActionBindings[0].HitBindings[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &step.StepKey}
		addComplexControl(&input, &request, "control", action, 500, 1)
		done := authoringRun(test, input, request)
		if done.Summary.BasicAttack.StartedCount != 2 || *done.Summary.BasicAttack.InitialActionReadyAtMs != 500 || done.AttackRecords[0].StartAtMs != 500 || done.AttackRecords[1].StartAtMs != 1500 || done.Summary.SkillActions.AcceptedCount != 2 {
			test.Fatal(action, done.Summary, done.AttackRecords)
		}
	}
}

func TestComplexSkillConsecutiveOccupiedStepsDoNotInsertAttack(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1000)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	process := &input.SharedProviders[1].Processes[0]
	process.Steps = append(process.Steps, model.ProcessStepDefinition{StepKey: "second", StepType: "DELAY", OccupiesAction: model.BoolPtr(true), DelayMs: timedShieldExpr(250)})
	done := authoringRun(test, input, request)
	if done.Summary.BasicAttack.StartedCount != 1 || done.AttackRecords[0].StartAtMs != 500 || *done.Summary.BasicAttack.InitialActionReadyAtMs != 500 || done.Summary.SkillUses.StepEnteredCount != 2 || done.Summary.SkillUses.StepCompletedCount != 2 {
		test.Fatal(done.Summary, done.AttackRecords)
	}
	for _, actual := range done.FinalSnapshot.ProcessInstances {
		if actual.SkillKey == "first" && (len(actual.ActionOccupancies) != 2 || *actual.ActionOccupancies[0].FinishedAtMs != actual.ActionOccupancies[1].StartedAtMs) {
			test.Fatal(actual)
		}
	}
}

func TestComplexSkillRejectedParentIsNormalControlRejection(test *testing.T) {
	input, request := complexSkillInput("CHARGE", true)
	repeated := request.DriverPlan.SkillActions[0]
	repeated.InstructionKey, repeated.FirstAtMs = "second_initial", 200
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, repeated)
	addComplexControl(&input, &request, "release", "CHARGE_RELEASE", 400, 1)
	parent := "second_initial"
	request.DriverPlan.SkillActions[2].ParentInstructionKey = &parent
	done := timedShieldMustRun(test, input, request)
	if done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillActions.RejectedCount != 2 || *done.SkillActionRecords[2].Reason != "parent_not_accepted" || done.SkillActionRecords[2].UseRef != nil || done.Summary.SkillUses.StartedCount != 1 {
		test.Fatal(done.Summary, done.SkillActionRecords)
	}
}

func TestComplexSkillCannotAppendCompletionHit(test *testing.T) {
	for _, kind := range []string{"MULTI_HIT", "CHANNEL", "CHARGE", "RECAST"} {
		input, _ := complexSkillInput(kind, true)
		extra := input.Rules.SkillActionBindings[0].HitBindings[0]
		extra.HitBindingKey = "extra_completion"
		extra.Moment = model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}
		input.Rules.SkillActionBindings[0].HitBindings = append(input.Rules.SkillActionBindings[0].HitBindings, extra)
		if result := compilebundle.CompileGeneric(input); result.OK {
			test.Fatal(kind, "complex completion fabricated another hit")
		}
	}
}

func TestComplexSkillUnrelatedHitCannotReadChargeDuration(test *testing.T) {
	input, request := singleSkillInput(false)
	input.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "read", Path: "use.charge_duration_ms"}
	compiled := compilebundle.CompileGeneric(input)
	if !compiled.OK {
		test.Fatal(compiled.Result)
	}
	request.ExpectedRulesHash = compiled.Session.RulesHash
	if _, err := runtimeengine.RunGeneric(compiled.Session, request); err == nil {
		test.Fatal("ordinary hit invented charge duration zero")
	}
}

func TestComplexSkillControlParentMustRetainOriginAndTarget(test *testing.T) {
	for _, mismatch := range []string{"target", "parent", "hits"} {
		input, request := complexSkillInput("CHARGE", true)
		addComplexControl(&input, &request, "release", "CHARGE_RELEASE", 400, 1)
		switch mismatch {
		case "target":
			request.DriverPlan.SkillActions[1].Target = "source"
		case "parent":
			parent := "release"
			request.DriverPlan.SkillActions[1].ParentInstructionKey = &parent
		case "hits":
			request.DriverPlan.SkillActions[1].HitBindings = request.DriverPlan.SkillActions[0].HitBindings
		}
		compiled := compilebundle.CompileGeneric(input)
		if !compiled.OK {
			test.Fatal(compiled.Result)
		}
		request.ExpectedRulesHash = compiled.Session.RulesHash
		if _, err := runtimeengine.RunGeneric(compiled.Session, request); err == nil {
			test.Fatal(mismatch, "invalid control identity admitted")
		}
	}
}

func TestComplexSkillActualHitAdvancesOnlyDeclaredNaturalSource(test *testing.T) {
	input, request := complexSkillInput("MULTI_HIT", false)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"}, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"}, model.TypeCatalogEntry{Key: "ability/selected_spell", Domain: "ability"})
	input.SharedProviders[0].Abilities[1].Types = append(input.SharedProviders[0].Abilities[1].Types, "ability/selected_spell")
	input.SharedProviders[0].Abilities[0].Types = append(input.SharedProviders[0].Abilities[0].Types, "ability/selected_spell")
	provider := model.ProviderDefinition{ProviderKey: "natural_counter", Kind: "character", StableID: "configured_natural_source", InitialStateSchema: map[string]interface{}{"marks": float64(0)}, Listeners: []model.ListenerDefinition{{ListenerKey: "selected_hit_count", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner", "ability/selected_spell"}}, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "marks", ValuePolicy: "add", Amount: timedShieldExpr(1)}}}}}
	input.SharedProviders = append(input.SharedProviders, provider)
	input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "counter", DefinitionRef: provider.ProviderKey})
	request.InitialSnapshot.Combatants[0].Providers = append(request.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "counter", DefinitionRef: provider.ProviderKey, Owner: "source", Source: "source", Stacks: 1})
	done := timedShieldMustRun(test, input, request)
	bag, exists := done.FinalSnapshot.Combatants[0].ProviderState["counter"].(map[string]interface{})
	if !exists {
		test.Fatal("selected hit did not materialize natural state", done.FinalSnapshot.Combatants[0].ProviderState, done.Evidence)
	}
	if bag["state"].(map[string]interface{})["marks"] != float64(4) || done.Summary.SkillUses.StartedCount != 1 || done.Summary.SkillUses.HitCount != 4 {
		test.Fatal(done.FinalSnapshot.Combatants[0].ProviderState, done.Summary)
	}
	input.SharedProviders[0].Abilities[1].Types = []string{"ability/spell"}
	input.SharedProviders[0].Abilities[0].Types = []string{"ability/spell"}
	done = timedShieldMustRun(test, input, request)
	bag, exists = done.FinalSnapshot.Combatants[0].ProviderState["counter"].(map[string]interface{})
	if exists && bag["state"].(map[string]interface{})["marks"] != nil && bag["state"].(map[string]interface{})["marks"] != float64(0) {
		test.Fatal("unmatched skill hit activated the declared natural source")
	}
}
