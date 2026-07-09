import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

export const MODEL = {
  id: "grok-4.5",
};

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

export function ensureSdkPackage(baseCwd) {
  for (const root of [baseCwd, process.cwd()]) {
    if (!root) continue;
    try {
      const fromRoot = createRequire(join(root, "package.json"));
      return fromRoot.resolve("@cursor/sdk");
    } catch {
      // Try the next resolution root.
    }
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
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code,
    stack: error?.stack,
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
    probe.strictModelFallbackAllowed = true;
    probe.note =
      "cursor-agent is available and can be used for best-effort CLI fallback with --model grok-4.5.";
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
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const cursorUseHttp1 = process.env.CURSOR_USE_HTTP1 ?? "";
  const cliProbe = probeCursorCli();
  const sdk = {
    resolved: false,
    path: null,
    error: null,
  };
  const checks = [];
  const blocking = [];
  const warnings = [];

  if (requireSdk) {
    try {
      sdk.path = ensureSdkPackage(cwd);
      sdk.resolved = Boolean(sdk.path);
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
  if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
    warnings.push(`Node ${process.versions.node} is older than the recommended Node 20+ runtime.`);
  }
  if (!cliProbe.cursorAgentPath) {
    warnings.push(cliProbe.note);
  }
  checks.push({
    id: "runtime.node",
    status: Number.isInteger(nodeMajor) && nodeMajor >= 20 ? "ok" : "warn",
    message: `Node ${process.versions.node}`,
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
    message: sdk.path ?? sdk.error?.message ?? "not resolved",
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
