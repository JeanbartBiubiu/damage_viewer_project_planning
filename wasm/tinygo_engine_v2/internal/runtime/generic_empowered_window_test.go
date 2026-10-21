package runtime

import (
	"encoding/json"
	"reflect"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func countedEmpoweredInput(t *testing.T, at, window, duration int64, count float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, request := empoweredInput(t, "finite_window", at, window, duration)
	p := &input.SharedProviders[len(input.SharedProviders)-1]
	consume := "ATTACK_START"
	p.Processes[0].Steps[0].ConsumeMoment = &consume
	p.Processes[0].Steps[0].MaximumAttackCount = timedShieldExpr(count)
	p.Processes[0].Cooldown.DurationMs = authoringConst(8000)
	p.Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}
	return input, request
}

func TestCountedEmpoweredWindowOriginalTimerRetainsPendingAttackAndLaterRealHit(t *testing.T) {
	state := countedNativeState(t)
	use, hitKey, err := beginCountedNativeAttack(state)
	if err != nil {
		t.Fatal(err)
	}
	p := countedLiveProcess(t, state)
	found := false
	for state.heap.Len() > 0 {
		event, _ := state.heap.Pop()
		if event.Kind != scheduler.GenericEventProcessTimer || event.TimeMs != 6000 {
			continue
		}
		state.nowMs = event.TimeMs
		if err := state.handleProcessTimer(event); err != nil {
			t.Fatal(err)
		}
		found = true
		break
	}
	if !found || p.Status != "complete" || p.StepVersion != 1 || p.StepExecutionIndex != 0 || *p.FinishedAtMs != 6000 || p.EmpoweredAttackWindow.ConsumptionCount != 1 || p.EmpoweredAttackWindow.PendingHitCount != 1 || p.empoweredResolvedPublished || p.EmpoweredAttackWindow.Consumptions[0].ResolvedAtMs != nil {
		t.Fatal("timeout stole a pending attack or timer went stale", p)
	}
	state.nowMs = 7000
	if err := state.executeAbilityCast(model.DriverEntry{EntryKey: hitKey, AbilityRef: state.basicAttack.plan.HitAbilityRef, Source: "source", Target: "target", FirstAtMs: 7000}); err != nil {
		t.Fatal(err)
	}
	if state.sourceDamageDealt != 110 || p.EmpoweredAttackWindow.PendingHitCount != 0 || p.EmpoweredAttackWindow.Consumptions[0].UseRef != use || !p.empoweredResolvedPublished {
		t.Fatal(p, state.sourceDamageDealt)
	}
}

func TestCountedEmpoweredWindowDelayedOldHitDoesNotBorrowNewWindow(t *testing.T) {
	input, request := countedEmpoweredInput(t, 0, 6000, 20000, 3)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeProcessResolved, Domain: "event"})
	next := request.DriverPlan.SkillActions[0]
	next.InstructionKey, next.FirstAtMs = "second_window", 10000
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, next)
	state := frameCommitState(t, input, request)
	if err := state.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	for _, at := range []int64{0, 1000} {
		state.nowMs = at
		if err := state.handleBasicAttack(); err != nil {
			t.Fatal(err)
		}
	}
	state.nowMs = 2000
	_, hitKey, err := beginCountedNativeAttack(state)
	if err != nil {
		t.Fatal(err)
	}
	old := countedLiveProcess(t, state)
	state.nowMs = 10000
	if err := state.handleSkillAction(1); err != nil {
		t.Fatal(err)
	}
	var newer *processRuntime
	for _, p := range state.processInstances {
		if p.UseKey == "skill:second_window" {
			newer = p
		}
	}
	if newer == nil || newer.EmpoweredAttackWindow.ConsumptionCount != 0 || old.EmpoweredAttackWindow.PendingHitCount != 1 {
		t.Fatal(old, newer)
	}
	state.nowMs = 10500
	if err := state.executeAbilityCast(model.DriverEntry{EntryKey: hitKey, AbilityRef: state.basicAttack.plan.HitAbilityRef, Source: "source", Target: "target", FirstAtMs: 10500}); err != nil {
		t.Fatal(err)
	}
	if state.sourceDamageDealt != 330 || old.EmpoweredAttackWindow.PendingHitCount != 0 || newer.EmpoweredAttackWindow.ConsumptionCount != 0 || !old.empoweredResolvedPublished || newer.empoweredResolvedPublished {
		t.Fatal("old reservation crossed window identity", old, newer, state.sourceDamageDealt)
	}
}

