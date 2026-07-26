TASK_KEY: wasm-generic-lucian-the-culling-single-shot-quantum
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 卢锡安 R 圣枪洗礼（The Culling）单发伤害量子机制详细设计

关联验证记录：[通用 ABI 卢锡安 R 圣枪洗礼单发伤害量子机制验证记录](../../测试记录/wasm/通用ABI-卢锡安R-圣枪洗礼单发伤害量子机制验证记录-2026-07-25.md)。本任务将精确候选 `hero_skill|hero_lucian|R|圣枪洗礼` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 3 秒 channel/channel state、0.75 秒/手动/自动 recast、22 base shots 与暴击率射击缩放、整段 channel 总伤害、cadence/fire rate、方向/射程/宽度、导弹偏移/交替枪口/飞行/碰撞/首个敌人几何/多目标、小兵双倍、移动/ghosted/facing、法术护盾、打断/E 可用性/Q-W lockout/Thresh/Tahm、ranks1-2、其它卢锡安技能/被动、装备/负荷/暴击/on-hit、live migration/publish/E2E，或完整 The Culling/游戏保真；本闭环**恰好是一发伤害量子**，**不是**一次完整 R 命中或大招总伤害；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV lucian-r-the-culling-single-shot-quantum-phase-a-v2`（有效 DESIGN_READY `run-38f41c33-dd0f-40c3-92e6-1046b9a0c023`；strict `grok-4.5` / high / fast=false；runDelta0/diff0；1237 parseable event lines / 58/58 complete tool groups；无 truncation / blocker / nonblocking / user decision）。较早 v1 审查 `run-b398bd76-6c92-4791-8b92-daf58a5f4c17` 返回 REVISE，其禁止 `total_ad_ratio` 的发现已被吸收进 v2，但该 run 仅完成 70/71 read-only tool groups（1508 parseable events；runDelta0/diff0；零 truncation）——**无效设计门控**，不得称为 valid gate。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_lucian\|R\|圣枪洗礼` |
| Wiki | 请求 `Template:Data Lucian/R`，解析为 `Template:Data Lucian/The Culling`；pageId `1308182`；revision `4007670`；timestamp `2026-04-12T10:40:21Z`；canonical raw bytes `4477`；SHA256 `7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/lucian-r.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization **亦为** `4477` bytes，但 SHA256 `b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d`。**sidecar/pages 拥有 canonical 身份**；相等 size **不是**字节等价；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`ap_ratio`、`immediate_impact_scaffold`；**明确禁止** governed tag `total_ad_ratio`。Total AD **仅**显式出现在 boundary / reason / formula |
| Rank-3 active | 100 mana；90000ms cooldown；immediate primary-champion first-enemy single physical shot-quantum scaffold；每次成功施放恰好一笔非暴击/不可复制物理射击量子 `45 + 0.25 * source.attr.ad.resolved + 0.15 * source.attr.ap.resolved`（**精确嵌套二元 add 树** `add(add(const45, mul(0.25, read totalAD)), mul(0.15, read AP))`；**直接读取 total AD**，**永不**用 resolved−base 推导 bonus AD；伤害类型 **20220** + add 策略 **20170**）；无显式 event op；成功施放自动合成恰好一次 `ability_started`；**零** R state / modifier / listener / matcher / repeat / control / channel / projectile / geometry / multishot / crit 行为 |
| Phase-A 语义框定 | 将 Rank-3 leveling 数值的一次所选施加应用到所选主冠军，作为**有界首个敌人单发物理射击量子**。Immediate impact 为 Phase-A scaffold；**不**建模 channel、recast、射击计数、cadence、几何、弹道或多目标 |
| Standalone | Lucian R provider **独立**；**不**依赖 Lucian Q/W；**不**合成 Batch-B 或 sibling Lucian 机制（P/Q/W/E/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_lucian` / AD / AP / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | baseAD0/resolvedAD0/AP0/armor0 → raw/final45；baseAD60/resolvedAD60/AP0/armor0 → raw/final60；baseAD60/resolvedAD160/AP0/armor0 → raw/final85；baseAD60/resolvedAD160/AP100/armor0 → raw/final100；baseAD60/resolvedAD160/AP100/armor100 → raw100/final50；baseAD60/resolvedAD260/AP200/armor100 → raw140/final70；baseAD0 与 baseAD60 在 resolvedAD160/AP100/armor0 下均 raw/final100（证明 total-AD 直接读取语义） |
| 日程交叉 | mana300 / baseAD60 / resolvedAD160 / AP100 / HP1000 / armor100：t0 / t89999 / t90000 → success / skip / success；恰好两笔 R shot-quantum damage；final mana100 / HP900；两次自动 R `ability_started`；mana99 → resource skip / mana/HP 不变 / 无 R damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion / first-enemy 语义框）结算一次有界单发物理射击量子；不代表完整 The Culling channel、多发、几何或弹道。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| 3-second channel / channel state | 整段 channel 与 channel state 全部排除 |
| 0.75-second / manual / automatic recast | recast 全部排除 |
| 22 base shots / crit-chance shot scaling | 射击计数与暴击缩放全部排除 |
| total channel damage | 整段 channel 总伤害全部排除 |
| cadence / fire rate | 射速/节奏全部排除 |
| direction / range / width | 方向/射程/宽度全部排除 |
| missile offsets / alternating guns / travel / collision / first-enemy geometry / multitarget | 弹道、交替枪口、碰撞、几何与多目标全部排除 |
| minion double | 小兵双倍全部排除 |
| movement / ghosted / facing | 移动、ghosted、facing 全部排除 |
| spell shield | 法术护盾全部排除 |
| interrupts / E usability / Q-W lockout / Thresh / Tahm | 打断与相关交互全部排除 |
| ranks 1–2 | 仅 Rank3 |
| other Lucian abilities / passives | 无 P/Q/W/E/basic 耦合；不依赖 Lucian Q/W；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full The Culling / full-game fidelity | 发布与完整保真不在本闭环；**恰好一发伤害量子**，不是一次完整 R 命中或大招总伤害 |

