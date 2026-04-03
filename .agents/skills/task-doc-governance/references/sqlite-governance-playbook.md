# SQLite Governance Playbook

Use this reference for normal local task/doc governance work in `c:\project\damage_viewer_project_planning`.

## Source Of Truth

- task/doc schema: `db/task_doc_governance/schema.sql`
- task/doc mapping: `db/task_doc_governance/task_rules.json`
- local db file: `db/task_doc_governance/task_doc_governance.sqlite`
- CLI: `tools/task-governance/cli.mjs`

The primary local identifier is `TASK_KEY`.

## Normal Workflow

1. Inspect the relevant docs under `文档记录/`.
2. If task granularity is wrong, fix `db/task_doc_governance/task_rules.json`.
3. Keep each task mapped to one feature deliverable, not one large folder bucket.
4. Rebuild:

```powershell
npm install --prefix tools/task-governance
node tools/task-governance/cli.mjs rebuild
```

5. Verify:

```powershell
node tools/task-governance/cli.mjs tasks
node tools/task-governance/cli.mjs docs <task_key>
```

## Header Rules

Managed docs should have:

```md
TASK_KEY: pending
DOC_TYPE: 详细设计
WORKSTREAM: pending
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending
```

Interpretation:

- `TASK_KEY`: required local task identifier
- `DOC_TYPE`: `需求澄清`, `概要设计`, `详细设计`, `测试记录`, `任务单`, or `其他`
- `WORKSTREAM`: module such as `wasm`, `web`, `server`, `planning`
- `STATUS`: local governance state such as `draft` or `tracked`
- `LAST_TRACKED_AT`: last local governance refresh time

## Status Guidance

When setting task status, use code and test evidence:

- `完成`: the feature has implementation and enough verification to count as done
- `进行中`: partial implementation exists, or the implementation clearly depends on unresolved follow-up work
- `未开始`: mostly design-only or requirement-only, with no meaningful implementation

Do not mark a task complete only because its document exists.

## Mapping Guidance

Good task splits:

- `wasm-shield-mechanism`
- `wasm-control-interrupt`
- `wasm-move-speed-mechanism`
- `server-game-manage-api`

Bad task splits:

- one task for all wasm overview docs
- one task for all server docs
- one task for all testing docs when they cover unrelated features

Use broader grouping only for truly shared artifacts, such as a single benchmark-regression task that owns common regression and acceptance docs.

## Output Expectations

When you use this playbook, report:

- changed `task_rules.json` entries
- rebuilt database path
- changed docs and their `TASK_KEY`
- any docs still hard to classify
