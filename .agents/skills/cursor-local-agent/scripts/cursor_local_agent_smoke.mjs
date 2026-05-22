#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const MODEL = {
  id: "composer-2.5",
  params: [{ id: "fast", value: "false" }],
};

function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    send: false,
    dryRun: false,
    prompt: "Do not create, edit, or delete files. Reply exactly: FAST_FALSE_SMOKE_OK",
    name: "codex-fast-false-smoke",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = resolve(argv[++i]);
    else if (arg === "--send") args.send = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--prompt") args.prompt = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node cursor_local_agent_smoke.mjs --dry-run
  node cursor_local_agent_smoke.mjs --cwd <repo> --send

Options:
  --cwd <path>       Cursor local agent working directory. Defaults to cwd.
  --send             Actually send the smoke prompt. This consumes Cursor usage.
  --dry-run          Validate config and print the requested non-fast model only.
  --prompt <text>    Override smoke prompt.
  --name <name>      Agent name.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.send) args.dryRun = true;
  return args;
}

function readUserEnv(name) {
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

function getApiKey() {
  return (
    process.env.CURSOR_API_KEY ||
    process.env.cursor_api_key ||
    readUserEnv("CURSOR_API_KEY") ||
    readUserEnv("cursor_api_key")
  );
}

function ensureSdkPackage() {
  const fromCwd = createRequire(join(process.cwd(), "package.json"));
  try {
    return fromCwd.resolve("@cursor/sdk");
  } catch {
    // Fall through to a temp dependency cache.
  }

  const cacheDir = join(tmpdir(), "cursor-sdk-smoke-deps");
  const pkgDir = join(cacheDir, "node_modules", "@cursor", "sdk");
  if (!existsSync(pkgDir)) {
    mkdirSync(cacheDir, { recursive: true });
    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    execFileSync(npmBin, ["install", "--prefix", cacheDir, "@cursor/sdk@1.0.13", "--silent"], {
      stdio: "inherit",
    });
  }

  return createRequire(join(cacheDir, "package.json")).resolve("@cursor/sdk");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = getApiKey();
  console.log(`API_KEY=${apiKey ? `SET length=${apiKey.length}` : "NOT_SET"}`);
  console.log(`REQUESTED_MODEL=${JSON.stringify(MODEL)}`);
  console.log(`CWD=${args.cwd}`);

  const sdkPath = ensureSdkPackage();
  console.log(`SDK_READY=${Boolean(sdkPath)}`);

  if (!apiKey) throw new Error("CURSOR_API_KEY is not available");
  if (args.dryRun) return;

  const requireSdk = createRequire(import.meta.url);
  const { Agent } = requireSdk(sdkPath);
  const cwd = existsSync(args.cwd) ? args.cwd : mkdtempSync(join(tmpdir(), "cursor-sdk-fastfalse-smoke-"));

  const agent = await Agent.create({
    apiKey,
    name: args.name,
    model: MODEL,
    local: { cwd },
  });

  console.log(`AGENT_ID=${agent.agentId}`);
  const run = await agent.send(args.prompt);
  const statuses = [];
  let text = "";

  for await (const event of run.stream()) {
    if (event.type === "status") statuses.push(event.status);
    if (event.type === "assistant" && event.message && Array.isArray(event.message.content)) {
      for (const block of event.message.content) {
        if (block.type === "text") text += block.text;
      }
    }
  }

  const result = await run.wait();
  console.log(`STATUSES=${statuses.join(",")}`);
  console.log(`ASSISTANT_TEXT=${text.trim()}`);
  console.log(`RESULT_MODEL=${JSON.stringify(result.model)}`);
  console.log(`RUN_RESULT=${JSON.stringify(result)}`);
  agent.close();
}

main().catch((error) => {
  console.error(`ERROR_NAME=${error?.name ?? "Error"}`);
  console.error(`ERROR_MESSAGE=${error?.message ?? String(error)}`);
  if (error?.code) console.error(`ERROR_CODE=${error.code}`);
  process.exit(1);
});
