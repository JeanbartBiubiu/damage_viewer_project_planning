package runtime

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	gort "runtime"
	"testing"

	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func compileBasicDamageSession(t *testing.T) (*Session, model.CompileResult) {
	t.Helper()
	session := NewSession()
	compiled := compileGenericSession(t, session)
	return session, compiled
}

func loadBasicDamageRunRequest(t *testing.T) model.RunRequest {
	t.Helper()
	_, file, _, ok := gort.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "testkit", "fixtures", "generic_p0_basic_damage.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		RunRequest model.RunRequest `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture.RunRequest
}

func compileAndRunBasicDamage(t *testing.T) (model.DoneResult, model.CompileResult) {
	t.Helper()
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != 0 {
		t.Fatalf("RunJSON code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	done := lastGenericRunDone(session.OutboxBytes())
	return done, compiled
}

func TestGenericRunBasicDamageReturnsDone(t *testing.T) {
	done, _ := compileAndRunBasicDamage(t)
	if !done.OK {
		t.Fatalf("done.ok=false")
	}
	if done.Summary.StopReason != model.StopReasonDurationReached {
		t.Fatalf("stopReason=%q want duration_reached", done.Summary.StopReason)
	}
	if done.Summary.TargetFinalHp != 900 {
		t.Fatalf("targetFinalHp=%v want 900", done.Summary.TargetFinalHp)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("abilityAttemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 0 {
		t.Fatalf("attemptSkippedCount=%d want 0", done.Summary.AttemptSkippedCount)
	}
	if done.Summary.SourceDamageDealt != 100 {
		t.Fatalf("sourceDamageDealt=%v want 100", done.Summary.SourceDamageDealt)
	}
	if done.Summary.TargetDamageTaken != 100 {
		t.Fatalf("targetDamageTaken=%v want 100", done.Summary.TargetDamageTaken)
	}
	if len(done.Series) < 2 {
		t.Fatalf("series points=%d want >=2", len(done.Series))
	}
	lastSeries := done.Series[len(done.Series)-1]
	if lastSeries.TimeMs != 100 {
		t.Fatalf("last series timeMs=%d want 100", lastSeries.TimeMs)
	}
	if lastSeries.TargetHp != 900 {
		t.Fatalf("last series targetHp=%v want 900", lastSeries.TargetHp)
	}
}

func TestGenericRunInitialSnapshotHashMismatch(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.InitialSnapshot.SchemaHash = "schema.wrong"

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON code=%d want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrHashMismatch {
		t.Fatalf("code=%q want hash_mismatch", errPayload.Code)
	}

	runReq.InitialSnapshot.SchemaHash = compiled.SchemaHash
	runReq.InitialSnapshot.RulesHash = "rules.wrong"
	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON rules hash code=%d want -1", code)
	}
	errPayload = lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrHashMismatch {
		t.Fatalf("code=%q want hash_mismatch for rulesHash", errPayload.Code)
	}
}

func TestGenericRunInvalidAbilityRefEvidence(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.DriverPlan.Entries[0].AbilityRef = "source.provider[champion:missing].ability[none]"
	runReq.StopPolicy.DurationMs = 500
	runReq.StopPolicy.StopWhenNoEvents = model.BoolPtr(true)

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != 0 {
		t.Fatalf("RunJSON code=%d", code)
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if done.Summary.AttemptSkippedCount < 1 {
		t.Fatalf("attemptSkippedCount=%d want >=1", done.Summary.AttemptSkippedCount)
	}
	found := false
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped {
			found = true
			if item.Data["skipReason"] != string(model.AttemptSkipUnknownAbilityRef) {
				t.Fatalf("skipReason=%v", item.Data["skipReason"])
			}
		}
	}
	if !found {
		t.Fatal("missing attempt_skipped evidence")
	}
}

func TestGenericRunInvalidSelectorNoBusyLoop(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.DriverPlan.Entries[0].Target = "hero"
	runReq.DriverPlan.Entries[0].WhileReady = true
	runReq.DriverPlan.ConditionRecheckIntervalMs = 50
	runReq.StopPolicy.DurationMs = 200

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != 0 {
		t.Fatalf("RunJSON code=%d", code)
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if done.Summary.AbilityAttemptCount > 10 {
		t.Fatalf("too many attempts=%d (busy loop?)", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityAttemptCount < 2 {
		t.Fatalf("attempts=%d want >=2 with recheck", done.Summary.AbilityAttemptCount)
	}
}

func TestGenericRunRepeatMaxAttempts(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalMs: 100, MaxAttempts: 3}
	runReq.StopPolicy.DurationMs = 1000

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != 0 {
		t.Fatalf("RunJSON code=%d", code)
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
}

func gfConst(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: floatPtr(v)}
}

func intervalFormulaConst(ms float64) *model.GenericFormulaExpr {
	e := gfConst(ms)
	return &e
}

func emittedEventTimes(done model.DoneResult, ref string) []int64 {
	var times []int64
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent {
			continue
		}
		if ref != "" && item.Ref != ref {
			continue
		}
		times = append(times, item.TimeMs)
	}
	return times
}

func attachEmitProbe(compileReq *model.CompileRequest, eventRef string) {
	ops := compileReq.SharedProviders[0].Abilities[0].Operations
	compileReq.SharedProviders[0].Abilities[0].Operations = append(append([]model.OperationDefinition{}, ops...), model.OperationDefinition{
		Operation: "emit_event",
		Target:    "target",
		Ref:       eventRef,
	})
}

// TestGenericRunFixedDriverRepeatCadenceUnchanged 锁定 IntervalMs=100 / MaxAttempts=3 的旧固定排程行为。
func TestGenericRunFixedDriverRepeatCadenceUnchanged(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	attachEmitProbe(&compileReq, "event:fixed_hit")
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalMs: 100, MaxAttempts: 3}
	runReq.StopPolicy.DurationMs = 1000
	runReq.Sampling.SampleEveryMs = 1000

	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.AbilityAttemptCount != 3 || done.Summary.AbilityCastCount != 3 {
		t.Fatalf("attempt/cast=%d/%d want 3/3", done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount)
	}
	times := emittedEventTimes(done, "event:fixed_hit")
	want := []int64{0, 100, 200}
	if len(times) != len(want) {
		t.Fatalf("cast times=%v want %v", times, want)
	}
	for i := range want {
		if times[i] != want[i] {
			t.Fatalf("cast times=%v want %v", times, want)
		}
	}
}

func TestGenericRunDriverRepeatIntervalMsAndFormulaMutuallyExclusive(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{
		IntervalMs:      100,
		IntervalFormula: intervalFormulaConst(100),
		MaxAttempts:     2,
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, runReq)
	if err == nil {
		t.Fatal("expected structured error when both intervalMs and intervalFormula set")
	}
	if err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want formula_type_error", err.Code)
	}
}

func TestGenericRunDriverRepeatRequiresIntervalMsOrFormula(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{MaxAttempts: 2}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, runReq)
	if err == nil {
		t.Fatal("expected structured error when neither intervalMs nor intervalFormula set")
	}
	if err.Code != model.GenericErrMissingRequiredField {
		t.Fatalf("code=%q want missing_required_field", err.Code)
	}
}

