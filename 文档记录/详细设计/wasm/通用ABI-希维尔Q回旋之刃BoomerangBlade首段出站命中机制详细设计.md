TASK_KEY: wasm-generic-sivir-boomerang-blade-first-outbound-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 希维尔 Q 回旋之刃（Boomerang Blade）首段出站命中机制详细设计

关联验证记录：[通用 ABI 希维尔 Q 回旋之刃 Boomerang Blade 首段出站命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_sivir|Q|回旋之刃` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 cast time、bonus attack speed、direction/range/width/geometry、projectile/travel/speed、nonchampion hit reduction、return pass、damage modifier reset、once-per-pass、spellshield、ranks1–4、siblings/loadout/bootstrap、live/Admin/E2E，或完整 Boomerang Blade/游戏保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV sivir-q-boomerang-blade-first-outbound-hit-phase-a-v3`（正式最终 DESIGN_READY `run-4db83782-b7af-4a56-8a75-2b687cc456a4`；runDelta0；2099 parseable events；61/61 groups；无 truncation / mutation；无 user decision。先前 v1 `run-a0605b7c-b2d4-4357-817c-05124931df2a` 为 **valid REVISE**：runDelta0；2226 parseable events；63/63 groups；无 truncation/mutation；接受 issue——DB attr min/max 不被 generic formula reads 应用，且 seed 未证明 bounds。v2 `run-fd9c2756-24b5-47fb-b1f0-8ba14511ba42` 为 **valid REVISE**：runDelta0；2199 parseable events；46/46 groups；无 truncation/mutation；接受 issue——缺失 formula attrs 读零，故不得主张 fail-closed。**v3 为正式最终 READY 门控**。Production Wasm / public ABI / Web 变更**不**需要）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_sivir\|Q\|回旋之刃` |
| Wiki | 请求 `Template:Data Sivir/Q`，解析为 `Template:Data Sivir/Boomerang Blade`；pageId `1308837`；revision `4016378`；timestamp `2026-05-11T05:05:57Z`；canonical raw bytes `2745`；SHA256 `0adcf3916b63e8b0ae6c2c7ad74d1796e3362a3a22682c58ef92aaccfae43e5e`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/sivir-q.json` bytes `3018` / SHA256 `2320f7ada83cceee979c52cd314395c6b41e2f50c50e3114e9bca0d39386ff02` plus pages sibling bytes `691` / SHA256 `adeab85889a4208b52f0b6cd3bcc3aef022a986dcad5168e1c817e3ab3323fa9` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2745` bytes，SHA256 `b8d46412519f211b27f2575684693f407806cbbca337a80e775a1baf4c2396a4`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`ap_ratio`、`crit_scaling`、`immediate_impact_scaffold`（G8 override **保留本任务序**；Unified canonical 输出按集合排序时 `ap_ratio` 先于 `bonus_ad_ratio`——**同一精确 membership**，**不得**把 Unified 排序描述为语义差异；**无** completed salvage tag） |
| Rank-5 active | 75 mana；**immediate cooldown scaffold 8000ms**；immediate selected-primary champion first-outbound-pass single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理命中 `(160 + 0.70 * (ad.resolved - ad.base) + 0.60 * ap.resolved) * (1 + 0.40 * min(1, max(0, crit_chance.resolved)))`（**精确嵌套 generic 公式**；每条 read path **恰好一次**；**formula-local** crit clamp——因 generic formula reads **不**应用 DB attribute bounds；缺失 formula attrs 当前读零，**不得**主张 fail-closed；伤害类型 **20220** + add 策略 **20170**；**无** 20230 executable；**无**显式 event op；**无** Q-specific type）；成功施放自动合成恰好一次 `ability_started`；**零** Q state / modifier / listener / matcher / repeat / control / projectile |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定主目标首段出站单次物理命中**。Immediate impact **与** immediate cooldown scaffold 均为 Phase-A scaffold；**不**建模 cast/bonus AS/direction/range/geometry/projectile/return/once-per-pass，或完整 Q 保真 |
| Standalone | Sivir Q provider **独立**；**不**合成 P/W/E/R/basic / siblings / loadout / bootstrap |
| Backend 前置 | `hero_sivir` / ad / ap / crit_chance / mana 为 **external existing-data/check-only**；seed **不**物化 identity/panel/resource values；仓库**无** Sivir materializer；**不** live-publish。Wasm fixtures **定义** crit_chance |
| 数值交叉 | armor100：raw290/348/406 → final145/174/203（含 negative/overcap crit clamp 与 bonusAD/AP counterproof：crit−0.25→clamps0 raw290/final145；crit1.25→clamps1 raw406/final203；base0/resolved100 vs base60/resolved160 at AP100/crit0 both290/145；AP0 vs AP100 at bonusAD100/crit0 raw230 vs290） |
| 日程交叉 | mana225 / HP1000 / armor100（crit0.5）：t0 / t7999 / t8000 → success / skip / success；恰好两笔 Q damage；两次自动 Q `ability_started`；final mana75 / HP652；mana74 at t0 → resource skip，mana/HP 不变，无 Q damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact **与** immediate 8000ms cooldown scaffold 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界首段出站单次物理命中，并武装 immediate CD scaffold；不代表完整 Boomerang Blade 弹道、回程、非英雄削减或 once-per-pass。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| cast time / bonus attack speed | 施法时间与额外攻速全部排除 |
| direction / range / width / geometry | 方向、射程、宽度与几何全部排除 |
| projectile / travel / speed | 弹道、飞行与速度全部排除 |
| nonchampion hit reduction | 非英雄命中削减排除 |
| return pass / damage modifier reset | 回程与伤害修正重置全部排除 |
| once-per-pass / spellshield | 每段一次与法术护盾全部排除 |
| ranks 1–4 | 仅 Rank5 |
| siblings / loadout / bootstrap | 无 sibling 合成；无负荷/bootstrap |
| live migration / Admin publish / browser E2E / full Q / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标首段出站物理命中**，不是完整 Q |

## 3. 端到端数据流

```text
Wiki sivir-q.json (page1308837/rev4016378；canonical SHA 0adcf391…)
  → Backend seed（lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql；
     provider_hero_sivir_q_boomerang_blade_first_outbound_hit；
     一笔物理命中 (160+0.70*bonusAD+0.60*AP)*(1+0.40*clamp01(crit))；
     精确嵌套；每条 read path 恰好一次；formula-local crit clamp；
     type 20220 / add 20170；无 20230；无显式 event；无 Q-specific type；
     hero_sivir/ad/ap/crit_chance/mana external-existing-data/check-only；
     不物化 identity/panel/resource；无 Sivir materializer；standalone Q）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/immediate-cooldown-scaffold → null-duration impact + on_enter sequence
    → 一笔 physical first-outbound-pass damage（嵌套公式；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql`（bytes `32326`；SHA256 `4ba04a00c1d67a67fd581eaa1cd4edfbb08eeb9699d9e3c8da8eed3f03dbf189`）+ `LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest`（bytes `63624`；SHA256 `2f3368a98b132065be78b184230c3afa0b48c7f0d3db387061ab909b631e467a`）；README `server/data_manage/README.md` bytes `299113` / SHA256 `913c80f677df682e258bd371be7941b80893f5566c83617b68efc6ea7fb6cf95`（owning commit 处）：独立 `provider_hero_sivir_q_boomerang_blade_first_outbound_hit`；75 mana / immediate 8000ms CD scaffold；immediate selected-primary champion first-outbound-pass single physical hit scaffold；精确嵌套公式 + formula-local crit clamp；`hero_sivir`/ad/ap/crit_chance/mana **external-existing-data/check-only**（不物化 identity/panel/resource；无 Sivir materializer；不 live-publish；standalone）。owning `3ded9cb6f9cbeb020fd343c24402a7126290a79b`（`run-98d9646e-2360-499d-a12c-83e777d115e3`；runDelta3/outside0；主 focused64/64 + full Maven1023/1023 PASS）。镜像 `b14c48f700fa2806eb6738bd1a474f06d2e95807`（`run-9b7da61c-19eb-4be2-b8dd-0ff4b74a3481`；runDelta3/outside0；6/6 complete groups；精确 parity；Sivir JUnit13/13 PASS）。Combined mirror focused suite 另暴露**既有** sibling Essence Reaver 与 Twisted Fate `must BEGIN` 失败——**无关 caveat**，本闭环**未**修复亦**未**隐藏。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮不变。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。Production Wasm/public ABI/Web 变更**不**需要 |
| Wasm | exact `bff4d16012980747b93a1264537e0f40dfb9f3dd`（`generic_sivir_boomerang_blade_first_outbound_hit_test.go`；test bytes `79086` / SHA256 `77a27da736577acc9a1bfd6728472a2b84c6a07353314528b115b112b917cc44`）；实现 run `run-5834425f-e0d2-497b-8c40-b32406696cba`（runDelta1/outside0）。主验证：focused ten top-level、count100、full Go、Go bench、标准 TinyGo build、Node smoke/bench PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无**生产/Web 写入。英雄名 `_test.go` **仅为**机制级回归/治理证据，**排除**于生产构建；仅构造 generic provider/ability/operation/formula 合同；**无**英雄专用生产 runtime 分支或 public ABI 变更——**不**损害 generic runtime 实现主张 |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana225；crit0.5；armor100） | 扣 75 mana；一笔物理命中（raw348→final174）；immediate 8000ms CD scaffold 武装；一次 `ability_started` |
| t7999（CD scaffold 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t8000 再次成功 | 第二次物理命中；两笔 Q damage；两次 `ability_started`；final mana75；HP1000→652 |
| mana74 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 crit0 / armor100 | raw290；final145 |
| 交叉 crit0.5 / armor100 | raw348；final174 |
| 交叉 crit1 / armor100 | raw406；final203 |
| negative/overcap clamp | crit−0.25→raw290/final145；crit1.25→raw406/final203 |
| bonusAD / AP counterproof | both290/145；raw230 vs290 |
| Standalone | 仅挂载本独立 Q；不合成 P/W/E/R/basic |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止主张 DB bounds 由 formula reads 应用或缺失 attr fail-closed；禁止引入 Q-specific type；禁止把本首段出站命中误称为完整 Q |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | 正式最终 READY `run-4db83782-b7af-4a56-8a75-2b687cc456a4`；runDelta0；2099 parseable events；61/61 groups；无 truncation/mutation；无 user decision。v1 `run-a0605b7c…` valid REVISE（2226；63/63；delta0；DB bounds / seed 未证明 bounds 已接受）。v2 `run-fd9c2756…` valid REVISE（2199；46/46；delta0；缺失 attrs 读零、不得 fail-closed 已接受）。**v3 为正式最终门控** |
| Backend owning | owning `3ded9cb6f9cbeb020fd343c24402a7126290a79b`；`run-98d9646e-2360-499d-a12c-83e777d115e3`（runDelta3/outside0）；主 focused64/64 + full Maven1023/1023 PASS；seed bytes32326 / SHA `4ba04a00…dbf189`；JUnit bytes63624 / SHA `2f3368a9…e467a`；README bytes299113 / SHA `913c80f6…b6cf95` |
| Backend 镜像（Wasm worktree） | `b14c48f700fa2806eb6738bd1a474f06d2e95807`；`run-9b7da61c-19eb-4be2-b8dd-0ff4b74a3481`（runDelta3/outside0；6/6 complete groups；精确 parity；Sivir JUnit13/13 PASS）。Combined mirror focused suite 另暴露既有 sibling Essence Reaver / Twisted Fate `must BEGIN` 失败——无关 caveat，未修复/未隐藏 |
| Wasm exact | `bff4d16012980747b93a1264537e0f40dfb9f3dd`；`run-5834425f-e0d2-497b-8c40-b32406696cba`（runDelta1/outside0）；focused ten top-level、count100、full Go、Go bench、TinyGo build、Node smoke/bench PASS；test bytes79086 / SHA `77a27da7…917cc44`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无生产/Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据（排除生产构建；仅 generic 合同路径） |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0`；Production Wasm/public ABI/Web 变更不需要 |
| 审计接受 | 首次审计 `run-de678bf0-0186-4918-8bd2-186650d097ea` 在部分允许编辑后因 SDK HTTP/2 CANCEL 崩溃——**不**作接受证据。新鲜恢复 `run-9f321848-663f-4058-a3b1-7243bfc79728` 完成 delta8/outside0；parseable 1590-line event log；无 truncation；主五检查 PASS；语义比较证明**仅** Sivir Q 在 G8/Unified 变化，且 provisional **仅**移除 Sivir Q；keys/order 稳定。接受审计 commit `6e8b55c3b32decff67a908ada5613af13306c5c6` |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated91 / partial4 / blocked78 / OOS69；inScope173；Unified sourceCount12 / total254；completed101 / partial_actionable0 / ready0 / blocked_runtime72 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full101 / partial3 / none150；implementation gap57；actionable0；provisional75（runtime72/data3；hero73/item2）。治理 tasks 必须为 115。报告口径：严格 verified completion **101/254=39.8%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 75 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张。稳定 digests：Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki registry `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7` |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（**任务序**：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|ap_ratio|crit_scaling|immediate_impact_scaffold`）、空 `remainingGap`。Unified canonical 输出将 membership 排序为 `…|ap_ratio|bonus_ad_ratio|…`——**同一集合**，**不是**语义差异。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Sivir Q 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Sivir Q（76→75）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。`implementation_gap_no_unresolved_data_fields` **降至 57**（Sivir Q **离开**该家族）。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only / 机制级回归证据追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。Production Wasm/public ABI/Web 变更**不**需要。

非目标（再次强调）：cast time、bonus attack speed、direction/range/width/geometry、projectile/travel/speed、nonchampion hit reduction、return pass、damage modifier reset、once-per-pass、spellshield、ranks1-4、siblings/loadout/bootstrap、live migration/Admin publish/browser E2E/full Q/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Boomerang Blade/游戏技能保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Sivir Q 为 standalone；Backend external-existing-data/check-only；公式为 **bonus AD 显式减法 + AP + formula-local crit clamp**；类型 **20220** / add **20170**；无 20230；无 Q-specific type；不得主张 DB bounds 由 formula reads 应用或缺失 attr fail-closed；英雄名 `_test.go` 排除于生产构建且仅走 generic 合同路径——**不**损害 generic runtime 实现主张。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308837 / rev4016378 / timestamp2026-05-11T05:05:57Z / canonical raw2745 / SHA256 `0adcf391…e43e5e`；normalized3018 / SHA `2320f7ad…86ff02`；pages691 / SHA `adeab858…323fa9`；sidecar/pages canonical；local raw2745 / SHA `b8d46412…2396a4` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_sivir\|Q\|回旋之刃` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标首段出站物理命中 |
| 公式 / fixtures | 精确嵌套 `(160+0.70*(ad.resolved-ad.base)+0.60*ap.resolved)*(1+0.40*min(1,max(0,crit_chance.resolved)))`；每条 read path 恰好一次；formula-local crit clamp；type 20220 / add 20170；无 20230；无显式 event op；无 Q-specific type；数值与 CD/resource 日程；自动 `ability_started`；standalone；六 tags 任务序（Unified 排序非语义差异）；含 clamp/counterproof |
| Backend | owning `3ded9cb…` / 镜像 `b14c48f…`；focused64 + full1023；external check-only；无 live seed；镜像 sibling caveat 诚实记录 |
| Wasm | exact `bff4d16…`；focused ten / count100 / full / bench / build / smoke；英雄名 `_test.go` 仅测试/治理身份；无生产 Wasm/Web/ABI 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA；Production 变更不需要 |
| 审计 | 接受 commit `6e8b55c…`；恢复 run `run-9f321848…`；崩溃首审计不作证据；G8 migrated + 空 remainingGap；Unified completed/full；仅 Sivir Q 语义对象变化；provisional 仅移除 Sivir Q；counts 与 §5 最终清单一致；implementation_gap 57 |
| 设计门控 | 正式最终 READY `run-4db83782…`；2099 events / 61/61；runDelta0；无 truncation/mutation；无 user decision；v1/v2 REVISE 校正已接受 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
