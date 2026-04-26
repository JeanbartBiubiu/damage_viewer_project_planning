---
name: document-layering
description: Use when creating, splitting, reviewing, or updating project documentation that may mix requirements, architecture, detailed design, task execution, validation records, or Obsidian/session memory; especially for 文档记录 docs and 需求澄清/概要设计/详细设计 separation.
---

# Document Layering

Use this skill to keep project documents single-purpose. A document should have one primary layer: why, where, how, execution, evidence, or memory. If a draft mixes layers, split it before polishing wording.

## Core Rule

Do not hide different decisions in one document.

- **需求澄清** answers why this work exists and what success means.
- **概要设计** answers where the capability sits in the system and how modules relate.
- **详细设计** answers exactly how to implement it.
- **任务单 / subagent task** answers who changes which files in what order.
- **测试记录** answers what was verified and what evidence remains.
- **会话记录 / Obsidian memory** records traceable session outcomes, not full design content.

When a document contains both high-level motivation and code-level implementation steps, split it. When the user says “sub agent 看到后直接就能编码”, the target is detailed design, not overview.

## Workflow

1. Identify the requested audience and layer before writing.
2. Classify existing draft paragraphs into layer buckets.
3. If more than one bucket is substantial, create separate linked documents instead of one larger document.
4. Put cross-links near the top of sibling documents so readers can move between clarification, overview, and implementation.
5. Keep each document's body focused on its layer; move stray content to the correct sibling.
6. For repo docs under `文档记录/**`, preserve the local header convention and update task governance if mappings change.
7. If persistent memory is required, write a short session/task record; do not copy the whole design into Obsidian.

## Layer Definitions

### 需求澄清

Use for product and requirement clarity.

Include:

- User problem, target scenario, and reason to implement.
- Scope, non-goals, assumptions, and terminology.
- Expected behavior, acceptance criteria, and unresolved questions.
- External constraints that shape the work.

Avoid:

- File paths, function signatures, database migration steps, or implementation sequencing.
- Long architecture explanation beyond what is needed to clarify scope.

Typical path:

- `文档记录/需求澄清/<module>/<topic>.md`

### 概要设计

Use for system placement and module boundaries.

Include:

- The capability's role in the overall architecture.
- Producer/consumer relationships, data flow, lifecycle, ownership boundaries, and dependencies.
- Compatibility strategy and integration points across backend, web, wasm, database, or tooling.
- Key design decisions with short rationale.

Avoid:

- Detailed coding instructions, exact edit lists, test command transcripts, or subagent ownership assignment.
- Repeating requirement motivation except a short link back to the clarification doc.

Typical path:

- `文档记录/概要设计/<module>/<topic>.md`

### 详细设计

Use for implementable engineering instructions.

Include:

- Concrete write scope: files, packages, modules, schemas, APIs, DTOs, generated assets, and ownership boundaries.
- Read-only references and existing patterns to follow.
- Exact data contracts, type shapes, function names/signatures where known, validation rules, edge cases, and error handling.
- Ordered implementation steps that can be executed independently by a subagent.
- Backward compatibility, migration, feature flag, fallback, or rollout notes.
- Tests to add or update, validation commands, expected results, and residual risks.

Avoid:

- “为什么要做” paragraphs except one short trace to the requirement doc.
- Vague verbs such as “完善”, “支持”, or “打通” without naming the target files, data shape, and observable behavior.
- Architecture prose that does not tell the implementer what to edit.

Detailed design is ready only when another coding agent can start work without asking where to edit, what contract to preserve, or how to verify.

Typical path:

- `文档记录/详细设计/<module>/<topic>.md`

### 任务单 / Subagent Task

Use for execution decomposition.

Include:

- Task goal, write ownership, read-only references, dependencies, ordered steps, and deliverables.
- Explicit warning that the worker is not alone in the codebase and must not revert unrelated changes.
- Verification commands and expected reporting format.

Avoid:

- Re-explaining requirements or architecture in full.
- Assigning overlapping write sets to parallel workers unless integration ownership is clear.

### 测试记录

Use for evidence.

Include:

- Date, environment, command, result, relevant output summary, and unresolved failure.
- What changed since the previous run.

Avoid:

- Design decisions that should live in clarification, overview, or detailed design.

### 会话记录 / Obsidian Memory

Use for traceability after work.

Include:

- Date, goal, changed paths, key decisions, validation result, risk, next step, and related `TASK_KEY`.

Avoid:

- Full copies of design docs.
- Updating shared memory pages unless the current session is explicitly the summarizing/closing session.

## Split Triggers

Split the draft when any of these are true:

- It explains why the feature matters and also lists concrete file edits.
- It describes cross-module architecture and also assigns subagent write ownership.
- It contains test evidence and future design decisions.
- It has many “should/need to” statements but no concrete implementation contract.
- A detailed design spends more space on justification than on edit instructions.
- A requirement doc includes schema, API, or function-level choices as if already decided.

## Required Headers

For `文档记录/**/*.md`, keep the project header unless the nearest template says otherwise:

```text
TASK_KEY: <task-key>
DOC_TYPE: <需求澄清|概要设计|详细设计|测试记录|任务单>
WORKSTREAM: <module-or-workstream>
STATUS: <draft|active|done>
EXECUTION_MODEL: <model-or-agent-route>
LAST_TRACKED_AT: <YYYY-MM-DD>
```

If splitting an existing document, copy the relevant `TASK_KEY` and update `DOC_TYPE` per file. Do not leave the old mixed document as a competing source unless it is explicitly marked superseded and linked to the new documents.

## Governance Checklist

For docs under `文档记录/**`:

1. Check the nearest `AGENTS.md`, local README, and existing directory pattern.
2. If task-to-doc mappings changed, update `db/task_doc_governance/task_rules.json`.
3. Rebuild governance with:

```powershell
node tools/task-governance/cli.mjs rebuild
```

4. Report any pre-existing missing or unassigned docs separately from the current change.

## Final Self-Review

Before finishing, verify:

- Each document has one primary layer.
- Sibling documents cross-link to each other.
- Detailed design contains enough concrete information for direct implementation.
- Requirement and overview docs do not contain accidental coding task lists.
- Governance mappings and persistent memory expectations are handled when applicable.
