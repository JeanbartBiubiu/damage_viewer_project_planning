package runtime

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func ammoAttackInput(initial float64, cooldown, duration int64) (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(1, 100000, 100, 0, .25, duration)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"})
	input.SharedProviders[0].InitialStateSchema = map[string]interface{}{"rounds": map[string]interface{}{
		"valueType": model.ProviderStateValueInteger, "defaultValue": initial, "maxValue": 4,
		"stateKind": model.ProviderStateKindAmmo, "ammoRecovery": map[string]interface{}{
			"intervalMs": authoringConst(2500), "mode": model.AmmoRecoveryAllAtOnce, "startCondition": model.AmmoRecoveryWhenEmpty}}}
	process := &input.SharedProviders[0].Processes[0]
	process.Cooldown.DurationMs = authoringConst(float64(cooldown))
	process.MomentOperations[0].Operations = []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "rounds",
		Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(-1))}}
	hit := input.SharedProviders[0].Abilities[2].Operations[0].SkillHit
	normal := hit.Candidates[0]
	normal.ParticipationCondition = authoringAmount(authoringBinary("gt", authoringRead("use.ammo.before"), authoringConst(1)))
	fourth := normal
	fourth.CandidateKey, fourth.ResultKey = "last_round", "last_round"
	fourth.ParticipationCondition = authoringAmount(authoringBinary("eq", authoringRead("use.ammo.before"), authoringConst(1)))
	fourth.Operations = append([]model.OperationDefinition(nil), normal.Operations...)
	fourth.Operations[0].Ref = "last_round_body"
	fourth.Operations[0].CritChance = authoringAmount(authoringConst(1))
	missing := fourth
	missing.CandidateKey, missing.ResultKey = "missing_hp", "missing_hp"
	missing.Operations = []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "missing_hp", DamageType: "damage/physics",
		Amount: authoringAmount(authoringBinary("mul", authoringConst(.1), authoringBinary("sub", authoringRead("target.attr.hp.max"), authoringRead("target.attr.hp.current"))))}}
	hit.Candidates = []model.SkillHitCandidate{normal, fourth, missing}
	maximum := 100
	request.RecordBudget = &model.RecordBudget{MaxMechanicRecords: &maximum}
	return input, request
}

func TestAmmoAttackFourCapturesFifthReloadAndIndependentDamage(test *testing.T) {
	input, request := ammoAttackInput(4, 1000, 5500)
	compiled := authoringCompile(test, input)
	binding := compiled.Providers[0].AmmoBinding
	if binding == nil || binding.StateKey != "rounds" || binding.InitialAbilityIndex != 1 || binding.ProcessIndex != 0 {
		test.Fatal("missing actual initial-chain binding", binding)
	}
	state, err := newGenericRunState(compiled, request)
	if err != nil || state.runLoop() != nil {
		test.Fatal(err)
	}
	done := state.buildDoneResult()
	if !done.Summary.Execution.Complete || done.Summary.BasicAttack.StartedCount != 5 || done.Summary.BasicAttack.HitCount != 5 || done.Summary.BasicAttack.CompletedCount != 5 || len(done.DamageRecords) != 6 || done.Summary.SourceDamageDealt != 757.5 {
		test.Fatal(done.Summary, done.DamageRecords)
	}
	for index, expected := range []int64{0, 1000, 2000, 3000, 5500} {
		attack := done.AttackRecords[index]
		capture := state.skillUses[attack.UseRef].ammoBefore
		if attack.StartAtMs != expected || capture == nil || capture.owner != "source" || capture.providerRef != "attack" || capture.stateKey != "rounds" || capture.before != []float64{4, 3, 2, 1, 4}[index] {
			test.Fatal(attack, capture)
		}
	}
	fourth := done.AttackRecords[3]
	if *fourth.FinalReadyAtMs != 4000 || *fourth.MechanicReadyAtMs != 5500 || *fourth.NextStartAtMs != 5500 || done.Recording.MechanicRecordCount != 8 {
		test.Fatal(fourth, done.Recording)
	}
	for _, record := range done.MechanicRecords {
		if record.Owner != "source" || record.ProviderRef != "attack" || record.ProviderDefinitionRef != "test_attack" || record.SkillKey != "test_attack" || record.StateKey != "rounds" || record.OperationRef == "" {
			test.Fatal(record)
		}
		if record.TimeMs == 5500 && record.BeforeValue == 0 && record.UseRef != nil {
			test.Fatal("timer invented an attack use", record)
		}
	}
}

