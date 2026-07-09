// Node smoke：实例化 dist/tinygo_engine_v2.wasm 并检查导出函数是否存在。
// 非正式宿主（正式宿主为浏览器 Worker）；默认不做完整 ABI round-trip，仅验证 load/instantiate。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(moduleRoot, "..", "..");
const projectRoot = resolve(workspaceRoot, "..");

function parseArgs(argv) {
  const args = {
    wasm: resolve(moduleRoot, "dist", "tinygo_engine_v2.wasm"),
    run: false,
    timeoutMs: 5000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--wasm") {
      args.wasm = resolve(moduleRoot, argv[++i]);
    } else if (arg === "--run") {
      args.run = true;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-node.mjs [--wasm dist/tinygo_engine_v2.wasm] [--run] [--timeout-ms 5000]

Loads the TinyGo wasm module with TinyGo's wasm_exec.js import object.
By default it compiles and instantiates only. Use --run when the entrypoint is expected to return.`);
}

function findWasmExec() {
  const candidates = [];

  if (process.env.TINYGO_WASM_EXEC) {
    candidates.push(process.env.TINYGO_WASM_EXEC);
  }

  candidates.push(
    resolve(workspaceRoot, ".tools", "tinygo0.40.1", "tinygo", "targets", "wasm_exec.js"),
    resolve(projectRoot, "tinygo0.40.1", "tinygo", "targets", "wasm_exec.js")
  );

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

  throw new Error(
    "Could not find TinyGo wasm_exec.js. Set TINYGO_WASM_EXEC, keep the repo-local .tools TinyGo bundle, or install tinygo on PATH."
  );
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

async function withTimeout(promise, timeoutMs) {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timer]);
  } finally {
    clearTimeout(timeout);
  }
}

const legacyExports = [
  "alloc",
  "dealloc",
  "engine_init",
  "engine_snapshot_initial",
  "engine_snapshot_actions_initial",
  "engine_begin_run",
  "engine_step",
  "engine_abort_run",
  "engine_outbox_ptr",
  "engine_outbox_len",
  "engine_outbox_clear",
];

const genericExports = [
  "engine_compile",
  "engine_run",
  "engine_release_session",
];

function assertExportsPresent(exportsList, required, label) {
  const missing = required.filter((name) => !exportsList.includes(name));
  if (missing.length > 0) {
    throw new Error(`smoke: missing ${label} exports: ${missing.join(", ")}`);
  }
  console.log(`smoke: ${label} exports present (${required.length})`);
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.wasm)) {
  throw new Error(`Wasm artifact not found: ${args.wasm}`);
}

loadGoRuntime();

const bytes = readFileSync(args.wasm);
const go = new globalThis.Go();
const result = await WebAssembly.instantiate(bytes, go.importObject);
const instance = result.instance ?? result;
const exportsList = Object.keys(instance.exports).sort();

console.log(`smoke: instantiated ${args.wasm}`);
console.log(`smoke: size_bytes=${bytes.byteLength}`);
console.log(`smoke: exports=${exportsList.length ? exportsList.join(",") : "(none)"}`);

assertExportsPresent(exportsList, legacyExports, "legacy");
assertExportsPresent(exportsList, genericExports, "generic");

if (args.run) {
  await withTimeout(go.run(instance), args.timeoutMs);
  console.log("smoke: runtime returned");
}
