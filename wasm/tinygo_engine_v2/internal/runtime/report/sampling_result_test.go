package report

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestSamplingCompletionKeepsDisabledEmptyArray(t *testing.T) {
	var report State
	if !report.InitSampling(model.SamplingConfig{Disabled: true}, 1000, 1000) {
		t.Fatal("disabled sampling rejected")
	}
	result := report.CompleteSampling(1207, true)
	want := model.SeriesSamplingEvidence{Method: "disabled"}
	if result.Series == nil || len(result.Series) != 0 || result.DroppedPoints != 0 || result.Evidence != want {
		t.Fatalf("disabled result changed: %+v", result)
	}
}

func TestSamplingCompletionUsesActualEndpointAndOwnership(t *testing.T) {
	var report State
	if !report.InitSampling(model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 500, MaxSeriesPoints: 100}, 1000, 1000) {
		t.Fatal("valid sampling rejected")
	}
	for _, at := range []int64{1000, 1100, 1200, 1207} {
		report.AppendSample(model.SeriesPoint{TimeMs: at})
	}
	want := model.SeriesSamplingEvidence{RequestedSampleEveryMs: 100, EffectiveSampleEveryMs: 100, RequestedPointCount: 4, FinalPointCount: 4, MaxSeriesPoints: 100, Method: "uniform_time"}
	read := report.CompleteSampling(1207, false)
	if read.Evidence != want || read.DroppedPoints != 0 {
		t.Fatalf("actual nonintegral endpoint changed: %+v", read)
	}
	read.Series[0].TimeMs = -1
	if report.series[0].TimeMs != 1000 {
		t.Fatal("nonfinal result rewrote report")
	}
	final := report.CompleteSampling(1207, true)
	if &final.Series[0] != &report.series[0] || final.Evidence != want {
		t.Fatal("final result did not preserve allowed series transfer", final)
	}
}

func TestSamplingCompletionKeepsEffectiveIntervalAndLegacyReductionFlag(t *testing.T) {
	var report State
	if !report.InitSampling(model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 500, MaxSeriesPoints: 3}, 1000, 1000) {
		t.Fatal("valid sampling rejected")
	}
	for _, at := range []int64{1000, 1500, 2000} {
		report.AppendSample(model.SeriesPoint{TimeMs: at})
	}
	result := report.CompleteSampling(2000, true)
	want := model.SeriesSamplingEvidence{RequestedSampleEveryMs: 100, EffectiveSampleEveryMs: 500, RequestedPointCount: 11, FinalPointCount: 3, MaxSeriesPoints: 3, Downsampled: true, Method: "uniform_time"}
	if result.Evidence != want || result.DroppedPoints != 8 {
		t.Fatalf("budget-adjusted sampling evidence changed: %+v", result)
	}
	var dense State
	if !dense.InitSampling(model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 500, MaxSeriesPoints: 3}, 0, 200) {
		t.Fatal("valid dense sampling rejected")
	}
	for _, at := range []int64{0, 50, 100, 150, 200} {
		dense.AppendSample(model.SeriesPoint{TimeMs: at})
	}
	result = dense.CompleteSampling(200, true)
	var times []int64
	for _, point := range result.Series {
		times = append(times, point.TimeMs)
	}
	if !reflect.DeepEqual(times, []int64{0, 50, 150}) || result.Evidence.Downsampled || result.Evidence.RequestedPointCount != 3 || result.DroppedPoints != 0 {
		t.Fatalf("raw point cap must retain the original interval-based flag: %+v times=%v", result, times)
	}
}
