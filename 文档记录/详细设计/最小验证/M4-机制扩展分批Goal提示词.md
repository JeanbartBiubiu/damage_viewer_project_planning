TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: active
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-05-14

# M4 机制扩展分批 Goal 提示词

关联文档：
1. `文档记录/概要设计/验证里程碑.md`
2. `文档记录/详细设计/验证计划编写说明.md`
3. `文档记录/测试记录/wasm/M4-直伤回归与资源Gate-开发验证记录-2026-05-13.md`

本文只保存可交给 Codex `goal` 的执行提示词。它不是 M4 机制设计正文，也不是测试记录。实际实现结果应继续落到独立测试记录；如果新增或调整任务文档映射，需要更新 `db/task_doc_governance/task_rules.json` 并运行治理重建。

## 1. 通用执行约束

每批 goal 都必须遵守：

1. Wasm 代码只在 `C:\project\damage_wasm_dev` 开发，TinyGo V2 主目录是 `wasm/tinygo_engine_v2`。
2. 前端代码只在 `C:\project\damage_web_dev` 开发，前端模块是 `web`。
3. 不改后端 DB，不新增发布链路字段，除非当前批次遇到不可绕过的数据契约缺口并先写清原因。
4. 开始前检查两个 worktree 的分支和 `git status --short`，不要回滚用户或其他 agent 的未提交改动。
5. 每个 M4.x 小节必须先确认 M4.1 直伤回归仍通过，再实现本机制。
6. 每个机制必须有独立 wasm 测试、页面或导出证据、测试记录；不要把多个机制的 diff 混在同一条结论里。
7. 若必须改 runtime 公共 DTO、ABI、frame、Wasm bridge 或 published bundle adapter，先说明影响面，再做最小改动。
8. 每完成一个 M4.x checkpoint，都要运行对应最小验证；失败则停在该 checkpoint 修复，不继续扩到下一个机制。
9. 文档分层保持清晰：里程碑文档只改 gate 口径，验证计划写执行口径，测试记录写实际证据。

通用验证命令：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench

cd C:\project\damage_web_dev\web
npm run build

cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild
```

浏览器 smoke 优先使用用户已启动的前端：`http://localhost:5173/#/wasm-validation-m3`。如果端口不同，先识别 Vite 监听端口。页面只要能导出本批证据即可，不要求做完整战斗编排 UI。

## 2. Batch 1：低风险机制

目标机制：

1. `M4.3-cooldown-gate-001`：冷却。
2. `M4.10-multi-hit-damage-001`：多段伤害。
3. `M4.15-action-gate-001`：动作 gate。

推荐 goal 提示词：

