TASK_KEY: wasm-generic-jhin-deadly-flourish-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 烬 W 致命华彩（Deadly Flourish）主目标命中机制详细设计

关联验证记录：[通用 ABI 烬 W 致命华彩 Deadly Flourish 主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_jhin|W|致命华彩` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施法时序、方向/射程/宽度/线几何/多目标/冠军碰撞、弹道/拦截/法术护盾/朝向、标记创建/检测/时长、禁锢/控制/韧性、移速加成、小兵减伤、其它 rank，或其他烬技能/被动/完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV jhin-w-deadly-flourish-primary-hit-phase-a-v1`（fresh DESIGN_REVIEW_ONLY READY `run-619cf912-b707-4dfa-95d1-eb4125b28921`；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1351 parseable event lines / 66 tool calls；无 truncation / mutation / user decision）。Reviewer 非阻塞已接受：仓库无 Jhin identity/AD/mana materializer，故 Backend 为 external-existing-data/check-only；local raw caveat only；raw G8 OOS/meta provenance 仅作历史输入。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_jhin\|W\|致命华彩` |
| Wiki | 请求 `Template:Data Jhin/W`，解析为 `Template:Data Jhin/Deadly Flourish`；pageId `1307581`；revision `4021795`；timestamp `2026-05-21T13:25:33Z`；canonical raw bytes `2942`；SHA256 `14790ca09f6f320fc2fadc81c2fa7e783c7b81d48d792b7760494f2e8d788c65`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/jhin-w.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2940` bytes / SHA256 `76790ba522dc101bb1f1c24ae620f80e8db6d10e890515cbc7da85005a67f78b`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`immediate_impact_scaffold` |
| Rank-5 active | 70 mana；12000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `210 + 0.50 * source.attr.ad.resolved`（二元 `add(const 210, mul(const 0.50, read source.attr.ad.resolved))`；**total AD**，直接读 `ad.resolved`，**不得**减 `ad.base`，亦**不得**称为 bonus AD）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** W state / modifier / listener / matcher / repeat / control / projectile / mark / root / movement-speed；小兵-only 25% 减伤不适用于所选冠军，已排除 |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模线几何/多目标/弹道/标记/禁锢/移速 |
| Standalone | Jhin W provider **独立**；**不**合成 Batch-B 或 sibling Jhin 机制（P/Q/E/R/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_jhin` / AD / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | totalAD60 → raw240；armor0=240，armor100=120。totalAD100 → raw260；armor0=260，armor100=130 |
| 日程交叉 | mana210 / HP1000 / AD100 / armor100：t0 / t11999 / t12000 → success / skip / success；恰好两笔 W damage；final mana70 / HP740；两次自动 W `ability_started`；mana69 → resource skip / mana/HP 不变 / 无 W damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算一次有界物理命中；不代表完整 Deadly Flourish 线几何、弹道拦截、标记或禁锢。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast timing / Effect at cast time start | 施法时序全部排除 |
| direction / range / width / line geometry / multitarget / champion collision | 方向、射程、宽度、线几何、多目标与冠军碰撞全部排除 |
| projectile / interception / spell shield / facing | 弹道、拦截、法术护盾与朝向全部排除 |
| mark creation / detection / duration | 标记创建、检测与时长全部排除 |
| root / control / tenacity | 禁锢、控制与韧性全部排除 |
| bonus movement speed | 移速加成全部排除 |
| minion reduction | 小兵-only 25% 减伤全部排除（所选冠军不适用） |
| other ranks | 仅 Rank5 |
| other Jhin abilities / passives / basic | 无 P/Q/E/R/basic 耦合；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki jhin-w.json (page1307581/rev4021795；canonical SHA 14790ca0…)
  → Backend seed（lol_generic_jhin_deadly_flourish_primary_hit_seed.sql；
     provider_hero_jhin_w_deadly_flourish_primary_hit；
     一笔二元物理伤害 210+0.50*totalAD；
     hero_jhin/ad/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage（binary 210+0.50*ad.resolved）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_jhin_deadly_flourish_primary_hit_seed.sql`（SHA256 `0759F3090FF6DBBFC4BAA0F32E2C6AE0273A3A27A78E83CD135873352458DC92`）+ `LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest`（SHA256 `DDAFC3110337AECD3A73ACE37B068BA98AC1F0EE5DB0EE45526D2275C8B2F0B7`）：独立 `provider_hero_jhin_w_deadly_flourish_primary_hit`；70 mana / 12000ms CD；immediate primary-champion single physical hit scaffold；一笔二元物理；`hero_jhin`/ad/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。owning `4903c00`（接受实现 `run-7efdfc0a-e2fe-414e-be04-93ea0803ec09`；runDelta3/outside0；843 event lines / 74 tool calls；strict；无 truncation；focused Jhin/Jinx/Kai'Sa static SQL **27/27**；owning full Maven **839/839**）。Wasm 集成 `0c103f8`（`run-3e62e677-8a05-4053-99cf-758e3b62bf3b`；runDelta3/outside0；909 event lines / 46 tool calls；strict；无 truncation；两 source hash 与 owning Backend 精确一致；README 仅 +27 行有界 Jhin W 节）。主会话集成新 Jhin+Jinx **18/18**；legacy Draven/Kai'Sa peer 各保留无关 LF/CRLF-hardcoded `must BEGIN` caveat（本轮**未**重跑/修复）；**不得**主张集成全量或修复那些 peer；owning Backend 27/27 与 full 839/839 仍为权威。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。当前源资产与标准 build 精确同字节/同 SHA（`1,169,377` / `65A4C6F8…C6A0`）；Built 与 Web 源资产同字节/同 SHA；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `d62d2e4`（`generic_jhin_deadly_flourish_primary_hit_test.go`）；实现 run `run-c3427736-be29-4b92-9378-a43b618a58c7`（runDelta1/outside0；941 event lines / 100 tool calls；strict；无 truncation）。主验证：focused JhinDeadlyFlourish **6 top-level / 7 named subtests** PASS；`-count=100` PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；标准 TinyGo build PASS；Node smoke compile/run/release PASS。Built 与 Web 源资产均 **1,169,377** bytes / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana210；armor100；totalAD100） | 扣 70 mana；一笔物理伤害；CD 武装；一次 `ability_started` |
| t11999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t12000 再次成功 | 第二次命中；两笔 W damage；final mana70；HP1000→740；两次 `ability_started` |
| mana69 | resource skip；mana/HP 不变；无 W damage/event |
| 交叉 totalAD60 | raw240；armor0=240；armor100=120 |
| 交叉 totalAD100 | raw260；armor0=260；armor100=130 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Jhin；禁止将 total AD 误写为 bonus AD |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-619cf912-b707-4dfa-95d1-eb4125b28921`；READY；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1351 parseable event lines / 66 tool calls；无 truncation/mutation；无 user decision；非阻塞：external-existing-data/check-only；raw caveat；raw G8 OOS/meta provenance |
| Backend owning | owning `4903c00`；接受 `run-7efdfc0a-e2fe-414e-be04-93ea0803ec09`（runDelta3/outside0；843 events / 74 calls；strict；无 truncation）；focused Jhin/Jinx/Kai'Sa **27/27**；owning full Maven **839/839**；seed SHA `0759F309…DC92`；JUnit SHA `DDAFC311…F0B7` |
| Backend 集成（Wasm worktree） | `0c103f8`；`run-3e62e677-8a05-4053-99cf-758e3b62bf3b`（runDelta3/outside0；909 events / 46 calls；strict；无 truncation）；两 source hash 精确匹配 owning；README 仅 +27 Jhin W；主会话集成 Jhin+Jinx **18/18**；legacy Draven/Kai'Sa CRLF caveat 未重跑/修复 |
| Wasm exact | `d62d2e4`；`run-c3427736-be29-4b92-9378-a43b618a58c7`（runDelta1/outside0；941 events / 100 calls；strict；无 truncation）；6/7 focused + `-count=100` + full Go + bench + TinyGo + Node smoke |
| Web | 无本机制写入；Built/Web 资产保持 `1,169,377` / `65A4…C6A0` 同步不变 |
| 审计 commit | `fc6f854`；run `run-858cab7f-3782-47a3-86cc-25010fcd978e`（runDelta6/outside0；1157 parseable event lines / 187 tool calls；strict；无 truncation；G8/Unified generate+`--check` PASS；**仅** Jhin W 语义对象变化；242/254 key sets/order/uniqueness 稳定；Jinx W 与 Xayah W/Q/R 八 hashes 不变：G8 Jinx W `00d140f215c25650c470c6a9f92df40503bf789584db32eaee30085d0aca0291`、Unified Jinx W `7fcee85ef9bd765731458226c08b3168701d79bca71064dfa43ef399f9c72946`、G8 Xayah W `dd91a84a1e307ab4540b9d0f422c3715334ecdac3ac01580c5cb04859f6d938f`、Unified Xayah W `b03237eb01927cccdfa38f2abacd12f2cf0a17cf0b5bbcde75f06b7870b45ed4`、G8 Xayah Q `8305be23180eab1fb0189710defbf546deb1e9bdd0b935119a05ed37dda823ba`、Unified Xayah Q `83a2402fd27bf0f2a32d39ce81049b9f4af939333b6519b4532a9703c8fd13a5`、G8 Xayah R `0eaf18abcec2ee5a43b60bad60b42594e87f28cf69ded46512d18fd9228906c9`、Unified Xayah R `39b10cd4e39794f7cbbd187f4d580b7d48778fa6b5505ceac8d2e505571d4a79`） |
| 最终清单 | G8 242 = migrated73 / partial4 / blocked96 / OOS69；inScope173；Unified sourceCount12 / total254；completed83 / partial_actionable0 / ready0 / blocked_runtime90 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full83 / partial3 / none168；actionable0；`implementation_gap_no_unresolved_data_fields=73`；242/254 keys/order 不变，**仅** Jhin W 语义对象变化。治理 tasks 必须为 96 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段（含历史 `classification=out_of_scope_for_single_target_dps` / `mechanismTags=meta_or_non_target_dps` / `auditBaseline.gapCode=blocked_data`）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Jhin W 记录/机制语义变化（metadata source hash / generatedAt 除外）；Jinx W 与 Xayah W/Q/R G8/Unified canonical objects 字节语义不变（hashes 见 §5）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast timing、direction/range/width/line geometry/multitarget/champion collision、projectile/interception/spell shield/facing、mark creation/detection/duration、root/control/tenacity、bonus movement speed、minion reduction、other ranks、other Jhin abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Deadly Flourish/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Jhin W 为 standalone；Backend 无 repository-owned `hero_jhin`/AD/mana materializer——仅 external-existing-data/check-only；公式使用 **total AD**，不是 bonus AD。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307581 / rev4021795 / timestamp2026-05-21T13:25:33Z / canonical raw2942 / SHA256 `14790ca0…788c65`；sidecar/pages canonical；local raw2940 / SHA `76790ba5…67f78b` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_jhin\|W\|致命华彩` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 一笔二元 `210+0.50*totalAD`；数值与 CD/resource 日程；自动 `ability_started`；零 W state/modifier/listener；standalone；小兵减伤排除 |
| Backend | owning `4903c00` / 集成 `0c103f8`；owning focused 27/27 + full839/839；集成 Jhin+Jinx 18/18；legacy CRLF caveat；无 live seed |
| Wasm | exact `d62d2e4`；focused 6/7；`-count=100`；full Go；bench；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`；Node smoke PASS；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；资产保持同字节/同 SHA 同步不变 |
| 审计 | commit `fc6f854`；G8 migrated + 空 remainingGap；Unified completed/full；Jinx W + Xayah W/Q/R hashes 不变；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-619cf912…`；非阻塞 external-existing-data/check-only / raw caveat / raw G8 OOS provenance 已吸收 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
