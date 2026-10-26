package execution

import (
	json "encoding/json"
	os "os"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

func gfConst(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: floatPtr(v)}
}

func TestGenericRunSampleLastAtSameTimeMs(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatalf("newGenericRunState: %+v", runErr)
	}
	*state.loop.Queue() = scheduler.NewGenericHeap(4)
	state.enqueueAttempt(0, 0, 0)
	_ = state.loop.Queue().Push(scheduler.GenericEvent{
		TimeMs: 0, Category: scheduler.GenericCategorySample, Kind: scheduler.GenericEventSample,
	})
	ev1, _ := state.loop.Queue().Pop()
	ev2, _ := state.loop.Queue().Pop()
	if ev1.Category != scheduler.GenericCategoryAbilityAttempt {
		t.Fatalf("first=%d want ability_attempt", ev1.Category)
	}
	if ev2.Category != scheduler.GenericCategorySample {
		t.Fatalf("second=%d want sample", ev2.Category)
	}
}

func TestNormalizeConditionRecheckInterval(t *testing.T) {
	if got := normalizeConditionRecheckInterval(0); got != 100 {
		t.Fatalf("default=%d", got)
	}
	if got := normalizeConditionRecheckInterval(5); got != 10 {
		t.Fatalf("clamp low=%d", got)
	}
	if got := normalizeConditionRecheckInterval(2000); got != 1000 {
		t.Fatalf("clamp high=%d", got)
	}
}

func TestGenericRunHealClampsMax(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	healAmount := 200.0
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "heal",
			Target:    "target",
			Amount:    &model.GenericFormulaExpr{Op: "const", Value: &healAmount},
		},
	}
	fixture.RunRequest.InitialSnapshot.Combatants[1].Attributes["hp"] = model.AttributeSlotDef{
		Base: 950, Current: 950, Max: 1000, Resolved: 950,
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunShieldAbsorbsBeforeHP(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	shieldAmt := 50.0
	dmgAmt := 100.0
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "shield",
			Target:    "target",
			Amount:    &model.GenericFormulaExpr{Op: "const", Value: &shieldAmt},
		},
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &dmgAmt},
			DamageType: "damage/physical",
		},
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.TargetFinalHp != 950 {
		t.Fatalf("targetFinalHp=%v want 950", done.Summary.TargetFinalHp)
	}
}

func loadGateFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("generic_p0_resource_cooldown_gate.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.CompileRequest, fixture.RunRequest
}

func runGateFixture(t *testing.T) model.DoneResult {
	t.Helper()
	compileReq, runReq := loadGateFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	return state.buildDoneResult(false)
}

func TestGenericRunResourceCooldownGateFixture(t *testing.T) {
	done := runGateFixture(t)
	if done.Summary.AttemptSkippedCount < 1 {
		t.Fatalf("attemptSkippedCount=%d want >=1", done.Summary.AttemptSkippedCount)
	}
	found := false
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		found = true
		reason, _ := item.Data["skipReason"].(string)
		if reason != string(model.AttemptSkipCooldownNotReady) && reason != string(model.AttemptSkipResourceInsufficient) {
			t.Fatalf("skipReason=%q", reason)
		}
	}
	if !found {
		t.Fatal("missing attempt_skipped evidence")
	}
}

func TestGenericRunCooldownGateWhileReadyRetriesAtReadyTime(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.AbilityCastCount < 2 {
		t.Fatalf("abilityCastCount=%d want >=2", done.Summary.AbilityCastCount)
	}
	var cooldownSkipReady int64
	for _, item := range done.Evidence.Items {
		if item.TimeMs != 500 {
			continue
		}
		if item.Data["skipReason"] == string(model.AttemptSkipCooldownNotReady) {
			cooldownSkipReady = numericAsInt64(item.Data["readyAtMs"])
		}
	}
	if cooldownSkipReady != 1000 {
		t.Fatalf("cooldown skip readyAtMs=%d want 1000", cooldownSkipReady)
	}
}

