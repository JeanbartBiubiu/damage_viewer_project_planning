#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..", "..");
const DB_DIR = path.join(REPO_ROOT, "db", "task_doc_governance");
const DB_FILE = path.join(DB_DIR, "task_doc_governance.sqlite");
const SCHEMA_FILE = path.join(DB_DIR, "schema.sql");
const RULES_FILE = path.join(DB_DIR, "task_rules.json");
const HEADER_SCHEMA_FILE = path.join(DB_DIR, "document_header.schema.json");

const DOC_TYPE_BY_DIR = new Map([
  ["需求澄清", "需求澄清"],
  ["概要设计", "概要设计"],
  ["详细设计", "详细设计"],
  ["测试记录", "测试记录"],
]);

const TASK_STATUS_ALIASES = new Map([
  ["未开始", "未开始"],
  ["开发中", "开发中"],
  ["进行中", "开发中"],
  ["delay", "delay"],
  ["延期", "delay"],
  ["延迟", "delay"],
  ["已完成", "已完成"],
  ["完成", "已完成"],
]);

let headerContractCache = null;

function printUsage() {
  console.log(`Usage:
  node tools/task-governance/cli.mjs help
  node tools/task-governance/cli.mjs check
  node tools/task-governance/cli.mjs doctor
  node tools/task-governance/cli.mjs tasks
  node tools/task-governance/cli.mjs docs <task_key>
  node tools/task-governance/cli.mjs rebuild [--fix-headers]

Notes:
  - No args / help / --help: print usage (no writes).
  - check / doctor: read-only governance validation (non-zero on errors).
  - tasks / docs: read-only SQLite queries; fail if the derived DB is missing (run rebuild).
  - rebuild: writes SQLite only by default.
  - rebuild --fix-headers: also updates Markdown governance headers.
  - task_rules.json is the sole task/doc mapping and task-status source.
  - document_header.schema.json is the machine-readable document header contract
    (required keys, STATUS enum, DOC_TYPE enum).
`);
}

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join("/");
}

function repoRelative(absolutePath) {
  return normalizeRelative(path.relative(REPO_ROOT, absolutePath));
}

function nowTimestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeTextIfChanged(filePath, content) {
  const current = fs.readFileSync(filePath, "utf8");
  if (current !== content) {
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  }
  return false;
}

function loadHeaderContract() {
  if (headerContractCache) {
    return headerContractCache;
  }
  if (!fs.existsSync(HEADER_SCHEMA_FILE)) {
    throw new Error(`missing header schema: ${repoRelative(HEADER_SCHEMA_FILE)}`);
  }
  const schema = readJson(HEADER_SCHEMA_FILE);
  const required = schema.required;
  const statusEnum = schema.properties?.STATUS?.enum;
  const docTypeEnum = schema.properties?.DOC_TYPE?.enum;
  if (!Array.isArray(required) || required.length === 0) {
    throw new Error("document_header.schema.json must declare required keys");
  }
  if (!Array.isArray(statusEnum) || statusEnum.length === 0) {
    throw new Error("document_header.schema.json must declare STATUS.enum");
  }
  if (!Array.isArray(docTypeEnum) || docTypeEnum.length === 0) {
    throw new Error("document_header.schema.json must declare DOC_TYPE.enum");
  }
  headerContractCache = {
    required,
    allowedKeys: new Set(Object.keys(schema.properties ?? {})),
    acceptedDocStatus: new Set(statusEnum),
    acceptedDocTypes: new Set(docTypeEnum),
  };
  return headerContractCache;
}

function walkMarkdownFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) {
    return files;
  }
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(absolute);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function parseHeader(content) {
  const lines = content.split(/\r?\n/);
  let index = 0;
  const metadata = {};

  if (lines[index]?.startsWith("<!-- notion_page_id:")) {
    index += 1;
  }

  while (index < lines.length) {
    const line = lines[index];
    const match = line.match(/^([A-Z_]+):\s*(.*)$/);
    if (!match) {
      break;
    }
    metadata[match[1]] = match[2];
    index += 1;
  }

  while (index < lines.length && lines[index] === "") {
    index += 1;
  }

  return {
    metadata,
    body: lines.slice(index).join("\n"),
  };
}

