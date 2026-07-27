TASK_KEY: wasm-generic-ezreal-trueshot-barrage-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-23

# 通用 ABI - 伊泽瑞尔 R 精准弹幕（Trueshot Barrage）主目标命中机制详细设计

关联验证记录：[通用 ABI 伊泽瑞尔 R 精准弹幕 Trueshot Barrage 主目标命中机制验证记录](../../测试记录/wasm/通用ABI-伊泽瑞尔R精准弹幕TrueshotBarrage主目标命中机制验证记录-2026-07-23.md)。本任务将精确候选 `hero_skill|hero_ezreal|R|精准弹幕` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施放延迟/施法队列/弹道飞行/碰撞几何/方向/多目标/视野/小兵或野怪修正伤害，或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV ezreal-r-trueshot-barrage-primary-hit-phase-a-v2`（新鲜 DESIGN_REVIEW_ONLY READY `run-4324de07-a520-422b-a9bb-e0072955b3dc`；strict `grok-4.5`；effort high；fast false；结构化事件 `VERDICT=READY` / `REVIEWED_PLAN_REV=ezreal-r-trueshot-barrage-primary-hit-phase-a-v2`；runDeltaCount 0；1353/1353 JSONL 可解析；无 truncation/mutation。非阻塞笔记已吸收：文档需写明 README/外部既有数据 check-only 前置；live execution chain 仍属外部；**明确不调用 Batch-B**。较早 v1 REVISE 发现已并入 v2；**不得**把失败的初始化尝试当作审查证据）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_ezreal\|R\|精准弹幕` |
| Wiki | 请求 `Template:Data Ezreal/R`，解析为 `Template:Data Ezreal/Trueshot Barrage`；pageId `1307113`；revision `4013235`；timestamp `2026-04-28T21:20:36Z`；canonical raw bytes `1453`；SHA256 `e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw 为非规范 `1450` bytes / SHA256 `ddc984665670fe9aee859ec740d63c101b04c7f504f610952f94fe67a014f943`；修剪其终端 LF 得到 `1449` bytes / SHA256 `57a04bc0b2e42505bd9ec1b324fed4192aecb213ea22dade56f4e77ed553f3ce`；在 local raw 前加 BOM 得到 `1453` bytes / SHA256 `27fbea33e254bd4b139e49ca0bbface059f490d25fa74cd33b19846596a1c639`，**仍不是** canonical。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage` |
| Rank-3 active | 100 mana；90000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `750 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base) + 1.10 * source.attr.ap.resolved` |
| 数值交叉 | base AD60 / resolved AD110 / bonus AD50 / AP200 → raw1020；目标 MR100 → mitigated510。t0 / t89999 / t90000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害；mana300 → final100；目标 HP1500 → final480 |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| seed 执行前置 | Backend seed **故意**将 `hero_ezreal`、AD/AP 定义与实体属性、mana 定义与资源值视为 **外部既有数据 / check-only 前置**；**不**物化或写入身份/共享面板/资源值，**不**调用 Batch-B。这是已文档化的 seed 执行前置，**不是**未解决公式/Wiki 数据缺口，**不得**据此重开已完成的有界机制 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主英雄目标结算单次魔法伤害。Wiki cast time `1`、queue `0.5` 与 `Effect at cast time start` **被显式排除**，而非建模或近似；**不**伪造 cast-delay / queue phase。不代表真实弹道飞行、碰撞几何、方向、多目标、视野，或小兵/非史诗野怪修正伤害保真。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast1 / queue0.5 / Effect at cast time start | 施放延迟、施法队列与 cast-start 时序 **排除而非近似** |
| projectile / travel / collision / global geometry / direction | 无弹道、碰撞、全局几何与方向合同 |
| multitarget / sight / reveal | 多目标与视野排除 |
| minion / non-epic monster modified rank-3 damage `300 + 1.00 bonus AD + 1.10 AP` | 小兵/非史诗野怪修正公式 **排除而非否认/建模** |
| ranks 1–2 | 仅 Rank3 |
| Ezreal P / Q / W / E / basic / on-hit / equipment / loadout | 无其它技能/普攻/装备耦合；保留既有 Rising Spell Force provider，永不更新/删除/重建 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki ezreal-r.json (page1307113/rev4013235；canonical SHA e9d7f9d7…)
  → Backend seed（check-only 外部既有 hero_ezreal/ad/ap/mana；
     provider_hero_ezreal_r_trueshot_barrage_primary_hit；不调用 Batch-B）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation（750+1.00*bonusAD+1.10*AP；runtime magic 20221 / 无 20220）
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql`：对 `game_entities(hero_ezreal)`、`attribute_definitions(ad/ap)`、`entity_attribute_values(hero_ezreal,ad/ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_ezreal,mana)` 仅 **check-only**；**不**物化身份/共享面板/资源值；**不**调用 Batch-B。仅挂载独立 `provider_hero_ezreal_r_trueshot_barrage_primary_hit`；保留既有 Rising Spell Force provider；一条 active ability（100 mana / 90000ms）、null-duration impact + on_enter sequence、一笔魔法 `750+1.00*(ad.resolved-ad.base)+1.10*ap.resolved` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `dea4538` / Wasm 集成 `8c93017`；focused JUnit 9/9；full Maven 741/741 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更（零写入）。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `e13d887`（`wasm/tinygo_engine_v2/internal/runtime/generic_ezreal_trueshot_barrage_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 5/5 与 full `go test -count=1 ./...` PASS；generic bench100 PASS；TinyGo build PASS（1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW_ONLY READY | run `run-4324de07-a520-422b-a9bb-e0072955b3dc`；strict `grok-4.5`；effort high；fast false；结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=ezreal-r-trueshot-barrage-primary-hit-phase-a-v2`；runDeltaCount 0；1353/1353 parseable；无 truncation/mutation；非阻塞笔记（README/外部 check-only、live chain 外部、不调用 Batch-B）已吸收；v1 REVISE 已并入 v2 |
| Backend owning | `dea4538`；实现 run `run-86e431e9-6d40-4f41-85b3-459af643a844`（delta3/outside0；1106/1106 parseable）；focused 9/9；full Maven 741/741 |
| Backend → Wasm 集成 | `8c93017` |
| Wasm exact | `e13d887`；实现 run `run-3d4dafae-987e-4ec2-9284-a4d8b976b522`（delta1/outside0；907/907 parseable）；focused 5/5；full Go / bench100 / TinyGo / Node smoke PASS |
| 审计 commit | `c090aa1`；恢复实现 run `run-89d56506-b5eb-4f04-b26a-434ab5026d99`（finished；strict model；runDelta4/outside0；837/837 parseable；无 truncation）。前序 `run-d696de7b-8cdf-487d-9f0c-351c9c581108` 网络超时，**不是**有效完成证据；主会话最终 HEAD 对比与验证覆盖完整六文件变更 |
| 最终清单 | G8 242 = migrated62 / partial4 / blocked107 / OOS69；Unified sourceCount12 / total254；completed72 / partial_actionable0 / ready0 / blocked_runtime101 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full72 / partial3 / none179；actionable0；`implementation_gap_no_unresolved_data_fields=83` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|ap_ratio|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 242/254 不变；**仅** Ezreal R 解析行语义变化（除生成时间戳外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状限制（非 Ezreal R 机制 blocker）**：冻结 Ezreal R 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Ezreal R 机制未闭环；**不得**在本切片同步资产。

非目标（再次强调）：cast1/queue0.5/`Effect at cast time start`、projectile/travel/collision/global geometry/direction、multitarget/sight、minion/non-epic monster modified `300+1.00 bonus AD+1.10 AP`、ranks1–2、Ezreal P/Q/W/E/basic/on-hit/equipment/loadout、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Trueshot Barrage/游戏技能保真；**未**声称总体 Goal 完成。外部既有数据 check-only 前置与「不调用 Batch-B」是 seed 执行合同，**不是**未解决数据缺口。

## 6. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307113 / rev4013235 / timestamp2026-04-28T21:20:36Z / canonical raw1453 / SHA256 `e9d7f9d7…53580e0`；sidecar/pages canonical；local raw1450 / trim1449 / BOM1453 materialization caveat 非源矛盾、非字节等价主张 |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | Rank3 100 mana / 90000ms；raw1020 / mitigated510；t0/t89999/t90000 两命中 + 一 CD skip；mana300→100；HP1500→480 |
| Backend | owning `dea4538` / 集成 `8c93017`；focused9/9；full741/741；外部既有数据 check-only；不调用 Batch-B |
| Wasm | exact `e13d887`；focused5/5；full Go / bench100 / TinyGo / Node smoke PASS；产物字节/SHA 不变 |
| 审计 | commit `c090aa1`；G8 migrated + 空 remainingGap；Unified completed/full + 空 blocker/gap evidence null；counts 与 §4 最终清单一致；恢复 run 为权威，超时 run 非证据 |
| Web | 无本机制源码写入；资产漂移仅记录 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