func countedNativeState(t *testing.T) *genericRunState {
	t.Helper()
	input, request := countedEmpoweredInput(t, 0, 6000, 15000, 3)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeProcessResolved, Domain: "event"})
	state := frameCommitState(t, input, request)
	if err := state.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	return state
}

func countedLiveProcess(t *testing.T, state *genericRunState) *processRuntime {
	t.Helper()
	for _, process := range state.processInstances {
		if process.UseKey == "skill:finite_window_first" {
			return process
		}
	}
	t.Fatal("actual window was not started")
	return nil
}

func beginCountedNativeAttack(state *genericRunState) (string, string, *model.EngineError) {
	state.basicAttackEventActive = true
	state.currentEventCommands = 0
	defer func() { state.basicAttackEventActive = false; state.finishCurrentAttackRecord() }()
	return state.beginNativeBasicAttackUse()
}

func TestCountedEmpoweredWindowFinalNativeStartSurvivesCompletionAndDeadline(t *testing.T) {
	state := countedNativeState(t)
	for _, at := range []int64{0, 1000} {
		state.nowMs = at
		if err := state.handleBasicAttack(); err != nil {
			t.Fatal(err)
		}
	}
	state.nowMs = 2000
	use, hitKey, err := beginCountedNativeAttack(state)
	if err != nil {
		t.Fatal(err)
	}
	p := countedLiveProcess(t, state)
	if p.Status != "complete" || *p.FinishedAtMs != 2000 || p.EmpoweredAttackWindow.ConsumptionCount != 3 || p.EmpoweredAttackWindow.PendingHitCount != 1 || p.empoweredResolvedPublished || state.sourceDamageDealt != 220 || state.combatants["source"].cooldowns.abilityReadyAt("source", p.abilityRef) != 10000 {
		t.Fatal(p, state.sourceDamageDealt)
	}
	if err := state.publishProcessResolved(p); err != nil || p.empoweredResolvedPublished {
		t.Fatal("unsettled final attack published process resolution", err)
	}
	state.nowMs = 7000
	entry := model.DriverEntry{EntryKey: hitKey, AbilityRef: state.basicAttack.plan.HitAbilityRef, Source: "source", Target: "target", FirstAtMs: 7000}
	if err := state.executeAbilityCast(entry); err != nil {
		t.Fatal(err)
	}
	row := p.EmpoweredAttackWindow.Consumptions[2]
	if state.sourceDamageDealt != 330 || p.EmpoweredAttackWindow.PendingHitCount != 0 || row.UseRef != use || row.StartedAtMs != 2000 || row.ResolvedAtMs == nil || *row.ResolvedAtMs != 7000 || row.HitRef == nil || *row.HitRef != "hit:3" || !p.empoweredResolvedPublished || *p.FinishedAtMs != 2000 {
		t.Fatal(p, state.sourceDamageDealt)
	}
	// Re-delivering a hit cannot borrow or spend the already settled payload again.
	if err := state.executeAbilityCast(entry); err != nil {
		t.Fatal(err)
	}
	if state.sourceDamageDealt != 340 || p.EmpoweredAttackWindow.ConsumptionCount != 3 || len(state.skillUses[p.UseKey].contacts) != 3 {
		t.Fatal("reservation was reused", state.sourceDamageDealt, p)
	}
}

