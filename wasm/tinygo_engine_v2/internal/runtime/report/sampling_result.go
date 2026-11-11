package report

import "tinygo_engine_v2/internal/model"

// SamplingResult 是一次报告读取的完整采样交付；Series遵守本次final的所有权。
type SamplingResult struct {
	Series        []model.SeriesPoint
	Evidence      model.SeriesSamplingEvidence
	DroppedPoints int
}

func (s *State) CompleteSampling(timeMs int64, final bool) SamplingResult {
	rawCount := len(s.series)
	series, downsampled := s.finalizeSeries(final)
	if series == nil {
		series = []model.SeriesPoint{}
	}
	dropped := 0
	if downsampled && rawCount > len(series) {
		dropped = rawCount - len(series)
	}
	requested := 0
	method := "disabled"
	if !s.sampling.Disabled {
		method = "uniform_time"
		span := timeMs - s.startMs
		requested = int(span/int64(s.sampling.SampleEveryMs)) + 1
		if span%int64(s.sampling.SampleEveryMs) != 0 {
			requested++
		}
		downsampled = s.effectiveSampleEveryMs > int64(s.sampling.SampleEveryMs)
		dropped = requested - len(series)
	}
	return SamplingResult{
		Series: series, DroppedPoints: dropped,
		Evidence: model.SeriesSamplingEvidence{
			RequestedSampleEveryMs: s.sampling.SampleEveryMs,
			EffectiveSampleEveryMs: int(s.effectiveSampleEveryMs),
			RequestedPointCount:    requested,
			FinalPointCount:        len(series),
			MaxSeriesPoints:        s.sampling.MaxSeriesPoints,
			Downsampled:            downsampled,
			Method:                 method,
		},
	}
}
