---
name: design-pattern-refactor
description: Use when reviewing, planning, or implementing behavior-preserving refactors that split large source files or reorganize modules by design-pattern roles, especially TinyGo/Wasm generic compile/session/run, provider/ability/operation pipelines, Strategy, Command, State, Facade, Adapter, Builder, Observer, Mediator, Chain of Responsibility, SOLID, god files, or architecture debt. Do not restore removed legacy DPS/step-loop paths.
---

# Design Pattern Refactor

## Principle

Use design patterns as names for real variation points, not as decoration. The goal is not smaller files; the goal is deeper modules whose public surface hides runtime complexity and makes the next mechanic land in one obvious place.

This skill supports architecture review and authorized behavior-preserving implementation. Follow root `AGENTS.md` §2 for scope, risk review and execution ownership. A review-only request does not authorize code changes.

## First Pass

1. Identify the worktree root and branch.
2. Read the nearest `AGENTS.md`, relevant `README.md`, and validation scripts. For TinyGo V2, read `wasm/tinygo_engine_v2/AGENTS.md`, `README.md`, and `ARCHITECTURE.md`.
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
| Facade / Adapter | Keep host and ABI glue thin; translate external calls into session compile/run/release. | `cmd/engine_wasm/main.go`, ABI frame/outbox, JS Worker / Node host helpers |
| State | Make session registry and run lifecycle explicit, with guarded transitions. | `Session` genericSessions, `genericRunState`, stopReason |
| Command | Represent mutations before applying them through one resolver. | generic operations: damage, heal, shield, resource, attribute, provider apply |
| Strategy | Replace expanding switches where algorithms vary by type/policy. | operation handlers, formula ops, gate policies |
| Chain of Responsibility / Pipeline | Run ordered gates or transformations with stable evidence. | ability gates, damage pipeline, shield absorption, attribute modifiers |
| Observer / Mediator | Dispatch events to interested listeners without runtime-wide scanning. | provider listeners, emitted events, type matchers |
| Builder / Factory | Build compiled or output structures without mixing execution logic. | `CompileGeneric` → `CompiledSession`, snapshots, `DoneResult` builders |
| Memento | Capture state for inspection without advancing simulation. | initial/final snapshot, series points, evidence |

Use the Refactoring Guru catalog as vocabulary, not as a checklist. Do not introduce every pattern; choose the smallest pattern that names the actual change axis.

## Wasm-Specific Heuristics

Current architecture facts to verify before acting:

- The formal implementation lane is `wasm/tinygo_engine_v2`; do not revive old Rust/Katarina/demo lanes.
- `cmd/engine_wasm/main.go` should remain a thin ABI/session adapter.
- Canonical call chain: `CompileGeneric -> CompiledSession` (session registry) -> `RunGeneric` / `generic_execution` -> `engine_release_session`.
- New mechanisms land in provider / ability / operation + gate/provider/execution files, not in legacy action/effect DPS files.
- `single_attacker_dps` and `NewRunContext -> Step` remain **compatibility/regression** surfaces only; do not recommend refactoring them as if they were the current new-feature path.

Common design smells in this project:

- Treating legacy `engine_begin_run` / step-loop as the place for new generic features.
- `generic_run.go` / `generic_execution.go` growing by adding another switch branch without a named variation point.
- Skeleton packages existing without being on the actual generic runtime path.
- DPS string-map interpretation where generic runtime already has compiled IDs, type sets, or indexes.
- Tests covering helper-level success but missing ABI/session/host contract boundaries (`smoke-node.mjs`, session hash checks).

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

Rank candidates by leverage and risk. Prefer boundaries that reduce future branching in `generic_execution.go` and gate/provider files—not in legacy `dps_driver.go` unless the task is explicitly DPS regression.

## Planning A Split

Before implementation, define:

1. Goal: the one responsibility or variation point being extracted.
2. Non-goals: no semantic mechanic changes, no DTO changes, no scheduler redesign, no unrelated formatting churn.
3. Allowed write scope: narrow package/file list.
4. Public API compatibility: what names, JSON fields, ABI exports, and tests must stay stable.
5. Verification: exact commands and contract checks.
6. Stop conditions: ambiguous behavior, failing baseline, unexpected dirty overlap, or scope creep.

Resolve unclear boundaries from repository evidence first. Ask the user only for unresolved scope or behavior choices. Use `grill-me` only when the user explicitly requests that interview.

## Implementation Slices

Prefer these behavior-preserving slices:

1. Move pure helper types/functions into a file with a pattern-role name inside the same Go package. Do not change behavior.
2. Add focused tests only when the current tests do not lock the boundary.
3. Extract a dispatcher/handler table only after the current switch has a stable test baseline.
4. Introduce interfaces only when multiple implementations or a test seam already exist.
5. Move construction/output building after execution behavior is stable.
6. Remove or connect skeleton packages only after callers prove the boundary is real.

For generic runtime, likely file boundaries are:

- `generic_run.go`: run loop, stop policy, sampling/done assembly facade.
- `generic_gate.go`: ability attempt gates.
- `generic_execution.go`: operation dispatch and application.
- `generic_provider.go` / `generic_provider_tick.go`: provider lifecycle and ticks.
- `session.go`: compile/run/release ABI + registry only.

Legacy DPS and step-loop paths have been removed from the current TinyGo module. Do not recreate them for compatibility.

Treat these names as starting hypotheses. Confirm with current source before implementation or delegation.

## 实现与交接

主负责人可直接实现；仅在实际委派时提供以下必要信息：

- target repo and branch
- goal
- allowed write scope
- pattern boundary being introduced
- non-goals
- behavior invariants
- validation commands
- stop conditions

按根规则选择允许编码的执行角色。仅选择 Cursor 时加载其工具 skill。主负责人检查最终改动及对应验证证据，不要求每个角色重复全量检查。

## Verification

Choose the narrowest meaningful verification:

- Any Go refactor in TinyGo V2: `go test -count=1 ./...`
- Runtime/scheduler/attribute/resource/formula/pipeline/provider changes: also `go run ./cmd/bench`
- ABI/frame/outbox/session lifecycle changes: `go test -count=1 ./...` plus `node .\scripts\smoke-node.mjs` when a wasm artifact exists
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
| Replacing the scheduler before proving it is the bottleneck | Target adapter/runtime contracts or provider indexing first unless evidence points to the heap. |
| Restoring removed legacy DPS/step ABI | Use the current compile/run/release path and preserve behavior in scope. |
| Trusting docs over code | Verify current code, tests, and scripts every time. |
