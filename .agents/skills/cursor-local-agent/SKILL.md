---
name: cursor-local-agent
description: Use when calling Cursor's TypeScript SDK or local agent from the driving model (GPT/opus/glm) for read-only design review, development automation, SDK smoke tests, local agent runs, or Grok 4.6 non-fast model selection.
---

# Cursor Local Agent

## Overview

Use Cursor as a local execution engine through `@cursor/sdk`, not as a visible Cursor IDE chat. SDK local agent transcripts may be written under `~/.cursor/projects/...`, but they are not guaranteed to appear in the Cursor IDE Agent history dropdown.

**Terminology (see root `AGENTS.md` §0):**

- **Top-level Cursor local agent**: the agent this skill creates via SDK/runner. It must run in either `DESIGN_REVIEW_ONLY` or `IMPLEMENTATION` mode. Fixed model contract applies here only.
- **Cursor internal task/subagent/explore**: optional bounded delegation inside that top-level agent; the top-level agent owns the output. Internal model choice is not the fixed grok contract.
- `--allowed-path` is an **audited write allowlist** (fail-closed classification). It is **not** an OS sandbox.

For design-review and development runs, treat the SDK event stream, `summary.json`, artifact list, full-worktree + scoped git status, `diff.patch`, and local validation as the primary evidence chain.

## Hard Rules

- Use only `grok-4.6` with explicit non-fast params for the **top-level** agent.
- Always disable Fast explicitly. `Cursor.models.list()` currently marks bare `grok-4.6` default as `effort=high` + `fast=true`, so a bare model id is not strict enough. The catalog also exposes `effort=xhigh`; this project contract stays fixed at `effort=high` (no version switch or effort picker):

```ts
const model = {
  id: "grok-4.6",
  params: [
    { id: "effort", value: "high" },
    { id: "fast", value: "false" },
  ],
};
```

