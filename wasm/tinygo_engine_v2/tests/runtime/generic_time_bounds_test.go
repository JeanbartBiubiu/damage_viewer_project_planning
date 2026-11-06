package runtime_test

import (
	"math"
	"testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func TestGenericRunRejectsInvalidTimeBounds(t *testing.T) {
	input := loadGenericFixtureCompileRequest(t, "formula_phase4_explicit_basic_damage.json")
	compiled := compilebundle.CompileGeneric(input)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	for _, tc := range []struct {
		name, path             string
		start, duration, first int64
	}{
		{"negative snapshot", "initialSnapshot.timeMs", -1, 100, 0},
		{"negative duration", "stopPolicy.durationMs", 0, -100, 0},
		{"overflowing end", "stopPolicy.durationMs", math.MaxInt64, 1, math.MaxInt64},
		{"driver before snapshot", "driverPlan.entries[0].firstAtMs", 100, 100, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			session := runtimeengine.NewMathSession()
			identity := compileGenericSession(t, session)
			req := loadGenericFixtureRunRequest(t, "formula_phase4_explicit_basic_damage.json")
			req.SessionID, req.ExpectedRulesHash = identity.SessionID, identity.RulesHash
			req.InitialSnapshot.TimeMs, req.StopPolicy.DurationMs = tc.start, tc.duration
			req.DriverPlan.Entries[0].FirstAtMs = tc.first
			if _, failure := runtimeengine.RunGeneric(compiled.Session, req); failure == nil || failure.Path != tc.path {
				t.Fatalf("direct run failure = %+v, want path %s", failure, tc.path)
			}
			session.ClearOutbox()
			if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, req)); code != -1 {
				t.Fatalf("RunFrame code = %d, want -1; outbox = %s", code, session.OutboxBytes())
			}
			failure := lastGenericError(session.OutboxBytes())
			if failure.Code != model.GenericErrRuntimeInvariantFailed || failure.Phase != model.GenericPhaseRun || failure.Path != tc.path || failure.SessionID != identity.SessionID {
				t.Fatalf("unexpected failure: %+v", failure)
			}
			// 拒绝输入不能损坏可复用的编译会话。
			req.InitialSnapshot.TimeMs, req.StopPolicy.DurationMs, req.DriverPlan.Entries[0].FirstAtMs = 0, 100, 0
			session.ClearOutbox()
			if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, req)); code != 0 {
				t.Fatalf("valid retry failed: %+v", lastGenericError(session.OutboxBytes()))
			}
			if done := lastGenericRunDone(session.OutboxBytes()); !done.OK || done.Summary.TargetFinalHp != 900 {
				t.Fatalf("valid retry = %+v", done)
			}
		})
	}
}

func TestGenericRunPreservesZeroAndResumedTimeBounds(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		start, duration, first int64
		wantHP                 float64
	}{
		{"zero duration", 0, 0, 0, 900},
		{"zero duration near maximum", math.MaxInt64 - 7, 0, math.MaxInt64 - 7, 900},
		{"resumed start", 100, 50, 100, 900},
		{"future driver outside window", 100, 50, 151, 1000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			session := runtimeengine.NewMathSession()
			identity := compileGenericSession(t, session)
			req := loadGenericFixtureRunRequest(t, "formula_phase4_explicit_basic_damage.json")
			req.SessionID, req.ExpectedRulesHash = identity.SessionID, identity.RulesHash
			req.InitialSnapshot.TimeMs, req.StopPolicy.DurationMs = tc.start, tc.duration
			req.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
			req.DriverPlan.Entries[0].FirstAtMs = tc.first
			session.ClearOutbox()
			if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, req)); code != 0 {
				t.Fatalf("run failed: %+v", lastGenericError(session.OutboxBytes()))
			}
			done := lastGenericRunDone(session.OutboxBytes())
			if !done.OK || done.Summary.DurationMs != tc.duration || done.FinalSnapshot.TimeMs != tc.start+tc.duration || done.Summary.TargetFinalHp != tc.wantHP {
				t.Fatalf("unexpected time or damage result: %+v", done)
			}
		})
	}
}