```text
PLEASE IMPLEMENT M4 BATCH 1 ONLY.

Scope:
- Wasm worktree: C:\project\damage_wasm_dev
- Frontend worktree: C:\project\damage_web_dev
- Implement only these M4 checkpoints:
  1. M4.3-cooldown-gate-001
  2. M4.10-multi-hit-damage-001
  3. M4.15-action-gate-001
- Do not implement shield, healing, DoT, HoT, crit, RNG, control, interrupt, trigger chain, history window, counter, or mode augment in this goal.

Context:
- M1/M2/M3 canonical Ahri Q evidence is already established.
- M4.1 direct-damage regression and M4.2 insufficient-resource gate already exist and must remain passing.
- Resource-insufficient gate does not require game screenshots; the acceptance focus is Wasm event/action gate interception and no side effects.
- Reuse existing TinyGo V2 runtime contracts and Web M3/M4 single-action evidence page where possible.

Execution order:
1. Inspect both worktrees: branch, status, nearest AGENTS/README for touched paths.
2. Run current baseline tests for TinyGo V2 and note any pre-existing failures.
3. For M4.3 cooldown:
   - Add wasm tests proving first cast accepts, cooldown is consumed, readyAtMs is set, and an immediate second cast is blocked by cooldown.
   - Evidence must include accepted/blocked state, blockedReason, cooldownBefore/cooldownAfter, readyAtMs, and no unintended damage/resource side effects for the blocked cast.
4. For M4.10 multi-hit damage:
   - Add a minimal fixed fixture where one action produces multiple independent damage effects in deterministic order.
   - Evidence must show each segment effectIndex, finalDamage, damageType, targetHpBefore/After, and final target HP.
   - Do not introduce DoT or trigger-chain behavior.
5. For M4.15 action gate:
   - Reuse or extend CanCast-based checks.
   - Add one accepted path and one blocked path beyond the already proven insufficient-resource case if the runtime supports it cheaply; otherwise document why M4.2 is the current gate proof and add focused regression around CanCast ordering.
6. Update or extend the existing M3/M4 frontend validation page only if required to expose evidence rows or presets. Do not create a second Wasm loader.
7. Add a test record under 文档记录/测试记录/wasm/ for Batch 1.
8. Update task governance mapping if a new doc is added, then rebuild governance.

Validation:
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2: go test ./...
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2: go run ./cmd/bench
- C:\project\damage_web_dev\web: npm run build
- Browser smoke on #/wasm-validation-m3 if frontend evidence changed.
- Confirm M4.1 direct damage still outputs 144 magic + 144 true and target HP 1000 -> 712.
- Confirm M4.2 insufficient resource still outputs accepted=false, blockedReason="insufficient resource", self mana 50/843, target HP 1000, no effects/resourceDeltas.

Stop conditions:
- Stop and report if a mechanism requires ABI or DTO changes that would break existing M1/M2/M3 page contracts.
- Stop and report if a current runtime subsystem cannot represent the mechanism without inventing a parallel execution path.

Final report:
- List changed files by worktree.
- List each M4.x checkpoint and pass/fail.
- Include commands run and any warnings.
- State whether the next batch can start.
```

## 3. Batch 2：数值承载机制

目标机制：

1. `M4.4-shield-min-001`：护盾。
2. `M4.5-heal-min-001`：治疗。
3. `M4.8-dot-min-001`：DoT。
4. `M4.9-hot-min-001`：HoT。

推荐 goal 提示词：

```text
PLEASE IMPLEMENT M4 BATCH 2 ONLY.

Scope:
- Wasm worktree: C:\project\damage_wasm_dev
- Frontend worktree: C:\project\damage_web_dev
- Implement only these M4 checkpoints:
  1. M4.4-shield-min-001
  2. M4.5-heal-min-001
  3. M4.8-dot-min-001
  4. M4.9-hot-min-001
- Do not implement crit, RNG, control, interrupt, trigger chain, history window, counter, or mode augment in this goal.

Context:
- Batch 1 should already be passing before this starts.
- M4.1 direct damage remains the regression baseline for every checkpoint.
- Keep each mechanism minimal and independent. Do not combine shield + heal + DoT in one fixture.

Execution order:
1. Inspect both worktrees and current diffs. Do not revert unrelated changes.
2. Confirm M4.1/M4.2 and Batch 1 tests still pass, or report pre-existing failures.
3. For M4.4 shield:
   - Add a minimal fixture where a target has or receives a single shield, then fixed damage hits once.
   - Evidence must include shield before/after, absorbed amount, target HP before/after, and finalDamage.
   - Do not implement multi-layer shield, decay, shield-to-heal, or reflect damage.
4. For M4.5 heal:
   - Add a minimal fixture with a damaged actor and one fixed heal.
   - Evidence must include heal raw amount, final applied heal, HP before/after, and max-HP clamp behavior.
   - Do not implement lifesteal, grievous wounds, heal/shield power, or heal-to-shield.
5. For M4.8 DoT:
   - Add one status/effect that schedules a fixed number of damage ticks with deterministic timing.
   - Evidence must include apply event, tick times, tick damage, target HP after each tick, and status end/remain state if available.
   - Do not mix HoT or refresh behavior.
6. For M4.9 HoT:
   - Add one status/effect that schedules fixed heal ticks with deterministic timing.
   - Evidence must include apply event, tick times, heal amount, HP after each tick, and clamp behavior.
   - Do not mix DoT or refresh behavior.
7. Extend Web evidence rows/presets only as needed to display shield/heal/tick evidence. Reuse existing TinyGo V2 bridge.
8. Add a Batch 2 test record under 文档记录/测试记录/wasm/.
9. Update task governance mapping and rebuild if docs were added.

Validation:
- go test ./...
- go run ./cmd/bench
- npm run build
- Browser smoke if Web evidence changed.
- Re-run M4.1 and M4.2 smoke or equivalent automated checks to prove no regression.

Stop conditions:
- Stop if scheduler/status/tick runtime support is missing in a way that would require a broad architecture rewrite.
- Stop if shield/heal evidence cannot be represented without changing shared output DTO; document the exact missing field and propose the smallest DTO addition.

Final report:
- List changed files by worktree.
- Report each checkpoint separately.
- Identify any mechanism that remains development-side only versus accepted.
- State whether Batch 3 can start.
```