- Never use `composer-latest`, `composer`, `composer-2.5`, `composer-2.5-fast`, or bare `{ id: "grok-4.6" }` for current top-level Cursor local agent development runs.
- Only change Grok params after `Cursor.models.list()` proves the exact contract.
- Pass `apiKey` explicitly to `Agent.create(...)`; do not rely only on `process.env.CURSOR_API_KEY`.
- Do not print API keys. It is acceptable to print whether a key is present, its length, or a short prefix.
- Real SDK runs request `settingSources: ["project"]` so repository-local Cursor project settings load. That includes supported `.cursor` assets and this repository's `.agents/skills`, as well as future project file-defined agents. Smoke intentionally requests `settingSources: []` for isolation.
- `summary.settingSources` and the console line `SETTING_SOURCES=<json>` are the stable requested-source evidence. They record what was requested, not proof the SDK applied them when `runtimeUsed` is not `sdk`. Fallback runtime reporting must stay distinguishable from SDK; dry-run wiring evidence does not prove live skill discovery.
- Pin and resolve `@cursor/sdk@1.0.24`. Shared temp-cache install is re-synced when missing or version-mismatched. Preflight records resolved path, source (`repo-local` | `shared-cache`), actual version, expected version, and `versionMatch`. A repo-local mismatch warns but is still used.
- Prefer Node `>=22.13` (package engines). On Codex desktop, when system Node is older, invoke the bundled Node executable returned by `load_workspace_dependencies` for the runner/smoke process only; do not alter global `PATH`. Node `<20` is a blocking preflight error. Node `20.0`–`22.12` is warn-only because the runner explicitly supplies `JsonlLocalAgentStore`.
- Real runs **require** at least one `--allowed-path`. Paths resolve under `--cwd`; escapes outside the repository are rejected.
- Every real prompt must declare exactly one mode on its first line: `MODE: DESIGN_REVIEW_ONLY` or `MODE: IMPLEMENTATION`. The runner strips only an initial BOM and a trailing CR from that first physical line, then exact-matches; spaces/comments/extra text are invalid and block before any `Agent.create` / `send` / CLI fallback.
- `DESIGN_REVIEW_ONLY` must not create, edit, or delete files. The review is valid only when the run audit is available and `summary.writeAllowlistAudit.runDeltaCount === 0`; an allowlist pass alone is insufficient because in-scope writes are still writes.
- For `DESIGN_REVIEW_ONLY`, inspect `events.jsonl` as well as final signatures. Missing/unparseable event evidence, a truncated file-operation tool event, or any file write/delete/rename/write-then-restore evidence invalidates the review even when final `runDeltaCount === 0`.
- Keep review `--out-dir` under the repository's gitignored `/.agents/artifacts/` default, or prove a custom directory is ignored with `git check-ignore` before the run. Runner-generated evidence artifacts are not task writes; never let the agent use that directory for work product.
- `IMPLEMENTATION` must receive a frozen plan version and run in a new Cursor run. Do not carry unresolved review discussion or superseded plan versions into the coding run.
- After the run, snapshot per-path status+content signatures and classify the **run delta** (paths whose signature changed) against the allowlist. Untouched pre-existing dirt does not fail the run; outside-scope paths changed during the run set `writeAllowlistAudit.failClosed` and force a **non-zero** exit while preserving artifacts. If after-state capture/parse/classify fails, treat that as audit failure (fail-closed). Exit precedence: when `writeAllowlistAudit.failClosed` is true, exit `2` takes precedence over ordinary runtime/task failure; otherwise any runtime/task failure exits non-zero; only `finished` SDK (or allowed CLI fallback) plus clean audit exits `0`.
- Only `RunResult.status=finished` is success. `error` / `cancelled` / `expired` / unknown become `failurePhase=run` and non-zero after artifacts/audit finalize. Do not assume `status=error` means no code landed — review the worktree diff before deciding the next action.
- Startup retry is authoritative and bounded: `--startup-max-attempts` (`1..3`, default `3`) and `--startup-backoff-ms` (default `1000`) cover only `Agent.create` + `send` until a `Run` is returned. Retry only when `error.isRetryable === true`, excluding `AuthenticationError` / `ConfigurationError`. Delay is `base * 2^(attempt-1) + jitter[0,base]`; retryable `RateLimitError` waits at least `30000` ms. Dispose every failed candidate before sleeping. Never retry or CLI-fallback after a `Run` is returned.
- Failure phases are `preflight` | `startup` | `run` | `audit`. Console evidence includes `ERROR_PHASE`, `ERROR_NAME`, `ERROR_MESSAGE`, and safe retryable/code/proto fields when present. Correlate with `agentId`, `runId`, and `requestId` when available.
- CLI fallback is considered only when `failurePhase` is exactly `startup` and `runId` is absent. Every other failure explicitly blocks fallback with a no-replay reason.
- Await `agent[Symbol.asyncDispose]()` (fallback `close()`) for cleanup. Do not mask an active startup/run error with a secondary disposal error.
- `--timeout-ms` is a hard wall-clock cancel. Use at least `900000` ms for ordinary design review and `3600000` ms for large implementation, or `0` with active monitoring. Positive values below `600000` (design) / `1800000` (implementation) emit a preflight warning. On timeout, inspect events/result/diff and never blindly replay an implementation run.
- A MaxListeners warning alone is not failure if result/audit finish. Do not suppress it globally; correlate with resource growth and rely on async disposal plus Node `>=22.13`.
- Run preflight before real tasks. At minimum check Node runtime, `CURSOR_USE_HTTP1`, `CURSOR_API_KEY`, `@cursor/sdk` resolution (version evidence), MODE, and whether CLI fallback is actually callable.

## Operating Modes

### `DESIGN_REVIEW_ONLY`

Use this mode after the driving model has produced a versioned candidate plan and before any non-mechanical development task starts coding. The prompt must include the full latest plan, `PLAN_REV`, repository evidence, expected write scope, validation, stop conditions, and any assumptions needing review.

Require Cursor to return:

- `VERDICT: READY | REVISE | BLOCKED` and `REVIEWED_PLAN_REV`;
- evidence-backed blockers with stable `ISSUE_ID` values, impact, one concrete question, and the default assumption if unanswered;
- non-blocking suggestions kept separate from blockers;
- readiness checks for goals/non-goals, contracts, write scope, compatibility/errors, validation, and stop conditions.

The driving model resolves every blocker as `ACCEPT | REJECT | NEED_USER`, updates the full plan, and re-runs review until the consensus gate in `文档记录/详细设计/Cursor协同开发流程说明.md` passes. A custom SDK caller may reuse one agent for multiple `send` calls; the current `cursor_local_agent_run.mjs` performs one run per invocation, so every review round must carry the complete latest plan, change summary, and issue dispositions. High-risk plans may add a fresh-session cold review. Any worktree run delta invalidates the review even when it is inside `--allowed-path`.

### `IMPLEMENTATION`

Use this mode only after the latest reviewed plan is frozen. Start a new run and provide only the frozen plan, allowed write paths, non-goals, validation commands, and stop conditions. If Cursor discovers a new fact that contradicts the frozen plan, it must stop and report the conflict instead of silently redesigning the task.

## Minimal Pattern

