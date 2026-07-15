// Node benchmark：instantiate 开销或 generic ABI engine_run 延迟。
// 非正式宿主；结果不代表浏览器 Worker 口径。
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import {
  compileCanonicalSession,
  instantiateGenericHost,
  loadCanonicalFixture,
  loadGoRuntime,
  moduleRoot,
  releaseCanonicalSession,
  runCanonicalSession,
} from "./generic-abi-host.mjs";

function parseArgs(argv) {
  const args = {
    wasm: resolve(moduleRoot, "dist", "tinygo_engine_v2.wasm"),
    iterations: 10,
    warmup: 2,
    mode: "instantiate_precompiled",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--wasm") {
      args.wasm = resolve(moduleRoot, argv[++i]);
    } else if (arg === "--iterations") {
      args.iterations = Number(argv[++i]);
    } else if (arg === "--warmup") {
      args.warmup = Number(argv[++i]);
    } else if (arg === "--compile-each") {
      args.mode = "compile_and_instantiate";
    } else if (arg === "--mode") {
      args.mode = argv[++i];
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.iterations) || args.iterations < 1) {
    throw new Error("--iterations must be a positive integer");
  }
  if (!Number.isInteger(args.warmup) || args.warmup < 0) {
    throw new Error("--warmup must be a non-negative integer");
  }

  const allowedModes = new Set(["instantiate_precompiled", "compile_and_instantiate", "generic-run"]);
  if (!allowedModes.has(args.mode)) {
    throw new Error(`--mode must be one of: ${[...allowedModes].join(", ")}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/bench-node.mjs [--wasm dist/tinygo_engine_v2.wasm] [--mode instantiate_precompiled|compile_and_instantiate|generic-run] [--iterations 10] [--warmup 2] [--compile-each] [--json]

Modes:
  instantiate_precompiled   measure WebAssembly.instantiate of a precompiled module (default)
  compile_and_instantiate   measure compile+instantiate each iteration (--compile-each)
  generic-run               compile once, then measure engine_run against generic_p0_basic_damage.json`);
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    min_ms: sorted[0],
    mean_ms: total / sorted.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    max_ms: sorted[sorted.length - 1],
  };
}

async function benchInstantiate(args) {
  loadGoRuntime();
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(args.wasm);
  const compiledModule = args.mode === "compile_and_instantiate" ? null : await WebAssembly.compile(bytes);
  const totalRuns = args.warmup + args.iterations;
  const samples = [];

  for (let i = 0; i < totalRuns; i += 1) {
    const go = new globalThis.Go();
    const start = performance.now();

    if (args.mode === "compile_and_instantiate") {
      const module = await WebAssembly.compile(bytes);
      await WebAssembly.instantiate(module, go.importObject);
    } else {
      await WebAssembly.instantiate(compiledModule, go.importObject);
    }

    const elapsed = performance.now() - start;
    if (i >= args.warmup) {
      samples.push(elapsed);
    }
  }

  return {
    wasm: args.wasm,
    size_bytes: bytes.byteLength,
    iterations: args.iterations,
    warmup: args.warmup,
    mode: args.mode,
    ...summarize(samples),
  };
}

async function benchGenericRun(args) {
  const fixture = loadCanonicalFixture();
  const host = await instantiateGenericHost(args.wasm);
  const compiled = compileCanonicalSession(host.exports, fixture);
  const totalRuns = args.warmup + args.iterations;
  const samples = [];

  for (let i = 0; i < totalRuns; i += 1) {
    const start = performance.now();
    runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
    const elapsed = performance.now() - start;
    if (i >= args.warmup) {
      samples.push(elapsed);
    }
  }

  releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);

  return {
    wasm: args.wasm,
    size_bytes: host.sizeBytes,
    iterations: args.iterations,
    warmup: args.warmup,
    mode: "generic-run",
    fixture: fixture.name,
    sessionId: compiled.sessionId,
    rulesHash: compiled.rulesHash,
    ...summarize(samples),
  };
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.wasm)) {
  throw new Error(`Wasm artifact not found: ${args.wasm}`);
}

const report = args.mode === "generic-run" ? await benchGenericRun(args) : await benchInstantiate(args);

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`bench: ${report.mode}`);
  console.log(`bench: wasm=${report.wasm}`);
  console.log(`bench: size_bytes=${report.size_bytes}`);
  if (report.fixture) {
    console.log(`bench: fixture=${report.fixture}`);
  }
  console.log(`bench: iterations=${report.iterations} warmup=${report.warmup}`);
  console.log(
    `bench: min=${report.min_ms.toFixed(3)}ms mean=${report.mean_ms.toFixed(3)}ms p50=${report.p50_ms.toFixed(3)}ms p95=${report.p95_ms.toFixed(3)}ms max=${report.max_ms.toFixed(3)}ms`
  );
}