func TestAmmoAttackInitialZeroOneFourAndCooldownBoundaries(test *testing.T) {
	for _, scenario := range []struct {
		name               string
		initial            float64
		cooldown, duration int64
		starts             []int64
	}{
		{"empty_before", 0, 1000, 2499, nil}, {"empty_equal", 0, 1000, 2500, []int64{2500}},
		{"one_before", 1, 1000, 2499, []int64{0}}, {"one_equal", 1, 1000, 2500, []int64{0, 2500}},
		{"full", 4, 1000, 5500, []int64{0, 1000, 2000, 3000, 5500}},
		{"ordinary_later", 1, 4000, 4000, []int64{0, 4000}},
		{"ordinary_equal", 1, 2500, 2500, []int64{0, 2500}},
	} {
		test.Run(scenario.name, func(test *testing.T) {
			input, request := ammoAttackInput(scenario.initial, scenario.cooldown, scenario.duration)
			done := authoringRun(test, input, request)
			if !done.Summary.Execution.Complete || done.Summary.BasicAttack.StartedCount != len(scenario.starts) || len(done.FinalSnapshot.ProcessInstances) != len(scenario.starts) {
				test.Fatal(done.Summary)
			}
			for index, expected := range scenario.starts {
				if done.AttackRecords[index].StartAtMs != expected {
					test.Fatal(done.AttackRecords)
				}
			}
			if scenario.initial == 0 && done.MechanicRecords[0].TimeMs != 0 {
				test.Fatal("empty initial inventory did not start a real wait")
			}
			if scenario.initial == 1 {
				first := done.AttackRecords[0]
				if *first.FinalReadyAtMs != scenario.cooldown || *first.MechanicReadyAtMs != 2500 {
					test.Fatal(first)
				}
			}
		})
	}
}

func TestAmmoAttackBudgetsCommitNoPartialConsumptionOrRecovery(test *testing.T) {
	for _, initial := range []float64{0, 1} {
		input, request := ammoAttackInput(initial, 1000, 5000)
		input.Settings.MaxQueueEvents = 1
		compiled := authoringCompile(test, input)
		state, err := newGenericRunState(compiled, request)
		if err != nil {
			test.Fatal(err)
		}
		if err = state.runLoop(); err != nil {
			test.Fatal(err)
		}
		done := state.buildDoneResult()
		if done.Summary.Execution.BudgetCause == nil || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxQueueEvents || len(done.FinalSnapshot.Combatants[0].ProviderState) != 0 || len(done.MechanicRecords) != 0 || state.basicAttack.ammo.wait.active || len(done.FinalSnapshot.ProcessInstances) != 0 || len(done.FinalSnapshot.Combatants[0].Cooldowns) != 0 {
			test.Fatal(done.Summary, done.MechanicRecords, done.FinalSnapshot)
		}
		for _, use := range state.skillUses {
			if use.ammoBefore != nil {
				test.Fatal("failed consumption published its capture")
			}
		}
	}
	input, request := ammoAttackInput(0, 1000, 5000)
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	state.nowMs = 2500
	state.combatants["source"].providerState["attack"] = state.newExecutionFrame("source", "target", authoringRef("initial")).providerStateBag("source", "attack", true)
	state.basicAttack.ammo.wait = ammoRecoveryWait{active: true, readyAt: 2500, generation: 3}
	state.heap = scheduler.NewGenericHeap(1)
	state.heap.SetLimit(1)
	state.heap.Push(scheduler.GenericEvent{Kind: scheduler.GenericEventSample, TimeMs: 3000})
	err = state.handleAmmoRecovery(scheduler.GenericEvent{TimeMs: 2500, AmmoGeneration: 3, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "attack"}})
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || !state.basicAttack.ammo.wait.active || state.mechanicRecordCount != 0 || state.combatants["source"].providerState["attack"].state["rounds"] != 0 {
		test.Fatal("failed recovery partially committed", err, state.basicAttack.ammo.wait)
	}
}