func TestGenericRunDriverRepeatIllegalIntervalFormula(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	bad := model.GenericFormulaExpr{Op: "not_a_real_op", Value: floatPtr(1)}
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalFormula: &bad, MaxAttempts: 2}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, runReq)
	if err == nil {
		t.Fatal("expected structured error for illegal intervalFormula")
	}
	if err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want formula_type_error", err.Code)
	}
}

func TestGenericRunDriverRepeatUnevaluableIntervalFormula(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	// attack_speed missing => resolved read 0 => division by zero at schedule time.
	formula := model.GenericFormulaExpr{
		Op: "div",
		Args: []model.GenericFormulaExpr{
			gfConst(1000),
			{Op: "read", Path: "source.attr.attack_speed.resolved"},
		},
	}
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalFormula: &formula, MaxAttempts: 2}
	runReq.StopPolicy.DurationMs = 500
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, runReq)
	if err == nil {
		t.Fatal("expected structured error for unevaluable intervalFormula")
	}
	if err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want formula_type_error", err.Code)
	}
}

func TestGenericRunDriverRepeatNonPositiveIntervalFormula(t *testing.T) {
	cases := []struct {
		name  string
		value float64
	}{
		{name: "zero", value: 0},
		{name: "negative", value: -10},
		{name: "nan", value: math.NaN()},
		{name: "inf", value: math.Inf(1)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadBasicFixture(t)
			runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{
				IntervalFormula: intervalFormulaConst(tc.value),
				MaxAttempts:     2,
			}
			runReq.StopPolicy.DurationMs = 500
			result := compile.CompileGeneric(compileReq)
			if !result.OK {
				t.Fatalf("compile failed: %+v", result.Result.Errors)
			}
			_, err := RunGeneric(result.Session, runReq)
			if err == nil {
				t.Fatal("expected structured error")
			}
			if err.Code != model.GenericErrFormulaTypeError {
				t.Fatalf("code=%q want formula_type_error", err.Code)
			}
		})
	}
}

