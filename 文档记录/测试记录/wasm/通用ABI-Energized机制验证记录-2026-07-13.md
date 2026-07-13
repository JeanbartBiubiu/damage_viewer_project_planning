TASK_KEY: wasm-generic-energized
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI Energized 机制验证记录

## 0. Commits

| 仓库 | commit | 备注 |
| --- | --- | --- |
| Planning | `b99d2b8` | 设计 |
| Wasm | `895300c` | — |
| Backend | `2c94bbb` | — |
| Web | `168dd81` | — |

## 1. Wasm

| 检查 | 结果 |
| --- | --- |
| targeted compile / runtime | PASS |
| `go test -count=1 ./...` | PASS |
| build + Node smoke | PASS |

Bench（`go run ./cmd/bench`，samples=100）：

| 指标 | 值 |
| --- | ---: |
| avg_us | 266.88 |
| max_us | 1071.00 |

Artifact：

| 项 | 值 |
| --- | --- |
| size | 1,075,722 bytes |
| SHA256 | `5DB6814763D5CA9A84304E6F77765730BBA4CEE0DABD763B6154B210DB1AA21F` |

## 2. Backend

| 检查 | 结果 |
| --- | --- |
| Energized static | 8/8 PASS |
| 全量 Maven | 168/168 PASS |

## 3. Web

| 检查 | 结果 |
| --- | --- |
| lint / typecheck | PASS |
| Vitest | 86/86 PASS |
| build | PASS |
| embedded wasm | 与 Wasm SHA256 一致 |

## 4. Live PostgreSQL

目标：`192.168.5.6` / `test0221` / 用户 `postgres`（无密码；凭据与连接串不记录）。

| 阶段 | current/published | 备注 |
| --- | --- | --- |
| seed 首跑 | 14/14 → 15/14 | — |
| seed 幂等重跑 | 15/14 | 不变 |
| 发布后 | 15/15 | — |

发布版本：`lol-generic-energized-v1-20260713`。

Readback：

| 项 | 值 |
| --- | --- |
| provider / state / listener / steps / mount | 1 / 1 / 1 / 3 / 1 |
| step 0 | damage ready |
| step 1 | consume ready |
| step 2 | add unconditional |

## 5. Browser E2E

路由：`#/wasm-validation-generic`。

固定输入：

- source：Vayne
- target：tank dummy
- equipment：`3094` + `3124`
- revision：15

运行结果：

| 项 | 值 |
| --- | --- |
| session | compile / run / release |
| stop | `duration_reached` |
| warnings | 0 |
| attempts / casts | 9 / 9 |
| evidence | 38 |
| basic_attack_hit | 9 |
| release | success |

Energized 伤害证据：

| t (ms) | 事实 |
| ---: | --- |
| 2764 | Energized raw=40，`phantom=false` |
| 5172 | Energized raw=40，`phantom=false` |

- Energized phantom count：**0**
- Guinsoo phantom：仍存在，且仅复制自身（不含 Energized）

机制结论：

- 第 4 刀只充满，第 5 刀触发；第 9 刀第二轮触发。
- Wasm 单元测试锁 final charge=25 与 cap / phantom 边界。
- 浏览器页面未直接展示最终 `providerState`；最终 charge 证据来自 Wasm gate，不伪称页面直接读取。

## 6. 结论与边界

结论：疾射火炮单真实 gate 充能闭环成立；phantom 禁区成立；live **15/15** 与 artifact 已闭环。

本批明确不覆盖：

- 移动 / 距离充能
- 额外射程、弹射、slow、共享盈能池
- execute / linked effects / crit / modifier（属总体审计后续）

总体审计任务 `wasm-generic-min-validation-coverage-audit` **保持开发中 / active**。