## 3. 端到端数据流

```text
Wiki lucian-r.json (page1308182/rev4007670；canonical SHA 7a467954…)
  → Backend seed（lol_generic_lucian_the_culling_single_shot_quantum_seed.sql；
     provider_hero_lucian_r_the_culling_single_shot_quantum；
     一笔物理射击量子 45+0.25*totalAD+0.15*AP；嵌套二元 add；type 20220 / add 20170；
     hero_lucian/ad/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 Lucian Q/W 依赖/sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical shot-quantum damage（嵌套二元 45+0.25*ad.resolved+0.15*ap.resolved；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_lucian_the_culling_single_shot_quantum_seed.sql`（SHA256 `6a05ec9df6672593ab403e9edfc5cd81fb5db2bc9e56cb5d70e27832db717c73`）+ `LolGenericLucianTheCullingSingleShotQuantumSeedSqlTest`（SHA256 `c4716cdd9e2b4dbb92fc8fc60d317d947316555e0579e2012e1aed0895b1fea3`）；README `server/data_manage/README.md` SHA256 `21be70f9904abe46ae70e150430635d158f6aaa94f19dbdc83e515260b526702`：独立 `provider_hero_lucian_r_the_culling_single_shot_quantum`；100 mana / 90000ms CD；immediate primary-champion first-enemy single physical shot-quantum scaffold；一笔嵌套二元物理；`hero_lucian`/ad/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/Lucian Q/W/sibling 合成）。owning `a2f5bca2eea8c9d73bb1c3d7325c1815f3a93e2c`（`run-ba1348fd-3713-4cb0-9f43-cb229ef0d011`；runDelta3/outside0；1123 parseable events / 41/41 complete tool groups；无 truncation；Cursor focused9 / adjacent53 / full893 均 PASS）。主 focused9/adjacent53 通过；其首次 full 命中既有瞬时 `LolGenericKogmawLivingArtillerySeedSqlTest` `java.util.regex.StackOverflowError`（884 tests，1 error），随后隔离 Kog'Maw 测试 10/10 与 fresh full 893/893——记为 **nonblocking validation-runtime caveat**，**不是** Lucian R 合同失败。镜像 `d83b09e6a59f60676996928cad99ce502b6b1114`（`run-cd1ae71e-b59b-49b5-8034-c2e65acd5a61`；runDelta3/outside0；511 parseable events / 7/7 complete tool groups；无 truncation；三文件精确 parity 含上述三 hashes）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `ab2d9f7e277930a04698c334c36f6f9f05a3af2e`（`generic_lucian_the_culling_single_shot_quantum_test.go`）；实现 run `run-f15b1fae-6adc-4529-aa02-31a379e750c8`（runDelta1/outside0；1411 parseable events / 68/68 complete tool groups；无 truncation）。主验证：`gofmt` clean；八个 focused top-level Lucian R 测试 PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；标准 TinyGo build PASS；Node smoke PASS；generic benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana300；baseAD60；resolvedAD160；AP100；armor100） | 扣 100 mana；一笔物理射击量子（raw100→final50）；CD 武装；一次 `ability_started` |
