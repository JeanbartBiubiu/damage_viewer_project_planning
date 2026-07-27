#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import {
  MODEL,
  REAL_RUN_SETTING_SOURCES,
  appendJsonLine,
  collectAssistantText,
  disposeAgent,
  ensureParentDir,
  formatPreflightReport,
  getApiKey,
  parsePromptMode,
  performPreflight,
  startAgentRunWithRetry,
  toErrorObject,
  writeJson,
  writeText,
} from "./cursor_local_agent_common.mjs";
import {
  buildPathSignatureMap,
  classifyChanges,
  classifyDeltaPaths,
  diffPathSignatures,
  normalizeAllowedPaths,
  parseGitStatusPorcelainZ,
  parseGitStatusShort,
  signatureMapToObject,
  untrackedFileMetadata,
} from "./cursor_local_agent_path_policy.mjs";

const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 6144;
const DEFAULT_STARTUP_MAX_ATTEMPTS = 3;
const DEFAULT_STARTUP_BACKOFF_MS = 1000;
const HEAP_REEXEC_ENV = "CURSOR_LOCAL_AGENT_HEAP_REEXEC";

function getV8HeapSizeLimitMiB() {
  return Math.floor(v8.getHeapStatistics().heap_size_limit / (1024 * 1024));
}

function ensureMaxOldSpaceSize(maxOldSpaceSizeMb) {
  if (process.env[HEAP_REEXEC_ENV] === "1") {
    return;
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [`--max-old-space-size=${maxOldSpaceSizeMb}`, scriptPath, ...process.argv.slice(2)],
    {
      env: { ...process.env, [HEAP_REEXEC_ENV]: "1" },
      stdio: "inherit",
      windowsHide: true,
    },
  );

  if (result.error) {
    console.error(`ERROR_NAME=${result.error.name ?? "Error"}`);
    console.error(`ERROR_MESSAGE=${result.error.message ?? String(result.error)}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    prompt: "",
    promptFile: "",
    name: "codex-cursor-task",
    outDir: "",
    timeoutMs: 0,
    maxOldSpaceSizeMb: DEFAULT_MAX_OLD_SPACE_SIZE_MB,
    startupMaxAttempts: DEFAULT_STARTUP_MAX_ATTEMPTS,
    startupBackoffMs: DEFAULT_STARTUP_BACKOFF_MS,
    allowedPaths: [],
    allowCliFallback: false,
    allowCliModelDrift: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = resolve(argv[++i]);
    else if (arg === "--prompt") args.prompt = argv[++i];
    else if (arg === "--prompt-file") args.promptFile = resolve(argv[++i]);
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--out-dir") args.outDir = resolve(argv[++i]);
    else if (arg === "--timeout-ms") args.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (arg === "--max-old-space-size-mb") {
      args.maxOldSpaceSizeMb = Number.parseInt(argv[++i], 10);
    } else if (arg === "--startup-max-attempts") {
      args.startupMaxAttempts = Number.parseInt(argv[++i], 10);
    } else if (arg === "--startup-backoff-ms") {
      args.startupBackoffMs = Number.parseInt(argv[++i], 10);
    } else if (arg === "--allowed-path") args.allowedPaths.push(argv[++i]);
    else if (arg === "--allow-cli-fallback") args.allowCliFallback = true;
    else if (arg === "--allow-cli-model-drift") args.allowCliModelDrift = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node cursor_local_agent_run.mjs --cwd <repo> --prompt-file <task.txt> --allowed-path <path>...
  node cursor_local_agent_run.mjs --cwd <repo> --prompt <text> --out-dir <dir> --allowed-path <path>...

Options:
  --cwd <path>                Target worktree root.
  --prompt <text>             Inline task prompt.
  --prompt-file <path>        Read task prompt from a file.
  --name <name>               Agent name. Defaults to codex-cursor-task.
  --out-dir <path>            Artifact directory. Defaults under .agents/artifacts.
  --timeout-ms <n>            Hard wall-clock cancellation after n milliseconds (0 = no hard cancel).
                              Recommended: >=900000 for ordinary design review, >=3600000 for large
                              implementation, or 0 with active monitoring. Positive values below
                              600000 (design) / 1800000 (implementation) emit a preflight warning.
  --max-old-space-size-mb <n> V8 old-space size in MiB before SDK work. Defaults to ${DEFAULT_MAX_OLD_SPACE_SIZE_MB}.
                              Current process V8 heap limit: ${getV8HeapSizeLimitMiB()} MiB.
  --startup-max-attempts <n>  Bounded Agent.create+send retries before a Run exists (1..3). Default ${DEFAULT_STARTUP_MAX_ATTEMPTS}.
  --startup-backoff-ms <n>    Base backoff in ms for startup retries (non-negative). Default ${DEFAULT_STARTUP_BACKOFF_MS}.
                              Delay = base * 2^(attempt-1) + jitter in [0, base]; retryable RateLimitError min 30000.
  --allowed-path <path>       Audited write allowlist entry (required, repeatable). Not an OS sandbox.
                              Paths resolve under --cwd; escapes outside the repository are rejected.
  --allow-cli-fallback        Allow best-effort CLI fallback when SDK startup fails (no Run returned).
  --allow-cli-model-drift     Permit CLI fallback even though grok-4.5 fast=false cannot be proven.

Artifacts (always under --out-dir): prompt.txt, summary.json, events.jsonl, diff.patch,
  review.md, preflight.md, git-status-before/after (scoped + full worktree),
  path-signature before/after JSON, untracked-in-scope metadata (path/size/sha256 only; never raw content).
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.prompt && args.promptFile) {
    throw new Error("Use either --prompt or --prompt-file, not both.");
  }
  if (!args.prompt && !args.promptFile) {
    throw new Error("One of --prompt or --prompt-file is required.");
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 0) {
    throw new Error("--timeout-ms must be a non-negative integer");
  }
  if (!Number.isInteger(args.maxOldSpaceSizeMb) || args.maxOldSpaceSizeMb <= 0) {
    throw new Error("--max-old-space-size-mb must be a positive integer");
  }
  if (
    !Number.isInteger(args.startupMaxAttempts) ||
    args.startupMaxAttempts < 1 ||
    args.startupMaxAttempts > 3
  ) {
    throw new Error("--startup-max-attempts must be an integer in 1..3");
  }
  if (!Number.isInteger(args.startupBackoffMs) || args.startupBackoffMs < 0) {
    throw new Error("--startup-backoff-ms must be a non-negative integer");
  }
  if (args.allowedPaths.length === 0) {
    throw new Error("at least one --allowed-path is required for real runs (audited write allowlist)");
  }
  if (!args.outDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    args.outDir = join(args.cwd, ".agents", "artifacts", `cursor-task-${stamp}`);
  }
  return args;
}

function loadPrompt(args) {
  if (args.promptFile) {
    return readFileSync(args.promptFile, "utf8");
  }
  return args.prompt;
}

function applyPromptModeToPreflight(preflight, promptMode, timeoutMs) {
  if (!promptMode) {
    preflight.blocking.push(
      "Prompt must declare exactly MODE: DESIGN_REVIEW_ONLY or MODE: IMPLEMENTATION on the first line.",
    );
    preflight.checks.push({
      id: "prompt.mode",
      status: "block",
      message: "missing or invalid MODE on first prompt line",
    });
    return;
  }

  preflight.checks.push({
    id: "prompt.mode",
    status: "ok",
    message: promptMode,
  });

  if (timeoutMs > 0) {
    if (promptMode === "DESIGN_REVIEW_ONLY" && timeoutMs < 600000) {
      preflight.warnings.push(
        `--timeout-ms=${timeoutMs} is below the 600000 ms design-review hard-timeout warning threshold.`,
      );
    }
    if (promptMode === "IMPLEMENTATION" && timeoutMs < 1800000) {
      preflight.warnings.push(
        `--timeout-ms=${timeoutMs} is below the 1800000 ms implementation hard-timeout warning threshold.`,
      );
    }
  }
}

function rewritePreflightArtifacts(artifactPaths, summary) {
  writeText(artifactPaths.preflight, formatPreflightReport(summary.preflight));
  writeReviewTemplate(artifactPaths, summary);
  writeJson(artifactPaths.summary, summary);
}

function printErrorEvidence(failure, summary) {
  const safe = toErrorObject(failure) ?? {};
  console.error(`ERROR_PHASE=${summary.failurePhase ?? "unknown"}`);
  console.error(`ERROR_NAME=${safe.name ?? failure?.name ?? "Error"}`);
  console.error(`ERROR_MESSAGE=${safe.message ?? failure?.message ?? String(failure)}`);
  if (typeof safe.isRetryable === "boolean") {
    console.error(`ERROR_RETRYABLE=${safe.isRetryable}`);
  }
  if (safe.code !== undefined && safe.code !== null) {
    console.error(`ERROR_CODE=${safe.code}`);
  }
  if (safe.protoErrorCode !== undefined && safe.protoErrorCode !== null) {
    console.error(`ERROR_PROTO=${safe.protoErrorCode}`);
  }
}

function blockCliFallback(summary, reason) {
  summary.cliFallback.status = "blocked";
  summary.cliFallback.reason = reason;
}

function runGit(cwd, gitArgs, { encoding = "utf8" } = {}) {
  return execFileSync("git", ["-c", `safe.directory=${cwd}`, ...gitArgs], {
    cwd,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function captureGitStatusText(cwd, pathSpecs = null) {
  const gitArgs = [
    "-c",
    "core.quotepath=false",
    "status",
    "--short",
    "--untracked-files=all",
  ];
  if (pathSpecs?.length) {
    gitArgs.push("--", ...pathSpecs);
  }
  return runGit(cwd, gitArgs);
}

function captureGitStatusPorcelainZ(cwd) {
  return runGit(
    cwd,
    ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { encoding: "buffer" },
  );
}

/**
 * Capture before-state git audit snapshot. Returns true on success.
 * On failure: marks audit unavailable, records blocking error, returns false.
 * Caller must hard-gate (no SDK / no CLI fallback) when this returns false.
 */
function captureGitArtifacts(args, summary, artifactPaths) {
  summary.git = summary.git ?? {};
  try {
    const worktreeBefore = captureGitStatusText(args.cwd);
    writeText(artifactPaths.statusWorktreeBefore, worktreeBefore);
    summary.git.statusWorktreeBeforeFile = artifactPaths.statusWorktreeBefore;

    const beforeStatus = captureGitStatusText(args.cwd, summary.allowedPathSpecs);
    writeText(artifactPaths.statusBefore, beforeStatus);
    summary.git.statusBeforeFile = artifactPaths.statusBefore;
    summary.git.allowedPathsDirtyBefore = beforeStatus.trim().length > 0;
    if (summary.git.allowedPathsDirtyBefore) {
      summary.preflight.warnings.push(
        "Allowed paths already had local modifications before this run. diff.patch is a scoped current-state patch, not a pure per-run delta.",
      );
    }

    const beforeZ = captureGitStatusPorcelainZ(args.cwd);
    const beforeEntries = parseGitStatusPorcelainZ(beforeZ);
    const beforeSignatures = buildPathSignatureMap(args.cwd, beforeEntries);
    writeJson(artifactPaths.signaturesBefore, signatureMapToObject(beforeSignatures));
    summary.git.signaturesBeforeFile = artifactPaths.signaturesBefore;
    summary.git.pathSignaturesBefore = signatureMapToObject(beforeSignatures);
    summary.git.statusEntriesBeforeCount = beforeEntries.length;
    summary.git.beforeAuditAvailable = true;
    return true;
  } catch (error) {
    summary.git.beforeAuditAvailable = false;
    summary.git.statusBeforeError = toErrorObject(error);
    markAuditUnavailable(summary, error);
    summary.preflight.blocking.push(
      `Failed to capture before-state git audit snapshot: ${error.message}`,
    );
    return false;
  }
}

function captureUntrackedInScopeMetadata(args, summary, artifactPaths, inScopeEntries) {
  const untracked = inScopeEntries.filter((entry) => entry.untracked);
  summary.git.untrackedInScope = untracked.map((entry) => entry.relativePath);
  writeText(
    artifactPaths.untrackedList,
    `${summary.git.untrackedInScope.join("\n")}${summary.git.untrackedInScope.length ? "\n" : ""}`,
  );

  const metadata = [];
  const skipped = [];
  for (const entry of untracked) {
    try {
      metadata.push(untrackedFileMetadata(args.cwd, entry.relativePath));
    } catch (error) {
      skipped.push({ path: entry.relativePath, reason: error.message });
    }
  }

  writeJson(artifactPaths.untrackedMeta, { files: metadata, skipped });
  summary.git.untrackedCapture = {
    mode: "metadata-only",
    files: metadata,
    skipped,
  };
}

function markAuditUnavailable(summary, error) {
  const errorObject = toErrorObject(error);
  summary.git = summary.git ?? {};
  summary.git.auditError = errorObject;
  summary.writeAllowlistAudit = {
    kind: "audited-write-allowlist",
    osSandbox: false,
    outsideScopeCount: summary.writeAllowlistAudit?.outsideScopeCount ?? 0,
    outsideScopePaths: summary.writeAllowlistAudit?.outsideScopePaths ?? [],
    runDeltaOutsideScopeCount: summary.writeAllowlistAudit?.runDeltaOutsideScopeCount ?? 0,
    runDeltaOutsideScopePaths: summary.writeAllowlistAudit?.runDeltaOutsideScopePaths ?? [],
    failClosed: true,
    auditAvailable: false,
    auditError: errorObject,
  };
}

function finalizeGitArtifacts(args, summary, artifactPaths) {
  summary.git = summary.git ?? {};
  try {
    const worktreeAfter = captureGitStatusText(args.cwd);
    writeText(artifactPaths.statusWorktreeAfter, worktreeAfter);
    summary.git.statusWorktreeAfterFile = artifactPaths.statusWorktreeAfter;

    const gitStatusAfter = captureGitStatusText(args.cwd, summary.allowedPathSpecs);
    writeText(artifactPaths.statusAfter, gitStatusAfter);
    summary.git.statusAfterFile = artifactPaths.statusAfter;
    summary.git.allowedPathsDirtyAfter = gitStatusAfter.trim().length > 0;

    const afterZ = captureGitStatusPorcelainZ(args.cwd);
    const afterEntries = parseGitStatusPorcelainZ(afterZ);
    // Text evidence remains available even if -z parsing is preferred for signatures.
    const afterEntriesText = parseGitStatusShort(worktreeAfter);
    if (afterEntriesText.length !== afterEntries.length) {
      summary.git.statusParseNote =
        `porcelain -z entries=${afterEntries.length}; short-text entries=${afterEntriesText.length}`;
    }

    const afterSignatures = buildPathSignatureMap(args.cwd, afterEntries);
    writeJson(artifactPaths.signaturesAfter, signatureMapToObject(afterSignatures));
    summary.git.signaturesAfterFile = artifactPaths.signaturesAfter;
    summary.git.pathSignaturesAfter = signatureMapToObject(afterSignatures);

    if (!summary.git.pathSignaturesBefore || summary.git.statusBeforeError) {
      throw new Error(
        summary.git.statusBeforeError?.message
          ?? "before-state path signatures unavailable; cannot compute run delta",
      );
    }
    const beforeSignatures = new Map(
      Object.entries(summary.git.pathSignaturesBefore).map(([pathItem, value]) => [
        pathItem,
        value,
      ]),
    );
    const runDelta = diffPathSignatures(beforeSignatures, afterSignatures);
    summary.git.runDelta = runDelta;

    const afterClassification = classifyChanges(afterEntries, summary.allowedPathSpecs);
    const deltaClassification = classifyDeltaPaths(runDelta, summary.allowedPathSpecs);

    summary.git.changeClassification = {
      afterState: {
        inScope: afterClassification.inScope.map((entry) => ({
          status: entry.status,
          path: entry.relativePath,
          fromPath: entry.fromPath,
          untracked: entry.untracked,
          paths: entry.paths,
        })),
        outsideScope: afterClassification.outsideScope.map((entry) => ({
          status: entry.status,
          path: entry.relativePath,
          fromPath: entry.fromPath,
          untracked: entry.untracked,
          paths: entry.paths,
        })),
      },
      runDelta: {
        inScope: deltaClassification.inScope,
        outsideScope: deltaClassification.outsideScope,
      },
    };

    const afterOutsidePaths = afterClassification.outsideScope.flatMap((entry) => entry.paths);
    const deltaOutsidePaths = deltaClassification.outsideScope.map((item) => item.path);
    summary.git.outsideScopePaths = [...new Set(afterOutsidePaths)];
    summary.git.runDeltaOutsideScopePaths = deltaOutsidePaths;

    summary.writeAllowlistAudit = {
      kind: "audited-write-allowlist",
      osSandbox: false,
      auditAvailable: true,
      outsideScopeCount: summary.git.outsideScopePaths.length,
      outsideScopePaths: summary.git.outsideScopePaths,
      runDeltaOutsideScopeCount: deltaOutsidePaths.length,
      runDeltaOutsideScopePaths: deltaOutsidePaths,
      runDeltaCount: runDelta.length,
      failClosed: deltaOutsidePaths.length > 0,
    };

    captureUntrackedInScopeMetadata(args, summary, artifactPaths, afterClassification.inScope);
  } catch (error) {
    summary.git.statusAfterError = toErrorObject(error);
    markAuditUnavailable(summary, error);
  }

  try {
    const diffPatch = runGit(args.cwd, [
      "-c",
      "core.quotepath=false",
      "diff",
      "--patch",
      "--",
      ...summary.allowedPathSpecs,
    ]);
    writeText(artifactPaths.diffPatch, diffPatch);
    summary.git.diffPatchScope = "allowed-paths";
    summary.git.diffPatchFile = artifactPaths.diffPatch;
  } catch (error) {
    summary.git.diffPatchError = toErrorObject(error);
  }
}

function writeReviewTemplate(artifactPaths, summary) {
  const outsideAfter = summary.git?.outsideScopePaths ?? [];
  const outsideDelta = summary.git?.runDeltaOutsideScopePaths ?? [];
  const audit = summary.writeAllowlistAudit ?? {};
  let reviewFinding = "- pending";
  if (audit.auditAvailable === false) {
    reviewFinding = `- FAIL: write allowlist audit unavailable (${audit.auditError?.message ?? "unknown error"}).`;
  } else if (audit.failClosed) {
    reviewFinding = "- FAIL: run delta includes outside-scope path changes (fail-closed).";
  }

  const lines = [
    "# Cursor Run Review",
    "",
    `- runtime: ${summary.runtimeUsed ?? "pending"}`,
    `- cwd: ${summary.requestedCwd}`,
    `- agent: ${summary.agentId ?? "pending"}`,
    `- run: ${summary.runId ?? "pending"}`,
    `- requestId: ${summary.requestId ?? "pending"}`,
    `- promptMode: ${summary.promptMode ?? "null"}`,
    `- result: ${summary.resultStatus ?? "pending"}`,
    `- failurePhase: ${summary.failurePhase ?? "none"}`,
    `- outDir: ${summary.outDir}`,
    `- requested SDK setting sources: ${JSON.stringify(summary.settingSources ?? [])}`,
    `- write allowlist: audited (not OS sandbox)`,
    `- after-state outside-scope paths: ${outsideAfter.length}`,
    `- run-delta outside-scope paths: ${outsideDelta.length}`,
    `- failClosed (run delta): ${audit.failClosed === true}`,
    `- audit available: ${audit.auditAvailable !== false}`,
    "",
    "## Allowed Paths",
  ];

  if (summary.allowedPaths.length === 0) {
    lines.push("- none specified");
  } else {
    for (const item of summary.allowedPaths) {
      lines.push(`- ${item.input} -> ${item.relative} (${item.exists ? "exists" : "missing"})`);
    }
  }

  lines.push("", "## After-State Outside-Scope Paths");
  if (outsideAfter.length === 0) {
    lines.push("- none");
  } else {
    for (const pathItem of outsideAfter) {
      lines.push(`- ${pathItem}`);
    }
  }

  lines.push("", "## Run-Delta Outside-Scope Paths");
  if (outsideDelta.length === 0) {
    lines.push("- none");
  } else {
    for (const pathItem of outsideDelta) {
      lines.push(`- ${pathItem}`);
    }
  }

  const untracked = summary.git?.untrackedInScope ?? [];
  lines.push("", "## Untracked In-Scope Paths (metadata only)");
  if (untracked.length === 0) {
    lines.push("- none");
  } else {
    for (const pathItem of untracked) {
      lines.push(`- ${pathItem}`);
    }
  }

  lines.push(
    "",
    "## Artifact Checklist",
    `- prompt.txt: ${artifactPaths.promptText}`,
    `- summary.json: ${artifactPaths.summary}`,
    `- events.jsonl: ${artifactPaths.events}`,
    `- diff.patch: ${artifactPaths.diffPatch}`,
    `- git-status-worktree-before/after: full worktree`,
    `- git-status-before/after: allowlist-scoped`,
    `- path-signatures-before/after.json: per-path status + content hash`,
    `- untracked-in-scope.txt + untracked-in-scope-meta.json (path/size/sha256 only)`,
    "",
    "## Review Findings",
    reviewFinding,
    "",
    "## Validation Commands",
    "- pending",
    "",
    "## Notes",
    ...summary.preflight.warnings.map((warning) => `- warning: ${warning}`),
    ...summary.preflight.blocking.map((reason) => `- blocking: ${reason}`),
    "",
  );

  writeText(artifactPaths.review, `${lines.join("\n")}`);
}

async function runWithSdk(args, summary, artifactPaths, promptText) {
  const requireSdk = createRequire(import.meta.url);
  const { Agent, JsonlLocalAgentStore } = requireSdk(summary.preflight.sdk.path);
  const apiKey = getApiKey();
  const cwd = existsSync(args.cwd) ? args.cwd : args.cwd;
  const store = new JsonlLocalAgentStore(join(args.outDir, "sdk-local-agent-store"));
  let agent;
  let run;
  let timeoutHandle;
  let timedOut = false;
  let runReturned = false;

  summary.failurePhase = "startup";

  try {
    const started = await startAgentRunWithRetry({
      maxAttempts: args.startupMaxAttempts,
      baseDelayMs: args.startupBackoffMs,
      createAgent: async () =>
        Agent.create({
          apiKey,
          name: args.name,
          model: MODEL,
          local: {
            cwd,
            store,
            settingSources: [...summary.settingSources],
          },
        }),
      send: async (candidate) => candidate.send(promptText),
      onAttempt: (attemptRecord) => {
        summary.startup.attempts.push(attemptRecord);
        summary.startup.attemptsUsed = summary.startup.attempts.length;
      },
    });

    agent = started.agent;
    run = started.run;
    runReturned = true;
    summary.startup.attempts = started.attempts;
    summary.startup.attemptsUsed = started.attemptsUsed;
    summary.runtimeUsed = "sdk";
    summary.agentId = agent.agentId;
    summary.runId = run.id;
    summary.requestId = run.requestId ?? null;
    console.log(`AGENT_ID=${agent.agentId}`);
    console.log(`RUN_ID=${run.id}`);
    if (summary.requestId) {
      console.log(`REQUEST_ID=${summary.requestId}`);
    }

    // Run exists: never enter startup retry or CLI fallback for later failures.
    summary.failurePhase = "run";

    if (args.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        void run.cancel().catch(() => {});
      }, args.timeoutMs);
    }

    for await (const event of run.stream()) {
      summary.eventCountByType[event.type] = (summary.eventCountByType[event.type] ?? 0) + 1;
      appendJsonLine(artifactPaths.events, {
        ts: new Date().toISOString(),
        runtime: "sdk",
        event,
      });
      if (event.type === "status") summary.statuses.push(event.status);
      if (event.type === "assistant") summary.assistantText += collectAssistantText(event.message);
      if (event.type === "tool_call") {
        summary.toolCalls.push({
          callId: event.call_id,
          name: event.name,
          status: event.status,
          truncated: event.truncated ?? false,
        });
      }
    }

    const result = await run.wait();
    summary.result = result;
    summary.resultStatus = result.status;
    summary.resultModel = result.model;
    summary.resultGit = result.git;
    summary.durationMs = result.durationMs;
    try {
      summary.artifacts = await agent.listArtifacts();
    } catch (artifactError) {
      summary.artifactListError = toErrorObject(artifactError);
    }
    if (timedOut) {
      throw new Error(`Run exceeded timeout_ms=${args.timeoutMs}`);
    }
    console.log(`RESULT_STATUS=${result.status}`);
    console.log(`RESULT_MODEL=${JSON.stringify(result.model)}`);

    // Only finished is success; other terminal statuses are run-phase failures.
    if (result.status !== "finished") {
      const err = new Error(`RunResult.status=${result.status} is not finished`);
      err.name = "RunResultNotFinishedError";
      throw err;
    }

    summary.failurePhase = null;
    return;
  } catch (error) {
    if (Array.isArray(error?.startupAttempts)) {
      summary.startup.attempts = error.startupAttempts;
      summary.startup.attemptsUsed =
        error.startupAttemptsUsed ?? error.startupAttempts.length;
    }
    if (runReturned || summary.runId) {
      summary.failurePhase = "run";
    } else if (summary.failurePhase !== "preflight" && summary.failurePhase !== "audit") {
      summary.failurePhase = "startup";
    }
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (agent) {
      try {
        summary.disposal = await disposeAgent(agent);
      } catch (disposalError) {
        // Do not mask an already-active startup/run error.
        summary.disposalError = toErrorObject(disposalError);
      }
    }
  }
}

async function runWithCursorCli(args, summary, artifactPaths, promptText) {
  const cliPath = summary.preflight.cliProbe.cursorAgentPath;
  if (!cliPath) {
    throw new Error("cursor-agent binary is not available for CLI fallback.");
  }

  summary.runtimeUsed = "cursor-cli";
  summary.cliFallback = {
    ...summary.cliFallback,
    status: "running",
    modelDriftAccepted: args.allowCliModelDrift,
    command: cliPath,
  };

  await new Promise((resolvePromise, rejectPromise) => {
    const commandArgs = ["-p", promptText, "--output-format", "stream-json", "--model", "grok-4.5"];
    const child = spawn(cliPath, commandArgs, {
      cwd: args.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let timeoutHandle;

    if (args.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill();
      }, args.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        appendJsonLine(artifactPaths.events, {
          ts: new Date().toISOString(),
          runtime: "cursor-cli",
          raw: line,
        });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (stdoutBuffer.trim()) {
        appendJsonLine(artifactPaths.events, {
          ts: new Date().toISOString(),
          runtime: "cursor-cli",
          raw: stdoutBuffer.trim(),
        });
      }
      if (stderrBuffer) {
        writeText(artifactPaths.cliStderr, stderrBuffer);
        summary.cliFallback.stderrFile = artifactPaths.cliStderr;
      }
      summary.cliFallback.exitCode = code;
      if (code === 0) {
        summary.cliFallback.status = "finished";
        resolvePromise();
      } else {
        rejectPromise(new Error(`cursor-agent exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureMaxOldSpaceSize(args.maxOldSpaceSizeMb);
  const promptText = loadPrompt(args);
  const promptMode = parsePromptMode(promptText);
  const allowedPaths = normalizeAllowedPaths(args.cwd, args.allowedPaths);
  const preflight = performPreflight({ cwd: args.cwd, requireApiKey: true, requireSdk: true });
  applyPromptModeToPreflight(preflight, promptMode, args.timeoutMs);

  const artifactPaths = {
    promptText: join(args.outDir, "prompt.txt"),
    summary: join(args.outDir, "summary.json"),
    events: join(args.outDir, "events.jsonl"),
    diffPatch: join(args.outDir, "diff.patch"),
    review: join(args.outDir, "review.md"),
    preflight: join(args.outDir, "preflight.md"),
    statusBefore: join(args.outDir, "git-status-before.txt"),
    statusAfter: join(args.outDir, "git-status-after.txt"),
    statusWorktreeBefore: join(args.outDir, "git-status-worktree-before.txt"),
    statusWorktreeAfter: join(args.outDir, "git-status-worktree-after.txt"),
    untrackedList: join(args.outDir, "untracked-in-scope.txt"),
    untrackedMeta: join(args.outDir, "untracked-in-scope-meta.json"),
    signaturesBefore: join(args.outDir, "path-signatures-before.json"),
    signaturesAfter: join(args.outDir, "path-signatures-after.json"),
    cliStderr: join(args.outDir, "cursor-cli.stderr.log"),
  };
  const summary = {
    startedAt: new Date().toISOString(),
    requestedModel: MODEL,
    requestedCwd: args.cwd,
    outDir: args.outDir,
    promptSource: args.promptFile ? basename(args.promptFile) : "inline",
    promptMode,
    timeoutMs: args.timeoutMs,
    maxOldSpaceSizeMb: args.maxOldSpaceSizeMb,
    v8HeapSizeLimitMiB: getV8HeapSizeLimitMiB(),
    settingSources: [...REAL_RUN_SETTING_SOURCES],
    allowedPaths,
    allowedPathSpecs: allowedPaths.map((item) => item.relative),
    writeAllowlistAudit: {
      kind: "audited-write-allowlist",
      osSandbox: false,
      auditAvailable: true,
      outsideScopeCount: 0,
      outsideScopePaths: [],
      runDeltaOutsideScopeCount: 0,
      runDeltaOutsideScopePaths: [],
      runDeltaCount: 0,
      failClosed: false,
    },
    startup: {
      maxAttempts: args.startupMaxAttempts,
      baseDelayMs: args.startupBackoffMs,
      attemptsUsed: 0,
      attempts: [],
    },
    failurePhase: null,
    requestId: null,
    preflight,
    eventCountByType: {},
    assistantText: "",
    toolCalls: [],
    statuses: [],
    cliFallback: {
      allowed: args.allowCliFallback,
      modelDriftAccepted: args.allowCliModelDrift,
      status: "not_attempted",
    },
  };

  // First artifact writes only after MODE/preflight/timeout checks + startup init.
  ensureParentDir(artifactPaths.summary);
  writeText(artifactPaths.promptText, promptText);
  rewritePreflightArtifacts(artifactPaths, summary);

  console.log(`OUT_DIR=${args.outDir}`);
  console.log(`SETTING_SOURCES=${JSON.stringify(summary.settingSources)}`);
  console.log(`PROMPT_MODE=${summary.promptMode ?? "null"}`);
  console.log(`PREFLIGHT_BLOCKING=${preflight.blocking.length}`);
  console.log(`PREFLIGHT_WARNINGS=${preflight.warnings.length}`);
  console.log(`ALLOWED_PATHS=${summary.allowedPathSpecs.join(";")}`);
  console.log(`STARTUP_MAX_ATTEMPTS=${summary.startup.maxAttempts}`);
  console.log(`STARTUP_BACKOFF_MS=${summary.startup.baseDelayMs}`);

  const beforeAuditOk = captureGitArtifacts(args, summary, artifactPaths);
  // captureGitArtifacts may mutate preflight.warnings/blocking — rewrite artifacts.
  rewritePreflightArtifacts(artifactPaths, summary);

  // Hard gate: unavailable before-state baseline/status/signatures must not start SDK
  // and must not attempt CLI fallback. Preserve review/summary/status artifacts.
  if (!beforeAuditOk) {
    summary.completedAt = new Date().toISOString();
    summary.runtimeUsed = "none";
    summary.failurePhase = "audit";
    blockCliFallback(
      summary,
      "CLI fallback blocked because before-state git audit snapshot is unavailable (no-replay).",
    );
    rewritePreflightArtifacts(artifactPaths, summary);
    console.error(
      `WRITE_ALLOWLIST_AUDIT_UNAVAILABLE=${summary.writeAllowlistAudit?.auditError?.message ?? "before-state unavailable"}`,
    );
    printErrorEvidence(
      new Error(summary.git?.statusBeforeError?.message ?? "before-state git audit snapshot unavailable"),
      summary,
    );
    console.log(`REVIEW_FILE=${artifactPaths.review}`);
    console.log(`SUMMARY_FILE=${artifactPaths.summary}`);
    process.exit(1);
  }

  let failure = null;

  try {
    if (preflight.blocking.length > 0) {
      summary.failurePhase = "preflight";
      throw new Error(`Preflight failed: ${preflight.blocking.join(" | ")}`);
    }
    await runWithSdk(args, summary, artifactPaths, promptText);
  } catch (sdkError) {
    summary.sdkError = toErrorObject(sdkError);
    failure = sdkError;
    if (!summary.failurePhase) {
      summary.failurePhase = summary.runId ? "run" : "startup";
    }

    const canConsiderCliFallback =
      summary.failurePhase === "startup" && !summary.runId;

    if (!canConsiderCliFallback) {
      blockCliFallback(
        summary,
        `CLI fallback blocked: failurePhase=${summary.failurePhase}` +
          `${summary.runId ? ` runId=${summary.runId}` : ""} (no-replay after Run return / non-startup failure).`,
      );
    } else if (!args.allowCliFallback) {
      summary.cliFallback.status = "disabled";
    } else if (!args.allowCliModelDrift) {
      blockCliFallback(
        summary,
        "CLI fallback is disabled under the strict model rule because current CLI flags cannot prove grok-4.5 with fast=false.",
      );
    } else if (!preflight.cliProbe.cursorAgentPath) {
      blockCliFallback(summary, preflight.cliProbe.note);
    } else {
      try {
        await runWithCursorCli(args, summary, artifactPaths, promptText);
        failure = null;
        summary.failurePhase = null;
      } catch (cliError) {
        summary.cliFallback.error = toErrorObject(cliError);
        failure = cliError;
      }
    }
  } finally {
    finalizeGitArtifacts(args, summary, artifactPaths);
    summary.completedAt = new Date().toISOString();
    rewritePreflightArtifacts(artifactPaths, summary);
  }

  const audit = summary.writeAllowlistAudit ?? {};
  const deltaOutsideCount = audit.runDeltaOutsideScopeCount ?? 0;
  const afterOutsideCount = audit.outsideScopeCount ?? 0;
  if (afterOutsideCount > 0) {
    console.error(`AFTER_OUTSIDE_SCOPE_COUNT=${afterOutsideCount}`);
    console.error(`AFTER_OUTSIDE_SCOPE_PATHS=${(audit.outsideScopePaths ?? []).join(";")}`);
  }
  if (deltaOutsideCount > 0) {
    console.error(`RUN_DELTA_OUTSIDE_SCOPE_COUNT=${deltaOutsideCount}`);
    console.error(
      `RUN_DELTA_OUTSIDE_SCOPE_PATHS=${(audit.runDeltaOutsideScopePaths ?? []).join(";")}`,
    );
  }
  if (audit.auditAvailable === false) {
    console.error(`WRITE_ALLOWLIST_AUDIT_UNAVAILABLE=${audit.auditError?.message ?? "unknown"}`);
  }

  if (failure) {
    printErrorEvidence(failure, summary);
  }

  console.log(`REVIEW_FILE=${artifactPaths.review}`);
  console.log(`DIFF_FILE=${artifactPaths.diffPatch}`);
  console.log(`SUMMARY_FILE=${artifactPaths.summary}`);
  console.log(`STARTUP_ATTEMPTS_USED=${summary.startup?.attemptsUsed ?? 0}`);

  // audit.failClosed exit 2 takes precedence over ordinary runtime/task failure.
  if (audit.failClosed) {
    process.exit(2);
  }
  if (failure) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`ERROR_PHASE=unknown`);
  console.error(`ERROR_NAME=${error?.name ?? "Error"}`);
  console.error(`ERROR_MESSAGE=${error?.message ?? String(error)}`);
  process.exit(1);
});
