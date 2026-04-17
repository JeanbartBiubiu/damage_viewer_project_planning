package main

import (
	"fmt"
	"log"

	"go_engine_v2_demo/enginev2demo"
)

func main() {
	report, err := enginev2demo.MeasureBenchmark(20, 200)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println("=== Go Engine V2 Demo Benchmark ===")
	printStats("init_session", report.Init)
	printStats("run_benchmark_battle", report.Run)
	fmt.Printf(
		"battle_summary final_time_ms=%d processed_events=%d stop=%s self_hp=%.3f enemy_hp=%.3f logs=%d\n",
		report.Summary.FinalTimeMs,
		report.Summary.ProcessedEvents,
		report.Summary.StopReason,
		report.Summary.SelfHP,
		report.Summary.EnemyHP,
		report.Summary.LogCount,
	)
}

func printStats(label string, stats enginev2demo.OperationStats) {
	fmt.Printf("%s first_us=%.3f sample_count=%d warmup=%d min_us=%.3f p50_us=%.3f avg_us=%.3f p95_us=%.3f max_us=%.3f\n",
		label,
		stats.FirstUs,
		stats.SampleCount,
		stats.Warmup,
		stats.MinUs,
		stats.P50Us,
		stats.AvgUs,
		stats.P95Us,
		stats.MaxUs,
	)
}