| t89999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t90000 再次成功 | 第二次射击量子；两笔 R shot-quantum damage；final mana100；HP1000→900；两次 `ability_started` |
| mana99 | resource skip；mana/HP 不变；无 R damage/event |
| 交叉 baseAD0/resolvedAD0/AP0/armor0 | raw45；final45 |
| 交叉 baseAD60/resolvedAD60/AP0/armor0 | raw60；final60 |
| 交叉 baseAD60/resolvedAD160/AP0/armor0 | raw85；final85 |
| 交叉 baseAD60/resolvedAD160/AP100/armor0 | raw100；final100 |
| 交叉 baseAD60/resolvedAD160/AP100/armor100 | raw100；final50 |
| 交叉 baseAD60/resolvedAD260/AP200/armor100 | raw140；final70 |
| total-AD 直接读取证明 | baseAD0 与 baseAD60 在 resolvedAD160/AP100/armor0 下均 raw/final100 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/依赖 Lucian Q/W/sibling Lucian；禁止把 `total_ad_ratio` 写入 governed tags；禁止把本量子误称为完整 R 命中或大招总伤害 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN v1（无效门控） | `run-b398bd76-6c92-4791-8b92-daf58a5f4c17`；REVISE；禁止 `total_ad_ratio` 的发现已吸收进 v2；但仅 70/71 read-only tool groups 完成（1508 parseable events；runDelta0/diff0；零 truncation）——**不是** valid design gate |
| DESIGN_REVIEW READY（v2） | `run-38f41c33-dd0f-40c3-92e6-1046b9a0c023`；READY；strict `grok-4.5`/high/fast=false；runDelta0/diff0；1237 parseable events / 58/58 complete tool groups；无 truncation；无 blocker/nonblocking/user decision |
| Backend owning | owning `a2f5bca2eea8c9d73bb1c3d7325c1815f3a93e2c`；`run-ba1348fd-3713-4cb0-9f43-cb229ef0d011`（runDelta3/outside0；1123 events / 41/41 complete tool groups；无 truncation）；Cursor focused9 / adjacent53 / full893 均 PASS；主 focused9 + adjacent53 通过；首次 full 瞬时既有 Kog'Maw `StackOverflowError`（884/1 error）后隔离 10/10 + fresh full 893/893——nonblocking validation-runtime caveat，非 Lucian R 合同失败；seed SHA `6a05ec9d…17c73`；JUnit SHA `c4716cdd…1fea3`；README SHA `21be70f9…26702` |
| Backend 镜像（Wasm worktree） | `d83b09e6a59f60676996928cad99ce502b6b1114`；`run-cd1ae71e-b59b-49b5-8034-c2e65acd5a61`（runDelta3/outside0；511 events / 7/7 complete tool groups；无 truncation）；三文件精确 parity 含上述三 hashes |
| Wasm exact | `ab2d9f7e277930a04698c334c36f6f9f05a3af2e`；`run-f15b1fae-6adc-4529-aa02-31a379e750c8`（runDelta1/outside0；1411 events / 68/68 complete tool groups）；gofmt clean；八个 focused top-level + full Go + bench + TinyGo + Node smoke + generic benchmark PASS；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计首次失败（非接受） | 首次 audit launch 在 agent/run 创建前因 `NetworkError: Network request failed` 失败；runDelta0/outside0；空 events/status/tool calls；clean worktree——**不是**接受实现 run |
| 审计接受 | commit `2406a81359d053f88f1199e037ac827a87697d96`；fresh retry `run-eb6578a2-56c4-4490-8c43-635d3a67e041`（strict `grok-4.5`/high/fast=false；runDelta6/outside0；1520/1520 parseable event lines；83/83 tool groups complete；零 truncation）。主会话独立重跑两生成器 checks 加正确命名的 registry 与 Batch-G checks；registry242 仍 migrated48/partial5/blocked120/OOS69；独立证明 G8/Unified key order 稳定，**仅** Lucian R candidate/mechanism 对象变化，Unified coverageRecords 零语义变化，仅三处 source hash 机械刷新 |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated79 / partial4 / blocked90 / OOS69；inScope173；Unified sourceCount12 / total254；completed89 / partial_actionable0 / ready0 / blocked_runtime84 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full89 / partial3 / none162；implementation gap67；actionable0。治理 tasks 必须为 102 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|ap_ratio|immediate_impact_scaffold`；**无** `total_ad_ratio`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。Total AD 仅显式出现在 boundary / reason / formula。

主会话语义比较：ordered keys 242/254 不变；**仅** Lucian R 记录/机制语义变化（metadata source hash / generatedAt 除外）；Unified coverageRecords 零语义变化；仅三处 source hash 机械刷新。Registry / Batch-G / G8 / Unified checks PASS。先前 completed/migrated 记录保持锁定。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：3-second channel/channel state、0.75-second/manual/automatic recast、22 base shots/crit-chance shot scaling、total channel damage、cadence/fire rate、direction/range/width、missile offsets/alternating guns/travel/collision/first-enemy geometry/multitarget、minion double、movement/ghosted/facing、spell shield、interrupts/E usability/Q-W lockout/Thresh/Tahm、ranks1-2、other Lucian abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full The Culling/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 The Culling/游戏技能保真；本闭环**恰好是一发伤害量子**，**不是**一次完整 R 命中或大招总伤害；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Lucian R 为 standalone；**不**依赖 Lucian Q/W；Backend 无 repository-owned `hero_lucian`/AD/AP/mana materializer——仅 external-existing-data/check-only；伤害为 **total AD 直接读取 + AP**（嵌套二元；永不 bonus-AD 减法）；类型 **20220** / add **20170**；governed tags **禁止** `total_ad_ratio`。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308182 / rev4007670 / timestamp2026-04-12T10:40:21Z / canonical raw4477 / SHA256 `7a467954…a2f7`；sidecar/pages canonical；local raw4477 / SHA `b6361228…c74d` materialization caveat——相等 size 非字节等价、非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_lucian\|R\|圣枪洗礼` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一发伤害量子 |
| 公式 / fixtures | 嵌套二元 `45+0.25*totalAD+0.15*AP`；type 20220 / add 20170；无显式 event op；数值与 CD/resource 日程；自动 `ability_started`；零 R state/modifier/listener/matcher/repeat/control/channel/projectile/geometry/multishot/crit；standalone；四 tags 序含 `ap_ratio`、**禁止** `total_ad_ratio`；含 total-AD 直接读取证明 |
| Backend | owning `a2f5bca2…` / 镜像 `d83b09e6…`；focused9 + adjacent53 + full893；Kog'Maw 瞬时 caveat 非合同失败；无 live seed |
| Wasm | exact `ab2d9f7e…`；八个 focused top-level + full Go + bench + TinyGo + Node smoke + generic benchmark；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `2406a813…`；接受 run `run-eb6578a2…`；首次 NetworkError launch 非接受；G8 migrated + 空 remainingGap；Unified completed/full；仅 Lucian R 语义对象变化；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY 仅 `run-38f41c33…`；runDelta0/diff0；1237 events / 58/58 complete tool groups；无 truncation/blocker/nonblocking/user decision；v1 `run-b398bd76…` 无效门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
