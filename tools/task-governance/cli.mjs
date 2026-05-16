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

const DOC_TYPE_BY_DIR = new Map([
  ["\u9700\u6c42\u6f84\u6e05", "\u9700\u6c42\u6f84\u6e05"],
  ["\u6982\u8981\u8bbe\u8ba1", "\u6982\u8981\u8bbe\u8ba1"],
  ["\u8be6\u7ec6\u8bbe\u8ba1", "\u8be6\u7ec6\u8bbe\u8ba1"],
  ["\u6d4b\u8bd5\u8bb0\u5f55", "\u6d4b\u8bd5\u8bb0\u5f55"],
]);

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join("/");
}

const TASK_STATUS_ALIASES = new Map([
  ["\u672a\u5f00\u59cb", "\u672a\u5f00\u59cb"],
  ["\u5f00\u53d1\u4e2d", "\u5f00\u53d1\u4e2d"],
  ["\u8fdb\u884c\u4e2d", "\u5f00\u53d1\u4e2d"],
  ["delay", "delay"],
  ["\u5ef6\u671f", "delay"],
  ["\u5ef6\u8fdf", "delay"],
  ["\u5df2\u5b8c\u6210", "\u5df2\u5b8c\u6210"],
  ["\u5b8c\u6210", "\u5df2\u5b8c\u6210"],
]);

function repoRelative(absolutePath) {
  return normalizeRelative(path.relative(REPO_ROOT, absolutePath));
}

function nowTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
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

function walkMarkdownFiles(rootDir) {
  const files = [];
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
    return "\u4efb\u52a1\u5355";
  }
  return DOC_TYPE_BY_DIR.get(segments[1]) ?? "\u5176\u4ed6";
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

async function openDatabase({ resetSchema = false } = {}) {
  ensureDir(DB_DIR);
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(TOOL_DIR, "node_modules", "sql.js", "dist", file),
  });

  const dbExists = fs.existsSync(DB_FILE);
  const db = dbExists
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();

  db.run("PRAGMA foreign_keys = ON;");
  if (resetSchema || !dbExists) {
    db.run(readText(SCHEMA_FILE));
  }
  return db;
}

function saveDatabase(db) {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function buildTaskLookup(rules) {
  const docToTask = new Map();
  for (const task of rules.tasks) {
    for (const relativePath of task.docs) {
      if (docToTask.has(relativePath)) {
        throw new Error(`duplicate doc assignment: ${relativePath}`);
      }
      docToTask.set(relativePath, task);
    }
  }
  return docToTask;
}

function rebuildDatabase(db, rules) {
  const timestamp = nowTimestamp();
  const docRoot = path.join(REPO_ROOT, rules.docRoot);
  const markdownFiles = walkMarkdownFiles(docRoot);
  const excluded = new Set(rules.exclude);
  const managedFiles = markdownFiles
    .map(repoRelative)
    .filter((relativePath) => !excluded.has(relativePath));
  const taskLookup = buildTaskLookup(rules);
  const unassigned = managedFiles.filter((relativePath) => !taskLookup.has(relativePath));
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
        task.owner_model ?? rules.defaults.execution_model,
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
      const nextHeader = buildHeader({
        taskKey: task.task_key,
        docType,
        workstream: task.workstream ?? task.module,
        executionModel: task.owner_model ?? rules.defaults.execution_model,
        lastTrackedAt:
          parsed.metadata.LAST_TRACKED_AT ??
          parsed.metadata.LAST_SYNC_AT ??
          timestamp,
        status:
          parsed.metadata.STATUS && parsed.metadata.STATUS !== "pending_sync"
            ? parsed.metadata.STATUS
            : "tracked",
      });
      const nextContent = `${nextHeader}\n${parsed.body}`.replace(/\n+$/, "\n");

      if (writeTextIfChanged(absolutePath, nextContent)) {
        changedHeaders.push(relativePath);
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
          rules.defaults.execution_model,
          parsed.metadata.LAST_TRACKED_AT ??
            parsed.metadata.LAST_SYNC_AT ??
            timestamp,
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

async function main() {
  const command = process.argv[2] ?? "rebuild";
  const rules = readJson(RULES_FILE);
  const db = await openDatabase({ resetSchema: command === "rebuild" });

  if (command === "rebuild") {
    const result = rebuildDatabase(db, rules);
    saveDatabase(db);
    console.log(`database: ${repoRelative(DB_FILE)}`);
    console.log(`tasks: ${rules.tasks.length}`);
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
  } else if (command === "tasks") {
    printTaskSummary(db);
  } else if (command === "docs") {
    printDocsForTask(db, process.argv[3]);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

