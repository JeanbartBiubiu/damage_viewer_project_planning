package report

import (
	"math"
	"tinygo_engine_v2/internal/model"
)

func (s *State) InitSampling(config model.SamplingConfig, start, duration int64) bool {
	s.sampling, s.startMs, s.durationMs = config, start, duration
	s.samplingExhausted = false
	if config.Disabled {
		s.effectiveSampleEveryMs = 0
		return true
	}
	if config.SampleEveryMs <= 0 || config.DpsWindowMs <= 0 || config.MaxSeriesPoints < 2 || config.MaxSeriesPoints > 5000 {
		return false
	}
	requestedIntervals := duration / int64(config.SampleEveryMs)
	if duration%int64(config.SampleEveryMs) != 0 {
		requestedIntervals++
	}
	// 对外采样计数使用32位整数；不能在Wasm输出时窄化成负数或伪造计数。
	if requestedIntervals >= math.MaxInt32 {
		return false
	}
	s.effectiveSampleEveryMs = int64(config.SampleEveryMs)
	divisor := int64(config.MaxSeriesPoints - 1)
	minimum := duration / divisor
	if duration%divisor != 0 {
		minimum++
	}
	if minimum > s.effectiveSampleEveryMs {
		s.effectiveSampleEveryMs = minimum
	}
	if s.effectiveSampleEveryMs > math.MaxInt32 {
		return false
	}
	s.nextSampleAtMs = start
	return true
}
func (s *State) EffectiveSampleEveryMs() int64 { return s.effectiveSampleEveryMs }
func (s *State) NextSample() (int64, bool) {
	return s.nextSampleAtMs, !s.sampling.Disabled && !s.samplingExhausted && s.nextSampleAtMs <= s.startMs+s.durationMs
}
func (s *State) AppendSample(point model.SeriesPoint) { s.series = append(s.series, point) }
func (s *State) AdvanceSample(point model.SeriesPoint) {
	s.AppendSample(point)
	if s.effectiveSampleEveryMs > s.startMs+s.durationMs-s.nextSampleAtMs {
		s.samplingExhausted = true
		return
	}
	s.nextSampleAtMs += s.effectiveSampleEveryMs
}
func (s *State) NeedsFinalSample(timeMs int64) bool {
	return !s.sampling.Disabled && (len(s.series) == 0 || s.series[len(s.series)-1].TimeMs != timeMs)
}

func (s *State) SeriesPoint(timeMs int64, sourceHp, targetHp float64) model.SeriesPoint {
	windowMs := int64(s.sampling.DpsWindowMs)
	var sourceCumDps, targetCumDps, sourceWinDps, targetWinDps float64
	if timeMs > 0 {
		secs := float64(timeMs) / 1000
		sourceCumDps, targetCumDps = s.totals.SourceDamageDealt/secs, s.totals.TargetDamageDealt/secs
		effectiveWindow := windowMs
		if timeMs < effectiveWindow {
			effectiveWindow = timeMs
		}
		if effectiveWindow > 0 {
			windowSecs := float64(effectiveWindow) / 1000
			sourceWinDps = s.DamageInWindow(model.SelectorSource, true, timeMs-effectiveWindow, timeMs) / windowSecs
			targetWinDps = s.DamageInWindow(model.SelectorTarget, true, timeMs-effectiveWindow, timeMs) / windowSecs
		}
	}
	return model.SeriesPoint{TimeMs: timeMs, SourceHp: sourceHp, TargetHp: targetHp, SourceDamageDealt: s.totals.SourceDamageDealt, TargetDamageDealt: s.totals.TargetDamageDealt, SourceCumulativeDps: sourceCumDps, TargetCumulativeDps: targetCumDps, SourceWindowDps: sourceWinDps, TargetWindowDps: targetWinDps}
}
func (s *State) DamageInWindow(key string, dealer bool, from, to int64) float64 {
	var total float64
	for _, row := range s.damageHistory {
		if row.timeMs < from || row.timeMs > to {
			continue
		}
		if dealer {
			if row.sourceKey == key {
				total += row.amount
			}
		} else if row.targetKey == key {
			total += row.amount
		}
	}
	return total
}
func (s *State) finalizeSeries(final bool) ([]model.SeriesPoint, bool) {
	points := s.series
	if len(points) <= s.sampling.MaxSeriesPoints {
		if final {
			return points, false
		}
		return append([]model.SeriesPoint{}, points...), false
	}
	step := float64(len(points)) / float64(s.sampling.MaxSeriesPoints)
	if step < 1 {
		step = 1
	}
	out := make([]model.SeriesPoint, 0, s.sampling.MaxSeriesPoints)
	for i := 0; i < s.sampling.MaxSeriesPoints; i++ {
		index := int(float64(i) * step)
		if index >= len(points) {
			index = len(points) - 1
		}
		out = append(out, points[index])
	}
	return out, true
}