## 4. Batch 3：判定与随机机制

目标机制：

1. `M4.6-mark-apply-001`：标记施加。
2. `M4.7-conditional-hit-001`：条件命中。
3. `M4.11-crit-min-001`：暴击。
4. `M4.12-rng-seed-001`：随机数。

推荐 goal 提示词：

```text
PLEASE IMPLEMENT M4 BATCH 3 ONLY.

Scope:
- Wasm worktree: C:\project\damage_wasm_dev
- Frontend worktree: C:\project\damage_web_dev
- Implement only these M4 checkpoints:
  1. M4.6-mark-apply-001
  2. M4.7-conditional-hit-001
  3. M4.11-crit-min-001
  4. M4.12-rng-seed-001
- Do not implement control, interrupt, trigger chain, history window, counter, or mode augment in this goal.

Context:
- Batch 1 and Batch 2 should already be passing before this starts.
- Keep RNG deterministic under fixed seed.
- Do not use probabilistic distribution tests as acceptance. Use fixed seed, fixed expected output.

Execution order:
1. Inspect both worktrees and current diffs. Do not revert unrelated changes.
2. Confirm M4.1/M4.2 plus previous batch tests still pass.
3. For M4.6 mark apply:
   - Add one action that applies one mark to one actor.
   - Evidence must show mark target, mark id, stack/count or active state, and no accidental damage unless explicitly part of the fixture.
   - Do not implement mark consumption or explosion here.
4. For M4.7 conditional hit:
   - Add two minimal runs: condition true and condition false.
   - Evidence must show condition input, branch result, accepted/blocked or hit/miss state, and final output.
   - Reuse mark/status/attribute condition only if it is already stable.
5. For M4.11 crit:
   - Add deterministic crit and non-crit cases under fixed seed or explicit RNG fixture.
   - Evidence must show crit roll/result, crit multiplier, raw damage, final damage, and target HP after.
   - Do not implement full probability distribution.
6. For M4.12 RNG:
   - Add tests proving fixed seed produces repeatable output and different seed can produce a different documented branch when the fixture is designed for it.
   - Evidence must include seed and branch result.
7. Extend Web evidence rows/presets only as needed to display mark/condition/crit/RNG evidence. Reuse the existing M3/M4 page and TinyGo V2 bridge.
8. Add a Batch 3 test record under 文档记录/测试记录/wasm/.
9. Update task governance mapping and rebuild if docs were added.

Validation:
- go test ./...
- go run ./cmd/bench
- npm run build
- Browser smoke if Web evidence changed.
- Confirm M4.1 direct damage and M4.2 insufficient resource still pass.

Stop conditions:
- Stop if RNG state cannot be made deterministic without changing run input or runtime state contract.
- Stop if mark/condition state would require a broad status model redesign; report the smallest missing runtime primitive.

Final report:
- List changed files by worktree.
- Report each checkpoint separately.
- State which evidence fields were added or reused.
- State whether Batch 4 can start.
```

## 5. Batch 4：运行时复杂机制

目标机制：

