TASK_KEY: wasm-generic-senna-dawning-shadow-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 赛娜 R 暗影燎原（Dawning Shadow）主目标命中机制详细设计

关联验证记录：[通用 ABI 赛娜 R 暗影燎原 Dawning Shadow 主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_senna|R|暗影燎原` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 cast time 1s / effect-at-cast-time-start / queue time 0.5s、global targeting / direction / broad or narrow wave geometry / width、projectile / travel / speed / destruction、AOE / multitarget、enemy reveal / self reveal、allied or self shield、Mist scaling / Mist Wraith hits / path sight、spellshield、ranks 1–2、other Senna abilities/passives/siblings/loadout/bootstrap/crit/on-hit、live migration/publish/E2E，或完整 Dawning Shadow/游戏保真；本闭环**恰好是一次选定主目标敌方英雄单次物理命中**，**不是**完整 R；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV senna-r-dawning-shadow-primary-hit-phase-a-v3`（有效 DESIGN_READY `run-d6961d41-4530-4298-be06-3b38a88da864`；strict top-level model；runDelta0；1175/1175 parseable events；59/59 complete tool groups；无 truncation / mutation。先前 v1/v2 虽技术上返回 READY，但各因一个非终态 tool group **无效**为正式设计门控，**不得**引为有效门控）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_senna\|R\|暗影燎原` |
| Wiki | 请求 `Template:Data Senna/R`，解析为 `Template:Data Senna/Dawning Shadow`；pageId `1409580`；revision `4008033`；timestamp `2026-04-13T04:08:13Z`；canonical raw bytes `2356`；SHA256 `4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/senna-r.json` bytes `2597` / SHA256 `79ced482a8489f211cacba8cedd4fe0f02a87f0360c5bf95d824c1d735f66307` plus pages sibling bytes `689` / SHA256 `9b7fcb0a8e28dbbe38b6e890966421a6857772c2029315225e59bd041f9e704e` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2353` bytes，SHA256 `1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（**无** completed salvage tag） |
| Rank-3 active | 100 mana；100000ms cooldown；immediate selected-primary enemy champion single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理命中 `550 + 1.15 * (source.attr.ad.resolved - source.attr.ad.base) + 0.70 * source.attr.ap.resolved`（**精确嵌套二元树** `add(add(const 550, mul(const 1.15, sub(read source.attr.ad.resolved, read source.attr.ad.base))), mul(const 0.70, read source.attr.ap.resolved))`；**bonus AD 必须由显式减法**；不得按 total-AD 直读，亦不得省略 base 相减；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动合成恰好一次 `ability_started`；**零** R state / modifier / listener / matcher / repeat / control / projectile / wave；**无** R-specific type |
| Phase-A 语义框定 | 将 Rank-3 leveling 数值的一次所选施加应用到所选主敌方英雄，作为**有界选定主目标敌方英雄单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模 cast/effect-at-cast-time-start/queue/global/direction/wave/geometry/projectile/travel/AOE/reveal/shield/Mist/spellshield，或完整 R 保真 |
| Standalone | Senna R provider **独立**；**保留**既有 Senna W；**显式证明** R/W isolation；**不**合成 P/Q/E/basic/loadout/bootstrap 或 siblings |
| Backend 前置 | 仓库**无** repository-owned `hero_senna` / AD / AP / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | base60/resolved60/AP0/armor0 → raw/final550；base60/resolved160/AP0/armor0 → raw/final665；base60/resolved60/AP100/armor0 → raw/final620；base60/resolved160/AP100/armor0 → raw/final735；base60/resolved140/AP100/armor100 → raw712/final356；base60/resolved220/AP100/armor100 → raw804/final402；base0/resolved100 与 base60/resolved160 在 AP0/armor0 下均 raw/final665（bonus-AD 减法反证） |
| 日程交叉 | mana300 / baseAD60 / resolvedAD140 / AP100 / armor100 / HP1000：t0 / t99999 / t100000 → success / skip / success；恰好两笔 R damage；final mana100 / HP288；两次自动 R `ability_started`；mana99 → resource skip / mana/HP 不变 / 无 R damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对所选主敌方英雄结算一次有界单次物理命中；不代表完整 Dawning Shadow 施法、弹道、波束几何、AOE、揭示、护盾、Mist 或完整 R。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| cast time 1s / effect-at-cast-time-start / queue time 0.5s | 施法时间、施法开始生效与排队时间全部排除 |
| global targeting / direction / broad or narrow wave / width | 全局指向、方向、宽/窄波束几何与宽度全部排除 |
| projectile / travel / speed / destruction | 弹道、飞行、速度与销毁全部排除 |
| AOE / multitarget | 范围与多目标全部排除 |
| enemy reveal / self reveal / allied or self shield | 敌方/自身揭示与友方或自身护盾全部排除 |
| Mist scaling / Mist Wraith hits / path sight | Mist 缩放、怨灵命中与路径视野全部排除 |
| spellshield | 法术护盾排除 |
| ranks 1–2 | 仅 Rank3 |
| other Senna abilities / passives / siblings / loadout / bootstrap | 无 P/Q/E/basic 合成；保留既有 W 并证明 isolation；无负荷/bootstrap |
| equipment / crit / on-hit | 无装备/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full Dawning Shadow / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标敌方英雄物理命中**，不是完整 R |

## 3. 端到端数据流

```text
Wiki senna-r.json (page1409580/rev4008033；canonical SHA 4de188cc…)
  → Backend seed（lol_generic_senna_dawning_shadow_primary_hit_seed.sql；
     provider_hero_senna_r_dawning_shadow_primary_hit；
     一笔物理命中 550+1.15*(ad.resolved-ad.base)+0.70*ap.resolved；精确嵌套二元；type 20220 / add 20170；
     无 20230；无显式 event；无 R-specific type；
     hero_senna/ad/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone；保留既有 W；显式 R/W isolation）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical primary-hit damage（精确嵌套二元 550+1.15*bonusAD+0.70*AP；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_senna_dawning_shadow_primary_hit_seed.sql`（bytes `30279`；SHA256 `ecec375b39b28326b511dcd691184a18a9e1399c30e7951930d0e55a801867bc`）+ `LolGenericSennaDawningShadowPrimaryHitSeedSqlTest`（bytes `57319`；SHA256 `8854b329513b8d11063140204c7c6d7c7443e12a358d552d957e1dd8729ad71c`）；README `server/data_manage/README.md` bytes `277142` / SHA256 `aa5360f567a54537e58aa380e95dc26a8c450373ca7a8f8846a798afe3f6b5b2`：独立 `provider_hero_senna_r_dawning_shadow_primary_hit`；100 mana / 100000ms CD；immediate selected-primary enemy champion single physical hit scaffold；一笔精确嵌套二元物理；`hero_senna`/ad/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone；保留既有 W；显式 R/W isolation；不合成 P/Q/E/basic/siblings）。owning `b774a8dd3db8d686ac602c052e613639726603c2`（`run-bd288908-9bda-4622-a899-fdccefc01842`；runDelta3/outside0；主 focused71 / full987 PASS）。镜像 `431692307cfdf6ce08d39b972b1c36686df16264`（`run-027e2f56-782d-4fbd-b339-93d197fdbc35`；runDelta3/outside0；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮不变。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `a8e4c0894b2ca9b077bce83ff3e925c74a6d903f`（`generic_senna_dawning_shadow_primary_hit_test.go`；test bytes `73643` / SHA256 `a42359e98452dfd3d1429fc12f8735daefd77b0da2269ba7b345200b9ff39fa9`）；实现 run `run-04b39596-8f35-4a43-a52c-1c10b4d2c2ef`（runDelta1/outside0）。主验证：focused / full / build / smoke / bench PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；英雄名 `_test.go` **仅为**机制级回归/治理证据，**排除**于 normal/TinyGo 生产构建；**无**生产 runtime 或 ABI 实现变更；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana300；baseAD60；resolvedAD140；AP100；armor100） | 扣 100 mana；一笔物理命中（raw712→final356）；CD 武装；一次 `ability_started` |
| t99999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t100000 再次成功 | 第二次物理命中；两笔 R damage；final mana100；HP1000→288；两次 `ability_started` |
| mana99 | resource skip；mana/HP 不变；无 R damage/event |
| 交叉 base60/resolved60/AP0/armor0 | raw550；final550 |
| 交叉 base60/resolved160/AP0/armor0 | raw665；final665 |
| 交叉 base60/resolved60/AP100/armor0 | raw620；final620 |
| 交叉 base60/resolved160/AP100/armor0 | raw735；final735 |
| 交叉 base60/resolved140/AP100/armor100 | raw712；final356 |
| 交叉 base60/resolved220/AP100/armor100 | raw804；final402 |
| bonus-AD 减法反证 | base0/resolved100 与 base60/resolved160 在 AP0/armor0 下均 raw/final665 |
| Standalone / R-W isolation | 仅挂载本 R（standalone 探针）；保留既有 W；显式证明 R 不合成 W / W 不产生 R 伤害 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 P/Q/E/basic/siblings；禁止引入 R-specific type；禁止把本主目标命中误称为完整 R |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-d6961d41-4530-4298-be06-3b38a88da864`；READY；strict top-level model；runDelta0；1175/1175 parseable events / 59/59 complete tool groups；无 truncation/mutation。先前 v1/v2 虽技术上 READY，但各因一个非终态 tool group 无效为正式门控；**不得**引为有效门控 |
| Backend owning | owning `b774a8dd3db8d686ac602c052e613639726603c2`；`run-bd288908-9bda-4622-a899-fdccefc01842`（runDelta3/outside0）；主 focused71 / full987 PASS；seed bytes30279 / SHA `ecec375b…01867bc`；JUnit bytes57319 / SHA `8854b329…29ad71c`；README bytes277142 / SHA `aa5360f5…f6b5b2` |
| Backend 镜像（Wasm worktree） | `431692307cfdf6ce08d39b972b1c36686df16264`；`run-027e2f56-782d-4fbd-b339-93d197fdbc35`（runDelta3/outside0；精确 parity） |
| Wasm exact | `a8e4c0894b2ca9b077bce83ff3e925c74a6d903f`；`run-04b39596-8f35-4a43-a52c-1c10b4d2c2ef`（runDelta1/outside0）；focused/full/build/smoke/bench PASS；test bytes73643 / SHA `a42359e9…f39fa9`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据（排除生产构建） |
| Web | 无本机制写入；Built/独立 Web worktree 资产 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `eb6fd9f99a0981f215c9eacf07f20667d89705dc`；审计 run `run-9c552457-7f3d-44a7-b24f-7429563c2337`（strict model；runDelta8/outside0）。主五检查通过；语义比较证明**仅** Senna R G8/Unified 记录变化，且 provisional **仅**移除 Senna R |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated88 / partial4 / blocked81 / OOS69；inScope173；Unified sourceCount12 / total254；completed98 / partial_actionable0 / ready0 / blocked_runtime75 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full98 / partial3 / none153；implementation gap58；actionable0；provisional78（runtime75/data3；hero76/item2）。治理 tasks 必须为 112。报告口径：严格 verified completion **98/254=38.6%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 78 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张。稳定 digests：Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki registry `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7` |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Senna R 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Senna R（79→78）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only / 机制级回归证据追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast time 1s/effect-at-cast-time-start/queue time 0.5s、global targeting/direction/broad or narrow wave geometry/width、projectile/travel/speed/destruction、AOE/multitarget、enemy reveal/self reveal/allied or self shield、Mist scaling/Mist Wraith hits/path sight、spellshield、ranks1-2、other Senna abilities/passives（除保留既有 W 并证明 isolation）/siblings/loadout/bootstrap、equipment/crit/on-hit、live migration/Admin publish/browser E2E/full Dawning Shadow/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Dawning Shadow/游戏技能保真；本闭环**恰好是一次选定主目标敌方英雄物理命中**，**不是**完整 R；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Senna R 为 standalone；保留既有 Senna W；显式 R/W isolation；Backend 无 repository-owned `hero_senna`/AD/AP/mana materializer——仅 external-existing-data/check-only；伤害为 **bonus AD 显式减法 + AP**（精确嵌套二元）；类型 **20220** / add **20170**；无 20230；无 R-specific type；英雄名 `_test.go` 排除于生产构建且不改变生产 runtime/ABI。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1409580 / rev4008033 / timestamp2026-04-13T04:08:13Z / canonical raw2356 / SHA256 `4de188cc…c9de36`；normalized2597 / SHA `79ced482…f66307`；pages689 / SHA `9b7fcb0a…f9e704e`；sidecar/pages canonical；local raw2353 / SHA `1b448ff4…3195dc` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_senna\|R\|暗影燎原` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标敌方英雄物理命中 |
| 公式 / fixtures | 精确嵌套二元 `550+1.15*(ad.resolved-ad.base)+0.70*ap.resolved`；type 20220 / add 20170；无 20230；无显式 event op；无 R-specific type；数值与 CD/resource 日程；自动 `ability_started`；零 R state/modifier/listener；standalone；保留 W；显式 R/W isolation；五 tags 序；含 bonus-AD 减法反证 |
| Backend | owning `b774a8d…` / 镜像 `4316923…`；focused71 + full987；无 live seed |
| Wasm | exact `a8e4c08…`；focused/full/build/smoke/bench；英雄名 `_test.go` 仅机制级回归/治理证据；无生产 Wasm/Web/ABI 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `eb6fd9f…`；接受 run `run-9c552457…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Senna R 语义对象变化；provisional 仅移除 Senna R；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY `run-d6961d41…`；runDelta0；1175 events / 59/59 complete tool groups；无 truncation/mutation；v1/v2 虽 READY 但无效为正式门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
