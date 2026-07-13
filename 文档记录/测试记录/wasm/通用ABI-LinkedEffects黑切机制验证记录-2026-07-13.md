TASK_KEY: wasm-generic-linked-effects-black-cleaver
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI Linked Effects 黑切机制验证记录

详细设计：[通用 ABI Linked Effects 黑切机制详细设计](../../详细设计/wasm/通用ABI-LinkedEffects黑切机制详细设计.md)

## 0. Commits

| 仓库 | commit | 备注 |
| --- | --- | --- |
| Planning | `a6ae494` | `docs: design generic linked effects mechanism` |
| Backend | `678d95a` | `feat(backend): add black cleaver linked effects data` |
| Wasm | `3dfe838` | `feat(wasm): synthesize linked damage events` |
| Web | `a2b7388` | `chore(web): sync linked effects wasm` |

## 1. Cursor 协同证据

初始流式 runner 在 Node 20 / Node 24 分别触发 heap OOM；均先检查 events/diff 且无代码落盘。

随后保持顶层模型合同不变，改用同一 Cursor SDK 的非流式 `run.wait()` 路径。所有成功 run：

| 项 | 值 |
| --- | --- |
| 模型 | `grok-4.5` |
| effort | `high` |
| fast | `false` |

| 阶段 | run id |
| --- | --- |
| Planning | `run-ee89a3bc-5fc2-4182-9578-9d75cebaf3f0` |
| Backend | `run-4241b287-7f99-43b3-981b-bcaedd9b6942` |
| Wasm | `run-92a46442-220d-4b7b-84ce-b7452d4941e3` |
| Web artifact | `run-e4fb2a2e-0a45-46a4-9186-19fe03af2b3e` |

## 2. Backend / Data

| 检查 | 结果 |
| --- | --- |
| targeted `mvn -Dtest=LolGenericLinkedEffectsSeedSqlTest test` | 7/7 PASS |
| full `mvn test` | 196/196 PASS |

契约约束：

- reserved：`20214`=`event/damage_dealt/physical`、`20215`=`event/damage_dealt/basic_attack`
- 无新 DDL / API / operation

Seed 图：

| 对象 | 计数 |
| --- | ---: |
| item_3071 → provider / mount | 1 |
| formula | 3 |
| listener | 1 |
| ALL matcher | 4 |
| steps | 2 |
| attribute detail | 1 |
| state detail | 1 |

## 3. Wasm

| 检查 | 结果 |
| --- | --- |
| targeted `go test ./internal/runtime -run "GenericLinkedEffects\|DamageDealt\|BlackCleaver" -count=1` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench`（samples=100） | avg_us=271.72；max_us=1045.00 |
| build | PASS |
| Node smoke | PASS |

Artifact：

| 项 | 值 |
| --- | --- |
| size | 1,084,307 bytes |
| SHA256 | `573D6D9AAB724A96B4194D016C7F34923A85F9BC0A07B57DAFDC2E6986543C3A` |

Runtime 测试直接证明：

- 首击先按旧 armor 结算
- 5 层后 armor 100→80、stacks=5；第 6 击不再减
- 同 frame 多 physical 只 emit / stack 一次
- magic / 非 basic / 0 damage 不触发
- catalog fail closed
- target-owned 不误触发
- child / phantom 不递归
- `MaxCommandsPerEvent=1` fatal
- deterministic

## 4. Web

| 检查 | 结果 |
| --- | --- |
| wasm artifact hash / size | 与 Wasm worktree 一致 |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | 100/100 PASS |
| `npm run build` | PASS；bundle wasm 1,084.31 kB |
| TypeScript | 无修改；现有 assembler / client 已支持 graph |

## 5. Live PostgreSQL

目标：`192.168.5.6` / `test0221` / 用户 `postgres`（禁止记录密码；凭据与连接串不记录）。

前置只读：

| 项 | 值 |
| --- | --- |
| state | 16/16 |
| 20214 / 20215 | 未占用 |
| item_3071 | 1 |
| 既有 mount | 0 |
| armor definition | 1 |

执行路径：`reserved_types_seed.sql` → `lol_generic_linked_effects_seed.sql`。

| 阶段 | current/published | 备注 |
| --- | --- | --- |
| 首次 seed | 17/16 | — |
| 幂等重跑 | 17/16 | 不变 |
| 显式 Backend Admin publish 后 | 17/17 | — |

发布版本：`lol-generic-linked-effects-v1-20260713`，`changeRevision=17`。

发布后公开 current/version 与 combat-data state 均一致。

主表核对：

| 对象 | 计数 |
| --- | ---: |
| types | 4 |
| provider | 1 |
| mount | 1 |
| formulas | 3 |
| listener | 1 |
| matchers | 4 |
| steps | 2 |
| attribute detail | 1 |
| state detail | 1 |

Condition 精确为：`provider.target_state.carve_stacks < 5`。

发布日志：provider=1、steps=2、attribute detail=1、state detail=1。

## 6. Browser E2E

路由：`#/wasm-validation-generic`。

