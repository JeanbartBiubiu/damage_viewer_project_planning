TASK_KEY: wasm-generic-spellblade
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI Spellblade 机制验证记录

## 0. Commits

| 仓库 | commit | 备注 |
| --- | --- | --- |
| Planning | `898c7ef` | 初始 `d8628e3` |
| Wasm | `12a4111` | — |
| Backend | `6fa89d3` | — |
| Web | `6e82c4b` | — |

## 1. Backend

| 检查 | 结果 |
| --- | --- |
| static | 11/11 PASS |
| 全量 `mvn test` | 160/160 PASS |

Cursor run：`run-4b89efd5-61c1-4490-983d-45f8245c79db`。

## 2. Wasm

| 检查 | 结果 |
| --- | --- |
| targeted / full Go + bench | PASS |
| Node smoke / bench | PASS |

Bench（Go）：

| 指标 | 值 |
| --- | ---: |
| avg_us | 273.49 |
| max_us | 1168 |

Artifact：

| 项 | 值 |
| --- | --- |
| size | 1,075,591 bytes |
| SHA256 | `B7F3180A32DE4A6C437C61563D33927CEC8CD4673B59C4ACC5BE113EBEFAF9C0` |

Node bench：

| 指标 | 值 |
| --- | ---: |
| mean | 1.804ms |
| p95 | 2.287ms |

Cursor run：`run-b045e2b0-3279-4180-bbf7-5fda40488d3d`。

## 3. Web

| 检查 | 结果 |
| --- | --- |
| lint | PASS |
| typecheck | PASS |
| Vitest | 85/85 PASS |
| build | PASS |
| artifact hash | 与 Wasm 一致 |

Cursor runs：`run-d2e9946b-4526-4c39-a08a-6e13160f3ee7`；fix `run-4c3cca53-27fa-4532-bf66-129ef034d563`。

## 4. Live PostgreSQL

目标：`192.168.5.6` / `test0221` / 用户 `postgres`（无密码；凭据与连接串不记录）。

| 阶段 | current/published | 备注 |
| --- | --- | --- |
| seed 后 | 13/13 → 14/13 | — |
| seed 幂等重跑 | 14/13 | 不变 |
| 发布后 | 14/14 | — |

发布版本：`lol-generic-spellblade-v1-20260713`。

Readback：

| 项 | 值 |
| --- | --- |
| 62003 | 1 |
| ability relations | 6 |
| Tumble | 1；basic relation 0 |
| 3078 mount | 1 |
| states | 2 |
| listeners | 2 |
| copyable=false damage | 1 |
| ready | 1 / 10000 / 20190 |
| icd | 1 / 1500 / 20190 |

## 5. Browser E2E

路由：`#/wasm-validation-generic`。

固定输入：

- source：Vayne
- target：tank dummy
- equipment：`3078` + `3124`
- timeline：Tumble@0、AA@100；`maxAttempts=8`

运行结果：

| 项 | 值 |
| --- | --- |
| session | `generic-session-1` compile / run / release |
| stop | `duration_reached` |
| warnings | 0 |
| attempts / casts | 9 / 9 |
| evidence | 33（damage 24 / emitted 9） |

时序证据：

| t (ms) | 事实 |
| ---: | --- |
| 0 | `ability_started` |
| 100 | basic raw 126；Spellblade raw 252；Guinsoo raw 30 |
| 后续 | 无 Spellblade |

Phantom 禁区：Guinsoo phantom 仅含 `step_item_3124_guinsoos_damage`，不含 `step_item_3078_spellblade_damage`。

## 6. 结论与边界

结论：ready 首刀消费成立；phantom 禁区成立。

本批明确不覆盖：

- Tumble 仅为最小 cast 入口，不是完整 Vayne Q
- 同帧 arm / on-hit
- 多 Spellblade unique
- 巫妖 / 夺萃
