#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  MODEL,
  appendJsonLine,
  collectAssistantText,
  ensureParentDir,
  formatPreflightReport,
  getApiKey,
  performPreflight,
  toErrorObject,
  writeJson,
  writeText,
} from "./cursor_local_agent_common.mjs";

function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    prompt: "",
    promptFile: "",
    name: "codex-cursor-task",
    outDir: "",
    timeoutMs: 0,
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
    else if (arg === "--allowed-path") args.allowedPaths.push(argv[++i]);
    else if (arg === "--allow-cli-fallback") args.allowCliFallback = true;
    else if (arg === "--allow-cli-model-drift") args.allowCliModelDrift = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node cursor_local_agent_run.mjs --cwd <repo> --prompt-file <task.txt> --allowed-path <path>...
  node cursor_local_agent_run.mjs --cwd <repo> --prompt <text> --out-dir <dir>

Options:
  --cwd <path>                Target worktree root.
  --prompt <text>             Inline task prompt.
  --prompt-file <path>        Read task prompt from a file.
  --name <name>               Agent name. Defaults to codex-cursor-task.
  --out-dir <path>            Artifact directory. Defaults under .agents/artifacts.
  --timeout-ms <n>            Cancel the run after n milliseconds.
  --allowed-path <path>       Allowed write scope for diff capture. Repeatable.
  --allow-cli-fallback        Allow best-effort CLI fallback when SDK fails.
  --allow-cli-model-drift     Permit CLI fallback even though grok-4.5 fast=false cannot be proven.
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

