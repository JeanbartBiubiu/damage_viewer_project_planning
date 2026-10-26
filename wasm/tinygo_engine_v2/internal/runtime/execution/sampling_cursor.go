package execution

import "tinygo_engine_v2/internal/model"

func (s *Engine) initSamplingCursor(config model.SamplingConfig) *model.EngineError {
	if !s.report.InitSampling(config, s.loop.StartMs(), s.loop.DurationMs()) {
		return s.basicAttackErr("sampling requires positive intervals and maxSeriesPoints in [2,5000]", "sampling")
	}
	return nil
}
func (s *Engine) flushSamplesBefore(timeMs int64) {
	for {
		next, ok := s.report.NextSample()
		if !ok || next >= timeMs {
			return
		}
		s.report.AdvanceSample(s.buildSeriesPoint(next))
	}
}
func (s *Engine) flushSamplesThrough(timeMs int64) {
	s.flushSamplesBefore(timeMs)
	if next, ok := s.report.NextSample(); ok && next == timeMs {
		s.report.AdvanceSample(s.buildSeriesPoint(timeMs))
	}
}
func (s *Engine) appendFinalSample() {
	if s.report.NeedsFinalSample(s.loop.TimeMs()) {
		s.report.AppendSample(s.buildSeriesPoint(s.loop.TimeMs()))
	}
}
