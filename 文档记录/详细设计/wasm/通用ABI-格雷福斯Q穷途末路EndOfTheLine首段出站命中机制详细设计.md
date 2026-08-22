TASK_KEY: wasm-generic-graves-end-of-the-line-first-outbound-pass
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 格雷福斯 Q 穷途末路（End of the Line）首段出站命中机制详细设计

关联验证记录：[通用 ABI 格雷福斯 Q 穷途末路 End of the Line 首段出站命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_graves|Q|穷途末路` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 cast/direction/range/width/line/projectile/pass-through/multitarget/powder trail、delayed 2s 或 terrain 0.2s 引爆、perpendicular area/reverse wave/second pass/total damage、once-per-pass/spellshield/Wind Wall/Braum terrain、other ranks/siblings/loadout/bootstrap/crit/on-hit、live migration/publish/E2E，或完整 End of the Line/游戏保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV graves-q-end-of-the-line-first-outbound-pass-phase-a-v2`（有效 DESIGN_READY `run-03dd4514-ca50-414f-adbc-a97b126ea974`；strict model；runDelta0/diff0；2178/2178 parseable events；59/59 complete tool groups；无 truncation / mutation。先前 v1 `run-957c034a-14a9-4649-8af3-52c39c4cc116` 返回 REVISE，但因一个未完成的只读 grep 组而**无效**为正式设计门控；其路径校正已接受进 v2，且该 run **无**写入）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_graves\|Q\|穷途末路` |
| Wiki | 请求 `Template:Data Graves/Q`，解析为 `Template:Data Graves/End of the Line`；pageId `1307367`；revision `4007501`；timestamp `2026-04-11T22:23:57Z`；canonical raw bytes `2266`；SHA256 `c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/graves-q.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2265` bytes，SHA256 `cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`（**无** completed salvage tag） |
| Rank-5 active | 80 mana；6000ms cooldown；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理命中 `150 + 0.65 * (source.attr.ad.resolved - source.attr.ad.base)`（**精确二元树** `add(const 150, mul(const 0.65, sub(read source.attr.ad.resolved, read source.attr.ad.base)))`；**显式 bonus AD 减法**；不得按 total-AD 直读，亦不得省略 base 相减；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动合成恰好一次 `ability_started`；**零** Q state / modifier / listener / matcher / repeat / control；**无** Q-specific type |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定主目标首段出站单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模 cast/direction/range/width/line/projectile/pass-through/multitarget/trail、delayed/terrain 引爆、perpendicular/reverse wave/second pass/total，或完整 Q 保真 |
| Standalone | Graves Q provider **独立**；**不**依赖 Graves P/E/W/R/True Grit/basic；**不**合成 Batch-B 或 sibling Graves 机制 |
| Q/E isolation | Q **不**改变 True Grit；E **不**产生 Q 伤害；Q seed **不含** E rows |
| Backend 前置 | 仓库**无** repository-owned `hero_graves` / AD / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | base0/resolved0/armor0 → raw/final150；base60/resolved60/armor0 → raw/final150；base60/resolved160/armor0 → raw/final215；base60/resolved160/armor100 → raw215/final107.5；base60/resolved260/armor100 → raw280/final140；base0/resolved100 与 base60/resolved160 在 armor0 下均 raw/final215（证明 bonus-AD 减法） |
| 日程交叉 | mana240 / baseAD60 / resolvedAD160 / HP1000 / armor100：t0 / t5999 / t6000 → success / skip / success；恰好两笔 Q damage；final mana80 / HP785；两次自动 Q `ability_started`；mana79 → resource skip / mana/HP 不变 / 无 Q damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界首段出站单次物理命中；不代表完整 End of the Line 弹道、火药轨迹、延迟/地形引爆、垂直区域、回弹第二段或总伤害。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| cast / direction / range / width / line / geometry | 施法时间、方向、射程、宽度、直线与几何全部排除 |
| projectile / travel / pass-through / multitarget | 弹道、飞行、穿透与多目标全部排除 |
| powder trail / terrain / collision | 火药轨迹、地形与碰撞全部排除 |
| delayed 2s or terrain 0.2s detonation | 延迟 2s 或地形 0.2s 引爆全部排除 |
| perpendicular area / reverse wave / second pass / total damage | 垂直区域、回弹波、第二段与总伤害全部排除 |
| once-per-pass / spellshield / Wind Wall / Braum terrain | 每段一次、法术护盾、风墙与布隆地形交互全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other Graves abilities / passives / siblings / loadout / bootstrap | 无 P/E/W/R/basic/True Grit 耦合；不合成 sibling；无负荷/bootstrap |
| equipment / crit / on-hit | 无装备/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full End of the Line / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标首段出站物理命中**，不是完整 Q |

## 3. 端到端数据流

```text
Wiki graves-q.json (page1307367/rev4007501；canonical SHA c1884000…)
  → Backend seed（lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql；
     provider_hero_graves_q_end_of_the_line_first_outbound_pass；
     一笔物理命中 150+0.65*(ad.resolved-ad.base)；精确二元；type 20220 / add 20170；
     无 20230；无显式 event；无 Q-specific type；
     hero_graves/ad/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成；Q seed 无 E rows）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical first-outbound-pass damage（精确二元 150+0.65*(ad.resolved-ad.base)；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql`（SHA256 `e17d4739f2d98d213c3a5ff3e6ab3943f9e2e474f882e03bccca01492af88ca0`）+ `LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest`（SHA256 `16cafe131d75221eb916e96619c14d3ae630d1ba8debb485b75ab9a61a6b00ac`）；README `server/data_manage/README.md` SHA256 `e7dddfcdf14b9c481d4a7217df2e7fbf49adcf0e77e81031c57f3871e00296a6`：独立 `provider_hero_graves_q_end_of_the_line_first_outbound_pass`；80 mana / 6000ms CD；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；一笔精确二元物理；`hero_graves`/ad/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成；Q seed 无 E rows）。owning `9294292d38a614f61bb73062224aabbc756d28a5`（`run-bc2c80e8-3cad-445b-bff0-94d104147631`；runDelta3/outside0；主 focused50 / full943 PASS）。镜像 `a54cf6f6671daf4039d6eccfe18aab4d9327c15f`（`run-43d31e5d-0bf4-408f-a345-873e4cb25b34`；runDelta3/outside0；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `c16107ec4420113d9a31d78c11f7f91182d662cf`（`generic_graves_end_of_the_line_first_outbound_pass_test.go`；test bytes `66870` / SHA256 `a95e0d9632b0fe45aaec9440ccd89c381d6903f2c99ab761581736ec1f8c8e77`）；实现 run `run-d574c128-ca46-4fcb-9581-98b438cd983e`（runDelta1/outside0）。主验证：focused7 / full / bench / build / smoke / benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana240；baseAD60；resolvedAD160；armor100） | 扣 80 mana；一笔物理命中（raw215→final107.5）；CD 武装；一次 `ability_started` |
| t5999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t6000 再次成功 | 第二次物理命中；两笔 Q damage；final mana80；HP1000→785；两次 `ability_started` |
| mana79 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 base0/resolved0/armor0 | raw150；final150 |
| 交叉 base60/resolved60/armor0 | raw150；final150 |
| 交叉 base60/resolved160/armor0 | raw215；final215 |
| 交叉 base60/resolved160/armor100 | raw215；final107.5 |
| 交叉 base60/resolved260/armor100 | raw280；final140 |
| bonus-AD 减法证明 | base0/resolved100 与 base60/resolved160 在 armor0 下均 raw/final215 |
| Q alone（Q/E isolation） | Q 不改变 True Grit；不产生 E 副作用 |
| E alone | E 无 Q damage；Q seed 无 E rows |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Graves；禁止引入 Q-specific type；禁止把本首段出站命中误称为完整 Q |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-03dd4514-ca50-414f-adbc-a97b126ea974`；READY；strict model；runDelta0/diff0；2178/2178 parseable events / 59/59 complete tool groups；无 truncation/mutation。先前 v1 `run-957c034a…` 因未完成只读 grep 组无效为正式门控；路径校正已接受进 v2；该 run 无写入 |
| Backend owning | owning `9294292d38a614f61bb73062224aabbc756d28a5`；`run-bc2c80e8-3cad-445b-bff0-94d104147631`（runDelta3/outside0）；主 focused50 / full943 PASS；seed SHA `e17d4739…f88ca0`；JUnit SHA `16cafe13…6b00ac`；README SHA `e7dddfcd…0296a6` |
| Backend 镜像（Wasm worktree） | `a54cf6f6671daf4039d6eccfe18aab4d9327c15f`；`run-43d31e5d-0bf4-408f-a345-873e4cb25b34`（runDelta3/outside0；精确 parity） |
| Wasm exact | `c16107ec4420113d9a31d78c11f7f91182d662cf`；`run-d574c128-ca46-4fcb-9581-98b438cd983e`（runDelta1/outside0）；focused7/full/bench/build/smoke/benchmark PASS；test bytes66870 / SHA `a95e0d96…8c8e77`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `4585926af29144eae6c0b40b710757da188f7565`；`run-8dbc58fd-cee2-423b-95f5-0d66016e6cf6`（strict model；runDelta8/outside0）。主五检查通过；语义比较证明**仅** Graves Q G8/Unified 记录变化，且 provisional **仅**移除 Graves Q |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated84 / partial4 / blocked85 / OOS69；inScope173；Unified sourceCount12 / total254；completed94 / partial_actionable0 / ready0 / blocked_runtime79 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full94 / partial3 / none157；implementation gap62；actionable0；provisional82（runtime79/data3；hero80/item2）。治理 tasks 必须为 108。报告口径：严格 verified completion **94/254=37.0%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 82 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Graves Q 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Graves Q（83→82）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast/direction/range/width/line/geometry/projectile/travel/pass-through/multitarget/powder trail/terrain/collision、delayed 2s 或 terrain 0.2s detonation、perpendicular area/reverse wave/second pass/total damage、once-per-pass/spellshield/Wind Wall/Braum terrain、ranks1-4、other Graves abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live migration/Admin publish/browser E2E/full End of the Line/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 End of the Line/游戏技能保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Graves Q 为 standalone；Backend 无 repository-owned `hero_graves`/AD/mana materializer——仅 external-existing-data/check-only；伤害为 **bonus AD 显式减法**（精确二元）；类型 **20220** / add **20170**；无 20230；无 Q-specific type；显式 Q/E isolation（Q 不改变 True Grit；E 无 Q damage；Q seed 无 E rows）。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307367 / rev4007501 / timestamp2026-04-11T22:23:57Z / canonical raw2266 / SHA256 `c1884000…41345c5`；sidecar/pages canonical；local raw2265 / SHA `cd2744fb…df0377` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_graves\|Q\|穷途末路` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标首段出站物理命中 |
| 公式 / fixtures | 精确二元 `150+0.65*(ad.resolved-ad.base)`；type 20220 / add 20170；无 20230；无显式 event op；无 Q-specific type；数值与 CD/resource 日程；自动 `ability_started`；零 Q state/modifier/listener；standalone；四 tags 序（无 salvage tag）；含 bonus-AD 减法证明；Q/E isolation |
| Backend | owning `9294292…` / 镜像 `a54cf6f…`；focused50 + full943；无 live seed |
| Wasm | exact `c16107e…`；focused7/full/bench/build/smoke/benchmark；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `4585926…`；接受 run `run-8dbc58fd…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Graves Q 语义对象变化；provisional 仅移除 Graves Q；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY `run-03dd4514…`；runDelta0/diff0；2178 events / 59/59 complete tool groups；无 truncation/mutation；v1 `run-957c034a…` 无效为正式门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
