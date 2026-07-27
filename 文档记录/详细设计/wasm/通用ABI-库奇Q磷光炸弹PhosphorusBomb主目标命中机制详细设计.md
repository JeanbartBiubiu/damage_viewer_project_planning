TASK_KEY: wasm-generic-corki-phosphorus-bomb-primary-impact
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 库奇 Q 磷光炸弹（Phosphorus Bomb）主目标命中机制详细设计

关联验证记录：[通用 ABI 库奇 Q 磷光炸弹 Phosphorus Bomb 主目标命中机制验证记录](../../测试记录/wasm/通用ABI-库奇Q磷光炸弹PhosphorusBomb主目标命中机制验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_corki|Q|磷光炸弹` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 cast time / location targeting / range / radius / geometry、projectile travel / minimum travel time / explosion、AOE / multitarget / surrounding、travel/impact-area sight、enemy-champion reveal / six-second duration、spellshield、collision/acquisition、other ranks/siblings/loadout/bootstrap/crit/on-hit、live migration/publish/E2E，或完整 Phosphorus Bomb/游戏保真；本闭环**恰好是一次选定主目标单次魔法命中**，**不是**完整 Q；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV corki-q-phosphorus-bomb-primary-impact-phase-a-v1`（有效 DESIGN_READY `run-aa057cdf-e66c-473f-b3ac-919150ad1b38`；strict model；runDelta0；2062/2062 parseable events；52/52 complete tool groups；无 truncation / mutation）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_corki\|Q\|磷光炸弹` |
| Wiki | 请求 `Template:Data Corki/Q`，解析为 `Template:Data Corki/Phosphorus Bomb`；pageId `1306953`；revision `4007588`；timestamp `2026-04-12T06:50:59Z`；canonical raw bytes `1531`；SHA256 `e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/corki-q.json` bytes `2148` / SHA256 `3c4584b2e8442e7ff2ae1d2d4c4d8dff4613efa98bf7ba4cd3ab44ef05c8572d` plus pages sibling bytes `691` / SHA256 `bff7e3533e2bba561c03e91da5d7c07ffc095e07a0669b321cc7fd480d18f42a` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `1529` bytes，SHA256 `c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（**无** salvage / `meta_or_non_target_dps` governed tags；raw upstream 含历史 `classification=out_of_scope_for_single_target_dps` / `mechanismTags=meta_or_non_target_dps` / `auditBaseline.damageDisposition=primary_damage_branch_salvage` 仅作历史 provenance） |
| Rank-5 active | 80 mana；7000ms cooldown；immediate selected-primary-champion single magic impact hit scaffold；每次成功施放恰好一笔非暴击/不可复制魔法命中 `240 + 1.25 * (source.attr.ad.resolved - source.attr.ad.base) + 1.00 * source.attr.ap.resolved`（**精确嵌套二元树** `add(add(const 240, mul(const 1.25, sub(read source.attr.ad.resolved, read source.attr.ad.base))), mul(const 1.00, read source.attr.ap.resolved))`；**bonus AD 由显式减法**；不得按 total-AD 直读，亦不得省略 base 相减；伤害类型 **20221** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动合成恰好一次 `ability_started`；**零** Q state / modifier / listener / matcher / repeat / control / projectile / explosion；**无** Q-specific type |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定主目标单次魔法命中**。Immediate impact 为 Phase-A scaffold；**不**建模 cast/location/range/radius/geometry/projectile/travel/minimum-time/explosion/AOE/multitarget/sight/reveal/duration/spellshield，或完整 Q 保真 |
| Standalone | Corki Q provider **独立**；**不**合成 P/W/E/R/basic；**不**合成 Batch-B 或 sibling Corki 机制 |
| Backend 前置 | 仓库**无** repository-owned `hero_corki` / AD / AP / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | base60/resolved60/AP0/MR0 → raw/final240；base60/resolved160/AP0/MR0 → raw/final365；base60/resolved60/AP100/MR0 → raw/final340；base60/resolved160/AP100/MR0 → raw/final465；base60/resolved156/AP100/MR100 → raw460/final230；base60/resolved220/AP100/MR100 → raw540/final270；base0/resolved100 与 base60/resolved160 在 AP0/MR0 下均 raw/final365（bonus-AD 减法反证） |
| 日程交叉 | mana240 / baseAD60 / resolvedAD156 / AP100 / HP1000 / MR100：t0 / t6999 / t7000 → success / skip / success；恰好两笔 Q damage；final mana80 / HP540；两次自动 Q `ability_started`；mana79 → resource skip / mana/HP 不变 / 无 Q damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界单次魔法命中；不代表完整 Phosphorus Bomb 弹道、爆炸、AOE、视野揭示或完整 Q。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| cast time / location targeting / range / radius / geometry | 施法时间与落点指向/距离/半径/几何全部排除 |
| projectile travel / minimum travel time / explosion | 弹道飞行、最小飞行时间与爆炸全部排除 |
| AOE / multitarget / surrounding | 范围/多目标/周围命中全部排除 |
| travel / impact-area sight / enemy-champion reveal / six-second duration | 飞行与落点视野、敌方英雄揭示与六秒持续时间全部排除 |
| spellshield / collision / acquisition | 法术护盾、碰撞与目标获取全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other Corki abilities / passives / siblings / loadout / bootstrap | 无 P/W/E/R/basic 耦合；不合成 sibling；无负荷/bootstrap |
| equipment / crit / on-hit | 无装备/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full Phosphorus Bomb / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标魔法命中**，不是完整 Q |

## 3. 端到端数据流

```text
Wiki corki-q.json (page1306953/rev4007588；canonical SHA e71a474e…)
  → Backend seed（lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql；
     provider_hero_corki_q_phosphorus_bomb_primary_impact；
     一笔魔法命中 240+1.25*(ad.resolved-ad.base)+1.00*ap.resolved；精确嵌套二元；type 20221 / add 20170；
     无 20230；无显式 event；无 Q-specific type；
     hero_corki/ad/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic primary-impact damage（精确嵌套二元 240+1.25*bonusAD+1.00*AP；20221/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql`（bytes `29669`；SHA256 `fa1ac4873824073c354b80fd5dc6c18055c82c23ae336c4a214259dba00ecdd3`）+ `LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest`（bytes `56626`；SHA256 `16f0170eb37a0e9545eed9ece169a30d81c90cda1e4b92245986ee9404cd5752`）；README `server/data_manage/README.md` bytes `269588` / SHA256 `538f73d1ab9e63056fae2b4dac146e2b60628bcd46995ff99f9ff36e7f0ae66f`：独立 `provider_hero_corki_q_phosphorus_bomb_primary_impact`；80 mana / 7000ms CD；immediate selected-primary-champion single magic impact hit scaffold；一笔精确嵌套二元魔法；`hero_corki`/ad/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。owning `6003a7e1aeb083a937c880d4486bac974ab329bc`（`run-14d830d3-62f9-46fa-80a4-f94b6b41ecb8`；runDelta3/outside0；主 focused75 / full975 PASS）。镜像 `b352677b63929c25f83df3a52c51cba0fd379f65`（`run-3356a0a5-a77b-4c09-903c-1d4104577015`；runDelta3/outside0；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。独立 Web worktree（`C:\project\damage_web_dev`）与标准 build 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮不变。Cursor 曾误比 Wasm worktree 内嵌陈旧 `web/` 副本（`1,101,630` / SHA `2ce1…`）并报告 mismatch——主会话已核实独立 Web 资产精确 parity；**无** Web 写入。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `b381b1e5a9d99fb73ca9a6b9098c2a39c5cbc546`（`generic_corki_phosphorus_bomb_primary_impact_test.go`；最终 test bytes `65821` / SHA256 `58f477631d1b7580e22b5d187c3aa96bae4fffa785f576a3abb5bf84c8a68a09`）；实现 run `run-07f7d8a7-0952-4c33-9877-335686845175`（runDelta1/outside0）。主验证：focused / full / bench / build / smoke / benchmark PASS。英雄名 `_test.go` **仅为**机制级回归/治理证据，**排除**于 normal/TinyGo 生产构建；**无**生产 runtime 或 ABI 实现变更；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana240；baseAD60；resolvedAD156；AP100；MR100） | 扣 80 mana；一笔魔法命中（raw460→final230）；CD 武装；一次 `ability_started` |
| t6999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t7000 再次成功 | 第二次魔法命中；两笔 Q damage；final mana80；HP1000→540；两次 `ability_started` |
| mana79 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 base60/resolved60/AP0/MR0 | raw240；final240 |
| 交叉 base60/resolved160/AP0/MR0 | raw365；final365 |
| 交叉 base60/resolved60/AP100/MR0 | raw340；final340 |
| 交叉 base60/resolved160/AP100/MR0 | raw465；final465 |
| 交叉 base60/resolved156/AP100/MR100 | raw460；final230 |
| 交叉 base60/resolved220/AP100/MR100 | raw540；final270 |
| bonus-AD 减法反证 | base0/resolved100 与 base60/resolved160 在 AP0/MR0 下均 raw/final365 |
| Standalone | 不合成 P/W/E/R/basic；不合成 Batch-B/sibling Corki |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Corki；禁止把 salvage/`meta_or_non_target_dps` 升为 governed tags 或引入 Q-specific type；禁止把本主目标命中误称为完整 Q |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-aa057cdf-e66c-473f-b3ac-919150ad1b38`；READY；strict model；runDelta0；2062/2062 parseable events / 52/52 complete tool groups；无 truncation/mutation |
| Backend owning | owning `6003a7e1aeb083a937c880d4486bac974ab329bc`；`run-14d830d3-62f9-46fa-80a4-f94b6b41ecb8`（runDelta3/outside0）；主 focused75 / full975 PASS；seed bytes29669 / SHA `fa1ac487…00ecdd3`；JUnit bytes56626 / SHA `16f0170e…cd5752`；README bytes269588 / SHA `538f73d1…0ae66f` |
| Backend 镜像（Wasm worktree） | `b352677b63929c25f83df3a52c51cba0fd379f65`；`run-3356a0a5-a77b-4c09-903c-1d4104577015`（runDelta3/outside0；精确 parity） |
| Wasm exact | `b381b1e5a9d99fb73ca9a6b9098c2a39c5cbc546`；`run-07f7d8a7-0952-4c33-9877-335686845175`（runDelta1/outside0）；focused/full/bench/build/smoke/benchmark PASS；最终 test bytes65821 / SHA `58f47763…a68a09`；独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据（排除生产构建） |
| Web | 无本机制写入；独立 Web worktree 资产 `1,169,377` / `65a4…c6a0`；内嵌 `web/` 陈旧副本 mismatch 为错误比路径 caveat，非独立 Web 失败 |
| 审计接受 | commit `6a0c450e7057de1c25a9eb066f666852d357f666`；审计 run `run-a5165548-52e8-4863-8be8-577b567ec07f`（strict model；runDelta8/outside0）。主五检查通过；语义比较证明**仅** Corki Q G8/Unified 记录变化，且 provisional **仅**移除 Corki Q。审计助手 `178/254=70.1%` 算术已驳回；正确 completed+provisional 为 `(97+79)/254=176/254=69.3%` |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated87 / partial4 / blocked82 / OOS69；inScope173；Unified sourceCount12 / total254；completed97 / partial_actionable0 / ready0 / blocked_runtime76 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full97 / partial3 / none154；implementation gap59；actionable0；provisional79（runtime76/data3；hero77/item2）。治理 tasks 必须为 111。报告口径：严格 verified completion **97/254=38.2%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 79 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|bonus_ad_ratio|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段（含历史 `classification=out_of_scope_for_single_target_dps` / `mechanismTags=meta_or_non_target_dps` / `auditBaseline.gapCode=blocked_data` / `damageDisposition=primary_damage_branch_salvage`）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition；**禁止**把 salvage/`meta_or_non_target_dps` 升为 governed tags。

主会话语义比较：ordered keys 242/254 不变；**仅** Corki Q 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Corki Q（80→79）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only / 机制级回归证据追加，**无**生产 Wasm 或 Web 写入/commit。独立 Web worktree 源资产与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。Cursor 最初误比 Wasm worktree 内嵌陈旧 `web/` 副本（`1,101,630` / SHA `2ce1…`）并报告 mismatch；主会话核实独立 `C:\project\damage_web_dev` 资产精确 parity，且**无** Web 写入。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast time/location targeting/range/radius/geometry、projectile travel/minimum travel time/explosion、AOE/multitarget/surrounding、travel/impact-area sight/enemy-champion reveal/six-second duration、spellshield/collision/acquisition、ranks1-4、other Corki abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live migration/Admin publish/browser E2E/full Phosphorus Bomb/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Phosphorus Bomb/游戏技能保真；本闭环**恰好是一次选定主目标魔法命中**，**不是**完整 Q；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Corki Q 为 standalone；Backend 无 repository-owned `hero_corki`/AD/AP/mana materializer——仅 external-existing-data/check-only；伤害为 **bonus AD 显式减法 + AP**（精确嵌套二元）；类型 **20221** / add **20170**；无 20230；无 Q-specific type；英雄名 `_test.go` 排除于生产构建且不改变生产 runtime/ABI。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1306953 / rev4007588 / timestamp2026-04-12T06:50:59Z / canonical raw1531 / SHA256 `e71a474e…760365`；normalized2148 / SHA `3c4584b2…c8572d`；pages691 / SHA `bff7e353…18f42a`；sidecar/pages canonical；local raw1529 / SHA `c39556a0…948ba6` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_corki\|Q\|磷光炸弹` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标魔法命中 |
| 公式 / fixtures | 精确嵌套二元 `240+1.25*(ad.resolved-ad.base)+1.00*ap.resolved`；type 20221 / add 20170；无 20230；无显式 event op；无 Q-specific type；数值与 CD/resource 日程；自动 `ability_started`；零 Q state/modifier/listener；standalone；五 tags 序（无 salvage/`meta_or_non_target_dps` governed）；含 bonus-AD 减法反证 |
| Backend | owning `6003a7e…` / 镜像 `b352677…`；focused75 + full975；无 live seed |
| Wasm | exact `b381b1e…`；focused/full/bench/build/smoke/benchmark；英雄名 `_test.go` 仅机制级回归/治理证据；无生产 Wasm/Web/ABI 写入 |
| Web | 无本机制写入；独立 Web worktree 资产 `1,169,377` / `65a4…c6a0`；内嵌 `web/` mismatch 为错误比路径 caveat |
| 审计 | commit `6a0c450…`；接受 run `run-a5165548…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Corki Q 语义对象变化；provisional 仅移除 Corki Q；`178/254=70.1%` 已驳回；正确 `(97+79)/254=69.3%`；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY `run-aa057cdf…`；runDelta0；2062 events / 52/52 complete tool groups；无 truncation/mutation |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
