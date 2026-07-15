# SQLite Governance Playbook

Use this reference for normal local task/doc governance work. `REPO_ROOT` = current Git repository root (not this skill directory). The CLI resolves absolute paths from `<repo-root>/tools/task-governance/cli.mjs`. Planning/master holds the canonical shared skill copy. Skill-local files stay relative (`references/...`).

## Source Of Truth

| Artifact | Role |
|----------|------|
| `<repo-root>/db/task_doc_governance/task_rules.json` | **Sole** task/doc mapping and task-status source |
| `<repo-root>/db/task_doc_governance/document_header.schema.json` | **Sole** machine-readable Markdown header contract (required keys + STATUS/DOC_TYPE enums) |
| `<repo-root>/db/task_doc_governance/schema.sql` | SQLite schema used on rebuild |
| `<repo-root>/db/task_doc_governance/task_doc_governance.sqlite` | Derived query output only — never hand-edit |
| `<repo-root>/tools/task-governance/cli.mjs` | check / doctor / rebuild / tasks / docs |
| `<repo-root>/文档记录/**/*.md` | Document body truth; headers identify docs, do not replace mapping |

Obsidian notes may store project context, decisions, or session memory, but they are not the source of truth for task mapping or task status.

## Normal Workflow

1. Inspect the relevant docs under `<repo-root>/文档记录/`.
2. If task granularity is wrong, fix `<repo-root>/db/task_doc_governance/task_rules.json`.
3. Keep each task mapped to one feature deliverable, not one large folder bucket.
4. Validate (read-only, no writes):

```powershell
node tools/task-governance/cli.mjs check
```

5. Rebuild SQLite only when mapping changes are approved:

```powershell
node tools/task-governance/cli.mjs rebuild
```

6. Update Markdown headers only with explicit intent:

```powershell
node tools/task-governance/cli.mjs rebuild --fix-headers
```

`--fix-headers` replaces missing/empty/`pending` `LAST_TRACKED_AT` with the current timestamp and preserves a real prior timestamp.

7. Query (fail if derived SQLite is missing — run `rebuild` first):

```powershell
node tools/task-governance/cli.mjs tasks
node tools/task-governance/cli.mjs docs <task_key>
```

`help` / no args print usage without writes. `check` and `doctor` are synonyms for read-only validation and exit non-zero on governance errors (duplicate assignments, missing docs, invalid headers/rules, header↔mapping mismatches). `rebuild` reports the same classes of issues and exits non-zero if they remain.

## Header Rules

Managed docs should match `document_header.schema.json`:

```md
TASK_KEY: pending
DOC_TYPE: 详细设计
WORKSTREAM: pending
STATUS: draft
EXECUTION_MODEL: <actual-route-or-model>
LAST_TRACKED_AT: pending
```

Interpretation:

- `TASK_KEY`: required local task identifier
- `DOC_TYPE`: `需求澄清`, `概要设计`, `详细设计`, `测试记录`, `任务单`, or `其他`
- `WORKSTREAM`: module such as `wasm`, `web`, `server`, `planning`
- `STATUS` (document): `draft` | `tracked` | `active` | `done` | `partial` | `pass`
- `EXECUTION_MODEL`: actual route/value used for the document — never a hardcoded stale default
- `LAST_TRACKED_AT`: last local governance refresh time

## Status Guidance

When setting **task** status in `task_rules.json`, use code and test evidence:

- `完成`: the feature has implementation and enough verification to count as done
- `进行中`: partial implementation exists, or the implementation clearly depends on unresolved follow-up work
- `未开始`: mostly design-only or requirement-only, with no meaningful implementation

Do not mark a task complete only because its document exists. Document `STATUS` is independent of task status.

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
- whether SQLite was rebuilt and whether `--fix-headers` ran
- changed docs and their `TASK_KEY`
- any docs still hard to classify

If the work only updates Obsidian memory or explanatory docs, say explicitly that no SQLite task mapping changes were made and no rebuild was required.