function extractTitle(body, fallbackPath) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim();
    }
  }
  return path.basename(fallbackPath, ".md");
}

function deriveDocType(relativePath) {
  const segments = relativePath.split("/");
  if (segments.includes("subagent_tasks")) {
    return "任务单";
  }
  return DOC_TYPE_BY_DIR.get(segments[1]) ?? "其他";
}

function normalizeTaskStatus(status) {
  const normalized = TASK_STATUS_ALIASES.get(status);
  if (!normalized) {
    throw new Error(
      `unsupported task status "${status}". allowed: ${Array.from(new Set(TASK_STATUS_ALIASES.values())).join(", ")}`,
    );
  }
  return normalized;
}

function resolveLastTrackedAt(metadata, timestamp) {
  const current = String(metadata.LAST_TRACKED_AT ?? metadata.LAST_SYNC_AT ?? "").trim();
  if (!current || current === "pending") {
    return timestamp;
  }
  return current;
}

function buildHeader({ taskKey, docType, workstream, executionModel, lastTrackedAt, status }) {
  return [
    `TASK_KEY: ${taskKey}`,
    `DOC_TYPE: ${docType}`,
    `WORKSTREAM: ${workstream}`,
    `STATUS: ${status}`,
    `EXECUTION_MODEL: ${executionModel}`,
    `LAST_TRACKED_AT: ${lastTrackedAt}`,
    "",
  ].join("\n");
}

function statement(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
}

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function openDatabaseForRebuild() {
  ensureDir(DB_DIR);
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(TOOL_DIR, "node_modules", "sql.js", "dist", file),
  });
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");
  db.run(readText(SCHEMA_FILE));
  return db;
}

async function openDatabaseForQuery() {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(
      `derived SQLite missing: ${repoRelative(DB_FILE)}. Run: node tools/task-governance/cli.mjs rebuild`,
    );
  }
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(TOOL_DIR, "node_modules", "sql.js", "dist", file),
  });
  const db = new SQL.Database(fs.readFileSync(DB_FILE));
  db.run("PRAGMA foreign_keys = ON;");
  return db;
}

