TASK_KEY: wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 凯特琳 R 让子弹飞（Ace in the Hole）单发子弹量子机制详细设计

关联验证记录：[通用 ABI 凯特琳 R 让子弹飞单发子弹量子机制验证记录](../../测试记录/wasm/通用ABI-凯特琳R-让子弹飞单发子弹量子机制验证记录-2026-07-25.md)。本任务将精确候选 `hero_skill|hero_caitlyn|R|让子弹飞` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 channel/locks/reveal/self-reveal/cancel/refund/short cooldown、homing/projectile travel/interception/first-enemy geometry、crit scaling、untargetable/resurrection/target death/corpse hit/sight radius、unit-target cancel conditions/ability lockout、ranks1-2、其它凯特琳技能/被动、装备/负荷/暴击/on-hit、live migration/publish/E2E，或完整 Ace in the Hole/游戏保真；本闭环**恰好是一次选定目标伤害量子**，**不是**完整 R；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV caitlyn-r-ace-in-the-hole-single-bullet-quantum-phase-a-v1`（有效 DESIGN_READY `run-ad0cf1c5-13d8-4c35-9cae-737f91d865a9`；strict `grok-4.5` / high / fast=false；runDelta0/diff0；1395/1395 parseable event lines / 39/39 complete tool groups；无 truncation / blocker / user decision）。较早审查 `run-ea447e2c-…` 虽返回 READY，但因一个 read-only grep 组未完成——**无效设计门控**，不得称为 valid gate。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_caitlyn\|R\|让子弹飞` |
| Wiki | 请求 `Template:Data Caitlyn/R`，解析为 `Template:Data Caitlyn/Ace in the Hole`；pageId `1306918`；revision `3982561`；timestamp `2026-01-09T09:02:59Z`；canonical raw bytes `3119`；SHA256 `08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/caitlyn-r.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization **亦为** `3119` bytes，但 SHA256 `015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003`。**sidecar/pages 拥有 canonical 身份**；相等 size **不是**字节等价；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| Rank-3 active | 100 mana；90000ms cooldown；immediate selected-primary-champion single physical bullet-quantum scaffold；每次成功施放恰好一笔非暴击/不可复制物理子弹量子 `650 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)`（**精确嵌套二元树**；**显式 bonus AD 减法**；伤害类型 **20220** + add 策略 **20170**）；无显式 event op；成功施放自动合成恰好一次 `ability_started`；**零** R state / modifier / listener / matcher / repeat / control / channel / projectile / geometry / interception / crit 行为 |
| Phase-A 语义框定 | 将 Rank-3 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定目标单发物理子弹量子**。Immediate impact 为 Phase-A scaffold；**不**建模 channel、lock、reveal、homing、弹道、拦截、几何或暴击缩放 |
| Standalone | Caitlyn R provider **独立**；**不**依赖 Caitlyn Q/E；**不**合成 Batch-B 或 sibling Caitlyn 机制（P/Q/W/E/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_caitlyn` / AD / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | base/resolved0/armor0 → raw/final650；base/resolved60/armor0 → raw/final650；base60/resolved160/armor0 → raw/final750；base60/resolved160/armor100 → raw750/final375；base60/resolved260/armor100 → raw850/final425；base0/resolved100 与 base60/resolved160 在 armor0 下均 raw/final750（证明 bonus-AD 减法） |
| 日程交叉 | mana300 / base60 / resolved160 / HP1000 / armor100：t0 / t89999 / t90000 → success / skip / success；恰好两笔 R damage；final mana100 / HP250；两次自动 R `ability_started`；mana99 → resource skip / mana/HP 不变 / 无 R damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界单发物理子弹量子；不代表完整 Ace in the Hole channel、homing、弹道、拦截或暴击缩放。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| channel / locks / reveal / self-reveal / cancel / refund / short cooldown | channel、锁定、揭示、自揭示、取消、退蓝与短 CD 全部排除 |
| homing / projectile travel / interception / first-enemy geometry | 追踪弹、飞行、拦截与首敌几何全部排除 |
| crit scaling | 暴击缩放全部排除 |
| untargetable / resurrection / target death / corpse hit / sight radius | 不可选中、复活、目标死亡、尸体命中与视野半径全部排除 |
| unit-target cancel conditions / ability lockout | 单位目标取消条件与技能 lockout 全部排除 |
| ranks 1–2 | 仅 Rank3 |
| other Caitlyn abilities / passives | 无 P/Q/W/E/basic 耦合；不依赖 Caitlyn Q/E；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full Ace in the Hole / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定目标伤害量子**，不是完整 R |