func TestAmmoAttackDeathAndStaleRecoveryDoNotWakeOrRefill(test *testing.T) {
	input, request := ammoAttackInput(1, 1000, 10000)
	input.Combatants[1].Attributes["hp"] = authoringSlot(150)
	request.InitialSnapshot.Combatants[1].Attributes["hp"] = authoringSlot(150)
	done := authoringRun(test, input, request)
	if done.Summary.BasicAttack.CompletedCount != 1 || !done.Summary.Execution.TargetKilled || cadenceStateValue(test, done, 0, "attack", "rounds") != 0 || len(done.MechanicRecords) != 2 || done.AttackRecords[0].NextStartAtMs != nil {
		test.Fatal(done.Summary, done.MechanicRecords)
	}
	input, request = ammoAttackInput(0, 1000, 5000)
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	state.nowMs = 2500
	state.combatants["source"].providerState["attack"] = state.newExecutionFrame("source", "target", authoringRef("initial")).providerStateBag("source", "attack", true)
	state.basicAttack.ammo.wait = ammoRecoveryWait{active: true, readyAt: 2500, generation: 3}
	for _, generation := range []uint64{1, 2} {
		if err := state.handleAmmoRecovery(scheduler.GenericEvent{TimeMs: 2500, AmmoGeneration: generation, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "attack"}}); err != nil || state.mechanicRecordCount != 0 {
			test.Fatal(err)
		}
	}
	actor := state.combatants["source"]
	health := actor.attributes["hp"]
	health.Current = 0
	actor.attributes["hp"] = health
	state.combatants["source"] = actor
	if err := state.handleAmmoRecovery(scheduler.GenericEvent{TimeMs: 2500, AmmoGeneration: 3, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "attack"}}); err != nil || state.mechanicRecordCount != 0 || actor.providerState["attack"].state["rounds"] != 0 {
		test.Fatal("dead source reloaded", err)
	}
}

func TestAmmoAttackRecordingPartyAndSessionIsolation(test *testing.T) {
	input, request := ammoAttackInput(4, 1000, 5500)
	input.SharedProviders[0].Listeners[0].AbilityRef = "self.provider[attack].ability[initial]"
	input.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "attack", DefinitionRef: "test_attack"}}
	request.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "attack", DefinitionRef: "test_attack", Source: "target", Owner: "target", Stacks: 1}}
	compiled := authoringCompile(test, input)
	done, err := RunGeneric(compiled, request)
	if err != nil {
		test.Fatal(err)
	}
	if len(done.FinalSnapshot.Combatants[1].ProviderState) != 0 || done.Summary.TargetDamageDealt != 0 {
		test.Fatal("idle side consumed source ammo", done.FinalSnapshot)
	}
	for _, maximum := range []int{0, 1, 3} {
		request.RecordBudget.MaxMechanicRecords = &maximum
		repeated, err := RunGeneric(compiled, request)
		if err != nil || !reflect.DeepEqual(done.Summary, repeated.Summary) || !reflect.DeepEqual(done.FinalSnapshot, repeated.FinalSnapshot) || !reflect.DeepEqual(done.AttackRecords, repeated.AttackRecords) || len(repeated.MechanicRecords) != maximum || repeated.Recording.MechanicRecordCount != done.Recording.MechanicRecordCount || repeated.Recording.DroppedMechanicRecords != done.Recording.MechanicRecordCount-maximum || !repeated.Recording.MechanicRecordsTruncated {
			test.Fatal("record retention or reused session changed execution", err, repeated.Recording)
		}
	}
	request.RecordBudget = nil
	without, err := RunGeneric(compiled, request)
	if err != nil || len(without.MechanicRecords) != 0 || without.Recording.ReturnedMechanicRecords != 0 || !reflect.DeepEqual(done.Summary, without.Summary) {
		test.Fatal("mechanic recording is not disabled by default", err)
	}
}