func TestGenericRunRepeatCannotWrapIntoPast(t *testing.T) {
	hugeInterval := 1e20
	for _, tc := range []struct {
		name   string
		first  int64
		repeat model.DriverRepeat
		wantHP float64
	}{
		{"future first with overflowing repeat", math.MaxInt64 - 807, model.DriverRepeat{IntervalMs: 1000, MaxAttempts: 2}, 1000},
		{"in-window first with overflowing repeat", 1, model.DriverRepeat{IntervalMs: math.MaxInt64, MaxAttempts: 2}, 900},
		{"huge dynamic interval", 0, model.DriverRepeat{IntervalFormula: &model.GenericFormulaExpr{Op: "const", Value: &hugeInterval}, MaxAttempts: 2}, 900},
	} {
		t.Run(tc.name, func(t *testing.T) {
			session := runtimeengine.NewMathSession()
			identity := compileGenericSession(t, session)
			req := loadGenericFixtureRunRequest(t, "formula_phase4_explicit_basic_damage.json")
			req.SessionID, req.ExpectedRulesHash = identity.SessionID, identity.RulesHash
			req.StopPolicy.DurationMs, req.StopPolicy.StopWhenNoEvents = 100, model.BoolPtr(false)
			req.DriverPlan.Entries[0].FirstAtMs, req.DriverPlan.Entries[0].Repeat = tc.first, &tc.repeat
			session.ClearOutbox()
			if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, req)); code != 0 {
				t.Fatalf("run failed: %+v", lastGenericError(session.OutboxBytes()))
			}
			done := lastGenericRunDone(session.OutboxBytes())
			if !done.OK || done.Summary.TargetFinalHp != tc.wantHP || done.FinalSnapshot.TimeMs != 100 {
				t.Fatalf("repeat outside window: ok=%v hp=%v casts=%d time=%d", done.OK, done.Summary.TargetFinalHp, done.Summary.AbilityCastCount, done.FinalSnapshot.TimeMs)
			}
		})
	}
}

func TestGenericRunSamplingBounds(t *testing.T) {
	for _, tc := range []struct {
		name            string
		duration        int64
		disabled, valid bool
	}{
		{"maximum requested point count", math.MaxInt32 - 1, false, true},
		{"unrepresentable requested point count", 1 << 32, false, false},
		{"same long run without sampling", 1 << 32, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			session := runtimeengine.NewMathSession()
			identity := compileGenericSession(t, session)
			req := loadGenericFixtureRunRequest(t, "formula_phase4_explicit_basic_damage.json")
			req.SessionID, req.ExpectedRulesHash = identity.SessionID, identity.RulesHash
			req.StopPolicy.DurationMs, req.StopPolicy.StopWhenNoEvents = tc.duration, model.BoolPtr(false)
			req.Sampling = model.SamplingConfig{Disabled: tc.disabled, SampleEveryMs: 1, DpsWindowMs: 100, MaxSeriesPoints: 3}
			session.ClearOutbox()
			code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, req))
			if !tc.valid {
				if code != -1 {
					t.Fatalf("unsupported sampling succeeded: code=%d", code)
				}
				if failure := lastGenericError(session.OutboxBytes()); failure.Path != "sampling" {
					t.Fatalf("sampling failure = %+v", failure)
				}
				return
			}
			if code != 0 {
				t.Fatalf("run failed: %+v", lastGenericError(session.OutboxBytes()))
			}
			done := lastGenericRunDone(session.OutboxBytes())
			if done.FinalSnapshot.TimeMs != tc.duration || done.Summary.TargetFinalHp != 900 {
				t.Fatalf("unexpected final time or health: %d / %v", done.FinalSnapshot.TimeMs, done.Summary.TargetFinalHp)
			}
			if !tc.disabled && (done.SeriesSamplingEvidence.RequestedPointCount != math.MaxInt32 || done.SeriesSamplingEvidence.EffectiveSampleEveryMs <= 0 || len(done.Series) > 3) {
				t.Fatalf("sampling evidence = %+v, series=%d", done.SeriesSamplingEvidence, len(done.Series))
			}
		})
	}
}
