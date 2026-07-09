---
name: design-pattern-refactor
description: Use when reviewing, planning, or implementing behavior-preserving refactors that split large source files or reorganize modules by design-pattern roles, especially TinyGo/Wasm runtime code, single_attacker_dps, effect/trigger/damage pipelines, Strategy, Command, State, Facade, Adapter, Builder, Observer, Mediator, Chain of Responsibility, SOLID, god files, or architecture debt.
---

# Design Pattern Refactor

## Principle

Use design patterns as names for real variation points, not as decoration. The goal is not smaller files; the goal is deeper modules whose public surface hides runtime complexity and makes the next mechanic land in one obvious place.

This skill supports both read-only architecture review and bounded implementation planning. It is not permission to edit code directly: for code/script/config changes in this repo, first converge scope, then follow the Cursor workflow in the root `AGENTS.md`.

## First Pass

1. Identify the worktree root and branch.
2. Read the nearest `AGENTS.md`, relevant `README.md`, and validation scripts. For TinyGo V2, read `wasm/tinygo_engine_v2/AGENTS.md` and `wasm/tinygo_engine_v2/README.md`.
3. Use CodeGraph before broad source scans for symbol/call-chain work:
   - `npx @colbymchenry/codegraph status`
   - `npx @colbymchenry/codegraph sync` when pending source changes make the index stale
   - `npx @colbymchenry/codegraph query|callers|callees|impact <symbol>`
4. Return from CodeGraph candidates to source lines with targeted reads. Use `rg` for exact text, JSON, Markdown, scripts, and final literal checks.
5. Preserve existing user changes. Do not revert unrelated dirty files.

Use subagents for independent read-only slices when the review is broad: one agent can inspect runtime boundaries, another can inspect tests/contract coverage. Give each agent a concrete read scope and ask for file/line evidence.

## Pattern Fit Test

Only recommend a pattern when all of these are true:

- It isolates a recurring variation point or state transition.
- It reduces caller knowledge, not just line count.
- It gives a clear owner for new behavior.
- It can be introduced in behavior-preserving slices.
- It has existing or cheap-to-add tests that prove equivalence.

Reject the pattern when it creates a one-method interface with no real variability, hides simple code behind ceremony, weakens TinyGo hot-path constraints, or splits a file without changing responsibility boundaries.

## Pattern Map For This Wasm Project

| Pattern role | Use it for | Local targets |
| --- | --- | --- |
| Facade / Adapter | Keep host and ABI glue thin; translate external calls into internal session operations. | `cmd/engine_wasm/main.go`, ABI frame/outbox, future JS Worker adapter |
| State | Make lifecycle and simulation phases explicit, with guarded transitions. | `Session.phase`, `RunContext.Done`, DPS curve status/blocking |
| Command | Represent mutations before applying them through one resolver. | damage, heal, shield, resource, status, attribute changes |
| Strategy | Replace expanding switches where algorithms vary by type/policy. | effect handlers, crit policy, DPS passive operation handlers, incoming modifiers |
| Chain of Responsibility / Pipeline | Run ordered gates or transformations with stable evidence. | cast gates, resource/cooldown/control checks, damage pipeline, shield absorption, incoming damage modifiers |
| Observer / Mediator | Dispatch events to interested triggers without runtime-wide scanning. | generic triggers, DPS linked effects, owner-role matching |
| Builder / Factory | Build compiled or output structures without mixing execution logic. | `compile.Bundle`, compiled DPS passive/matcher, snapshots, done payloads |
| Memento | Capture state for inspection without advancing simulation. | initial snapshot, action snapshot, value trace, final done payload |

Use the Refactoring Guru catalog as vocabulary, not as a checklist. Do not introduce every pattern; choose the smallest pattern that names the actual change axis.

## Wasm-Specific Heuristics

Current architecture facts to verify before acting:

- The formal implementation lane is `wasm/tinygo_engine_v2`; do not revive old Rust/Katarina/demo lanes.
- `cmd/engine_wasm/main.go` should remain a thin ABI/session adapter.
- `compile.Bundle` is the stable Compiler/IR boundary: DTOs become short IDs, slices, indexes, and collect-all validation.
- Generic runtime currently flows through `NewRunContext -> Step -> dispatch -> cast/effect/damage/trigger`.
- `single_attacker_dps` is a separate lane that reuses selected `RunContext` capabilities but owns its own basic-attack schedule, passive flow, dot flow, and target HP timeline.
- `action/basic_attack` remains the authoritative basic-attack classifier unless there is an explicit migration plan.

Common design smells in this project:

- `engine_begin_run` shape-based routing instead of explicit run contract.
- `runtime.go` or `dps_driver.go` growing by adding another switch branch or helper near the bottom.
- Skeleton packages such as `command`, `pipeline`, `trigger`, `status`, or `shield` existing without being the actual runtime path.
- DPS logic using string-map interpretation where generic runtime already has compiled IDs, type sets, or indexes.
- Tests covering helper-level success but missing ABI/session/host contract boundaries.

