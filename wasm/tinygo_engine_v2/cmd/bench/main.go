// 原生 Go benchmark smoke：测 generic runtime。
// 非 Wasm 路径；改 runtime 热路径后应与本命令结果一并核对。
package main

import (
	"fmt"
	"math"
	"os"
	"sort"
	"time"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime"
	"tinygo_engine_v2/internal/testkit"
)

func main() {
	mode := "generic"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}

	switch mode {
	case "generic", "generic-run":
		runGenericBench()
	default:
		fmt.Fprintf(os.Stderr, "unsupported mode %q (want generic|generic-run)\n", mode)
		os.Exit(2)
	}
}

func runGenericBench() {
	const warmup = 10
	const samples = 100

	fixture, err := testkit.LoadGenericFixture("generic_p0_basic_damage.json")
	if err != nil {
		fatalf("load fixture: %v", err)
	}

	session := runtime.NewSession()
	compiled := compileFixtureSession(session, fixture.CompileRequest)
	if !compiled.OK || compiled.SessionID == "" {
		fatalf("compile failed: %+v", compiled)
	}
	if compiled.RulesHash != fixture.CompileRequest.RulesHash {
		fatalf("rulesHash=%q want %q", compiled.RulesHash, fixture.CompileRequest.RulesHash)
	}

	runOnce := func() model.DoneResult {
		session.ClearOutbox()
		runReq := fixture.RunRequest
		runReq.SessionID = compiled.SessionID
		runReq.ExpectedRulesHash = compiled.RulesHash
		frame := testkit.EncodeGenericFrame(model.FrameKindGenericRun, runReq)
		if code := session.RunFrame(frame); code != 0 {
			fatalf("RunFrame code=%d", code)
		}
		done := testkit.LastGenericRunDone(session.OutboxBytes())
		validateGenericDone(done, fixture.ExpectedSummarySubset)
		return done
	}

	for i := 0; i < warmup; i++ {
		_ = runOnce()
	}

	elapsed := make([]time.Duration, 0, samples)
	for i := 0; i < samples; i++ {
		start := time.Now()
		_ = runOnce()
		elapsed = append(elapsed, time.Since(start))
	}

	releaseFrame := testkit.EncodeGenericFrame(model.FrameKindGenericReleaseSession, model.ReleaseSessionRequest{
		SessionID:         compiled.SessionID,
		ExpectedRulesHash: compiled.RulesHash,
	})
	session.ClearOutbox()
	if code := session.ReleaseSessionFrame(releaseFrame); code != 0 {
		fatalf("ReleaseSessionFrame code=%d", code)
	}
	released := testkit.LastGenericReleaseDone(session.OutboxBytes())
	if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
		fatalf("release unexpected: %+v", released)
	}

	stats := summarizeDurations(elapsed)
	fmt.Printf(
		"mode=generic-run fixture=%s samples=%d min_us=%.2f mean_us=%.2f p50_us=%.2f p95_us=%.2f max_us=%.2f\n",
		fixture.Name,
		samples,
		stats.minUs,
		stats.meanUs,
		stats.p50Us,
		stats.p95Us,
		stats.maxUs,
	)
}

func compileFixtureSession(session *runtime.Session, req model.CompileRequest) model.CompileResult {
	session.ClearOutbox()
	frame := testkit.EncodeGenericFrame(model.FrameKindGenericCompile, req)
	if code := session.CompileFrame(frame); code != 0 {
		fatalf("CompileFrame code=%d err=%+v", code, testkit.LastGenericError(session.OutboxBytes()))
	}
	return testkit.LastGenericCompileResult(session.OutboxBytes())
}

func validateGenericDone(done model.DoneResult, expected map[string]interface{}) {
	if !done.OK {
		fatalf("done.ok=false")
	}
	for key, wantRaw := range expected {
		got, ok := summaryValue(done.Summary, key)
		if !ok {
			fatalf("summary missing key %q", key)
		}
		if !valuesEqual(got, wantRaw) {
			fatalf("summary.%s=%v want %v", key, got, wantRaw)
		}
	}
}

func summaryValue(summary model.RunSummary, key string) (interface{}, bool) {
	switch key {
	case "targetFinalHp":
		return summary.TargetFinalHp, true
	case "sourceFinalHp":
		return summary.SourceFinalHp, true
	case "abilityAttemptCount":
		return summary.AbilityAttemptCount, true
	case "abilityCastCount":
		return summary.AbilityCastCount, true
	case "attemptSkippedCount":
		return summary.AttemptSkippedCount, true
	default:
		return nil, false
	}
}

func valuesEqual(got, want interface{}) bool {
	switch w := want.(type) {
	case float64:
		switch g := got.(type) {
		case float64:
			return g == w
		case int:
			return float64(g) == w
		default:
			return false
		}
	case int:
		switch g := got.(type) {
		case int:
			return g == w
		case float64:
			return g == float64(w)
		default:
			return false
		}
	default:
		return got == want
	}
}

type durationStats struct {
	minUs  float64
	meanUs float64
	p50Us  float64
	p95Us  float64
	maxUs  float64
}

func summarizeDurations(samples []time.Duration) durationStats {
	if len(samples) == 0 {
		return durationStats{}
	}
	sorted := append([]time.Duration(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	var total time.Duration
	for _, d := range sorted {
		total += d
	}
	return durationStats{
		minUs:  micros(sorted[0]),
		meanUs: float64(total) / float64(time.Microsecond) / float64(len(sorted)),
		p50Us:  micros(percentile(sorted, 50)),
		p95Us:  micros(percentile(sorted, 95)),
		maxUs:  micros(sorted[len(sorted)-1]),
	}
}

func percentile(sorted []time.Duration, p int) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil((float64(p)/100)*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func micros(d time.Duration) float64 {
	return float64(d) / float64(time.Microsecond)
}

func fatalf(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "bench: "+format+"\n", args...)
	os.Exit(1)
}
