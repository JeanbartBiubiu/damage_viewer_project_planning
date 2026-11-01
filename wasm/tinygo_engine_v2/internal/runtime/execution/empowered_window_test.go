package execution

import (
	json "encoding/json"
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
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
	for state.loop.Queue().Len() > 0 {
		event, _ := state.loop.Queue().Pop()
		if event.Kind != scheduler.GenericEventProcessTimer || event.TimeMs != 6000 {
			continue
		}
		state.loop.Advance(event.TimeMs)
		if err := state.handleProcessTimer(event); err != nil {
			t.Fatal(err)
		}
		found = true
		break
	}
	if !found || p.Status() != "complete" || p.StepVersion() != 1 || p.StepExecutionIndex() != 0 || *p.FinishedAtMs() != 6000 || p.EmpoweredAttackWindow().ConsumptionCount != 1 || p.EmpoweredAttackWindow().PendingHitCount != 1 || p.EmpoweredResolvedPublished() || p.EmpoweredAttackWindow().Consumptions[0].ResolvedAtMs != nil {
		t.Fatal("timeout stole a pending attack or timer went stale", p)
	}
	state.loop.Advance(7000)
	if err := state.executeAbilityCast(model.DriverEntry{EntryKey: hitKey, AbilityRef: state.actions.BasicAttack().Plan().HitAbilityRef, Source: "source", Target: "target", FirstAtMs: 7000}); err != nil {
		t.Fatal(err)
	}
	if state.report.Totals().SourceDamageDealt != 110 || p.EmpoweredAttackWindow().PendingHitCount != 0 || p.EmpoweredAttackWindow().Consumptions[0].UseRef != use || !p.EmpoweredResolvedPublished() {
		t.Fatal(p, state.report.Totals().SourceDamageDealt)
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
		state.loop.Advance(at)
		if err := state.handleBasicAttack(); err != nil {
			t.Fatal(err)
		}
	}
	state.loop.Advance(2000)
	_, hitKey, err := beginCountedNativeAttack(state)
	if err != nil {
		t.Fatal(err)
	}
	old := countedLiveProcess(t, state)
	state.loop.Advance(10000)
	if err := state.handleSkillAction(1); err != nil {
		t.Fatal(err)
	}
	var newer *actionpkg.ProcessView
	for processSlot := 0; processSlot < state.actions.ProcessCount(); processSlot++ {
		p := state.actions.ProcessAt(processSlot)
		if p.UseKey() == "skill:second_window" {
			newer = p
		}
	}
	if newer == nil || newer.EmpoweredAttackWindow().ConsumptionCount != 0 || old.EmpoweredAttackWindow().PendingHitCount != 1 {
		t.Fatal(old, newer)
	}
	state.loop.Advance(10500)
	if err := state.executeAbilityCast(model.DriverEntry{EntryKey: hitKey, AbilityRef: state.actions.BasicAttack().Plan().HitAbilityRef, Source: "source", Target: "target", FirstAtMs: 10500}); err != nil {
		t.Fatal(err)
	}
	if state.report.Totals().SourceDamageDealt != 330 || old.EmpoweredAttackWindow().PendingHitCount != 0 || newer.EmpoweredAttackWindow().ConsumptionCount != 0 || !old.EmpoweredResolvedPublished() || newer.EmpoweredResolvedPublished() {
		t.Fatal("old reservation crossed window identity", old, newer, state.report.Totals().SourceDamageDealt)
	}
}

func countedNativeState(t *testing.T) *Engine {
	t.Helper()
	input, request := countedEmpoweredInput(t, 0, 6000, 15000, 3)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeProcessResolved, Domain: "event"})
	state := frameCommitState(t, input, request)
	if err := state.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	return state
}

func countedLiveProcess(t *testing.T, state *Engine) *actionpkg.ProcessView {
	t.Helper()
	for processSlot := 0; processSlot < state.actions.ProcessCount(); processSlot++ {
		process := state.actions.ProcessAt(processSlot)
		if process.UseKey() == "skill:finite_window_first" {
			return process
		}
	}
	t.Fatal("actual window was not started")
	return nil
}

func beginCountedNativeAttack(state *Engine) (string, string, *model.EngineError) {
	state.actions.SetAttackActive(true)
	state.currentEventCommands = 0
	defer func() { state.actions.SetAttackActive(false); state.finishCurrentAttackRecord() }()
	return state.beginNativeBasicAttackUse()
}