func TestAmmoCompilationStrictSchemaAndUniqueConsumption(test *testing.T) {
	for _, scenario := range []string{"valueType", "defaultValue", "maxValue", "ammoRecovery", "mode", "startCondition", "intervalMs", "durationMs", "refreshPolicy", "fraction", "negative", "capacity_zero", "capacity_below_initial", "other_mode", "other_start", "interval_zero", "conditional", "variable", "two_rounds", "duplicate", "missing", "wrong_owner", "wrong_scope", "late", "listener_condition", "listener_duplicate", "no_initial", "other_source", "no_context"} {
		test.Run(scenario, func(test *testing.T) {
			input, _ := ammoAttackInput(4, 1000, 10000)
			field := input.SharedProviders[0].InitialStateSchema["rounds"].(map[string]interface{})
			recovery := field["ammoRecovery"].(map[string]interface{})
			process := &input.SharedProviders[0].Processes[0]
			operation := &process.MomentOperations[0].Operations[0]
			switch scenario {
			case "valueType", "defaultValue", "maxValue", "ammoRecovery":
				delete(field, scenario)
			case "mode", "startCondition", "intervalMs":
				delete(recovery, scenario)
			case "durationMs":
				field[scenario] = 0
			case "refreshPolicy":
				field[scenario] = ""
			case "fraction":
				field["defaultValue"] = .5
			case "negative":
				field["defaultValue"] = -1
			case "capacity_zero":
				field["defaultValue"], field["maxValue"] = 0, 0
			case "capacity_below_initial":
				field["maxValue"] = 3
			case "other_mode":
				recovery["mode"] = "one_by_one"
			case "other_start":
				recovery["startCondition"] = "after_use"
			case "interval_zero":
				recovery["intervalMs"] = authoringConst(0)
			case "conditional":
				operation.Condition = authoringAmount(authoringConst(1))
			case "variable":
				operation.Amount = authoringAmount(authoringRead("source.attr.attack_damage.base"))
			case "two_rounds":
				operation.Amount = authoringAmount(authoringConst(-2))
			case "duplicate":
				process.MomentOperations[0].Operations = append(process.MomentOperations[0].Operations, *operation)
			case "missing":
				process.MomentOperations[0].Operations = nil
			case "wrong_owner":
				operation.Target = "target"
			case "wrong_scope":
				operation.Types = []string{stateScopeProviderTarget}
				input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"})
			case "late":
				process.MomentOperations[0].Moment.MomentType = "PROCESS_COMPLETE"
			case "listener_condition":
				input.SharedProviders[0].Listeners[0].Condition = authoringAmount(authoringConst(1))
			case "listener_duplicate":
				input.SharedProviders[0].Listeners = append(input.SharedProviders[0].Listeners, input.SharedProviders[0].Listeners[0])
				input.SharedProviders[0].Listeners[1].ListenerKey = "duplicate_start"
			case "no_initial":
				input.SharedProviders[0].Abilities[1].ProcessControl = nil
			case "other_source":
				input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: "other", Kind: "character", Listeners: []model.ListenerDefinition{{ListenerKey: "read_other", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit}}, Condition: authoringAmount(authoringRead("use.ammo.before"))}}})
			case "no_context":
				process.Cooldown.DurationMs = authoringRead("use.ammo.before")
			}
			if result := compilebundle.CompileGeneric(input); result.OK {
				test.Fatal("invalid ammo contract compiled", scenario)
			}
		})
	}
}