```ts
import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY ?? process.env.cursor_api_key;
if (!apiKey) throw new Error("CURSOR_API_KEY is not set");

const agent = await Agent.create({
  apiKey,
  name: "codex-cursor-task",
  model: {
    id: "grok-4.6",
    params: [
      { id: "effort", value: "high" },
      { id: "fast", value: "false" },
    ],
  },
  local: { cwd: repoPath, settingSources: ["project"] },
});

try {
  const run = await agent.send(taskPrompt);
  // Persist run.id and run.requestId immediately after send returns.

  for await (const event of run.stream()) {
    // Persist status, assistant text, tool calls, and errors as structured events.
  }

  const result = await run.wait();
  const artifacts = await agent.listArtifacts().catch(() => []);
  // Persist run.id, result, and artifact hints for later review.
  // Only result.status === "finished" is success.
} finally {
  if (typeof agent[Symbol.asyncDispose] === "function") {
    await agent[Symbol.asyncDispose]();
  } else {
    agent.close();
  }
}
```

## Workflow

1. Resolve the target repository path. Prefer the user's real project path over a Codex worktree if the user expects Cursor project-local state.
2. Read `CURSOR_API_KEY` from the current process or Windows User environment, then pass it explicitly as `apiKey`. Prefer Node `>=22.13`; on Codex desktop use the bundled Node from `load_workspace_dependencies` when system Node is older (process-scoped, no global `PATH` change).
3. Select exactly one mode and put it on the first prompt line.
4. Create the **top-level** agent with the hard-rule model object above.
5. Send a bounded prompt with an explicit write allowlist. For `DESIGN_REVIEW_ONLY`, also state "Do not create, edit, or delete files" and include the structured review response contract.
6. Prefer `scripts/cursor_local_agent_run.mjs` for real work. It writes `prompt.txt`, `summary.json`, `events.jsonl`, `diff.patch`, `review.md`, full-worktree and scoped git status, path-signature before/after JSON, and untracked **metadata only** (path/size/sha256 — never raw file content) under `--out-dir` (default `.agents/artifacts/cursor-task-*`). SDK store lives under that artifact directory. Startup retries and hard timeout flags are documented in `--help`.
7. If the run returns `error` / non-finished status, or exit code is non-zero due to outside-scope paths, inspect artifacts and `git diff` before deciding the next action. Never blindly replay an implementation after timeout or after a `Run` was returned.
8. For `DESIGN_REVIEW_ONLY`, reject the review if the audit is unavailable or `runDeltaCount !== 0`; do not rely only on outside-scope classification.
9. Also reject `DESIGN_REVIEW_ONLY` when `events.jsonl` is missing/unparseable, a relevant tool event is truncated, or the log records file mutation or write-then-restore activity, even if final signatures match.
10. For `IMPLEMENTATION`, inspect classification results, review the diff, and run requested validation before accepting the work.

```powershell
$repo = "C:\project\damage_viewer_project_planning"
$skillRoot = Join-Path $repo ".agents\skills\cursor-local-agent"
# Prefer bundled Node >=22.13 when system Node is older (Codex: load_workspace_dependencies).
node (Join-Path $skillRoot "scripts\cursor_local_agent_run.mjs") `
  --cwd $repo `
  --prompt-file C:\task\cursor-task.txt `
  --allowed-path 文档记录 `
  --timeout-ms 900000 `
  --out-dir (Join-Path $repo ".agents\artifacts\cursor-task-001")
