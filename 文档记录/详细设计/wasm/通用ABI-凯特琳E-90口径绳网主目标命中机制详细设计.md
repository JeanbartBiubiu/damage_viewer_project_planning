TASK_KEY: wasm-generic-caitlyn-90-caliber-net-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 凯特琳 E 90口径绳网（90 Caliber Net）主目标命中机制详细设计

关联验证记录：[通用 ABI 凯特琳 E 90口径绳网主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_caitlyn|E|90口径绳网` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施法时序、方向/射程/宽度/线几何/多目标/首敌碰撞、弹道/压制/法术护盾、后坐力/冲刺/地形/缓冲动作、减速/爆头标记、其它 rank，或其他凯特琳技能/被动/完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV caitlyn-e-90-caliber-net-primary-hit-phase-a-v3`（有效 DESIGN_READY `run-d3046d66-10fd-4cf7-bf00-22f4e902a9ad`；strict；runDelta0/diff0；1317 event lines / 53 completed read-only calls；无 truncation / user decision；纠正 `20221=damage/magic`，`20230=provider_action/apply` 禁止）。设计谱系：v1 `run-548ec2e9-34ee-4a13-895a-b6117c1e64c4` REVISE（缺 `ap_ratio`）；v2 `run-2b72f456-9f57-4c64-b753-62b82126e249` READY 但实现提示携带错误 type ID——**不得**当作本闭环接受门控；v3 为唯一有效 READY。Peer 旧 DDragon drift 仅报告。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_caitlyn\|E\|90口径绳网` |
| Wiki | 请求 `Template:Data Caitlyn/E`，解析为 `Template:Data Caitlyn/90 Caliber Net`；pageId `1306916`；revision `4007584`；timestamp `2026-04-12T06:47:56Z`；canonical raw bytes `2095`；SHA256 `9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/caitlyn-e.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2094` bytes / SHA256 `3a5eba6df38ec34046440743d55de61490dc7b5a2488b8fc671851474d080073`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold` |
| Rank-5 active | 75 mana；8000ms cooldown；immediate primary-champion first-enemy scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `280 + 0.80 * source.attr.ap.resolved`（二元 `add(const 280, mul(const 0.80, read source.attr.ap.resolved))`；伤害类型 **20221** + add 策略 **20170**；**20230 禁止**）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** E state / modifier / listener / matcher / repeat / control / projectile / recoil / dash / slow / Headshot mark |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界单次魔法命中**。Immediate impact 为 Phase-A scaffold；**不**建模线几何/多目标/首敌碰撞/弹道/后坐力/冲刺/减速/爆头标记 |
| Standalone | Caitlyn E provider **独立**；**不**合成 Batch-B 或 sibling Caitlyn 机制（P/Q/W/R/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_caitlyn` / AP / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | AP0 → raw280 / MR100 mit140；AP100 → raw360 / MR100 mit180 |
| 日程交叉 | mana225 / HP1000 / AP100 / MR100：t0 / t7999 / t8000 → success / skip / success；恰好两笔 E damage；final mana75 / HP640；两次自动 E `ability_started`；mana74 → resource skip / mana/HP 不变 / 无 E damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算一次有界魔法命中；不代表完整 90 Caliber Net 线几何、首敌碰撞、弹道压制、后坐力冲刺或爆头标记。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast timing / Effect at cast time end | 施法时序全部排除 |
| direction / range / width / line geometry / multitarget / first-enemy collision | 方向、射程、宽度、线几何、多目标与首敌碰撞全部排除 |
| projectile / suppression / spell shield | 弹道、压制与法术护盾全部排除 |
| recoil / dash / terrain / buffered actions | 后坐力、冲刺、地形与缓冲动作全部排除 |
| slow / control / tenacity | 减速、控制与韧性全部排除 |
| Headshot / mark | 爆头与标记全部排除 |
| other ranks | 仅 Rank5 |
| other Caitlyn abilities / passives / basic | 无 P/Q/W/R/basic 耦合；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki caitlyn-e.json (page1306916/rev4007584；canonical SHA 9357e7b2…)
  → Backend seed（lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql；
     provider_hero_caitlyn_e_90_caliber_net_primary_hit；
     一笔二元魔法伤害 280+0.80*AP；type 20221 / add 20170；20230 禁止；
     hero_caitlyn/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage（binary 280+0.80*ap.resolved；20221/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql`（SHA256 `863642ABA9C249673980047CFD16036C83E82DAEE4E03A0DBAF82113E6E88DE8`）+ `LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest`（SHA256 `0D04AF7A37EFF0F467D148A545A5DD46690FEF8F8D730DC3D55D8FB69A02E184`）：独立 `provider_hero_caitlyn_e_90_caliber_net_primary_hit`；75 mana / 8000ms CD；immediate primary-champion first-enemy single magic hit scaffold；一笔二元魔法；`hero_caitlyn`/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。初始 Backend run `run-3099c9bc-eb0c-42d4-86f6-6babaddef706` 识别 type 矛盾并写入 paused three-path slice——**不是**接受实现。v3 符合性 owning `9506d01`（`run-8518202c-3ada-4b5d-810d-e56f3a73f9a6`；runDelta3/outside0；1042 event lines / 35 completed calls；strict；无 truncation；focused **63/63**；owning full Maven **848/848**）。集成 `384d658`（`run-d6107740-325c-42cd-af90-e4dad6014164`；runDelta3/outside0；886 event lines / 31 completed calls；strict；无 truncation；两 source hash 与 owning 精确一致；README 仅 +27 行有界 Caitlyn E 节；主会话 Caitlyn/Jhin/Jinx **27/27**）。owning full **848/848** 仍为权威。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。Wasm 仓库内嵌旧 Web 资产为历史遗留、**未触碰**，**不得**主张其为当前 parity 目标。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `4433ef1`（`generic_caitlyn_90_caliber_net_primary_hit_test.go`）；实现 run `run-71c65c6a-78b1-4b65-98c6-f8eb9a783763`（runDelta1/outside0；1107 event lines / 66 completed calls；strict；无 truncation）。主验证：focused **6 top-level / 7 named subtests** PASS；`-count=100` PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；标准 TinyGo build PASS；Node smoke compile/run/release PASS。Built 与独立 Web worktree 均 **1,169,377** / `65A4…C6A0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana225；MR100；AP100） | 扣 75 mana；一笔魔法伤害；CD 武装；一次 `ability_started` |
| t7999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t8000 再次成功 | 第二次命中；两笔 E damage；final mana75；HP1000→640；两次 `ability_started` |
| mana74 | resource skip；mana/HP 不变；无 E damage/event |
| 交叉 AP0 | raw280；MR100 mit140 |
| 交叉 AP100 | raw360；MR100 mit180 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Caitlyn；禁止使用 20230；禁止把 20221 误写为其它 type |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY（v3） | `run-d3046d66-10fd-4cf7-bf00-22f4e902a9ad`；READY；strict；runDelta0/diff0；1317 event lines / 53 completed read-only calls；无 truncation；无 user decision；纠正 `20221=damage/magic`，`20230` 禁止；v1 REVISE / v2 错误 type ID **无效** |
| Backend owning | owning `9506d01`；符合性 `run-8518202c-3ada-4b5d-810d-e56f3a73f9a6`（runDelta3/outside0；1042 events / 35 calls；strict；无 truncation）；focused **63/63**；owning full Maven **848/848**；seed SHA `863642AB…8DE8`；JUnit SHA `0D04AF7A…E184`；初始 `run-3099c9bc…` type 矛盾 / paused three-path **非**接受 |
| Backend 集成（Wasm worktree） | `384d658`；`run-d6107740-325c-42cd-af90-e4dad6014164`（runDelta3/outside0；886 events / 31 calls；strict；无 truncation）；两 source hash 精确匹配 owning；README 仅 +27 Caitlyn E；主会话 Caitlyn/Jhin/Jinx **27/27**；owning full 848/848 权威 |
| Wasm exact | `4433ef1`；`run-71c65c6a-78b1-4b65-98c6-f8eb9a783763`（runDelta1/outside0；1107 events / 66 calls；strict；无 truncation）；6/7 focused + `-count=100` + full Go + bench + TinyGo + Node smoke |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65A4…C6A0`；仓库内嵌旧 Web 资产历史未触碰 |
| 审计 commit | `f4fecaa`；run `run-af59e353-c9d3-4e76-b4e2-41b5d5b73121`（runDelta6/outside0；1237 event lines / 86 completed calls；strict；无 truncation；G8/Unified generate+`--check` PASS；主 HEAD 比较 **仅** Caitlyn E 语义对象变化；稳定 order/keys；locks 不变） |
| 最终清单 | G8 242 = migrated74 / partial4 / blocked95 / OOS69；inScope173；Unified sourceCount12 / total254；completed84 / partial_actionable0 / ready0 / blocked_runtime89 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full84 / partial3 / none167；actionable0；`implementation_gap_no_unresolved_data_fields=72`；242/254 keys/order 不变，**仅** Caitlyn E 语义对象变化。治理 tasks 必须为 97 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Caitlyn E 记录/机制语义变化（metadata source hash / generatedAt 除外）；locks 不变。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。Wasm 仓库内嵌旧 Web 资产为历史遗留、未触碰，**不是**当前 parity 目标。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast timing、direction/range/width/line geometry/multitarget/first-enemy collision、projectile/suppression/spell shield、recoil/dash/terrain/buffered actions、slow/control/tenacity、Headshot/mark、other ranks、other Caitlyn abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 90 Caliber Net/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Caitlyn E 为 standalone；Backend 无 repository-owned `hero_caitlyn`/AP/mana materializer——仅 external-existing-data/check-only；伤害类型必须为 **20221**，**禁止 20230**。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1306916 / rev4007584 / timestamp2026-04-12T06:47:56Z / canonical raw2095 / SHA256 `9357e7b2…84db2`；sidecar/pages canonical；local raw2094 / SHA `3a5eba6d…080073` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_caitlyn\|E\|90口径绳网` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 一笔二元 `280+0.80*AP`；type 20221 / add 20170；20230 禁止；数值与 CD/resource 日程；自动 `ability_started`；零 E state/modifier/listener；standalone |
| Backend | owning `9506d01` / 集成 `384d658`；owning focused 63/63 + full848/848；集成 Caitlyn/Jhin/Jinx 27/27；无 live seed |
| Wasm | exact `4433ef1`；focused 6/7；`-count=100`；full Go；bench；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`；Node smoke PASS；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA；内嵌旧资产历史未触碰 |
| 审计 | commit `f4fecaa`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Caitlyn E 语义对象变化；counts 与 §5 最终清单一致 |
| 设计门控 | 唯一有效 READY `run-d3046d66…`；v1 REVISE / v2 错误 type ID 无效；type 纠正 20221/20230 已吸收 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