func TestAmmoCaptureRejectsMissingUseAndOtherProviderEvenWithSameSkill(test *testing.T) {
	input, request := ammoAttackInput(4, 1000, 1)
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil || state.runLoop() != nil {
		test.Fatal(err)
	}
	frame := state.newExecutionFrame("source", "target", authoringRef("native_hit"))
	frame.ownerCombatantKey, frame.ownerProviderRef = "source", "attack"
	frame.driverEntryKey = "basic:native-test:1:hit"
	ability := state.compiled.Abilities[2]
	context := frame.evalContext(ability)
	if !context.HasUseAmmoBefore || context.UseAmmoBefore != 4 {
		test.Fatal("original use capture unavailable", context)
	}
	frame.ownerProviderRef = "other_attack"
	if context := frame.evalContext(ability); context.HasUseAmmoBefore {
		test.Fatal("capture crossed provider ownership")
	}
	frame.ownerProviderRef = "attack"
	frame.ownerCombatantKey = "target"
	if context := frame.evalContext(ability); context.HasUseAmmoBefore {
		test.Fatal("capture crossed party ownership")
	}
	if _, err := state.compiled.Formulas.Eval(state.compiled.Operations[ability.OperationStart].SkillHit.Candidates[0].ParticipationProgram, formula.GenericEvalContext{}); err == nil {
		test.Fatal("missing ammo context fell back to current inventory")
	}
}

func TestAmmoRecoveryIntervalFrozenAtEmptyAndRuntimeInvalidIsAtomic(test *testing.T) {
	input, request := ammoAttackInput(1, 1000, 2500)
	input.SharedProviders[0].InitialStateSchema["rounds"].(map[string]interface{})["ammoRecovery"].(map[string]interface{})["intervalMs"] = authoringRead("source.attr.reload_ms.resolved")
	input.Combatants[0].Attributes["reload_ms"] = authoringSlot(2500)
	request.InitialSnapshot.Combatants[0].Attributes["reload_ms"] = authoringSlot(2500)
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	event, _ := state.heap.Pop()
	if !state.basicAttackEventCurrent(event) || state.handleBasicAttack() != nil {
		test.Fatal("first attack failed")
	}
	actor := state.combatants["source"]
	actor.attributes["reload_ms"] = authoringSlot(9000)
	state.combatants["source"] = actor
	if state.basicAttack.ammo.wait.readyAt != 2500 || state.runLoop() != nil || state.basicAttack.summary.CompletedCount != 2 {
		test.Fatal("reload interval was recomputed while waiting")
	}
	for _, invalid := range []float64{0, -.5, .5, math.Inf(1)} {
		input.Combatants[0].Attributes["reload_ms"] = authoringSlot(invalid)
		request.InitialSnapshot.Combatants[0].Attributes["reload_ms"] = authoringSlot(invalid)
		if result, err := RunGeneric(authoringCompile(test, input), request); err == nil {
			test.Fatal("invalid dynamic interval accepted", result.Summary)
		}
	}
}

func TestAmmoRecordBudgetJSONBounds(test *testing.T) {
	for _, payload := range []string{`{"maxMechanicRecords":-1}`, `{"maxMechanicRecords":10001}`, `{"maxMechanicRecords":1.5}`, `{"maxMechanicRecords":null}`} {
		var budget model.RecordBudget
		if json.Unmarshal([]byte(payload), &budget) == nil {
			test.Fatal("invalid mechanic budget accepted", payload)
		}
	}
	for _, payload := range []string{`{}`, `{"maxMechanicRecords":0}`, `{"maxMechanicRecords":10000}`} {
		var budget model.RecordBudget
		if err := json.Unmarshal([]byte(payload), &budget); err != nil {
			test.Fatal(err)
		}
	}
}