func TestGenericRunResourceGateInsufficientWhileReady(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	runReq.InitialSnapshot.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 50, Max: 100}
	compileReq.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 50, Max: 100}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.AttemptSkippedCount < 1 {
		t.Fatalf("attemptSkippedCount=%d want >=1", done.Summary.AttemptSkippedCount)
	}
	found := false
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(model.AttemptSkipResourceInsufficient) {
			found = true
		}
	}
	if !found {
		t.Fatal("missing resource_insufficient evidence")
	}
	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("abilityCastCount=%d want 0 without regen", done.Summary.AbilityCastCount)
	}
}

func TestGenericRunConditionGateWhileReady(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	runReq.DriverPlan.Entries[0].Condition = &model.GenericFormulaExpr{
		Op: "read", Path: "source.resource.mana.current",
	}
	runReq.InitialSnapshot.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 0, Max: 100}
	compileReq.SharedProviders[0].Abilities[0].Cost = nil
	compileReq.SharedProviders[0].Abilities[0].Cooldown = nil
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.AttemptSkippedCount < 1 {
		t.Fatalf("attemptSkippedCount=%d want >=1", done.Summary.AttemptSkippedCount)
	}
	found := false
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(model.AttemptSkipConditionFalse) {
			found = true
		}
	}
	if !found {
		t.Fatal("missing condition_false evidence")
	}
}

func TestGenericRunGateFailureNoBusyLoop(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	runReq.InitialSnapshot.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 50, Max: 100}
	compileReq.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 50, Max: 100}
	runReq.DriverPlan.ConditionRecheckIntervalMs = 50
	runReq.StopPolicy.DurationMs = 200
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.AbilityAttemptCount > 10 {
		t.Fatalf("too many attempts=%d (busy loop?)", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityAttemptCount < 2 {
		t.Fatalf("attempts=%d want >=2 with recheck", done.Summary.AbilityAttemptCount)
	}
}

func TestGenericRunLifecycleAutoStagingCostAndCooldown(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	runReq.DriverPlan.Entries[0].Repeat = nil
	runReq.StopPolicy.DurationMs = 50
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	source := done.FinalSnapshot.Combatants[0]
	if source.Resources["mana"].Current != 140 {
		t.Fatalf("mana current=%v want 140", source.Resources["mana"].Current)
	}
	abilityRef := runReq.DriverPlan.Entries[0].AbilityRef
	cd, ok := source.Cooldowns[abilityRef].(map[string]interface{})
	if !ok {
		t.Fatalf("cooldown snapshot missing for %s: %+v", abilityRef, source.Cooldowns)
	}
	readyAt := numericAsInt64(cd["readyAtMs"])
	if readyAt != 1000 {
		t.Fatalf("cooldown readyAtMs=%d want 1000", readyAt)
	}
	remaining := numericAsInt64(cd["remainingMs"])
	wantRemaining := readyAt - done.FinalSnapshot.TimeMs
	if wantRemaining < 0 {
		wantRemaining = 0
	}
	if remaining != wantRemaining {
		t.Fatalf("cooldown remainingMs=%d want %d (readyAt=%d now=%d)", remaining, wantRemaining, readyAt, done.FinalSnapshot.TimeMs)
	}
}

func numericAsInt64(v interface{}) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	default:
		return 0
	}
}

func hasWarningCode(warnings []model.WarningItem, code string) *model.WarningItem {
	for i := range warnings {
		if warnings[i].Code == code {
			return &warnings[i]
		}
	}
	return nil
}

func hasEvidenceKind(items []model.EvidenceItem, kind model.EvidenceKind) *model.EvidenceItem {
	for i := range items {
		if items[i].Kind == kind {
			return &items[i]
		}
	}
	return nil
}

func loadGenericRunFixture(t *testing.T, name string) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(runtimeFixturePath(name))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.CompileRequest, fixture.RunRequest
}