1. `M4.13-control-min-001`：控制。
2. `M4.14-interrupt-min-001`：打断。
3. `M4.16-trigger-chain-min-001`：触发链。
4. `M4.17-history-window-min-001`：历史窗口。
5. `M4.18-counter-min-001`：计数器。
6. `M4.19-mode-augment-min-001`：模式强化。

推荐 goal 提示词：

```text
PLEASE IMPLEMENT M4 BATCH 4 ONLY.

Scope:
- Wasm worktree: C:\project\damage_wasm_dev
- Frontend worktree: C:\project\damage_web_dev
- Implement only these M4 checkpoints:
  1. M4.13-control-min-001
  2. M4.14-interrupt-min-001
  3. M4.16-trigger-chain-min-001
  4. M4.17-history-window-min-001
  5. M4.18-counter-min-001
  6. M4.19-mode-augment-min-001

Context:
- Batches 1, 2, and 3 should already be passing.
- This batch is the highest-risk batch. Keep implementation minimal and checkpoint-driven.
- Do not build a full 1v1 combat orchestration UI. M5 owns combined 1v1 regression after M4 is stable.

Execution order:
1. Inspect both worktrees and current diffs. Do not revert unrelated changes.
2. Confirm M4.1/M4.2 plus previous batch tests still pass.
3. For M4.13 control:
   - Add one control state applied to one target.
   - Evidence must show status/control id, target, active duration/state, and minimal effect on canCast if included.
   - Do not test interrupt or immunity here.
4. For M4.14 interrupt:
   - Add one running/channeling action and one interrupt source.
   - Evidence must show action start, interrupt event, interrupted state, and no completed effect after interruption.
   - Do not implement priority matrices or multi-source interrupt chains.
5. For M4.16 trigger chain:
   - Add one start event that triggers one follow-up effect.
   - Evidence must show event order, trigger condition, triggered effect, and final state.
   - Do not allow recursive trigger expansion in this checkpoint.
6. For M4.17 history window:
   - Add one fixture that writes a prior event and later reads it inside a bounded window.
   - Evidence must show history write, history read, window boundary, and current result.
   - Do not build full replay or long combat log browsing.
7. For M4.18 counter:
   - Add one counter that increments, is read, and optionally resets or consumes.
   - Evidence must show initial value, mutation, read point, and final value.
   - Do not implement multiple interacting counters.
8. For M4.19 mode augment:
   - Add one mode/augment flag that changes a known action or attribute result.
   - Evidence must compare normal mode and augmented mode under the same seed/input.
   - Do not implement complete mode trees or full augment ecosystem.
9. Extend Web evidence rows/presets only as needed. Reuse existing bridge/page. If the page becomes too crowded, add a minimal selector or evidence grouping, not a new loader.
10. Add a Batch 4 test record under 文档记录/测试记录/wasm/.
11. Update task governance mapping and rebuild if docs were added.

Validation:
- go test ./...
- go run ./cmd/bench
- npm run build
- Browser smoke if Web evidence changed.
- Confirm M4.1 direct damage and M4.2 insufficient resource still pass.

Stop conditions:
- Stop at the first mechanism that requires broad runtime architecture changes. Report the blocker and do not continue into later mechanisms.
- Stop if output evidence cannot explain order/state transitions clearly enough for later M5 debugging.

Final report:
- List changed files by worktree.
- Report each checkpoint separately.
- List any deferred architecture work.
- State whether M4 can be considered ready to move toward M5 small 1v1 regression.
```

## 6. 建议执行顺序

建议按本文顺序一批一批开 goal：

1. Batch 1 先收冷却、多段伤害、动作 gate。
2. Batch 2 再收护盾、治疗、DoT、HoT。
3. Batch 3 再收标记、条件命中、暴击、随机数。
4. Batch 4 最后收控制、打断、触发链、历史窗口、计数器、模式强化。

每批完成后，先看测试记录和页面 smoke，不要直接开下一批。如果上一批引入了 DTO 或 Web 证据结构变化，下一批提示词应先让 goal 重新读取最新测试记录和 diff。