func TestAmmoAttackEventAndCommandBudgetsNeverInventUsesOrPartialFrames(test *testing.T) {
	for _, maximum := range []int{1, 2} {
		input, request := ammoAttackInput(0, 1000, 2500)
		request.SafetyBudget = &model.RunSafetyBudget{MaxEvents: maximum}
		state, err := newGenericRunState(authoringCompile(test, input), request)
		if err != nil || state.runLoop() != nil {
			test.Fatal(err)
		}
		done := state.buildDoneResult()
		if done.Summary.BasicAttack.StartedCount != 0 || len(state.skillUses) != 0 || len(state.attackStartFacts) != 0 || len(done.FinalSnapshot.ProcessInstances) != 0 || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxEvents {
			test.Fatal("recovery timer fabricated an attack", done.Summary)
		}
		expected := float64(0)
		if maximum == 2 {
			expected = 4
		}
		if cadenceStateValue(test, done, 0, "attack", "rounds") != expected {
			test.Fatal("event budget partially committed a recovery", done.FinalSnapshot)
		}
	}
	input, request := ammoAttackInput(1, 1000, 2500)
	input.SharedProviders[0].Processes[0].MomentOperations[0].Operations = append(input.SharedProviders[0].Processes[0].MomentOperations[0].Operations,
		model.OperationDefinition{Operation: model.OperationKindApplyHitLink, Target: "target", Amount: authoringAmount(authoringConst(1))})
	request.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil || state.runLoop() != nil {
		test.Fatal(err)
	}
	done := state.buildDoneResult()
	if *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || len(done.MechanicRecords) != 0 || len(done.FinalSnapshot.Combatants[0].Cooldowns) != 0 || len(done.FinalSnapshot.Combatants[0].ProviderState) != 0 || len(done.FinalSnapshot.ProcessInstances) != 0 {
		test.Fatal("command budget partially consumed ammo/cooldown/capture", done.Summary, done.FinalSnapshot)
	}
}

func TestAmmoRecoveryGenerationAndDuplicateEventsCommitOnlyOnce(test *testing.T) {
	input, request := ammoAttackInput(0, 1000, 5000)
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	state.combatants["source"].providerState["attack"] = state.newExecutionFrame("source", "target", authoringRef("initial")).providerStateBag("source", "attack", true)
	state.nowMs = 2500
	state.basicAttack.ammo.wait = ammoRecoveryWait{active: true, readyAt: 2500, generation: 7}
	valid := scheduler.GenericEvent{TimeMs: 2500, AmmoGeneration: 7, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "attack"}}
	for _, invalid := range []scheduler.GenericEvent{
		{TimeMs: 2500, AmmoGeneration: 6, ProviderInstanceRef: valid.ProviderInstanceRef},
		{TimeMs: 2499, AmmoGeneration: 7, ProviderInstanceRef: valid.ProviderInstanceRef},
		{TimeMs: 2500, AmmoGeneration: 7, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "target", ProviderRef: "attack"}},
		{TimeMs: 2500, AmmoGeneration: 7, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "other"}},
	} {
		if err := state.handleAmmoRecovery(invalid); err != nil || state.mechanicRecordCount != 0 {
			test.Fatal("stale recovery committed", err)
		}
	}
	for repeat := 0; repeat < 2; repeat++ {
		if err := state.handleAmmoRecovery(valid); err != nil || state.mechanicRecordCount != 2 || state.combatants["source"].providerState["attack"].state["rounds"] != 4 || len(state.skillUses) != 0 {
			test.Fatal("recovery duplicated or forged a use", err)
		}
	}
}

