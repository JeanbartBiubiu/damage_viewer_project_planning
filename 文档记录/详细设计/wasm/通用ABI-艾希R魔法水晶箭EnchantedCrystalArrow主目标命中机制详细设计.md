TASK_KEY: wasm-generic-ashe-enchanted-crystal-arrow-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-23

# 通用 ABI - 艾希 R 魔法水晶箭（Enchanted Crystal Arrow）主目标命中机制详细设计

关联验证记录：[通用 ABI 艾希 R 魔法水晶箭 Enchanted Crystal Arrow 主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_ashe|R|魔法水晶箭` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施放延迟/弹道飞行/碰撞几何/距离眩晕/周围 AOE/Frost/视野或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1`（新鲜 DESIGN_REVIEW_ONLY READY `run-6bd37601-dadd-4892-8bc8-c025bd88bdbf`；strict `grok-4.5`；effort high；fast false；结构化事件 `VERDICT=READY` / `REVIEWED_PLAN_REV=ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1`；runDeltaCount 0；653/653 JSONL 可解析；无 truncation/mutation。runner 最终散文省略 verdict，以完整结构化 `createPlan` 事件为权威 verdict 证据。两条非阻塞笔记已吸收：显式点名 cast0.25/`Effect at cast time start` 排除；清掉 governed 历史 `blocked_data` gap 同时保留 raw provenance）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_ashe\|R\|魔法水晶箭` |
| Wiki | 请求 `Template:Data Ashe/R`，解析为 `Template:Data Ashe/Enchanted Crystal Arrow`；pageId `1306811`；revision `4026934`；timestamp `2026-06-10T19:09:50Z`；canonical raw bytes `2394`；SHA256 `1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/ashe-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw 为非规范 `2393` bytes / SHA256 `2bce161be04aa2cbe770a7402651929cfb3a7781d7a7ca828b93d1de68d4bb28`；修剪其终端 LF 得到 `2392` bytes 与第三哈希，**不是** canonical 物化。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight` |
| Rank-3 active | 100 mana；60000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `600 + 1.20 * source.attr.ap.resolved` |
| 数值交叉 | resolved AP200 → raw840；目标 MR100 → mitigated420。t0 / t59999 / t60000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害；mana280 → final80；目标 HP1000 → final160 |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold` |
| 历史 provenance | 旧 G8 raw `classification=out_of_scope_for_single_target_dps` / `mechanismTags=multi_target_or_area` / `auditBaseline.gapCode=blocked_data` 为 **历史 provenance**，**不是**最终 disposition。exact audit override **必须**清掉 governed 历史 `blocked_data` gap，同时保留 raw provenance |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次魔法伤害。Wiki cast time `0.25` 与 `Effect at cast time start` **被显式排除**，而非建模或近似；**不**伪造 cast-delay phase。不代表真实弹道飞行、碰撞几何、距离缩放眩晕、周围同伤 AOE/Frost 或视野保真。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast0.25 / Effect at cast time start | 施放延迟与 cast-start 时序 **排除而非近似** |
| projectile / travel / collision / range / speed / geometry | 无弹道、碰撞与几何合同 |
| distance-scaled stun / crowd-control | 距离缩放眩晕排除 |
| surrounding same-damage AOE / Frost Shot | 周围同伤 AOE 与 Frost 排除 |
| sight / reveal | 视野与揭示排除 |
| ranks 1–2 | 仅 Rank3 |
| Ashe P / Q / W / basic / on-hit / equipment / loadout | 无其它技能/普攻/装备耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki ashe-r.json (page1306811/rev4026934；canonical SHA 1d9ccefa…)
  → Backend seed（self-contained；provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation（600+1.20*AP；runtime magic 20221 / 无 20220）
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：baseline hp610 / mana280 / ad59 / ap0 / AS0.658 / armor26 / MR30 / hpregen3.5 / manaregen7；恰好九条属性定义（含 AP；seed 基线 AP=0，AP200 仅属测试夹具）；保留既有 Rangers Focus（Q）/ Volley（W）providers；仅挂载独立 `provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔魔法 `600+1.20*source.attr.ap.resolved` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `5d4a13f` / Wasm 集成 `2f820e4`；focused JUnit 39/39；full Maven 732/732 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更（零写入）。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `bb3dd81`（`wasm/tinygo_engine_v2/internal/runtime/generic_ashe_enchanted_crystal_arrow_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test -count=1 ./...` PASS；generic bench100 PASS；TinyGo build PASS（1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW_ONLY READY | run `run-6bd37601-dadd-4892-8bc8-c025bd88bdbf`；strict `grok-4.5`；effort high；fast false；结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1`；runDeltaCount 0；653/653 parseable；无 truncation/mutation；权威 verdict = 完整 `createPlan` 事件（非 runner 最终散文） |
| Backend owning | `5d4a13f`；实现 run `run-4403ee34-dbcf-4a78-8973-97591b0679b5`（delta3/outside0）；focused 39/39；full Maven 732/732 |
| Backend → Wasm 集成 | `2f820e4` |
| Wasm exact | `bb3dd81`；实现 run `run-1e007813-e5b5-4dd2-9352-548240b02737`（delta1/outside0）；focused 4/4；full Go / bench100 / TinyGo / Node smoke PASS |
| 审计 commit | `7c73c74`；实现 run `run-f5c2483f-e851-485a-8063-383417143cfb`（finished；strict model；runDelta6/outside0；1182/1182 parseable；无 truncation） |
| 最终清单 | G8 242 = migrated61 / partial4 / blocked108 / OOS69；Unified sourceCount12 / total254；completed71 / partial_actionable0 / ready0 / blocked_runtime102 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full71 / partial3 / none180；actionable0；`implementation_gap_no_unresolved_data_fields=84` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段（含历史 `out_of_scope_for_single_target_dps` / `multi_target_or_area` / `blocked_data` provenance）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态与历史 `blocked_data` gap。

主会话语义比较：ordered keys 242/254 不变；**仅** Ashe R 解析行语义变化（除生成时间戳外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状限制（非 Ashe R 机制 blocker）**：冻结 Ashe R 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Ashe R 机制未闭环；**不得**在本切片同步资产。

非目标（再次强调）：cast0.25/`Effect at cast time start`、projectile/travel/collision/range/speed/geometry、distance-scaled stun、surrounding same-damage AOE/Frost、sight、ranks1–2、Ashe P/Q/W/basic/on-hit/equipment/loadout、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Enchanted Crystal Arrow/游戏技能保真；**未**声称总体 Goal 完成。

## 6. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1306811 / rev4026934 / timestamp2026-06-10T19:09:50Z / canonical raw2394 / SHA256 `1d9ccefa…450664f`；sidecar/pages canonical；local raw2393 materialization caveat 非源矛盾、非字节等价主张 |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | Rank3 100 mana / 60000ms；raw840 / mitigated420；t0/t59999/t60000 两命中 + 一 CD skip；mana280→80；HP1000→160 |
| Backend | owning `5d4a13f` / 集成 `2f820e4`；focused39/39；full732/732 |
| Wasm | exact `bb3dd81`；focused4/4；full Go / bench100 / TinyGo / Node smoke PASS；产物字节/SHA 不变 |
| 审计 | commit `7c73c74`；G8 migrated + 空 remainingGap；Unified completed/full + 空 blocker/gap evidence null；counts 与 §4 最终清单一致 |
| Web | 无本机制源码写入；资产漂移仅记录 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
