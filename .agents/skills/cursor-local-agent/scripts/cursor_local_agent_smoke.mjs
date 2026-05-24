#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  MODEL,
  appendJsonLine,
  collectAssistantText,
  ensureSdkPackage,
  getApiKey,
  performPreflight,
  toErrorObject,
  writeJson,
} from "./cursor_local_agent_common.mjs";

function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    send: false,
    dryRun: false,
    prompt: "Do not create, edit, or delete files. Reply exactly: FAST_FALSE_SMOKE_OK",
    name: "codex-fast-false-smoke",
    jsonOut: "",
    eventsOut: "",
    outDir: "",
    timeoutMs: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = resolve(argv[++i]);
    else if (arg === "--send") args.send = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--prompt") args.prompt = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--json-out") args.jsonOut = resolve(argv[++i]);
    else if (arg === "--events-out") args.eventsOut = resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = resolve(argv[++i]);
    else if (arg === "--timeout-ms") args.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node cursor_local_agent_smoke.mjs --dry-run
  node cursor_local_agent_smoke.mjs --cwd <repo> --send
  node cursor_local_agent_smoke.mjs --cwd <repo> --send --out-dir <dir>

Options:
  --cwd <path>         Cursor local agent working directory. Defaults to cwd.
  --send               Actually send the smoke prompt. This consumes Cursor usage.
  --dry-run            Validate config and print the requested non-fast model only.
  --prompt <text>      Override smoke prompt.
  --name <name>        Agent name.
  --json-out <path>    Write a structured summary JSON file.
  --events-out <path>  Write streamed events as JSONL.
  --out-dir <path>     Convenience option. Writes summary.json and events.jsonl.
  --timeout-ms <n>     Cancel the run after n milliseconds.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.outDir) {
    if (!args.jsonOut) args.jsonOut = join(args.outDir, "summary.json");
    if (!args.eventsOut) args.eventsOut = join(args.outDir, "events.jsonl");
  }
  if (!args.send) args.dryRun = true;
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 0) {
    throw new Error("--timeout-ms must be a non-negative integer");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = getApiKey();
  const preflight = performPreflight({ cwd: args.cwd, requireApiKey: true, requireSdk: true });
  const summary = {
    startedAt: new Date().toISOString(),
    requestedModel: MODEL,
    requestedCwd: args.cwd,
    send: args.send,
    dryRun: args.dryRun,
    prompt: args.prompt,
    agentName: args.name,
    timeoutMs: args.timeoutMs,
    apiKeyPresent: Boolean(apiKey),
    apiKeyLength: apiKey ? apiKey.length : 0,
    statuses: [],
    eventCountByType: {},
    assistantText: "",
    toolCalls: [],
    preflight,
  };

  console.log(`API_KEY=${apiKey ? `SET length=${apiKey.length}` : "NOT_SET"}`);
  console.log(`REQUESTED_MODEL=${JSON.stringify(MODEL)}`);
  console.log(`CWD=${args.cwd}`);
  if (args.jsonOut) console.log(`JSON_OUT=${args.jsonOut}`);
  if (args.eventsOut) console.log(`EVENTS_OUT=${args.eventsOut}`);

  const sdkPath = preflight.sdk.path ?? ensureSdkPackage(args.cwd);
  summary.sdkPath = sdkPath;
  console.log(`SDK_READY=${Boolean(sdkPath)}`);
  console.log(`PREFLIGHT_BLOCKING=${preflight.blocking.length}`);
  console.log(`PREFLIGHT_WARNINGS=${preflight.warnings.length}`);

  if (preflight.blocking.length > 0) {
    throw new Error(`Preflight failed: ${preflight.blocking.join(" | ")}`);
  }
  if (args.dryRun) {
    summary.completedAt = new Date().toISOString();
    if (args.jsonOut) writeJson(args.jsonOut, summary);
    return;
  }

  const requireSdk = createRequire(import.meta.url);
  const { Agent } = requireSdk(sdkPath);
  const cwd = existsSync(args.cwd) ? args.cwd : mkdtempSync(join(tmpdir(), "cursor-sdk-fastfalse-smoke-"));
  summary.resolvedCwd = cwd;

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

    summary.agentId = agent.agentId;
    console.log(`AGENT_ID=${agent.agentId}`);
    run = await agent.send(args.prompt);
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
      if (args.eventsOut) {
        appendJsonLine(args.eventsOut, {
          ts: new Date().toISOString(),
          event,
        });
      }
      if (event.type === "status") {
        summary.statuses.push(event.status);
      }
      if (event.type === "assistant") {
        summary.assistantText += collectAssistantText(event.message);
      }
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

    console.log(`STATUSES=${summary.statuses.join(",")}`);
    console.log(`ASSISTANT_TEXT=${summary.assistantText.trim()}`);
    console.log(`RESULT_STATUS=${result.status}`);
    console.log(`RESULT_MODEL=${JSON.stringify(result.model)}`);
    console.log(`RUN_RESULT=${JSON.stringify(result)}`);
    console.log(`ARTIFACT_COUNT=${Array.isArray(summary.artifacts) ? summary.artifacts.length : 0}`);
  } catch (error) {
    summary.error = toErrorObject(error);
    console.error(`ERROR_NAME=${error?.name ?? "Error"}`);
    console.error(`ERROR_MESSAGE=${error?.message ?? String(error)}`);
    if (error?.code) console.error(`ERROR_CODE=${error.code}`);
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    summary.completedAt = new Date().toISOString();
    if (args.jsonOut) writeJson(args.jsonOut, summary);
    if (agent) agent.close();
  }
}

main().catch(() => {
  process.exit(1);
});
