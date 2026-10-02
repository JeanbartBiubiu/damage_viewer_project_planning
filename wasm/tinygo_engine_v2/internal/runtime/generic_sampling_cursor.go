package runtime

import "tinygo_engine_v2/internal/model"

func (s *genericRunState) initSamplingCursor() *model.EngineError {
	if s.sampling.Disabled {
		s.effectiveSampleEveryMs = 0
		return nil
	}
	if s.sampling.SampleEveryMs <= 0 || s.sampling.DpsWindowMs <= 0 || s.sampling.MaxSeriesPoints < 2 || s.sampling.MaxSeriesPoints > 5000 {
		return s.basicAttackErr("sampling requires positive intervals and maxSeriesPoints in [2,5000]", "sampling")
	}
	s.effectiveSampleEveryMs = int64(s.sampling.SampleEveryMs)
	minimum := (s.durationMs + int64(s.sampling.MaxSeriesPoints) - 2) / int64(s.sampling.MaxSeriesPoints-1)
	if minimum > s.effectiveSampleEveryMs {
		s.effectiveSampleEveryMs = minimum
	}
	s.nextSampleAtMs = s.startMs
	return nil
}
func (s *genericRunState) flushSamplesBefore(timeMs int64) {
	if s.sampling.Disabled {
		return
	}
	for s.nextSampleAtMs < timeMs && s.nextSampleAtMs <= s.startMs+s.durationMs {
		s.series = append(s.series, s.buildSeriesPoint(s.nextSampleAtMs))
		s.nextSampleAtMs += s.effectiveSampleEveryMs
	}
}
func (s *genericRunState) flushSamplesThrough(timeMs int64) {
	if s.sampling.Disabled {
		return
	}
	s.flushSamplesBefore(timeMs)
	if s.nextSampleAtMs == timeMs {
		s.series = append(s.series, s.buildSeriesPoint(timeMs))
		s.nextSampleAtMs += s.effectiveSampleEveryMs
	}
}
func (s *genericRunState) appendFinalSample() {
	if s.sampling.Disabled {
		return
	}
	if len(s.series) == 0 || s.series[len(s.series)-1].TimeMs != s.nowMs {
		s.series = append(s.series, s.buildSeriesPoint(s.nowMs))
	}
}