func TestCountedEmpoweredWindowActualMissConsumesWithoutRefundAndCannotBeForged(t *testing.T) {
	state := countedNativeState(t)
	p := countedLiveProcess(t, state)
	if err := state.reserveEmpoweredAttackStart("not_a_native_attack", "target"); err == nil || p.EmpoweredAttackWindow.ConsumptionCount != 0 {
		t.Fatal("forged start consumed charge", err, p)
	}
	use, _, err := beginCountedNativeAttack(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.finishReservedEmpoweredMiss(use); err == nil {
		t.Fatal("uncompleted attack was guessed to miss")
	}
	state.basicAttack.current.Completed = true
	if err := state.finishReservedEmpoweredMiss(use); err != nil {
		t.Fatal(err)
	}
	if p.EmpoweredAttackWindow.ConsumptionCount != 1 || p.EmpoweredAttackWindow.PendingHitCount != 0 || p.EmpoweredAttackWindow.Consumptions[0].HitRef != nil || p.EmpoweredAttackWindow.Consumptions[0].ResolvedAtMs == nil || state.sourceDamageDealt != 0 {
		t.Fatal(p, state.sourceDamageDealt)
	}
	for _, at := range []int64{1000, 2000} {
		state.nowMs = at
		if err := state.handleBasicAttack(); err != nil {
			t.Fatal(err)
		}
	}
	if p.Status != "complete" || p.EmpoweredAttackWindow.ConsumptionCount != 3 || p.EmpoweredAttackWindow.PendingHitCount != 0 || state.sourceDamageDealt != 220 || len(state.skillUses[p.UseKey].contacts) != 2 || !p.empoweredResolvedPublished {
		t.Fatal(p, state.sourceDamageDealt)
	}
}

func TestCountedEmpoweredWindowFinalStartFailureKeepsPriorHitsAndChargeAtomic(t *testing.T) {
	input, request := countedEmpoweredInput(t, 0, 6000, 4000, 3)
	setCombatantAttr(&input, &request, "source", "cooldown_scale", authoringSlot(0))
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "cooldown_scale", Domain: "attribute"})
	formula := formuladefinition.FromExpr("end_cooldown", "finite_window", authoringBinary("div", authoringConst(8000), authoringRead("source.attr.cooldown_scale.resolved")), nil)
	input.Formulas = append(input.Formulas, formula)
	input.SharedProviders[len(input.SharedProviders)-1].Processes[0].Cooldown.DurationMs = model.GenericFormulaExpr{Op: "ref", Ref: "end_cooldown"}
	state := frameCommitState(t, input, request)
	if err := state.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	for _, at := range []int64{0, 1000} {
		state.nowMs = at
		if err := state.handleBasicAttack(); err != nil {
			t.Fatal(err)
		}
	}
	state.nowMs = 2000
	if _, _, err := beginCountedNativeAttack(state); err == nil {
		t.Fatal("invalid completion cooldown should fail final consumption")
	}
	p := countedLiveProcess(t, state)
	if p.Status != "active" || p.CooldownStarted || p.FinishedAtMs != nil || p.EmpoweredAttackWindow.ConsumptionCount != 2 || p.EmpoweredAttackWindow.PendingHitCount != 0 || state.skillUses[state.basicAttack.current.UseRef].empoweredProcess != nil || state.sourceDamageDealt != 220 || state.evidenceCountsByKind["empowered_attack_consumed"] != 2 {
		t.Fatal(p, state.sourceDamageDealt)
	}
}

