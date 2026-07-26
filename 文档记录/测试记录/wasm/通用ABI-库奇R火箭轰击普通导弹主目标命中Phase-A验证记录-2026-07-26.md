TASK_KEY: wasm-generic-corki-missile-barrage-normal-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 库奇 R 火箭轰击普通导弹主目标命中 Phase-A 验证记录

详细设计：[通用 ABI - 库奇 R 火箭轰击（Missile Barrage）普通导弹主目标命中 Phase-A 详细设计](../../详细设计/wasm/通用ABI-库奇R火箭轰击普通导弹主目标命中Phase-A详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_corki|R|火箭轰击`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Corki/R`，解析 `Template:Data Corki/Missile Barrage`；page `1306946` / rev `4042863` / timestamp `2026-07-14T19:35:26Z`；canonical raw bytes `3065`；SHA256 `1c2da7a1ea6bd4904c498eeb823e75dbf0f1e354cf5fe22f72dee2bb09ac4845`；normalized sidecar bytes `3265` / SHA256 `dcaa1352eba2fa1d6c2acfc1aba9320bccb200b5b9d00dba559373e0981adbe0` plus pages sibling bytes `691` / SHA256 `694cda4c4d4ee4e9606ac1ca82a7085f89b7898884b23653bf718e86bfcd5bc7` 为权威；sourceCount **仍为 12**。本地 raw materialization 为 `3063` bytes，SHA256 `3764aafcecd5ef76f619472e443869c2ef43fd5b062894f6e111172f9a5cf91a`——**local raw materialization caveat**；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_normal_missile_selected_primary_champion_first_enemy_hit; immediate_impact_scaffold; physical_250_plus_0_85_bonus_ad; mana35_plus_one_missile_barrage_ammo_atomic_gate_and_spend; initial_ammo_two_max_four; cooldown2000ms; no_direction_projectile_travel_collision_explosion_aoe_multitarget_big_one_third_shot_cycle_double_damage_range_radius_periodic_stock_recharge_respawn_refill_basic_attack_on_hit_recharge_reduction_crit_scaling_malignance_eclipse_interaction_other_ranks_or_full_fidelity`。G8 governed tags 序：`ability_cost_cooldown`、`ammo_gate_and_spend`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`。Unified 发出序为 `ability_cost_cooldown`、`active_physical_damage`、`ammo_gate_and_spend`、`bonus_ad_ratio`、`immediate_impact_scaffold`（全局 canonical sort 表示层规范化，非合同丢失）。合同：Rank3 普通导弹；35 mana + 一枚 `missile_barrage_ammo` 原子门控/消耗；ammo2/max4；2000ms CD；一笔非暴击/不可复制物理 `250+0.85*(ad.resolved-ad.base)`。交叉：zero bonus raw/final250；bonus100 raw335；armor100 final167.5；equal-bonus 两边335；Mana240/Ammo2/HP1000 t0/t1999/t2000 success/skip/success → mana170/ammo0/HP665/两次 `ability_started`；Mana34 或 Ammo0 skip 不变。Backend：`hero_corki`/ad/mana external existing-data/check-only；seed 仅 `missile_barrage_ammo` + standalone R，与 Corki Q 共存。Wasm 英雄名 `_test.go` 仅为验收证据并排除生产构建。**不**宣称完整 R 保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: corki-r-missile-barrage-normal-primary-hit-phase-a-v1`；DESIGN_READY `run-504c31b1-9af8-42d2-956c-20f85c541726`；运行时/审计已提交）填写。下列验证结果按实现与主会话复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push、browser E2E、production TinyGo runtime、public ABI 或 Web 变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。当前 Built 与独立 Web 资产 hash 校验一致（见 §2.4）——**不是** test-only 切片重建生产 Wasm。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY v1 | `run-504c31b1-9af8-42d2-956c-20f85c541726` | READY；runDelta0/outside0；2198 events；103/103 complete；无 truncation/mutation/blockers | **接受门控** |
| Backend owning | `2c2392a5ef17eb194712f5e0da75f81ec997215e`；`run-4fb341ff-da52-47e4-91ac-1ee74dd0f895` | exact 3 paths；runDelta3/outside0；944 events；55/55 complete；无 truncation；seed36526/`08956341…a8e40`；JUnit58372/`74f15e00…79e9c`；README318576/`bf0039cd…a3b37`；focused32/full1054 PASS | 接受 |
| Wasm exact | `d99d01e06745dc8aed3433ddfc7df190721ce42f`；`run-4c80644c-9da0-4c81-87b8-8c40ea78576a` | exact one `_test.go`；runDelta1/outside0；985 events；87/87 complete；无 truncation；test51481/`874265e2…f15b6`；focused/full Go+bench PASS；mean_us112.16 | 接受 |
| 审计 | `2548f35d3aa1dc4c5682ba53181c92fbaddd9160`；`run-b3aafd84-bb1a-44e7-b0ff-c05ef516a895` | exact 8 paths；runDelta8/outside0；1318 events；89/89 complete；无 truncation；主重跑五 check+断言+`git diff --check` PASS | 接受 |
| Web | 无本机制写入 | 当前 Built/独立 Web 资产 `1169377` / `65a4…c6a0`（当前 hash 校验） | 接受；无 Web 变更 |

## 2. 验证结果（实现轮与主会话抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved / page / rev / timestamp / canonical / SHA | PASS；`Template:Data Corki/R` → `Template:Data Corki/Missile Barrage` / 1306946 / 4042863 / 2026-07-14T19:35:26Z / 3065 / `1c2da7a1…ac4845` |
| normalized / pages | 3265 / `dcaa1352…1adbe0`；pages 691 / `694cda4c…cd5bc7` 权威 |
| local raw caveat | 3063 / `3764aafc…5cf91a`；非源矛盾 |
| sourceCount | 仍为 12；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused / full Go / bench | PASS（主会话）；mean_us **112.16** |
| exact commit | `d99d01e06745dc8aed3433ddfc7df190721ce42f` |
| test bytes / SHA | `51481` / SHA256 `874265e28661bb49da04e83b2cb5471286940ae856e50cbb195be2c69eff15b6` |
| 实现 run | `run-4c80644c-9da0-4c81-87b8-8c40ea78576a`；runDelta1/outside0；985 events；87/87 |
| 英雄名 `_test.go` 地位 | 验收/治理证据 only；排除生产构建；仅 generic 合同路径；无英雄专用生产分支 |
| 生产 Wasm / Web 写入 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| focused / full Maven | PASS 32 / PASS 1054（主会话） |
| owning commit / run | `2c2392a5ef17eb194712f5e0da75f81ec997215e`；`run-4fb341ff-da52-47e4-91ac-1ee74dd0f895`；runDelta3/outside0；944 events；55/55 |
| seed / JUnit / README SHA256 | seed36526 / `089563418bff1bb674f3342345b79d652c37d8f3bb42168b20b98a70c4ba8e40`；JUnit58372 / `74f15e003fa99abe7f98022212ec20ff2e3610a09763a90d1344c22b95079e9c`；README318576 / `bf0039cd07b70adc5754d5999c7e5aebcd3bab25e70308cb4222f966bf5a3b37` |
| seed 合同 | hero_corki/ad/mana check-only；seed 仅 ammo + standalone R；与 Corki Q 共存 |
| live seed execution | **未**执行 |

### 2.4 Web / 资产 hash 校验

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit | **无** |
| 当前 Built / 独立 Web 资产 | **1169377** / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| 说明 | **当前 hash 校验**；**不是** test-only 切片重建生产 Wasm |
| Playwright / live E2E | **未**执行 |

### 2.5 G8 / Unified / provisional

| 验证 | 结果 |
| --- | --- |
| 五审计 `--check` + `git diff --check` | PASS（主会话；本切片亦复跑） |
| G8 governed | `migrated`；五 tags（G8 序含 `ammo_gate_and_spend`）；空 `remainingGap` |
| Unified 254 | sourceCount12；completed104 / actionable0 / blocked_runtime69 / blocked_data3 / OOS72 / regression5 / stale1 |
| coverage | full104 / partial3 / none147 |
| registry 242 | migrated48 / partial5 / blocked120 / OOS69（不变） |
| G8 242 | migrated94 / partial4 / blocked75 / OOS69 |
| provisional | 72 = runtime69 / data3；hero70 / item2；Corki R 缺席 |
| `implementation_gap_no_unresolved_data_fields` | **恰好 54**（Corki R 离开该家族） |
| digests | Unified `69832c2a…c018`；Wiki `927d8b5a…26c7`（不变） |
| 报告口径 | 严格 verified completion **104/254=40.9%**；completed+provisional coverage **176/254=69.3%** |
| OOS / 真队列 | `out_of_scope=72` 为最终跳过分类，无实现/模板/后续队列；真剩余队列 **仅 72** = blocked_runtime69 + blocked_data3 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；总体 Goal 仍活跃 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `2548f35d3aa1dc4c5682ba53181c92fbaddd9160` |
| 审计 run | `run-b3aafd84-bb1a-44e7-b0ff-c05ef516a895`；exact 8 paths；runDelta8/outside0；1318 events；89/89 complete；无 truncation |
| 主独立验收 | 五 check + exact record/count/digest/evidence + `git diff --check` PASS |
| live / publish / push / E2E | 未执行 |

### 2.7 设计门控

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-504c31b1-9af8-42d2-956c-20f85c541726`（2198 events；103/103；runDelta0/outside0） |
| Backend / Wasm | ammo seed only；Q 共存；英雄名 `_test.go` 验收证据 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON / tasks | PASS（tasks=118；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `node tools/task-governance/cli.mjs docs wasm-generic-corki-missile-barrage-normal-primary-hit` | PASS |
| G8 / Unified / provisional / Wiki-only / Batch-G `--check` | 全部 PASS |
| `git diff --check` | PASS；仅四条 allowlist 路径变更 |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 check/rebuild/check） |
| SQLite | **未**触碰 |
| commit / push | **未**执行 |

## 4. 已实现边界

已实现：Rank-3 普通导弹；35 mana + 一枚 `missile_barrage_ammo` 原子门控/消耗；ammo2/max4；2000ms CD；一笔非暴击/不可复制物理 `250+0.85*(ad.resolved-ad.base)`；CD/mana/ammo 探针；自动 `ability_started`；Backend ammo seed + Q 共存；Wasm 测试-only 证据。排除（completed-boundary exclusions；**非** remaining blockers）：direction/projectile/travel/collision/explosion、AOE/multitarget、Big One/third-shot/double damage、range/radius、periodic stock/recharge/respawn refill、BA on-hit recharge reduction/crit、Malignance/Eclipse、other ranks、live/E2E/full-R/full-game fidelity。本闭环**恰好是一次普通导弹选定主目标首个敌人物理命中**，**不是**完整 R。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成。