func TestAmmoAttackCooldownStateDependencyAndExpiredOrdinaryReadyAreIndependentOfReload(test *testing.T) {
	input, request := ammoAttackInput(4, 1000, 11500)
	input.SharedProviders[0].Processes[0].Cooldown.DurationMs = authoringBinary("mul", authoringConst(1000), authoringBinary("add", authoringConst(1), authoringRead("provider.state.rounds")))
	done := authoringRun(test, input, request)
	if len(done.AttackRecords) != 5 {
		test.Fatal(done.AttackRecords)
	}
	for index, expected := range []int64{0, 4000, 7000, 9000, 11500} {
		attack := done.AttackRecords[index]
		if attack.StartAtMs != expected || *attack.ReadyAtMs != []int64{5000, 8000, 10000, 11000, 16500}[index] || *attack.FinalReadyAtMs != []int64{4000, 7000, 9000, 10000, 15500}[index] {
			test.Fatal("state dependency used a pre-consumption period or revived an expired cooldown", done.AttackRecords)
		}
	}
	if *done.AttackRecords[3].MechanicReadyAtMs != 11500 || *done.AttackRecords[3].NextStartAtMs != 11500 {
		test.Fatal("ammo readiness replaced or added to ordinary cooldown", done.AttackRecords[3])
	}
	input, request = ammoAttackInput(4, 1000, 11500)
	input.SharedProviders[0].Processes[0].Cooldown.DurationMs = authoringBinary("mul", authoringConst(1000), authoringBinary("add", authoringConst(1), authoringRead("provider.state.rounds")))
	request.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
	done = authoringRun(test, input, request)
	if *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || len(done.MechanicRecords) != 0 || len(done.FinalSnapshot.Combatants[0].ProviderState) != 0 || len(done.FinalSnapshot.Combatants[0].Cooldowns) != 0 {
		test.Fatal("state-dependent wait budget partially committed a consumption", done.FinalSnapshot)
	}
}

func TestAmmoTypedSchemaJSONCarriesNoCounterLifetime(test *testing.T) {
	input, _ := ammoAttackInput(0, 1000, 2500)
	for _, duration := range []int64{0, 10} {
		encoded, err := json.Marshal(model.ProviderStateFieldSchema{ValueType: model.ProviderStateValueInteger, DefaultValue: 0, MaxValue: 4,
			StateKind: model.ProviderStateKindAmmo, DurationMs: duration, AmmoRecovery: &model.AmmoRecoverySchema{
				IntervalMs: authoringConst(2500), Mode: model.AmmoRecoveryAllAtOnce, StartCondition: model.AmmoRecoveryWhenEmpty}})
		var field map[string]interface{}
		if err != nil || json.Unmarshal(encoded, &field) != nil {
			test.Fatal(err)
		}
		input.SharedProviders[0].InitialStateSchema["rounds"] = field
		result := compilebundle.CompileGeneric(input)
		if (duration == 0) != result.OK {
			test.Fatal("typed schema mixed ammo recovery with a counter lifetime", string(encoded), result.Result.Errors)
		}
	}
}

func TestAmmoNativeSessionFrameReuseErrorRecoveryAndRelease(test *testing.T) {
	input, request := ammoAttackInput(4, 1000, 5500)
	session := NewSession()
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, input)); code != 0 {
		test.Fatal("native compile frame failed", code, lastGenericError(session.OutboxBytes()))
	}
	compiled := lastGenericCompileResult(session.OutboxBytes())
	if !compiled.OK || compiled.SessionID == "" {
		test.Fatal(compiled)
	}
	request.SessionID, request.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
	var baseline model.DoneResult
	for iteration := 0; iteration < 4; iteration++ {
		session.ClearOutbox()
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, request)); code != 0 {
			test.Fatal("native reused run failed", code, lastGenericError(session.OutboxBytes()))
		}
		done := lastGenericRunDone(session.OutboxBytes())
		if !done.OK || done.Summary.BasicAttack.CompletedCount != 5 || done.AttackRecords[4].StartAtMs != 5500 || len(done.MechanicRecords) != 8 {
			test.Fatal(done.Summary, done.Recording)
		}
		if iteration > 0 && !reflect.DeepEqual(baseline, done) {
			test.Fatal("ammo capture/reload state leaked across native session runs")
		}
		baseline = done
		invalid := request
		invalid.ExpectedRulesHash = "incorrect-rules"
		session.ClearOutbox()
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, invalid)); code == 0 || lastGenericError(session.OutboxBytes()).Code != model.GenericErrHashMismatch {
			test.Fatal("native session accepted invalid hash", code)
		}
	}
	session.ClearOutbox()
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, model.ReleaseSessionRequest{SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash})); code != 0 || !lastGenericReleaseDone(session.OutboxBytes()).Released {
		test.Fatal("native session did not release", code)
	}
	session.ClearOutbox()
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, request)); code == 0 || lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
		test.Fatal("released native ammo session still runs", code)
	}
}