func TestGenericRunDriverRepeatSubHalfMsRoundsToOne(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	attachEmitProbe(&compileReq, "event:sub_half")
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{
		IntervalFormula: intervalFormulaConst(0.4), // round→0 → clamp min 1ms
		MaxAttempts:     2,
	}
	runReq.StopPolicy.DurationMs = 100
	runReq.Sampling.SampleEveryMs = 1000
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	times := emittedEventTimes(done, "event:sub_half")
	if len(times) != 2 || times[0] != 0 || times[1] != 1 {
		t.Fatalf("cast times=%v want [0 1]", times)
	}
}

func TestGenericRunDynamicDriverRepeatSchedulesUniqueNext(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	attachEmitProbe(&compileReq, "event:dyn_unique")
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{
		IntervalFormula: intervalFormulaConst(100),
		MaxAttempts:     5,
	}
	runReq.StopPolicy.DurationMs = 1000
	runReq.Sampling.SampleEveryMs = 1000
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.AbilityAttemptCount != 5 || done.Summary.AbilityCastCount != 5 {
		t.Fatalf("attempt/cast=%d/%d want 5/5 (no double schedule)", done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount)
	}
	times := emittedEventTimes(done, "event:dyn_unique")
	want := []int64{0, 100, 200, 300, 400}
	if len(times) != len(want) {
		t.Fatalf("times=%v want %v", times, want)
	}
	for i := range want {
		if times[i] != want[i] {
			t.Fatalf("times=%v want %v", times, want)
		}
	}
}

func TestGenericRunDynamicDriverRepeatHonorsMaxAttemptsAndDuration(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	attachEmitProbe(&compileReq, "event:dyn_budget")
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{
		IntervalFormula: intervalFormulaConst(100),
		MaxAttempts:     0, // unlimited by attempts; duration clips
	}
	runReq.StopPolicy.DurationMs = 250
	runReq.Sampling.SampleEveryMs = 1000
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	times := emittedEventTimes(done, "event:dyn_budget")
	want := []int64{0, 100, 200}
	if len(times) != len(want) {
		t.Fatalf("times=%v want %v (duration clip)", times, want)
	}
	for i := range want {
		if times[i] != want[i] {
			t.Fatalf("times=%v want %v", times, want)
		}
	}

	// MaxAttempts clip with room in duration.
	compileReq2, runReq2 := loadBasicFixture(t)
	attachEmitProbe(&compileReq2, "event:dyn_max")
	runReq2.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{
		IntervalFormula: intervalFormulaConst(100),
		MaxAttempts:     3,
	}
	runReq2.StopPolicy.DurationMs = 5000
	runReq2.Sampling.SampleEveryMs = 1000
	result2 := compile.CompileGeneric(compileReq2)
	if !result2.OK {
		t.Fatalf("compile failed: %+v", result2.Result.Errors)
	}
	done2, err := RunGeneric(result2.Session, runReq2)
	if err != nil {
		t.Fatal(err)
	}
	if done2.Summary.AbilityAttemptCount != 3 || done2.Summary.AbilityCastCount != 3 {
		t.Fatalf("attempt/cast=%d/%d want 3/3", done2.Summary.AbilityAttemptCount, done2.Summary.AbilityCastCount)
	}
}

