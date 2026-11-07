#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

// Run the actual entrypoint and common module without inheriting credentials,
// SDK caches, CLI paths, or Node preload options from the developer's machine.
function withIsolatedSmoke(check) {
  const root = mkdtempSync(join(tmpdir(), "cursor-smoke-local-only-"));
  try {
    for (const name of ["cursor_local_agent_smoke.mjs", "cursor_local_agent_common.mjs"]) {
      copyFileSync(new URL(name, import.meta.url), join(root, name));
    }
    const workingDir = join(root, "work");
    mkdirSync(workingDir);
    const attemptsPath = join(root, "forbidden-attempts.txt");
    const guardPath = join(root, "guard.cjs");
    writeFileSync(guardPath, `
const fs = require("node:fs");
const Module = require("node:module");
const record = fs.appendFileSync.bind(fs);
function denied(kind) {
  record(${JSON.stringify(attemptsPath)}, kind + "\\n");
  throw new Error("Offline smoke attempted " + kind);
}
process.env = new Proxy(process.env, {
  get(target, name) {
    if (typeof name === "string" && name.toLowerCase() === "cursor_api_key") {
      return denied("api-key-read");
    }
    return Reflect.get(target, name);
  },
});
const childProcess = require("node:child_process");
for (const name of ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"]) {
  childProcess[name] = () => denied("external-command");
}
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...rest) {
  if (request === "@cursor/sdk" || request.startsWith("@cursor/sdk/")) {
    return denied("sdk-resolve");
  }
  return originalResolve.call(this, request, ...rest);
};
for (const name of ["existsSync", "readFileSync", "statSync", "readdirSync", "accessSync"]) {
  const original = fs[name];
  fs[name] = function(path, ...rest) {
    const normalized = String(path).replaceAll("\\\\", "/");
    if (normalized.split("/").some(part => part === "node_modules" || part === "cursor-sdk-smoke-deps")) {
      return denied("sdk-probe");
    }
    return original.call(this, path, ...rest);
  };
}
for (const name of ["node:http", "node:https"]) {
  const transport = require(name);
  transport.request = transport.get = () => denied("network-request");
}
const net = require("node:net");
net.connect = net.createConnection = net.Socket.prototype.connect = () => denied("network-request");
globalThis.fetch = () => denied("network-request");
Module.syncBuiltinESMExports();
`, "utf8");
    const env = {
      PATH: "",
      HOME: root,
      USERPROFILE: root,
      TEMP: root,
      TMP: root,
      TMPDIR: root,
    };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    const run = (args) => spawnSync(process.execPath, [
      "--require", guardPath,
      join(root, "cursor_local_agent_smoke.mjs"),
      "--cwd", workingDir,
      ...args,
    ], { cwd: workingDir, env, encoding: "utf8", timeout: 10000 });
    check({ root, workingDir, attemptsPath, run });
  } finally {
    // Delete only this test's verified temporary directory.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("cursor-smoke-local-only-"));
    rmSync(root, { recursive: true, force: true });
  }
}

for (const scenario of [
  { name: "默认不发送", args: [], artifacts: false },
  { name: "显式空跑", args: ["--dry-run"], artifacts: true },
  { name: "发送后指定空跑", args: ["--send", "--dry-run"], artifacts: true },
  { name: "空跑后指定发送", args: ["--dry-run", "--send"], artifacts: true },
]) {
  test(`${scenario.name}：无密钥、无 SDK 时只检查本地参数`, () => {
    withIsolatedSmoke(({ root, workingDir, attemptsPath, run }) => {
      const outDir = join(root, "evidence");
      const result = run([...scenario.args, ...(scenario.artifacts ? ["--out-dir", outDir] : [])]);
      assert.ifError(result.error);
      assert.equal(existsSync(attemptsPath), false, "空跑触碰了密钥、SDK、外部命令或网络边界");
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.signal, null);
      assert.equal(result.stderr, "");
      const modelLine = result.stdout.split(/\r?\n/).find(line => line.startsWith("REQUESTED_MODEL="));
      assert.ok(modelLine, "必须输出待检查的固定参数");
      const expectedModel = {
        id: "grok-4.7",
        params: [
          { id: "context", value: "256k" },
          { id: "reasoning_effort", value: "xhigh" },
          { id: "fast", value: "false" },
        ],
      };
      assert.deepEqual(JSON.parse(modelLine.slice("REQUESTED_MODEL=".length)), expectedModel);
      assert.match(result.stdout, /^SETTING_SOURCES=\[\]$/m);
      assert.match(result.stdout, /^PREFLIGHT=SKIPPED_DRY_RUN$/m);
      assert.deepEqual(readdirSync(workingDir), []);
      if (!scenario.artifacts) {
        assert.equal(existsSync(outDir), false);
        return;
      }
      const summary = JSON.parse(readFileSync(join(outDir, "summary.json"), "utf8"));
      assert.equal(summary.dryRun, true);
      assert.equal(summary.send, false);
      assert.deepEqual(summary.requestedModel, expectedModel);
      assert.equal(summary.requestedCwd, workingDir);
      assert.equal(summary.preflight, null);
      for (const field of ["apiKeyPresent", "apiKeyLength", "sdk", "sdkPath", "storePath", "agentId", "runId"]) {
        assert.equal(Object.hasOwn(summary, field), false, `${field} 不应伪装为已检查`);
      }
      assert.deepEqual(summary.statuses, []);
      assert.deepEqual(summary.eventCountByType, {});
      assert.equal(summary.assistantText, "");
      assert.deepEqual(summary.toolCalls, []);
      assert.ok(summary.completedAt);
      assert.equal(readFileSync(join(outDir, "events.jsonl"), "utf8"), "");
      assert.deepEqual(readdirSync(outDir).sort(), ["events.jsonl", "summary.json"]);
    });
  });
}

test("仅指定 --send 时仍进入真实预检入口，测试在读取凭据前拦截", () => {
  withIsolatedSmoke(({ attemptsPath, run }) => {
    const result = run(["--send"]);
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(attemptsPath, "utf8"), "api-key-read\n");
    assert.doesNotMatch(result.stdout, /PREFLIGHT=SKIPPED_DRY_RUN/);
  });
});
