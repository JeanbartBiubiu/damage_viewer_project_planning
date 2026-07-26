TASK_KEY: wasm-generic-quinn-blinding-assault-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-24

# 通用 ABI - 奎因 Q 炫目攻势（Blinding Assault）主目标伤害机制详细设计

关联验证记录：[通用 ABI 奎因 Q 炫目攻势 Blinding Assault 主目标伤害机制验证记录](../../测试记录/wasm/通用ABI-奎因Q炫目攻势BlindingAssault主目标伤害机制验证记录-2026-07-24.md)。本任务将精确候选 `hero_skill|hero_quinn|Q|炫目攻势` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 Valor 实体/AI、弹道/几何/AOE、怪物双倍、Harrier/P/W 交互、nearsight/disarm，或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV quinn-q-blinding-assault-phase-a-v1`（DESIGN_REVIEW READY `run-ad05d978-c537-4681-9cd9-bc679f1a99e3`；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1872 JSONL events parseable；83 unique direct tool calls all completed；无 truncation / mutation / orphans；无 user decision。非阻塞笔记已接受：嵌套二元 `add`；事件范围意为无显式 Q emit / 无 `basic_attack_hit`；Xayah/Draven 延后；ambient AP 定义前置）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_quinn\|Q\|炫目攻势` |
| Wiki | 请求 `Template:Data Quinn/Q`，解析为 `Template:Data Quinn/Blinding Assault`；pageId `1308954`；revision `4024766`；timestamp `2026-06-03T00:49:42Z`；canonical raw bytes `1742`；SHA256 `abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/quinn-q.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 亦为 `1742` bytes / SHA256 `be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`ap_ratio`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| Rank-5 active | 70 mana；9000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `205 + 1.00*(source.attr.ad.resolved-source.attr.ad.base) + 0.50*source.attr.ap.resolved`（嵌套二元 `add`）；**零** provider state / listener / direct emit / control / repeat |
| 事件范围 | runtime **可**合成既有 `ability_started`；Q **不**产生 `basic_attack_hit`、**不**武装既有 Quinn W、**不**改变 AS；**不**宣称全局零事件 |
| 数值交叉 | 分支 raw `205/285/255/335`；armor100 → mitigated `102.5/142.5/127.5/167.5`。默认 baseAD59 / resolvedAD139 / AP100 → raw335 / mitigated167.5 |
| 日程交叉 | mana210：t0 / t8999 / t9000 → 两次成功 + 恰好一次 cooldown skip（无 mana/伤害），final mana70；mana69 → resource skip / 无伤害 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算单次物理伤害；不代表 Valor 弹道、碰撞几何、AOE、怪物双倍、Harrier 标记或 nearsight/disarm。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| Valor entity / AI | Valor 实体与 AI 全部排除 |
| cast delay | 施放延迟全部排除 |
| direction / projectile / speed / travel / collision / range / width / radius / geometry / AOE / multitarget | 弹道、几何、AOE 与多目标全部排除 |
| monster double damage | 怪物双倍伤害排除 |
| Harrier / P / W interaction | Harrier 标记与 P/W 耦合全部排除 |
| nearsight / disarm / sight / control / death persistence | 致盲/缴械/视野/控制/死亡持久全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other Quinn skills / basic | 无其它技能/普攻耦合 |
| loadout / crit / on-hit | 无负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki quinn-q.json (page1308954/rev4024766；canonical SHA abce6abd…)
  → Backend seed（lol_generic_quinn_blinding_assault_primary_hit_seed.sql；
     provider_hero_quinn_q_blinding_assault_primary_hit；嵌套二元物理公式）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage operation（nested binary 205+1.00*bonusAD+0.50*AP）
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_quinn_blinding_assault_primary_hit_seed.sql` + `LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest`：独立 `provider_hero_quinn_q_blinding_assault_primary_hit`；70 mana / 9000ms CD；immediate primary-champion scaffold；一笔嵌套二元物理伤害。中性 AP0 / resource **insert-only** 投影：从既有 W-seed mana EAV 推导 mana resource；**永不**硬编码 `269`，**永不**覆盖既有 AP/resource 行。owning `5c174b51094b96b9591476d36cadd03649510f45` / 集成 `e030cd971b12d2b667fc8c5d0155bc087c08addb`；focused JUnit **10/10**；full Maven **780/780**。实现 run `run-86f61e34-3803-4305-b22e-3c479345f072`（delta3/outside0；两笔 orphaned read-only——初探错误 worktree；claims/diff 已独立复核；最终写入仅三条 Backend allowlist）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。当前源资产与标准 build 精确同字节/同 SHA（`1,169,377` / `65A4C6F8…C6A0`）；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `ba71996eb97a5c0e02f4dbebf09fe05ebfcf4a5f`（`generic_quinn_blinding_assault_primary_hit_test.go`）；实现 run `run-4d74ec5c-d181-40ee-9b39-f55e0fbd5f44`（delta1/outside0；1136 events；72 unique calls all completed；无 truncation）。主验证：focused `-count=100` PASS；full `go test -count=1 ./...` PASS；标准 `scripts/build-wasm.ps1` 产物 **1,169,377** bytes，SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（相对既有标准 build **未变**）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana210） | 扣 70 mana；一笔物理伤害；CD 武装 |
| t8999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害 |
| t9000 再次成功 | 第二次命中；final mana70 |
| mana69 | resource skip；无伤害 |
| 默认交叉 | baseAD59 / resolvedAD139 / AP100 → raw335 / armor100 → 167.5 |
| 分支交叉 | raw205/285/255/335 → mitigated102.5/142.5/127.5/167.5 |
| 事件 | 可合成 `ability_started`；无 `basic_attack_hit`；不武装 W；不改 AS |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止硬编码 mana269 / 覆盖既有 AP/resource；禁止把 exclusions 写成 remainingGap 或近似实现 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-ad05d978-c537-4681-9cd9-bc679f1a99e3`；strict `grok-4.5`；effort high；fast false；READY；runDelta0/diff0；1872 parseable；83 unique direct tool calls completed；无 truncation/mutation/orphans；无 user decision；非阻塞笔记已接受 |
| Backend owning / 集成 | owning `5c174b51094b96b9591476d36cadd03649510f45`；集成 `e030cd971b12d2b667fc8c5d0155bc087c08addb`；run `run-86f61e34-3803-4305-b22e-3c479345f072`（delta3/outside0；两笔 orphaned read-only 非干净设计门控；claims/diff 独立复核；最终仅三条 Backend allowlist）；focused10/10；full Maven **780/780**；无 live seed |
| Wasm exact | `ba71996eb97a5c0e02f4dbebf09fe05ebfcf4a5f`；run `run-4d74ec5c-d181-40ee-9b39-f55e0fbd5f44`（delta1/outside0；1136 events；72 unique calls completed；无 truncation） |
| Web | 无本机制写入；资产保持 `1,169,377` / `65A4…C6A0` 同步不变 |
| 审计 commit | `b08e8b639e56c061cfd04301ab6c86f5f3fe87d9`；run `run-f83d7474-acb7-4a19-9928-6ad7129e8045`（delta6/outside0；1217 events；86 unique calls completed；无 truncation；四 generator checks PASS；语义比较证明 G8/Unified key order 不变且**仅** Quinn Q 对象变化） |
| 最终清单 | G8 242 = migrated66 / partial4 / blocked103 / OOS69；Unified sourceCount12 / total254；completed76 / partial_actionable0 / ready0 / blocked_runtime97 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full76 / partial3 / none175；actionable0；`implementation_gap_no_unresolved_data_fields=79`；Wiki-only registry check candidate242 / migrated48 / partial5 / blocked120 / OOS69；Batch-G / G8 / Unified checks PASS；242/254 keys/order 不变，**仅** Quinn Q 语义对象变化。治理 tasks 必须为 89 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|ap_ratio|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 242/254 不变；**仅** Quinn Q 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：Valor entity/AI、cast delay、direction/projectile/speed/travel/collision/range/width/radius/geometry/AOE/multitarget、monster double、Harrier/P/W interaction、nearsight/disarm/sight/control/death persistence、ranks1–4、other Quinn skills/basic、loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Blinding Assault/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。**永不**硬编码 mana269 或覆盖既有 AP/resource 行。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308954 / rev4024766 / timestamp2026-06-03T00:49:42Z / canonical raw1742 / SHA256 `abce6abd…d8085d`；sidecar/pages canonical；local raw1742 / SHA `be887856…2737bd` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_quinn\|Q\|炫目攻势` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 嵌套二元 `205+1.00*bonusAD+0.50*AP`；分支与默认交叉；CD/resource 日程；零 provider state/listener/direct emit/control/repeat；无 `basic_attack_hit` / 不武装 W / 不改 AS |
| Backend | owning `5c174b5` / 集成 `e030cd9`；focused10/10；full780/780；insert-only mana 投影；无 live seed |
| Wasm | exact `ba71996`；focused `-count=100`；full Go；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`（未变）；Node smoke PASS；无生产 Wasm 写入 |
| Web | 无本机制写入；资产保持同字节/同 SHA 同步不变 |
| 审计 | commit `b08e8b6`；G8 migrated + 空 remainingGap；Unified completed/full；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-ad05d978…`；非阻塞笔记已接受 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