function saveDatabase(db) {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function loadRules() {
  if (!fs.existsSync(RULES_FILE)) {
    throw new Error(`missing rules file: ${repoRelative(RULES_FILE)}`);
  }
  return readJson(RULES_FILE);
}

function buildTaskLookup(rules) {
  const docToTask = new Map();
  const duplicates = [];
  for (const task of rules.tasks ?? []) {
    for (const relativePath of task.docs ?? []) {
      if (docToTask.has(relativePath)) {
        duplicates.push({
          path: relativePath,
          first: docToTask.get(relativePath).task_key,
          second: task.task_key,
        });
        continue;
      }
      docToTask.set(relativePath, task);
    }
  }
  return { docToTask, duplicates };
}

function validateHeaderMetadata(metadata, relativePath, task, issues) {
  const contract = loadHeaderContract();
  for (const key of contract.required) {
    if (!metadata[key] || String(metadata[key]).trim() === "") {
      issues.invalidHeaders.push({
        path: relativePath,
        reason: `missing or empty ${key}`,
      });
    }
  }
  if (metadata.STATUS && !contract.acceptedDocStatus.has(metadata.STATUS)) {
    issues.invalidHeaders.push({
      path: relativePath,
      reason: `invalid STATUS "${metadata.STATUS}" (allowed: ${[...contract.acceptedDocStatus].join(", ")})`,
    });
  }
  if (metadata.DOC_TYPE && !contract.acceptedDocTypes.has(metadata.DOC_TYPE)) {
    issues.invalidHeaders.push({
      path: relativePath,
      reason: `invalid DOC_TYPE "${metadata.DOC_TYPE}" (allowed: ${[...contract.acceptedDocTypes].join(", ")})`,
    });
  }
  for (const key of Object.keys(metadata)) {
    // Schema is additionalProperties:false — legacy LAST_SYNC_AT is unexpected on check.
    // rebuild --fix-headers may still read LAST_SYNC_AT via resolveLastTrackedAt for migration.
    if (!contract.allowedKeys.has(key)) {
      issues.invalidHeaders.push({
        path: relativePath,
        reason: `unexpected header field ${key}`,
      });
    }
  }

  if (!task) {
    return;
  }

  const expectedDocType = deriveDocType(relativePath);
  const expectedWorkstream = task.workstream ?? task.module;
  if (metadata.TASK_KEY && metadata.TASK_KEY !== task.task_key) {
    issues.invalidHeaders.push({
      path: relativePath,
      reason: `TASK_KEY mismatch: header="${metadata.TASK_KEY}" expected="${task.task_key}"`,
    });
  }
  if (metadata.DOC_TYPE && metadata.DOC_TYPE !== expectedDocType) {
    issues.invalidHeaders.push({
      path: relativePath,
      reason: `DOC_TYPE mismatch: header="${metadata.DOC_TYPE}" expected="${expectedDocType}"`,
    });
  }
  if (metadata.WORKSTREAM && expectedWorkstream && metadata.WORKSTREAM !== expectedWorkstream) {
    issues.invalidHeaders.push({
      path: relativePath,
      reason: `WORKSTREAM mismatch: header="${metadata.WORKSTREAM}" expected="${expectedWorkstream}"`,
    });
  }
}

function analyzeGovernance(rules, { readHeaders = true } = {}) {
  const issues = {
    invalidRules: [],
    duplicates: [],
    missing: [],
    unassigned: [],
    invalidHeaders: [],
  };

  if (!rules.docRoot || typeof rules.docRoot !== "string") {
    issues.invalidRules.push("rules.docRoot must be a string");
  }
  if (!Array.isArray(rules.tasks)) {
    issues.invalidRules.push("rules.tasks must be an array");
    return issues;
  }

  try {
    loadHeaderContract();
  } catch (error) {
    issues.invalidRules.push(error.message);
  }

  const seenKeys = new Set();
  for (const task of rules.tasks) {
    if (!task.task_key) {
      issues.invalidRules.push("task missing task_key");
      continue;
    }
    if (seenKeys.has(task.task_key)) {
      issues.invalidRules.push(`duplicate task_key: ${task.task_key}`);
    }
    seenKeys.add(task.task_key);
    try {
      normalizeTaskStatus(task.status);
    } catch (error) {
      issues.invalidRules.push(`${task.task_key}: ${error.message}`);
    }
    if (!Array.isArray(task.docs)) {
      issues.invalidRules.push(`${task.task_key}: docs must be an array`);
    }
  }

  const { docToTask, duplicates } = buildTaskLookup(rules);
  issues.duplicates = duplicates.map(
    (item) => `${item.path} assigned to ${item.first} and ${item.second}`,
  );

  for (const task of rules.tasks) {
    for (const relativePath of task.docs ?? []) {
      const absolutePath = path.join(REPO_ROOT, ...relativePath.split("/"));
      if (!fs.existsSync(absolutePath)) {
        issues.missing.push(relativePath);
        continue;
      }
      if (!readHeaders) continue;
      try {
        const parsed = parseHeader(readText(absolutePath));
        validateHeaderMetadata(parsed.metadata, relativePath, task, issues);
      } catch (error) {
        issues.invalidHeaders.push({
          path: relativePath,
          reason: error.message,
        });
      }
    }
  }

  const docRoot = path.join(REPO_ROOT, rules.docRoot || "文档记录");
  const excluded = new Set(rules.exclude ?? []);
  const managedFiles = walkMarkdownFiles(docRoot)
    .map(repoRelative)
    .filter((relativePath) => !excluded.has(relativePath));
  issues.unassigned = managedFiles.filter((relativePath) => !docToTask.has(relativePath));

  return issues;
}

function issuesHaveErrors(issues) {
  return (
    issues.invalidRules.length > 0 ||
    issues.duplicates.length > 0 ||
    issues.missing.length > 0 ||
    issues.unassigned.length > 0 ||
    issues.invalidHeaders.length > 0
  );
}

function printIssues(issues, { includeUnassigned = true } = {}) {
  console.log(`invalid_rules: ${issues.invalidRules.length}`);
  for (const item of issues.invalidRules) console.log(`  - ${item}`);
  console.log(`duplicate_assignments: ${issues.duplicates.length}`);
  for (const item of issues.duplicates) console.log(`  - ${item}`);
  console.log(`missing_docs: ${issues.missing.length}`);
  for (const item of issues.missing) console.log(`  - ${item}`);
  console.log(`invalid_headers: ${issues.invalidHeaders.length}`);
  for (const item of issues.invalidHeaders) {
    console.log(`  - ${item.path}: ${item.reason}`);
  }
  if (includeUnassigned) {
    console.log(`unassigned_docs: ${issues.unassigned.length}`);
    for (const item of issues.unassigned) console.log(`  - ${item}`);
  }
}

function rebuildDatabase(db, rules, { fixHeaders = false } = {}) {
  const timestamp = nowTimestamp();
  const contract = loadHeaderContract();
  const { docToTask, duplicates } = buildTaskLookup(rules);
  if (duplicates.length > 0) {
    throw new Error(`duplicate doc assignment: ${duplicates[0].path}`);
  }

  const docRoot = path.join(REPO_ROOT, rules.docRoot);
  const markdownFiles = walkMarkdownFiles(docRoot);
  const excluded = new Set(rules.exclude ?? []);
  const managedFiles = markdownFiles
    .map(repoRelative)
    .filter((relativePath) => !excluded.has(relativePath));
  const unassigned = managedFiles.filter((relativePath) => !docToTask.has(relativePath));
  const missing = [];
  const changedHeaders = [];

  statement(db, "BEGIN");
  statement(db, "DELETE FROM docs");
  statement(db, "DELETE FROM tasks");

  for (const task of rules.tasks) {
    const normalizedStatus = normalizeTaskStatus(task.status);

    statement(
      db,
      `
        INSERT INTO tasks (
          task_key, title, module, feature, status, priority,
          owner_model, source, completion_note, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        task.task_key,
        task.title,
        task.module,
        task.feature,
        normalizedStatus,
        task.priority,
        task.owner_model ?? rules.defaults?.execution_model ?? "multi-model",
        "sqlite",
        task.completion_note ?? null,
        normalizedStatus === "已完成" ? (task.completed_at ?? null) : null,
      ],
    );

    for (const relativePath of task.docs) {
      const absolutePath = path.join(REPO_ROOT, ...relativePath.split("/"));
      if (!fs.existsSync(absolutePath)) {
        missing.push(relativePath);
        continue;
      }

      const original = readText(absolutePath);
      const parsed = parseHeader(original);
      const docType = deriveDocType(relativePath);
      const executionModel =
        task.owner_model ??
        parsed.metadata.EXECUTION_MODEL ??
        rules.defaults?.execution_model ??
        "multi-model";
      const status =
        parsed.metadata.STATUS &&
        parsed.metadata.STATUS !== "pending_sync" &&
        contract.acceptedDocStatus.has(parsed.metadata.STATUS)
          ? parsed.metadata.STATUS
          : parsed.metadata.STATUS && parsed.metadata.STATUS !== "pending_sync"
            ? parsed.metadata.STATUS
            : "tracked";
      const lastTrackedAt = resolveLastTrackedAt(parsed.metadata, timestamp);

      if (fixHeaders) {
        const nextHeader = buildHeader({
          taskKey: task.task_key,
          docType,
          workstream: task.workstream ?? task.module,
          executionModel,
          lastTrackedAt,
          status: contract.acceptedDocStatus.has(status) ? status : "tracked",
        });
        const nextContent = `${nextHeader}\n${parsed.body}`.replace(/\n+$/, "\n");
        if (writeTextIfChanged(absolutePath, nextContent)) {
          changedHeaders.push(relativePath);
        }
      }

      statement(
        db,
        `
          INSERT INTO docs (
            local_path, title, doc_type, module, task_key,
            execution_model, last_tracked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          relativePath,
          extractTitle(parsed.body, relativePath),
          docType,
          task.module,
          task.task_key,
          executionModel,
          lastTrackedAt,
        ],
      );
    }
  }

  statement(db, "COMMIT");

  return {
    changedHeaders,
    missing,
    unassigned,
  };
}

