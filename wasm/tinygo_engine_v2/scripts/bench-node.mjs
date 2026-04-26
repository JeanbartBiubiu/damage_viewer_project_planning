import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(scriptDir, "..");

function parseArgs(argv) {
  const args = {
    wasm: resolve(moduleRoot, "dist", "tinygo_engine_v2.wasm"),
    iterations: 10,
    warmup: 2,
    compileEach: false,
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
      args.compileEach = true;
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

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/bench-node.mjs [--wasm dist/tinygo_engine_v2.wasm] [--iterations 10] [--warmup 2] [--compile-each] [--json]

Measures Node WebAssembly compile/instantiate overhead without running the TinyGo main function.`);
}

function findWasmExec() {
  const candidates = [];

  if (process.env.TINYGO_WASM_EXEC) {
    candidates.push(process.env.TINYGO_WASM_EXEC);
  }

  try {
    const tinygoRoot = execFileSync("tinygo", ["env", "TINYGOROOT"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (tinygoRoot) {
      candidates.push(resolve(tinygoRoot, "targets", "wasm_exec.js"));
    }
  } catch {
    // The caller can still provide TINYGO_WASM_EXEC explicitly.
  }

  for (const candidate of candidates) {
    const fullPath = isAbsolute(candidate) ? candidate : resolve(moduleRoot, candidate);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  throw new Error("Could not find TinyGo wasm_exec.js. Set TINYGO_WASM_EXEC or install tinygo on PATH.");
}

function loadGoRuntime() {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
  }

  const wasmExecPath = findWasmExec();
  const source = readFileSync(wasmExecPath, "utf8");
  vm.runInThisContext(source, { filename: wasmExecPath });

  if (typeof globalThis.Go !== "function") {
    throw new Error(`TinyGo wasm_exec.js did not define globalThis.Go: ${wasmExecPath}`);
  }
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

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.wasm)) {
  throw new Error(`Wasm artifact not found: ${args.wasm}`);
}

loadGoRuntime();

const bytes = readFileSync(args.wasm);
const compiledModule = args.compileEach ? null : await WebAssembly.compile(bytes);
const totalRuns = args.warmup + args.iterations;
const samples = [];

for (let i = 0; i < totalRuns; i += 1) {
  const go = new globalThis.Go();
  const start = performance.now();

  if (args.compileEach) {
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

const report = {
  wasm: args.wasm,
  size_bytes: bytes.byteLength,
  iterations: args.iterations,
  warmup: args.warmup,
  mode: args.compileEach ? "compile_and_instantiate" : "instantiate_precompiled",
  ...summarize(samples),
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`bench: ${report.mode}`);
  console.log(`bench: wasm=${report.wasm}`);
  console.log(`bench: size_bytes=${report.size_bytes}`);
  console.log(`bench: iterations=${report.iterations} warmup=${report.warmup}`);
  console.log(`bench: min=${report.min_ms.toFixed(3)}ms mean=${report.mean_ms.toFixed(3)}ms p50=${report.p50_ms.toFixed(3)}ms p95=${report.p95_ms.toFixed(3)}ms max=${report.max_ms.toFixed(3)}ms`);
}
