TASK_KEY: wasm-generic-corki-missile-barrage-normal-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 库奇 R 火箭轰击（Missile Barrage）普通导弹主目标命中 Phase-A 详细设计

关联验证记录：[通用 ABI 库奇 R 火箭轰击普通导弹主目标命中 Phase-A 验证记录](../../测试记录/wasm/通用ABI-库奇R火箭轰击普通导弹主目标命中Phase-A验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_corki|R|火箭轰击` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 direction/projectile/travel/collision/explosion、AOE/multitarget、Big One/third-shot cycle/double damage、range/radius、periodic stock/recharge/respawn refill、basic-attack on-hit recharge reduction/crit scaling、Malignance/Eclipse、other ranks、live/full fidelity；本闭环**恰好是一次普通导弹选定主目标首个敌人物理命中**，**不是**完整 R；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV corki-r-missile-barrage-normal-primary-hit-phase-a-v1`（DESIGN_READY `run-504c31b1-9af8-42d2-956c-20f85c541726`；READY；runDelta0/outside0；2198 events；103/103 complete tool groups；无 truncation/mutation/blockers。Production Wasm / public ABI / Web 变更**不**需要）。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对 Corki R 建立**有界 Phase-A** 证据闭环：Rank-3 普通导弹选定主目标**首个敌人**单次物理命中脚手架（immediate impact）+ 35 mana 与一枚 `missile_barrage_ammo` 原子门控/消耗，使候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- direction / projectile / travel / collision / explosion
- AOE / multitarget
- Big One / third-shot cycle / double damage
- range / radius
- periodic stock / recharge / respawn refill
- basic-attack on-hit recharge reduction / crit scaling
- Malignance / Eclipse interaction
- other ranks / siblings beyond Q coexistence / loadout / bootstrap
- live migration / Admin publish / browser E2E / 完整 Missile Barrage / 完整游戏保真

**精确普通导弹有界完成 ≠ 完整 R 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_corki\|R\|火箭轰击` |
| Wiki request / resolved | `Template:Data Corki/R` → `Template:Data Corki/Missile Barrage` |
| Wiki 身份 | pageId `1306946`；revision `4042863`；timestamp `2026-07-14T19:35:26Z`；canonical raw bytes `3065`；SHA256 `1c2da7a1ea6bd4904c498eeb823e75dbf0f1e354cf5fe22f72dee2bb09ac4845` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/corki-r.json` bytes `3265` / SHA256 `dcaa1352eba2fa1d6c2acfc1aba9320bccb200b5b9d00dba559373e0981adbe0`；pages sibling `pages/corki-r.json` bytes `691` / SHA256 `694cda4c4d4ee4e9606ac1ca82a7085f89b7898884b23653bf718e86bfcd5bc7` 为权威 |
| local raw caveat | `raw/corki-r.wikitext` bytes `3063` / SHA256 `3764aafcecd5ef76f619472e443869c2ef43fd5b062894f6e111172f9a5cf91a`——**local raw materialization caveat only**；**故意不断言**字节等价，亦**不得**表述为源矛盾 |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_normal_missile_selected_primary_champion_first_enemy_hit; immediate_impact_scaffold; physical_250_plus_0_85_bonus_ad; mana35_plus_one_missile_barrage_ammo_atomic_gate_and_spend; initial_ammo_two_max_four; cooldown2000ms; no_direction_projectile_travel_collision_explosion_aoe_multitarget_big_one_third_shot_cycle_double_damage_range_radius_periodic_stock_recharge_respawn_refill_basic_attack_on_hit_recharge_reduction_crit_scaling_malignance_eclipse_interaction_other_ranks_or_full_fidelity` |
| G8 governed tags（序） | `ability_cost_cooldown`、`ammo_gate_and_spend`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| Unified 输出序 | 既有全局 canonical sort 发出 `ability_cost_cooldown`、`active_physical_damage`、`ammo_gate_and_spend`、`bonus_ad_ratio`、`immediate_impact_scaffold`——**表示层规范化**，**不是**合同丢失 |
| Rank-3 normal missile | 35 mana + 一枚 `missile_barrage_ammo` **原子**门控/消耗；初始 ammo2 / max4；2000ms CD；immediate selected-primary first-enemy physical `250+0.85*(ad.resolved-ad.base)`；非暴击/不可复制；成功施放自动一次 `ability_started` |
| Provider | 独立 `provider_hero_corki_r_missile_barrage_normal_primary_hit`；standalone R 图；可与 Corki Q **共存**；**不**合成 P/W/E/basic |
| 数值交叉 | zero bonus → raw/final250；bonusAD100 → raw335；armor100 → final167.5；equal-bonus 反证两边均 raw335 |
| 日程交叉 | Mana240/Ammo2/HP1000：t0/t1999/t2000 → success/skip/success；mana170/ammo0/HP665；两次自动 `ability_started`；Mana34 或 Ammo0 → skip 且不变 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 4. 通用 ABI 图

```text
Wiki corki-r.json (page1306946/rev4042863；canonical SHA 1c2da7a1…)
  → Backend seed（lol_generic_corki_missile_barrage_normal_primary_hit_seed.sql；
     hero_corki/ad/mana = external existing-data/check-only；
     seed 仅拥有 missile_barrage_ammo 定义/实体行 + standalone R 图；
     与 Corki Q 共存；
     step0 ammo -1；step1 物理 250+0.85*(ad.resolved-ad.base)）
    → Web 既有 generic 投影（无本机制 Web 写入；Built/独立 Web 当前 hash 校验一致）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → mana cost + ammo castCondition gate → ammo spend + physical hit
    → 自动 ability_started ×1 / 成功施放
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_corki_missile_barrage_normal_primary_hit_seed.sql`（bytes `36526`；SHA256 `089563418bff1bb674f3342345b79d652c37d8f3bb42168b20b98a70c4ba8e40`） |
| JUnit | `LolGenericCorkiMissileBarrageNormalPrimaryHitSeedSqlTest`（bytes `58372`；SHA256 `74f15e003fa99abe7f98022212ec20ff2e3610a09763a90d1344c22b95079e9c`） |
| README | `server/data_manage/README.md` bytes `318576` / SHA256 `bf0039cd07b70adc5754d5999c7e5aebcd3bab25e70308cb4222f966bf5a3b37` |
| 前置 | `hero_corki` / ad / mana 为 **external existing-data/check-only** |
| seed 拥有 | 仅 `missile_barrage_ammo` 定义/实体行 + standalone R graph；与 Corki Q 共存 |
| owning | `2c2392a5ef17eb194712f5e0da75f81ec997215e`（`run-4fb341ff-da52-47e4-91ac-1ee74dd0f895`；exact 3 paths；runDelta3/outside0；944 events；55/55 complete；无 truncation） |
| 主验证 | focused32 + full1054 PASS |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_corki_missile_barrage_normal_primary_hit_test.go` |
| bytes / SHA | `51481` / SHA256 `874265e28661bb49da04e83b2cb5471286940ae856e50cbb195be2c69eff15b6` |
| commit / run | `d99d01e06745dc8aed3433ddfc7df190721ce42f`；`run-4c80644c-9da0-4c81-87b8-8c40ea78576a`（exact one `_test.go`；runDelta1/outside0；985 events；87/87 complete；无 truncation） |
| 地位 | 英雄名 `_test.go` **仅为**验收证据，**排除**于生产构建；仅 generic Provider/Ability/Formula/resource 操作；**无**英雄专用生产分支 |
| 主验证 | focused/full Go + bench PASS；最新 main bench mean_us **112.16** |
| 生产 / Web | **无**生产 Wasm / Web 写入。Built 与独立 Web 资产均为 **1169377** / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`——**当前 hash 校验**，**不是** test-only 切片重建生产 Wasm |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| zero bonus | raw/final250 |
| bonusAD100 | raw335 |
| armor100 | final167.5 |
| equal-bonus 反证 | 两边均 raw335 |
| Mana240/Ammo2/HP1000；t0/t1999/t2000 | success/skip/success；mana170/ammo0/HP665；两次 `ability_started` |
| Mana34 或 Ammo0 | skip；资源/HP 不变 |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计 commit | `2548f35d3aa1dc4c5682ba53181c92fbaddd9160` |
| 审计 run | `run-b3aafd84-bb1a-44e7-b0ff-c05ef516a895`（exact 8 paths；runDelta8/outside0；1318 events；89/89 complete；无 truncation） |
| 主验收 | 主会话重跑五审计 check + exact record/count/digest/evidence 断言 + `git diff --check`，全部 PASS |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated94/partial4/blocked75/OOS69；Unified254/source12 completed104/blocked_runtime69/blocked_data3/OOS72/regression5/stale1；full104/partial3/none147；actionable0；`implementation_gap` **54**；provisional72=runtime69/data3；hero70/item2 |
| 报告口径 | 严格 verified completion **104/254=40.9%**；completed+provisional descriptive coverage **176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**：无实现/模板/后续队列。真剩余队列 **仅 72** = blocked_runtime69 + blocked_data3 |
| 完成语义 | Corki 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **118** |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1306946 / rev4042863 / timestamp2026-07-14T19:35:26Z / canonical3065 / SHA `1c2da7a1…ac4845`；normalized3265 / SHA `dcaa1352…1adbe0`；local raw3063 / SHA `3764aafc…5cf91a` materialization caveat only |
| 边界 | exact `completedBoundary`；普通导弹选定主目标首个敌人物理命中，不是完整 R |
| 公式 / fixtures | `250+0.85*(ad.resolved-ad.base)`；mana35+ammo 原子门控/消耗；ammo2/max4；2000ms；§7 fixtures |
| Backend | owning `2c2392a…`；focused32 + full1054；ammo seed only；Q 共存；无 live |
| Wasm | exact `d99d01e…`；英雄名 `_test.go` 仅测试/治理；无生产/Web 写入 |
| 审计 | 接受 `2548f35…`；counts 与 §8 一致；impl-gap54；tasks118 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