func TestGenericRunDynamicDriverRepeatContinuesAfterOrdinaryGateSkip(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	zero := 0.0
	runReq.DriverPlan.Entries[0].Condition = &model.GenericFormulaExpr{Op: "const", Value: &zero}
	runReq.DriverPlan.Entries[0].WhileReady = false
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{
		IntervalFormula: intervalFormulaConst(100),
		MaxAttempts:     3,
	}
	runReq.StopPolicy.DurationMs = 1000
	runReq.Sampling.SampleEveryMs = 1000
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3 (dynamic continues after skip)", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("abilityCastCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 3 {
		t.Fatalf("attemptSkippedCount=%d want 3", done.Summary.AttemptSkippedCount)
	}
	skipTimes := make([]int64, 0, 3)
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped {
			skipTimes = append(skipTimes, item.TimeMs)
		}
	}
	want := []int64{0, 100, 200}
	if len(skipTimes) != len(want) {
		t.Fatalf("skip times=%v want %v", skipTimes, want)
	}
	for i := range want {
		if skipTimes[i] != want[i] {
			t.Fatalf("skip times=%v want %v", skipTimes, want)
		}
	}
}

func TestGenericRunDynamicDriverRepeatWhileReadyDoesNotDoubleSchedule(t *testing.T) {
	compileReq, runReq := loadGateFixture(t)
	// t=0 cast → dynamic schedules t=50; t=50 cooldown skip must be owned solely by whileReady
	// (readyAt=1000), not also by intervalFormula(+50) which would flood 100/150/200...
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{
		IntervalFormula: intervalFormulaConst(50),
		MaxAttempts:     20,
	}
	runReq.StopPolicy.DurationMs = 400
	runReq.Sampling.SampleEveryMs = 1000
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.AbilityAttemptCount != 2 {
		t.Fatalf("abilityAttemptCount=%d want 2 (cast@0 + skip@50; no dynamic flood)", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	foundSkip50 := false
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped && item.TimeMs == 50 {
			foundSkip50 = true
			if numericAsInt64(item.Data["readyAtMs"]) != 1000 {
				t.Fatalf("readyAtMs=%v want 1000", item.Data["readyAtMs"])
			}
		}
		if item.Kind == model.EvidenceKindAttemptSkipped && (item.TimeMs == 100 || item.TimeMs == 150 || item.TimeMs == 200) {
			t.Fatalf("skip at %dms indicates whileReady+dynamic double schedule", item.TimeMs)
		}
	}
	if !foundSkip50 {
		t.Fatal("missing cooldown skip at t=50")
	}
}

func TestGenericRunSampleLastAtSameTimeMs(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	state.heap = scheduler.NewGenericHeap(4)
	state.enqueueAttempt(0, 0, 0)
	_ = state.heap.Push(scheduler.GenericEvent{
		TimeMs: 0, Category: scheduler.GenericCategorySample, Kind: scheduler.GenericEventSample,
	})
	ev1, _ := state.heap.Pop()
	ev2, _ := state.heap.Pop()
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

func TestGenericRunDivByZeroFatalNoDone(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	// 重新编译带 div-by-zero amount 的 session
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	a, b := 1.0, 0.0
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations[0].Amount = &model.GenericFormulaExpr{
		Op: "div",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &a},
			{Op: "const", Value: &b},
		},
	}
	session.ClearOutbox()
	if code := session.CompileJSON(mustJSON(fixture.CompileRequest)); code != 0 {
		t.Fatalf("compile code=%d", code)
	}
	compiled = lastGenericCompileResult(session.OutboxBytes())
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON code=%d want -1", code)
	}
	if lastGenericRunDone(session.OutboxBytes()).OK {
		t.Fatal("expected no done frame on fatal")
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want formula_type_error", errPayload.Code)
	}
}

