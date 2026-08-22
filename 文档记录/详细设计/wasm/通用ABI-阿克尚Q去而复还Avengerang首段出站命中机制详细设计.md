TASK_KEY: wasm-generic-akshan-avengerang-first-outbound-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 阿克尚 Q 去而复还（Avengerang）首段出站命中机制详细设计

关联验证记录：[通用 ABI 阿克尚 Q 去而复还 Avengerang 首段出站命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_akshan|Q|去而复还` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime`。**不**宣称 cast/effect-at-cast-end、direction/range/range extension/geometry、projectile/travel/speed/collision/return/homing、真实冷却在飞镖返回后开始、第二段回程/两段合计/once-per-pass、sight/reveal、movement speed/AP movement ratio/decay、nonchampion scaling、spellshield、Dirty Fighting ability-hit wiring、ranks 1–4、siblings/loadout/bootstrap、live/Admin/E2E，或完整 Avengerang/游戏保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV akshan-q-avengerang-first-outbound-hit-phase-a-v4`（正式最终 DESIGN_READY `run-bde07e54-a7f2-4ba5-878c-39209b3593e0`；26/26 complete tool groups；runDelta0；无 truncation / mutation；无 user decision。**故意省略**聚合 event-total 主张——其不在冻结证据内。先前 v1 `run-0abb40b7-cab2-42aa-a91c-7c2ab7989ac7` 为 **valid REVISE**（1855/1855 parseable；46/46 groups；delta0）——针对 absent-only mana resource 与 cooldown-start-after-return 文档化，两项均已接受。有效 v2 READY `run-11d562ed-9bb5-494c-8825-d8da61e6589a`（1682/1682；36/36；delta0）曾治理初始 Backend 实现；其后被中止的 v2 Wasm test run 暴露了聚合 README-lock 缺陷与过时 fixture plan，**不是**完成证据。有效 v3 `run-f627e870-08fd-41a0-a148-c928c1be1d16` 返回 REVISE（2169/2169；52/52；delta0）——fixture truth/scope 校正，两项均已接受。**v4 为正式最终 READY 门控**。Production Wasm / public ABI / Web 变更**不**需要）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_akshan\|Q\|去而复还` |
| Wiki | 请求 `Template:Data Akshan/Q`，解析为 `Template:Data Akshan/Avengerang`；pageId `1502462`；revision `4007510`；timestamp `2026-04-11T22:35:01Z`；canonical raw bytes `2570`；SHA256 `1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/akshan-q.json` bytes `2948` / SHA256 `f6b0dd492d80c49a2259d366230f7d8f4c6d43a70688b42d0d0780e4866d9a1a` plus pages sibling bytes `688` / SHA256 `11d2da87557737fed487fb106a9ffb7b4a6d7f1d32391ce3a5c142f9128509e0` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2570` bytes，SHA256 `407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`（**无** completed salvage tag） |
| Rank-5 active | 80 mana；**immediate cooldown scaffold 5000ms**（真实 Wiki 冷却在飞镖返回后开始——为 **completed-boundary exclusion**，**不是** faithful approximation，亦**不是** blocker）；immediate selected-primary champion first-outbound-pass single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理命中 `165 + 0.70 * (source.attr.ad.resolved - source.attr.ad.base)`（**精确嵌套二元树** `add(const 165, mul(const 0.70, sub(read source.attr.ad.resolved, read source.attr.ad.base)))`；**显式 bonus AD 减法**；不得按 total-AD 直读，亦不得省略 base 相减；伤害类型 **20220** + add 策略 **20170**；**无** 20230 executable；**无**显式 event op；**无** Q-specific type）；成功施放自动合成恰好一次 `ability_started`；**零** Q state / modifier / listener / matcher / repeat / control / projectile |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定主目标首段出站单次物理命中**。Immediate impact **与** immediate cooldown scaffold 均为 Phase-A scaffold；**不**建模 direction/range/return/homing/projectile/travel、真实返回后冷却开始、第二段回程，或完整 Q 保真 |
| Standalone | Akshan Q provider **独立**；**保留**既有 Dirty Fighting / basic 定义与挂载；Q **不**合成 Dirty Fighting ability-hit stacks；**不**合成 siblings / loadout / bootstrap |
| Backend 前置 | 前置处理为 **absent-only** mana resource definition/value，经由 `ON CONFLICT DO NOTHING`，由既有 panel mana **派生**，**永不覆盖**；hero / ad / mana panel EAV 与 Dirty Fighting / basic **保持 repository-owned / preserved**；**不** live-publish |
| 数值交叉 | armor100：base52/resolved52 → raw165/final82.5；base52/resolved152 → raw235/final117.5；反证 base0/resolved100 与 base52/resolved152 均 raw/final235（证明 bonus-AD 减法） |
| 日程交叉 | mana240 / baseAD52 / resolvedAD152 / armor100 / HP1000：t0 / t4999 / t5000 → success / skip / success；恰好两笔 Q damage；两次自动 Q `ability_started`；final mana80 / HP765；mana79 → resource skip |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact **与** immediate 5000ms cooldown scaffold 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界首段出站单次物理命中，并武装 immediate CD scaffold；不代表完整 Avengerang 弹道、回程、真实返回后冷却，或第二段。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| cast / effect-at-cast-end | 施法时间与施法结束生效全部排除 |
| direction / range / range extension / geometry | 方向、射程、射程延长与几何全部排除 |
| projectile / travel / speed / collision / return / homing | 弹道、飞行、速度、碰撞、回程与追踪全部排除 |
| real cooldown start after return | 真实 Wiki 冷却在飞镖返回后开始——**排除**；immediate 5000ms 仅为 scaffold，**不是** faithful approximation |
| second return pass / total two-pass / once-per-pass | 第二段回程、两段合计与每段一次全部排除 |
| sight / reveal | 视野与揭示全部排除 |
| movement speed / AP movement ratio / decay | 移速、AP 移速倍率与衰减全部排除 |
| nonchampion scaling | 非英雄缩放排除 |
| spellshield | 法术护盾排除 |
| Dirty Fighting ability-hit wiring | Q **不**合成 Dirty Fighting ability-hit stacks |
| ranks 1–4 | 仅 Rank5 |
| siblings / loadout / bootstrap | 无 sibling 合成；无负荷/bootstrap |
| live migration / Admin publish / browser E2E / full Avengerang / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标首段出站物理命中**，不是完整 Q |

## 3. 端到端数据流

```text
Wiki akshan-q.json (page1502462/rev4007510；canonical SHA 1cbf7dda…)
  → Backend seed（lol_generic_akshan_avengerang_first_outbound_hit_seed.sql；
     provider_hero_akshan_q_avengerang_first_outbound_hit；
     一笔物理命中 165+0.70*(ad.resolved-ad.base)；精确嵌套二元；bonus AD 显式减法；
     type 20220 / add 20170；无 20230；无显式 event；无 Q-specific type；
     absent-only mana resource ON CONFLICT DO NOTHING（派生自 panel mana；永不覆盖）；
     hero/ad/mana panel EAV 与 Dirty Fighting/basic repository-owned/preserved；
     standalone Q；不合成 ability-hit stacks）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/immediate-cooldown-scaffold → null-duration impact + on_enter sequence
    → 一笔 physical first-outbound-pass damage（精确嵌套二元 165+0.70*(ad.resolved-ad.base)；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_akshan_avengerang_first_outbound_hit_seed.sql`（bytes `30848`；SHA256 `d45d8297352597ecd4581fef40c80c1824e51e42b938b0bcfa6ae653cbc81dcd`）+ `LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest`（bytes `59429`；SHA256 `2f64e5c0bd960c8767d2b85847b342948de266bd4e13a1e92743f376d7cac296`）；README `server/data_manage/README.md` bytes `291215` / SHA256 `188b0174fc7647efbdcaf6388d537afe1c164ed4dbda5b1ce549589b13a5310b`（owning commit 处；**聚合 README 全文件 hash 仅为历史材料身份**，**故意不是**持续 Wasm 测试不变量）：独立 `provider_hero_akshan_q_avengerang_first_outbound_hit`；80 mana / immediate 5000ms CD scaffold；immediate selected-primary champion first-outbound-pass single physical hit scaffold；一笔精确嵌套二元物理（bonus AD 显式减法）；absent-only mana resource `ON CONFLICT DO NOTHING`；hero/ad/mana panel EAV 与 Dirty Fighting/basic **repository-owned/preserved**；不 live-publish；standalone Q。owning `bd8dbcbd5768460a6921465dd3e6c8c6a464948f`（`run-70747b97-7856-45ed-89aa-56ea1c223360`；runDelta3/outside0；主 focused12 / full1010 PASS）。镜像 `45d589a71aebfe9435c23c68a8fc007b7198f59c`（`run-5be3a5ed-b33b-4665-83fb-4012e26692fa`；runDelta3/outside0；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮不变。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。Production Wasm/public ABI/Web 变更**不**需要 |
| Wasm | exact `b58a54941463ebf6ec1350529915721fde381030`（`generic_akshan_avengerang_first_outbound_hit_test.go`；test bytes `66516` / SHA256 `dc922f4249cb87a5f6afda8f3a88dac011cc5a5683ff6c0a9a8c5cfd16618805`；同提交含 Ezreal durability-repaired test bytes `67920` / SHA256 `db308c2af5c6741fdc470e76a83edf2f71204fb3bc259cbb6c8f860fbb719767`）；最终 runtime/test-governance run `run-e99bc519-beea-449d-8947-95e9ca0ba7c7`（runDelta2/outside0；47/47 complete tool groups；无 truncation）。主验证：focused Akshan/Ezreal、Akshan `-count=100`、full Go、TinyGo build、Node smoke/bench PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；英雄名 `_test.go` **仅为**机制级回归/治理证据，**排除**于 normal/TinyGo 生产构建；**无**英雄专用生产分支；**无**生产 runtime 或 ABI 实现变更；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana240；baseAD52；resolvedAD152；armor100） | 扣 80 mana；一笔物理命中（raw235→final117.5）；immediate 5000ms CD scaffold 武装；一次 `ability_started` |
| t4999（CD scaffold 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t5000 再次成功 | 第二次物理命中；两笔 Q damage；两次 `ability_started`；final mana80；HP1000→765 |
| mana79 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 base52/resolved52/armor100 | raw165；final82.5 |
| 交叉 base52/resolved152/armor100 | raw235；final117.5 |
| bonus-AD 减法证明 | base0/resolved100 与 base52/resolved152 均 raw/final235 |
| Standalone / Dirty Fighting | 保留 Dirty Fighting/basic；Q 不合成 ability-hit stacks |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止覆盖 repository-owned hero/ad/mana panel EAV 或 Dirty Fighting/basic；禁止把 immediate 5000ms scaffold 误称为真实返回后冷却；禁止引入 Q-specific type；禁止把本首段出站命中误称为完整 Q |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | 正式最终 READY `run-bde07e54-a7f2-4ba5-878c-39209b3593e0`；26/26 complete tool groups；runDelta0；无 truncation/mutation；无 user decision；**省略**聚合 event-total。v1 `run-0abb40b7…` valid REVISE（1855/1855；46/46；delta0；absent-only mana + cooldown-start-after-return 文档化均已接受）。v2 READY `run-11d562ed…`（1682/1682；36/36；delta0）曾治理初始 Backend；被中止的 v2 Wasm test run **不是**完成证据。v3 `run-f627e870…` REVISE（2169/2169；52/52；delta0；fixture truth/scope 校正均已接受）。**v4 为正式最终门控** |
| Backend owning | owning `bd8dbcbd5768460a6921465dd3e6c8c6a464948f`；`run-70747b97-7856-45ed-89aa-56ea1c223360`（runDelta3/outside0）；主 focused12 / full1010 PASS；seed bytes30848 / SHA `d45d8297…c81dcd`；JUnit bytes59429 / SHA `2f64e5c0…cac296`；README bytes291215 / SHA `188b0174…a5310b`（历史材料身份；非持续 Wasm 测试不变量） |
| Backend 镜像（Wasm worktree） | `45d589a71aebfe9435c23c68a8fc007b7198f59c`；`run-5be3a5ed-b33b-4665-83fb-4012e26692fa`（runDelta3/outside0；精确 parity） |
| Wasm exact | `b58a54941463ebf6ec1350529915721fde381030`；`run-e99bc519-beea-449d-8947-95e9ca0ba7c7`（runDelta2/outside0；47/47 complete tool groups）；focused Akshan/Ezreal、Akshan count100、full/build/smoke/bench PASS；Akshan test bytes66516 / SHA `dc922f42…618805`；Ezreal durability-repaired test bytes67920 / SHA `db308c2a…719767`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据（排除生产构建） |
| Web | 无本机制写入；Built/独立 Web worktree 资产 `1,169,377` / `65a4…c6a0`；Production Wasm/public ABI/Web 变更不需要 |
| 审计接受 | commit `144d6e9ed63b1e0c1371135acd48d30d85fb207c`；审计 run `run-dc10edec-b547-4b3d-a36a-b35a03e87e75`（runDelta8/outside0；88/88 complete tool groups；无 truncation）。主五检查通过；语义比较证明**仅** Akshan Q G8/Unified 记录变化，且 provisional **仅**移除 Akshan Q |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated90 / partial4 / blocked79 / OOS69；inScope173；Unified sourceCount12 / total254；completed100 / partial_actionable0 / ready0 / blocked_runtime73 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full100 / partial3 / none151；implementation gap **仍为 58**（Akshan Q **不在**该家族，故未减）；actionable0；provisional76（runtime73/data3；hero74/item2）。治理 tasks 必须为 114。报告口径：严格 verified completion **100/254=39.4%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 76 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张。稳定 digests：Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki registry `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7` |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Akshan Q 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Akshan Q（77→76）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。`implementation_gap_no_unresolved_data_fields` **仍为 58**，因为 Q **不在**该家族。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only / 机制级回归证据追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。Production Wasm/public ABI/Web 变更**不**需要。

非目标（再次强调）：cast/effect-at-cast-end、direction/range/range extension/geometry、projectile/travel/speed/collision/return/homing、真实冷却在返回后开始、second return pass/total two-pass/once-per-pass、sight/reveal、movement speed/AP movement ratio/decay、nonchampion scaling、spellshield、Dirty Fighting ability-hit wiring、ranks1-4、siblings/loadout/bootstrap、live migration/Admin publish/browser E2E/full Avengerang/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Avengerang/游戏技能保真；immediate 5000ms CD scaffold **不是**真实返回后冷却的 faithful approximation；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Akshan Q 为 standalone；保留 Dirty Fighting/basic；Q 不合成 ability-hit stacks；Backend absent-only mana `ON CONFLICT DO NOTHING`；伤害为 **bonus AD 显式减法**（精确嵌套二元）；类型 **20220** / add **20170**；无 20230；无 Q-specific type；英雄名 `_test.go` 排除于生产构建且不改变生产 runtime/ABI——**不**损害 generic runtime 实现主张。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1502462 / rev4007510 / timestamp2026-04-11T22:35:01Z / canonical raw2570 / SHA256 `1cbf7dda…5b5f5b`；normalized2948 / SHA `f6b0dd49…6d9a1a`；pages688 / SHA `11d2da87…8509e0`；sidecar/pages canonical；local raw2570 / SHA `407e4671…b8c973` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_akshan\|Q\|去而复还` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标首段出站物理命中；immediate 5000ms CD scaffold ≠ 真实返回后冷却 |
| 公式 / fixtures | 精确嵌套二元 `165+0.70*(ad.resolved-ad.base)`；type 20220 / add 20170；无 20230；无显式 event op；无 Q-specific type；数值与 CD/resource 日程；自动 `ability_started`；standalone；保留 Dirty Fighting/basic；四 tags 序；含 bonus-AD 减法证明 |
| Backend | owning `bd8dbcb…` / 镜像 `45d589a…`；focused12 + full1010；absent-only mana；无 live seed |
| Wasm | exact `b58a549…`；focused Akshan/Ezreal、count100、full/build/smoke/bench；英雄名 `_test.go` 仅机制级回归/治理证据；无生产 Wasm/Web/ABI 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA；Production 变更不需要 |
| 审计 | commit `144d6e9…`；接受 run `run-dc10edec…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Akshan Q 语义对象变化；provisional 仅移除 Akshan Q；counts 与 §5 最终清单一致；implementation_gap 仍 58 |
| 设计门控 | 正式最终 READY `run-bde07e54…`；26/26 complete tool groups；runDelta0；无 truncation/mutation；无 user decision；省略聚合 event-total；v1/v3 REVISE 校正已接受；v2 READY 非最终完成证据；被中止 v2 Wasm test 非完成证据 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
