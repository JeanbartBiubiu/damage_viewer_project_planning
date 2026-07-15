// Shared TinyGo generic ABI host helpers for Node smoke/bench.
// Not a formal Worker host; mirrors frame/outbox conventions used by web TinyGoV2Bridge.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const moduleRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(moduleRoot, "..", "..");
const projectRoot = resolve(workspaceRoot, "..");

export const MAGIC = 0x32475644;
export const SCHEMA_VERSION = 1;
export const HEADER_LEN = 16;

export const FRAME_GENERIC_COMPILE = 200;
export const FRAME_GENERIC_RUN = 201;
export const FRAME_GENERIC_RELEASE_SESSION = 202;

export const OUTBOX_GENERIC_COMPILE_RESULT = 210;
export const OUTBOX_GENERIC_DONE = 211;
export const OUTBOX_GENERIC_ERROR = 212;
export const OUTBOX_GENERIC_RELEASE_RESULT = 214;

export const CANONICAL_FIXTURE_NAME = "generic_p0_basic_damage.json";
export const CANONICAL_FIXTURE_PATH = resolve(
  moduleRoot,
  "internal",
  "testkit",
  "fixtures",
  CANONICAL_FIXTURE_NAME
);

export const CANONICAL_EXPORTS = [
  "memory",
  "alloc",
  "dealloc",
  "engine_compile",
  "engine_run",
  "engine_release_session",
  "engine_outbox_ptr",
  "engine_outbox_len",
  "engine_outbox_clear",
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function findWasmExec() {
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
    // Caller can still provide TINYGO_WASM_EXEC explicitly.
  }

  for (const candidate of candidates) {
    const fullPath = isAbsolute(candidate) ? candidate : resolve(moduleRoot, candidate);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  throw new Error(
    "Could not find TinyGo wasm_exec.js. Set TINYGO_WASM_EXEC, keep the repo-local .tools TinyGo bundle, or install tinygo on PATH (fallback: C:\\project\\tinygo0.40.1)."
  );
}

export function loadGoRuntime() {
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

export function encodeFrame(kind, payloadBytes) {
  const frame = new Uint8Array(HEADER_LEN + payloadBytes.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, SCHEMA_VERSION, true);
  view.setUint16(6, kind, true);
  view.setUint32(8, 0, true);
  view.setUint32(12, payloadBytes.length, true);
  frame.set(payloadBytes, HEADER_LEN);
  return frame;
}

export function decodeFrames(bytes) {
  const frames = [];
  let offset = 0;
  while (offset + HEADER_LEN <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, HEADER_LEN);
    if (view.getUint32(0, true) !== MAGIC) {
      throw new Error("outbox frame has invalid magic");
    }
    const schemaVersion = view.getUint16(4, true);
    if (schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`outbox frame has unsupported schema version: ${schemaVersion}`);
    }
    const payloadLen = view.getUint32(12, true);
    const end = offset + HEADER_LEN + payloadLen;
    if (end > bytes.length) {
      throw new Error("outbox frame is truncated");
    }
    frames.push({
      schemaVersion,
      kind: view.getUint16(6, true),
      flags: view.getUint32(8, true),
      payload: bytes.slice(offset + HEADER_LEN, end),
    });
    offset = end;
  }
  if (offset !== bytes.length) {
    throw new Error(`outbox has trailing fragment of ${bytes.length - offset} byte(s)`);
  }
  return frames;
}

export function decodeFramePayload(frame) {
  return JSON.parse(textDecoder.decode(frame.payload));
}

export function loadCanonicalFixture() {
  if (!existsSync(CANONICAL_FIXTURE_PATH)) {
    throw new Error(`Canonical fixture missing: ${CANONICAL_FIXTURE_PATH}`);
  }
  return JSON.parse(readFileSync(CANONICAL_FIXTURE_PATH, "utf8"));
}

export function assertCanonicalExports(exports) {
  const record = exports;
  const missing = CANONICAL_EXPORTS.filter((name) => record[name] === undefined);
  const invalid = CANONICAL_EXPORTS.filter((name) => {
    if (name === "memory") {
      return !(record[name] instanceof WebAssembly.Memory);
    }
    return typeof record[name] !== "function";
  });
  if (missing.length || invalid.length) {
    throw new Error(
      `generic ABI export mismatch. Missing: ${missing.join(", ") || "none"}. Invalid: ${invalid.join(", ") || "none"}.`
    );
  }
}

export async function instantiateGenericHost(wasmPath) {
  loadGoRuntime();
  const bytes = readFileSync(wasmPath);
  const go = new globalThis.Go();
  const result = await WebAssembly.instantiate(bytes, go.importObject);
  const instance = result.instance ?? result;
  // TinyGo main() returns immediately inside _start. wasm_exec go.run stays pending
  // until proc_exit, so race a resolved promise: await sync runtime startup only —
  // not a full exit / round-trip watchdog.
  await Promise.race([go.run(instance), Promise.resolve()]);
  assertCanonicalExports(instance.exports);
  return {
    bytes,
    instance,
    exports: instance.exports,
    sizeBytes: bytes.byteLength,
  };
}

