TASK_KEY: wasm-generic-xayah-featherstorm-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 霞 R 暴风羽刃（Featherstorm）主目标伤害量子机制详细设计

关联验证记录：[通用 ABI 霞 R 暴风羽刃 Featherstorm 主目标伤害量子机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_xayah|R|暴风羽刃` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称完整 R 单次总命中 / Wiki-proven once-only、同目标多羽叠加基数、五投射物身份/五次伤害、跃起/ghosted/不可选中、一秒延迟、攻/施法锁、方向锥形射程几何、弹道/多目标、羽毛生成/落地/E 依赖、其它 rank，或完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV xayah-r-featherstorm-primary-hit-phase-a-v2`（fresh DESIGN_REVIEW_ONLY READY `run-4a01857d-8151-416b-95a5-cf62dd8b2769`；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1303 event lines / 86 tool events / 43 calls all terminal；无 truncation / mutation / user decision。v1 `run-b3d8f4b0-37fe-4d6c-8b50-6c20fa945a6c` 因「缺少 per-feather 措辞 ≠ 证明 full-R once-only」返回 REVISE；v2 接受该纠正。**不得**把 v1 当作接受门控）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_xayah\|R\|暴风羽刃` |
| Wiki | 请求 `Template:Data Xayah/R`，解析为 `Template:Data Xayah/Featherstorm`；pageId `1324544`；revision `4008617`；timestamp `2026-04-15T00:26:44Z`；canonical raw bytes `1761`；SHA256 `cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/xayah-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 亦为 `1761` bytes / SHA256 `debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| Rank-3 active | 100 mana；100000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害量子 `400 + 1.00*(source.attr.ad.resolved-source.attr.ad.base)`（嵌套二元 `add`）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** R state / modifier / listener / matcher / repeat / control / projectile / AOE / feather-ground / movement / untargetable |
| Phase-A 语义框定 | 将 leveling-labeled 数值的**一次所选施加**应用到所选主冠军，作为**有界物理伤害量子**。**不**证明 Wiki/完整 R 为 once-only，亦**不**证明完整 Featherstorm 仅有一次总命中；**不**建模或宣称五次伤害操作或同目标多羽基数 |
| W/Q/R 隔离共存 | 保留既有 Deadly Plumage ability-type listener isolation：Backend game-local type `62012` `ability/xayah_deadly_plumage`、W ability type relation、listener `ability_id IS NULL`、exact ALL match types `{20205,20212,62012}`；runtime W ability 带该 type，listener matcher 为 `event/ability_started` + `event/source_owner` + ability type，`ListenerDefinition.AbilityRef` 为空。R 与 Q **从不**武装 W；W 自施放武装 W；R 仍为一量子、Q 仍为双击；definitions/mounts/snapshots 保持区分。Q 是 R seed 的**可选独立 sibling** |
| 数值交叉 | baseAD60 / resolvedAD60 → raw400；armor0=400，armor100=200。resolvedAD110 → raw450；armor0=450，armor100=225 |
| 日程交叉 | mana300 / HP1000 / armor100：t0 / t99999 / t100000 → 两次成功 + 恰好一次 cooldown skip、两笔 R damage-quantum、final mana100 / HP550、两次自动 R `ability_started`；mana99 → resource skip / 不变 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算一次有界物理伤害量子；不代表完整 R 单次总命中、五羽投射、跃起/不可选中、延迟或攻/施法锁。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| multi-feather same-target stacking / cardinality | 同目标多羽叠加与基数全部排除 |
| five projectile identities / five damage ops | 五投射物身份与五次伤害操作全部排除 |
| whole-R once-only / Wiki-proven once-only / one total hit claim | **不得**声称完整 R 仅一次总命中或 Wiki 已证 once-only |
| leap / ghosted / untargetable | 跃起、ghosted、不可选中全部排除 |
| one-second delay | 一秒延迟全部排除 |
| attack / cast lockout | 攻/施法锁全部排除 |
| direction / cone / range / geometry | 方向、锥形、射程与几何全部排除 |
| projectile / travel / collision / multitarget | 弹道、飞行、碰撞与多目标全部排除 |
| feather generation / ground state / E dependency | 羽毛生成、落地与 E 耦合全部排除 |
| other ranks | 仅 Rank3 |
| P / E / basic / equipment / loadout / crit / on-hit | 无其它技能/普攻/装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki xayah-r.json (page1324544/rev4008617；canonical SHA cb5c8ba5…)
  → Backend seed（lol_generic_xayah_featherstorm_primary_hit_seed.sql；
     provider_hero_xayah_r_featherstorm_primary_hit；
     一笔嵌套二元物理伤害量子；W type62012 isolation check-only；
     Q 可选独立 sibling；不物化 identity/panel/resource）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage quantum（nested binary 400+1.00*bonusAD）
    → 自动 ability_started ×1 / 成功施放；保留 W ability-type listener isolation；Q 双击隔离
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_xayah_featherstorm_primary_hit_seed.sql` + `LolGenericXayahFeatherstormPrimaryHitSeedSqlTest`：独立 `provider_hero_xayah_r_featherstorm_primary_hit`；100 mana / 100000ms CD；immediate primary-champion one-quantum scaffold；一笔嵌套二元物理；Xayah/ad/mana 与校正后 W isolation 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不突变 W/Q；不 live-publish）。owning `354fd287`（实现 `run-7443696e-f4f1-4e42-92f5-9a1735a01c3a`；runDelta3/outside0；791 event lines；all calls terminal/无 truncation；focused current R/Q/W static SQL **25/25** = W9+Q8+R8；owning full Maven **821/821**）。较早期望 26 仅为规划计数误差，**不得**当作已通过计数。Wasm 集成 `741e1ff`（`run-dcff2c73-8a7d-4276-9169-154e603dfdad`；runDelta3/outside0；strict；无 truncation；两新 source hash 与 owning Backend 精确一致；README 仅 +39 R 行；focused integrated R/Q/W **25/25**）。Wasm worktree **未**重跑全量 Maven（owning Backend 全量已过；该 peer 有已知无关 legacy CRLF）；**不得**主张 Wasm-worktree 全量 Maven 通过。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。当前源资产与标准 build 精确同字节/同 SHA（`1,169,377` / `65A4C6F8…C6A0`）；Built 与 Web 源资产同字节/同 SHA；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `57ec17c`（`generic_xayah_featherstorm_primary_hit_test.go`）；实现 run `run-9594cfdb-b1b9-4d7f-9035-05205a346832`（runDelta1/outside0；1321 event lines；strict；无 truncation）。主验证：focused XayahFeatherstorm **5 top-level / 11 subcases** PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；标准 TinyGo build PASS；Node smoke compile/run/release PASS。Built 与 Web 源资产均 **1,169,377** bytes / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana300；armor100；resolvedAD110） | 扣 100 mana；一笔物理伤害量子；CD 武装；一次 `ability_started` |
| t99999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t100000 再次成功 | 第二次量子；两笔伤害；final mana100；HP1000→550；两次 `ability_started` |
| mana99 | resource skip；不变 |
| 交叉 baseAD60/resolvedAD60 | raw400；armor0=400；armor100=200 |
| 交叉 resolvedAD110 | raw450；armor0=450；armor100=225 |
| W/Q 共存 | R/Q 成功/skip → 不武装 W；W 自施放 → 仅武装 W；R 仍一量子、Q 仍双击 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止声称 full-R once-only / 五次 ops / 同目标多羽；禁止改变 W/Q 分类或数值/公式/state/modifier 合同 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-4a01857d-8151-416b-95a5-cf62dd8b2769`；READY；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1303 event lines / 86 tool events / 43 calls all terminal；无 truncation/mutation；无 user decision；v1 `run-b3d8f4b0…` REVISE **非**门控 |
| Backend owning | owning `354fd287`；`run-7443696e-f4f1-4e42-92f5-9a1735a01c3a`（runDelta3/outside0；791 events；all terminal）；focused R/Q/W **25/25**；owning full Maven **821/821**；规划计数 26 **不是**通过计数 |
| Backend 集成（Wasm worktree） | `741e1ff`；`run-dcff2c73-8a7d-4276-9169-154e603dfdad`（runDelta3/outside0；strict；无 truncation）；focused R/Q/W **25/25**；README +39 R；**未**重跑全量 Maven |
| Wasm exact | `57ec17c`；`run-9594cfdb-b1b9-4d7f-9035-05205a346832`（runDelta1/outside0；1321 events；strict；无 truncation）；5/11 focused + full Go + bench + TinyGo + Node smoke |
| Web | 无本机制写入；Built/Web 资产保持 `1,169,377` / `65A4…C6A0` 同步不变 |
| 审计 commit | `893298e`；run `run-1513d389-1c07-4a86-8d2c-a233e39c75da`（runDelta6/outside0；1071 events；strict；无 truncation；G8/Unified generate+`--check` PASS；**仅** Xayah R 机制对象变化；Xayah W/Q canonical object hashes 不变：G8 W `dd91a84a1e307ab4540b9d0f422c3715334ecdac3ac01580c5cb04859f6d938f`、Unified W `b03237eb01927cccdfa38f2abacd12f2cf0a17cf0b5bbcde75f06b7870b45ed4`、G8 Q `8305be23180eab1fb0189710defbf546deb1e9bdd0b935119a05ed37dda823ba`、Unified Q `83a2402fd27bf0f2a32d39ce81049b9f4af939333b6519b4532a9703c8fd13a5`） |
| 最终清单 | G8 242 = migrated71 / partial4 / blocked98 / OOS69；Unified sourceCount12 / total254；completed81 / partial_actionable0 / ready0 / blocked_runtime92 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full81 / partial3 / none170；actionable0；`implementation_gap_no_unresolved_data_fields=75`；242/254 keys/order 不变，**仅** Xayah R 语义对象变化。治理 tasks 必须为 94 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Xayah R 记录/机制语义变化（metadata source hash / generatedAt 除外）；Xayah W/Q G8/Unified canonical objects 字节语义不变（hashes 见 §5）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：multi-feather same-target stacking/cardinality、five projectile identities/five damage ops、whole-R once-only/Wiki-proven once-only/one total hit claim、leap/ghosted/untargetable、one-second delay、attack/cast lockout、direction/cone/range/geometry、projectile/travel/collision/multitarget、feather generation/ground/E、other ranks、P/E/basic/equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Featherstorm/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。W isolation 纠正仅为 ability-type listener 隔离，**不**重分类 W，**不**改变 W 的 40 mana / 14000ms / 4000ms / +55% / ×1.25 pipeline 合同；Q 仍为两次命中、独立 sibling。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1324544 / rev4008617 / timestamp2026-04-15T00:26:44Z / canonical raw1761 / SHA256 `cb5c8ba5…5b3077`；sidecar/pages canonical；local raw1761 / SHA `debf23b0…43ace1` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_xayah\|R\|暴风羽刃` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；**必须**保留 no-full-R-once-only 语义框定 |
| 公式 / fixtures | 一笔嵌套二元 `400+1.00*bonusAD`；数值与 CD/resource 日程；自动 `ability_started`；零 R state/modifier/listener；W/Q isolation 共存 |
| Backend | owning `354fd287` / 集成 `741e1ff`；focused R/Q/W 25/25；owning full821/821；Wasm worktree 未重跑全量 Maven；无 live seed；规划 26 非通过计数 |
| Wasm | exact `57ec17c`；focused 5/11；full Go；bench；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`；Node smoke PASS；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；资产保持同字节/同 SHA 同步不变 |
| 审计 | commit `893298e`；G8 migrated + 空 remainingGap；Unified completed/full；W/Q hashes 不变；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-4a01857d…`（v2）；v1 REVISE **非**接受门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
