// 本文件提供原生 Go benchmark smoke，用来快速验证 TinyGo V2 引擎在非 Wasm 环境下的运行成本和结果稳定性。
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
