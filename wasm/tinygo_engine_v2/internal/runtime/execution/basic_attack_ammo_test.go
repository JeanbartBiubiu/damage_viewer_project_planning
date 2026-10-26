package execution

import (
	math "math"
	testing "testing"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
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
	done := state.buildDoneResult(false)
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
		done := state.buildDoneResult(false)
		if done.Summary.Execution.BudgetCause == nil || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxQueueEvents || len(done.FinalSnapshot.Combatants[0].ProviderState) != 0 || len(done.MechanicRecords) != 0 || state.actions.BasicAttack().Ammo().Wait().Active || len(done.FinalSnapshot.ProcessInstances) != 0 || len(done.FinalSnapshot.Combatants[0].Cooldowns) != 0 {
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
	state.loop.Advance(2500)

	state.actions.PublishAmmoWait(state.actions.BasicAttack().Ammo(), actionpkg.AmmoWait{Active: true, ReadyAt: 2500, Generation: 3})
	*state.loop.Queue() = scheduler.NewGenericHeap(1)
	state.loop.Queue().SetLimit(1)
	state.loop.Queue().Push(scheduler.GenericEvent{Kind: scheduler.GenericEventSample, TimeMs: 3000})
	err = state.handleAmmoRecovery(scheduler.GenericEvent{TimeMs: 2500, AmmoGeneration: 3, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "attack"}})
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || !state.actions.BasicAttack().Ammo().Wait().Active || state.recordingSummary().MechanicRecordCount != 0 || state.combatants["source"].providerState.Lookup("attack").State().At("rounds") != 0 {
		test.Fatal("failed recovery partially committed", err, state.actions.BasicAttack().Ammo().Wait())
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
	state.loop.Advance(2500)

	state.actions.PublishAmmoWait(state.actions.BasicAttack().Ammo(), actionpkg.AmmoWait{Active: true, ReadyAt: 2500, Generation: 3})
	for _, generation := range []uint64{1, 2} {
		if err := state.handleAmmoRecovery(scheduler.GenericEvent{TimeMs: 2500, AmmoGeneration: generation, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "attack"}}); err != nil || state.recordingSummary().MechanicRecordCount != 0 {
			test.Fatal(err)
		}
	}
	actor := state.combatants["source"]
	health := actor.attributesView().At("hp")
	health.Current = 0

	actor.setAttributes(actor.attributesView().With("hp", health))
	state.combatants["source"] = actor
	if err := state.handleAmmoRecovery(scheduler.GenericEvent{TimeMs: 2500, AmmoGeneration: 3, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "attack"}}); err != nil || state.recordingSummary().MechanicRecordCount != 0 || actor.providerState.Lookup("attack").State().At("rounds") != 0 {
		test.Fatal("dead source reloaded", err)
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
	event, _ := state.loop.Queue().Pop()
	if !state.basicAttackEventCurrent(event) || state.handleBasicAttack() != nil {
		test.Fatal("first attack failed")
	}
	actor := state.combatants["source"]

	actor.setAttributes(actor.attributesView().With("reload_ms", authoringSlot(9000)))
	state.combatants["source"] = actor
	if state.actions.BasicAttack().Ammo().Wait().ReadyAt != 2500 || state.runLoop() != nil || state.actions.BasicAttack().CompletedCount() != 2 {
		test.Fatal("reload interval was recomputed while waiting")
	}
	for _, invalid := range []float64{0, -.5, .5, math.Inf(1)} {
		input.Combatants[0].Attributes["reload_ms"] = authoringSlot(invalid)
		request.InitialSnapshot.Combatants[0].Attributes["reload_ms"] = authoringSlot(invalid)
		if result, err := runForTest(authoringCompile(test, input), request); err == nil {
			test.Fatal("invalid dynamic interval accepted", result.Summary)
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
		done := state.buildDoneResult(false)
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
	done := state.buildDoneResult(false)
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

	state.loop.Advance(2500)
	state.actions.PublishAmmoWait(state.actions.BasicAttack().Ammo(), actionpkg.AmmoWait{Active: true, ReadyAt: 2500, Generation: 7})
	valid := scheduler.GenericEvent{TimeMs: 2500, AmmoGeneration: 7, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "attack"}}
	for _, invalid := range []scheduler.GenericEvent{
		{TimeMs: 2500, AmmoGeneration: 6, ProviderInstanceRef: valid.ProviderInstanceRef},
		{TimeMs: 2499, AmmoGeneration: 7, ProviderInstanceRef: valid.ProviderInstanceRef},
		{TimeMs: 2500, AmmoGeneration: 7, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "target", ProviderRef: "attack"}},
		{TimeMs: 2500, AmmoGeneration: 7, ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "other"}},
	} {
		if err := state.handleAmmoRecovery(invalid); err != nil || state.recordingSummary().MechanicRecordCount != 0 {
			test.Fatal("stale recovery committed", err)
		}
	}
	for repeat := 0; repeat < 2; repeat++ {
		if err := state.handleAmmoRecovery(valid); err != nil || state.recordingSummary().MechanicRecordCount != 2 || state.combatants["source"].providerState.Lookup("attack").State().At("rounds") != 4 || len(state.skillUses) != 0 {
			test.Fatal("recovery duplicated or forged a use", err)
		}
	}
}
