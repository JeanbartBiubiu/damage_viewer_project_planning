TASK_KEY: wasm-generic-lucian-ardent-blaze-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 卢锡安 W 热诚烈弹（Ardent Blaze）主目标命中机制详细设计

关联验证记录：[通用 ABI 卢锡安 W 热诚烈弹主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_lucian|W|热诚烈弹` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施法时序与 Effect at cast time end、方向/射程/获取、导弹/飞行/碰撞、十字/爆炸几何、多目标/AOE、视野、6 秒标记、移速及其 rank 值、友方触发/Vigilance、闪避/格挡/致盲/持续伤害、法术护盾标记例外、其它 rank，或其他卢锡安技能/被动/完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV lucian-w-ardent-blaze-primary-hit-phase-a-v1`（有效 DESIGN_READY `run-d01cb420-6623-421e-9a39-b81e7322de9f`；strict `grok-4.5` / high / fast=false；runDelta0/diff0；1294 parseable event lines / 54 complete tool groups；无 truncation / blocker / nonblocking / user decision）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_lucian\|W\|热诚烈弹` |
| Wiki | 请求 `Template:Data Lucian/W`，解析为 `Template:Data Lucian/Ardent Blaze`；pageId `1308178`；revision `3594941`；timestamp `2023-09-12T19:08:23Z`；canonical raw bytes `2542`；SHA256 `b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/lucian-w.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization **亦为** `2542` bytes，但 SHA256 `a57b0e49765ab5a9bdd30ad295d24e406a90015b083c8a0e817855c6bc152236`。**sidecar/pages 拥有 canonical 身份**；相等 size **不是**字节等价；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold` |
| Rank-5 active | 60 mana；10000ms cooldown；immediate primary-champion single magic hit scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `215 + 0.90 * source.attr.ap.resolved`（伤害类型 **20221** + add 策略 **20170**）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** W state / modifier / listener / geometry / AOE / mark / movement-speed 行为 |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界主目标单次魔法命中**。Immediate impact 为 Phase-A scaffold；**不**建模施法时序、Effect at cast time end、方向/射程、导弹/碰撞、十字/爆炸几何、多目标/AOE、视野、标记、移速、友方触发/Vigilance |
| Standalone | Lucian W provider **独立**；**不**依赖 Lucian Q；**不**合成 Batch-B 或 sibling Lucian 机制（P/Q/E/R/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_lucian` / AP / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | AP0/MR0 → raw/final215；AP0/MR100 → raw215/final107.5；AP100/MR0 → raw/final305；AP100/MR100 → raw305/final152.5；AP200/MR100 → raw395/final197.5 |
| 日程交叉 | mana180 / AP100 / HP1000 / MR100：t0 / t9999 / t10000 → success / skip / success；恰好两笔 W damage；final mana60 / HP695；两次自动 W `ability_started`；mana59 → resource skip / mana/HP 不变 / 无 W damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算一次有界单次魔法命中；不代表完整 Ardent Blaze 施法时序、导弹、十字/爆炸几何、标记、移速或友方触发。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast timing / Effect at cast time end | 施法时序与 Wiki Effect-at-cast-time-end 全部排除 |
| direction / range / acquisition | 方向、射程与目标获取全部排除 |
| missile / travel / collision | 导弹、飞行与碰撞全部排除 |
| cross / explosion geometry | 十字与爆炸几何全部排除 |
| multitarget / AOE | 多目标与 AOE 全部排除 |
| sight | 视野全部排除 |
| 6-second mark | 6 秒标记全部排除 |
| movement speed and its rank values | 移速及其 rank 数值全部排除 |
| allied trigger / Vigilance | 友方触发与 Vigilance 全部排除 |
| dodge / block / blind / persistent damage | 闪避、格挡、致盲与持续伤害全部排除 |
| spell-shield mark exception | 法术护盾标记例外全部排除 |
| other ranks | 仅 Rank5 |
| other Lucian abilities / passives / basic | 无 P/Q/E/R/basic 耦合；不依赖 Lucian Q；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full Ardent Blaze / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki lucian-w.json (page1308178/rev3594941；canonical SHA b1ea7bc7…)
  → Backend seed（lol_generic_lucian_ardent_blaze_primary_hit_seed.sql；
     provider_hero_lucian_w_ardent_blaze_primary_hit；
     一笔魔法伤害 215+0.90*AP；type 20221 / add 20170；
     hero_lucian/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 Lucian Q 依赖/sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage（215+0.90*ap.resolved；20221/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_lucian_ardent_blaze_primary_hit_seed.sql`（SHA256 `e9f8f30ab7055300c038fc1ae25460e430a943fb9d2cb4c19f0ba5b489573942`）+ `LolGenericLucianArdentBlazePrimaryHitSeedSqlTest`（SHA256 `8f5ca7ab895f75d42b1583e18d3745ea25e566bc7e545780fe01375cd0e95466`）；README SHA256 `54f0dfcafea5750d23dd236b7d3182b484468fd9c3548842b593167afcf92396`：独立 `provider_hero_lucian_w_ardent_blaze_primary_hit`；60 mana / 10000ms CD；immediate primary-champion single magic hit scaffold；一笔魔法；`hero_lucian`/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/Lucian Q/sibling 合成）。owning `2b29c4e47f9c62bad72cfebf230d52c8a8cf15a2`（`run-b2d06b00-c547-42b1-956b-968cd0689deb`；runDelta3/outside0；1180 parseable events / 45 complete tool groups；无 truncation；Cursor focused9 / adjacent36 / full884 均 PASS；主独立重跑 focused9、adjacent Lucian W + Lucian Q + Caitlyn E + Graves W（各 9）与 full884，failures/errors/skips0）。镜像 `7e8a40c22ac0930f421490eeb5d7c8157ae9c2c6`（`run-5fa6889a-56d7-4348-8397-58a8da0baa22`；runDelta3/outside0；669 parseable events / 6 complete tool groups；无 truncation；三文件精确 parity 含上述三 hashes）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `d57dc3bda5377133ca6ccb7322f4afca9292e6c7`（`generic_lucian_ardent_blaze_primary_hit_test.go`）；实现 run `run-5f46f27b-b774-4452-8c55-7510ca868b12`（runDelta1/outside0；1052 parseable events / 58 complete tool groups；无 truncation）。主验证：`gofmt` clean；七个 focused top-level Lucian W 测试 PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；标准 TinyGo build PASS；Node smoke PASS；generic benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit。Cursor 曾从仓库根目录误发一笔 verbose focused 命令（工作目录错误/无匹配输出）——立即纠正至 `wasm/tinygo_engine_v2` 后全部通过；记为 **nonblocking validation-invocation note**，**不是**实现失败 |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana180；AP100；MR100） | 扣 60 mana；一笔魔法伤害（raw305→final152.5）；CD 武装；一次 `ability_started` |
| t9999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t10000 再次成功 | 第二次命中；两笔 W damage；final mana60；HP1000→695；两次 `ability_started` |
| mana59 | resource skip；mana/HP 不变；无 W damage/event |
| 交叉 AP0/MR0 | raw215；final215 |
| 交叉 AP0/MR100 | raw215；final107.5 |
| 交叉 AP100/MR0 | raw305；final305 |
| 交叉 AP100/MR100 | raw305；final152.5 |
| 交叉 AP200/MR100 | raw395；final197.5 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/依赖 Lucian Q/sibling Lucian；禁止把魔法类型误写为物理 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-d01cb420-6623-421e-9a39-b81e7322de9f`；READY；strict `grok-4.5`/high/fast=false；runDelta0/diff0；1294 parseable events / 54 complete tool groups；无 truncation；无 blocker/nonblocking/user decision |
| Backend owning | owning `2b29c4e47f9c62bad72cfebf230d52c8a8cf15a2`；`run-b2d06b00-c547-42b1-956b-968cd0689deb`（runDelta3/outside0；1180 events / 45 complete tool groups；无 truncation）；Cursor focused9 / adjacent36 / full884 均 PASS；主 focused9 + adjacent Lucian W/Q + Caitlyn E + Graves W（各 9）+ full884 failures/errors/skips0；seed SHA `e9f8f30a…3942`；JUnit SHA `8f5ca7ab…5466`；README SHA `54f0dfca…2396` |
| Backend 镜像（Wasm worktree） | `7e8a40c22ac0930f421490eeb5d7c8157ae9c2c6`；`run-5fa6889a-56d7-4348-8397-58a8da0baa22`（runDelta3/outside0；669 events / 6 complete tool groups；无 truncation）；三文件精确 parity 含上述三 hashes |
| Wasm exact | `d57dc3bda5377133ca6ccb7322f4afca9292e6c7`；`run-5f46f27b-b774-4452-8c55-7510ca868b12`（runDelta1/outside0；1052 events / 58 complete tool groups）；gofmt clean；七个 focused top-level + full Go + bench + TinyGo + Node smoke + generic benchmark PASS；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；根目录误 cwd focused 失败已纠正——nonblocking invocation note |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `98fb3e8d73780aeda8a5307a76cba57a939794e4`；`run-ddd6a776-69d0-4500-8bef-5c5c795b4dd6`（strict `grok-4.5`/high/fast=false；runDelta6/outside0；1469 parseable event lines / 81/81 tool groups with completed event；零 truncation）。主会话独立重跑两生成器 checks 加 registry 与 Batch-G checks；registry242 仍 migrated48/partial5/blocked120/OOS69；独立证明 G8/Unified key order 稳定，**仅** Lucian W candidate/mechanism 对象变化，Unified coverageRecords 零语义变化，仅三处 source hash 机械刷新 |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated78 / partial4 / blocked91 / OOS69；inScope173；Unified sourceCount12 / total254；completed88 / partial_actionable0 / ready0 / blocked_runtime85 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full88 / partial3 / none163；implementation gap68；actionable0。治理 tasks 必须为 101 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Lucian W 记录/机制语义变化（metadata source hash / generatedAt 除外）；Unified coverageRecords 零语义变化；仅三处 source hash 机械刷新。Registry / Batch-G / G8 / Unified checks PASS。先前 completed/migrated 记录保持锁定。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast timing / Effect at cast time end、direction/range/acquisition、missile/travel/collision、cross/explosion geometry、multitarget/AOE、sight、6-second mark、movement speed and its rank values、allied trigger/Vigilance、dodge/block/blind/persistent damage、spell-shield mark exception、other ranks、other Lucian abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full Ardent Blaze/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Ardent Blaze/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Lucian W 为 standalone；**不**依赖 Lucian Q；Backend 无 repository-owned `hero_lucian`/AP/mana materializer——仅 external-existing-data/check-only；伤害为 **AP** 直接读取；类型 **20221** / add **20170**。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308178 / rev3594941 / timestamp2023-09-12T19:08:23Z / canonical raw2542 / SHA256 `b1ea7bc7…418c5`；sidecar/pages canonical；local raw2542 / SHA `a57b0e49…2236` materialization caveat——相等 size 非字节等价、非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_lucian\|W\|热诚烈弹` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 一笔 `215+0.90*AP`；type 20221 / add 20170；无显式 event op；数值与 CD/resource 日程；自动 `ability_started`；零 W state/modifier/listener/geometry/AOE/mark/movement-speed；standalone；四 tags 序含 `ap_ratio` |
| Backend | owning `2b29c4e4…` / 镜像 `7e8a40c2…`；focused9 + adjacent + full884；无 live seed |
| Wasm | exact `d57dc3bd…`；七个 focused top-level + full Go + bench + TinyGo + Node smoke + generic benchmark；无生产 Wasm/Web 写入；根目录误 cwd 为 nonblocking invocation note |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `98fb3e8d…`；接受 run `run-ddd6a776…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Lucian W 语义对象变化；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY 仅 `run-d01cb420…`；runDelta0/diff0；1294 events / 54 complete tool groups；无 truncation/blocker/nonblocking/user decision |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
