TASK_KEY: wasm-generic-varus-hail-of-arrows-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 韦鲁斯 E 恶灵箭雨（Hail of Arrows）主目标命中机制详细设计

关联验证记录：[通用 ABI 韦鲁斯 E 恶灵箭雨 Hail of Arrows 主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_varus|E|恶灵箭雨` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称落地延迟/几何/多目标/箭雨场/减速/重伤/枯萎引爆或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV varus-e-hail-of-arrows-primary-hit-phase-a-v1`（DESIGN_REVIEW READY `run-49be1bd0-cd86-4a36-a72e-c2d5de455338`；审查结论：bounded completed/full 接受；物理证据在披露后解析孤立 `damagetype=Magic` 字段；Wiki 0.5s landing delay 明确排除；Backend 恰好 8 attrs / 无 AP；与既有 W 独立共存）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_varus\|E\|恶灵箭雨` |
| Wiki | 请求 `Template:Data Varus/E`，解析为 `Template:Data Varus/Hail of Arrows`；pageId `1309978`；revision `3969402`；timestamp `2025-11-24T16:03:58Z`；canonical raw bytes `1750`；SHA256 `7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/varus-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 本地 raw 物化为 `1748` bytes / SHA256 `42ebcd88aef5fc4f1889d4b40b062368902d6d35cfa76e624a1ba3f8789c468f`（换行差异）；**sidecar 拥有 canonical 元数据**，raw 仅作存在/非空证明。**不得**表述为源矛盾 |
| 源字段矛盾（已审查策略） | 同 revision 的 description 与标注 rank 表明确写物理 `60 to 180 (+90% bonus AD)`，而孤立字段 `damagetype=Magic` 与之矛盾。**reviewed policy**：description + labeled rank table 管辖本 bounded 物理分支；runtime 使用 physical；`Magic` **必须披露且永不作为 runtime 真源**。与 raw-byte caveat 不同，这是**真实源字段矛盾** |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation` |
| Rank-5 active | 90 mana；10000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `180 + 0.90*(source.attr.ad.resolved-source.attr.ad.base)` |
| 数值交叉 | baseAD59 / resolvedAD159 → bonusAD100 → raw270；目标 armor100 → mitigated135。t0 / t9999 / t10000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害；mana320 → final140 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次物理伤害。Wiki 0.5s landing delay **被显式排除**，而非建模或近似；**不**伪造 landing-delay phase。不代表真实施放/落地/弹道时序、目标落点几何、多目标箭雨场、减速、重伤或枯萎引爆保真。

| 排除（非 remainingGap / 非 blocker） | 说明 |
| --- | --- |
| cast0.2419 / landing0.5 / travel timing | 无施放/落地/飞行时序合同；0.5s landing **排除而非近似** |
| target-location / projectile / range925 / radius300 / collision / geometry | 无落点、弹道、射程、半径与几何碰撞合同 |
| all-enemies / multi-target / repeat | 单主目标单次命中 |
| four-second field | 四秒箭雨场全部排除 |
| slow30–50% / 0.25s linger | 减速与 linger 全部排除 |
| Grievous Wounds | 重伤全部排除 |
| Blighted Quiver stack consumption / ~0.3s second detonation / W / Q / basic / on-hit coupling | 枯萎叠层消耗、二次引爆与 W/Q/普攻/on-hit 耦合全部排除；与既有 W provider **独立共存** |
| ranks 1–4 | 仅 Rank5 |
| equipment / loadout | 无装备/配装耦合 |
| live migration / Admin publish / browser E2E / full-game fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki varus-e.json (page1309978/rev3969402；canonical SHA 7b4be71b…)
  → Backend seed（self-contained；provider_hero_varus_e_hail_of_arrows_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage operation（180+0.90*(resolvedAD-baseAD)；runtime physical 20220 / 无 20221）
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：baseline hp600 / mana320 / ad59 / AS0.658 / armor24 / MR30 / hpregen0.7 / manaregen1.6；恰好八条属性定义；**无** AP；保留既有 basic / W / Q providers；仅挂载独立 `provider_hero_varus_e_hail_of_arrows_primary_hit`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔物理 `180+0.90*(resolvedAD-baseAD)` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `a08cdfd` / 集成 `e924afd`；focused JUnit 46/46；full Maven 687/687 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `6be94af`（`wasm/tinygo_engine_v2/internal/runtime/generic_varus_hail_of_arrows_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test -count=1 ./...` PASS；bench100 PASS；TinyGo build PASS（1,168,476 bytes）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | agent `agent-462468cd-584a-4257-a6f1-d95deecca933`；run `run-49be1bd0-cd86-4a36-a72e-c2d5de455338`；strict model；runDelta0/outside0；1393 parseable；无 truncation/mutation |
| Backend owning | `a08cdfd`；实现 run `run-faf113ed-5739-4653-ae52-f46e1c260592`（agent `agent-a57e872f-881c-4c6e-af4d-35efcfd32e4e`；runDelta3/outside0；851 parseable/无 truncation） |
| Backend 集成 | `e924afd` |
| Wasm exact | `6be94af`；实现 run `run-139b5b23-1be8-4de4-a845-9ef6fee4ef15`（agent `agent-a9e01df4-a63d-4302-84c2-f3969d0099de`；runDelta1/outside0；657 parseable/无 truncation） |
| 审计 commit | `37217fd`；实现 run `run-c3c9d485-7116-42e4-b8b6-2a88b0794496`（agent `agent-f7d2997f-1db2-4552-bdde-f108439975b7`；runDelta6/outside0；1192 parseable/无 truncation） |
| 最终清单 | G8 242 = migrated56 / partial4 / blocked113 / OOS69；Unified sourceCount12 / total254；completed66 / partial_actionable0 / ready0 / blocked_runtime107 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full66 / partial3 / none185；actionable0；`implementation_gap_no_unresolved_data_fields=89` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`、空 `remainingGap`。raw upstream `classification` / `mechanismTags` / `auditBaseline`（含历史 false `survivability_only` provenance）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 不变；全部 241 条非 Varus E G8 行与全部 253 条非 Varus E Unified 行作为解析对象字节等价；**仅** Varus E governed disposition/evidence 变化。Registry / Batch-G checks PASS。

**Web Wasm 资产现状限制（非 Varus E 机制 blocker）**：冻结 Varus E 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Varus E 机制未闭环。

非目标（再次强调）：cast0.2419/landing0.5/travel timing、target-location/projectile/range925/radius300/collision/geometry、all-enemies/multi-target/repeat、four-second field、slow30–50%/0.25s linger、Grievous Wounds、Blighted Quiver stack consumption/~0.3s second detonation/W/Q/basic/on-hit coupling、ranks1–4、equipment/loadout、live migration/Admin publish/browser E2E/full-game fidelity。不得误称排除行为已实现或完整游戏技能保真；不得将孤立 `damagetype=Magic` 当作 runtime 真源。