```

Set `$repo` to the actual target worktree before copying a command. For Wasm work use `C:\project\damage_wasm_dev`; for Web use `C:\project\damage_web_dev`; for backend use `C:\project\damage_backend_dev`. If the target worktree does not contain this skill directory, use the planning repo's `.agents\skills\cursor-local-agent\scripts\...` path but keep `--cwd` pointed at the target repo.

Path-policy unit check:

```powershell
node (Join-Path $skillRoot "scripts\cursor_local_agent_path_policy.test.mjs")
```

## Verification

For a design-review run, verify all of the following before using its verdict:

```text
MODE=DESIGN_REVIEW_ONLY
VERDICT=READY|REVISE|BLOCKED
REVIEWED_PLAN_REV=<expected revision>
WRITE_ALLOWLIST_AUDIT_AVAILABLE=true
EVENT_LOG_AUDIT_AVAILABLE=true
RUN_DELTA_COUNT=0
MUTATING_FILE_ACTIVITY=0
```

Also inspect `summary.promptMode`, `summary.startup.attemptsUsed`, SDK version evidence (`actualVersion` / `expectedVersion` / `versionMatch`), `requestId`, and `failurePhase` when diagnosing non-zero exits.

The exact stored representation may be split between assistant text and `summary.json`; the driving model must inspect both. A `READY` verdict with a non-zero run delta is invalid.

Use `scripts/cursor_local_agent_smoke.mjs` for a safe smoke check:

```powershell
$repo = "C:\project\damage_viewer_project_planning"
$skillRoot = Join-Path $repo ".agents\skills\cursor-local-agent"
node (Join-Path $skillRoot "scripts\cursor_local_agent_smoke.mjs") --dry-run
node (Join-Path $skillRoot "scripts\cursor_local_agent_smoke.mjs") --cwd $repo --send --out-dir (Join-Path $repo ".agents\artifacts\cursor-smoke")
```

The successful send result must include:

```text
RESULT_STATUS=finished
RESULT_MODEL={"id":"grok-4.6","params":[{"id":"effort","value":"high"},{"id":"fast","value":"false"}]}
ASSISTANT_TEXT=GROK_46_NONFAST_SMOKE_OK
```

`cursor_local_agent_run.mjs` is the preferred path for real work (artifacts always land under `--out-dir`). It requests project setting sources so repo skills and future project file-defined agents can be visible. `cursor_local_agent_smoke.mjs` stays focused on model / SDK health checks and keeps `settingSources: []` for deterministic isolation (no MODE requirement; single startup attempt; dry-run remains network-free).

## CLI Fallback

CLI fallback is not assumed to exist.

1. If the machine only exposes the desktop `cursor` wrapper, treat CLI fallback as blocked until you can prove there is a standalone programmable `cursor-agent` binary.
2. Even when `cursor-agent` exists, current CLI flags do not prove `grok-4.6` with `fast=false`, so strict fallback remains blocked by default.
3. Only relax the model rule for CLI fallback when the user explicitly accepts model drift for diagnostics or emergency recovery.
4. Runner considers CLI fallback only for `failurePhase=startup` with no `runId`. Preflight / audit / run / stream / wait / timeout / terminal non-finished failures are explicitly blocked (no-replay).

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Usage shows `grok-4.6` with `fast=true`, bare `grok-4.6`, `composer-2.5`, `composer-2.5-fast`, or another Composer variant | Update the runner to request `grok-4.6` through the shared `MODEL` constant with `effort=high` and `fast=false`. |
| `Cursor.models.list()` works but `Agent.send()` is unauthenticated | Pass `apiKey` explicitly into `Agent.create(...)`. |
| Cursor IDE does not show the SDK session | Read SDK artifacts/transcripts directly; do not depend on the IDE history dropdown. |
| Session appears under the wrong project | Use the exact desired `cwd`; Cursor stores project state by path. |
| Run ends with `status=error` but files changed | Review `git diff`, summary JSON, and events log before deciding whether to open a fix loop. |
| Treating non-finished `RunResult` as success | Only `finished` exits 0 (with clean audit); other statuses are `failurePhase=run`. |
| Outside-scope paths changed during a run | Treat exit code 2 / `writeAllowlistAudit.failClosed` (run-delta based) as audit failure; untouched pre-existing dirt alone is not enough to fail. |
| Assuming `--allowed-path` is an OS sandbox | It is audited classification only; the agent process itself is not sandboxed by this flag. |
| Treating an allowlist pass as proof that a design review was read-only | Inspect `summary.writeAllowlistAudit.runDeltaCount`; any non-zero value invalidates `DESIGN_REVIEW_ONLY`. |
| Treating final zero delta as proof that no temporary write occurred | Inspect `events.jsonl`; file mutation or write-then-restore activity invalidates the review. |
| Treating a missing, unparseable, or truncated event log as evidence of no writes | Fail closed; the design-review verdict is unusable without complete event evidence. |
| Using a tracked/custom artifact directory and confusing runner evidence with task changes | Keep review output under gitignored `/.agents/artifacts/`, or prove a custom directory is ignored before the run. |
| Letting the review run start coding after returning `READY` | Freeze the approved plan, close the reviewer, and create a new `IMPLEMENTATION` run. |
| Sending only issue replies or mixed plan versions to review/coding | Send the complete latest plan for review and only the frozen plan to the coding run. |
| CLI fallback was expected but only `cursor` exists | Probe for a standalone `cursor-agent` binary first; the desktop wrapper alone is not enough evidence. |
| Retrying or CLI-falling-back after a Run was returned | Startup retry and CLI fallback stop at Run return; inspect artifacts instead of replaying. |
| Blindly replaying implementation after hard timeout | Inspect events/result/diff; choose a deliberate new run only if still needed. |
| Treating MaxListeners warning alone as hard failure | Not failure if result/audit finish; correlate with resource growth; use async disposal and Node `>=22.13`. |
| Stale shared `@cursor/sdk` cache | Expected pin is `1.0.24`; shared cache reinstalls on missing/mismatch; check preflight version evidence. |