func TestCountedEmpoweredWindowConsumesThreeNativeStartsAndPreservesOldStepIdentity(t *testing.T) {
	input, request := countedEmpoweredInput(t, 100, 6000, 4000, 3)
	full := authoringRun(t, input, request)
	p := empoweredProcess(t, full, "skill:finite_window_first")
	w := p.EmpoweredAttackWindow
	if w == nil || w.ConsumptionCount != 3 || w.PendingHitCount != 0 || len(w.Consumptions) != 3 || p.Status != "complete" || p.StepVersion != 1 || p.StepExecutionIndex != 0 || p.LastExecutionAtMs != nil || p.EmpoweredAttack != nil || p.FinishedAtMs == nil || *p.FinishedAtMs != 3000 || p.StepCompletedAtMs == nil || *p.StepCompletedAtMs != 3000 {
		t.Fatal(p)
	}
	for i, c := range w.Consumptions {
		if c.ConsumptionIndex != i+1 || c.UseRef != full.AttackRecords[i+1].UseRef || c.StartedAtMs != int64(i+1)*1000 || c.HitRef == nil || *c.HitRef != "hit:"+itoa(uint32(i+2)) || c.HitSequence == nil || *c.HitSequence != 1 || c.ResolvedAtMs == nil || *c.ResolvedAtMs != c.StartedAtMs {
			t.Fatal(c, full.AttackRecords)
		}
	}
	if full.Summary.SourceDamageDealt != 350 || full.Summary.SkillUses.CompletedCount != 1 || full.Summary.SkillUses.HitCount != 3 || full.Summary.SkillUses.StepExecutedCount != 3 || full.Summary.SkillUses.ReleasedCount != 3 || full.Summary.SkillUses.StepCompletedCount != 1 {
		t.Fatal(full.Summary)
	}
	ready := false
	for _, cooldown := range full.FinalSnapshot.Combatants[0].Cooldowns {
		row, ok := cooldown.(map[string]interface{})
		ready = ready || ok && row["readyAtMs"] == int64(11000)
	}
	if !ready {
		t.Fatal("last START did not start the 8000ms cooldown", full.FinalSnapshot.Combatants[0].Cooldowns)
	}
	counts := map[string]int{}
	for _, record := range full.SkillUseRecords {
		if record.SkillKey != "finite_window" {
			continue
		}
		counts[record.Kind]++
		if record.Kind == "HIT" || record.Kind == "STEP_EXECUTED" || record.Kind == "RELEASED" {
			if record.ExecutionIndex != 0 || record.EmpoweredAttack == nil || record.Target != "target" {
				t.Fatal(record)
			}
		}
		if record.Kind == "COMPLETED" && (record.TimeMs != 3000 || record.EmpoweredAttack != nil || record.Target != "source") {
			t.Fatal(record)
		}
	}
	if counts["HIT"] != 3 || counts["COMPLETED"] != 1 {
		t.Fatal(counts)
	}
	for _, mode := range []model.RunOutputMode{"", model.RunOutputSummary} {
		zero := 0
		request.OutputMode = mode
		request.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero, MaxSkillUseRecords: &zero}
		done := authoringRun(t, input, request)
		if !reflect.DeepEqual(full.Summary, done.Summary) || !reflect.DeepEqual(full.FinalSnapshot, done.FinalSnapshot) {
			t.Fatal("retention changed quota battle")
		}
	}
	raw, err := json.Marshal(full.FinalSnapshot.ProcessInstances)
	if err != nil {
		t.Fatal(err)
	}
	var roundtrip []model.ProcessInstanceSnapshot
	if err := json.Unmarshal(raw, &roundtrip); err != nil || !reflect.DeepEqual(roundtrip, full.FinalSnapshot.ProcessInstances) {
		t.Fatal(err, string(raw))
	}
}

func TestCountedEmpoweredWindowExpiryWinsAtEqualTimeAndStartsCooldown(t *testing.T) {
	for _, window := range []int64{5999, 6000, 6001} {
		input, request := countedEmpoweredInput(t, 0, window, 6500, 3)
		setCombatantAttr(&input, &request, "source", "attack_speed", authoringSlot(1.0/3))
		done := authoringRun(t, input, request)
		p := empoweredProcess(t, done, "skill:finite_window_first")
		count, damage, end := 2, float64(230), window
		if window == 6001 {
			count, damage, end = 3, 330, 6000
		}
		if p.Status != "complete" || p.FailureReason != nil || p.EmpoweredAttackWindow.ConsumptionCount != count || p.EmpoweredAttackWindow.PendingHitCount != 0 || *p.FinishedAtMs != end || done.Summary.SourceDamageDealt != damage || done.Summary.SkillUses.CompletedCount != 1 || done.Summary.SkillUses.FailedCount != 0 {
			t.Fatal(window, p, done.Summary)
		}
		found := false
		for _, cooldown := range done.FinalSnapshot.Combatants[0].Cooldowns {
			row, ok := cooldown.(map[string]interface{})
			found = found || ok && row["readyAtMs"] == end+8000
		}
		if !found {
			t.Fatal(window, "expiry did not start cooldown", done.FinalSnapshot)
		}
	}
}