func TestGenericRunEvidenceTruncatedWarningAndCountsByKind(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalMs: 10, MaxAttempts: 10}
	runReq.StopPolicy.DurationMs = 200
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	state.budget.MaxEvidenceItems = 2
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if !done.Summary.EvidenceTruncated {
		t.Fatal("expected evidenceTruncated=true")
	}
	w := hasWarningCode(done.Warnings, string(model.WarningCodeEvidenceTruncated))
	if w == nil {
		t.Fatal("missing evidence_truncated warning")
	}
	if w.Count != done.Evidence.TruncatedEvidenceCount {
		t.Fatalf("warning count=%d truncatedEvidenceCount=%d", w.Count, done.Evidence.TruncatedEvidenceCount)
	}
	if len(w.EvidenceRefs) == 0 {
		t.Fatal("evidence_truncated warning missing evidenceRefs")
	}
	for _, kind := range w.EvidenceRefs {
		if kind != string(model.EvidenceKindAttemptSkipped) {
			t.Fatalf("evidenceRefs kind=%q want only truncated attempt_skipped", kind)
		}
	}
	if len(w.Refs) > 0 {
		t.Fatalf("evidence_truncated should use evidenceRefs not refs: %+v", w.Refs)
	}
	totalSkipped := done.Evidence.CountsByKind[string(model.EvidenceKindAttemptSkipped)]
	if totalSkipped < 3 {
		t.Fatalf("countsByKind attempt_skipped=%d want >=3 including truncated", totalSkipped)
	}
	if totalSkipped != done.Summary.AttemptSkippedCount {
		t.Fatalf("countsByKind=%d attemptSkippedCount=%d", totalSkipped, done.Summary.AttemptSkippedCount)
	}
	if done.Summary.WarningCount < 1 {
		t.Fatalf("warningCount=%d want >=1", done.Summary.WarningCount)
	}
}

func TestGenericRunSeriesDownsampledWarning(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture.RunRequest.StopPolicy.DurationMs = 1000
	fixture.RunRequest.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	fixture.RunRequest.Sampling = model.SamplingConfig{
		SampleEveryMs:   10,
		DpsWindowMs:     1000,
		MaxSeriesPoints: 10,
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if !done.Summary.SeriesDownsampled {
		t.Fatal("expected seriesDownsampled=true")
	}
	w := hasWarningCode(done.Warnings, string(model.WarningCodeSeriesDownsampled))
	if w == nil {
		t.Fatal("missing series_downsampled warning")
	}
	if w.Count <= 0 {
		t.Fatalf("series_downsampled count=%d want >0", w.Count)
	}
	if len(done.Series) != 10 {
		t.Fatalf("series points=%d want 10", len(done.Series))
	}
	ev := hasEvidenceKind(done.Evidence.Items, model.EvidenceKindDownsampled)
	if ev == nil {
		t.Fatal("missing downsampled evidence")
	}
	if ev.Data["method"] != "uniform_time" {
		t.Fatalf("downsampled method=%v want uniform_time", ev.Data["method"])
	}
	if w.EvidenceRefs == nil || w.EvidenceRefs[0] != string(model.EvidenceKindDownsampled) {
		t.Fatalf("series_downsampled evidenceRefs=%v", w.EvidenceRefs)
	}
	if !done.SeriesSamplingEvidence.Downsampled {
		t.Fatal("seriesSamplingEvidence.downsampled=false")
	}
}

func TestGenericRunStopReasonBudgetOverDuration(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture.RunRequest.StopPolicy.DurationMs = 0
	fixture.RunRequest.Sampling.SampleEveryMs = 0
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	state.budget.MaxEvents = 1 // One actual combat event; sampling does not spend event budget.
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.StopReason != model.StopReasonBudgetExceeded {
		t.Fatalf("stopReason=%q want budget_exceeded", done.Summary.StopReason)
	}
	w := hasWarningCode(done.Warnings, string(model.WarningCodeBudgetExceeded))
	if w == nil {
		t.Fatal("missing budget_exceeded warning")
	}
	ev := hasEvidenceKind(done.Evidence.Items, model.EvidenceKindBudgetExceeded)
	if ev == nil {
		t.Fatal("missing budget_exceeded evidence")
	}
	if w.EvidenceRefs == nil || w.EvidenceRefs[0] != string(model.EvidenceKindBudgetExceeded) {
		t.Fatalf("budget_exceeded evidenceRefs=%v", w.EvidenceRefs)
	}
}

func TestGenericRunBudgetExceedsBothDeadPriority(t *testing.T) {
	compileReq, runReq := loadGenericRunFixture(t, "generic_p0_both_dead_stop_priority.json")
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	state.budget.MaxEvents = 1
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.StopReason != model.StopReasonBudgetExceeded {
		t.Fatalf("stopReason=%q want budget_exceeded", done.Summary.StopReason)
	}
	w := hasWarningCode(done.Warnings, string(model.WarningCodeBudgetExceeded))
	if w == nil {
		t.Fatal("missing budget_exceeded warning")
	}
	if hasEvidenceKind(done.Evidence.Items, model.EvidenceKindBudgetExceeded) == nil {
		t.Fatal("missing budget_exceeded evidence")
	}
}

func TestGenericRunBothDeadStopReason(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	killTarget := 1000.0
	killSource := 100.0
	fixture.CompileRequest.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	}
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &killTarget},
			DamageType: "damage/physical",
		},
		{
			Operation:  "damage",
			Target:     "source",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &killSource},
			DamageType: "damage/physical",
		},
	}
	fixture.RunRequest.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	}
	fixture.RunRequest.StopPolicy.StopOnTargetDeath = model.BoolPtr(true)
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.StopReason != model.StopReasonBothDead {
		t.Fatalf("stopReason=%q want both_dead", done.Summary.StopReason)
	}
	if done.Summary.SourceFinalHp > 0 || done.Summary.TargetFinalHp > 0 {
		t.Fatalf("expected both dead sourceHp=%v targetHp=%v", done.Summary.SourceFinalHp, done.Summary.TargetFinalHp)
	}
}