func TestCountedEmpoweredWindowFinalNativeStartSurvivesCompletionAndDeadline(t *testing.T) {
	state := countedNativeState(t)
	for _, at := range []int64{0, 1000} {
		state.loop.Advance(at)
		if err := state.handleBasicAttack(); err != nil {
			t.Fatal(err)
		}
	}
	state.loop.Advance(2000)
	use, hitKey, err := beginCountedNativeAttack(state)
	if err != nil {
		t.Fatal(err)
	}
	p := countedLiveProcess(t, state)
	if p.Status() != "complete" || *p.FinishedAtMs() != 2000 || p.EmpoweredAttackWindow().ConsumptionCount != 3 || p.EmpoweredAttackWindow().PendingHitCount != 1 || p.EmpoweredResolvedPublished() || state.report.Totals().SourceDamageDealt != 220 || state.combatants["source"].cooldowns.AbilityReadyAt("source", p.AbilityRef()) != 10000 {
		t.Fatal(p, state.report.Totals().SourceDamageDealt)
	}
	if err := state.publishProcessResolved(p); err != nil || p.EmpoweredResolvedPublished() {
		t.Fatal("unsettled final attack published process resolution", err)
	}
	state.loop.Advance(7000)
	entry := model.DriverEntry{EntryKey: hitKey, AbilityRef: state.actions.BasicAttack().Plan().HitAbilityRef, Source: "source", Target: "target", FirstAtMs: 7000}
	if err := state.executeAbilityCast(entry); err != nil {
		t.Fatal(err)
	}
	row := p.EmpoweredAttackWindow().Consumptions[2]
	if state.report.Totals().SourceDamageDealt != 330 || p.EmpoweredAttackWindow().PendingHitCount != 0 || row.UseRef != use || row.StartedAtMs != 2000 || row.ResolvedAtMs == nil || *row.ResolvedAtMs != 7000 || row.HitRef == nil || *row.HitRef != "hit:3" || !p.EmpoweredResolvedPublished() || *p.FinishedAtMs() != 2000 {
		t.Fatal(p, state.report.Totals().SourceDamageDealt)
	}
	// Re-delivering a hit cannot borrow or spend the already settled payload again.
	if err := state.executeAbilityCast(entry); err != nil {
		t.Fatal(err)
	}
	if state.report.Totals().SourceDamageDealt != 340 || p.EmpoweredAttackWindow().ConsumptionCount != 3 || state.skillUses[p.UseKey()].history.ContactCount() != 3 {
		t.Fatal("reservation was reused", state.report.Totals().SourceDamageDealt, p)
	}
}

func TestCountedEmpoweredWindowActualMissConsumesWithoutRefundAndCannotBeForged(t *testing.T) {
	state := countedNativeState(t)
	p := countedLiveProcess(t, state)
	if err := state.reserveEmpoweredAttackStart("not_a_native_attack", "target"); err == nil || p.EmpoweredAttackWindow().ConsumptionCount != 0 {
		t.Fatal("forged start consumed charge", err, p)
	}
	use, _, err := beginCountedNativeAttack(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.finishReservedEmpoweredMiss(use); err == nil {
		t.Fatal("uncompleted attack was guessed to miss")
	}
	state.actions.CompleteAttack()
	if err := state.finishReservedEmpoweredMiss(use); err != nil {
		t.Fatal(err)
	}
	if p.EmpoweredAttackWindow().ConsumptionCount != 1 || p.EmpoweredAttackWindow().PendingHitCount != 0 || p.EmpoweredAttackWindow().Consumptions[0].HitRef != nil || p.EmpoweredAttackWindow().Consumptions[0].ResolvedAtMs == nil || state.report.Totals().SourceDamageDealt != 0 {
		t.Fatal(p, state.report.Totals().SourceDamageDealt)
	}
	for _, at := range []int64{1000, 2000} {
		state.loop.Advance(at)
		if err := state.handleBasicAttack(); err != nil {
			t.Fatal(err)
		}
	}
	if p.Status() != "complete" || p.EmpoweredAttackWindow().ConsumptionCount != 3 || p.EmpoweredAttackWindow().PendingHitCount != 0 || state.report.Totals().SourceDamageDealt != 220 || state.skillUses[p.UseKey()].history.ContactCount() != 2 || !p.EmpoweredResolvedPublished() {
		t.Fatal(p, state.report.Totals().SourceDamageDealt)
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
		state.loop.Advance(at)
		if err := state.handleBasicAttack(); err != nil {
			t.Fatal(err)
		}
	}
	state.loop.Advance(2000)
	if _, _, err := beginCountedNativeAttack(state); err == nil {
		t.Fatal("invalid completion cooldown should fail final consumption")
	}
	p := countedLiveProcess(t, state)
	if p.Status() != "active" || p.CooldownStarted() || p.FinishedAtMs() != nil || p.EmpoweredAttackWindow().ConsumptionCount != 2 || p.EmpoweredAttackWindow().PendingHitCount != 0 || state.skillUses[state.actions.BasicAttack().Current().UseRef()].identity.EmpoweredReference().Present || state.report.Totals().SourceDamageDealt != 220 || state.report.Snapshot().Evidence.CountsByKind["empowered_attack_consumed"] != 2 {
		t.Fatal(p, state.report.Totals().SourceDamageDealt)
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
