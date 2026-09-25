#!/usr/bin/env node
/**
 * Deterministic unit checks for path containment, porcelain parsing, signatures, and audit delta.
 * Run: node .agents/skills/cursor-local-agent/scripts/cursor_local_agent_path_policy.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_CURSOR_SDK_VERSION,
  REAL_RUN_SETTING_SOURCES,
  SMOKE_SETTING_SOURCES,
  calculateStartupRetryDelayMs,
  disposeAgent,
  isRetryableStartupError,
  parsePromptMode,
  startAgentRunWithRetry,
  toErrorObject,
  wrapStartupTerminalFailure,
} from "./cursor_local_agent_common.mjs";
import {
  buildPathSignatureMap,
  classifyChanges,
  classifyDeltaPaths,
  contentSignatureForPath,
  diffPathSignatures,
  isPathInside,
  isUnderAllowedPath,
  normalizeAllowedPaths,
  parseGitStatusPorcelainZ,
  parseGitStatusShort,
  resolveContainedPath,
  untrackedFileMetadata,
} from "./cursor_local_agent_path_policy.mjs";

const cwd = "C:\\project\\damage_viewer_project_planning";

function testContainment() {
  assert.equal(isPathInside(cwd, join(cwd, "AGENTS.md")), true);
  assert.equal(isPathInside(cwd, join(cwd, "docs", "a.md")), true);
  assert.equal(isPathInside(cwd, cwd), true);
  assert.equal(isPathInside(cwd, join(cwd, "..", "other")), false);
  assert.equal(isPathInside(cwd, "C:\\Windows\\System32"), false);
}

function testResolve() {
  const ok = resolveContainedPath(cwd, "文档记录");
  assert.equal(ok.relative, "文档记录");
  assert.throws(() => resolveContainedPath(cwd, "..\\damage_web_dev"), /escapes/);
  assert.throws(() => resolveContainedPath(cwd, ""), /non-empty/);
  assert.throws(() => normalizeAllowedPaths(cwd, []), /at least one/);
  const multi = normalizeAllowedPaths(cwd, ["AGENTS.md", "./AGENTS.md", "README.md"]);
  assert.equal(multi.length, 2);
}

function testChinesePathInScope() {
  assert.equal(isUnderAllowedPath("文档记录/详细设计/a.md", ["文档记录"]), true);
  assert.equal(isUnderAllowedPath("文档记录/详细设计/Cursor协同开发流程说明.md", ["文档记录"]), true);

  const entries = parseGitStatusShort("?? 文档记录/新文件.md\n");
  assert.equal(entries[0].relativePath, "文档记录/新文件.md");
  const { inScope, outsideScope } = classifyChanges(entries, ["文档记录"]);
  assert.equal(inScope.length, 1);
  assert.equal(outsideScope.length, 0);

  const z = Buffer.from("?? 文档记录/新文件.md\0", "utf8");
  const zEntries = parseGitStatusPorcelainZ(z);
  assert.equal(zEntries[0].relativePath, "文档记录/新文件.md");
  const classified = classifyChanges(zEntries, ["文档记录"]);
  assert.equal(classified.inScope.length, 1);
}

function testRenameBoundary() {
  const entries = parseGitStatusShort(
    ["R  web/src/a.ts -> 文档记录/a.ts", "R  文档记录/b.ts -> web/src/b.ts"].join("\n"),
  );
  assert.equal(entries[0].fromPath, "web/src/a.ts");
  assert.equal(entries[0].relativePath, "文档记录/a.ts");
  assert.deepEqual(entries[0].paths, ["web/src/a.ts", "文档记录/a.ts"]);

  const { inScope, outsideScope } = classifyChanges(entries, ["文档记录"]);
  assert.equal(inScope.length, 0);
  assert.equal(outsideScope.length, 2);

  // porcelain -z order: destination NUL source NUL
  const zRename = Buffer.concat([
    Buffer.from("R  文档记录/a.ts\0", "utf8"),
    Buffer.from("web/src/a.ts\0", "utf8"),
  ]);
  const zEntries = parseGitStatusPorcelainZ(zRename);
  assert.equal(zEntries.length, 1);
  assert.equal(zEntries[0].fromPath, "web/src/a.ts");
  assert.equal(zEntries[0].relativePath, "文档记录/a.ts");
  const zClassified = classifyChanges(zEntries, ["文档记录"]);
  assert.equal(zClassified.outsideScope.length, 1);
}

function testUntrackedMetadataOnly() {
  const root = mkdtempSync(join(tmpdir(), "cursor-path-policy-"));
  const rel = "文档记录/secret-ish.txt";
  mkdirSync(join(root, "文档记录"), { recursive: true });
  const body = "super-secret-token-do-not-copy";
  writeFileSync(join(root, rel), body, "utf8");
  const meta = untrackedFileMetadata(root, rel);
  assert.equal(meta.path, rel);
  assert.equal(meta.size, Buffer.byteLength(body));
  assert.equal(meta.sha256, createHash("sha256").update(body).digest("hex"));
  assert.equal(JSON.stringify(meta).includes("super-secret"), false);
}

function testSignatureDelta() {
  const root = mkdtempSync(join(tmpdir(), "cursor-path-policy-sig-"));
  mkdirSync(join(root, "文档记录"), { recursive: true });
  mkdirSync(join(root, "web", "src"), { recursive: true });
  writeFileSync(join(root, "web", "src", "preexisting.ts"), "v1", "utf8");
  writeFileSync(join(root, "文档记录", "in-scope.md"), "ok", "utf8");

  const beforeEntries = parseGitStatusShort(
    [" M web/src/preexisting.ts", " M 文档记录/in-scope.md"].join("\n"),
  );
  const beforeMap = buildPathSignatureMap(root, beforeEntries);

  // Unchanged pre-existing outside-scope dirt: same content signature.
  writeFileSync(join(root, "web", "src", "fresh.ts"), "new", "utf8");
  writeFileSync(join(root, "web", "src", "preexisting.ts"), "v2", "utf8");
  writeFileSync(join(root, "文档记录", "in-scope.md"), "ok2", "utf8");

  const afterEntries = parseGitStatusShort(
    [
      " M web/src/preexisting.ts",
      "?? web/src/fresh.ts",
      " M 文档记录/in-scope.md",
    ].join("\n"),
  );
  const afterMap = buildPathSignatureMap(root, afterEntries);
  const delta = diffPathSignatures(beforeMap, afterMap);
  const deltaPaths = delta.map((item) => item.path).sort();
  assert.deepEqual(deltaPaths, [
    "web/src/fresh.ts",
    "web/src/preexisting.ts",
    "文档记录/in-scope.md",
  ]);

  // Simulate unchanged outside dirt by restoring preexisting content and rebuilding after map.
  writeFileSync(join(root, "web", "src", "preexisting.ts"), "v1", "utf8");
  const afterUnchangedOutside = buildPathSignatureMap(
    root,
    parseGitStatusShort(
      [" M web/src/preexisting.ts", "?? web/src/fresh.ts", " M 文档记录/in-scope.md"].join("\n"),
    ),
  );
  // Force before/after status+content equal for preexisting by copying before signature.
  afterUnchangedOutside.set("web/src/preexisting.ts", beforeMap.get("web/src/preexisting.ts"));
  const delta2 = diffPathSignatures(beforeMap, afterUnchangedOutside);
  const outsideDelta = classifyDeltaPaths(delta2, ["文档记录"]).outsideScope.map((item) => item.path);
  assert.deepEqual(outsideDelta, ["web/src/fresh.ts"]);
  assert.equal(outsideDelta.includes("web/src/preexisting.ts"), false);

  // Newly changed outside-scope file fails.
  const failDelta = classifyDeltaPaths(delta, ["文档记录"]);
  assert.ok(failDelta.outsideScope.some((item) => item.path === "web/src/fresh.ts"));
  assert.ok(failDelta.outsideScope.some((item) => item.path === "web/src/preexisting.ts"));

  // Content signature marker for missing path.
  assert.equal(contentSignatureForPath(root, "no-such-file.txt"), "missing");
}

function testUnreadableFailsClosed() {
  const root = mkdtempSync(join(tmpdir(), "cursor-path-policy-unreadable-"));
  const rel = "文档记录/unreadable.bin";
  const io = {
    existsSync: () => true,
    statSync: () => {
      const err = new Error("EACCES: permission denied");
      err.code = "EACCES";
      throw err;
    },
    readFileSync: () => {
      throw new Error("should not read after stat failure");
    },
  };

  assert.throws(
    () => contentSignatureForPath(root, rel, io),
    /audited path unreadable/,
  );
  assert.throws(
    () => buildPathSignatureMap(root, parseGitStatusShort(` M ${rel}\n`), io),
    /audited path unreadable/,
  );

  // Missing remains a valid deletion marker (not an error signature).
  assert.equal(contentSignatureForPath(root, "文档记录/gone.txt"), "missing");
}

function testClassifyBasics() {
  assert.equal(isUnderAllowedPath("文档记录/a.md", ["文档记录"]), true);
  assert.equal(isUnderAllowedPath("web/src/a.ts", ["文档记录"]), false);
  assert.equal(isUnderAllowedPath("AGENTS.md", ["AGENTS.md"]), true);
  assert.equal(isUnderAllowedPath("tools/x.mjs", ["."]), true);

  const entries = parseGitStatusShort(
    [" M AGENTS.md", "?? 文档记录/new.md", " M web/src/a.ts", "R  old.md -> 文档记录/renamed.md"].join(
      "\n",
    ),
  );
  assert.equal(entries.length, 4);
  assert.equal(entries[3].relativePath, "文档记录/renamed.md");
  assert.equal(entries[3].fromPath, "old.md");

  const { inScope, outsideScope } = classifyChanges(entries, ["文档记录", "AGENTS.md"]);
  // rename old.md -> 文档记录/renamed.md crosses boundary because old.md is outside
  assert.equal(inScope.length, 2);
  assert.equal(outsideScope.length, 2);
  assert.ok(outsideScope.some((entry) => entry.relativePath === "web/src/a.ts"));
  assert.ok(outsideScope.some((entry) => entry.relativePath === "文档记录/renamed.md"));
}

function testSettingSourcesContract() {
  assert.deepEqual(REAL_RUN_SETTING_SOURCES, ["project"]);
  assert.deepEqual(SMOKE_SETTING_SOURCES, []);
  assert.equal(Object.isFrozen(REAL_RUN_SETTING_SOURCES), true);
  assert.equal(Object.isFrozen(SMOKE_SETTING_SOURCES), true);

  const realClone = [...REAL_RUN_SETTING_SOURCES];
  const smokeClone = [...SMOKE_SETTING_SOURCES];
  realClone.push("user");
  smokeClone.push("project");
  assert.deepEqual(REAL_RUN_SETTING_SOURCES, ["project"]);
  assert.deepEqual(SMOKE_SETTING_SOURCES, []);
  assert.deepEqual(realClone, ["project", "user"]);
  assert.deepEqual(smokeClone, ["project"]);
}

function testParsePromptMode() {
  assert.equal(parsePromptMode("MODE: DESIGN_REVIEW_ONLY\nbody"), "DESIGN_REVIEW_ONLY");
  assert.equal(parsePromptMode("MODE: IMPLEMENTATION\nbody"), "IMPLEMENTATION");
  assert.equal(parsePromptMode("MODE: DESIGN_REVIEW_ONLY\r\nbody"), "DESIGN_REVIEW_ONLY");
  assert.equal(parsePromptMode("MODE: IMPLEMENTATION\r\nbody"), "IMPLEMENTATION");
  assert.equal(parsePromptMode("\uFEFFMODE: DESIGN_REVIEW_ONLY\nbody"), "DESIGN_REVIEW_ONLY");
  assert.equal(parsePromptMode("\uFEFFMODE: IMPLEMENTATION\r\nbody"), "IMPLEMENTATION");

  assert.equal(parsePromptMode(" MODE: DESIGN_REVIEW_ONLY\n"), null);
  assert.equal(parsePromptMode("MODE: DESIGN_REVIEW_ONLY \n"), null);
  assert.equal(parsePromptMode("# MODE: DESIGN_REVIEW_ONLY\n"), null);
  assert.equal(parsePromptMode("MODE: DESIGN_REVIEW_ONLY // note\n"), null);
  assert.equal(parsePromptMode("hello\nMODE: IMPLEMENTATION\n"), null);
  assert.equal(parsePromptMode(""), null);
  assert.equal(parsePromptMode("MODE: UNKNOWN\n"), null);
}

function testToErrorObjectSafeFields() {
  const err = new Error("boom");
  err.name = "NetworkError";
  err.code = "UNAVAILABLE";
  err.isRetryable = true;
  err.protoErrorCode = 14;
  err.cause = { secret: "do-not-serialize" };
  const obj = toErrorObject(err);
  assert.equal(obj.name, "NetworkError");
  assert.equal(obj.message, "boom");
  assert.equal(obj.code, "UNAVAILABLE");
  assert.equal(obj.isRetryable, true);
  assert.equal(obj.protoErrorCode, 14);
  assert.equal(Object.hasOwn(obj, "cause"), false);
  assert.equal(JSON.stringify(obj).includes("do-not-serialize"), false);

  const plain = toErrorObject(new Error("x"));
  assert.equal(Object.hasOwn(plain, "isRetryable"), false);
  assert.equal(Object.hasOwn(plain, "protoErrorCode"), false);
  assert.equal(toErrorObject(null), null);
}

function testRetryClassificationAndBackoff() {
  assert.equal(isRetryableStartupError({ isRetryable: true, name: "NetworkError" }), true);
  assert.equal(isRetryableStartupError({ isRetryable: true, name: "RateLimitError" }), true);
  assert.equal(isRetryableStartupError({ isRetryable: false, name: "NetworkError" }), false);
  assert.equal(isRetryableStartupError({ isRetryable: true, name: "AuthenticationError" }), false);
  assert.equal(isRetryableStartupError({ isRetryable: true, name: "ConfigurationError" }), false);
  assert.equal(isRetryableStartupError({ name: "NetworkError" }), false);
  assert.equal(isRetryableStartupError(null), false);

  assert.equal(
    calculateStartupRetryDelayMs({
      attempt: 1,
      baseDelayMs: 1000,
      random: () => 0,
    }),
    1000,
  );
  assert.equal(
    calculateStartupRetryDelayMs({
      attempt: 2,
      baseDelayMs: 1000,
      random: () => 0.5,
    }),
    2000 + Math.floor(0.5 * 1001),
  );
  assert.equal(
    calculateStartupRetryDelayMs({
      attempt: 1,
      baseDelayMs: 1000,
      error: { name: "RateLimitError", isRetryable: true },
      random: () => 0,
    }),
    30000,
  );
  assert.equal(
    calculateStartupRetryDelayMs({
      attempt: 3,
      baseDelayMs: 1000,
      error: { name: "RateLimitError", isRetryable: true },
      random: () => 1,
    }),
    Math.max(4000 + 1000, 30000),
  );
}

async function testStartAgentRunWithRetrySuccessAfterTwoFailures() {
  const disposed = [];
  let createCount = 0;
  const logs = [];
  const result = await startAgentRunWithRetry({
    maxAttempts: 3,
    baseDelayMs: 10,
    sleep: async () => {},
    random: () => 0,
    log: (line) => logs.push(line),
    createAgent: async () => {
      createCount += 1;
      const id = `agent-${createCount}`;
      return {
        agentId: id,
        async [Symbol.asyncDispose]() {
          disposed.push(id);
        },
      };
    },
    send: async (agent) => {
      if (createCount < 3) {
        const err = new Error("transient");
        err.name = "NetworkError";
        err.isRetryable = true;
        throw err;
      }
      return { id: `run-for-${agent.agentId}`, requestId: "req-1" };
    },
  });

  assert.equal(createCount, 3);
  assert.equal(result.attemptsUsed, 3);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.disposedFailedAgents, 2);
  assert.deepEqual(disposed, ["agent-1", "agent-2"]);
  assert.equal(disposed.includes("agent-3"), false);
  assert.equal(result.run.id, "run-for-agent-3");
  assert.ok(logs.some((line) => line.startsWith("STARTUP_ATTEMPT=")));
  assert.ok(logs.some((line) => line.startsWith("STARTUP_RETRY_DELAY_MS=")));
  assert.ok(logs.some((line) => line === "STARTUP_ATTEMPTS_USED=3"));
}

async function testStartAgentRunWithRetryStopsOnAuthConfigNonRetryable() {
  for (const [name, isRetryable] of [
    ["AuthenticationError", true],
    ["ConfigurationError", true],
    ["UnknownAgentError", false],
  ]) {
    let createCount = 0;
    let threw = null;
    try {
      await startAgentRunWithRetry({
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: async () => {
          throw new Error("sleep should not run");
        },
        createAgent: async () => {
          createCount += 1;
          return { agentId: `a-${createCount}`, close() {} };
        },
        send: async () => {
          const err = new Error(name);
          err.name = name;
          err.isRetryable = isRetryable;
          throw err;
        },
      });
    } catch (error) {
      threw = error;
    }
    assert.equal(threw?.name, name);
    assert.equal(createCount, 1);
  }
}

async function testStartAgentRunWithRetryFrozenErrorDoesNotMutate() {
  const frozen = new Error("frozen-auth");
  frozen.name = "AuthenticationError";
  frozen.isRetryable = true;
  Object.freeze(frozen);
  assert.equal(Object.isFrozen(frozen), true);

  let threw = null;
  try {
    await startAgentRunWithRetry({
      maxAttempts: 3,
      baseDelayMs: 1,
      sleep: async () => {
        throw new Error("sleep should not run for AuthenticationError");
      },
      createAgent: async () => ({ agentId: "frozen-agent", close() {} }),
      send: async () => {
        throw frozen;
      },
    });
  } catch (error) {
    threw = error;
  }

  assert.ok(threw);
  assert.notEqual(threw?.name, "TypeError");
  assert.equal(threw instanceof TypeError, false);
  assert.equal(threw?.name, "AuthenticationError");
  assert.equal(threw?.message, "frozen-auth");
  assert.equal(threw?.startupAttemptsUsed, 1);
  assert.equal(Array.isArray(threw?.startupAttempts), true);
  assert.equal(threw?.startupAttempts.length, 1);
  assert.equal(threw?.disposedFailedAgents, 1);
  assert.equal(threw?.cause, frozen);
  assert.equal(Object.hasOwn(toErrorObject(threw), "cause"), false);

  // Original frozen error must remain unmodified.
  assert.equal(Object.hasOwn(frozen, "startupAttempts"), false);
  assert.equal(Object.hasOwn(frozen, "startupAttemptsUsed"), false);
  assert.equal(Object.hasOwn(frozen, "disposedFailedAgents"), false);
  assert.equal(frozen.name, "AuthenticationError");
  assert.equal(frozen.message, "frozen-auth");
}

function testSmokeStoreIsPerInvocation() {
  const smokeSource = readFileSync(
    fileURLToPath(new URL("./cursor_local_agent_smoke.mjs", import.meta.url)),
    "utf8",
  );
  // Must not use the historical fixed shared path (exact, no trailing hyphen).
  assert.equal(
    smokeSource.includes('join(tmpdir(), "cursor-sdk-local-agent-store")'),
    false,
  );
  assert.doesNotMatch(
    smokeSource,
    /new\s+JsonlLocalAgentStore\(\s*join\(\s*tmpdir\(\)\s*,\s*"cursor-sdk-local-agent-store"\s*\)\s*\)/,
  );
  // Supports --out-dir branch and unique-temp branch; retains summary.storePath.
  assert.match(smokeSource, /join\(args\.outDir,\s*"sdk-local-agent-store"\)/);
  assert.match(smokeSource, /mkdtempSync\(\s*join\(\s*tmpdir\(\)\s*,\s*"cursor-sdk-local-agent-store-"\s*\)\s*\)/);
  assert.match(smokeSource, /summary\.storePath\s*=/);
}

function testSmokeRejectsNonFinishedRunResult() {
  const smokeSource = readFileSync(
    fileURLToPath(new URL("./cursor_local_agent_smoke.mjs", import.meta.url)),
    "utf8",
  );
  // Source: after RunResult evidence, non-finished statuses throw a named error.
  assert.match(smokeSource, /RESULT_STATUS=\$\{result\.status\}/);
  assert.match(smokeSource, /RUN_RESULT=\$\{JSON\.stringify\(result\)\}/);
  assert.match(smokeSource, /result\.status !== "finished"/);
  assert.match(smokeSource, /RunResultNotFinishedError/);
  assert.match(smokeSource, /RunResult\.status=\$\{result\.status\} is not finished/);

  // Logic: finished succeeds; every other terminal status rejects with the actual status in message.
  function requireFinished(status) {
    if (status !== "finished") {
      const err = new Error(`RunResult.status=${status} is not finished`);
      err.name = "RunResultNotFinishedError";
      throw err;
    }
  }
  assert.doesNotThrow(() => requireFinished("finished"));
  for (const status of ["error", "cancelled", "expired", "unknown"]) {
    assert.throws(
      () => requireFinished(status),
      (err) =>
        err?.name === "RunResultNotFinishedError" &&
        String(err.message).includes(status),
    );
  }
}

function testWrapStartupTerminalFailurePreservesSafeFields() {
  const original = new Error("auth-denied");
  original.name = "AuthenticationError";
  original.code = "UNAUTHENTICATED";
  original.isRetryable = false;
  original.protoErrorCode = 16;
  original.stack = "AuthenticationError: auth-denied\n    at test";
  Object.freeze(original);

  const wrapped = wrapStartupTerminalFailure(original, {
    startupAttempts: [{ attempt: 1 }],
    startupAttemptsUsed: 1,
    disposedFailedAgents: 0,
  });
  assert.equal(wrapped.name, "AuthenticationError");
  assert.equal(wrapped.message, "auth-denied");
  assert.equal(wrapped.code, "UNAUTHENTICATED");
  assert.equal(wrapped.isRetryable, false);
  assert.equal(wrapped.protoErrorCode, 16);
  assert.equal(wrapped.stack, original.stack);
  assert.equal(wrapped.cause, original);
  assert.equal(wrapped.startupAttemptsUsed, 1);
  assert.equal(Object.hasOwn(toErrorObject(wrapped), "cause"), false);
  assert.equal(Object.hasOwn(original, "startupAttempts"), false);
}

async function testDisposeAgentPrefersAsyncDispose() {
  const calls = [];
  const withAsync = {
    close() {
      calls.push("close");
    },
    async [Symbol.asyncDispose]() {
      calls.push("asyncDispose");
    },
  };
  const disposal = await disposeAgent(withAsync);
  assert.equal(disposal.method, "asyncDispose");
  assert.deepEqual(calls, ["asyncDispose"]);

  const closeOnly = {
    close() {
      calls.push("close-only");
    },
  };
  const disposal2 = await disposeAgent(closeOnly);
  assert.equal(disposal2.method, "close");
  assert.ok(calls.includes("close-only"));

  assert.deepEqual(await disposeAgent(null), { method: null });
}

function testRunLevelFailureNotInStartupRetryPath() {
  const runSource = readFileSync(fileURLToPath(new URL("./cursor_local_agent_run.mjs", import.meta.url)), "utf8");
  assert.match(runSource, /result\.status !== "finished"/);
  assert.match(runSource, /failurePhase === "startup" && !summary\.runId/);
  assert.match(runSource, /no-replay/);
  assert.match(runSource, /audit\.failClosed/);
  assert.match(runSource, /process\.exit\(2\)/);
  assert.match(runSource, /disposeAgent/);
  assert.match(runSource, /startAgentRunWithRetry/);
  // Terminal RunResult failure must be classified as run phase, not fed to startup retry.
  assert.match(runSource, /summary\.failurePhase = "run"/);
  assert.equal(EXPECTED_CURSOR_SDK_VERSION, "1.0.32");
}

testContainment();
testResolve();
testClassifyBasics();
testChinesePathInScope();
testRenameBoundary();
testUntrackedMetadataOnly();
testSignatureDelta();
testUnreadableFailsClosed();
testSettingSourcesContract();
testParsePromptMode();
testToErrorObjectSafeFields();
testRetryClassificationAndBackoff();
testRunLevelFailureNotInStartupRetryPath();

testSmokeStoreIsPerInvocation();
testSmokeRejectsNonFinishedRunResult();
testWrapStartupTerminalFailurePreservesSafeFields();

await testStartAgentRunWithRetrySuccessAfterTwoFailures();
await testStartAgentRunWithRetryStopsOnAuthConfigNonRetryable();
await testStartAgentRunWithRetryFrozenErrorDoesNotMutate();
await testDisposeAgentPrefersAsyncDispose();
console.log("cursor_local_agent_path_policy.test.mjs: PASS");
