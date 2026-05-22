---
name: cursor-local-agent
description: Use when calling Cursor's TypeScript SDK or local agent from Codex, especially for GPT-to-Cursor development automation, Cursor SDK smoke tests, local agent runs, or Composer 2.5 model selection where fast mode must be disabled.
---

# Cursor Local Agent

## Overview

Use Cursor as a local execution engine through `@cursor/sdk`, not as a visible Cursor IDE chat. SDK local agent transcripts may be written under `~/.cursor/projects/...`, but they are not guaranteed to appear in the Cursor IDE Agent history dropdown.

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
- Treat Cursor SDK runs as automation artifacts. Capture prompt, run result, transcript path, and `git diff` for review instead of relying on Cursor IDE UI visibility.

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

const run = await agent.send(taskPrompt);

for await (const event of run.stream()) {
  // Record status, assistant text, tool calls, and errors.
}

const result = await run.wait();
agent.close();
```

## Workflow

1. Resolve the target repository path. Prefer the user's real project path over a Codex worktree if the user expects Cursor project-local state.
2. Read `CURSOR_API_KEY` from the current process or Windows User environment, then pass it explicitly as `apiKey`.
3. Create the agent with the hard-rule model object above.
4. Send a bounded task prompt. For test runs, include "Do not create, edit, or delete files."
5. Stream and store events. On completion, record `run.id`, `agent.agentId`, `result.model`, and `result.status`.
6. After development tasks, inspect `git diff` and run requested validation before sending work back for review.

## Verification

Use `scripts/cursor_local_agent_smoke.mjs` for a safe smoke check:

```powershell
node C:\project\damage_viewer_project_planning\.agents\skills\cursor-local-agent\scripts\cursor_local_agent_smoke.mjs --dry-run
node C:\project\damage_viewer_project_planning\.agents\skills\cursor-local-agent\scripts\cursor_local_agent_smoke.mjs --cwd C:\project\damage_viewer_project_planning --send
```

The successful send result must include:

```text
RESULT_MODEL={"id":"composer-2.5","params":[{"id":"fast","value":"false"}]}
ASSISTANT_TEXT=FAST_FALSE_SMOKE_OK
```

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Usage shows `composer-2.5-fast` | Add `params: [{ id: "fast", value: "false" }]`. |
| `Cursor.models.list()` works but `Agent.send()` is unauthenticated | Pass `apiKey` explicitly into `Agent.create(...)`. |
| Cursor IDE does not show the SDK session | Read SDK artifacts/transcripts directly; do not depend on the IDE history dropdown. |
| Session appears under the wrong project | Use the exact desired `cwd`; Cursor stores project state by path. |
