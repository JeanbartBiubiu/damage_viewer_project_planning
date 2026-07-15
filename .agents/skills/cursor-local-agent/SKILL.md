---
name: cursor-local-agent
description: Use when calling Cursor's TypeScript SDK or local agent from the driving model (GPT/opus/glm), especially for driving-model-to-Cursor development automation, Cursor SDK smoke tests, local agent runs, or Grok 4.5 non-fast model selection.
---

# Cursor Local Agent

## Overview

Use Cursor as a local execution engine through `@cursor/sdk`, not as a visible Cursor IDE chat. SDK local agent transcripts may be written under `~/.cursor/projects/...`, but they are not guaranteed to appear in the Cursor IDE Agent history dropdown.

**Terminology (see root `AGENTS.md` §0):**

- **Top-level Cursor local agent**: the agent this skill creates via SDK/runner. Fixed model contract applies here only.
- **Cursor internal task/subagent/explore**: optional bounded delegation inside that top-level agent; the top-level agent owns the output. Internal model choice is not the fixed grok contract.
- `--allowed-path` is an **audited write allowlist** (fail-closed classification). It is **not** an OS sandbox.

For real development runs, treat the SDK event stream, `summary.json`, artifact list, full-worktree + scoped git status, `diff.patch`, and local validation as the primary evidence chain.

## Hard Rules

- Use only `grok-4.5` with explicit non-fast params for the **top-level** agent.
- Always disable Fast explicitly. `Cursor.models.list()` currently marks bare `grok-4.5` default as `effort=high` + `fast=true`, so a bare model id is not strict enough:

```ts
const model = {
  id: "grok-4.5",
  params: [
    { id: "effort", value: "high" },
    { id: "fast", value: "false" },
  ],
};
```

- Never use `composer-latest`, `composer`, `composer-2.5`, `composer-2.5-fast`, or bare `{ id: "grok-4.5" }` for current top-level Cursor local agent development runs.
- Only change Grok params after `Cursor.models.list()` proves the exact contract.
- Pass `apiKey` explicitly to `Agent.create(...)`; do not rely only on `process.env.CURSOR_API_KEY`.
- Do not print API keys. It is acceptable to print whether a key is present, its length, or a short prefix.
- Real runs **require** at least one `--allowed-path`. Paths resolve under `--cwd`; escapes outside the repository are rejected.
- After the run, snapshot per-path status+content signatures and classify the **run delta** (paths whose signature changed) against the allowlist. Untouched pre-existing dirt does not fail the run; outside-scope paths changed during the run set `writeAllowlistAudit.failClosed` and force a **non-zero** exit while preserving artifacts. If after-state capture/parse/classify fails, treat that as audit failure (fail-closed).
- Do not assume `status=error` means no code landed. Review the worktree diff before deciding the next action.
- Run preflight before real tasks. At minimum check Node runtime, `CURSOR_USE_HTTP1`, `CURSOR_API_KEY`, `@cursor/sdk` resolution, and whether CLI fallback is actually callable.

## Minimal Pattern

```ts
import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY ?? process.env.cursor_api_key;
if (!apiKey) throw new Error("CURSOR_API_KEY is not set");

const agent = await Agent.create({
  apiKey,
  name: "codex-cursor-task",
  model: {
    id: "grok-4.5",
    params: [
      { id: "effort", value: "high" },
      { id: "fast", value: "false" },
    ],
  },
  local: { cwd: repoPath },
});

try {
  const run = await agent.send(taskPrompt);

  for await (const event of run.stream()) {
    // Persist status, assistant text, tool calls, and errors as structured events.
  }

  const result = await run.wait();
  const artifacts = await agent.listArtifacts().catch(() => []);
  // Persist run.id, result, and artifact hints for later review.
} finally {
  agent.close();
}
```

## Workflow

