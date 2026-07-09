---
name: wasm-batch-mechanism-development
description: Use when planning, implementing, validating, or handing off Damage Viewer TinyGo V2 Batch-style Wasm/DPS mechanisms, especially single_attacker_dps, equipment passives, linked effects, evidence fields, Web adapter/page checks, or task governance.
---

# Wasm Batch Mechanism Development

## Scope

Use this skill for Batch-style mechanism work across `C:\project\damage_wasm_dev`, `C:\project\damage_web_dev`, backend data checks, and planning docs. It complements `design-pattern-refactor`: use this for mechanism execution and evidence workflow; use `design-pattern-refactor` for behavior-preserving architecture splits.

## First Pass

1. Identify the target worktree and branch.
2. Read root `AGENTS.md`, then the nearest module `AGENTS.md` and `README.md`.
3. For TinyGo V2, read `wasm/tinygo_engine_v2/AGENTS.md` and `wasm/tinygo_engine_v2/README.md`.
4. Keep generic runtime and DPS lane separate:
   - generic runtime: `BeginRunJSON -> NewRunContext/Step -> effects/triggers`
   - DPS lane: `runSingleAttackerDPS -> processAttackPassives`
5. Use CodeGraph for symbol and call-chain questions, then confirm final claims with source reads.

## Ownership Split

Always state which side owns each value or behavior:

- Data owns numeric knobs, ids, owner roles, trigger kinds, thresholds, caps, proc scope, and published bundle contents.
- Wasm owns generic runtime logic, DPS scheduling, passive dispatch, state transitions, safety guards, and evidence output.
- Web owns adapter projection, editor UX, readiness gates, page defaults, assertions, and exported JSON display.
- Backend owns source data, persistence contracts, publish/preflight checks, and live DB compatibility.
- Planning owns detailed design, Cursor prompts, task governance mapping, and validation records.

Do not describe a data-driven value as hardcoded runtime behavior unless source reads prove that.

## Cursor Handoff Checklist

For coding tasks, produce a bounded Cursor prompt with:

- target repo and branch
- goal and non-goals
- allowed write scope
- data contract and evidence contract
- runtime lane being changed: generic, DPS, Web adapter, backend, or planning only
- validation commands
- stop conditions

Use `cursor-local-agent`: `grok-4.5`, explicit API key, event logs, diff review, and GPT-owned final validation.

## Planning Doc Conventions

For planning-first Batch work:

- detailed design path usually belongs under `文档记录/详细设计/最小验证/`
- testing evidence belongs under `文档记录/测试记录/wasm/` or the nearest existing test-record directory
- file names should include the Batch id and the mechanism name, such as `V2-BatchU-0-...计划.md`
- existing V2 Batch planning docs often map to `planning-validation-milestones`; verify `db/task_doc_governance/task_rules.json` before reusing or adding a task key
- Cursor prompt sections should be titled clearly, for example `Cursor Prompt: Wasm Gate`, `Cursor Prompt: Web Gate`, or `Cursor Prompt: Backend Gate`

Evidence names should be stable enough for final reports:

- exported page JSON: include batch id, page, and `proof` or `smoke`
- screenshot: pair with the JSON using the same stem when possible
- wasm artifact: include the path and SHA256 when the final built artifact matters
- governance proof: include the rebuild command and the task key lookup result

## Validation Matrix

Pick the smallest set that proves the changed surface:

| Surface | Minimum validation |
| --- | --- |
| TinyGo V2 Go logic | `go test -count=1 ./...` |
| runtime, scheduler, passive, formula, trigger, or damage behavior | add `go run ./cmd/bench` when available |
| Wasm export or ABI behavior | build wasm, then `node .\scripts\smoke-node.mjs` |
| Web adapter or page behavior | `npm run build` plus browser or Playwright smoke of the relevant page |
| planning docs or task mapping | update `db/task_doc_governance/task_rules.json`, then `node tools/task-governance/cli.mjs rebuild` |
| docs only without mapping changes | `git diff --check` and path existence checks |

For final reports, include exact evidence paths, page URLs or routes, pass/fail state, and whether user-side verification remains.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Mixing generic runtime and DPS conclusions | Name the lane and cite the actual entrypoint. |
| Treating item presence as readiness | Gate on the full published-contract readiness check. |
| Omitting governance after new planning docs | Update `task_rules.json`, rebuild, and verify docs by task key. |
| Handing off conceptual plans to Cursor | Write file-backed detailed design with scope, validation, and stop rules. |
| Reporting stale evidence | Prefer final Playwright JSON/PNG and final wasm hash over intermediate artifacts. |