function printTaskSummary(db) {
  const rows = queryRows(
    db,
    `
      SELECT task_key, title, module, status, status_order, priority, doc_count
      FROM task_overview
      ORDER BY module, status_order, priority, task_key
    `,
  );

  for (const row of rows) {
    console.log(
      [
        row.module,
        row.status,
        `P${row.priority}`,
        row.task_key,
        `${row.title} (${row.doc_count} docs)`,
      ].join("\t"),
    );
  }
}

function printDocsForTask(db, taskKey) {
  if (!taskKey) {
    throw new Error("usage: node cli.mjs docs <task_key>");
  }

  const rows = queryRows(
    db,
    `
      SELECT local_path, doc_type, title
      FROM docs
      WHERE task_key = ?
      ORDER BY local_path
    `,
    [taskKey],
  );

  for (const row of rows) {
    console.log(`${row.doc_type}\t${row.local_path}\t${row.title}`);
  }
}

async function runCheck() {
  const rules = loadRules();
  const issues = analyzeGovernance(rules, { readHeaders: true });
  console.log(`rules: ${repoRelative(RULES_FILE)}`);
  console.log(`header_schema: ${repoRelative(HEADER_SCHEMA_FILE)}`);
  console.log(`tasks: ${rules.tasks?.length ?? 0}`);
  printIssues(issues);
  if (issuesHaveErrors(issues)) {
    process.exitCode = 1;
  }
}