func TestCountedEmpoweredWindowCannotReopenWhileActive(t *testing.T) {
	input, request := countedEmpoweredInput(t, 100, 6000, 2200, 3)
	again := request.DriverPlan.SkillActions[0]
	again.InstructionKey, again.FirstAtMs = "too_early", 1500
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, again)
	done := authoringRun(t, input, request)
	p := empoweredProcess(t, done, "skill:finite_window_first")
	if p.Status != "active" || p.EmpoweredAttackWindow.ConsumptionCount != 2 || done.Summary.SkillUses.StartedCount != 1 || done.Summary.SkillActions.AcceptedCount != 1 {
		t.Fatal(p, done.Summary)
	}
}

func TestCountedEmpoweredWindowPayloadReadsOnlyFrozenSceneValue(t *testing.T) {
	input, request := countedEmpoweredInput(t, 100, 6000, 4000, 3)
	definition := formuladefinition.FromExpr("frozen_spikes", "finite_window", authoringBinary("add", authoringConst(10), authoringBinary("mul", authoringConst(6), authoringRead("ability.param.feast"))), nil)
	definition.Parameters[0].ValueType = "INTEGER"
	definition.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: model.Float64Ptr(3)}
	input.Formulas = append(input.Formulas, definition)
	input.SharedProviders[len(input.SharedProviders)-1].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "ref", Ref: "frozen_spikes"}
	compiled := authoringCompile(t, input)
	first, err := RunGeneric(compiled, request)
	if err != nil || first.Summary.SourceDamageDealt != 134 {
		t.Fatal(err, first.Summary)
	}
	second, err := RunGeneric(compiled, request)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatal("frozen scene value changed across runs", err)
	}
}

func TestCountedEmpoweredWindowCompileRejectsBadModeCountAndReplacement(t *testing.T) {
	for _, change := range []string{"zero", "fraction", "large", "dynamic", "missing_ref", "hit", "no_count", "wrong_step", "replace", "early_cooldown"} {
		input, _ := countedEmpoweredInput(t, 100, 6000, 4000, 3)
		provider := &input.SharedProviders[len(input.SharedProviders)-1]
		step := &provider.Processes[0].Steps[0]
		switch change {
		case "zero":
			step.MaximumAttackCount = timedShieldExpr(0)
		case "fraction":
			step.MaximumAttackCount = timedShieldExpr(1.5)
		case "large":
			step.MaximumAttackCount = timedShieldExpr(65)
		case "dynamic":
			value := authoringRead("source.attr.attack_damage")
			step.MaximumAttackCount = &value
		case "missing_ref":
			step.MaximumAttackCount = &model.GenericFormulaExpr{Op: "ref", Ref: "missing_formula"}
		case "hit":
			value := "ATTACK_HIT"
			step.ConsumeMoment = &value
		case "no_count":
			step.MaximumAttackCount = nil
		case "wrong_step":
			step.StepType = "IMMEDIATE"
		case "replace":
			provider.Abilities[1].Operations[0].SkillHit.Candidates[0].AttackDamageRole = model.AttackDamageRoleReplacePrimary
		case "early_cooldown":
			provider.Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "PROCESS_START"}
		}
		if result := compilebundle.CompileGeneric(input); result.OK {
			t.Fatal("unsupported quota mode accepted", change)
		}
	}
}