## 3. 端到端数据流

```text
Wiki caitlyn-r.json (page1306918/rev3982561；canonical SHA 08b488c9…)
  → Backend seed（lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql；
     provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum；
     一笔物理子弹量子 650+1.00*(ad.resolved-ad.base)；嵌套二元；type 20220 / add 20170；
     hero_caitlyn/ad/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 Caitlyn Q/E 依赖/sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical bullet-quantum damage（嵌套二元 650+1.00*(ad.resolved-ad.base)；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql`（SHA256 `e03973598da762eac989f49935407682c834044b9c23ec5a2fddaed8e94c2422`）+ `LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest`（SHA256 `683c8063e8cd76811bce2149ad0e7cf5fc417078af770729dc10647830fbaef6`）；README `server/data_manage/README.md` SHA256 `21b62b869f540b51f47b00851ba464cede8583df682278ff9821b8f5e6ac3e06`：独立 `provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum`；100 mana / 90000ms CD；immediate selected-primary-champion single physical bullet-quantum scaffold；一笔嵌套二元物理；`hero_caitlyn`/ad/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/Caitlyn Q/E/sibling 合成）。owning `f088e1848789f364d011a49cd7078ac391c60051`（`run-6c0e0b4b-5757-4358-9a2d-6d3d64f520d1`；runDelta3/outside0；1235 parseable events / 39/39 complete tool groups；无 truncation；Cursor focused9 / adjacent27 / full902 PASS）。主 focused 与 adjacent 通过；默认 full 两次命中既有隔离 Kog'Maw regex `StackOverflowError`，随后隔离 Kog'Maw 通过且 full 以 `MAVEN_OPTS=-Xss4m` 通过 902/902——记为 **nonblocking validation-runtime caveat**，**不是** Caitlyn R 合同失败。镜像 `486b8d813bfc570a2f117f615e151f36847ba6ca`（`run-99ca9934-57b8-4942-b92a-25f21c6a799f`；runDelta3/outside0；594 parseable events；无 truncation；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `9fc57e74d1de85f4c4390f77168d8488f580af14`（`generic_caitlyn_ace_in_the_hole_single_bullet_quantum_test.go`）；实现 run `run-2235f102-5022-470d-b27b-3268e48bb5cd`（runDelta1/outside0；1137 parseable events；无 truncation）。主验证：`gofmt` clean；focused / full / bench / build / smoke / benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana300；base60；resolved160；armor100） | 扣 100 mana；一笔物理子弹量子（raw750→final375）；CD 武装；一次 `ability_started` |
