TASK_KEY: wasm-generic-draven-stand-aside
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 德莱文 E 开道利斧（Stand Aside）机制详细设计

关联验证记录：[通用 ABI 德莱文 E 开道利斧 Stand Aside 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_draven|E|开道利斧` 标为 `completed/full/generic_runtime`（G8 `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV draven-e-stand-aside-phase-a-v2`（DESIGN_REVIEW v1 因提出不存在的 canonical cast-delay/phases 合同而被 supersede，**不得**称 v1 READY；v2 READY `run-5317a2c2-4fbd-488e-b357-f4137248a6fd`）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_draven\|E\|开道利斧` |
| Wiki | `Template:Data Draven/Stand Aside`；pageId `1307070`；revision `4034694`；timestamp `2026-06-23T21:12:57Z`；raw bytes `1168`；SHA256 `7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d`；reviewed sidecar `数据参考/lol-wiki-current-champions/normalized/generic/draven-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| status | `completed/full/generic_runtime`；G8 `migrated` |
| completedBoundary | `rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget` |
| Rank-5 active | 70 mana；12000ms cooldown；immediate primary-target scaffold；每次成功施放一笔非暴击/不可复制物理伤害 `215 + 0.50*(source.attr.ad.resolved-source.attr.ad.base)` |
| 数值交叉 | level/base AD62、resolved AD142、bonusAD80 → raw255；目标 armor100 → mitigated127.5。t0 / t12000 命中；t11999 cooldown-blocked 且不扣 mana |
| 时序边界 | Canonical generic `AbilityDefinition` **无** cast-delay/phases 字段；compile 将 operations flatten。Wiki 250ms cast / effect-at-cast-end **显式排除**，**不得**用假 delay phase 冒充 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次物理伤害；不代表真实飞行/扇形碰撞几何。

| 排除（非 remainingGap / 非 blocker） | 说明 |
| --- | --- |
| ranks 1–4 | 仅 Rank5 |
| projectile / travel | 无飞行时间 |
| line / fan geometry | 无线段/扇形几何 |
| collision | 无碰撞检测 |
| target selection | 无选敌逻辑扩展 |
| multi-target / repeat | 单主目标单次命中 |
| knock aside / airborne / slow / 其他 CC | 控制效果全部排除 |
| 250ms cast timing | 无 canonical 字段；禁止假 delay phase |
| equipment / loadout | 无装备互操作 |
| live migration / Admin publish / browser E2E / full-game fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki draven-e.json (page1307070/rev4034694)
  → Backend seed（self-contained；provider_hero_draven_e_stand_aside）
    → Web 既有 generic 投影（无本机制 Web 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage operation
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：确保 `hero_draven` 最低 level-1 面板与 mana 资源；仅挂载独立 `provider_hero_draven_e_stand_aside`，与 Q/W/basic providers 共存；一条 active ability、ability cost/cooldown、null-duration impact + on_enter sequence、一笔 physical damage。幂等 revision guard；**无** delete/DDL/auto-publish。owning `5f1f2bb` / 集成 `09dbf07`；focused JUnit 40/40；full Maven 650/650 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build/generic110 PASS；integrated lint/typecheck/Vitest136/build/generic102 PASS；**无**本任务 Web 源码变更 |
| Wasm | exact `d1e6c32`（`generic_draven_stand_aside_test.go`）；真实 CompileGeneric / RunGeneric / ReleaseSession；focused 与 full `go test -count=1 ./...` PASS；bench100 PASS；TinyGo build PASS（1,168,476 bytes）；Node canonical compile/run/release smoke PASS |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW v2 READY | agent `agent-cb876ac5-6868-4d9c-9dc9-a2587b2e23bf`；run `run-5317a2c2-4fbd-488e-b357-f4137248a6fd`；strict `grok-4.5/high/fast=false`；runDelta0/outside0；1565 parseable；无 truncation/mutation |
| Backend owning | `5f1f2bb`；实现 run `run-9548e3da-9ca0-4247-9bcb-ff43e520bc72`（agent `agent-d8e4d7a3-b4bc-425d-9657-fe9abcea486a`；runDelta3/outside0；809 parseable/无 truncation） |
| Backend 集成 | `09dbf07` |
| Wasm exact | `d1e6c32`；实现 run `run-1e720b4b-2d85-4961-bbf1-16b1affea5bb`（agent `agent-ea2ff2ef-232f-4eaf-9de8-719f7500c5f4`；runDelta1/outside0；622 parseable/无 truncation） |
| 审计 commit | `2905b6d` |
| 首轮审计（非独立验收） | `run-0c1cfd87-7133-44f1-8ef1-2d4e7faff30f`：已产出 six allowed-path diff，但在最终 postflight 前被外部终止；**不得**单独作为验收证据 |
| 审计恢复验证 | `run-16a3942e-31c9-426c-be3d-3d5926fc8d40` / agent `agent-b742e16c-6705-4c3f-be7f-a8265f965952`；strict model；auditAvailable=true；runDelta2/outside0；652 parseable/无 truncation；主会话独立核验完整六路径 diff 与全部 checks |
| 最终清单 | G8 242 = migrated52 / partial4 / blocked117 / OOS69；Unified sourceCount12 / total254；completed62 / partial_actionable0 / ready0 / blocked_runtime111 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full62 / partial3 / none189；actionable0 |

## 5. 语义比较与非目标

主会话语义比较：stable ordered keys 不变；G8 与 Unified **仅** Draven E disposition 变化；registry / Batch-G checks PASS。

非目标（再次强调）：ranks1–4、projectile/travel、line/fan geometry、collision、target selection、multi-target/repeat、knock aside/airborne/slow/其他 CC、250ms cast timing（无 canonical 字段）、equipment/loadout、live migration/Admin publish/browser E2E/full-game fidelity。不得误称完整游戏技能保真。