export function readOutbox(exports) {
  const ptr = exports.engine_outbox_ptr();
  const len = exports.engine_outbox_len();
  if (!ptr || len <= 0) {
    return [];
  }
  const copy = new Uint8Array(new Uint8Array(exports.memory.buffer, ptr, len));
  exports.engine_outbox_clear();
  return decodeFrames(copy);
}

function formatFrames(frames) {
  if (!frames.length) {
    return "";
  }
  return `: ${frames
    .map((frame) => {
      try {
        return textDecoder.decode(frame.payload);
      } catch {
        return `kind_${frame.kind}`;
      }
    })
    .join(" | ")}`;
}

export function invokeFrame(exports, fnName, kind, payload) {
  const fn = exports[fnName];
  if (typeof fn !== "function") {
    throw new Error(`export missing: ${fnName}`);
  }
  const payloadBytes = textEncoder.encode(JSON.stringify(payload));
  const frame = encodeFrame(kind, payloadBytes);
  const ptr = exports.alloc(frame.length);
  if (!ptr) {
    throw new Error(`alloc(${frame.length}) returned 0`);
  }
  let code = -1;
  try {
    new Uint8Array(exports.memory.buffer, ptr, frame.length).set(frame);
    code = fn(ptr, frame.length);
  } finally {
    exports.dealloc(ptr, frame.length);
  }
  const frames = readOutbox(exports);
  if (code !== 0) {
    throw new Error(`${fnName} returned ${code}${formatFrames(frames)}`);
  }
  return frames;
}

export function lastFrameOfKind(frames, kind) {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frames[i].kind === kind) {
      return frames[i];
    }
  }
  return null;
}

export function requireFramePayload(frames, kind, label) {
  const frame = lastFrameOfKind(frames, kind);
  if (!frame) {
    throw new Error(`missing ${label} frame (kind=${kind})${formatFrames(frames)}`);
  }
  if (lastFrameOfKind(frames, OUTBOX_GENERIC_ERROR)) {
    const err = decodeFramePayload(lastFrameOfKind(frames, OUTBOX_GENERIC_ERROR));
    throw new Error(`${label}: unexpected generic error frame: ${JSON.stringify(err)}`);
  }
  return decodeFramePayload(frame);
}

export function validateExpectedSummarySubset(summary, expectedSubset) {
  if (!summary || typeof summary !== "object") {
    throw new Error("done.summary missing");
  }
  for (const [key, want] of Object.entries(expectedSubset || {})) {
    const got = summary[key];
    if (got !== want) {
      throw new Error(`summary.${key}=${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
  }
}

export function compileCanonicalSession(exports, fixture) {
  const frames = invokeFrame(exports, "engine_compile", FRAME_GENERIC_COMPILE, fixture.compileRequest);
  const result = requireFramePayload(frames, OUTBOX_GENERIC_COMPILE_RESULT, "compile_result");
  if (result.ok !== true) {
    throw new Error(`compile ok=false: ${JSON.stringify(result)}`);
  }
  if (!result.sessionId) {
    throw new Error(`compile sessionId empty: ${JSON.stringify(result)}`);
  }
  if (result.rulesHash !== fixture.compileRequest.rulesHash) {
    throw new Error(
      `compile rulesHash=${JSON.stringify(result.rulesHash)} want ${JSON.stringify(fixture.compileRequest.rulesHash)}`
    );
  }
  return result;
}

export function runCanonicalSession(exports, fixture, sessionId, expectedRulesHash) {
  const runRequest = {
    ...fixture.runRequest,
    sessionId,
    expectedRulesHash,
  };
  const frames = invokeFrame(exports, "engine_run", FRAME_GENERIC_RUN, runRequest);
  const done = requireFramePayload(frames, OUTBOX_GENERIC_DONE, "generic done");
  if (done.ok !== true) {
    throw new Error(`done.ok=false: ${JSON.stringify(done)}`);
  }
  validateExpectedSummarySubset(done.summary, fixture.expectedSummarySubset);
  return done;
}

export function releaseCanonicalSession(exports, sessionId, expectedRulesHash) {
  const frames = invokeFrame(exports, "engine_release_session", FRAME_GENERIC_RELEASE_SESSION, {
    sessionId,
    expectedRulesHash,
  });
  const result = requireFramePayload(frames, OUTBOX_GENERIC_RELEASE_RESULT, "release_result");
  if (result.ok !== true || result.released !== true || result.sessionId !== sessionId) {
    throw new Error(`release_result unexpected: ${JSON.stringify(result)}`);
  }
  return result;
}

export async function withTimeout(promise, timeoutMs, label = "operation") {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    clearTimeout(timeout);
  }
}
