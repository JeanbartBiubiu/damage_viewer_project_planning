package enginev2demo

import (
	"sort"
	"time"
)

const (
	initBatchSize = 64
	runBatchSize  = 64
)

func NewBenchmarkSession() (*EngineSession, error) {
	return NewSession(BenchmarkBundle())
}

func RunBenchmarkBattle() (EngineRunResult, error) {
	session, err := NewBenchmarkSession()
	if err != nil {
		return EngineRunResult{}, err
	}
	return session.Run(BenchmarkInput())
}

func Summarize(result EngineRunResult) BattleSummary {
	return BattleSummary{
		FinalTimeMs:     result.FinalTimeMs,
		ProcessedEvents: result.ProcessedEvents,
		StopReason:      result.StopReason,
		SelfHP:          result.Actors["self"].CurrentHP,
		EnemyHP:         result.Actors["enemy"].CurrentHP,
		LogCount:        len(result.Logs),
	}
}

func MeasureBenchmark(warmup, samples int) (BenchmarkReport, error) {
	initFirstStart := time.Now()
	_, err := NewBenchmarkSession()
	if err != nil {
		return BenchmarkReport{}, err
	}
	initFirstUs := microsSince(initFirstStart)

	for i := 0; i < warmup; i++ {
		if _, err := NewBenchmarkSession(); err != nil {
			return BenchmarkReport{}, err
		}
	}

	initSamples := make([]float64, 0, samples)
	for i := 0; i < samples; i++ {
		start := time.Now()
		for batch := 0; batch < initBatchSize; batch++ {
			if _, err := NewBenchmarkSession(); err != nil {
				return BenchmarkReport{}, err
			}
		}
		initSamples = append(initSamples, microsSince(start)/float64(initBatchSize))
	}

	session, err := NewBenchmarkSession()
	if err != nil {
		return BenchmarkReport{}, err
	}

	runFirstStart := time.Now()
	firstResult, err := session.Run(BenchmarkInput())
	if err != nil {
		return BenchmarkReport{}, err
	}
	runFirstUs := microsSince(runFirstStart)

	for i := 0; i < warmup; i++ {
		if _, err := session.Run(BenchmarkInput()); err != nil {
			return BenchmarkReport{}, err
		}
	}

	runSamples := make([]float64, 0, samples)
	for i := 0; i < samples; i++ {
		start := time.Now()
		for batch := 0; batch < runBatchSize; batch++ {
			if _, err := session.Run(BenchmarkInput()); err != nil {
				return BenchmarkReport{}, err
			}
		}
		runSamples = append(runSamples, microsSince(start)/float64(runBatchSize))
	}

	return BenchmarkReport{
		Init:    buildStats(initFirstUs, warmup, initSamples),
		Run:     buildStats(runFirstUs, warmup, runSamples),
		Summary: Summarize(firstResult),
	}, nil
}

func buildStats(firstUs float64, warmup int, samples []float64) OperationStats {
	if len(samples) == 0 {
		return OperationStats{FirstUs: firstUs, Warmup: warmup}
	}
	sorted := append([]float64(nil), samples...)
	sort.Float64s(sorted)
	sum := 0.0
	for _, sample := range sorted {
		sum += sample
	}
	return OperationStats{
		FirstUs:     firstUs,
		SampleCount: len(sorted),
		Warmup:      warmup,
		MinUs:       sorted[0],
		P50Us:       percentile(sorted, 50),
		AvgUs:       sum / float64(len(sorted)),
		P95Us:       percentile(sorted, 95),
		MaxUs:       sorted[len(sorted)-1],
	}
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int((p / 100.0) * float64(len(sorted)-1))
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func microsSince(start time.Time) float64 {
	return float64(time.Since(start).Nanoseconds()) / 1000.0
}