func TestGenericRunHealClampsMax(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	done := state.buildDoneResult()
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunShieldAbsorbsBeforeHP(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	done := state.buildDoneResult()
	if done.Summary.TargetFinalHp != 950 {
		t.Fatalf("targetFinalHp=%v want 950", done.Summary.TargetFinalHp)
	}
}

func loadGateFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_resource_cooldown_gate.json"))
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
	return state.buildDoneResult()
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
	done := state.buildDoneResult()
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
	done := state.buildDoneResult()
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
	done := state.buildDoneResult()
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
	done := state.buildDoneResult()
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
	done := state.buildDoneResult()
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
	raw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", name))
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

func runGenericFixture(t *testing.T, fixtureName string) model.DoneResult {
	t.Helper()
	compileReq, runReq := loadGenericRunFixture(t, fixtureName)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("run error: %+v", err)
	}
	if !done.OK {
		t.Fatal("done.ok=false")
	}
	return done
}

func countOutboxFrameKinds(outbox []byte) map[model.FrameKind]int {
	counts := map[model.FrameKind]int{}
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		counts[frame.Kind]++
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return counts
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
	done := state.buildDoneResult()
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
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	done := state.buildDoneResult()
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
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	state.budget.MaxEvents = 2
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult()
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

func TestGenericRunBothDeadStopPriorityFixture(t *testing.T) {
	done := runGenericFixture(t, "generic_p0_both_dead_stop_priority.json")
	if done.Summary.StopReason != model.StopReasonBothDead {
		t.Fatalf("stopReason=%q want both_dead", done.Summary.StopReason)
	}
	if done.Summary.SourceFinalHp > 0 || done.Summary.TargetFinalHp > 0 {
		t.Fatalf("expected both dead sourceHp=%v targetHp=%v", done.Summary.SourceFinalHp, done.Summary.TargetFinalHp)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
}

func TestGenericRunSeriesDownsampleFixture(t *testing.T) {
	done := runGenericFixture(t, "generic_p0_series_downsample.json")
	if !done.Summary.SeriesDownsampled {
		t.Fatal("expected seriesDownsampled=true")
	}
	if !done.SeriesSamplingEvidence.Downsampled {
		t.Fatal("expected seriesSamplingEvidence.downsampled=true")
	}
	if done.SeriesSamplingEvidence.FinalPointCount > done.SeriesSamplingEvidence.MaxSeriesPoints {
		t.Fatalf("finalPointCount=%d > maxSeriesPoints=%d",
			done.SeriesSamplingEvidence.FinalPointCount, done.SeriesSamplingEvidence.MaxSeriesPoints)
	}
	w := hasWarningCode(done.Warnings, string(model.WarningCodeSeriesDownsampled))
	if w == nil {
		t.Fatal("missing series_downsampled warning")
	}
	ev := hasEvidenceKind(done.Evidence.Items, model.EvidenceKindDownsampled)
	if ev == nil {
		t.Fatal("missing downsampled evidence")
	}
	if w.EvidenceRefs == nil || w.EvidenceRefs[0] != string(model.EvidenceKindDownsampled) {
		t.Fatalf("series_downsampled evidenceRefs=%v", w.EvidenceRefs)
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
	done := state.buildDoneResult()
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
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	done := state.buildDoneResult()
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
	done := state.buildDoneResult()
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

func TestGenericRunFatalOutboxOnlyErrorFrame(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
	}
	if err := json.Unmarshal(fixtureRaw, &fixture); err != nil {
		t.Fatal(err)
	}
	a, b := 1.0, 0.0
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations[0].Amount = &model.GenericFormulaExpr{
		Op: "div",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &a},
			{Op: "const", Value: &b},
		},
	}
	session.ClearOutbox()
	if code := session.CompileJSON(mustJSON(fixture.CompileRequest)); code != 0 {
		t.Fatalf("compile code=%d", code)
	}
	compiled = lastGenericCompileResult(session.OutboxBytes())
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON code=%d want -1", code)
	}
	counts := countOutboxFrameKinds(session.OutboxBytes())
	if counts[model.FrameKindGenericDone] != 0 {
		t.Fatalf("generic done frames=%d want 0", counts[model.FrameKindGenericDone])
	}
	if counts[model.FrameKindGenericError] != 1 {
		t.Fatalf("generic error frames=%d want 1", counts[model.FrameKindGenericError])
	}
}

func loadTempProviderAttrShieldFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_temp_provider_attr_shield.json"))
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

func TestGenericRunTempProviderAttrShield(t *testing.T) {
	compileReq, runReq := loadTempProviderAttrShieldFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	provider := result.Session.Providers[1]
	if len(provider.Modifiers) != 1 || provider.Lifecycle == nil || !provider.Lifecycle.HasDuration {
		t.Fatalf("compiled provider: modifiers=%d lifecycle=%+v", len(provider.Modifiers), provider.Lifecycle)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("run error: %+v", err)
	}
	if !done.OK {
		t.Fatal("done.ok=false")
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000", done.Summary.TargetFinalHp)
	}
	if done.Summary.AbilityCastCount != 4 {
		t.Fatalf("abilityCastCount=%d want 4", done.Summary.AbilityCastCount)
	}
	var targetSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorTarget {
			targetSnap = c
			break
		}
	}
	if len(targetSnap.Providers) != 0 {
		t.Fatalf("expected provider expired, got %+v", targetSnap.Providers)
	}
	if targetSnap.Attributes["attack_damage"].Resolved != 50 {
		t.Fatalf("attack_damage resolved=%v want 50 after expire", targetSnap.Attributes["attack_damage"].Resolved)
	}
	if len(targetSnap.Shields) != 0 {
		t.Fatalf("expected shields depleted, got %+v", targetSnap.Shields)
	}
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
	state.heap = scheduler.NewGenericHeap(8)
	state.enqueueAttempt(500, 0, 0)
	state.enqueueExpireCleanup(500, expireCleanupPayload{
		combatantKey: model.SelectorTarget,
		providerRef:  "status:attack_buff#1",
		kind:         "provider",
	})
	ev1, _ := state.heap.Pop()
	ev2, _ := state.heap.Pop()
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
	raw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_fixed_tick_provider.json"))
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

func TestGenericRunFixedTickProvider(t *testing.T) {
	compileReq, runReq := loadFixedTickProviderFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	dotProvider := result.Session.Providers[1]
	if dotProvider.Lifecycle == nil || dotProvider.Lifecycle.TickIntervalMs != 200 {
		t.Fatalf("lifecycle tickIntervalMs=%v", dotProvider.Lifecycle)
	}
	tickAbility := result.Session.Abilities[1]
	if tickAbility.Kind != "tick" || tickAbility.TickSpec == nil || tickAbility.TickSpec.OnTickCount != 1 {
		t.Fatalf("tick ability=%+v tickSpec=%+v", tickAbility, tickAbility.TickSpec)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("run error: %+v", err)
	}
	if !done.OK {
		t.Fatal("done.ok=false")
	}
	if done.Summary.TargetFinalHp != 950 {
		t.Fatalf("targetFinalHp=%v want 950 (5 ticks * 10 damage)", done.Summary.TargetFinalHp)
	}
	tickCount := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]
	if tickCount != 5 {
		t.Fatalf("provider_tick evidence count=%d want 5", tickCount)
	}
	var targetSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorTarget {
			targetSnap = c
			break
		}
	}
	if len(targetSnap.Providers) != 0 {
		t.Fatalf("expected provider expired, got %+v", targetSnap.Providers)
	}
}