func TestGenericRunFinalSnapshotCooldowns(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	runReq.DriverPlan.Entries[0].Repeat = nil
	runReq.StopPolicy.DurationMs = 50
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	source := done.FinalSnapshot.Combatants[0]
	abilityRef := runReq.DriverPlan.Entries[0].AbilityRef
	cd, ok := source.Cooldowns[abilityRef].(map[string]interface{})
	if !ok {
		t.Fatalf("cooldown snapshot missing for %s: %+v", abilityRef, source.Cooldowns)
	}
	if numericAsInt64(cd["readyAtMs"]) != 1000 {
		t.Fatalf("readyAtMs=%v want 1000", cd["readyAtMs"])
	}
}

func loadTempProviderAttrShieldFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(runtimeFixturePath("generic_p0_temp_provider_attr_shield.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.CompileRequest, fixture.RunRequest
}

func TestExpireCleanupBeforeAbilityAttemptSameTimeMs(t *testing.T) {
	compileReq, runReq := loadTempProviderAttrShieldFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	runReq.StopPolicy.DurationMs = 500
	runReq.DriverPlan.Entries = runReq.DriverPlan.Entries[:1]
	runReq.DriverPlan.Entries[0].FirstAtMs = 500

	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	*state.loop.Queue() = scheduler.NewGenericHeap(8)
	state.enqueueAttempt(500, 0, 0)
	state.enqueueExpireCleanup(500, effectpkg.ExpiryPayload{
		CombatantKey: model.SelectorTarget,
		ProviderRef:  "status:attack_buff#1",
		Kind:         "provider",
	})
	ev1, _ := state.loop.Queue().Pop()
	ev2, _ := state.loop.Queue().Pop()
	if ev1.Category != scheduler.GenericCategoryExpireCleanup {
		t.Fatalf("first category=%d want expire_cleanup", ev1.Category)
	}
	if ev2.Category != scheduler.GenericCategoryAbilityAttempt {
		t.Fatalf("second category=%d want ability_attempt", ev2.Category)
	}
	if ev1.Kind != scheduler.GenericEventExpireCleanup {
		t.Fatalf("expire_cleanup kind=%d want GenericEventExpireCleanup", ev1.Kind)
	}
}

func loadFixedTickProviderFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(runtimeFixturePath("generic_p0_fixed_tick_provider.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.CompileRequest, fixture.RunRequest
}

func TestExpireCleanupUsesDedicatedKind(t *testing.T) {
	compileReq, runReq := loadTempProviderAttrShieldFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	*state.loop.Queue() = scheduler.NewGenericHeap(4)
	state.enqueueExpireCleanup(100, effectpkg.ExpiryPayload{
		CombatantKey: model.SelectorTarget,
		ProviderRef:  "status:attack_buff#1",
		Kind:         "provider",
	})
	ev, _ := state.loop.Queue().Pop()
	if ev.Kind != scheduler.GenericEventExpireCleanup {
		t.Fatalf("kind=%d want GenericEventExpireCleanup", ev.Kind)
	}
	if ev.Kind == scheduler.GenericEventSample {
		t.Fatal("expire_cleanup must not reuse sample kind")
	}
}

func floatPtr(v float64) *float64 {
	return &v
}

func TestGenericRunStopPolicyOmittedDefaultsStopWhenNoEvents(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture.RunRequest.StopPolicy = model.StopPolicy{DurationMs: 5000}
	fixture.RunRequest.DriverPlan.Entries = nil
	fixture.RunRequest.Sampling = model.SamplingConfig{SampleEveryMs: 10000, DpsWindowMs: 1000, MaxSeriesPoints: 5000}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.StopReason != model.StopReasonNoEvents {
		t.Fatalf("stopReason=%q want no_events", done.Summary.StopReason)
	}
}

func TestGenericRunSafetyBudgetMaxEventsCannotExceedCompileCap(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture.CompileRequest.Settings.MaxEvents = 10
	fixture.RunRequest.SafetyBudget = &model.RunSafetyBudget{MaxEvents: 100}
	fixture.RunRequest.StopPolicy.DurationMs = 50
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if state.budget.MaxEvents != 10 {
		t.Fatalf("maxEvents=%d want compile cap 10", state.budget.MaxEvents)
	}
}

func TestGenericRunCooldownChangeReduceAndReset(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	fireballRef := runReq.DriverPlan.Entries[0].AbilityRef
	reduceAmt := 400.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities,
		model.AbilityDefinition{
			AbilityKey: "cd_reduce",
			Kind:       "active",
			Operations: []model.OperationDefinition{
				{
					Operation:   "cooldown_change",
					Target:      "source",
					AbilityRef:  fireballRef,
					ValuePolicy: "reduce",
					Amount:      &model.GenericFormulaExpr{Op: "const", Value: &reduceAmt},
				},
			},
		},
		model.AbilityDefinition{
			AbilityKey: "cd_reset",
			Kind:       "active",
			Operations: []model.OperationDefinition{
				{
					Operation:   "cooldown_change",
					Target:      "source",
					AbilityRef:  fireballRef,
					ValuePolicy: "reset",
				},
			},
		},
	)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{
			EntryKey:   "fireball_once",
			AbilityRef: fireballRef,
			Source:     "source",
			Target:     "target",
			FirstAtMs:  0,
		},
		{
			EntryKey:   "reduce_cd",
			AbilityRef: "source.provider[champion:source_demo].ability[cd_reduce]",
			Source:     "source",
			Target:     "target",
			FirstAtMs:  100,
		},
		{
			EntryKey:   "reset_cd",
			AbilityRef: "source.provider[champion:source_demo].ability[cd_reset]",
			Source:     "source",
			Target:     "target",
			FirstAtMs:  200,
		},
	}
	runReq.StopPolicy.DurationMs = 300
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	source := state.combatants[model.SelectorSource]
	if readyAt := source.cooldowns.AbilityReadyAt("source", fireballRef); readyAt != state.loop.TimeMs() {
		t.Fatalf("after reset readyAt=%d want nowMs=%d", readyAt, state.loop.TimeMs())
	}
	// Re-run only through reduce to verify intermediate state.
	compileReq2, runReq2 := loadGateFixture(t)
	compileReq2.SharedProviders[0].Abilities = append(compileReq2.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "cd_reduce",
		Kind:       "active",
		Operations: []model.OperationDefinition{
			{
				Operation:   "cooldown_change",
				Target:      "source",
				AbilityRef:  fireballRef,
				ValuePolicy: "reduce",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &reduceAmt},
			},
		},
	})
	runReq2.DriverPlan.Entries = []model.DriverEntry{
		{
			EntryKey: fireballRef, AbilityRef: fireballRef,
			Source: "source", Target: "target", FirstAtMs: 0,
		},
		{
			EntryKey:   "reduce_cd",
			AbilityRef: "source.provider[champion:source_demo].ability[cd_reduce]",
			Source:     "source", Target: "target", FirstAtMs: 100,
		},
	}
	runReq2.StopPolicy.DurationMs = 150
	result2 := compile.CompileGeneric(compileReq2)
	if !result2.OK {
		t.Fatal("compile failed")
	}
	state2, runErr := newGenericRunState(result2.Session, runReq2)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state2.runLoop(); err != nil {
		t.Fatal(err)
	}
	source2 := state2.combatants[model.SelectorSource]
	if readyAt := source2.cooldowns.AbilityReadyAt("source", fireballRef); readyAt != 600 {
		t.Fatalf("after reduce readyAt=%d want 600 (1000-400)", readyAt)
	}
}

