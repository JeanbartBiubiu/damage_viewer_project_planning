import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

export const MODEL = {
  id: "grok-4.6",
  params: [
    { id: "effort", value: "high" },
    { id: "fast", value: "false" },
  ],
};

/** Requested SDK ambient setting sources for real local runs (immutable). */
export const REAL_RUN_SETTING_SOURCES = Object.freeze(["project"]);

/** Requested SDK ambient setting sources for smoke (immutable; isolated). */
export const SMOKE_SETTING_SOURCES = Object.freeze([]);

/** Exact shared-cache pin / expected @cursor/sdk version. */
export const EXPECTED_CURSOR_SDK_VERSION = "1.0.24";

const SHARED_SDK_CACHE_DIR = join(tmpdir(), "cursor-sdk-smoke-deps");

export function readUserEnv(name) {
  if (process.platform !== "win32") return "";
  try {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','User'))`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

export function getApiKey() {
  return (
    process.env.CURSOR_API_KEY ||
    process.env.cursor_api_key ||
    readUserEnv("CURSOR_API_KEY") ||
    readUserEnv("cursor_api_key")
  );
}

function readSdkPackageMeta(resolvedPath) {
  let dir = dirname(resolvedPath);
  for (let i = 0; i < 8; i += 1) {
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
        if (pkg?.name === "@cursor/sdk") {
          return {
            packageJsonPath,
            actualVersion: typeof pkg.version === "string" ? pkg.version : null,
          };
        }
      } catch {
        // Continue walking upward.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { packageJsonPath: null, actualVersion: null };
}

function installSharedSdkCache() {
  mkdirSync(SHARED_SDK_CACHE_DIR, { recursive: true });
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(
    npmBin,
    ["install", "--prefix", SHARED_SDK_CACHE_DIR, `@cursor/sdk@${EXPECTED_CURSOR_SDK_VERSION}`, "--silent"],
    { stdio: "inherit" },
  );
}

/**
 * Resolve @cursor/sdk. Repo-local resolution is allowed; shared temp cache is
 * reinstalled when missing or when package.json version mismatches the pin.
 * @returns {{ path: string, source: "repo-local"|"shared-cache", actualVersion: string|null, expectedVersion: string, versionMatch: boolean }}
 */
export function ensureSdkPackage(baseCwd) {
  for (const root of [baseCwd, process.cwd()]) {
    if (!root) continue;
    try {
      const fromRoot = createRequire(join(root, "package.json"));
      const resolved = fromRoot.resolve("@cursor/sdk");
      const meta = readSdkPackageMeta(resolved);
      return {
        path: resolved,
        source: "repo-local",
        actualVersion: meta.actualVersion,
        expectedVersion: EXPECTED_CURSOR_SDK_VERSION,
        versionMatch: meta.actualVersion === EXPECTED_CURSOR_SDK_VERSION,
      };
    } catch {
      // Try the next resolution root.
    }
  }

  const pkgJsonPath = join(SHARED_SDK_CACHE_DIR, "node_modules", "@cursor", "sdk", "package.json");
  let cachedVersion = null;
  if (existsSync(pkgJsonPath)) {
    try {
      cachedVersion = JSON.parse(readFileSync(pkgJsonPath, "utf8")).version ?? null;
    } catch {
      cachedVersion = null;
    }
  }
  if (!cachedVersion || cachedVersion !== EXPECTED_CURSOR_SDK_VERSION) {
    installSharedSdkCache();
  }

  const resolved = createRequire(join(SHARED_SDK_CACHE_DIR, "package.json")).resolve("@cursor/sdk");
  const meta = readSdkPackageMeta(resolved);
  return {
    path: resolved,
    source: "shared-cache",
    actualVersion: meta.actualVersion,
    expectedVersion: EXPECTED_CURSOR_SDK_VERSION,
    versionMatch: meta.actualVersion === EXPECTED_CURSOR_SDK_VERSION,
  };
}

export function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function writeJson(filePath, value) {
  ensureParentDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(filePath, value) {
  ensureParentDir(filePath);
  writeFileSync(filePath, value, "utf8");
}

export function appendJsonLine(filePath, value) {
  ensureParentDir(filePath);
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export function toErrorObject(error) {
  if (!error) return null;
  const out = {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code,
    stack: error?.stack,
  };
  if (typeof error?.isRetryable === "boolean") {
    out.isRetryable = error.isRetryable;
  }
  if (error?.protoErrorCode !== undefined && error?.protoErrorCode !== null) {
    out.protoErrorCode = error.protoErrorCode;
  }
  // Never serialize cause (may contain secrets / nested Connect payloads).
  return out;
}

/**
 * Parse the required MODE line from a real-run prompt.
 * Removes only an initial UTF-8 BOM and a trailing CR from the first physical line.
 * Does not trim spaces or accept comments/extra text.
 * @returns {"DESIGN_REVIEW_ONLY"|"IMPLEMENTATION"|null}
 */
export function parsePromptMode(promptText) {
  let text = promptText ?? "";
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const newlineIdx = text.indexOf("\n");
  let firstLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx);
  if (firstLine.endsWith("\r")) {
    firstLine = firstLine.slice(0, -1);
  }
  if (firstLine === "MODE: DESIGN_REVIEW_ONLY") return "DESIGN_REVIEW_ONLY";
  if (firstLine === "MODE: IMPLEMENTATION") return "IMPLEMENTATION";
  return null;
}

function errorTypeName(error) {
  return error?.name || error?.constructor?.name || "";
}

function isRateLimitError(error) {
  return errorTypeName(error) === "RateLimitError";
}

/**
 * Authoritative startup retry classification.
 * Retry only when error.isRetryable === true, excluding AuthenticationError /
 * ConfigurationError by concrete type/name.
 */
export function isRetryableStartupError(error) {
  if (!error || error.isRetryable !== true) return false;
  const name = errorTypeName(error);
  if (name === "AuthenticationError" || name === "ConfigurationError") return false;
  return true;
}

/**
 * Startup backoff: base * 2^(attempt-1) + jitter in [0, base].
 * Retryable RateLimitError has a 30000 ms minimum.
 * @param {{ attempt: number, baseDelayMs: number, error?: unknown, random?: () => number }} opts
 */
export function calculateStartupRetryDelayMs({
  attempt,
  baseDelayMs,
  error = null,
  random = Math.random,
}) {
  const base = Math.max(0, Number(baseDelayMs) || 0);
  const exp = base * 2 ** Math.max(0, attempt - 1);
  const raw = Number(random());
  const unit = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0;
  // Inclusive jitter in [0, base]. Treat unit===1 as base (random() is normally [0,1)).
  const jitter = base === 0 ? 0 : unit >= 1 ? base : Math.floor(unit * (base + 1));
  let delay = exp + jitter;
  if (isRateLimitError(error) && error?.isRetryable === true) {
    delay = Math.max(delay, 30000);
  }
  return delay;
}

function defaultSleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/**
 * Non-mutating carrier for terminal startup failure metadata.
 * Preserves safe diagnostic fields used by the runner; keeps the original as
 * cause only (toErrorObject continues to omit cause).
 */
export function wrapStartupTerminalFailure(
  error,
  { startupAttempts, startupAttemptsUsed, disposedFailedAgents },
) {
  const message = error?.message ?? String(error);
  const wrapper = new Error(message);
  wrapper.name = error?.name ?? "Error";
  if (typeof error?.stack === "string" && error.stack.length > 0) {
    wrapper.stack = error.stack;
  }
  if (error?.code !== undefined) {
    wrapper.code = error.code;
  }
  if (typeof error?.isRetryable === "boolean") {
    wrapper.isRetryable = error.isRetryable;
  }
  if (error?.protoErrorCode !== undefined && error?.protoErrorCode !== null) {
    wrapper.protoErrorCode = error.protoErrorCode;
  }
  wrapper.cause = error;
  wrapper.startupAttempts = startupAttempts;
  wrapper.startupAttemptsUsed = startupAttemptsUsed;
  wrapper.disposedFailedAgents = disposedFailedAgents;
  return wrapper;
}

/**
 * Await agent[Symbol.asyncDispose]() when available; otherwise call close().
 * @returns {Promise<{ method: "asyncDispose"|"close"|null }>}
 */
export async function disposeAgent(agent) {
  if (!agent) return { method: null };
  if (typeof agent[Symbol.asyncDispose] === "function") {
    await agent[Symbol.asyncDispose]();
    return { method: "asyncDispose" };
  }
  if (typeof agent.close === "function") {
    agent.close();
    return { method: "close" };
  }
  return { method: null };
}

/**
 * Authoritative pre-Run startup boundary: Agent.create + send until a Run exists.
 * Retries only isRetryableStartupError failures, at most three total attempts.
 * Disposes every failed candidate before sleeping/retrying.
 * Injectable sleep/random for deterministic tests.
 */
export async function startAgentRunWithRetry({
  createAgent,
  send,
  maxAttempts = 3,
  baseDelayMs = 1000,
  sleep = defaultSleep,
  random = Math.random,
  log = console.log.bind(console),
  onAttempt = null,
} = {}) {
  if (typeof createAgent !== "function") {
    throw new Error("startAgentRunWithRetry requires createAgent()");
  }
  if (typeof send !== "function") {
    throw new Error("startAgentRunWithRetry requires send(agent)");
  }

  const attemptsCap = Math.min(3, Math.max(1, Number(maxAttempts) || 1));
  const attempts = [];
  let disposedFailedAgents = 0;

  const recordAttempt = (attemptRecord) => {
    attempts.push(attemptRecord);
    if (typeof onAttempt === "function") {
      onAttempt(attemptRecord);
    }
  };

  for (let attempt = 1; attempt <= attemptsCap; attempt += 1) {
    let agent = null;
    let phase = "create";
    log(`STARTUP_ATTEMPT=${attempt}`);
    try {
      agent = await createAgent();
      const candidateAgentId = agent?.agentId ?? null;
      if (candidateAgentId) {
        log(`CANDIDATE_AGENT_ID=${candidateAgentId}`);
      }
      phase = "send";
      const run = await send(agent);
      recordAttempt({
        attempt,
        phase: "send",
        candidateAgentId,
        error: null,
        retryDecision: "success",
        delayMs: null,
      });
      log(`STARTUP_ATTEMPTS_USED=${attempt}`);
      return {
        agent,
        run,
        attempts,
        attemptsUsed: attempt,
        disposedFailedAgents,
      };
    } catch (error) {
      const candidateAgentId = agent?.agentId ?? null;
      const retryable = isRetryableStartupError(error);
      const canRetry = retryable && attempt < attemptsCap;
      const delayMs = canRetry
        ? calculateStartupRetryDelayMs({ attempt, baseDelayMs, error, random })
        : null;
      const attemptRecord = {
        attempt,
        phase,
        candidateAgentId,
        error: toErrorObject(error),
        retryDecision: canRetry ? "retry" : "stop",
        delayMs,
      };
      recordAttempt(attemptRecord);

      if (agent) {
        try {
          await disposeAgent(agent);
          disposedFailedAgents += 1;
        } catch (disposalError) {
          attemptRecord.disposalError = toErrorObject(disposalError);
        }
        agent = null;
      }

      if (!canRetry) {
        log(`STARTUP_ATTEMPTS_USED=${attempt}`);
        // Never mutate the original thrown value (may be frozen/non-extensible).
        throw wrapStartupTerminalFailure(error, {
          startupAttempts: attempts,
          startupAttemptsUsed: attempt,
          disposedFailedAgents,
        });
      }
      log(`STARTUP_RETRY_DELAY_MS=${delayMs}`);
      await sleep(delayMs);
    }
  }

  throw new Error("startAgentRunWithRetry exhausted attempts without returning a Run");
}

/**
 * Classify Node against SDK engines (package declares >=22.13).
 * Node <20 blocks. 20.0–22.12 warn (JsonlLocalAgentStore supplied by runner).
 * >=22.13 ok.
 */
export function classifyNodeRuntimeSupport(nodeVersion = process.versions.node) {
  const parts = String(nodeVersion ?? "0").split(".").map((part) => Number.parseInt(part, 10));
  const major = Number.isInteger(parts[0]) ? parts[0] : 0;
  const minor = Number.isInteger(parts[1]) ? parts[1] : 0;
  const patch = Number.isInteger(parts[2]) ? parts[2] : 0;
  const version = `${major}.${minor}.${patch}`;

  if (major < 20) {
    return {
      status: "block",
      nodeVersion: version,
      nodeMajor: major,
      nodeMinor: minor,
      belowPackageEngine: true,
      message: `Node ${nodeVersion} is below the minimum Node 20 runtime required by this runner.`,
    };
  }

  const atLeast2213 = major > 22 || (major === 22 && minor >= 13);
  if (!atLeast2213) {
    return {
      status: "warn",
      nodeVersion: version,
      nodeMajor: major,
      nodeMinor: minor,
      belowPackageEngine: true,
      message:
        `Node ${nodeVersion} is below the @cursor/sdk package engine (>=22.13). ` +
        "Compatible recovery is attempted only because the runner explicitly supplies JsonlLocalAgentStore.",
    };
  }

  return {
    status: "ok",
    nodeVersion: version,
    nodeMajor: major,
    nodeMinor: minor,
    belowPackageEngine: false,
    message: `Node ${nodeVersion} meets @cursor/sdk engines (>=22.13).`,
  };
}

export function collectAssistantText(message) {
  if (!message || !Array.isArray(message.content)) return "";
  let text = "";
  for (const block of message.content) {
    if (block?.type === "text") text += block.text ?? "";
  }
  return text;
}

export function findCommand(commandName) {
  try {
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    const output = execFileSync(lookup, [commandName], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.split(/\r?\n/)[0] ?? "";
  } catch {
    return "";
  }
}

export function probeCursorCli() {
  const cursorPath = findCommand("cursor");
  const cursorAgentPath = findCommand("cursor-agent");
  const probe = {
    cursorPath: cursorPath || null,
    cursorAgentPath: cursorAgentPath || null,
    programmable: false,
    supportsOutputFormat: false,
    supportsModelSelection: false,
    strictModelFallbackAllowed: false,
    status: "missing",
    note: "No Cursor CLI executable was found.",
  };

  if (cursorAgentPath) {
    probe.programmable = true;
    probe.supportsOutputFormat = true;
    probe.supportsModelSelection = true;
    probe.status = "best_effort";
    probe.note =
      "cursor-agent is available, but current CLI fallback cannot prove grok-4.6 with fast=false because it does not pass model params.";
    return probe;
  }

  if (cursorPath) {
    probe.status = "blocked";
    probe.note =
      "The desktop cursor wrapper exists, but this environment does not expose a standalone programmable cursor-agent binary. Do not assume CLI fallback is callable.";
  }

  return probe;
}

export function performPreflight({ cwd, requireApiKey = true, requireSdk = true } = {}) {
  const apiKey = getApiKey();
  const nodeSupport = classifyNodeRuntimeSupport(process.versions.node);
  const nodeMajor = nodeSupport.nodeMajor;
  const cursorUseHttp1 = process.env.CURSOR_USE_HTTP1 ?? "";
  const cliProbe = probeCursorCli();
  const sdk = {
    resolved: false,
    path: null,
    source: null,
    actualVersion: null,
    expectedVersion: EXPECTED_CURSOR_SDK_VERSION,
    versionMatch: false,
    error: null,
  };
  const checks = [];
  const blocking = [];
  const warnings = [];

  if (requireSdk) {
    try {
      const resolved = ensureSdkPackage(cwd);
      sdk.path = resolved.path;
      sdk.source = resolved.source;
      sdk.actualVersion = resolved.actualVersion;
      sdk.expectedVersion = resolved.expectedVersion;
      sdk.versionMatch = resolved.versionMatch;
      sdk.resolved = Boolean(sdk.path);
      if (sdk.source === "repo-local" && !sdk.versionMatch) {
        warnings.push(
          `Repo-local @cursor/sdk ${sdk.actualVersion ?? "unknown"} does not match expected ${sdk.expectedVersion}.`,
        );
      }
    } catch (error) {
      sdk.error = toErrorObject(error);
      blocking.push("Unable to resolve @cursor/sdk from the target repo or shared cache.");
    }
  }

  if (process.versions.bun) {
    blocking.push("Bun runtime is not supported for the local Cursor SDK path. Use Node.js.");
  }
  if (cursorUseHttp1 === "1") {
    blocking.push("CURSOR_USE_HTTP1=1 blocks the local SDK streaming path. Unset it before running.");
  }
  if (requireApiKey && !apiKey) {
    blocking.push("CURSOR_API_KEY is not available.");
  }
  if (nodeSupport.status === "block") {
    blocking.push(nodeSupport.message);
  } else if (nodeSupport.status === "warn") {
    warnings.push(nodeSupport.message);
  }
  if (!cliProbe.cursorAgentPath) {
    warnings.push(cliProbe.note);
  } else if (!cliProbe.strictModelFallbackAllowed) {
    warnings.push("Strict CLI fallback is unavailable because current CLI flags cannot prove grok-4.6 with fast=false.");
  }

  checks.push({
    id: "runtime.node",
    status: nodeSupport.status === "block" ? "block" : nodeSupport.status === "warn" ? "warn" : "ok",
    message: nodeSupport.message,
  });
  checks.push({
    id: "runtime.bun",
    status: process.versions.bun ? "block" : "ok",
    message: process.versions.bun ? `Bun ${process.versions.bun}` : "Node runtime",
  });
  checks.push({
    id: "env.cursor_use_http1",
    status: cursorUseHttp1 === "1" ? "block" : "ok",
    message: cursorUseHttp1 === "" ? "unset" : cursorUseHttp1,
  });
  checks.push({
    id: "auth.api_key",
    status: apiKey ? "ok" : requireApiKey ? "block" : "warn",
    message: apiKey ? `present length=${apiKey.length}` : "missing",
  });
  checks.push({
    id: "sdk.resolve",
    status: !requireSdk ? "skipped" : sdk.resolved ? "ok" : "block",
    message: sdk.path
      ? `${sdk.path} (source=${sdk.source}; version=${sdk.actualVersion ?? "unknown"}; expected=${sdk.expectedVersion}; match=${sdk.versionMatch})`
      : sdk.error?.message ?? "not resolved",
  });
  checks.push({
    id: "cli.probe",
    status: cliProbe.programmable ? "warn" : cliProbe.cursorPath ? "warn" : "skipped",
    message: cliProbe.note,
  });

  return {
    cwd,
    runtime: {
      nodeVersion: process.versions.node,
      nodeMajor,
      nodeMinor: nodeSupport.nodeMinor,
      nodeSupport: nodeSupport.status,
      belowPackageEngine: nodeSupport.belowPackageEngine,
      bunVersion: process.versions.bun ?? null,
      platform: process.platform,
      arch: process.arch,
    },
    env: {
      cursorUseHttp1: cursorUseHttp1 || null,
      apiKeyPresent: Boolean(apiKey),
      apiKeyLength: apiKey ? apiKey.length : 0,
    },
    sdk,
    cliProbe,
    checks,
    warnings,
    blocking,
  };
}

export function formatPreflightReport(preflight) {
  const lines = ["# Preflight", ""];
  for (const check of preflight.checks) {
    lines.push(`- ${check.id}: ${check.status} - ${check.message}`);
  }
  if (preflight.warnings.length > 0) {
    lines.push("", "## Warnings");
    for (const warning of preflight.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  if (preflight.blocking.length > 0) {
    lines.push("", "## Blocking");
    for (const reason of preflight.blocking) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}`;
}
