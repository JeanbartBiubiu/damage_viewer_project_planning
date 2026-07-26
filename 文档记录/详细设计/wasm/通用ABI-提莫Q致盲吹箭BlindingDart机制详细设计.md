TASK_KEY: wasm-generic-teemo-blinding-dart
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 提莫 Q 致盲吹箭（Blinding Dart）机制详细设计

关联验证记录：[通用 ABI 提莫 Q 致盲吹箭 Blinding Dart 机制验证记录](../../测试记录/wasm/通用ABI-提莫Q致盲吹箭BlindingDart机制验证记录-2026-07-22.md)。本任务将精确候选 `hero_skill|hero_teemo|Q|致盲吹箭` 标为 `completed/full/generic_runtime`（G8 `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称致盲保真或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV teemo-q-blinding-dart-phase-a-v1`（DESIGN_REVIEW READY `run-b74658a7-e987-4a8e-809a-3d3feb8313cb`；审查修正已接受：控制排除先例改用 Draven E / Kayle Q，且 exact audit override 必须替换陈旧 governed generic classification/tag/gap）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_teemo\|Q\|致盲吹箭` |
| Wiki | 请求 `Template:Data Teemo/Q`，解析为 `Template:Data Teemo/Blinding Dart`；pageId `1308208`；revision `3948425`；timestamp `2025-08-19T15:37:23Z`；raw bytes `1639`；SHA256 `4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/teemo-q.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry` |
| Rank-5 active | 90 mana；7000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `260 + 0.70*source.attr.ap.resolved` |
| 数值交叉 | AP200 → raw400；目标 MR100 → mitigated200。t0 / t7000 命中；t6999 恰好一次 cooldown skip 且不扣 mana、无伤害；mana334 → final154（两次成功施放各扣 90） |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次魔法伤害；不代表真实吹箭飞行、致盲控制或几何选敌。控制类排除先例对齐 **Draven E / Kayle Q**（**不得**引用 Graves E）。

| 排除（非 remainingGap / 非 blocker） | 说明 |
| --- | --- |
| blind / control 与 2–3s 持续时间 | **不**宣称致盲保真；控制效果全部排除 |
| 0.25s cast | 无 cast-time 合同 |
| projectile / speed2500 / range / geometry / collision / selection | 无飞行、射程几何、碰撞与选敌扩展 |
| ranks 1–4 | 仅 Rank5 |
| on-hit / equipment / Toxic Shot / basic-attack coupling / rotation | 无普攻/装备/毒箭耦合或轮转合同 |
| multi-target | 单主目标单次命中 |
| live migration / Admin publish / browser E2E / full-game fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki teemo-q.json (page1308208/rev3948425)
  → Backend seed（self-contained；provider_hero_teemo_q_blinding_dart）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：确保 `hero_teemo` 最低 baseline（含 AP0 与 mana334）；保留既有 basic / Toxic Shot providers；仅挂载独立 `provider_hero_teemo_q_blinding_dart`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔 magic damage。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `1803c8c` / 集成 `7e27f33`；focused JUnit 34/34；full Maven 659/659 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `6470c5d`（`wasm/tinygo_engine_v2/internal/runtime/generic_teemo_blinding_dart_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test ./... -count=1` PASS；bench100 PASS；TinyGo build PASS（1,168,476 bytes）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | agent `agent-61db099b-b672-4f5d-9d15-d21c37c85cb7`；run `run-b74658a7-e987-4a8e-809a-3d3feb8313cb`；strict `grok-4.5/high/fast=false`；runDelta0/outside0；2171 parseable；无 truncation/mutation |
| Backend owning | `1803c8c`；实现 run `run-3a2fdad1-f014-46c6-8610-8245a05b558f`（agent `agent-64ce9347-50ed-4010-adb0-06c39696aaa1`；runDelta3/outside0；799 parseable/无 truncation） |
| Backend 集成 | `7e27f33` |
| Wasm exact | `6470c5d`；实现 run `run-4582c628-9cae-410a-86a1-bba210886b6e`（agent `agent-b80abd8c-eb93-4a7c-a639-d27b467e040d`；runDelta1/outside0；613 parseable/无 truncation） |
| 审计 commit | `14b793e`；实现 run `run-6180b4c1-152e-400f-b2b8-3d157fe0565a`（agent `agent-bd5725db-d95a-4bdb-91b9-d9e61c55fd77`；runDelta6/outside0；1113 parseable/无 truncation） |
| 最终清单 | G8 242 = migrated53 / partial4 / blocked116 / OOS69；Unified sourceCount12 / total254；completed63 / partial_actionable0 / ready0 / blocked_runtime110 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full63 / partial3 / none188；actionable0；`implementation_gap_no_unresolved_data_fields=92` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`、空 `remainingGap`、无 `dataGapEvidence`。raw upstream `classification` / `mechanismTags` / `auditBaseline` 按既有 G8 schema 保留为历史输入 provenance（与其他 exact migrated override 一致），**不是**最终 disposition。exact audit override **必须**替换陈旧 governed generic classification/tag/gap。

主会话语义比较：ordered keys 不变；全部 241 条非 Teemo G8 行与全部 253 条非 Teemo Unified 行作为解析对象字节等价；**仅** Teemo governed disposition/evidence 变化。Registry / Batch-G checks PASS。

**Web Wasm 资产现状限制（非 Teemo 机制 blocker）**：冻结 Teemo 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Teemo Q 机制未闭环。

非目标（再次强调）：blind/control 与 2–3s 持续时间、0.25s cast、projectile/speed2500/range/geometry/collision/selection、ranks1–4、on-hit/equipment/Toxic Shot/basic-attack coupling/rotation、multi-target、live migration/Admin publish/browser E2E/full-game fidelity。不得误称致盲保真或完整游戏技能保真。
