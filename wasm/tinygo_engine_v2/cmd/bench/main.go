// 原生 Go benchmark smoke：通过 testkit 跑完整 battle，测延迟分布。
// 非 Wasm 路径，不验证 ABI/outbox；改 runtime 热路径后应与本命令结果一并核对。
package main

import (
	"fmt"
	"time"

	"tinygo_engine_v2/internal/testkit"
)

func main() {
	const warmup = 10
	const samples = 100
	for i := 0; i < warmup; i++ {
		testkit.RunBenchmarkBattle()
	}
	var total time.Duration
	var max time.Duration
	for i := 0; i < samples; i++ {
		start := time.Now()
		testkit.RunBenchmarkBattle()
		elapsed := time.Since(start)
		total += elapsed
		if elapsed > max {
			max = elapsed
		}
	}
	fmt.Printf("samples=%d avg_us=%.2f max_us=%.2f\n", samples, float64(total.Microseconds())/samples, float64(max.Microseconds()))
}