function runGit(cwd, gitArgs) {
  return execFileSync("git", ["-c", `safe.directory=${cwd}`, ...gitArgs], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function normalizeAllowedPaths(cwd, allowedPaths) {
  return allowedPaths.map((inputPath) => {
    const absolute = resolve(cwd, inputPath);
    return {
      input: inputPath,
      absolute,
      relative: relative(cwd, absolute) || ".",
      exists: existsSync(absolute),
    };
  });
}

function captureGitArtifacts(args, summary, artifactPaths) {
  try {
    const beforeArgs =
      summary.allowedPathSpecs.length > 0
        ? ["status", "--short", "--untracked-files=all", "--", ...summary.allowedPathSpecs]
        : ["status", "--short", "--untracked-files=all"];
    const beforeStatus = runGit(args.cwd, beforeArgs);
    writeText(artifactPaths.statusBefore, beforeStatus);
    summary.git = summary.git ?? {};
    summary.git.statusBeforeFile = artifactPaths.statusBefore;
    summary.git.allowedPathsDirtyBefore = beforeStatus.trim().length > 0;
    if (summary.git.allowedPathsDirtyBefore) {
      summary.preflight.warnings.push(
        "Allowed paths already had local modifications before this run. diff.patch is a scoped current-state patch, not a pure per-run delta.",
      );
    }
  } catch (error) {
    summary.git = summary.git ?? {};
    summary.git.statusBeforeError = toErrorObject(error);
  }
}

function finalizeGitArtifacts(args, summary, artifactPaths) {
  summary.git = summary.git ?? {};
  try {
    const afterArgs =
      summary.allowedPathSpecs.length > 0
        ? ["status", "--short", "--untracked-files=all", "--", ...summary.allowedPathSpecs]
        : ["status", "--short", "--untracked-files=all"];
    const gitStatusAfter = runGit(args.cwd, afterArgs);
    writeText(artifactPaths.statusAfter, gitStatusAfter);
    summary.git.statusAfterFile = artifactPaths.statusAfter;
    summary.git.allowedPathsDirtyAfter = gitStatusAfter.trim().length > 0;
  } catch (error) {
    summary.git.statusAfterError = toErrorObject(error);
  }

  try {
    if (summary.allowedPathSpecs.length === 0) {
      writeText(
        artifactPaths.diffPatch,
        "# diff patch not generated\n# reason: no --allowed-path was provided, so a scoped patch cannot be captured safely.\n",
      );
      summary.git.diffPatchScope = "none";
      return;
    }
    const diffPatch = runGit(args.cwd, ["diff", "--patch", "--", ...summary.allowedPathSpecs]);
    writeText(artifactPaths.diffPatch, diffPatch);
    summary.git.diffPatchScope = "allowed-paths";
    summary.git.diffPatchFile = artifactPaths.diffPatch;
  } catch (error) {
    summary.git.diffPatchError = toErrorObject(error);
  }
}

function writeReviewTemplate(artifactPaths, summary) {
  const lines = [
    "# Cursor Run Review",
    "",
    `- runtime: ${summary.runtimeUsed ?? "pending"}`,
    `- cwd: ${summary.requestedCwd}`,
    `- agent: ${summary.agentId ?? "pending"}`,
    `- run: ${summary.runId ?? "pending"}`,
    `- result: ${summary.resultStatus ?? "pending"}`,
    `- outDir: ${summary.outDir}`,
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

  lines.push(
    "",
    "## Artifact Checklist",
    `- prompt.txt: ${artifactPaths.promptText}`,
    `- summary.json: ${artifactPaths.summary}`,
    `- events.jsonl: ${artifactPaths.events}`,
    `- diff.patch: ${artifactPaths.diffPatch}`,
    "",
    "## Review Findings",
    "- pending",
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
  const { Agent } = requireSdk(summary.preflight.sdk.path);
  const apiKey = getApiKey();
  const cwd = existsSync(args.cwd) ? args.cwd : args.cwd;
  let agent;
  let run;
  let timeoutHandle;
  let timedOut = false;

  try {
    agent = await Agent.create({
      apiKey,
      name: args.name,
      model: MODEL,
      local: { cwd },
    });
    summary.runtimeUsed = "sdk";
    summary.agentId = agent.agentId;
    console.log(`AGENT_ID=${agent.agentId}`);

    run = await agent.send(promptText);
    summary.runId = run.id;
    console.log(`RUN_ID=${run.id}`);

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
    return;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (agent) agent.close();
  }
}

async function runWithCursorCli(args, summary, artifactPaths, promptText) {
  const cliPath = summary.preflight.cliProbe.cursorAgentPath;
  if (!cliPath) {
    throw new Error("cursor-agent binary is not available for CLI fallback.");
  }

  summary.runtimeUsed = "cursor-cli";
  summary.cliFallback = {
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
  const promptText = loadPrompt(args);
  const allowedPaths = normalizeAllowedPaths(args.cwd, args.allowedPaths);
  const preflight = performPreflight({ cwd: args.cwd, requireApiKey: true, requireSdk: true });
  const artifactPaths = {
    promptText: join(args.outDir, "prompt.txt"),
    summary: join(args.outDir, "summary.json"),
    events: join(args.outDir, "events.jsonl"),
    diffPatch: join(args.outDir, "diff.patch"),
    review: join(args.outDir, "review.md"),
    preflight: join(args.outDir, "preflight.md"),
    statusBefore: join(args.outDir, "git-status-before.txt"),
    statusAfter: join(args.outDir, "git-status-after.txt"),
    cliStderr: join(args.outDir, "cursor-cli.stderr.log"),
  };
  const summary = {
    startedAt: new Date().toISOString(),
    requestedModel: MODEL,
    requestedCwd: args.cwd,
    outDir: args.outDir,
    promptSource: args.promptFile ? basename(args.promptFile) : "inline",
    timeoutMs: args.timeoutMs,
    allowedPaths,
    allowedPathSpecs: allowedPaths.map((item) => item.relative),
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

  ensureParentDir(artifactPaths.summary);
  writeText(artifactPaths.promptText, promptText);
  writeText(artifactPaths.preflight, formatPreflightReport(preflight));
  writeReviewTemplate(artifactPaths, summary);
  writeJson(artifactPaths.summary, summary);

  console.log(`OUT_DIR=${args.outDir}`);
  console.log(`PREFLIGHT_BLOCKING=${preflight.blocking.length}`);
  console.log(`PREFLIGHT_WARNINGS=${preflight.warnings.length}`);

  captureGitArtifacts(args, summary, artifactPaths);
  let failure = null;

  try {
    if (preflight.blocking.length > 0) {
      throw new Error(`Preflight failed: ${preflight.blocking.join(" | ")}`);
    }
    await runWithSdk(args, summary, artifactPaths, promptText);
  } catch (sdkError) {
    summary.sdkError = toErrorObject(sdkError);
    failure = sdkError;
    if (!args.allowCliFallback) {
      summary.cliFallback.status = "disabled";
    } else if (!args.allowCliModelDrift) {
      summary.cliFallback.status = "blocked";
      summary.cliFallback.reason =
        "CLI fallback is disabled under the strict model rule because current CLI flags cannot prove grok-4.5 with fast=false.";
    } else if (!preflight.cliProbe.cursorAgentPath) {
      summary.cliFallback.status = "blocked";
      summary.cliFallback.reason = preflight.cliProbe.note;
    } else {
      try {
        await runWithCursorCli(args, summary, artifactPaths, promptText);
        failure = null;
      } catch (cliError) {
        summary.cliFallback.error = toErrorObject(cliError);
        failure = cliError;
      }
    }
  } finally {
    finalizeGitArtifacts(args, summary, artifactPaths);
    summary.completedAt = new Date().toISOString();
    writeReviewTemplate(artifactPaths, summary);
    writeJson(artifactPaths.summary, summary);
  }

  if (failure) {
    console.error(`ERROR_NAME=${failure?.name ?? "Error"}`);
    console.error(`ERROR_MESSAGE=${failure?.message ?? String(failure)}`);
    process.exit(1);
  }

  console.log(`REVIEW_FILE=${artifactPaths.review}`);
  console.log(`DIFF_FILE=${artifactPaths.diffPatch}`);
  console.log(`SUMMARY_FILE=${artifactPaths.summary}`);
}

main().catch((error) => {
  console.error(`ERROR_NAME=${error?.name ?? "Error"}`);
  console.error(`ERROR_MESSAGE=${error?.message ?? String(error)}`);
  process.exit(1);
});
