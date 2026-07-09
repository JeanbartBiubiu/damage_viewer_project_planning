You are working in the Go/TinyGo repo at C:\project\damage_wasm_dev, module `wasm/tinygo_engine_v2`.
This is a bounded fix task derived from a completed review. Implement the fixes below, add regression tests, and keep the change minimal and behavior-preserving outside the listed items.

## Reference (read first)
- Design (authoritative): 文档记录/详细设计/wasm/WASM详细设计.md (sections §4.1, §5.5/§5.6, §11, §12, §13, §14).
- The runtime generic engine lives under wasm/tinygo_engine_v2/internal/{runtime,compile,model,pipeline,formula,scheduler,status}.

## Allowed write scope (do NOT write outside these)
- wasm/tinygo_engine_v2/internal/**
- wasm/tinygo_engine_v2/internal/testkit/fixtures/**  (new fixtures allowed)
Do NOT modify: 文档记录/**, any other worktree, cmd/**, go.mod, ABI export signatures in cmd/engine_wasm/main.go.

## Non-goals (explicitly out of scope)
- Do NOT implement full listener/event dispatch or triggered_continuation chains (that is a separate future slice). Only the minimal emit_event change in Task L2 below.
- Do NOT change damage/DPS accounting semantics (Task L3 is test+comment only).
- Do NOT refactor unrelated code, rename symbols, or reformat files you are not changing.

## Tasks

### Task H1 — implement `attribute_change` operation in runtime
File: internal/runtime/generic_execution.go, func `executeOperation`.
Currently the switch has no `attribute_change` case, so a compiled `attribute_change` op falls to default and returns runtime_invariant_failed. Design §13 requires it to be a closed loop.
Implement a new case "attribute_change":
- Require `op.HasAmount` (else GenericErrMissingRequiredField "attribute_change requires amount") and `op.AttributeKey != ""` (else GenericErrMissingRequiredField "attribute_change requires attributeKey").
- Evaluate amount via f.evalAmount.
- Resolve target via existing resolveOperationTarget; stage the target combatant (f.stageFor).
- Apply the amount to the staged attribute slot's Base using these valuePolicy semantics (op.ValuePolicy), matching the attribute modifier policy family:
  - "" or "add": Base = Base + amount
  - "set" or "override_base": Base = amount
  - "multiply": Base = Base * amount
  - "percent_add": Base = Base + Base0*amount (Base0 = base before this op)
  - "min": Base = min(Base, amount)
  - "max": Base = max(Base, amount)
  If the slot does not exist, create it (zero value) then apply.
- If slot.Max > 0, clamp Base into [0, Max].
- Recompute the slot's Resolved: use the staged combatant's resolver (staged.resolver.ResolveAttributes over the staged attributes with an evalContext from the frame) so provider modifiers stay reflected; if there is no resolver/mounts, set Resolved = Base. Keep it consistent with how `commit()` re-resolves.
- Mark staged.dirty = true. Do not emit a command.
Add a fixture + runtime test:
- New fixture internal/testkit/fixtures/generic_p0_attribute_change.json: two combatants (source/target), one active ability whose single operation is attribute_change on target's attribute (e.g. "attack_damage" add +50), driverPlan casting it once, stopPolicy.durationMs small.
- New test in internal/runtime/generic_run_test.go asserting the target's final snapshot attribute Resolved reflects the change.

### Task H2 — guard stale provider expire cleanup
File: internal/runtime/generic_provider.go, func `handleExpireCleanup` (kind == "provider").
Problem: refresh_provider (extend/replace) enqueues a new cleanup but the original earlier cleanup still fires and removes the (now-extended) provider prematurely.
Fix: before calling removeProviderInstance for a provider cleanup, look up the current instance via status.FindByRef on the combatant's providers. If the instance still exists and its current ExpireAt is > s.nowMs (i.e. it was extended / not yet due), treat this cleanup event as STALE and skip removal (return without removing). Only remove when the instance is actually due (ExpireAt <= nowMs) or ExpireAt == 0 semantics do not apply here. Keep the sweep/default branches unchanged.
Add a runtime test: apply a provider with duration D, at t<D issue refresh_provider with policy "extend" (or set lifecycle refreshPolicy=extend) that pushes expiry later, run past the ORIGINAL expiry but before the NEW expiry, and assert the provider is still present (not removed by the stale event). Use a new fixture if needed (generic_p0_refresh_extend.json) or drive via newGenericRunState + manual enqueue like the existing TestExpireCleanupBeforeAbilityAttemptSameTimeMs test.

### Task M1 — StopPolicy defaults must be true when omitted
Design §4.1: stopOnTargetDeath and stopWhenNoEvents default to true when the field is omitted. Current DTO uses bare bool so omitted => false, contradicting the design.
File: internal/model/generic_run.go (StopPolicy struct) + all read sites.
- Change StopOnTargetDeath and StopWhenNoEvents to `*bool` (pointer) OR add accessor helpers + a custom UnmarshalJSON that defaults nil->true. Prefer pointer fields with helper methods StopOnTargetDeathOrDefault() bool and StopWhenNoEventsOrDefault() bool returning true when nil.
- Update all read sites (grep for StopOnTargetDeath / StopWhenNoEvents in internal/runtime/**) to use the helpers.
- Existing fixtures set these true explicitly, so they must keep passing.
Add a test: build a RunRequest with stopPolicy that OMITS both flags (unmarshal from JSON without the fields), and assert both resolve to true (e.g. target death stops the run; empty queue yields stop_reason no_events / handled per existing logic).

### Task M2 — parse RunRequest.safetyBudget and runtimeOptions
Design §4.1: RunRequest may include `safetyBudget` (maxChainDepth=32, maxCommandsPerEvent=256, plus maxEvents) and `runtimeOptions` (deterministic-only). Currently the DTO stops at Sampling and run-level safetyBudget is silently ignored.
File: internal/model/generic_run.go (add SafetyBudget struct + RuntimeOptions map/struct fields to RunRequest) and internal/runtime/generic_run.go (budget setup around lines building s.budget).
- Add SafetyBudget with MaxChainDepth, MaxCommandsPerEvent, MaxEvents (all int, omitempty).
- When provided, override the corresponding runtime budget fields. Keep compile Settings.MaxEvents as a HARD CAP: run safetyBudget.MaxEvents may lower but not exceed the compile-derived cap. Apply defaults (chain 32, commands 256) only when neither run nor compile provides them.
- runtimeOptions: parse into a struct/map; for P0, validate it is an object and otherwise ignore (do not fail). Do not add nondeterministic behavior.
Add a test asserting a run-level safetyBudget.MaxCommandsPerEvent lowers the effective limit (e.g. set to 1 and confirm an ability with >1 op hits max-commands error), and that MaxEvents cannot exceed the compile cap.

### Task L1 — cooldown_change: honor operation abilityRef + valuePolicy
Files: internal/compile/generic.go (compileOperation) + internal/runtime/generic_execution.go (cooldown_change case).
Problem: CompiledOperation drops the abilityRef STRING, and the runtime ignores op abilityRef (uses casting ability) and treats amount as absolute readyAt only.
- In compile: add field `AbilityRefStr string` to CompiledOperation and populate it from op.AbilityRef when present (keep existing HasAbilityRef and the CompiledAbilityRef).
- In runtime cooldown_change: choose the cooldown key = op.AbilityRefStr if HasAbilityRef and non-empty, else fall back to f.abilityRef. Resolve the owning combatant from that abilityRef (its `source|target` prefix) using resolveCombatantKey; if unresolved, error operation_target_missing.
- Apply valuePolicy (op.ValuePolicy) against the current readyAt (existing = current cooldown readyAt for that key, default nowMs):
  - "reset": readyAt = nowMs (ability ready now)
  - "reduce" or "refund": readyAt = max(nowMs, existing - amount)
  - "extend": readyAt = max(existing, nowMs) + amount
  - "set" or "": readyAt = nowMs + amount
- Never set readyAt < nowMs.
Add a runtime test covering reduce and reset semantics on a specific abilityRef.

### Task L2 — emit_event must not be a silent no-op (minimal only)
File: internal/runtime/generic_execution.go, case "emit_event".
- Instead of returning nil silently, record an evidence item (reuse s.recordEvidence with an appropriate EvidenceKind for an emitted event; if none exists add a minimal EvidenceKind constant like EvidenceKindEmittedEvent in internal/model) capturing timeMs, source, target, and op.Ref (or generated ref).
- Do NOT dispatch listeners or enqueue continuations. Add a code comment: "// Full listener dispatch is deferred to a dedicated slice; P0 only records the emitted event as evidence."
Add a small test asserting emit_event produces an evidence item.

### Task L3 — lock damage-dealt accounting semantics (test + comment only, NO behavior change)
Files: internal/runtime/generic_execution.go (applyCommand) — add a clarifying comment only; internal/runtime/generic_run_test.go — add a test.
- Add a comment at applyCommand documenting that damageDealt / recordDamage use the PRE-mitigation total amount (shield-absorbed portion is included) by design decision, pending §16 clarification.
- Add a test using a shield that partially absorbs damage, asserting: target HP reduced only by the non-absorbed portion, AND summary sourceDamageDealt equals the full pre-shield amount. Do NOT change the production behavior.

### Task L4 — heal overheal statistic output
Design §5.6: heal outputs overheal statistic but never exceeds max HP.
Files: internal/pipeline/resolver.go / internal/attribute (heal already clamps and returns healed), internal/runtime/generic_execution.go (applyCommand heal path), internal/model (summary/abilityStats DTO).
- Compute overheal = requested heal amount - actual healed (>= 0) at the heal application point.
- Accumulate an overheal total and expose it in the done summary (add a field like `sourceOverheal`/`targetOverheal` or a single `overhealTotal` on the summary; pick the minimal consistent addition and keep JSON stable/omitempty). Also fine to add to abilityStats if that is where healingDone lives.
- Add a test asserting overheal is reported when healing above max HP.

## Verification (run and make green before finishing)
From C:\project\damage_wasm_dev\wasm\tinygo_engine_v2:
- `go build ./...`
- `go test ./...`
All packages must pass. Do not weaken or delete existing tests. If an existing assertion legitimately must change due to a new field default, explain why in your final summary.

## Stop conditions
- Stop when `go test ./...` is fully green with the new tests included, OR
- Stop and report if any task requires writing outside the allowed scope, changing ABI signatures, or changing design docs — do not proceed with those; report the blocker instead.
- Do not attempt L2 full listener dispatch or L3 behavior changes under any circumstance.

## Final report
Summarize per-task: files changed, the exact semantics you implemented (especially attribute_change valuePolicy and cooldown_change valuePolicy), new fixtures/tests added, and the final `go test ./...` result. List anything skipped or blocked.
