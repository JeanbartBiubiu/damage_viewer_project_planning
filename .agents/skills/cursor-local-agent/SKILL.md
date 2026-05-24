---
name: cursor-local-agent
description: Use when calling Cursor's TypeScript SDK or local agent from Codex, especially for GPT-to-Cursor development automation, Cursor SDK smoke tests, local agent runs, or Composer 2.5 model selection where fast mode must be disabled.
---

# Cursor Local Agent

## Overview

Use Cursor as a local execution engine through `@cursor/sdk`, not as a visible Cursor IDE chat. SDK local agent transcripts may be written under `~/.cursor/projects/...`, but they are not guaranteed to appear in the Cursor IDE Agent history dropdown.

For real development runs, treat the SDK event stream, summary JSON, artifact list, `git diff`, and local validation as the primary evidence chain. Cursor IDE history visibility is not an acceptance signal.

## Hard Rules

- Use only `composer-2.5`.
- Always disable Fast explicitly:

```ts
const model = {
  id: "composer-2.5",
  params: [{ id: "fast", value: "false" }],
};
```

- Never use `composer-latest`, `composer`, or plain `{ id: "composer-2.5" }`; plain `composer-2.5` defaults to `fast=true` and can appear in usage as `composer-2.5-fast`.
- Pass `apiKey` explicitly to `Agent.create(...)`; do not rely only on `process.env.CURSOR_API_KEY`.
- Do not print API keys. It is acceptable to print whether a key is present, its length, or a short prefix.
- Treat Cursor SDK runs as automation artifacts. Capture prompt, raw statuses, event log, run result, artifact hints, and `git diff` for review instead of relying on Cursor IDE UI visibility.
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
    id: "composer-2.5",
    params: [{ id: "fast", value: "false" }],
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
3. Create the agent with the hard-rule model object above.
4. Send a bounded task prompt. For test runs, include "Do not create, edit, or delete files."
5. Stream and store events as JSONL or an equivalent structured log. On completion, record `run.id`, `agent.agentId`, `result.model`, `result.status`, raw statuses, and artifact hints.
6. If the run returns `error`, inspect `git diff` and generated files before treating the round as failed-no-output.
7. After development tasks, inspect `git diff` and run requested validation before sending work back for review.

For real development tasks, prefer the dedicated runner:

```powershell
node C:\project\damage_wasm_dev\.agents\skills\cursor-local-agent\scripts\cursor_local_agent_run.mjs `
  --cwd C:\project\damage_wasm_dev `
  --prompt-file C:\task\cursor-task.txt `
  --allowed-path wasm\tinygo_engine_v2 `
  --out-dir C:\project\damage_wasm_dev\.agents\artifacts\cursor-task-001
```

The runner writes a standard artifact set:

- `prompt.txt`
- `summary.json`
- `events.jsonl`
- `diff.patch`
- `review.md`

Plus optional support files such as `preflight.md` and git status snapshots.

## Verification

Use `scripts/cursor_local_agent_smoke.mjs` for a safe smoke check:

```powershell
node C:\project\damage_wasm_dev\.agents\skills\cursor-local-agent\scripts\cursor_local_agent_smoke.mjs --dry-run
node C:\project\damage_wasm_dev\.agents\skills\cursor-local-agent\scripts\cursor_local_agent_smoke.mjs --cwd C:\project\damage_wasm_dev --send --out-dir C:\project\damage_wasm_dev\.agents\artifacts\cursor-smoke
```

The successful send result must include:

```text
RESULT_STATUS=finished
RESULT_MODEL={"id":"composer-2.5","params":[{"id":"fast","value":"false"}]}
ASSISTANT_TEXT=FAST_FALSE_SMOKE_OK
```

For real task runs, prefer also writing:

```text
--json-out <summary.json>
--events-out <events.jsonl>
```

`cursor_local_agent_run.mjs` is the preferred path for real work. `cursor_local_agent_smoke.mjs` stays focused on model / SDK health checks.

## CLI Fallback

CLI fallback is not assumed to exist.

1. If the machine only exposes the desktop `cursor` wrapper, treat CLI fallback as blocked until you can prove there is a standalone programmable `cursor-agent` binary.
2. Even when `cursor-agent` exists, current public CLI flags do not prove `fast=false`, so strict fallback remains blocked by default.
3. Only relax the model rule for CLI fallback when the user explicitly accepts model drift for diagnostics or emergency recovery.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Usage shows `composer-2.5-fast` | Add `params: [{ id: "fast", value: "false" }]`. |
| `Cursor.models.list()` works but `Agent.send()` is unauthenticated | Pass `apiKey` explicitly into `Agent.create(...)`. |
| Cursor IDE does not show the SDK session | Read SDK artifacts/transcripts directly; do not depend on the IDE history dropdown. |
| Session appears under the wrong project | Use the exact desired `cwd`; Cursor stores project state by path. |
| Run ends with `status=error` but files changed | Review `git diff`, summary JSON, and events log before deciding whether to open a fix loop. |
| CLI fallback was expected but only `cursor` exists | Probe for a standalone `cursor-agent` binary first; the desktop wrapper alone is not enough evidence. |