async function runRebuild(argv) {
  const fixHeaders = argv.includes("--fix-headers");
  const rules = loadRules();
  const preIssues = analyzeGovernance(rules, { readHeaders: true });
  if (preIssues.duplicates.length > 0 || preIssues.invalidRules.length > 0) {
    printIssues(preIssues);
    throw new Error("refusing rebuild due to invalid rules or duplicate assignments");
  }

  const db = await openDatabaseForRebuild();
  const result = rebuildDatabase(db, rules, { fixHeaders });
  saveDatabase(db);

  console.log(`database: ${repoRelative(DB_FILE)}`);
  console.log(`tasks: ${rules.tasks.length}`);
  console.log(`fix_headers: ${fixHeaders}`);
  console.log(`header_updates: ${result.changedHeaders.length}`);
  console.log(`unassigned_docs: ${result.unassigned.length}`);
  if (result.unassigned.length > 0) {
    console.log("unassigned:");
    for (const relativePath of result.unassigned) {
      console.log(`  - ${relativePath}`);
    }
  }
  if (result.missing.length > 0) {
    console.log("missing:");
    for (const relativePath of result.missing) {
      console.log(`  - ${relativePath}`);
    }
  }
  printTaskSummary(db);

  const postIssues = analyzeGovernance(rules, { readHeaders: true });
  postIssues.missing = [...new Set([...postIssues.missing, ...result.missing])];
  postIssues.unassigned = result.unassigned;
  printIssues(postIssues);
  if (issuesHaveErrors(postIssues)) {
    process.exitCode = 1;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "check" || command === "doctor") {
    await runCheck();
    return;
  }

  if (command === "rebuild") {
    await runRebuild(argv.slice(1));
    return;
  }

  if (command === "tasks") {
    const db = await openDatabaseForQuery();
    printTaskSummary(db);
    return;
  }

  if (command === "docs") {
    const db = await openDatabaseForQuery();
    printDocsForTask(db, argv[1]);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