func TestProviderTickStopsAfterExpire(t *testing.T) {
	compileReq, runReq := loadFixedTickProviderFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	runReq.StopPolicy.DurationMs = 500
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// provider expires at 1100 but run ends at 500; ticks at 200/400 only
	if done.Summary.TargetFinalHp != 980 {
		t.Fatalf("targetFinalHp=%v want 980 (2 ticks before run ends)", done.Summary.TargetFinalHp)
	}
	tickCount := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]
	if tickCount != 2 {
		t.Fatalf("provider_tick count=%d want 2", tickCount)
	}
}

func TestProviderTickDroppedWhenExpireSameTimeMs(t *testing.T) {
	compileReq, runReq := loadFixedTickProviderFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("compile failed")
	}
	// shorten provider duration so expire aligns with a would-be tick
	compileReq.SharedProviders[1].Lifecycle.DurationMs = &model.GenericFormulaExpr{Op: "const", Value: floatPtr(400)}
	result = compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatal("recompile failed")
	}
	runReq.StopPolicy.DurationMs = 500
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// ticks at 200 only; tick at 400 same time as expire -> expire first, tick dropped
	if done.Summary.TargetFinalHp != 990 {
		t.Fatalf("targetFinalHp=%v want 990 (1 tick, expire-before-tick at t=400)", done.Summary.TargetFinalHp)
	}
	tickCount := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]
	if tickCount != 1 {
		t.Fatalf("provider_tick count=%d want 1", tickCount)
	}
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
	state.heap = scheduler.NewGenericHeap(4)
	state.enqueueExpireCleanup(100, expireCleanupPayload{
		combatantKey: model.SelectorTarget,
		providerRef:  "status:attack_buff#1",
		kind:         "provider",
	})
	ev, _ := state.heap.Pop()
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

func loadAttributeChangeFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_attribute_change.json"))
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

func TestGenericRunAttributeChangeUpdatesResolved(t *testing.T) {
	compileReq, runReq := loadAttributeChangeFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("run error: %+v", err)
	}
	var targetSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorTarget {
			targetSnap = c
			break
		}
	}
	if targetSnap.Attributes["attack_damage"].Resolved != 150 {
		t.Fatalf("attack_damage resolved=%v want 150", targetSnap.Attributes["attack_damage"].Resolved)
	}
	if targetSnap.Attributes["attack_damage"].Base != 150 {
		t.Fatalf("attack_damage base=%v want 150", targetSnap.Attributes["attack_damage"].Base)
	}
}

func TestGenericRunStopPolicyOmittedDefaultsStopOnTargetDeath(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &killTarget},
			DamageType: "damage/physical",
		},
	}
	fixture.RunRequest.StopPolicy = model.StopPolicy{DurationMs: 100}
	fixture.RunRequest.DriverPlan.Entries[0].FirstAtMs = 0
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	done, runErr := RunGeneric(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	if done.Summary.StopReason != model.StopReasonTargetDead {
		t.Fatalf("stopReason=%q want target_dead", done.Summary.StopReason)
	}
}

func TestGenericRunStopPolicyOmittedDefaultsStopWhenNoEvents(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	done := state.buildDoneResult()
	if done.Summary.StopReason != model.StopReasonNoEvents {
		t.Fatalf("stopReason=%q want no_events", done.Summary.StopReason)
	}
}

