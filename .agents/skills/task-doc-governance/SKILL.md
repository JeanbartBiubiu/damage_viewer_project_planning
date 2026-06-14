---
name: task-doc-governance
description: Use when work in c:\project\damage_viewer_project_planning needs SQLite-based local task and document governance under 文档记录, feature-level task splitting, TASK_KEY maintenance, or rebuild/query of the local governance database.
---

# Task Doc Governance

Use this skill when the work includes task tracking, document classification, or local governance updates in addition to code changes.

The project copy under `c:\project\damage_viewer_project_planning\.agents\skills\task-doc-governance` is the canonical version. If a user-level copy exists under `C:\Users\Administrator\.codex\skills`, keep it synchronized or make it an explicit pointer to this project copy.

Read:

- `references/sqlite-governance-playbook.md`

## When To Use

Use this skill if any of the following are true:

- the user wants to organize or reclassify Markdown docs under `文档记录/`
- the user wants implementation tasks tracked by feature instead of by coarse folder bucket
- local Markdown headers need `TASK_KEY`, `DOC_TYPE`, `WORKSTREAM`, or other governance metadata maintained
- the local SQLite governance database needs to be rebuilt or queried
- existing docs need to be remapped in `db/task_doc_governance/task_rules.json`

## Fixed Workspace Conventions

- repo root: `c:\project\damage_viewer_project_planning`
- local doc root: `c:\project\damage_viewer_project_planning\文档记录`
- SQLite schema: `c:\project\damage_viewer_project_planning\db\task_doc_governance\schema.sql`
- task rules: `c:\project\damage_viewer_project_planning\db\task_doc_governance\task_rules.json`
- SQLite db file: `c:\project\damage_viewer_project_planning\db\task_doc_governance\task_doc_governance.sqlite`
- CLI: `c:\project\damage_viewer_project_planning\tools\task-governance\cli.mjs`
- local source of truth: `TASK_KEY` plus the SQLite database
- Obsidian memory notes are supplementary context only, not the task/doc mapping source of truth

Local document directories:

- `文档记录/需求澄清`
- `文档记录/概要设计`
- `文档记录/详细设计`
- `文档记录/测试记录`

## Default Workflow

1. Read `references/sqlite-governance-playbook.md`.
2. Split tasks by feature implementation. Do not group unrelated docs into one broad task only because they share a module.
3. Update `db/task_doc_governance/task_rules.json` first when the task/doc mapping changes.
4. Keep local Markdown headers minimal and parseable.
5. Run `node tools/task-governance/cli.mjs rebuild`.
6. Verify with `node tools/task-governance/cli.mjs tasks` and `node tools/task-governance/cli.mjs docs <task_key>`.

## Local Header Rules

Use this header shape for managed docs:

```md
TASK_KEY: pending
DOC_TYPE: 详细设计
WORKSTREAM: pending
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending
```

Rules:

- `TASK_KEY` is required for local governance.
- `EXECUTION_MODEL` should name the actual model or agent route used for the document, not a stale default copied from another session.
- `STATUS` should describe local governance state such as `draft` or `tracked`.
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
- whether `task_doc_governance.sqlite` was rebuilt
- any unresolved classification or status risks

## Guardrails

- Prefer local SQLite updates over any external tracker.
- Do not let Obsidian notes become a second task source of truth; task mapping and task status still belong to `task_rules.json` and the rebuilt SQLite database.
- Do not invent task granularity from folder names alone; inspect doc titles and, when needed, code context.
- Keep `task_rules.json` authoritative for task/doc mapping.
- Rebuild the database after mapping changes instead of hand-editing the SQLite file.

## Useful References

- `c:\project\damage_viewer_project_planning\文档记录\详细设计\SQLite任务文档治理方案.md`
- `references/sqlite-governance-playbook.md`
