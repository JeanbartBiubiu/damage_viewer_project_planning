TASK_KEY: wasm-generic-xayah-clean-cuts-three-attack-budget
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 霞 P 锐切 Clean Cuts 三次攻击预算 Phase-A 验证记录

详细设计：[通用 ABI - 霞 P 锐切（Clean Cuts）三次攻击预算 Phase-A 详细设计](../../详细设计/wasm/通用ABI-霞P锐切CleanCuts三次攻击预算Phase-A详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_xayah|P|锐切`：`completed/full/generic_runtime`（G8 governed `migrated`）。**用户已批准** attack-count-only 近似。Wiki 当前权威 `xayah-p.json`；请求 `Template:Data Xayah/I` → 解析 `Template:Data Xayah/Clean Cuts`；page `1324540` / rev `3967343` / timestamp `2025-11-18T20:49:46Z`；content SHA `5cfe6e5e30cdc8e6fde07791288f5a85e5ef01f543670ce2248323ccb6ead171`；raw `4068`。**无** DDragon/OCR 真理。边界：`attack_count_budget_only; direct_post_cast_arm_gives_3; successful_source_ba_damage_instance_consumes_1; state_sequence_arm_plus_4ba_0_3_2_1_0_0; preserve_wqr_and_w_ability_type_listener_isolation; no_true_qwer_wiring_add_refresh_max5_8s_timer_geometry_feathers_secondary_damage_secondary_crit_e_dependency_miss_dodge_cadence_projectile_rng_expected_crit_on_hit_proc_or_full_ba_clean_cuts_fidelity`。G8 tags 序：`direct_post_cast_three_attack_budget`、`source_basic_attack_damage_event_consumes_one`、`phase_a_excludes_feather_geometry_secondary_damage_and_e_dependency`。DB state max3/NULL untimed/无 stored default；显式 arm override3；generic in-memory default0/max3/duration0；成功 source-owned BA `damage_instance` 守卫递减；规范序 `0→3→2→1→0→0`；再武装 reset-to-3；四笔相等主目标 AD 物理 BA 量子；无关 spell/对手 BA 隔离；game-local62003；listener max1。Wiki on-attack **近似为**成功 `damage_instance`；miss/dodge **排除**。英雄名 `_test.go` 仅为回归/治理证据并排除生产；**无**生产 hero switch。Jhin P / Yunara P 仍 deferred `blocked_runtime`；Aphelios **OOS**；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: xayah-p-clean-cuts-three-attack-budget-phase-a-v2`；DESIGN_READY `run-383f969c-dee5-4152-987f-cf14c7dcf84d`；实现/审计已提交）填写。下列验证结果按实现与主会话/Driver 复验记录抄录；**未**在本切片重跑 Backend/Wasm 实现测试。记录日期权威为 **2026-07-26**。**本切片未发明 docs commit**（docs commit pending driver）。

本轮**未**执行 live migration、Admin publish、push、browser E2E、production TinyGo runtime、public ABI、asset 或 Web 变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。**未**要求、亦**未**执行生产 Wasm/Web 资产重建或同步。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY v2 | `run-383f969c-dee5-4152-987f-cf14c7dcf84d` | DESIGN_READY；只读有效 | **接受门控** |
| Backend owning | `d581372c0a0f8d19f92ca5cdfa98d6adf0bd52b6` | seed/JUnit/README；focused35 / full Maven1078 PASS；seed46467/`3b108cd9…`；JUnit32718/`dacfc0dc…`；无 live | 接受（Driver/实现） |
| Wasm exact | `74b96c89df66b70153acbbe563e2ed2aa49e718b` | 仅 `generic_xayah_clean_cuts_three_attack_budget_test.go`；42957/`7ecc45b1…`；focused/full/bench PASS；生产 runtime/ABI/asset/Web 不变 | 接受（Driver/实现） |
| 审计 | `3693ecaa99b4e45c53ad4bf3a103bdb1073b2f6d` | 五 check + exact semantics PASS | 接受（Driver） |
| Web / 资产 | 无本机制写入 | **无** Web / 生产 Wasm / public ABI 变更；**未**资产重建/同步 | 接受 |

## 2. 验证结果（实现轮与 Driver 抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| Template Clean Cuts / page / rev / timestamp | PASS；1324540 / 3967343 / 2025-11-18T20:49:46Z |
| content SHA / raw | `5cfe6e5e…b6ead171` / 4068 |
| 权威 sidecar | `xayah-p.json`（normalized + pages）；无 DDragon/OCR 真理 |
| sourceCount | 仍为 12；无新源 |
| 用户政策 | 批准 attack-count-only 近似 |

### 2.2 Backend（Driver / 实现轮）

| 验证 | 结果 |
| --- | --- |
| focused / full Maven | PASS 35 / PASS 1078（Driver） |
| owning commit | `d581372c0a0f8d19f92ca5cdfa98d6adf0bd52b6` |
| seed / JUnit | 46467/`3b108cd9…9936510`；32718/`dacfc0dc…8f95ad1` |
| 合同 | arm override3；BA damage 守卫递减；state max3/NULL untimed；62003；listener max1 |
| live seed execution | **未**执行 |

### 2.3 Wasm / Go（Driver / 实现轮）

| 验证 | 结果 |
| --- | --- |
| focused / full Go / bench | PASS（Driver） |
| exact commit | `74b96c89df66b70153acbbe563e2ed2aa49e718b` |
| exact path / bytes / SHA | `generic_xayah_clean_cuts_three_attack_budget_test.go`；42957 / `7ecc45b1…a533c0c0` |
| 英雄名 `_test.go` 地位 | 回归/治理证据 only；排除生产构建；无生产 hero switch |
| 生产 Wasm / Web / 资产重建 | **无** |

### 2.4 Web / 资产

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit | **无** |
| 生产 Wasm / public ABI | **无**变更；**未**资产重建/同步 |
| Playwright / live E2E | **未**执行 |

### 2.5 G8 / Unified / provisional（审计 / Driver）

| 验证 | 结果 |
| --- | --- |
| 五审计 `--check` + exact semantics | PASS（Driver；审计 commit `3693eca…`） |
| G8 governed | `migrated`；三 tags；空 `remainingGap` |
| Unified 254 | sourceCount12；completed108 / actionable0 / blocked_runtime65 / blocked_data3 / OOS72 / regression5 / stale1 |
| coverage | full108 / partial3 / none143 |
| registry 242 | migrated48 / partial5 / blocked120 / OOS69（不变） |
| G8 242 | migrated98 / partial4 / blocked71 / OOS69 |
| provisional | 68 = runtime65 / data3；hero67 / item1；Xayah P 缺席（剩余 item=`3097|盈能`） |
| 报告口径 | 严格 verified completion **108/254=42.5%**；completed+provisional coverage **176/254=69.3%** |
| OOS / 真队列 | `out_of_scope=72` 最终跳过；真剩余队列 **仅 68** = runtime65 + data3 |
| digests | Unified `69832c2a…c018`；Wiki `927d8b5a…26c7`（不变） |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；总体 Goal 仍活跃 |

### 2.6 设计门控

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-383f969c-dee5-4152-987f-cf14c7dcf84d`（只读有效） |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON / tasks | PASS（tasks=122；unique key；exact 两新 docs） |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `node tools/task-governance/cli.mjs tasks` / `docs …` | 只读 SQLite 查询；本切片**未** rebuild，故可能尚未列出本新 task（预期；由主会话 rebuild 后复验） |
| `git diff --check` | PASS；仅四条 allowlist 路径变更 |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止） |
| SQLite | **未**触碰 |
| commit / push | **未**执行；**未**发明 docs commit（pending driver） |

## 4. 已实现边界

已实现：直接 post-cast arm override3；成功 source-owned BA `damage_instance` 守卫递减；规范序 `0→3→2→1→0→0`；再武装 reset-to-3；四笔相等主目标 AD 物理量子；W/Q/R 与无关 spell/对手 BA 隔离；game-local62003；listener max1；Backend seed + Wasm `_test.go` 证据。Wiki on-attack 由成功 `damage_instance` 近似。排除（completed-boundary exclusions；**非** remaining blockers）：true Q/W/E/R wiring、add/refresh/max5/8s、feathers/geometry/secondary damage/crit/E dependency、miss/dodge、cadence/projectile/RNG/expected crit/on-hit/proc、full fidelity。本闭环**恰好是 attack-count-only Phase-A**，**不是**完整 Clean Cuts。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称 live/Admin/E2E 或 rebuilt Wasm asset。