func TestGenericRunSafetyBudgetMaxCommandsPerEvent(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	amt := 10.0
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &amt},
			DamageType: "damage/physical",
		},
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &amt},
			DamageType: "damage/physical",
		},
	}
	fixture.RunRequest.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	_, runErr := RunGeneric(result.Session, fixture.RunRequest)
	if runErr == nil {
		t.Fatal("expected max commands error")
	}
	if runErr.Code != model.GenericErrRuntimeInvariantFailed {
		t.Fatalf("code=%q want runtime_invariant_failed", runErr.Code)
	}
}

func TestGenericRunSafetyBudgetMaxEventsCannotExceedCompileCap(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	if readyAt := source.cooldowns[fireballRef]; readyAt != state.nowMs {
		t.Fatalf("after reset readyAt=%d want nowMs=%d", readyAt, state.nowMs)
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
	if readyAt := source2.cooldowns[fireballRef]; readyAt != 600 {
		t.Fatalf("after reduce readyAt=%d want 600 (1000-400)", readyAt)
	}
}

func TestGenericRunEmitEventRecordsEvidence(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	fixture.CompileRequest.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "emit_event",
			Target:    "target",
			Ref:       "event:test_hit",
		},
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatal("compile failed")
	}
	done, runErr := RunGeneric(result.Session, fixture.RunRequest)
	if runErr != nil {
		t.Fatal(runErr)
	}
	found := false
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent {
			continue
		}
		found = true
		if item.Ref != "event:test_hit" {
			t.Fatalf("ref=%q want event:test_hit", item.Ref)
		}
	}
	if !found {
		t.Fatal("missing emitted_event evidence")
	}
}

func TestGenericRunDamageDealtUsesPreShieldAmount(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	var runDone model.DoneResult
	var runGenErr *model.EngineError
	runDone, runGenErr = RunGeneric(result.Session, fixture.RunRequest)
	if runGenErr != nil {
		t.Fatal(runGenErr)
	}
	if runDone.Summary.TargetFinalHp != 950 {
		t.Fatalf("targetFinalHp=%v want 950", runDone.Summary.TargetFinalHp)
	}
	// R=0 时 mitigated==raw；summary 口径为抗性后、护盾前（pre-shield mitigated）。
	if runDone.Summary.SourceDamageDealt != 100 {
		t.Fatalf("sourceDamageDealt=%v want 100 (mitigated pre-shield; R=0 keeps raw)", runDone.Summary.SourceDamageDealt)
	}
}

func TestGenericRunHealOverhealReported(t *testing.T) {
	fixtureRaw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "generic_p0_basic_damage.json"))
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
	done := state.buildDoneResult()
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
	if err := state.applyProviderInstance(model.SelectorTarget, model.SelectorSource, "status:attack_buff", 500, true, nil); err != nil {
		t.Fatal(err)
	}
	providerRef := state.combatants[model.SelectorTarget].providers[0].ProviderRef
	state.nowMs = 200
	if err := state.refreshProviderInstance(model.SelectorTarget, providerRef, 700, true, nil); err != nil {
		t.Fatal(err)
	}
	inst := state.combatants[model.SelectorTarget].providers[0]
	if inst.ExpireAt <= 500 {
		t.Fatalf("extended expireAt=%d want > 500", inst.ExpireAt)
	}
	state.expireCleanupPayloads = []expireCleanupPayload{{
		combatantKey: model.SelectorTarget,
		providerRef:  providerRef,
		kind:         "provider",
	}}
	state.nowMs = 500
	state.handleExpireCleanup(scheduler.GenericEvent{
		TimeMs:           500,
		Category:         scheduler.GenericCategoryExpireCleanup,
		Kind:             scheduler.GenericEventExpireCleanup,
		DriverEntryIndex: 0,
	})
	if len(state.combatants[model.SelectorTarget].providers) != 1 {
		t.Fatalf("provider removed by stale cleanup, providers=%+v", state.combatants[model.SelectorTarget].providers)
	}
}
