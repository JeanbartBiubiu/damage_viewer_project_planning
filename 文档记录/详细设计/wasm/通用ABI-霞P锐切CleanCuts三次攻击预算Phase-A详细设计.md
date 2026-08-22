TASK_KEY: wasm-generic-xayah-clean-cuts-three-attack-budget
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 霞 P 锐切（Clean Cuts）三次攻击预算 Phase-A 详细设计

关联验证记录：[通用 ABI 霞 P 锐切 Clean Cuts 三次攻击预算 Phase-A 验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_xayah|P|锐切` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime`（历史 feather/E 依赖族，仅溯源）。**用户已批准** attack-count-only 近似。**仅**直接施放后武装三次攻击预算 + 成功 source-owned 普攻伤害事件守卫递减；**不**宣称完整 Clean Cuts / 羽毛几何 / 次级伤害 / E 依赖 / 完整游戏保真。Wiki on-attack 由成功 `damage_instance` 近似；miss/dodge **排除**。Jhin P / Yunara P 仍为用户推迟的 `blocked_runtime`，**不是** `out_of_scope`。Aphelios **OOS**。**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV xayah-p-clean-cuts-three-attack-budget-phase-a-v2`（DESIGN_READY `run-383f969c-dee5-4152-987f-cf14c7dcf84d`；READY，只读有效）。Production Wasm / public ABI / Web 变更**不**需要——本切片为 seed + test-only 合同，**未**要求、亦**未**执行生产 Wasm 资产重建/同步。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对霞 P 锐切建立**有界 attack-count-only Phase-A** 证据闭环：直接 post-cast 武装 override 至 3；成功 source-owned 基础攻击 `damage_instance` 守卫递减 1；规范状态序 `0→3→2→1→0→0`；候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- true Q / W / E / R wiring
- add / refresh / max5 / 8s timer
- feathers / geometry / secondary damage / secondary crit / E dependency
- miss / dodge（Wiki on-attack 未按 miss/dodge 保真）
- cadence / projectile / RNG / expected crit / on-hit / proc
- full basic-attack Clean Cuts fidelity
- live migration / Admin publish / browser E2E
- production hero switch / generic-runtime specialization

**精确三次攻击预算近似有界完成 ≠ 完整 Clean Cuts 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_xayah\|P\|锐切` |
| Wiki 当前权威 | `xayah-p.json`；请求 `Template:Data Xayah/I` → 解析 `Template:Data Xayah/Clean Cuts` |
| page / rev / timestamp | `1324540` / `3967343` / `2025-11-18T20:49:46Z` |
| content SHA / raw | `5cfe6e5e30cdc8e6fde07791288f5a85e5ef01f543670ce2248323ccb6ead171` / `4068` |
| 数值真源 | **仅** Wiki；**无** DDragon / OCR 真理 |
| 用户政策 | 批准 attack-count-only 近似（三次预算 + 成功 BA damage 消耗） |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `attack_count_budget_only; direct_post_cast_arm_gives_3; successful_source_ba_damage_instance_consumes_1; state_sequence_arm_plus_4ba_0_3_2_1_0_0; preserve_wqr_and_w_ability_type_listener_isolation; no_true_qwer_wiring_add_refresh_max5_8s_timer_geometry_feathers_secondary_damage_secondary_crit_e_dependency_miss_dodge_cadence_projectile_rng_expected_crit_on_hit_proc_or_full_ba_clean_cuts_fidelity` |
| G8 governed tags（序） | `direct_post_cast_three_attack_budget`、`source_basic_attack_damage_event_consumes_one`、`phase_a_excludes_feather_geometry_secondary_damage_and_e_dependency` |
| DB state | max3 / NULL untimed / **无** stored default |
| arm | 显式 arm override **3**（非 add / 非 max5） |
| 内存默认 | generic in-memory default0 / max3 / duration0 |
| 消耗 | 成功 source-owned BA `damage_instance` 守卫递减 1（`gt(read,0)`）；listener MaxTriggersPerEvent=1 |
| 规范序 | `0→3→2→1→0→0`（arm + 四次 BA）；再武装直接 reset-to-3 |
| 伤害 | 四笔相等主目标 AD 物理 BA 量子（fixture AD100/armor0 → 各 raw=mit=100）；CritEligible=false；CopyableOnHit=false |
| 隔离 | 无关 spell / 对手 BA 不消耗；保留 W/Q/R 与 W ability-type listener isolation；game-local `ability/basic_attack` **62003** |
| Wiki 近似 | on-attack **近似为**成功 `damage_instance`；**排除** miss/dodge |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E；**不**宣称 rebuilt/synced Wasm asset |

## 4. 通用 ABI 图

```text
Wiki Template:Data Xayah/Clean Cuts (page1324540 / rev3967343；content SHA 5cfe6e5e…；raw4068)
  → Backend seed（lol_generic_xayah_clean_cuts_three_attack_budget_seed.sql @ d581372c）
     provider_hero_xayah_p_clean_cuts_three_attack_budget
     arm ability clean_cuts_direct_post_cast_arm → state override const3
     BA ability clean_cuts_basic_attack（62003）+ listener ALL {damage_instance, basic_attack, source_owner}
    → Wasm CompileGeneric → RunGeneric
       arm → 3；成功 source BA damage → 守卫 -1；序 0→3→2→1→0→0
    → 英雄名 _test.go 仅为回归/治理证据（排除生产）
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_xayah_clean_cuts_three_attack_budget_seed.sql`（bytes `46467`；SHA256 `3b108cd92ae464dbe5f82c92649d0da8541ae867b7816bc1866e9823f9936510`） |
| JUnit | `LolGenericXayahCleanCutsThreeAttackBudgetSeedSqlTest`（bytes `32718`；SHA256 `dacfc0dc2fb39f58646087fdfaf62dc3d2649fdb33f1fdbbf7473db658f95ad1`） |
| README | `server/data_manage/README.md`（Backend owning 切片内更新） |
| owning | `d581372c0a0f8d19f92ca5cdfa98d6adf0bd52b6`（backend/dev） |
| 前置 | external existing-data/check-only（Xayah/ad/mana + 校正后 W isolation）；**不**物化 identity/panel/resource |
| 主验证 | focused **35** PASS；full Maven **1078** PASS |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_xayah_clean_cuts_three_attack_budget_test.go`（**仅** `_test.go`） |
| bytes / SHA | `42957` / SHA256 `7ecc45b12f2f484170cbf8f149ec72283c87c8d8aa211e083476d990a533c0c0` |
| commit | `74b96c89df66b70153acbbe563e2ed2aa49e718b` |
| 地位 | 英雄名 `_test.go` **仅为**回归/治理证据，**排除**于生产构建；**无**生产 hero switch |
| 主验证 | focused / full `go test -count=1 ./...` / `go run ./cmd/bench` PASS |
| 生产 / Web | **无**生产 Wasm / public ABI / asset / Web 写入；**未**资产重建/同步 |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| 未武装 | state 0；BA 不消耗预算（无递减） |
| arm 一次 | state 3 |
| arm + 四次成功 source BA damage | `0→3→2→1→0→0`；四笔相等 AD 物理量子 |
| 耗尽后再 arm | reset-to-3（override，非 add） |
| 无关 spell / 对手 BA | 不消耗预算 |
| listener | MaxTriggersPerEvent=1 |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计 commit | `3693ecaa99b4e45c53ad4bf3a103bdb1073b2f6d` |
| 主验收 | 五审计 check + exact semantics PASS；`git diff --check` PASS |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated98/partial4/blocked71/OOS69；Unified254/source12 completed108/blocked_runtime65/blocked_data3/OOS72/regression5/stale1；full108/partial3/none143；actionable0；provisional68=runtime65/data3；hero67/item1；Xayah P 缺席；剩余 item=`3097\|盈能` |
| 报告口径 | 严格 verified completion **108/254=42.5%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**。真剩余队列 **仅 68** = blocked_runtime65 + blocked_data3 |
| 完成语义 | Xayah P Phase-A 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **122**（docs commit pending driver） |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1324540 / rev3967343 / timestamp2025-11-18T20:49:46Z / content SHA `5cfe6e5e…` / raw4068 |
| 边界 | exact `completedBoundary`；三次攻击预算，不是完整 Clean Cuts |
| Backend | owning `d581372c…`；focused35 + full1078；无 live |
| Wasm | exact `74b96c8…`；仅 `_test.go`；无生产/Web/资产重建 |
| 审计 | 接受 `3693eca…`；counts 与 §8 一致；tasks122 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 / rebuilt Wasm asset |
