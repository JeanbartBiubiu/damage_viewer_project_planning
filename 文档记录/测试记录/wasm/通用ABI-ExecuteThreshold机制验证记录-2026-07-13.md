TASK_KEY: wasm-generic-execute-threshold
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI Execute Threshold 机制验证记录

详细设计：[通用 ABI Execute Threshold 机制详细设计](../../详细设计/wasm/通用ABI-ExecuteThreshold机制详细设计.md)

## 0. Commits

| 仓库 | commit | 备注 |
| --- | --- | --- |
| Planning | `0eadd1f` | 详细设计 |
| Backend | `10038ac` | DDL / API / publish / Collector seed |
| Wasm | `00a973b` | 首版 Execute Threshold 实现 |
| Wasm | `b49c40c` | 修复真实 DB 形态下 ReadHP 误偏好 stale `hp.resolved` 的 bug |
| Web | `75b5704` | 首版接入 |
| Web | `f0cb2fc` | 收口；bundled wasm 与最终 artifact 对齐 |

## 1. Backend

| 检查 | 结果 |
| --- | --- |
| targeted | 45/45 PASS |
| 全量 Maven | 189/189 PASS |

落地范围：第十一类 execute detail；partition / exactly-one；Public / Admin resource；publish copy；Collector seed。

## 2. Wasm

| 检查 | 结果 |
| --- | --- |
| `go test` 全量 | PASS |
| build + Node smoke | PASS |

Bench（samples=100）：

| 指标 | 值 |
| --- | ---: |
| avg_us | 295.58 |
| max_us | 1096.00 |

最终 artifact：

| 项 | 值 |
| --- | --- |
| size | 1,081,905 bytes |
| SHA256 | `32AE1E53899FE45CD076A9F8B1F02DE509652FA42943094190D7993EDCACF9E0` |

`b49c40c` 修复点：ReadHP 在真实 DB 形态下曾错误优先取 stale `hp.resolved`，而非当前 HP；属已修复并复测通过的证据，**不是**开放风险。

## 3. Web

| 检查 | 结果 |
| --- | --- |
| lint / typecheck | PASS |
| Vitest | 100/100 PASS |
| build | PASS |
| bundled wasm | 与最终 size / SHA256 一致 |

## 4. Live PostgreSQL

目标：`test0221` / 用户 `postgres`（凭据与连接串不记录）。

路径：compatibility migration → triggers → reserved → seed。

| 阶段 | current/published | 备注 |
| --- | --- | --- |
| 变更前 | 15/15 | — |
| migration / triggers / reserved / seed 后 | 16/15 | — |
| seed 幂等重跑 | 16/15 | 不变 |
| 显式发布后 | 16/16 | — |

发布版本：`lol-generic-execute-v1-20260713`。

Readback：

| 项 | 值 |
| --- | --- |
| execute detail / log count | 1 |
| lol partitions attached | 2 |
| threshold | 0.05 |
| mount count | 1 |

## 5. Browser E2E

路由：`#/wasm-validation-generic`。

环境：干净 Web `5174` + Backend `18080`；revision **16**；source Vayne；target `target_dummy_tank`。

初始在 `5173` / `5174` 的 E2E 暴露了 stale `hp.resolved` 累积 bug；已由 Wasm `b49c40c` 修复并复测，纳入本记录接受证据。

### 5.1 正向：Collector-only

| 项 | 值 |
| --- | --- |
| attempts / casts | 37 / 37 |
| warnings | 0 |
| stop | `target_dead` |
| evidence | damage=49；emitted_event=37；execute=1 |
| session | 已 release |

Execute 证据（t=54820ms）：

| 字段 | 值 |
| --- | --- |
| step | `step_item_6676_collector_execute` |
| hpBefore | 43.33333333333271 |
| maxHp | 5000 |
| hpRatio | 0.008666666666666541 |
| threshold | 0.05 |
| thresholdType | `current_hp_ratio` |
| comparison | `strict_below` |
| killed | true |
| shieldBypassed | true |
| phantom | false |
| providerRef | `passive:provider_item_6676_collector_execute` |

机制结论：execute 与 damage 证据分离；剩余 43.33 HP **不是** damage evidence 行。

### 5.2 Phantom 组合：`item_6676` + `item_3124`（10s）

| 项 | 值 |
| --- | --- |
| stop | `duration_reached` |
| execute count | 0 |
| session | 已 release |

Phantom 禁区证据：t=8795ms 存在 Guinsoo damage（`phantom=true`，`phase=phantom`，`repeatTag=phantom_hit`），证明 phantom replay **不会** 重新派发 Collector execute listener。

## 6. 结论与边界

结论：Collector Execute Threshold 闭环成立（Backend / Wasm / Web / live 16/16 / 浏览器正向 + phantom 禁区）；stale HP bug 已修复并复测。

本批明确不覆盖（non-goals）：

- any-damage / global `damage_dealt` execute
- skills / DoT / linked execute
- gold / death event

后续审计顺序：linked effects → crit / modifier。

总体审计任务 `wasm-generic-min-validation-coverage-audit` 仍保持开发中，本任务不改动该条目。
