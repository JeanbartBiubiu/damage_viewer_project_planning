---
name: task-doc-governance
description: Use when work needs SQLite-based local task and document governance under 文档记录, feature-level task splitting, TASK_KEY maintenance, or check/rebuild/query of the local governance database.
---

# Task Doc Governance

Use this skill when the task includes task-state or document-mapping changes, or an explicit governance check. Routine code edits and internal implementation steps do not each require task entries, document headers, or index rebuilds.

The planning/master copy under `.agents/skills/task-doc-governance` is canonical for the shared skill. The CLI resolves the repository from its script location and stays portable across worktrees. Prefer merge/cherry-pick over hand-copied divergent variants.

`REPO_ROOT` = current Git repository root (not this skill directory).

Read:

- Skill-local: `references/sqlite-governance-playbook.md`
- Repo: `<repo-root>/db/task_doc_governance/document_header.schema.json` (header contract)

## When To Use

Use this skill if any of the following are true:

- the user wants to organize or reclassify Markdown docs under `文档记录/`
- the user wants implementation tasks tracked by feature instead of by coarse folder bucket
- local Markdown headers need `TASK_KEY`, `DOC_TYPE`, `WORKSTREAM`, or other governance metadata maintained
- the local SQLite governance database needs to be checked, rebuilt, or queried
- existing docs need to be remapped in `<repo-root>/db/task_doc_governance/task_rules.json`

## Fixed Workspace Conventions

Paths below are under `REPO_ROOT` unless marked skill-local:

- local doc root: `<repo-root>/文档记录`
- SQLite schema: `<repo-root>/db/task_doc_governance/schema.sql`
- task rules: `<repo-root>/db/task_doc_governance/task_rules.json` (**sole** task/doc mapping and task-status source)
- header contract: `<repo-root>/db/task_doc_governance/document_header.schema.json` (machine-readable required keys + STATUS/DOC_TYPE enums)
- SQLite db file: `<repo-root>/db/task_doc_governance/task_doc_governance.sqlite` (derived query output only)
- CLI: `<repo-root>/tools/task-governance/cli.mjs`
- Skill-local playbook: `references/sqlite-governance-playbook.md`
- Markdown headers identify documents; they do **not** replace mapping
- Obsidian memory notes are supplementary context only

Local document directories:

- `<repo-root>/文档记录/需求澄清`
- `<repo-root>/文档记录/概要设计`
- `<repo-root>/文档记录/详细设计`
- `<repo-root>/文档记录/测试记录`

## Default Workflow

1. Read `references/sqlite-governance-playbook.md` and the header schema.
2. Split tasks by feature implementation. Do not group unrelated docs into one broad task only because they share a module.
3. Update `<repo-root>/db/task_doc_governance/task_rules.json` first when the task/doc mapping changes.
4. Keep local Markdown headers minimal and parseable per `document_header.schema.json`.
5. Run read-only validation: `node tools/task-governance/cli.mjs check` (or `doctor`).
6. When a fresh query index is needed within the authorized task, explicitly run `node tools/task-governance/cli.mjs rebuild` (writes SQLite only); do not request approval again for an already authorized rebuild.
7. Only with explicit intent: `node tools/task-governance/cli.mjs rebuild --fix-headers` (may update Markdown headers; fills missing/empty/`pending` `LAST_TRACKED_AT`, preserves real prior timestamps).
8. Verify with `node tools/task-governance/cli.mjs tasks` and `node tools/task-governance/cli.mjs docs <task_key>` (these fail clearly if the derived SQLite file is missing).

## Local Header Rules

Contract: `<repo-root>/db/task_doc_governance/document_header.schema.json`.

```md
TASK_KEY: pending
DOC_TYPE: 详细设计
WORKSTREAM: pending
STATUS: draft
EXECUTION_MODEL: <actual-route-or-model>
LAST_TRACKED_AT: pending
```

Accepted document `STATUS` values come from the schema enum: `draft`, `tracked`, `active`, `done`, `partial`, `pass`.

Accepted `DOC_TYPE` values come from the schema enum: `需求澄清`, `概要设计`, `详细设计`, `测试记录`, `任务单`, `其他`.

Rules:

- `TASK_KEY` is required for local governance identity on the doc and must match the mapped task when tracked.
- `DOC_TYPE` must match path-derived type; `WORKSTREAM` must match `task.workstream ?? task.module`.
- `EXECUTION_MODEL` must name the actual model or agent route for the document, never a hardcoded stale default.
- Document `STATUS` is local governance state; task status lives only in `task_rules.json`.
- Do not add extra metadata lines unless the workflow truly requires them.

## Task Granularity

Default task granularity is feature-level implementation, for example:

- `wasm-shield-mechanism`
- `wasm-control-interrupt`
- `wasm-move-speed-mechanism`
- `server-game-manage-api`

Do not default to coarse buckets such as:

- one task for all wasm overview docs
- one task for all server docs
- one task for all testing docs

Use broader grouping only when the documents truly describe the same deliverable.

## Output Requirements

When this skill is used, the final response should include:

- changed local files
- changed `task_key` values or task mappings
- whether `task_doc_governance.sqlite` was rebuilt / whether `--fix-headers` ran
- any unresolved classification or status risks

## Guardrails

- Prefer local SQLite updates over any external tracker.
- Do not let Obsidian notes become a second task source of truth.
- Do not invent task granularity from folder names alone; inspect doc titles and, when needed, code context.
- Keep `task_rules.json` authoritative for task/doc mapping and task status.
- Default to read-only `check`; mutate SQLite only via explicit `rebuild`; mutate headers only via explicit `--fix-headers`.
- Do not hand-edit the SQLite file.

## Useful References

- `<repo-root>/文档记录/详细设计/SQLite任务文档治理方案.md`
- `references/sqlite-governance-playbook.md`
- `<repo-root>/db/task_doc_governance/document_header.schema.json`
