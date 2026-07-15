// Node smoke：对 dist/tinygo_engine_v2.wasm 做 canonical generic ABI round-trip。
// 非正式宿主（正式宿主为浏览器 Worker）；使用 generic_p0_basic_damage.json，不修改 fixture。
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileCanonicalSession,
  instantiateGenericHost,
  loadCanonicalFixture,
  moduleRoot,
  releaseCanonicalSession,
  runCanonicalSession,
  withTimeout,
} from "./generic-abi-host.mjs";

function parseArgs(argv) {
  const args = {
    wasm: resolve(moduleRoot, "dist", "tinygo_engine_v2.wasm"),
    instantiateTimeoutMs: 30000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--wasm") {
      args.wasm = resolve(moduleRoot, argv[++i]);
    } else if (arg === "--instantiate-timeout-ms" || arg === "--timeout-ms") {
      // --timeout-ms is a backward-compatible alias for --instantiate-timeout-ms
      args.instantiateTimeoutMs = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.instantiateTimeoutMs) || args.instantiateTimeoutMs < 1) {
    throw new Error("--instantiate-timeout-ms must be a positive number");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-node.mjs [--wasm dist/tinygo_engine_v2.wasm] [--instantiate-timeout-ms 30000]

Instantiates the TinyGo wasm module and runs a compile -> run -> release round-trip
against internal/testkit/fixtures/generic_p0_basic_damage.json.

--instantiate-timeout-ms soft-timeout covers instantiation/runtime startup only, not
synchronous compile/run/release. --timeout-ms is a documented backward-compatible alias.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.wasm)) {
    throw new Error(`Wasm artifact not found: ${args.wasm}`);
  }

  const fixture = loadCanonicalFixture();
  const host = await withTimeout(
    instantiateGenericHost(args.wasm),
    args.instantiateTimeoutMs,
    "instantiate"
  );

  console.log(`smoke: instantiated ${args.wasm}`);
  console.log(`smoke: size_bytes=${host.sizeBytes}`);
  console.log(`smoke: fixture=${fixture.name}`);
  console.log("smoke: canonical exports present");

  const compiled = compileCanonicalSession(host.exports, fixture);
  console.log(`smoke: compile ok sessionId=${compiled.sessionId} rulesHash=${compiled.rulesHash}`);

  const done = runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
  console.log(
    `smoke: run ok targetFinalHp=${done.summary.targetFinalHp} casts=${done.summary.abilityCastCount}`
  );

  const released = releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
  console.log(`smoke: release ok sessionId=${released.sessionId} released=${released.released}`);
  console.log("smoke: generic ABI round-trip passed");
}

try {
  await main();
} catch (error) {
  console.error(`smoke: FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
