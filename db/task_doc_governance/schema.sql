PRAGMA foreign_keys = ON;

DROP VIEW IF EXISTS task_overview;
DROP TRIGGER IF EXISTS trg_docs_touch_updated_at;
DROP TRIGGER IF EXISTS trg_tasks_touch_updated_at;
DROP TRIGGER IF EXISTS trg_tasks_sync_completed_at_on_insert;
DROP TRIGGER IF EXISTS trg_tasks_sync_completed_at_on_status_update;
DROP TABLE IF EXISTS docs;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS task_statuses;

-- ── 枚举：任务状态 ──────────────────────────────────────
CREATE TABLE task_statuses (
  status TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL UNIQUE
) STRICT;

INSERT INTO task_statuses(status, sort_order) VALUES
  ('未开始', 1),
  ('开发中', 2),
  ('delay', 3),
  ('已完成', 4);

-- ── 任务表 ──────────────────────────────────────────────
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key TEXT NOT NULL UNIQUE DEFAULT ('task_' || lower(hex(randomblob(8)))),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  module TEXT NOT NULL CHECK(length(trim(module)) > 0),
  feature TEXT NOT NULL CHECK(length(trim(feature)) > 0),
  status TEXT NOT NULL DEFAULT '未开始',
  priority INTEGER NOT NULL DEFAULT 2 CHECK(priority BETWEEN 1 AND 5),
  owner_model TEXT NOT NULL CHECK(length(trim(owner_model)) > 0),
  source TEXT NOT NULL DEFAULT 'sqlite' CHECK(source IN ('sqlite', 'manual', 'import', 'sync')),
  completion_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (status) REFERENCES task_statuses(status)
) STRICT;

-- ── 文档表 ──────────────────────────────────────────────
CREATE TABLE docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_path TEXT NOT NULL UNIQUE CHECK(local_path LIKE '%.md'),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  doc_type TEXT NOT NULL CHECK(length(trim(doc_type)) > 0),
  module TEXT NOT NULL CHECK(length(trim(module)) > 0),
  task_key TEXT NOT NULL,
  execution_model TEXT NOT NULL CHECK(length(trim(execution_model)) > 0),
  last_tracked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_key) REFERENCES tasks(task_key) ON UPDATE CASCADE ON DELETE RESTRICT
) STRICT;

-- ── 索引 ────────────────────────────────────────────────
CREATE INDEX idx_tasks_module_status ON tasks(module, status);
CREATE INDEX idx_tasks_status_priority ON tasks(status, priority);
CREATE INDEX idx_docs_task_key ON docs(task_key);
CREATE INDEX idx_docs_doc_type ON docs(doc_type);
CREATE INDEX idx_docs_module_doc_type ON docs(module, doc_type);

-- ── 触发器：自动维护 updated_at ─────────────────────────
CREATE TRIGGER trg_tasks_touch_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE tasks
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_docs_touch_updated_at
AFTER UPDATE ON docs
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE docs
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;

-- ── 触发器：自动维护 completed_at ───────────────────────
CREATE TRIGGER trg_tasks_sync_completed_at_on_insert
AFTER INSERT ON tasks
FOR EACH ROW
WHEN NEW.status = '已完成' AND NEW.completed_at IS NULL
BEGIN
  UPDATE tasks
  SET completed_at = datetime('now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_tasks_sync_completed_at_on_status_update
AFTER UPDATE OF status ON tasks
FOR EACH ROW
BEGIN
  UPDATE tasks
  SET completed_at = CASE
    WHEN NEW.status = '已完成' THEN COALESCE(NEW.completed_at, datetime('now'))
    ELSE NULL
  END
  WHERE id = NEW.id
    AND (
      (NEW.status = '已完成' AND NEW.completed_at IS NULL)
      OR (NEW.status <> '已完成' AND NEW.completed_at IS NOT NULL)
    );
END;

-- ── 视图：任务概览 ──────────────────────────────────────
CREATE VIEW task_overview AS
SELECT
  t.task_key,
  t.title,
  t.module,
  t.feature,
  t.status,
  s.sort_order AS status_order,
  t.priority,
  t.owner_model,
  COUNT(d.id) AS doc_count
FROM tasks t
JOIN task_statuses s ON s.status = t.status
LEFT JOIN docs d ON d.task_key = t.task_key
GROUP BY
  t.task_key,
  t.title,
  t.module,
  t.feature,
  t.status,
  s.sort_order,
  t.priority,
  t.owner_model;