## Review Output

For read-only review, report findings before redesign ideas. Use this shape:

```text
Finding: <risk title>
Evidence: <file:line>...
Pattern diagnosis: <current smell> -> <candidate pattern role>
Impact: <why this makes future mechanics harder or riskier>
Recommendation: <smallest behavior-preserving next step>
Validation: <existing or needed tests>
```

Then provide a candidate table:

| Candidate | Pattern role | Files now | Proposed boundary | Invariants to preserve | First safe slice |
| --- | --- | --- | --- | --- | --- |

Rank candidates by leverage and risk. Prefer boundaries that reduce future branching in `runtime.go` and `dps_driver.go`.

## Planning A Split

Before implementation, define:

1. Goal: the one responsibility or variation point being extracted.
2. Non-goals: no semantic mechanic changes, no DTO changes, no scheduler redesign, no unrelated formatting churn.
3. Allowed write scope: narrow package/file list.
4. Public API compatibility: what names, JSON fields, ABI exports, and tests must stay stable.
5. Verification: exact commands and contract checks.
6. Stop conditions: ambiguous behavior, failing baseline, unexpected dirty overlap, or scope creep.

If the boundary is not clear, use `grill-me` with one question at a time. Ask about the responsibility cut, not about implementation trivia.

## Implementation Slices

Prefer these behavior-preserving slices:

1. Move pure helper types/functions into a file with a pattern-role name inside the same Go package. Do not change behavior.
2. Add focused tests only when the current tests do not lock the boundary.
3. Extract a dispatcher/handler table only after the current switch has a stable test baseline.
4. Introduce interfaces only when multiple implementations or a test seam already exist.
5. Move construction/output building after execution behavior is stable.
6. Remove or connect skeleton packages only after callers prove the boundary is real.

For `runtime.go`, likely file boundaries are:

- `runtime_lifecycle.go`: `RunContext` setup, `Step`, `dispatch`, done/abort.
- `cast_gate.go`: ownership, resource, cooldown, control, mark gates.
- `cast_execution.go`: cast intent, channel completion, action result assembly.
- `effect_dispatcher.go`: effect type dispatch and effect evidence.
- `damage_pipeline.go`: damage/heal/shield application and damage math.
- `trigger_dispatcher.go`: trigger indexing, owner/event matching, trigger result evidence.
- `snapshot_builder.go`: actor/action snapshots, samples, done payload construction.

For `dps_driver.go`, likely file boundaries are:

- `dps_driver.go`: facade entrypoints only.
- `dps_state.go`: curve state, time, HP, attrs, blocking.
- `dps_schedule.go`: basic attack and dot scheduling.
- `dps_passive_dispatcher.go`: linked-effect event dispatch and owner-role matching.
- `dps_operation_handlers.go`: Strategy-style operation handlers.
- `dps_damage.go`: target/attacker damage application and timelines.
- `dps_energized.go`: charge/consume state machine.
- `dps_phantom_hit.go`: phantom-hit repeat rules.
- `dps_validation.go`: DPS contract validation.
- `dps_output_builder.go`: result timelines, breakdowns, summaries.

Treat these names as starting hypotheses. Confirm with current source before using them in a Cursor prompt.

## Cursor Handoff

For code edits, produce a bounded Cursor prompt with:

- target repo and branch
- goal
- allowed write scope
- pattern boundary being introduced
- non-goals
- behavior invariants
- validation commands
- stop conditions

Use `cursor-local-agent` rules: `grok-4.5` with explicit `apiKey`, then GPT reviews Cursor artifacts, event logs, `git diff`, and tests before acceptance.

## Verification

Choose the narrowest meaningful verification:

- Any Go refactor in TinyGo V2: `go test ./...`
- Runtime/scheduler/attribute/resource/formula/pipeline/trigger changes: also `go run ./cmd/bench`
- ABI/frame/outbox/session lifecycle changes: `go test ./...` plus host contract or `node .\scripts\smoke-node.mjs` when a wasm artifact exists
- TinyGo build/export/script changes: `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1`
- Frontend adapter changes: follow `web/AGENTS.md` and verify the browser flow

When build/smoke tools are missing, report the missing prerequisite separately from code correctness.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Splitting by line count | Split by pattern role and variation point. |
| Adding pattern names without changing ownership | Show which future behavior now lands in one obvious place. |
| Creating one-method interfaces | Prefer package-private functions or handler tables until real variability exists. |
| Mixing behavior changes with moves | First move/extract with tests green; change behavior in a later slice. |
| Replacing the scheduler before proving it is the bottleneck | Target adapter/runtime contracts or passive indexing first unless evidence points to the heap. |
| Treating DPS as generic runtime mode | Name the shared boundary explicitly; keep DPS-owned state explicit. |
| Trusting docs over code | Verify current code, tests, and scripts every time. |