1. Resolve the target repository path. Prefer the user's real project path over a Codex worktree if the user expects Cursor project-local state.
2. Read `CURSOR_API_KEY` from the current process or Windows User environment, then pass it explicitly as `apiKey`.
3. Create the **top-level** agent with the hard-rule model object above.
4. Send a bounded task prompt with an explicit write allowlist. For test runs, include "Do not create, edit, or delete files."
5. Prefer `scripts/cursor_local_agent_run.mjs` for real work. It writes `prompt.txt`, `summary.json`, `events.jsonl`, `diff.patch`, `review.md`, full-worktree and scoped git status, path-signature before/after JSON, and untracked **metadata only** (path/size/sha256 — never raw file content) under `--out-dir` (default `.agents/artifacts/cursor-task-*`). SDK store lives under that artifact directory.
6. If the run returns `error`, or exit code is non-zero due to outside-scope paths, inspect artifacts and `git diff` before deciding the next action.
7. After development tasks, inspect classification results and run requested validation before sending work back for review.

```powershell
$repo = "C:\project\damage_viewer_project_planning"
$skillRoot = Join-Path $repo ".agents\skills\cursor-local-agent"
node (Join-Path $skillRoot "scripts\cursor_local_agent_run.mjs") `
  --cwd $repo `
  --prompt-file C:\task\cursor-task.txt `
  --allowed-path 文档记录 `
  --out-dir (Join-Path $repo ".agents\artifacts\cursor-task-001")
```

Set `$repo` to the actual target worktree before copying a command. For Wasm work use `C:\project\damage_wasm_dev`; for Web use `C:\project\damage_web_dev`; for backend use `C:\project\damage_backend_dev`. If the target worktree does not contain this skill directory, use the planning repo's `.agents\skills\cursor-local-agent\scripts\...` path but keep `--cwd` pointed at the target repo.

Path-policy unit check:

```powershell
node (Join-Path $skillRoot "scripts\cursor_local_agent_path_policy.test.mjs")
```

## Verification

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
RESULT_MODEL={"id":"grok-4.5","params":[{"id":"effort","value":"high"},{"id":"fast","value":"false"}]}
ASSISTANT_TEXT=GROK_45_NONFAST_SMOKE_OK
```

`cursor_local_agent_run.mjs` is the preferred path for real work (artifacts always land under `--out-dir`). `cursor_local_agent_smoke.mjs` stays focused on model / SDK health checks.

## CLI Fallback

CLI fallback is not assumed to exist.

1. If the machine only exposes the desktop `cursor` wrapper, treat CLI fallback as blocked until you can prove there is a standalone programmable `cursor-agent` binary.
2. Even when `cursor-agent` exists, current CLI flags do not prove `grok-4.5` with `fast=false`, so strict fallback remains blocked by default.
3. Only relax the model rule for CLI fallback when the user explicitly accepts model drift for diagnostics or emergency recovery.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Usage shows `grok-4.5` with `fast=true`, bare `grok-4.5`, `composer-2.5`, `composer-2.5-fast`, or another Composer variant | Update the runner to request `grok-4.5` through the shared `MODEL` constant with `effort=high` and `fast=false`. |
| `Cursor.models.list()` works but `Agent.send()` is unauthenticated | Pass `apiKey` explicitly into `Agent.create(...)`. |
| Cursor IDE does not show the SDK session | Read SDK artifacts/transcripts directly; do not depend on the IDE history dropdown. |
| Session appears under the wrong project | Use the exact desired `cwd`; Cursor stores project state by path. |
| Run ends with `status=error` but files changed | Review `git diff`, summary JSON, and events log before deciding whether to open a fix loop. |
| Outside-scope paths changed during a run | Treat exit code 2 / `writeAllowlistAudit.failClosed` (run-delta based) as audit failure; untouched pre-existing dirt alone is not enough to fail. |
| Assuming `--allowed-path` is an OS sandbox | It is audited classification only; the agent process itself is not sandboxed by this flag. |
| CLI fallback was expected but only `cursor` exists | Probe for a standalone `cursor-agent` binary first; the desktop wrapper alone is not enough evidence. |
