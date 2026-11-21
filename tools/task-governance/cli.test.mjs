import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeGovernance,
  isTemporaryPlanPath,
  issuesHaveErrors,
  openDatabaseForRebuild,
  rebuildDatabase,
} from "./cli.mjs";

const CLI_URL = new URL("./cli.mjs", import.meta.url);
const TOOL_DIR = path.dirname(fileURLToPath(CLI_URL));
const REPO_ROOT = path.resolve(TOOL_DIR, "..", "..");

function makeHeader(overrides = {}) {
  const fields = {
    TASK_KEY: "demo-task",
    DOC_TYPE: "其他",
    WORKSTREAM: "planning",
    STATUS: "draft",
    EXECUTION_MODEL: "Antigravity Gemini Neon",
    LAST_TRACKED_AT: "2026-11-21",
    ...overrides,
  };
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function createFixture(t, { readmeMapped = true, files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "damage-governance-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  const govDir = path.join(root, "db", "task_doc_governance");
  fs.mkdirSync(govDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, "db", "task_doc_governance", "document_header.schema.json"),
    path.join(govDir, "document_header.schema.json"),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, "db", "task_doc_governance", "schema.sql"),
    path.join(govDir, "schema.sql"),
  );

  const planReadmePath = "文档记录/方案/README.md";
  const allFiles = {
    [planReadmePath]: `${makeHeader({ TASK_KEY: "planning-workflow", STATUS: "tracked" })}\n\n# 方案约定\n`,
    ...files,
  };

  for (const [relativePath, content] of Object.entries(allFiles)) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
  }

  const rules = {
    docRoot: "文档记录",
    defaults: { execution_model: "multi-model" },
    exclude: [],
    tasks: [
      {
        task_key: "planning-workflow",
        title: "开发流程",
        module: "planning",
        feature: "workflow",
        status: "进行中",
        priority: 1,
        docs: readmeMapped ? [planReadmePath] : [],
      },
    ],
  };

  return { root, rules };
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  return result;
}

test("通过目录别名直接运行 CLI 时输出帮助，未知命令以 1 退出", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "damage-governance-entry-test-"));
  const alias = path.join(root, "tool alias");
  t.after(() => {
    if (fs.lstatSync(alias, { throwIfNoEntry: false })) fs.unlinkSync(alias);
    fs.rmdirSync(root);
  });
  fs.symlinkSync(TOOL_DIR, alias, process.platform === "win32" ? "junction" : "dir");
  const entry = path.join(alias, "cli.mjs");

  const help = runNode([entry, "--help"]);
  const unknown = runNode([entry, "unknown-command"]);

  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage:/);
  assert.equal(unknown.status, 1, unknown.stderr);
  assert.match(unknown.stderr, /unknown command: unknown-command/);
});

