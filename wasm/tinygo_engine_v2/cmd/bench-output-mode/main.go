// bench-output-mode 用同一份冻结请求分别测数值执行和完整记录执行。
package main

import (
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"reflect"
	goruntime "runtime"
	"runtime/pprof"
	"sort"
	"time"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	engine "tinygo_engine_v2/internal/runtime"
)

type fixture struct {
	CompileRequest model.CompileRequest `json:"compileRequest"`
	RunRequest     model.RunRequest     `json:"runRequest"`
}
type stats struct {
	Mean   float64 `json:"meanMs"`
	Median float64 `json:"medianMs"`
	P95    float64 `json:"p95Ms"`
	Min    float64 `json:"minMs"`
	Max    float64 `json:"maxMs"`
}

func distribution(values []float64) stats {
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	var sum float64
	for _, value := range sorted {
		sum += value
	}
	return stats{sum / float64(len(sorted)), sorted[(len(sorted)-1)/2], sorted[(len(sorted)*95-1)/100], sorted[0], sorted[len(sorted)-1]}
}
func fail(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func main() {
	inputPath := flag.String("input", "", "冻结的compileRequest/runRequest JSON路径")
	outputPath := flag.String("output", "", "计时JSON路径，省略只写标准输出")
	iterations := flag.Int("iterations", 100, "计时次数")
	warmup := flag.Int("warmup", 10, "预热次数")
	batch := flag.Int("batch", 1, "每个计时样本的运行次数；极短场景用批量平均避开时钟粒度")
	expected := flag.String("expected-full-sha256", "", "原始完整结果摘要，可选")
	cpuProfile := flag.String("cpu-profile", "", "另对汇总模式做200次CPU与分配采样，可选")
	flag.Parse()
	if *inputPath == "" || *iterations < 2 || *warmup < 0 || *batch < 1 || *batch > 10000 {
		fail(fmt.Errorf("input必填，iterations至少2，warmup不能负，batch范围1至10000"))
	}
	goruntime.GOMAXPROCS(1)
	raw, err := os.ReadFile(*inputPath)
	fail(err)
	var data fixture
	fail(json.Unmarshal(raw, &data))
	compiled := compilebundle.CompileGeneric(data.CompileRequest)
	if !compiled.OK {
		fail(fmt.Errorf("编译失败: %+v", compiled.Result.Errors))
	}
	var cases []map[string]any
	var numericalReference model.DoneResult
	for _, name := range []string{"detailed-original", "detailed-no-sampling", "summary-no-sampling"} {
		request := data.RunRequest
		request.OutputMode = model.RunOutputDetailed
		if name != "detailed-original" {
			request.Sampling.Disabled = true
		}
		if name == "summary-no-sampling" {
			request.OutputMode = model.RunOutputSummary
		}
		baseline, issue := engine.RunGeneric(compiled.Session, request)
		if issue != nil {
			fail(fmt.Errorf("%s运行失败: %+v", name, issue))
		}
		encoded, err := json.Marshal(baseline)
		fail(err)
		digest := fmt.Sprintf("%x", sha256.Sum256(encoded))
		if name == "detailed-original" && *expected != "" && digest != *expected {
			fail(fmt.Errorf("完整结果变更: %s", digest))
		}
		if name == "detailed-no-sampling" {
			numericalReference = baseline
		}
		if name == "summary-no-sampling" {
			if !reflect.DeepEqual(baseline.Summary, numericalReference.Summary) || !reflect.DeepEqual(baseline.FinalSnapshot, numericalReference.FinalSnapshot) || !reflect.DeepEqual(baseline.Warnings, numericalReference.Warnings) {
				fail(fmt.Errorf("数值模式结果不等价"))
			}
			if len(baseline.AttackRecords)+len(baseline.DamageRecords)+len(baseline.Evidence.Items)+len(baseline.Series) != 0 {
				fail(fmt.Errorf("数值模式仍有明细或采样"))
			}
		}
		for i := 0; i < *warmup; i++ {
			_, issue := engine.RunGeneric(compiled.Session, request)
			if issue != nil {
				fail(fmt.Errorf("预热失败: %+v", issue))
			}
		}
		goruntime.GC()
		samples := make([]float64, 0, *iterations)
		var before, after goruntime.MemStats
		goruntime.ReadMemStats(&before)
		var done model.DoneResult
		for i := 0; i < *iterations; i++ {
			started := time.Now()
			for j := 0; j < *batch; j++ {
				done, issue = engine.RunGeneric(compiled.Session, request)
				if issue != nil {
					fail(fmt.Errorf("第%d组第%d次运行失败: %+v", i, j, issue))
				}
				if done.Summary.TargetFinalHp != baseline.Summary.TargetFinalHp || done.Summary.DurationMs != baseline.Summary.DurationMs || done.Summary.StopReason != baseline.Summary.StopReason {
					fail(fmt.Errorf("第%d组第%d次数值变化", i, j))
				}
			}
			elapsed := float64(time.Since(started)) / float64(time.Millisecond) / float64(*batch)
			samples = append(samples, elapsed)
		}
		goruntime.ReadMemStats(&after)
		if !reflect.DeepEqual(done.Summary, baseline.Summary) || !reflect.DeepEqual(done.FinalSnapshot, baseline.FinalSnapshot) {
			fail(fmt.Errorf("最终数值或状态变化"))
		}
		finalEncoded, err := json.Marshal(done)
		fail(err)
		if fmt.Sprintf("%x", sha256.Sum256(finalEncoded)) != digest {
			fail(fmt.Errorf("最终完整输出变化"))
		}
		cases = append(cases, map[string]any{"mode": name, "core": distribution(samples), "resultBytes": len(encoded), "resultSha256": digest,
			"allocatedBytesPerRun": float64(after.TotalAlloc-before.TotalAlloc) / (float64(*iterations) * float64(*batch)), "allocationsPerRun": float64(after.Mallocs-before.Mallocs) / (float64(*iterations) * float64(*batch)),
			"summary": baseline.Summary, "numericalStateVerified": true})
	}
	if *cpuProfile != "" {
		request := data.RunRequest
		request.OutputMode, request.Sampling.Disabled = model.RunOutputSummary, true
		writeAllocationProfile := func(path string) {
			file, err := os.Create(path)
			fail(err)
			fail(pprof.Lookup("allocs").WriteTo(file, 0))
			fail(file.Close())
		}
		goruntime.GC()
		writeAllocationProfile(*cpuProfile + ".allocs-before")
		file, err := os.Create(*cpuProfile)
		fail(err)
		fail(pprof.StartCPUProfile(file))
		for i := 0; i < 200; i++ {
			_, issue := engine.RunGeneric(compiled.Session, request)
			if issue != nil {
				fail(fmt.Errorf("性能采样失败: %+v", issue))
			}
		}
		pprof.StopCPUProfile()
		fail(file.Close())
		writeAllocationProfile(*cpuProfile + ".allocs-after")
	}
	report := map[string]any{"goVersion": goruntime.Version(), "goarch": goruntime.GOARCH, "gomaxprocs": 1, "iterations": *iterations, "warmup": *warmup, "runsPerSample": *batch,
		"timingNote": "batch大于1时，分布描述每组的单次平均耗时，不代表单次延迟分布；计时含逐次标量核对。",
		"scope":      "RunGeneric含初始化、数值执行与汇总；不含编译、请求解析、JSON编码和界面。summary不构造展示字典且关闭图表采样。", "cases": cases}
	reportBytes, err := json.MarshalIndent(report, "", "  ")
	fail(err)
	if *outputPath != "" {
		fail(os.WriteFile(*outputPath, reportBytes, 0644))
	}
	fmt.Println(string(reportBytes))
}
