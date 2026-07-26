TASK_KEY: wasm-generic-jinx-flame-chompers-primary-explosion-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 金克丝 E 嚼火者手雷（Flame Chompers!）主目标爆炸命中机制详细设计

关联验证记录：[通用 ABI 金克丝 E 嚼火者手雷 Flame Chompers 主目标爆炸命中机制验证记录](../../测试记录/wasm/通用ABI-金克丝E嚼火者手雷FlameChompers主目标爆炸命中机制验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_jinx|E|嚼火者手雷！` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 three-Chomper layout/count/identity、location/direction/range/geometry/radius/area/multitarget、landing 0.4s / arming 0.5s / lifetime 5s delays、contact/collision/acquisition/one-per-champion、knockdown/root/CC、Wind Wall/Braum/spell-shield exception/vision、ranks 1–4、P/Q/W/R/basic/loadout/bootstrap、live/Admin/E2E/full E/full-game fidelity；本闭环**恰好是一次选定主目标敌方英雄单次魔法爆炸命中量子**，**不是**完整 E 或游戏内一次 E 总命中；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV jinx-e-flame-chompers-primary-explosion-hit-phase-a-v1`（有效 DESIGN_READY `run-893fcb26-cd49-4bb2-9bc7-4a231b13762f`；strict `grok-4.5`；effort high；fast false；runDelta0；1750 parseable event lines；无 truncation / mutation / user decision；**无** prior REVISE；production Wasm/public ABI/Web 变更**不**需要）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_jinx\|E\|嚼火者手雷！` |
| Wiki | 请求 `Template:Data Jinx/E`，解析为 `Template:Data Jinx/Flame Chompers!`；pageId `1307600`；revision `3993368`；timestamp `2026-02-21T15:35:19Z`；canonical raw bytes `1786`；SHA256 `64562ed4adb34c932810970fd9b9c016b46329d6f956541d334c60d2bc9d83ee`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/jinx-e.json` bytes `2228` / SHA256 `de7922f66deb96c8652dd1a0509105b49cdcf22278d1fd591bc366060987183a` plus pages sibling bytes `694` / SHA256 `f2822e5708dd024c582575a9298c12b6e6cd66b37e3365ea8749e8e1d49b360d` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `1784` bytes，SHA256 `aabb099fd172522682e40f0826e4971797c3a047787ef3c5af902bc4b673a551`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold` |
| Rank-5 active | 90 mana；10000ms cooldown；immediate selected-primary-champion single magic explosion-hit scaffold；每次成功施放恰好一笔非暴击/不可复制魔法爆炸命中 `290 + 1.00 * source.attr.ap.resolved`（**精确嵌套二元** `add(const 290, mul(const 1.00, read source.attr.ap.resolved))`；**恰好一次 AP 读取**；伤害类型 **20221** + add 策略 **20170**；**无** 20230；**无**显式 event op；**无** E-specific type）；成功施放自动合成恰好一次 `ability_started`；**零** E state / modifier / listener / matcher / repeat / control / projectile / Chomper layout |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定主目标单次魔法爆炸命中量子**。Immediate impact + cooldown 为 Phase-A scaffold；**不**建模三枚 Chomper / 落地武装寿命 / 几何范围 / 接触获取 / 击倒禁锢 / 风墙布隆 / 法术护盾例外 / 视野，或完整 E 保真 |
| Standalone / isolation | Jinx E provider **独立**；**有界** E/W 共存隔离（E 不触发/突变 W，W 不触发/突变 E）；**不**合成 P/Q/R/basic；**不**合成 Batch-B 或 sibling Jinx 机制 |
| Backend 前置 | 仓库对 `hero_jinx` / AP / mana 为 **external-existing-data/check-only**；seed/JUnit **不**写入 identity/panel/resource materialization；**不**宣称 Jinx W/Batch-B 拥有前置；**不** live-publish |
| 数值交叉 | MR100 AP0 → raw290 / final145；AP100 → raw390 / final195；无关 AD 反证（伤害不随 AD 变化） |
| 日程交叉 | mana270 / AP100 / HP1000 / MR100：t0 / t9999 / t10000 → success / skip / success；恰好两笔 E damage；两次自动 E `ability_started`；final mana90 / HP610；mana89 → resource skip / mana/HP 不变 / 无 E damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对所选主冠军结算一次有界单次魔法爆炸命中；不代表完整 Flame Chompers! 三枚陷阱、落地/武装/寿命、几何范围、接触获取、击倒禁锢或完整 E。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| three-Chomper layout / count / identity | 三枚嚼火者布局、数量与身份全部排除 |
| location / direction / range / geometry / radius / area / multitarget | 落点、方向、射程、几何、半径、范围与多目标全部排除 |
| landing 0.4s / arming 0.5s / lifetime 5s delays | 落地、武装与寿命延迟全部排除 |
| contact / collision / acquisition / one-per-champion | 接触、碰撞、获取与每英雄仅一枚全部排除 |
| knockdown / root / CC | 击倒、禁锢与其它控制全部排除 |
| Wind Wall / Braum / spell-shield exception / vision | 风墙、布隆、法术护盾例外与视野全部排除 |
| ranks 1–4 | 仅 Rank5 |
| P / Q / W / R / basic / loadout / bootstrap | 无其它技能/普攻/负荷/bootstrap 合成（有界 E/W isolation 除外） |
| live / Admin / E2E / full E / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标魔法爆炸命中量子**，不是完整 E 或游戏内一次 E 总命中 |

## 3. 端到端数据流

```text
Wiki jinx-e.json (page1307600/rev3993368；canonical SHA 64562ed4…)
  → Backend seed（lol_generic_jinx_flame_chompers_primary_explosion_hit_seed.sql；
     provider_hero_jinx_e_flame_chompers_primary_explosion_hit；
     一笔魔法爆炸命中 290+1.00*ap.resolved；精确嵌套二元；一次 AP 读；
     type 20221 / add 20170；无 20230；无显式 event；无 E-specific type；
     hero_jinx/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone E；有界 E/W isolation）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic primary-explosion-hit damage（精确嵌套二元 290+1.00*AP；20221/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_jinx_flame_chompers_primary_explosion_hit_seed.sql`（bytes `27322`；SHA256 `686ff89b4f29b1697e478d2f1b676d80a9bd3288e460bea4f57e0a3b7583ee6f`）+ `LolGenericJinxFlameChompersPrimaryExplosionHitSeedSqlTest`（bytes `46529`；SHA256 `519c3e5ce2844d41bdc348441056352fb893633ca084bb261f63bffd0300d35a`）；README `server/data_manage/README.md` bytes `305324` / SHA256 `bc71abfed04e04299a78bc8f17ae17ad619e779cb014d65bf8ed3912eb86b7be`（owning commit）：独立 `provider_hero_jinx_e_flame_chompers_primary_explosion_hit`；90 mana / 10000ms CD；immediate selected-primary-champion single magic explosion-hit scaffold；一笔精确嵌套二元魔法；`hero_jinx`/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone；有界 E/W isolation）。owning `df08d6b341d85b3c43bc70e33e43eae0cb736ac8`（`run-1f38cae0-444e-4601-b316-9a74886b6b44`；runDelta3/outside0；主 focused37 / full1032 PASS）。镜像 `3b26d3e74a6eb460bb641f42a1909f9735eb7dbd`（`run-1554558c-1d6b-4add-9cd8-4d52c89a6b97`；runDelta3/outside0；精确 parity；主 focused18 PASS）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮不变。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `9320b4dafc6225a3a20829de17223a0a6d715787`（`generic_jinx_flame_chompers_primary_explosion_hit_test.go`；test bytes `63966` / SHA256 `59ee84f4b61bee5f86d8cc374204e2551161e18fd20b20d9db17d8b51553741b`）；实现 run `run-5b26afad-2b5f-42b7-bc71-81ae5aaff897`（runDelta1/outside0）。主验证：focused 7 top-level / count=100 / E+W / full Go / Go bench / TinyGo build / Node smoke+bench PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；英雄名 `_test.go` **仅为**测试/治理 fixture，**排除**于 normal/TinyGo 生产构建；仅构造 generic Provider/Ability/Formula 路径；**无**英雄专用生产分支或 public ABI 变更——**不**损害 generic 实现主张；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana270；AP100；MR100） | 扣 90 mana；一笔魔法爆炸命中（raw390→final195）；CD 武装；一次 `ability_started` |
| t9999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t10000 再次成功 | 第二次魔法爆炸命中；两笔 E damage；final mana90；HP1000→610；两次 `ability_started` |
| mana89 | resource skip；mana/HP 不变；无 E damage/event |
| 交叉 MR100 AP0 | raw290；final145 |
| 交叉 MR100 AP100 | raw390；final195 |
| 无关 AD 反证 | 伤害不随 AD 变化 |
| Standalone / E/W isolation | 不合成 P/Q/R/basic；E 不触发/突变 W；W 不触发/突变 E |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Jinx；禁止引入 20230 / 显式 event / E-specific type；禁止把本主目标爆炸命中误称为完整 E 或一次游戏内 E 总命中 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-893fcb26-cd49-4bb2-9bc7-4a231b13762f`；READY；strict `grok-4.5`；effort high；fast false；runDelta0；1750 parseable event lines；无 truncation/mutation/user decision；无 prior REVISE；production Wasm/public ABI/Web 变更不需要 |
| Backend owning | owning `df08d6b341d85b3c43bc70e33e43eae0cb736ac8`；`run-1f38cae0-444e-4601-b316-9a74886b6b44`（runDelta3/outside0）；主 focused37 / full1032 PASS；seed bytes27322 / SHA `686ff89b…7583ee6f`；JUnit bytes46529 / SHA `519c3e5c…00d35a`；README bytes305324 / SHA `bc71abfe…86b7be` |
| Backend 镜像（Wasm worktree） | `3b26d3e74a6eb460bb641f42a1909f9735eb7dbd`；`run-1554558c-1d6b-4add-9cd8-4d52c89a6b97`（runDelta3/outside0；精确 parity；主 focused18 PASS） |
| Wasm exact | `9320b4dafc6225a3a20829de17223a0a6d715787`；`run-5b26afad-2b5f-42b7-bc71-81ae5aaff897`（runDelta1/outside0）；focused7 top-level/count=100/E+W/full Go/Go bench/TinyGo/Node smoke+bench PASS；test bytes63966 / SHA `59ee84f4…53741b`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无生产/Web 写入；英雄名 `_test.go` 仅测试/治理 fixture（排除生产构建；仅 generic 合同路径） |
| Web | 无本机制写入；Built/独立 Web worktree 资产 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `577d8c584f65b001e7a8000cc8c6ac333727629f`；审计 run `run-c7d01be2-4efd-4e7a-b81d-99e72017758e`（runDelta8/outside0；1233 event lines；无 truncation）。主五检查 PASS；语义比较证明**仅** Jinx E 在 G8/Unified 变化，且 provisional **仅**移除 Jinx E；稳定 key order/digests |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated92 / partial4 / blocked77 / OOS69；inScope173；Unified sourceCount12 / total254；completed102 / partial_actionable0 / ready0 / blocked_runtime71 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full102 / partial3 / none149；implementation gap56；actionable0；provisional74（runtime71/data3；hero72/item2）。治理 tasks 必须为 116。报告口径：严格 verified completion **102/254=40.2%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 74 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张。稳定 digests：Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki registry `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7` |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段（含历史 `classification=out_of_scope_for_single_target_dps` / `mechanismTags=meta_or_non_target_dps` / `auditBaseline.gapCode=blocked_data` / `damageDisposition=primary_damage_branch_salvage`）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Jinx E 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Jinx E（75→74）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。`implementation_gap_no_unresolved_data_fields` **降至 56**（Jinx E **离开**该家族）。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only / 机制级回归证据追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

英雄名 `_test.go` 说明：文件名含英雄仅为**测试/治理身份**；它构造并行使 generic Provider / Ability / Formula 合同路径，**排除**于生产构建，**不**引入英雄专用生产分支或 public ABI 变更，**不**损害 generic 实现主张。

非目标（再次强调）：three-Chomper layout/count/identity、location/direction/range/geometry/area/multitarget、landing/arming/lifetime delays、contact/collision/acquisition/one-per-champion、knockdown/root/CC、Wind Wall/Braum/spell-shield exception/vision、ranks1-4、P/Q/W/R/basic/loadout/bootstrap、live/Admin/E2E/full E/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Flame Chompers!/游戏技能保真；本闭环**恰好是一次选定主目标魔法爆炸命中量子**，**不是**完整 E 或一次游戏内 E 总命中；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Jinx E 为 standalone + 有界 E/W isolation；Backend external-existing-data/check-only；伤害为 **仅 AP**（精确嵌套二元；一次 AP 读）；类型 **20221** / add **20170**；无 20230；无 E-specific type。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307600 / rev3993368 / timestamp2026-02-21T15:35:19Z / canonical raw1786 / SHA256 `64562ed4…9d83ee`；normalized2228 / SHA `de7922f6…87183a`；pages694 / SHA `f2822e57…9b360d`；sidecar/pages canonical；local raw1784 / SHA `aabb099f…73a551` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_jinx\|E\|嚼火者手雷！` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标魔法爆炸命中量子 |
| 公式 / fixtures | 精确嵌套二元 `290+1.00*ap.resolved`；一次 AP 读；type 20221 / add 20170；无 20230；无显式 event op；无 E-specific type；数值与 CD/resource 日程；自动 `ability_started`；零 E state/modifier/listener；standalone + 有界 E/W isolation；四 tags 序 |
| Backend | owning `df08d6b…` / 镜像 `3b26d3e…`；focused37 + full1032；无 live seed |
| Wasm | exact `9320b4da…`；focused7/count=100/E+W/full/bench/build/smoke；英雄名 `_test.go` 仅测试/治理 fixture；无生产 Wasm/Web/ABI 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `577d8c58…`；接受 run `run-c7d01be2…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Jinx E 语义对象变化；provisional 仅移除 Jinx E；counts 与 §5 最终清单一致；implementation_gap 56 |
| 设计门控 | 有效 READY `run-893fcb26…`；runDelta0；1750 events；无 truncation/mutation；无 prior REVISE |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