| t89999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t90000 再次成功 | 第二次子弹量子；两笔 R damage；final mana100；HP1000→250；两次 `ability_started` |
| mana99 | resource skip；mana/HP 不变；无 R damage/event |
| 交叉 base/resolved0/armor0 | raw650；final650 |
| 交叉 base/resolved60/armor0 | raw650；final650 |
| 交叉 base60/resolved160/armor0 | raw750；final750 |
| 交叉 base60/resolved160/armor100 | raw750；final375 |
| 交叉 base60/resolved260/armor100 | raw850；final425 |
| bonus-AD 减法证明 | base0/resolved100 与 base60/resolved160 在 armor0 下均 raw/final750 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/依赖 Caitlyn Q/E/sibling Caitlyn；禁止把本量子误称为完整 R |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN（无效门控） | `run-ea447e2c-…`；READY 返回但一个 read-only grep 组未完成——**不是** valid design gate |
| DESIGN_REVIEW READY | `run-ad0cf1c5-13d8-4c35-9cae-737f91d865a9`；READY；strict `grok-4.5`/high/fast=false；runDelta0/diff0；1395/1395 parseable events / 39/39 complete tool groups；无 truncation；无 blocker/user decision |
| Backend owning | owning `f088e1848789f364d011a49cd7078ac391c60051`；`run-6c0e0b4b-5757-4358-9a2d-6d3d64f520d1`（runDelta3/outside0；1235 events / 39/39 complete tool groups；无 truncation）；Cursor focused9 / adjacent27 / full902 PASS；主 focused+adjacent 通过；默认 full 两次既有 Kog'Maw regex StackOverflow 后隔离通过 + `MAVEN_OPTS=-Xss4m` full 902/902——nonblocking validation-runtime caveat，非 Caitlyn R 合同失败；seed SHA `e0397359…c2422`；JUnit SHA `683c8063…baef6`；README SHA `21b62b86…c3e06` |
| Backend 镜像（Wasm worktree） | `486b8d813bfc570a2f117f615e151f36847ba6ca`；`run-99ca9934-57b8-4942-b92a-25f21c6a799f`（runDelta3/outside0；594 events；无 truncation）；精确 parity |
| Wasm exact | `9fc57e74d1de85f4c4390f77168d8488f580af14`；`run-2235f102-5022-470d-b27b-3268e48bb5cd`（runDelta1/outside0；1137 events；无 truncation）；gofmt clean；focused/full/bench/build/smoke/benchmark PASS；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `6e76d47d314dc31d5b41bcfd21c71d93a3a74758`；`run-8f6d09b6-0dae-49fd-9fc8-cfa47bdb689c`（strict model；runDelta8/outside0；1292/1292 parseable；87/87 complete tool groups；零 truncation）。主会话重跑 G8/Unified/Wiki/Batch-G/provisional checks；独立证明仅 Caitlyn R 语义 G8/Unified 变化、稳定 key order/digests，provisional **仅**移除 Caitlyn R |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated80 / partial4 / blocked89 / OOS69；inScope173；Unified sourceCount12 / total254；completed90 / partial_actionable0 / ready0 / blocked_runtime83 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full90 / partial3 / none161；implementation gap66；actionable0；provisional86（runtime83/data3；hero84/item2）。治理 tasks 必须为 104 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Caitlyn R 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Caitlyn R（87→86）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：channel/locks/reveal/self-reveal/cancel/refund/short cooldown、homing/projectile travel/interception/first-enemy geometry、crit scaling、untargetable/resurrection/target death/corpse hit/sight radius、unit-target cancel conditions/ability lockout、ranks1-2、other Caitlyn abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full Ace in the Hole/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Ace in the Hole/游戏技能保真；本闭环**恰好是一次选定目标伤害量子**，**不是**完整 R；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Caitlyn R 为 standalone；**不**依赖 Caitlyn Q/E；Backend 无 repository-owned `hero_caitlyn`/AD/mana materializer——仅 external-existing-data/check-only；伤害为 **bonus AD 显式减法**（嵌套二元）；类型 **20220** / add **20170**。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1306918 / rev3982561 / timestamp2026-01-09T09:02:59Z / canonical raw3119 / SHA256 `08b488c9…e8a8`；sidecar/pages canonical；local raw3119 / SHA `015c1dbe…5003` materialization caveat——相等 size 非字节等价、非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_caitlyn\|R\|让子弹飞` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定目标伤害量子 |
| 公式 / fixtures | 嵌套二元 `650+1.00*(ad.resolved-ad.base)`；type 20220 / add 20170；无显式 event op；数值与 CD/resource 日程；自动 `ability_started`；零 R state/modifier/listener/matcher/repeat/control/channel/projectile/geometry/interception/crit；standalone；四 tags 序含 `bonus_ad_ratio`；含 bonus-AD 减法证明 |
| Backend | owning `f088e184…` / 镜像 `486b8d81…`；focused9 + adjacent27 + full902；Kog'Maw StackOverflow + `-Xss4m` caveat 非合同失败；无 live seed |
| Wasm | exact `9fc57e7…`；gofmt + focused/full/bench/build/smoke/benchmark；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `6e76d47…`；接受 run `run-8f6d09b6…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Caitlyn R 语义对象变化；provisional 仅移除 Caitlyn R；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY 仅 `run-ad0cf1c5…`；runDelta0/diff0；1395/1395 events / 39/39 complete tool groups；无 truncation/blocker/user decision；较早 `run-ea447e2c…` 无效门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