func TestAmmoInitialRecoveryFactIsCommittedAndIndependentOfRecords(test *testing.T) {
	for _, maximum := range []int{0, 1, 100} {
		for _, duration := range []int64{2499, 2500, 5500} {
			input, request := ammoAttackInput(0, 1000, duration)
			request.RecordBudget.MaxMechanicRecords = &maximum
			done := authoringRun(test, input, request)
			ready := done.Summary.BasicAttack.InitialMechanicReadyAtMs
			if !done.Summary.Execution.Complete || ready == nil || *ready != 2500 ||
				(duration == 2499 && done.Summary.BasicAttack.StartedCount != 0) ||
				(duration >= 2500 && done.AttackRecords[0].StartAtMs != *ready) {
				test.Fatal(duration, maximum, done.Summary, done.AttackRecords)
			}
		}
	}
	input, request := ammoAttackInput(0, 1000, 2500)
	input.Settings.MaxQueueEvents = 1
	done := authoringRun(test, input, request)
	if done.Summary.BasicAttack.InitialMechanicReadyAtMs != nil || done.Summary.Execution.Complete {
		test.Fatal("failed recovery queue preflight published an initial ready fact", done.Summary)
	}
}

func TestAmmoAndIndependentSameNamedCounterKeepTheirProviderIdentity(test *testing.T) {
	for _, swapped := range []bool{false, true} {
		test.Run(map[bool]string{false: "ammo_first", true: "counter_first"}[swapped], func(test *testing.T) {
			input, request := ammoAttackInput(4, 1000, 5500)
			counterRef := addTriggeredSkillSource(&input, &request, 0, "independent_rounds", "character",
				sourceCounterDefinition(model.EventTypeBasicAttackHit, eventSourceOwner, stateScopeProvider, "rounds", 99, 0))
			if swapped {
				last := len(input.SharedProviders) - 1
				input.SharedProviders[0], input.SharedProviders[last] = input.SharedProviders[last], input.SharedProviders[0]
			}
			done := authoringRun(test, input, request)
			if !done.Summary.Execution.Complete || done.Summary.BasicAttack.HitCount != 5 ||
				cadenceStateValue(test, done, 0, counterRef, "rounds") != 5 ||
				cadenceStateValue(test, done, 0, "attack", "rounds") != 3 || len(done.MechanicRecords) != 8 {
				test.Fatal(done.Summary, done.FinalSnapshot, done.MechanicRecords)
			}
			for _, record := range done.MechanicRecords {
				if record.ProviderRef != "attack" || record.StateKey != "rounds" {
					test.Fatal("counter entered the ammo record chain", record)
				}
			}
		})
	}
}

func TestAmmoReadInExternalDriverConditionIsStrictlyRejected(test *testing.T) {
	input, request := authoringInput()
	request.DriverPlan.Entries[0].Condition = authoringAmount(authoringRead("use.ammo.before"))
	if _, err := RunGeneric(authoringCompile(test, input), request); err == nil || err.Code != model.GenericErrFormulaTypeError {
		test.Fatal("out-of-context use read became a skipped false condition", err)
	}
}
