TASK_KEY: wasm-generic-tristana-rocket-jump-primary-landing-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 崔丝塔娜 W 火箭跳跃（Rocket Jump）主目标落地命中机制详细设计

关联验证记录：[通用 ABI 崔丝塔娜 W 火箭跳跃主目标落地命中机制验证记录](../../测试记录/wasm/通用ABI-崔丝塔娜W-火箭跳跃主目标落地命中机制验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_tristana|W|火箭跳跃` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 dash/cast time/air-time/landing delay、movement/geometry/range/speed/terrain/collision、AOE/radius350/secondary、slow/knockdown/grounded/spellshield、takedown/clone/Explosive Charge reset、cast-during-dash、ranks1-4、其它崔丝塔娜技能/被动、装备/负荷/bootstrap/暴击/on-hit、live migration/publish/E2E，或完整 Rocket Jump/游戏保真；本闭环**恰好是一次选定目标魔法落地命中**，**不是**完整 W；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV tristana-w-rocket-jump-primary-landing-hit-phase-a-v2`（有效 DESIGN_READY `run-a2de6890-4ef9-4da9-b8e0-627c62dc525c`；strict model；runDelta0/diff0；1665 parseable event lines / 45/45 complete tool groups；无 truncation / mutation。先前 v1 `run-46960ef9-87bd-4868-90d8-7cf32a368df3` 因一个未完成的只读 grep 组而**无效**为正式设计门控；其 taxonomy 发现已接受进 v2，且该 run **无**写入）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_tristana\|W\|火箭跳跃` |
| Wiki | 请求 `Template:Data Tristana/W`，解析为 `Template:Data Tristana/Rocket Jump`；pageId `1308523`；revision `4007758`；timestamp `2026-04-12T14:13:05Z`；canonical raw bytes `2444`；SHA256 `cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/tristana-w.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2443` bytes，SHA256 `7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（G8 override 写入序；Unified 全局 `localeCompare` 序列化时 `ap_ratio` 可先于 `bonus_ad_ratio`——集合相同，不得误读为两套 tags；**无** completed salvage tag） |
| Rank-5 active | 50 mana；14000ms cooldown；immediate selected-primary-champion single magic landing hit scaffold；每次成功施放恰好一笔非暴击/不可复制魔法命中 `210 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base) + 0.50 * source.attr.ap.resolved`（**精确嵌套二元树** `add(add(210,1.00*(ad.resolved-ad.base)),0.50*ap.resolved)`；**显式 bonus AD 减法**；不得按 total-AD 直读，亦不得省略 base 相减；伤害类型 **20221** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动合成恰好一次 `ability_started`；**零** W state / modifier / listener / matcher / repeat / control；**无** W type / type **62013** |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定目标单次魔法落地命中**。Immediate impact 为 Phase-A scaffold；**不**建模 dash/cast/air-time/landing delay、位移几何、AOE/减速击倒、takedown/Explosive Charge reset 或完整跳跃保真 |
| Standalone | Tristana W provider **独立**；**不**依赖 Tristana P/Q/E/R/Explosive Charge；**不**合成 Batch-B 或 sibling Tristana 机制 |
| Q/W isolation | W **不**武装 Q；Q **不**产生 W 伤害 |
| Backend 前置 | 仓库**无** repository-owned `hero_tristana` / AD / AP / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | base0/resolved0/AP0/MR0 → raw/final210；base60/resolved60/AP0/MR0 → raw/final210；base60/resolved160/AP0/MR0 → raw/final310；base60/resolved160/AP100/MR0 → raw/final360；base60/resolved160/AP100/MR100 → raw360/final180；base60/resolved260/AP200/MR100 → raw510/final255；base0/resolved100 与 base60/resolved160 在 AP100/MR0 下均 raw/final360（证明 bonus-AD 减法） |
| 日程交叉 | mana150 / baseAD60 / resolvedAD160 / AP100 / HP1000 / MR100：t0 / t13999 / t14000 → success / skip / success；恰好两笔 W damage；final mana50 / HP640；两次自动 W `ability_started`；mana49 → resource skip / mana/HP 不变 / 无 W damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界单次魔法落地命中；不代表完整 Rocket Jump dash、滞空、落地延迟、AOE、减速击倒或 Explosive Charge。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| dash / cast time / air-time / landing delay | 冲刺、施法时间、滞空与落地延迟全部排除 |
| movement / geometry / range / speed / terrain / collision | 位移、几何、射程、速度、地形与碰撞全部排除 |
| AOE / radius350 / secondary | 范围伤害、半径 350 与次级目标全部排除 |
| slow / knockdown / grounded / spellshield | 减速、击倒、禁空与法术护盾全部排除 |
| takedown / clone / Explosive Charge reset | 击杀重置、克隆与爆炸火花重置全部排除 |
| cast-during-dash | 冲刺中施放全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other Tristana abilities / passives / siblings / loadout / bootstrap | 无 P/Q/E/R/basic 耦合；不合成 sibling；无负荷/bootstrap |
| equipment / crit / on-hit | 无装备/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full Rocket Jump / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定目标魔法落地命中**，不是完整 W |

## 3. 端到端数据流

```text
Wiki tristana-w.json (page1308523/rev4007758；canonical SHA cf0e3ae9…)
  → Backend seed（lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql；
     provider_hero_tristana_w_rocket_jump_primary_landing_hit；
     一笔魔法命中 210+1.00*(ad.resolved-ad.base)+0.50*ap.resolved；嵌套二元；type 20221 / add 20170；
     无 20230；无显式 event；无 W type/62013；
     hero_tristana/ad/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic primary landing-hit damage（嵌套二元 210+1.00*(ad.resolved-ad.base)+0.50*ap.resolved；20221/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql`（SHA256 `6f11143c6774d3713fb00bb50d1c81816ca5913da966b30e5082888d63ef8643`）+ `LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest`（SHA256 `706a8eac3d0490a2c42eee2f411d967b4b19b43a5b67834a611b8f43a5f2104d`）；README `server/data_manage/README.md` SHA256 `fb6ccd347dca4009da1ba51f9f92cdc0789da027735a23bfb5011121d87bcc0a`：独立 `provider_hero_tristana_w_rocket_jump_primary_landing_hit`；50 mana / 14000ms CD；immediate selected-primary-champion single magic landing hit scaffold；一笔嵌套二元魔法；`hero_tristana`/ad/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。owning `7cafeab8bf008da3cc80003530a63b4f4577a5cb`（`run-846684b0-78b0-42ff-8baa-de14776de20d`；runDelta3/outside0；主 focused10 / adjacent57 / full932 PASS）。镜像 `ac304d30025b0d08d1af74919d2f479566ac88ac`（`run-4d26ad0d-69e1-4b45-ab88-6593194169e2`；runDelta3/outside0；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `9d2716cb04ecd861aa52a4bc3945a3dcd371f13d`（`generic_tristana_rocket_jump_primary_landing_hit_test.go`）；实现 run `run-6370d434-4e69-4d5d-a2cb-6674b854ac83`（runDelta1/outside0）。主验证：focused7 / full / bench / build / smoke / benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana150；baseAD60；resolvedAD160；AP100；MR100） | 扣 50 mana；一笔魔法命中（raw360→final180）；CD 武装；一次 `ability_started` |
| t13999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t14000 再次成功 | 第二次魔法命中；两笔 W damage；final mana50；HP1000→640；两次 `ability_started` |
| mana49 | resource skip；mana/HP 不变；无 W damage/event |
| 交叉 base0/resolved0/AP0/MR0 | raw210；final210 |
| 交叉 base60/resolved60/AP0/MR0 | raw210；final210 |
| 交叉 base60/resolved160/AP0/MR0 | raw310；final310 |
| 交叉 base60/resolved160/AP100/MR0 | raw360；final360 |
| 交叉 base60/resolved160/AP100/MR100 | raw360；final180 |
| 交叉 base60/resolved260/AP200/MR100 | raw510；final255 |
| bonus-AD 减法证明 | base0/resolved100 与 base60/resolved160 在 AP100/MR0 下均 raw/final360 |
| Q alone（Q/W isolation） | 无 W damage；不武装 W |
| W alone / W after Q mount | W 产生 W damage；**不**武装 Q |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Tristana；禁止引入 W type/62013；禁止把本落地命中误称为完整 W |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-a2de6890-4ef9-4da9-b8e0-627c62dc525c`；READY；strict model；runDelta0/diff0；1665 parseable events / 45/45 complete tool groups；无 truncation/mutation。先前 v1 `run-46960ef9…` 因未完成只读 grep 组无效为正式门控；taxonomy 已接受进 v2；该 run 无写入 |
| Backend owning | owning `7cafeab8bf008da3cc80003530a63b4f4577a5cb`；`run-846684b0-78b0-42ff-8baa-de14776de20d`（runDelta3/outside0）；主 focused10 / adjacent57 / full932 PASS；seed SHA `6f11143c…ef8643`；JUnit SHA `706a8eac…f2104d`；README SHA `fb6ccd34…87bcc0a` |
| Backend 镜像（Wasm worktree） | `ac304d30025b0d08d1af74919d2f479566ac88ac`；`run-4d26ad0d-69e1-4b45-ab88-6593194169e2`（runDelta3/outside0；精确 parity） |
| Wasm exact | `9d2716cb04ecd861aa52a4bc3945a3dcd371f13d`；`run-6370d434-4e69-4d5d-a2cb-6674b854ac83`（runDelta1/outside0）；focused7/full/bench/build/smoke/benchmark PASS；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `6cc6b0041629eca1e286a38aa9d0f7daa398f0d8`；`run-c399c177-e2d5-4250-a1a4-cb22550a9857`（strict model；runDelta8/outside0）。主五检查通过；语义比较证明**仅** Tristana W G8/Unified 记录变化，且 provisional **仅**移除 Tristana W |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated83 / partial4 / blocked86 / OOS69；inScope173；Unified sourceCount12 / total254；completed93 / partial_actionable0 / ready0 / blocked_runtime80 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full93 / partial3 / none158；implementation gap63；actionable0；provisional83（runtime80/data3；hero81/item2）。治理 tasks 必须为 107。报告口径：严格 verified completion **93/254=36.6%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 83 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|bonus_ad_ratio|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Tristana W 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Tristana W（84→83）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：dash/cast time/air-time/landing delay、movement/geometry/range/speed/terrain/collision、AOE/radius350/secondary、slow/knockdown/grounded/spellshield、takedown/clone/Explosive Charge reset、cast-during-dash、ranks1-4、other Tristana abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live migration/Admin publish/browser E2E/full Rocket Jump/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Rocket Jump/游戏技能保真；本闭环**恰好是一次选定目标魔法落地命中**，**不是**完整 W；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Tristana W 为 standalone；Backend 无 repository-owned `hero_tristana`/AD/AP/mana materializer——仅 external-existing-data/check-only；伤害为 **bonus AD 显式减法 + AP**（嵌套二元）；类型 **20221** / add **20170**；无 20230；无 W type/62013；显式 Q/W isolation。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308523 / rev4007758 / timestamp2026-04-12T14:13:05Z / canonical raw2444 / SHA256 `cf0e3ae9…e56eec`；sidecar/pages canonical；local raw2443 / SHA `7283b2eb…1cabd9` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_tristana\|W\|火箭跳跃` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定目标魔法落地命中 |
| 公式 / fixtures | 嵌套二元 `210+1.00*(ad.resolved-ad.base)+0.50*ap.resolved`；type 20221 / add 20170；无 20230；无显式 event op；无 W type/62013；数值与 CD/resource 日程；自动 `ability_started`；零 W state/modifier/listener；standalone；五 tags 序含 `bonus_ad_ratio` 与 `ap_ratio`（无 salvage tag）；含 bonus-AD 减法证明；Q/W isolation |
| Backend | owning `7cafeab8…` / 镜像 `ac304d30…`；focused10 + adjacent57 + full932；无 live seed |
| Wasm | exact `9d2716cb…`；focused7/full/bench/build/smoke/benchmark；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `6cc6b00…`；接受 run `run-c399c177…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Tristana W 语义对象变化；provisional 仅移除 Tristana W；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY `run-a2de6890…`；runDelta0/diff0；1665 events / 45/45 complete tool groups；无 truncation/mutation；v1 `run-46960ef9…` 无效为正式门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
