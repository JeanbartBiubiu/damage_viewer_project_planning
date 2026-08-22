TASK_KEY: wasm-generic-kalista-pierce-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 卡莉丝塔 Q 穿刺（Pierce）主目标命中机制详细设计

关联验证记录：[通用 ABI 卡莉丝塔 Q 穿刺主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_kalista|Q|穿刺` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施法时序/Effect at cast time end、Martial Poise/dash cancel、方向/射程/宽度/线几何/多目标/首敌碰撞、弹道/拦截/法术护盾、击杀延续/Rend 叠层转移、其它 rank，或其他卡莉丝塔技能/被动/完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV kalista-q-pierce-primary-hit-phase-a-v1`（有效 DESIGN_READY `run-55166e3f-5b1f-4aee-b061-a1ebcae42236`；strict `grok-4.5` / high / fast=false；runDelta0/diff0；1024 parseable event lines / 45 complete read-only calls；无 truncation / user decision）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_kalista\|Q\|穿刺` |
| Wiki | 请求 `Template:Data Kalista/Q`，解析为 `Template:Data Kalista/Pierce`；pageId `1307666`；revision `3997075`；timestamp `2026-03-06T15:53:18Z`；canonical raw bytes `1625`；SHA256 `90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/kalista-q.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `1623` bytes / SHA256 `0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`immediate_impact_scaffold`（**无** total-AD tag） |
| Rank-5 active | 80 mana；9000ms cooldown；immediate primary-champion first-enemy scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `270 + 1.05 * source.attr.ad.resolved`（**直接 total AD 读取**，不得减 base AD，亦不得称为 bonus AD；伤害类型 **20220** + add 策略 **20170**）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** Q state / modifier / listener / matcher / repeat / control / projectile |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模线几何/多目标/首敌碰撞/弹道/击杀延续/Rend 转移 |
| Standalone | Kalista Q provider **独立**；**不**合成 Batch-B 或 sibling Kalista 机制（P/W/E/R/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_kalista` / AD / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | `(AD0,A0)=(270,270)`；`(AD0,A100)=(270,135)`；`(AD100,A0)=(375,375)`；`(AD100,A100)=(375,187.5)`；`(AD200,A100)=(480,240)`（raw, mitigated） |
| 日程交叉 | mana240 / HP1000 / AD100 / armor100：t0 / t8999 / t9000 → success / skip / success；恰好两笔 Q damage；final mana80 / HP625；两次自动 Q `ability_started`；mana79 → resource skip / mana/HP 不变 / 无 Q damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算一次有界物理命中；不代表完整 Pierce 线几何、首敌碰撞、弹道拦截、击杀延续或 Rend 叠层转移。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast timing / Effect at cast time end | 施法时序全部排除 |
| Martial Poise / dash cancel | 武术姿态冲刺与 dash 取消全部排除 |
| direction / range / width / line geometry / multitarget / first-enemy collision | 方向、射程、宽度、线几何、多目标与首敌碰撞全部排除 |
| projectile / interception / spell shield | 弹道、拦截与法术护盾全部排除 |
| kill continuation / Rend stack transfer | 击杀延续与 Rend 叠层转移全部排除 |
| other ranks | 仅 Rank5 |
| other Kalista abilities / passives / basic | 无 P/W/E/R/basic 耦合；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki kalista-q.json (page1307666/rev3997075；canonical SHA 90c490d9…)
  → Backend seed（lol_generic_kalista_pierce_primary_hit_seed.sql；
     provider_hero_kalista_q_pierce_primary_hit；
     一笔物理伤害 270+1.05*totalAD；type 20220 / add 20170；
     hero_kalista/ad/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage（270+1.05*ad.resolved；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_kalista_pierce_primary_hit_seed.sql`（SHA256 `6f273a57008327959c004a5043c046c08ca6d0e12216e33af17dce8eb3799af4`）+ `LolGenericKalistaPiercePrimaryHitSeedSqlTest`（SHA256 `2f42b6ac5ee3272325b2b91f724c7d3a27a534a0de369f55386122fef469c885`）：独立 `provider_hero_kalista_q_pierce_primary_hit`；80 mana / 9000ms CD；immediate primary-champion first-enemy single physical hit scaffold；一笔物理；`hero_kalista`/ad/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。owning `04c061f`（`run-7c1ed300-9cd1-4124-9359-2ff02085d44f`；runDelta3/outside0；968 event lines / 32 complete call groups；无 truncation；focused Kalista/Jinx/Jhin **27/27** PASS）。驱动首轮全量曾命中既有瞬时 `LolGenericKogmawLivingArtillerySeedSqlTest` regex `StackOverflowError`（**非** Kalista 失败）；隔离 Kog'Maw **10/10** 后全量重跑 **857/857** PASS。集成/镜像 `bdb5d32`（`run-ae314a2e-82cd-476e-a595-15ea3efed7fd`；runDelta3/outside0；542 event lines / 4 complete calls；无 truncation；三 Backend 产物精确字节/hash 对等；README 镜像有意同步 owning Backend 整文件漂移，非仅 Kalista 段落）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `99e7b39`（`generic_kalista_pierce_primary_hit_test.go`）；初始实现 `run-05b5303e-6267-43ca-a4e1-56df5310c11e`（runDelta1/outside0；1307 event lines / 26 complete call groups；无 truncation；行为门控均 PASS）；审查发现 CRLF/非 gofmt-clean，机械修正 `run-f1f16286-c126-4ee8-8c34-afddcd30711e`（runDelta1/outside0；370 event lines / 4 complete calls；无 truncation；`gofmt -d` clean；focused PASS）。最终驱动验证：focused runtime PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；标准 TinyGo build PASS；Node smoke PASS；Node generic-run bench PASS。Built 与独立 Web worktree 均 **1,169,377** / `65A4…C6A0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana240；armor100；AD100） | 扣 80 mana；一笔物理伤害；CD 武装；一次 `ability_started` |
| t8999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t9000 再次成功 | 第二次命中；两笔 Q damage；final mana80；HP1000→625；两次 `ability_started` |
| mana79 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 (AD0,A0) | raw270；mitigated270 |
| 交叉 (AD0,A100) | raw270；mitigated135 |
| 交叉 (AD100,A0) | raw375；mitigated375 |
| 交叉 (AD100,A100) | raw375；mitigated187.5 |
| 交叉 (AD200,A100) | raw480；mitigated240 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Kalista；禁止把 total AD 误写为 bonus AD 或减 base |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-55166e3f-5b1f-4aee-b061-a1ebcae42236`；READY；strict `grok-4.5`/high/fast=false；runDelta0/diff0；1024 event lines / 45 complete read-only calls；无 truncation；无 user decision |
| Backend owning | owning `04c061f`；`run-7c1ed300-9cd1-4124-9359-2ff02085d44f`（runDelta3/outside0；968 events / 32 complete call groups；无 truncation）；focused Kalista/Jinx/Jhin **27/27**；Cursor full **857/857**（首轮瞬时既有 Kog'Maw regex SOE → 隔离 10/10 → 全量重跑 857/857；**非** Kalista 失败）；seed SHA `6f273a57…9af4`；JUnit SHA `2f42b6ac…c885` |
| Backend 镜像（Wasm worktree） | `bdb5d32`；`run-ae314a2e-82cd-476e-a595-15ea3efed7fd`（runDelta3/outside0；542 events / 4 complete calls；无 truncation）；三 Backend 产物精确字节/hash 对等；README 整文件漂移有意同步 |
| Wasm exact | `99e7b39`；初始 `run-05b5303e-6267-43ca-a4e1-56df5310c11e`（runDelta1/outside0；1307 events / 26 complete call groups）；机械 gofmt 修正 `run-f1f16286-c126-4ee8-8c34-afddcd30711e`（runDelta1/outside0；370 events / 4 calls；`gofmt -d` clean）；focused + full Go + bench + TinyGo + Node smoke + Node generic-run bench PASS |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65A4…C6A0` |
| 审计 commit | `f513014`；run `run-95662474-3763-4c4d-add9-64913036d157`（runDelta6/outside0；1350 parseable event lines；无 truncation；74 complete tool groups + 一笔 unmatched read-only `read` running event——**不得**伪称 event log 完全配对；路径审计完整；主会话独立重跑两生成器、四 checks、count parsing 与 HEAD object 比较）。Registry/Batch-G/G8/Unified checks PASS；242/254 keys/order 稳定；**仅** Kalista Q 语义对象变化 |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated75 / partial4 / blocked94 / OOS69；inScope173；Unified sourceCount12 / total254；completed85 / partial_actionable0 / ready0 / blocked_runtime88 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full85 / partial3 / none166；implementation gap71；actionable0。治理 tasks 必须为 98 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|immediate_impact_scaffold`；**无** total-AD tag）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Kalista Q 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast timing/Effect at cast time end、Martial Poise/dash cancel、direction/range/width/line geometry/multitarget/first-enemy collision、projectile/interception/spell shield、kill continuation/Rend stack transfer、other ranks、other Kalista abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Pierce/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Kalista Q 为 standalone；Backend 无 repository-owned `hero_kalista`/AD/mana materializer——仅 external-existing-data/check-only；伤害为 **total AD** 直接读取（不得减 base / 不得称 bonus AD）；类型 **20220** / add **20170**。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307666 / rev3997075 / timestamp2026-03-06T15:53:18Z / canonical raw1625 / SHA256 `90c490d9…76a67`；sidecar/pages canonical；local raw1623 / SHA `0b8dd9cf…1c94` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_kalista\|Q\|穿刺` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 一笔 `270+1.05*totalAD`；type 20220 / add 20170；无显式 event op；数值与 CD/resource 日程；自动 `ability_started`；零 Q state/modifier/listener；standalone；无 total-AD tag |
| Backend | owning `04c061f` / 镜像 `bdb5d32`；focused Kalista/Jinx/Jhin 27/27；Cursor full 857/857（含诚实记录的瞬时 Kog'Maw SOE 重试）；无 live seed |
| Wasm | exact `99e7b39`；初始 + gofmt 修正两 run；focused + full Go + bench + TinyGo + Node smoke + Node generic-run bench；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `f513014`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Kalista Q 语义对象变化；counts 与 §5 最终清单一致；event log 不得伪称完全配对 |
| 设计门控 | READY `run-55166e3f…`；runDelta0/diff0；1024 events / 45 complete read-only；无 truncation/user decision |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
