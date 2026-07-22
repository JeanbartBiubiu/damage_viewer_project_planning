TASK_KEY: wasm-generic-kogmaw-void-ooze-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 克格莫 E 虚空淤泥（Void Ooze）主目标命中机制详细设计

关联验证记录：[通用 ABI 克格莫 E 虚空淤泥 Void Ooze 主目标命中机制验证记录](../../测试记录/wasm/通用ABI-克格莫E虚空淤泥VoidOoze主目标命中机制验证记录-2026-07-22.md)。本任务将精确候选 `hero_skill|hero_kogmaw|E|虚空淤泥` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称弹道/几何/多目标/淤泥场/减速或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV kogmaw-e-void-ooze-primary-hit-phase-a-v1`（DESIGN_REVIEW READY `run-9c0645bd-292c-4b86-8785-484e6acbee65`；审查结论：boundary 允许；immediate 措辞正确；raw newline caveat；Backend 恰好 9 attrs 含 AP0）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_kogmaw\|E\|虚空淤泥` |
| Wiki | 请求 `Template:Data Kog'Maw/E`，解析为 `Template:Data Kog'Maw/Void Ooze`；pageId `1307961`；revision `3965135`；timestamp `2025-11-11T17:05:55Z`；canonical raw bytes `1356`；SHA256 `1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 本地 raw 物化为 `1357` bytes / SHA256 `6744b3918c195c8beeb0f8cacb0a51a6cece1e4c140e14caf325536ae4940f72`（末尾换行）；**sidecar 拥有 canonical 元数据**，raw 仅作存在/非空证明。**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration` |
| Rank-5 active | 100 mana；12000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `230 + 0.65*source.attr.ap.resolved` |
| 数值交叉 | AP100 → raw295；目标 MR100 → mitigated147.5。t0 / t11999 / t12000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害；mana325 → final125 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次魔法伤害。Wiki `Effect at cast time start` 与 immediate scaffold **兼容**；**不**伪造 cast-delay phase。不代表真实弹道飞行、路径几何、多目标溅射、淤泥场、减速 tick 或持续时间保真。

| 排除（非 remainingGap / 非 blocker） | 说明 |
| --- | --- |
| projectile / travel / path / range / width / speed / geometry / collision | 无飞行、路径与几何碰撞合同 |
| all-enemies / multi-target / repeat | 单主目标单次命中 |
| field / path blobs / every125 / 3s | 淤泥场与路径落点全部排除 |
| slow60% / 0.25s ticks / linger | 减速与持续 tick 全部排除 |
| cast timing beyond scaffold | 无超出 scaffold 的施放时序合同 |
| ranks 1–4 | 仅 Rank5 |
| basic / W / Q / on-hit / equipment / loadout | 无普攻/其他技能/装备耦合 |
| live migration / Admin publish / browser E2E / full-game fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki kogmaw-e.json (page1307961/rev3965135；canonical SHA 1dd448ea…)
  → Backend seed（self-contained；provider_hero_kogmaw_e_void_ooze_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation（230+0.65*AP）
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：baseline hp635 / mana325 / ad61 / ap0 / AS0.665 / armor24 / MR30 / hpregen0.75 / manaregen1.75；恰好九条属性定义（含 AP）；保留既有 basic / W / Q providers；仅挂载独立 `provider_hero_kogmaw_e_void_ooze_primary_hit`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔魔法 `230+0.65*AP` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `b1752e4` / 集成 `24c1ddf`；focused JUnit 35/35；full Maven 677/677 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `3507920`（`wasm/tinygo_engine_v2/internal/runtime/generic_kogmaw_void_ooze_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test -count=1 ./...` PASS；bench100 PASS；TinyGo build PASS（1,168,476 bytes）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | agent `agent-86a6e50c-0ce5-4a01-949d-fb25004b414d`；run `run-9c0645bd-292c-4b86-8785-484e6acbee65`；strict model；runDelta0/outside0；1774 parseable；无 truncation/mutation |
| Backend owning | `b1752e4`；实现 run `run-88458c7b-af22-41d3-9a2f-6744b7a17098`（agent `agent-ec93f745-fd14-462a-b367-f4f15be2951d`；runDelta3/outside0；754 parseable/无 truncation） |
| Backend 集成 | `24c1ddf` |
| Wasm exact | `3507920`；实现 run `run-6490f99c-d313-4221-9273-e52c6454a12b`（agent `agent-ac212ee7-dc43-48e3-9476-ceeda8c424fa`；runDelta1/outside0；556 parseable/无 truncation） |
| 审计 commit | `c673e4d`；实现 run `run-ec5f66dd-dff1-4dd5-9f05-bbb7b2dbe796`（agent `agent-dc8eb8ab-cc38-482d-810b-47e1cf2234a3`；runDelta6/outside0；1095 parseable/无 truncation） |
| 最终清单 | G8 242 = migrated55 / partial4 / blocked114 / OOS69；Unified sourceCount12 / total254；completed65 / partial_actionable0 / ready0 / blocked_runtime108 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full65 / partial3 / none186；actionable0；`implementation_gap_no_unresolved_data_fields=90` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（`ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream `classification` / `mechanismTags` / `auditBaseline`（含历史 multi_target provenance）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 不变；全部 241 条非 Kog'Maw E G8 行与全部 253 条非 Kog'Maw E Unified 行作为解析对象字节等价；**仅** Kog'Maw E governed disposition/evidence 变化。Registry / Batch-G checks PASS。

**Web Wasm 资产现状限制（非 Kog'Maw E 机制 blocker）**：冻结 Kog'Maw E 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Kog'Maw E 机制未闭环。

非目标（再次强调）：projectile/travel/path/range/width/speed/geometry/collision、all-enemies/multi-target/repeat、field/path blobs/every125/3s、slow60%/0.25s ticks/linger、cast timing beyond scaffold、ranks1–4、basic/W/Q/on-hit/equipment/loadout、live migration/Admin publish/browser E2E/full-game fidelity。不得误称排除行为已实现或完整游戏技能保真。
