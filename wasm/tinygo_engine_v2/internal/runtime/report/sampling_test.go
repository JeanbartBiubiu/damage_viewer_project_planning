package report

import (
	"math"
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestSamplingStopsBeforeTimeOverflow(t *testing.T) {
	for _, tc := range []struct {
		name                      string
		start, duration, interval int64
		points                    int
	}{
		{"zero duration near maximum", math.MaxInt64, 0, 5, 1},
		{"short window near maximum", math.MaxInt64 - 7, 7, 5, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var report State
			if !report.InitSampling(model.SamplingConfig{SampleEveryMs: 5, DpsWindowMs: 100, MaxSeriesPoints: 3}, tc.start, tc.duration) {
				t.Fatal("sampling configuration rejected")
			}
			if report.EffectiveSampleEveryMs() != tc.interval {
				t.Fatalf("interval = %d, want %d", report.EffectiveSampleEveryMs(), tc.interval)
			}
			for index := 0; index < tc.points; index++ {
				at, ok := report.NextSample()
				if !ok || at != tc.start+int64(index)*tc.interval {
					t.Fatalf("sample %d: time=%d available=%v", index, at, ok)
				}
				report.AdvanceSample(model.SeriesPoint{TimeMs: at})
			}
			if next, ok := report.NextSample(); ok {
				t.Fatalf("sampling continued outside window at %d", next)
			}
		})
	}
}

func TestSamplingRejectsUnrepresentableEvidence(t *testing.T) {
	for _, tc := range []struct {
		name             string
		duration         int64
		every, maxPoints int
		valid            bool
	}{
		{"maximum point count", math.MaxInt32 - 1, 1, 3, true},
		{"point count overflow", math.MaxInt32, 1, 3, false},
		{"rounding reaches maximum count", 2*(int64(math.MaxInt32)-1) - 1, 2, 3, true},
		{"rounding exceeds maximum count", 2*(int64(math.MaxInt32)-1) + 1, 2, 3, false},
		{"maximum effective interval", math.MaxInt32, 2, 2, true},
		{"effective interval overflow", int64(math.MaxInt32) + 1, 2, 2, false},
		{"duration would overflow old ceiling", math.MaxInt64, 1, 3, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var report State
			if valid := report.InitSampling(model.SamplingConfig{SampleEveryMs: tc.every, DpsWindowMs: 100, MaxSeriesPoints: tc.maxPoints}, 0, tc.duration); valid != tc.valid {
				t.Fatalf("valid = %v, want %v", valid, tc.valid)
			}
		})
	}
	var disabled State
	if !disabled.InitSampling(model.SamplingConfig{Disabled: true}, 0, math.MaxInt64) {
		t.Fatal("disabled sampling must not limit the run window")
	}
}
