TASK_KEY: wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 凯特琳 Q 和平使者（Piltover Peacemaker）首个敌人命中机制详细设计

关联验证记录：[通用 ABI 凯特琳 Q 和平使者首个敌人命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_caitlyn|Q|和平使者` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施法时序/精确 0.625 cast / `Effect at cast time start`、attack timer reset bug、方向/射程/宽度/线几何/多目标/首敌后 60% 减伤、陷阱/揭示例外、弹道/法术护盾、其它 rank，或其他凯特琳技能/被动（含既有 Caitlyn E）/完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV caitlyn-q-piltover-peacemaker-first-enemy-hit-phase-a-v1`（有效 DESIGN_READY `run-34ad42ca-9761-4062-a1b3-6df69df157b0`；strict `grok-4.5` / high / fast=false；runDelta0/diff0；967 parseable event lines / 43 complete tool groups；无 truncation / user decision；`NB-BOUNDARY-TOKEN` 接受为非阻塞笔记）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_caitlyn\|Q\|和平使者` |
| Wiki | 请求 `Template:Data Caitlyn/Q`，解析为 `Template:Data Caitlyn/Piltover Peacemaker`；pageId `1306911`；revision `4007583`；timestamp `2026-04-12T06:47:12Z`；canonical raw bytes `1841`；SHA256 `6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/caitlyn-q.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `1838` bytes / SHA256 `93da300971429a629f11a721c3993784db6a99d3559b1286eae9500176560b9a`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`immediate_impact_scaffold`（**无** total-AD tag） |
| Rank-5 active | 75 mana；6000ms cooldown；immediate primary-champion first-enemy full physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `210 + 2.05 * source.attr.ad.resolved`（**直接 total AD 读取**，不得减 base AD，亦不得称为 bonus AD；伤害类型 **20220** + add 策略 **20170**）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** Q state / modifier / listener / matcher / repeat / control / projectile |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界首个敌人满额物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模线几何/多目标/首敌后 60%/陷阱揭示/弹道/法术护盾 |
| Standalone | Caitlyn Q provider **独立**；**与 Caitlyn E 隔离**；**不**合成 Batch-B 或 sibling Caitlyn 机制（P/W/E/R/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_caitlyn` / AD / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | `(AD0,A0)=(210,210)`；`(AD0,A100)=(210,105)`；`(AD100,A0)=(415,415)`；`(AD100,A100)=(415,207.5)`；`(AD200,A100)=(620,310)`（raw, mitigated） |
| 日程交叉 | mana225 / HP1000 / AD100 / armor100：t0 / t5999 / t6000 → success / skip / success；恰好两笔 Q damage；final mana75 / HP585；两次自动 Q `ability_started`；mana74 → resource skip / mana/HP 不变 / 无 Q damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算一次有界首敌满额物理命中；不代表完整 Piltover Peacemaker 线几何、首敌后 60% 减伤、陷阱/揭示例外、弹道或法术护盾。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast timing / exact 0.625 cast / Effect at cast time start | 施法时序与 Wiki cast 0.625 / Effect-at-cast-start 全部排除 |
| attack timer reset bug | 攻击计时器重置缺陷全部排除 |
| direction / range / width / line geometry / multitarget / post-first-enemy 60% | 方向、射程、宽度、线几何、多目标与首敌后 60% 减伤全部排除 |
| trap / reveal exception | 陷阱与揭示例外全部排除 |
| projectile / spell shield | 弹道与法术护盾全部排除 |
| other ranks | 仅 Rank5 |
| other Caitlyn abilities / passives / basic（含 E） | 无 P/W/E/R/basic 耦合；与 Caitlyn E 隔离；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki caitlyn-q.json (page1306911/rev4007583；canonical SHA 6c40deba…)
  → Backend seed（lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql；
     provider_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit；
     一笔物理伤害 210+2.05*totalAD；type 20220 / add 20170；
     hero_caitlyn/ad/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 与 Caitlyn E 隔离、无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage（210+2.05*ad.resolved；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql`（SHA256 `F4D3F06FBBB0307373E417F81FEC609DFCA282B2CAD6C0EC70499ADCC83A9DBA`）+ `LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest`（SHA256 `009B90AF78318DF938AA38E2235A5C9E7040F78B9FBFE9FE807E32443CCCED5C`）：独立 `provider_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit`；75 mana / 6000ms CD；immediate primary-champion first-enemy full physical hit scaffold；一笔物理；`hero_caitlyn`/ad/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 与 Caitlyn E 隔离、无 Batch-B/sibling 合成）。初始 Backend `run-ba1d21cf-9f1f-4934-9aad-056550ff2970`（runDelta3/outside0；862 events / 35 complete groups）经主审查发现 `Effect at cast time end` 证据漂移，**因此在接受前纠正**——**不是**接受实现。纠正 owning `b5ef446`（`run-bf0f077e-2c09-48bf-8693-15ff12045b26`；runDelta3/outside0；437 events / 23 complete groups；exact end→start 机械纠正；最终主会话 adjacent **45/45** 与 full **866/866**）。镜像 `245a111`（`run-5ae9e64e-dec3-4f0c-840b-b845ce21347f`；runDelta3/outside0；392 parseable events / 2 complete tool groups；三文件精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `0fe29e7`（`generic_caitlyn_piltover_peacemaker_first_enemy_hit_test.go`）；实现 run `run-3d21efe6-cde0-4b40-846c-4004592cfd8b`（runDelta1/outside0；884 events / 32 complete groups；无 truncation）。主验证：focused runtime PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；标准 TinyGo build PASS；Node smoke PASS。Built 与独立 Web worktree 均 **1,169,377** / `65A4…C6A0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana225；armor100；AD100） | 扣 75 mana；一笔物理伤害；CD 武装；一次 `ability_started` |
| t5999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t6000 再次成功 | 第二次命中；两笔 Q damage；final mana75；HP1000→585；两次 `ability_started` |
| mana74 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 (AD0,A0) | raw210；mitigated210 |
| 交叉 (AD0,A100) | raw210；mitigated105 |
| 交叉 (AD100,A0) | raw415；mitigated415 |
| 交叉 (AD100,A100) | raw415；mitigated207.5 |
| 交叉 (AD200,A100) | raw620；mitigated310 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Caitlyn 或触碰既有 Caitlyn E；禁止把 total AD 误写为 bonus AD 或减 base；禁止把 Effect-at-cast-start 误写为 end |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-34ad42ca-9761-4062-a1b3-6df69df157b0`；READY；strict `grok-4.5`/high/fast=false；runDelta0/diff0；967 parseable events / 43 complete tool groups；无 truncation；无 user decision；`NB-BOUNDARY-TOKEN` 非阻塞接受 |
| Backend 初始（非接受） | `run-ba1d21cf-9f1f-4934-9aad-056550ff2970`；runDelta3/outside0；862 events / 35 complete groups；主审查发现 `Effect at cast time end` 证据漂移 → **接受前纠正** |
| Backend owning 纠正 | owning `b5ef446`；`run-bf0f077e-2c09-48bf-8693-15ff12045b26`（runDelta3/outside0；437 events / 23 complete groups；exact end→start 机械纠正）；最终主会话 adjacent **45/45** / full **866/866**；seed SHA `F4D3F06F…A9DBA`；JUnit SHA `009B90AF…CED5C` |
| Backend 镜像（Wasm worktree） | `245a111`；`run-5ae9e64e-dec3-4f0c-840b-b845ce21347f`（runDelta3/outside0；392 parseable / 2 complete tool groups）；三文件精确 parity |
| Wasm exact | `0fe29e7`；`run-3d21efe6-cde0-4b40-846c-4004592cfd8b`（runDelta1/outside0；884 events / 32 complete groups）；focused + full Go + bench + TinyGo + Node PASS；Built/独立 Web 资产 `1,169,377` / `65A4…C6A0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65A4…C6A0` |
| 审计 commit | `8afb881`；run `run-f6331084-e629-4dd2-ac8a-3429961362d4`（runDelta6/outside0；1174 events / 70 complete groups；无 truncation；主会话独立重跑两生成器、四 checks 与 HEAD 语义比较）。Registry/Batch-G/G8/Unified checks PASS；242/254 keys/order 稳定；**仅** Caitlyn Q 语义对象变化 |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated76 / partial4 / blocked93 / OOS69；inScope173；Unified sourceCount12 / total254；completed86 / partial_actionable0 / ready0 / blocked_runtime87 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full86 / partial3 / none165；implementation gap70；actionable0。治理 tasks 必须为 99 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|immediate_impact_scaffold`；**无** total-AD tag）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Caitlyn Q 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast timing/exact 0.625 cast/`Effect at cast time start`、attack timer reset bug、direction/range/width/line geometry/multitarget/post-first-enemy 60%、trap/reveal、projectile/spell shield、other ranks、other Caitlyn abilities/passives（含 E）、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Piltover Peacemaker/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Caitlyn Q 为 standalone 且与 Caitlyn E 隔离；Backend 无 repository-owned `hero_caitlyn`/AD/mana materializer——仅 external-existing-data/check-only；伤害为 **total AD** 直接读取（不得减 base / 不得称 bonus AD）；类型 **20220** / add **20170**。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1306911 / rev4007583 / timestamp2026-04-12T06:47:12Z / canonical raw1841 / SHA256 `6c40deba…07caf`；sidecar/pages canonical；local raw1838 / SHA `93da3009…0b9a` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_caitlyn\|Q\|和平使者` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 一笔 `210+2.05*totalAD`；type 20220 / add 20170；无显式 event op；数值与 CD/resource 日程；自动 `ability_started`；零 Q state/modifier/listener；standalone；与 Caitlyn E 隔离；无 total-AD tag |
| Backend | owning `b5ef446` / 镜像 `245a111`；初始 `run-ba1d21cf…` 非接受；纠正 adjacent45/45 + full866/866；无 live seed |
| Wasm | exact `0fe29e7`；focused + full Go + bench + TinyGo + Node；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `8afb881`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Caitlyn Q 语义对象变化；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-34ad42ca…`；runDelta0/diff0；967 events / 43 complete tool groups；无 truncation/user decision；`NB-BOUNDARY-TOKEN` 非阻塞 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
