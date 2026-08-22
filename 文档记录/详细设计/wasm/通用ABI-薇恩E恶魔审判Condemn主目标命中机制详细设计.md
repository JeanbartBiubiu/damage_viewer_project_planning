TASK_KEY: wasm-generic-vayne-condemn-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 薇恩 E 恶魔审判（Condemn）主目标命中机制详细设计

关联验证记录：[通用 ABI 薇恩 E 恶魔审判 Condemn 主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_vayne|E|恶魔审判` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称击退/地形/墙体加成/眩晕/弹道或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV vayne-e-condemn-primary-hit-phase-a-v1`（DESIGN_REVIEW READY `run-f03ab9ee-acd4-4a9b-b9ea-85a743822e0e`；审查修正已接受：使用 `single_hit`；说 `wall_bonus`；Backend AP preflight 不必要；清掉 governed generic 陈旧状态，raw upstream provenance 按既有 schema 保留）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_vayne\|E\|恶魔审判` |
| Wiki | 请求 `Template:Data Vayne/E`，解析为 `Template:Data Vayne/Condemn`；pageId `1309990`；revision `4008541`；timestamp `2026-04-14T23:45:40Z`；raw bytes `2380`；SHA256 `f2b2ba17b90ff5096a9a154f8d1fd4cc43ed3e1be4ebb502cb644acf17712c37`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/vayne-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile` |
| Rank-5 active | 90 mana；12000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `190 + 0.50*(source.attr.ad.resolved-source.attr.ad.base)` |
| 数值交叉 | baseAD60 / resolvedAD140 → bonusAD80 → raw230；目标 armor100 → mitigated115。t0 / t11999 / t12000：t0/t12000 命中；t11999 恰好一次 cooldown skip 且不扣 mana、无伤害；mana232 → final52 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次物理伤害；不代表真实击退、地形碰撞、墙体加成、眩晕控制或弹道几何。

| 排除（非 remainingGap / 非 blocker） | 说明 |
| --- | --- |
| knockback / displacement475 / direction | **不**宣称击退或位移保真 |
| terrain / player-generated terrain collision | 无地形碰撞合同 |
| wall bonus `285+0.75bAD` 与 total `475+1.25bAD` | 墙体加成全部排除；措辞用 `wall_bonus` |
| stun / control 1.5s | 控制效果全部排除 |
| cast0.25 / effect-at-cast-end | 无 cast-time 合同 |
| projectile / missile speeds2200/2000 / range550 / geometry / cancel | 无飞行、射程几何、取消扩展 |
| ranks 1–4 | 仅 Rank5 |
| Silver Bolts / basic / on-hit / equipment / loadout coupling | 无普攻/圣银弩箭/装备耦合 |
| multi-target / repeat | 单主目标单次命中（`single_hit`） |
| live migration / Admin publish / browser E2E / full-game fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki vayne-e.json (page1309990/rev4008541)
  → Backend seed（self-contained；provider_hero_vayne_e_condemn_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage operation（190+0.50*(resolvedAD-baseAD)）
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：确保 `hero_vayne` 最低 baseline 与 mana232；保留既有 basic / Silver Bolts / Tumble providers；仅挂载独立 `provider_hero_vayne_e_condemn_primary_hit`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔物理 `190+0.50*(resolvedAD-baseAD)` operation。恰好八条必需属性定义；**不**要求 AP。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `e7d28f6` / 集成 `61290cb`；focused JUnit 36/36；full Maven 668/668 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `252f799`（`wasm/tinygo_engine_v2/internal/runtime/generic_vayne_condemn_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test -count=1 ./...` PASS；bench100 PASS；TinyGo build PASS（1,168,476 bytes）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | agent `agent-672db211-9a8d-4079-8e1c-4db1480d5382`；run `run-f03ab9ee-acd4-4a9b-b9ea-85a743822e0e`；strict `grok-4.5/high/fast=false`；runDelta0/outside0；1957 parseable；无 truncation/mutation |
| Backend owning | `e7d28f6`；实现 run `run-26f83a4e-e820-41ea-a359-ab3d785a2908`（agent `agent-f9b52c07-c97b-4cc0-b4a6-2beee7428648`；runDelta3/outside0；850 parseable/无 truncation） |
| Backend 集成 | `61290cb` |
| Wasm exact | `252f799`；实现 run `run-0900ab3c-c49b-45e1-acef-5b31756cae4b`（agent `agent-a9389397-5121-4040-9db8-a0c19dcb390f`；runDelta1/outside0；903 parseable/无 truncation） |
| 审计 commit | `881cb1c`；实现 run `run-ccd0f5f0-8428-4da8-b1ac-1bed98da5153`（agent `agent-dbc56bfe-a1ca-4a0d-bba6-5fd5819b21a8`；runDelta6/outside0；840 parseable/无 truncation） |
| 最终清单 | G8 242 = migrated54 / partial4 / blocked115 / OOS69；Unified sourceCount12 / total254；completed64 / partial_actionable0 / ready0 / blocked_runtime109 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full64 / partial3 / none187；actionable0；`implementation_gap_no_unresolved_data_fields=91` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`、空 `remainingGap`。raw upstream `classification` / `mechanismTags` / `auditBaseline` 按既有 G8 schema 保留为历史输入 provenance（与其他 exact migrated override 一致），**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 不变；全部 241 条非 Vayne G8 行与全部 253 条非 Vayne Unified 行作为解析对象字节等价；**仅** Vayne E governed disposition/evidence 变化。Registry / Batch-G checks PASS。

**Web Wasm 资产现状限制（非 Vayne E 机制 blocker）**：冻结 Vayne E 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Vayne E 机制未闭环。

非目标（再次强调）：knockback/displacement475/direction、terrain/player-generated terrain collision、wall bonus `285+0.75bAD` 与 total `475+1.25bAD`、stun/control1.5s、cast0.25/effect-at-cast-end、projectile/missile speeds2200/2000/range550/geometry/cancel、ranks1–4、Silver Bolts/basic/on-hit/equipment/loadout coupling、multi-target/repeat、live migration/Admin publish/browser E2E/full-game fidelity。不得误称排除行为已实现或完整游戏技能保真。