func TestGenericRunHealOverhealReported(t *testing.T) {
	fixtureRaw, err := os.ReadFile(runtimeFixturePath("formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	healAmount := 200.0
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "heal",
			Target:    "target",
			Amount:    &model.GenericFormulaExpr{Op: "const", Value: &healAmount},
		},
	}
	fixture.RunRequest.InitialSnapshot.Combatants[1].Attributes["hp"] = model.AttributeSlotDef{
		Base: 950, Current: 950, Max: 1000, Resolved: 950,
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000", done.Summary.TargetFinalHp)
	}
	if done.Summary.SourceOverheal != 150 {
		t.Fatalf("sourceOverheal=%v want 150", done.Summary.SourceOverheal)
	}
}

func TestStaleProviderExpireCleanupSkippedAfterExtend(t *testing.T) {
	compileReq, runReq := loadTempProviderAttrShieldFixture(t)
	compileReq.SharedProviders[1].Lifecycle.RefreshPolicy = "extend"
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if err := state.applyProviderInstance(model.SelectorTarget, model.SelectorSource, "status:attack_buff", 500, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	providerRef := state.combatants[model.SelectorTarget].instances.Providers().At(0).ProviderRef
	state.loop.Advance(200)
	if err := state.refreshProviderInstance(model.SelectorTarget, providerRef, 700, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	inst := state.combatants[model.SelectorTarget].instances.Providers().At(0)
	if inst.ExpireAt <= 500 {
		t.Fatalf("extended expireAt=%d want > 500", inst.ExpireAt)
	}
	replaceEffectTimePayloadsForTest(state, []effectpkg.ExpiryPayload{{
		CombatantKey: model.SelectorTarget,
		ProviderRef:  providerRef,
		Kind:         "provider",
	}}, anchoredPayloadsForTest(state), true)
	state.loop.Advance(500)
	state.handleExpireCleanup(scheduler.GenericEvent{
		TimeMs:           500,
		Category:         scheduler.GenericCategoryExpireCleanup,
		Kind:             scheduler.GenericEventExpireCleanup,
		DriverEntryIndex: 0,
	})
	if state.combatants[model.SelectorTarget].instances.Providers().Len() != 1 {
		t.Fatalf("provider removed by stale cleanup, providers=%+v", state.combatants[model.SelectorTarget].instances.Providers())
	}
}
