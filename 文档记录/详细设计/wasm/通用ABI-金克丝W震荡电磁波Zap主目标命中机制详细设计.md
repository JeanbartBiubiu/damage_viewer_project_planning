TASK_KEY: wasm-generic-jinx-zap-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 金克丝 W 震荡电磁波（Zap!）主目标命中机制详细设计

关联验证记录：[通用 ABI 金克丝 W 震荡电磁波 Zap 主目标命中机制验证记录](../../测试记录/wasm/通用ABI-金克丝W震荡电磁波Zap主目标命中机制验证记录-2026-07-25.md)。本任务将精确候选 `hero_skill|hero_jinx|W|震荡电磁波！` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施法时序、方向/射程/宽度/几何、弹道飞行/碰撞/首敌获取、视野/揭示、减速、其它 rank，或其他金克丝技能/被动/完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV jinx-w-zap-primary-hit-phase-a-v1`（fresh DESIGN_REVIEW_ONLY READY `run-06e10fcf-56e3-4554-a150-c930b284a533`；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1572 event lines / 116 tool events；all calls terminal；无 truncation / mutation / user decision）。Reviewer 非阻塞：仓库无 Jinx identity/AD/mana materializer，故 Backend 为 external-existing-data/check-only；governance peer drift 仅报告；raw G8 stale `blocked_data`/`meta` classification 仅作 provenance，generic classification 已 cleared/migrated。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_jinx\|W\|震荡电磁波！` |
| Wiki | 请求 `Template:Data Jinx/W`，解析为 `Template:Data Jinx/Zap!`；pageId `1307598`；revision `3907092`；timestamp `2025-06-06T17:47:18Z`；canonical raw bytes `1321`；SHA256 `8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/jinx-w.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `1319` bytes / SHA256 `c373cc258c5c8c612930a32c5e851bd4b68dbbcb3c0d7f71ce1d25020ba12624`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`immediate_impact_scaffold` |
| Rank-5 active | 60 mana；4000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `210 + 1.40 * source.attr.ad.resolved`（二元 `add(const 210, mul(const 1.40, read source.attr.ad.resolved))`；**total AD**，直接读 `ad.resolved`，**不得**减 `ad.base`，亦**不得**称为 bonus AD）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** W state / modifier / listener / matcher / repeat / control / projectile / sight / reveal / slow |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模弹道/首敌/减速/揭示 |
| Standalone | Jinx W provider **独立**；**不**合成 Batch-B 或 sibling Jinx 机制（P/Q/E/R/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_jinx` / AD / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | totalAD60 → raw294；armor0=294，armor100=147。totalAD110 → raw364；armor0=364，armor100=182 |
| 日程交叉 | mana180 / HP1000 / AD110 / armor100：t0 / t3999 / t4000 → success / skip / success；恰好两笔 W damage；final mana60 / HP636；两次自动 W `ability_started`；mana59 → resource skip / mana/HP 不变 / 无 W damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算一次有界物理命中；不代表完整 Zap! 弹道、首敌获取、视野揭示或减速。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast timing / Effect at cast time start | 施法时序全部排除 |
| direction / range / width / geometry | 方向、射程、宽度与几何全部排除 |
| projectile / travel / collision / first-enemy acquisition | 弹道、飞行、碰撞与首敌获取全部排除 |
| sight / reveal | 视野与揭示全部排除 |
| slow | 减速幅度/时长/控制全部排除 |
| other ranks | 仅 Rank5 |
| other Jinx abilities / passives / basic | 无 P/Q/E/R/basic 耦合；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki jinx-w.json (page1307598/rev3907092；canonical SHA 8aa6ac39…)
  → Backend seed（lol_generic_jinx_zap_primary_hit_seed.sql；
     provider_hero_jinx_w_zap_primary_hit；
     一笔二元物理伤害 210+1.40*totalAD；
     hero_jinx/ad/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage（binary 210+1.40*ad.resolved）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_jinx_zap_primary_hit_seed.sql`（SHA256 `270F8FC92E55CFCD30E53178D1B542A6EEC985DBDA5736BF65A6599FE3AD4641`）+ `LolGenericJinxZapPrimaryHitSeedSqlTest`（SHA256 `09FA10C32C386AAACB757721DFE3B94C8D0A42A478405C5295D1C8CA8A0EA7E1`）：独立 `provider_hero_jinx_w_zap_primary_hit`；60 mana / 4000ms CD；immediate primary-champion single physical hit scaffold；一笔二元物理；`hero_jinx`/ad/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。owning `b5abdb7`（接受实现 `run-81e20ed5-5fbc-4f0f-95da-44fc76dab540`；runDelta3/outside0；1043 event lines / 123 tool calls；strict；all calls terminal/无 truncation；focused Jinx/Kai'Sa/Draven static SQL **27/27**；owning full Maven **830/830**）。两 earlier fresh attempts 在 mutation 前失败（`run-69dd017b-72a7-49e6-9209-e6018b9432be` init ETIMEDOUT；第二笔 Network request failed）；均 runDelta0，**不是**接受实现。strict smoke `run-6682f603-0a02-49d7-beaf-f78f252cd55b` 恢复 SDK/model 路径。Wasm 集成 `a09adf1`（`run-d143b302-5149-4dc1-9f99-1ee0c5292802`；runDelta3/outside0；1313 event lines / 67 tool calls；strict；无 truncation；两 source hash 与 owning Backend 精确一致；README 仅 +27 行有界 Jinx W 节）。主会话集成新 Jinx JUnit **9/9**；legacy Draven 与 Kai'Sa peer 各保留一笔无关 LF/CRLF-hardcoded `must BEGIN` 失败（本 worktree/`core.autocrlf`）；**不得**主张集成 27/27 或修复那些 peer；owning Backend 27/27 与 full 830/830 仍为权威。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。当前源资产与标准 build 精确同字节/同 SHA（`1,169,377` / `65A4C6F8…C6A0`）；Built 与 Web 源资产同字节/同 SHA；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `2afde02`（`generic_jinx_zap_primary_hit_test.go`）；实现 run `run-8d129133-7766-4fe5-b6fd-d19bc0ab8c2c`（runDelta1/outside0；1364 event lines / 157 tool calls；strict；无 truncation）。主验证：focused JinxZap **6 top-level / 7 named subtests** PASS；`-count=100` PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；`git diff --check` 与 replacement-character check PASS；标准 TinyGo build PASS；Node smoke compile/run/release PASS。Built 与 Web 源资产均 **1,169,377** bytes / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana180；armor100；totalAD110） | 扣 60 mana；一笔物理伤害；CD 武装；一次 `ability_started` |
| t3999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t4000 再次成功 | 第二次命中；两笔 W damage；final mana60；HP1000→636；两次 `ability_started` |
| mana59 | resource skip；mana/HP 不变；无 W damage/event |
| 交叉 totalAD60 | raw294；armor0=294；armor100=147 |
| 交叉 totalAD110 | raw364；armor0=364；armor100=182 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Jinx；禁止将 total AD 误写为 bonus AD |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-06e10fcf-56e3-4554-a150-c930b284a533`；READY；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1572 event lines / 116 tool events；all calls terminal；无 truncation/mutation；无 user decision；非阻塞：external-existing-data/check-only；raw G8 stale classification 仅 provenance |
| Backend owning | owning `b5abdb7`；接受 `run-81e20ed5-5fbc-4f0f-95da-44fc76dab540`（runDelta3/outside0；1043 events / 123 calls；strict；all terminal）；focused Jinx/Kai'Sa/Draven **27/27**；owning full Maven **830/830**；seed SHA `270F8FC9…4641`；JUnit SHA `09FA10C3…A7E1`；两 earlier failed attempts（`run-69dd017b…` / Network failed）非接受；smoke `run-6682f603…` 恢复路径 |
| Backend 集成（Wasm worktree） | `a09adf1`；`run-d143b302-5149-4dc1-9f99-1ee0c5292802`（runDelta3/outside0；1313 events / 67 calls；strict；无 truncation）；两 source hash 精确匹配 owning；README 仅 +27 Jinx W；集成新 Jinx JUnit **9/9**；legacy Draven/Kai'Sa 各一笔无关 CRLF `must BEGIN`；**不得**主张集成 27/27 |
| Wasm exact | `2afde02`；`run-8d129133-7766-4fe5-b6fd-d19bc0ab8c2c`（runDelta1/outside0；1364 events / 157 calls；strict；无 truncation）；6/7 focused + `-count=100` + full Go + bench + TinyGo + Node smoke |
| Web | 无本机制写入；Built/Web 资产保持 `1,169,377` / `65A4…C6A0` 同步不变 |
| 审计 commit | `4549b73`；run `run-527ef39c-d7fe-4f97-91f2-269dac661d5e`（runDelta6/outside0；1092 parseable event lines / 201 tool calls；strict；无 truncation；G8/Unified generate+`--check` PASS；**仅** Jinx W 语义对象变化；242/254 key sets/order/uniqueness 稳定；Xayah W/Q/R canonical object hashes 全部不变：G8 W `dd91a84a1e307ab4540b9d0f422c3715334ecdac3ac01580c5cb04859f6d938f`、Unified W `b03237eb01927cccdfa38f2abacd12f2cf0a17cf0b5bbcde75f06b7870b45ed4`、G8 Q `8305be23180eab1fb0189710defbf546deb1e9bdd0b935119a05ed37dda823ba`、Unified Q `83a2402fd27bf0f2a32d39ce81049b9f4af939333b6519b4532a9703c8fd13a5`、G8 R `0eaf18abcec2ee5a43b60bad60b42594e87f28cf69ded46512d18fd9228906c9`、Unified R `39b10cd4e39794f7cbbd187f4d580b7d48778fa6b5505ceac8d2e505571d4a79`） |
| 最终清单 | G8 242 = migrated72 / partial4 / blocked97 / OOS69；inScope173；Unified sourceCount12 / total254；completed82 / partial_actionable0 / ready0 / blocked_runtime91 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full82 / partial3 / none169；actionable0；`implementation_gap_no_unresolved_data_fields=74`；242/254 keys/order 不变，**仅** Jinx W 语义对象变化。治理 tasks 必须为 95 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段（含历史 `classification=out_of_scope_for_single_target_dps` / `mechanismTags=meta_or_non_target_dps` / `auditBaseline.gapCode=blocked_data`）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Jinx W 记录/机制语义变化（metadata source hash / generatedAt 除外）；Xayah W/Q/R G8/Unified canonical objects 字节语义不变（hashes 见 §5）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast timing、direction/range/width/geometry、projectile/travel/collision/first-enemy acquisition、sight/reveal、slow、other ranks、other Jinx abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Zap!/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Jinx W 为 standalone；Backend 无 repository-owned `hero_jinx`/AD/mana materializer——仅 external-existing-data/check-only；公式使用 **total AD**，不是 bonus AD。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307598 / rev3907092 / timestamp2025-06-06T17:47:18Z / canonical raw1321 / SHA256 `8aa6ac39…3f4d1f`；sidecar/pages canonical；local raw1319 / SHA `c373cc25…ba12624` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_jinx\|W\|震荡电磁波！` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 一笔二元 `210+1.40*totalAD`；数值与 CD/resource 日程；自动 `ability_started`；零 W state/modifier/listener；standalone |
| Backend | owning `b5abdb7` / 集成 `a09adf1`；owning focused 27/27 + full830/830；集成新 Jinx 9/9；legacy CRLF caveat；无 live seed |
| Wasm | exact `2afde02`；focused 6/7；`-count=100`；full Go；bench；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`；Node smoke PASS；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；资产保持同字节/同 SHA 同步不变 |
| 审计 | commit `4549b73`；G8 migrated + 空 remainingGap；Unified completed/full；Xayah W/Q/R hashes 不变；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-06e10fcf…`；非阻塞 external-existing-data/check-only 已吸收 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
