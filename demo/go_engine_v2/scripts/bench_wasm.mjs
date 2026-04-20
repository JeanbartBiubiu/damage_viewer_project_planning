import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const wasmPath = path.join(dist, "go_engine_v2_demo.wasm");
const wasmExecPath = path.join(dist, "wasm_exec.js");

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

function printStats(label, samplesUs) {
  const sorted = [...samplesUs].sort((a, b) => a - b);
  const avgUs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  console.log(
    `${label} sample_count=${sorted.length} min_us=${sorted[0].toFixed(3)} p50_us=${percentile(sorted, 50).toFixed(3)} avg_us=${avgUs.toFixed(3)} p95_us=${percentile(sorted, 95).toFixed(3)} max_us=${sorted[sorted.length - 1].toFixed(3)}`
  );
}

const wasmExecSource = await fs.readFile(wasmExecPath, "utf8");
vm.runInThisContext(wasmExecSource, { filename: wasmExecPath });

const go = new Go();
const wasmBytes = await fs.readFile(wasmPath);
const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
go.run(instance);

await new Promise((resolve) => setTimeout(resolve, 0));

const api = globalThis.goEngineV2Demo;
if (!api) {
  throw new Error("goEngineV2Demo API not found");
}

const warmup = 20;
const samples = 200;

const firstStart = performance.now();
const firstPayload = JSON.parse(api.runBenchmarkBattle());
const firstUs = (performance.now() - firstStart) * 1000;

for (let i = 0; i < warmup; i += 1) {
  api.runBenchmarkBattle();
}

const runSamples = [];
for (let i = 0; i < samples; i += 1) {
  const start = performance.now();
  api.runBenchmarkBattle();
  runSamples.push((performance.now() - start) * 1000);
}

console.log("=== Go Engine V2 Demo Wasm Benchmark ===");
console.log(`host_call_first_us=${firstUs.toFixed(3)}`);
printStats("host_call_run_benchmark_battle", runSamples);

if (!firstPayload.ok) {
  throw new Error(firstPayload.error);
}

const summary = firstPayload.value;
console.log(
  `battle_summary final_time_ms=${summary.finalTimeMs} processed_events=${summary.processedEvents} stop=${summary.stopReason} self_hp=${summary.selfHp.toFixed(3)} enemy_hp=${summary.enemyHp.toFixed(3)} logs=${summary.logCount}`
);

const internalPayload = JSON.parse(api.measureBenchmark(20, 200));
if (!internalPayload.ok) {
  throw new Error(internalPayload.error);
}

console.log(`internal_init_first_us=${internalPayload.value.init.firstUs.toFixed(3)} internal_run_first_us=${internalPayload.value.run.firstUs.toFixed(3)}`);
console.log(`internal_init_avg_us=${internalPayload.value.init.avgUs.toFixed(3)} internal_run_avg_us=${internalPayload.value.run.avgUs.toFixed(3)}`);

process.exit(0);
