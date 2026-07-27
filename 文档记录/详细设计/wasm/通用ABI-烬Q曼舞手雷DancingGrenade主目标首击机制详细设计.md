TASK_KEY: wasm-generic-jhin-dancing-grenade-primary-first-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 烬 Q 曼舞手雷（Dancing Grenade）主目标首击机制详细设计

关联验证记录：[通用 ABI 烬 Q 曼舞手雷 Dancing Grenade 主目标首击机制验证记录](../../测试记录/wasm/通用ABI-烬Q曼舞手雷DancingGrenade主目标首击机制验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_jhin|Q|曼舞手雷` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 cast time / unit-targeted cancel conditions、projectile travel / first-target acquisition、bounce to up to three additional targets / nearest-unhit priority、target-death +35% later-bounce amplification / maximum final bounce、spellshield bounce-persistence、other ranks/siblings/loadout/bootstrap/crit/on-hit、live migration/publish/E2E，或完整 Dancing Grenade/游戏保真；本闭环**恰好是一次选定主目标首雷单次物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV jhin-q-dancing-grenade-primary-first-hit-phase-a-v1`（有效 DESIGN_READY `run-a8330b2c-ee29-46b5-9cd1-98edcb39b7c0`；strict model；runDelta0/diff0；1888/1888 parseable events；35/35 complete tool groups；无 truncation / mutation）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_jhin\|Q\|曼舞手雷` |
| Wiki | 请求 `Template:Data Jhin/Q`，解析为 `Template:Data Jhin/Dancing Grenade`；pageId `1307579`；revision `4007611`；timestamp `2026-04-12T07:23:12Z`；canonical raw bytes `1913`；SHA256 `522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/jhin-q.json` bytes `2388` / SHA256 `6f5c6dcc9771140136705f8e6554cb999f7ec5a1272515d5cbd03b910bdd20b1` plus pages sibling bytes `682` / SHA256 `642d7c88a064cd3107a4cf9f51a75be2ca91bb2e904afd6cfa8cf3ead92b7897` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `1911` bytes，SHA256 `17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`ap_ratio`、`immediate_impact_scaffold`（**无** `total_ad_ratio`；**无** completed salvage tag） |
| Rank-5 active | 60 mana；5000ms cooldown；immediate selected-primary-champion first-grenade single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理命中 `144 + 0.74 * source.attr.ad.resolved + 0.60 * source.attr.ap.resolved`（**精确嵌套二元树** `add(add(const 144, mul(const 0.74, read source.attr.ad.resolved)), mul(const 0.60, read source.attr.ap.resolved))`；**total AD 直接读取**；不得减 `ad.base`，亦不得称为 bonus AD；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动合成恰好一次 `ability_started`；**零** Q state / modifier / listener / matcher / repeat / control / projectile / bounce；**无** Q-specific type |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定主目标首雷单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模 cast/cancel/projectile/acquisition/bounce/nearest-unhit/death-amp/max-bounce/spellshield，或完整 Q 保真 |
| Standalone | Jhin Q provider **独立**；**显式 Q/W isolation**（preserve existing W；不要求/突变/合成/复制 W；Q seed **不含** W rows；仅测试侧可组合独立图）；**不**合成 P/E/R/basic；**不**合成 Batch-B 或 sibling Jhin 机制 |
| Backend 前置 | 仓库**无** repository-owned `hero_jhin` / AD / AP / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | AD0/AP0/armor0 → raw/final144；AD100/AP0/armor0 → raw/final218；AD0/AP100/armor0 → raw/final204；AD100/AP100/armor0 → raw/final278；AD100/AP100/armor100 → raw278/final139；AD200/AP100/armor100 → raw352/final176；baseAD0 与 baseAD60 在 resolvedAD100/AP0/armor0 下均 raw/final218（total-AD 直读反证） |
| 日程交叉 | mana180 / baseAD60 / resolvedAD100 / AP100 / HP1000 / armor100：t0 / t4999 / t5000 → success / skip / success；恰好两笔 Q damage；final mana60 / HP722；两次自动 Q `ability_started`；mana59 → resource skip / mana/HP 不变 / 无 Q damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界首雷单次物理命中；不代表完整 Dancing Grenade 弹道、弹射、最近未命中优先、死亡增伤、最大末段弹射或完整 Q。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| cast time / unit-targeted cancel conditions | 施法时间与单位指向取消条件全部排除 |
| projectile travel / first-target acquisition | 弹道飞行与首目标获取全部排除 |
| bounce to up to three additional targets / nearest-unhit priority | 最多三段额外弹射与最近未命中优先全部排除 |
| target-death +35% later-bounce amplification / maximum final bounce | 目标死亡后续弹射 +35% 增伤与最大末段弹射全部排除 |
| spellshield bounce-persistence | 法术护盾弹射存续全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other Jhin abilities / passives / siblings / loadout / bootstrap | 无 P/E/R/basic 耦合；不合成 sibling；显式 Q/W isolation；无负荷/bootstrap |
| equipment / crit / on-hit | 无装备/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full Dancing Grenade / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标首雷物理命中**，不是完整 Q |

## 3. 端到端数据流

```text
Wiki jhin-q.json (page1307579/rev4007611；canonical SHA 522c4b91…)
  → Backend seed（lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql；
     provider_hero_jhin_q_dancing_grenade_primary_first_hit；
     一笔物理命中 144+0.74*ad.resolved+0.60*ap.resolved；精确嵌套二元；type 20220 / add 20170；
     无 20230；无显式 event；无 Q-specific type；
     hero_jhin/ad/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成；显式 Q/W isolation）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical first-grenade damage（精确嵌套二元 144+0.74*ad.resolved+0.60*ap.resolved；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql`（SHA256 `414da9285d861111cd7f0753768d4082366f7515ef3f67cc81cd5ec0c373db11`）+ `LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest`（SHA256 `b2c7a800aad33db993f2e07958e537e26bc5f09d6848d70a2ff21cc6ee7f38ca`）；README `server/data_manage/README.md` SHA256 `96dfddaa841eeddc5af48c049aae797b190177ad7b0d4a8ae5287f1191d38fc6`：独立 `provider_hero_jhin_q_dancing_grenade_primary_first_hit`；60 mana / 5000ms CD；immediate selected-primary-champion first-grenade single physical hit scaffold；一笔精确嵌套二元物理；`hero_jhin`/ad/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成；显式 Q/W isolation）。owning `ce2259465897a07fd68531f8e0994b2dc481bdf0`（`run-72245e2f-6b1f-4bec-84a8-684b81ba8bfd`；runDelta3/outside0；主 focused61 / full965 PASS）。镜像 `488898e9848d6952796733f454ae7c6f75a5fa65`（`run-299aaaa4-8cae-4473-b035-5e70701f9e87`；runDelta3/outside0；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `f70be27662ef57c9e154d2067e7a0678739c746e`（`generic_jhin_dancing_grenade_primary_first_hit_test.go`；最终 test bytes `71563` / SHA256 `deaa660439d9a5ac8132eb79ad0c16b11c67acf4d5ae03d48110baed99679cc4`）；实现 run `run-02c77f33-d0dd-4ea8-830d-bbef38f3e25f`（runDelta1/outside0）+ 机械 gofmt 修正 `run-ae92e35e-1531-4659-8e57-4c9a2bfce106`（runDelta1/outside0；**仅**格式；语义/断言不变；诚实记录为 formatting correction，**不是**合同失败）。主验证：focused / full / bench / build / smoke / benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana180；baseAD60；resolvedAD100；AP100；armor100） | 扣 60 mana；一笔物理命中（raw278→final139）；CD 武装；一次 `ability_started` |
| t4999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t5000 再次成功 | 第二次物理命中；两笔 Q damage；final mana60；HP1000→722；两次 `ability_started` |
| mana59 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 AD0/AP0/armor0 | raw144；final144 |
| 交叉 AD100/AP0/armor0 | raw218；final218 |
| 交叉 AD0/AP100/armor0 | raw204；final204 |
| 交叉 AD100/AP100/armor0 | raw278；final278 |
| 交叉 AD100/AP100/armor100 | raw278；final139 |
| 交叉 AD200/AP100/armor100 | raw352；final176 |
| total-AD 直读反证 | baseAD0 与 baseAD60 在 resolvedAD100/AP0/armor0 下均 raw/final218 |
| Standalone / Q/W isolation | 不合成 P/E/R/basic；preserve existing W；Q seed 无 W rows |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Jhin；禁止引入 `total_ad_ratio`/salvage tag 或 Q-specific type；禁止把本首雷命中误称为完整 Q |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-a8330b2c-ee29-46b5-9cd1-98edcb39b7c0`；READY；strict model；runDelta0/diff0；1888/1888 parseable events / 35/35 complete tool groups；无 truncation/mutation |
| Backend owning | owning `ce2259465897a07fd68531f8e0994b2dc481bdf0`；`run-72245e2f-6b1f-4bec-84a8-684b81ba8bfd`（runDelta3/outside0）；主 focused61 / full965 PASS；seed SHA `414da928…73db11`；JUnit SHA `b2c7a800…7f38ca`；README SHA `96dfddaa…d38fc6` |
| Backend 镜像（Wasm worktree） | `488898e9848d6952796733f454ae7c6f75a5fa65`；`run-299aaaa4-8cae-4473-b035-5e70701f9e87`（runDelta3/outside0；精确 parity） |
| Wasm exact | `f70be27662ef57c9e154d2067e7a0678739c746e`；实现 `run-02c77f33-d0dd-4ea8-830d-bbef38f3e25f`（runDelta1/outside0）+ 机械 gofmt `run-ae92e35e-1531-4659-8e57-4c9a2bfce106`（runDelta1/outside0；formatting correction only）；focused/full/bench/build/smoke/benchmark PASS；最终 test bytes71563 / SHA `deaa6604…99679cc4`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `10a32116d30ab584562acdaeb61d8a2738f34348`；审计 run `run-2dd9…`（strict model；runDelta8/outside0）。主五检查通过；语义比较证明**仅** Jhin Q G8/Unified 记录变化，且 provisional **仅**移除 Jhin Q |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated86 / partial4 / blocked83 / OOS69；inScope173；Unified sourceCount12 / total254；completed96 / partial_actionable0 / ready0 / blocked_runtime77 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full96 / partial3 / none155；implementation gap60；actionable0；provisional80（runtime77/data3；hero78/item2）。治理 tasks 必须为 110。报告口径：严格 verified completion **96/254=37.8%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 80 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段（含历史 `classification=out_of_scope_for_single_target_dps` / `mechanismTags=multi_target_or_area` / `auditBaseline.gapCode=blocked_data`）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Jhin Q 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Jhin Q（81→80）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast time/unit-targeted cancel conditions、projectile travel/first-target acquisition、bounce to up to three additional targets/nearest-unhit priority、target-death +35% later-bounce amplification/maximum final bounce、spellshield bounce-persistence、ranks1-4、other Jhin abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live migration/Admin publish/browser E2E/full Dancing Grenade/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Dancing Grenade/游戏技能保真；本闭环**恰好是一次选定主目标首雷物理命中**，**不是**完整 Q；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Jhin Q 为 standalone；Backend 无 repository-owned `hero_jhin`/AD/AP/mana materializer——仅 external-existing-data/check-only；伤害为 **total AD 直接读取 + AP**（精确嵌套二元）；**禁止** `total_ad_ratio`/salvage tag；类型 **20220** / add **20170**；无 20230；无 Q-specific type。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307579 / rev4007611 / timestamp2026-04-12T07:23:12Z / canonical raw1913 / SHA256 `522c4b91…1685f1`；normalized2388 / SHA `6f5c6dcc…dd20b1`；pages682 / SHA `642d7c88…2b7897`；sidecar/pages canonical；local raw1911 / SHA `17deceae…6dd0cb` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_jhin\|Q\|曼舞手雷` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标首雷物理命中 |
| 公式 / fixtures | 精确嵌套二元 `144+0.74*ad.resolved+0.60*ap.resolved`；type 20220 / add 20170；无 20230；无显式 event op；无 Q-specific type；数值与 CD/resource 日程；自动 `ability_started`；零 Q state/modifier/listener；standalone；四 tags 序（无 `total_ad_ratio`/salvage）；含 total-AD 直读反证 |
| Backend | owning `ce22594…` / 镜像 `488898e…`；focused61 + full965；无 live seed |
| Wasm | exact `f70be27…`；focused/full/bench/build/smoke/benchmark；gofmt formatting correction 已诚实记录；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `10a3211…`；接受 run `run-2dd9…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Jhin Q 语义对象变化；provisional 仅移除 Jhin Q；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY `run-a8330b2c…`；runDelta0/diff0；1888 events / 35/35 complete tool groups；无 truncation/mutation |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