test("导入 CLI 不执行参数里的命令", () => {
  const result = runNode([
    "--input-type=module", "--eval", `await import(${JSON.stringify(CLI_URL.href)});`,
    "missing-entry.mjs", "unknown-command",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("isTemporaryPlanPath 只匹配 文档记录/方案/ 直接子层的非 README Markdown", () => {
  assert.equal(isTemporaryPlanPath("文档记录/方案/feat-a.md"), true);
  assert.equal(isTemporaryPlanPath("文档记录/方案/README.md"), false);
  assert.equal(isTemporaryPlanPath("文档记录/方案/sub/feat-a.md"), false);
  assert.equal(isTemporaryPlanPath("文档记录/方案/notes.txt"), false);
  assert.equal(isTemporaryPlanPath("文档记录/概要设计/feat-a.md"), false);
});

test("未登记临时方案通过三态校验，已登记文档沿用受管规则", (t) => {
  const plans = Object.fromEntries(["active", "draft", "returned"].map((status) => [
    `文档记录/方案/${status}.md`,
    `${makeHeader({ STATUS: status })}\n\n# 临时方案\n`,
  ]));
  const registeredDoc = "文档记录/方案/registered.md";
  const { root, rules } = createFixture(t, {
    files: {
      ...plans,
      [registeredDoc]: `${makeHeader({ TASK_KEY: "planning-workflow", STATUS: "done" })}\n\n# 受管文档\n`,
    },
  });
  rules.tasks[0].docs.push(registeredDoc);

  const issues = analyzeGovernance(rules, { readHeaders: true, repoRoot: root });
  assert.equal(issuesHaveErrors(issues), false);
  assert.deepEqual(issues.unassigned, []);
  assert.deepEqual(issues.invalidHeaders, []);
  assert.deepEqual(issues.temporaryPlans.sort(), Object.keys(plans));
});

test("临时方案文档头非法时仍报 invalidHeaders 错误", (t) => {
  const { root, rules } = createFixture(t, {
    files: {
      "文档记录/方案/bad-status.md": `${makeHeader({ STATUS: "wip" })}\n\n# 非法状态\n`,
      "文档记录/方案/missing-key.md": `${makeHeader({ TASK_KEY: undefined })}\n\n# 缺失键\n`,
    },
  });

  const issues = analyzeGovernance(rules, { readHeaders: true, repoRoot: root });
  assert.equal(issuesHaveErrors(issues), true);
  assert.deepEqual(issues.unassigned, []);
  assert.equal(issues.invalidHeaders.length, 2);
  assert.match(issues.invalidHeaders[0].reason, /invalid STATUS/);
  assert.match(issues.invalidHeaders[1].reason, /missing or empty TASK_KEY/);
});

test("未登记临时方案拒绝通用 schema 允许的其他类型和状态", (t) => {
  const invalidStatuses = ["tracked", "done", "partial", "pass"];
  const files = Object.fromEntries(invalidStatuses.map((status) => [
    `文档记录/方案/${status}.md`,
    `${makeHeader({ STATUS: status })}\n\n# 临时方案\n`,
  ]));
  const invalidTypePath = "文档记录/方案/design.md";
  files[invalidTypePath] = `${makeHeader({ DOC_TYPE: "概要设计" })}\n\n# 临时方案\n`;
  const { root, rules } = createFixture(t, { files });

  const issues = analyzeGovernance(rules, { readHeaders: true, repoRoot: root });

  assert.equal(issuesHaveErrors(issues), true);
  assert.equal(issues.invalidHeaders.length, invalidStatuses.length + 1);
  const reasons = new Map(issues.invalidHeaders.map(({ path, reason }) => [path, reason]));
  assert.match(reasons.get(invalidTypePath), /DOC_TYPE.*其他/);
  for (const status of invalidStatuses) {
    assert.match(reasons.get(`文档记录/方案/${status}.md`), /STATUS.*draft, returned, active/);
  }
});

test("方案目录的子目录文件与未登记的 README.md 仍受 unassigned 门禁拦截", (t) => {
  const { root, rules } = createFixture(t, {
    readmeMapped: false,
    files: {
      "文档记录/方案/sub/nested.md": `${makeHeader()}\n\n# 子目录文档\n`,
    },
  });

  const issues = analyzeGovernance(rules, { readHeaders: true, repoRoot: root });
  assert.equal(issuesHaveErrors(issues), true);
  assert.deepEqual(issues.temporaryPlans, []);
  assert.deepEqual(issues.unassigned.sort(), [
    "文档记录/方案/README.md",
    "文档记录/方案/sub/nested.md",
  ]);
});

test("rebuild 不将临时方案写入 SQLite，且 --fix-headers 不改写临时方案文件", async (t) => {
  const planContent = `${makeHeader({ LAST_TRACKED_AT: "pending" })}\n\n# 临时方案\n`;
  const { root, rules } = createFixture(t, {
    files: {
      "文档记录/方案/demo-task.md": planContent,
    },
  });

  const db = await openDatabaseForRebuild(root);
  const result = rebuildDatabase(db, rules, { fixHeaders: true, repoRoot: root });

  assert.deepEqual(result.unassigned, []);
  assert.deepEqual(result.temporaryPlans, ["文档记录/方案/demo-task.md"]);
  assert.equal(result.changedHeaders.includes("文档记录/方案/demo-task.md"), false);
  assert.equal(
    fs.readFileSync(path.join(root, "文档记录", "方案", "demo-task.md"), "utf8"),
    planContent,
  );

  const stmt = db.prepare("SELECT local_path FROM docs ORDER BY local_path");
  const paths = [];
  while (stmt.step()) {
    paths.push(stmt.getAsObject().local_path);
  }
  stmt.free();
  assert.deepEqual(paths, ["文档记录/方案/README.md"]);
});