环境：临时 Web `5174` + Backend `18080`；结束后均停止且 browser tab finalize。

固定输入：

| 项 | 值 |
| --- | --- |
| currentRevision | 17 |
| source | `hero_vayne` |
| target | `target_dummy_tank` |
| equipment | `item_3071` |

Compile：

| 项 | 值 |
| --- | --- |
| 结果 | PASS |
| session | `generic-session-1` |
| metadata | 2 combatants / 8 providers / 4 abilities / 70 types / 36 formulas |

Run：

| 项 | 值 |
| --- | --- |
| 结果 | PASS |
| attempts / casts / skips / warnings | 6 / 6 / 0 / 0 |
| stop | `duration_reached` |
| duration | 10000ms |
| evidence | not truncated |

Evidence counts：

| 类型 | 计数 | 备注 |
| --- | ---: | --- |
| damage | 8 | 6 次基础 physical + 第 3/6 击银弩 true damage |
| emitted_event | 12 | 6 basic_attack_hit + 6 damage_dealt |

银弩 listener child true damage **未**递归生成 `damage_dealt`。

六次自动 `event/damage_dealt`：均为 `rawAmount=100`、`damageType=damage/physical`、`phantom=false`、`operationRef=step_hero_vayne_basic_attack_damage`。

mitigatedAmount 序列：

| 击次 | mitigatedAmount | 含义 |
| ---: | --- | --- |
| 1 | 33.333333333333336 | 初始 armor 200 |
| 2 | 33.78378378378378 | armor 196 |
| 3 | 34.24657534246575 | armor 192 |
| 4 | 34.72222222222222 | armor 188 |
| 5 | 35.2112676056338 | armor 184 |
| 6 | 35.714285714285715 | 第 6 击按 armor 180 |

该序列证明：每次 post-damage **-4**，恰好 **5** 层封顶；第 6 击不再继续减甲。

Summary：

| 项 | 值 |
| --- | --- |
| source damage | 807.011 |
| basic attack ability damage | 207.0114680017246 |
| target final HP | 4192.989 |

Release：PASS，`释放成功：generic-session-1`。

## 7. 结论与边界

结论：Linked Effects 黑切（`item_3071` Carve）首批闭环成立（Backend / Wasm / Web / live **17/17** / 浏览器 E2E）。

本批明确边界（non-goals）：

- 首批忠实迁移 `on_damage_dealt + physical + real_basic_attack_only` 的 5 层核心
- **不**实现正式 LoL 6 秒持续 / 刷新 / 掉层；run 内永久
- **不**使用 provider modifier 或 `provider_state_fields` cap
- 总体审计 **不能**关闭；后续继续 crit / modifier

总体审计任务 `wasm-generic-min-validation-coverage-audit` 仍保持 **开发中 / active**，本任务不改动该条目。

## 8. 治理验证

| 命令 | 预期 |
| --- | --- |
| `node tools/task-governance/cli.mjs rebuild` | 成功 |
| `node tools/task-governance/cli.mjs tasks` | 本任务已完成 |
| `node tools/task-governance/cli.mjs docs wasm-generic-linked-effects-black-cleaver` | 含详细设计 + 本验证记录 |
| `git diff --check` | 通过 |

Pre-existing 治理基线警告（非本 feature 引入）：

- 5 个 unassigned docs
- 1 个 missing 临时 review 文档
