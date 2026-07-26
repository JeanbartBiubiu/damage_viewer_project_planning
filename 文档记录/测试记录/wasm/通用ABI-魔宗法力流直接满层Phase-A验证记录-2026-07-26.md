TASK_KEY: wasm-generic-manamune-manaflow-direct-max-state
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 魔宗法力流直接满层 Phase-A 验证记录

详细设计：[通用 ABI - 魔宗法力流（Manaflow）直接满层 Phase-A 详细设计](../../详细设计/wasm/通用ABI-魔宗法力流直接满层Phase-A详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `item_passive|3004|item_passive|法力流`：`completed/full/generic_runtime`（G8 governed `migrated`）。**用户已批准** direct maximum-state 近似。Wiki Module:ItemData/data revid `4030984` / timestamp `2026-06-17T23:47:20Z`；content SHA `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`；normalized SHA `17769e0891a0cfc3873abe3d74f1806e8b7a1bc5b21258308c0612121f4b56f4`。边界：`item_3004_manaflow_direct_max_state_approximation; source_only_always_on_plus_360_effective_mana; existing_manamune_awe_consumes_effective_mana; two_isolated_item_providers_mounted_to_item_3004; no_charge_progression_timer_queue_attack_or_ability_hit_trigger_per_cast_throttle_incremental_plus3_plus6_resource_current_or_max_mutation_muramana_transform_entity_replacement_on_hit_damage_resource_spend_or_full_fidelity`。G8 tags 序：`source_only_effective_mana_modifier`、`awe_effective_mana_dependency`、`phase_a_excludes_charge_progression_and_transform`。Manaflow：always-on `mana.resolved += 360`；Base/Current/Max/resource/static mana500/identity 不变。既有敬畏读 `source.attr.mana.resolved`；两遍 materialize；两隔离 providers 挂 `item_3004`。交叉：mana 0/1000/2000 → effective 360/1360/2360；AD100 → 107.2/127.2/147.2。装备名 `_test.go` 仅为回归/治理证据并排除生产；**无**生产 item/hero switch。Jhin P / Yunara P 仍 deferred `blocked_runtime`；Aphelios **OOS**；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: manamune-manaflow-direct-max-state-phase-a-v2`；DESIGN_READY `run-0e2afc59-dafa-44b8-8f94-44d1d66c653d`；v1 REVISE `run-233c2dd6-1fd7-4a11-91c4-827aef784a33`；实现/审计已提交）填写。下列验证结果按实现与主会话/Driver 复验记录抄录；**未**在本切片重跑 Backend/Wasm 实现测试。记录日期权威为 **2026-07-26**。**本切片未发明 docs commit**。

本轮**未**执行 live migration、Admin publish、push、browser E2E、production TinyGo runtime、public ABI、asset 或 Web 变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。**未**要求、亦**未**执行生产 Wasm/Web 资产重建或同步。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY v2 | `run-0e2afc59-dafa-44b8-8f94-44d1d66c653d` | DESIGN_READY；v1 REVISE `run-233c2dd6-1fd7-4a11-91c4-827aef784a33` 三条 issue 已接受 | **接受门控** |
| Backend owning | `615eda1b080f229251e6b1a133a5d3dfd15ad858` | seed/JUnit/README；focused18 / full Maven1069 PASS；seed17817/`be014727…`；JUnit21617/`99fb0d79…`；无 live | 接受（Driver/实现） |
| Wasm exact | `aba6beeed4c9e964b2392db888dccfdd140e5765` | 仅 `generic_manamune_awe_test.go`；23844/`75522eb4…`；focused/full/bench PASS；生产 runtime/ABI/asset/Web 不变 | 接受（Driver/实现） |
| 审计 | `158e2fb60c0ee581bade80d32482672478c84764` | 五 check + exact semantics PASS | 接受（Driver） |
| Web / 资产 | 无本机制写入 | **无** Web / 生产 Wasm / public ABI 变更；**未**资产重建/同步 | 接受 |

## 2. 验证结果（实现轮与 Driver 抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| Module:ItemData/data / revid / timestamp | PASS；4030984 / 2026-06-17T23:47:20Z |
| content SHA / normalized SHA | `e7818eff…daceac2d` / `17769e08…1f4b56f4` |
| sourceCount | 仍为 12；无新源 |
| 用户政策 | 批准 direct-max-state 近似 |

### 2.2 Backend（Driver / 实现轮）

| 验证 | 结果 |
| --- | --- |
| focused / full Maven | PASS 18 / PASS 1069（Driver） |
| owning commit | `615eda1b080f229251e6b1a133a5d3dfd15ad858` |
| seed / JUnit | 17817/`be014727…`；21617/`99fb0d79…` |
| 合同 | Manaflow const360 mana add；Awe `0.02 * mana.resolved`；两 mount `item_3004` |
| live seed execution | **未**执行 |

### 2.3 Wasm / Go（Driver / 实现轮）

| 验证 | 结果 |
| --- | --- |
| focused / full Go / bench | PASS（Driver） |
| exact commit | `aba6beeed4c9e964b2392db888dccfdd140e5765` |
| exact path / bytes / SHA | `generic_manamune_awe_test.go`；23844 / `75522eb4…` |
| 装备名 `_test.go` 地位 | 回归/治理证据 only；排除生产构建；无生产 item/hero switch |
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
| 五审计 `--check` + exact semantics | PASS（Driver；审计 commit `158e2fb…`） |
| G8 governed | `migrated`；三 tags；空 `remainingGap` |
| Unified 254 | sourceCount12；completed107 / actionable0 / blocked_runtime66 / blocked_data3 / OOS72 / regression5 / stale1 |
| coverage | full107 / partial3 / none144 |
| registry 242 | migrated48 / partial5 / blocked120 / OOS69（不变） |
| G8 242 | migrated97 / partial4 / blocked72 / OOS69 |
| provisional | 69 = runtime66 / data3；hero68 / item1；Manaflow 缺席（剩余 item=`3097|盈能`） |
| 报告口径 | 严格 verified completion **107/254=42.1%**；completed+provisional coverage **176/254=69.3%** |
| OOS / 真队列 | `out_of_scope=72` 最终跳过；真剩余队列 **仅 69** = runtime66 + data3 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；总体 Goal 仍活跃 |

### 2.6 设计门控

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-0e2afc59-dafa-44b8-8f94-44d1d66c653d` |
| v1 | REVISE `run-233c2dd6-1fd7-4a11-91c4-827aef784a33`；三条 issue 已接受进 v2 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON / tasks | PASS（tasks=121；unique key；exact 两新 docs；Awe task 仅 completion_note 修订） |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `node tools/task-governance/cli.mjs tasks` / `docs …` | 只读 SQLite 查询；本切片**未** rebuild，故可能尚未列出本新 task（预期；由主会话 rebuild 后复验） |
| `git diff --check` | PASS；仅六条 allowlist 路径变更 |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止） |
| SQLite | **未**触碰 |
| commit / push | **未**执行；**未**发明 docs commit |

## 4. 已实现边界

已实现：always-on source-only `mana.resolved += 360`；Base/Current/Max/resource/static500/identity 不变；既有敬畏消费 `mana.resolved`；两隔离 providers + 两遍 materialize；交叉 0/1000/2000 → 360/1360/2360 与 AD100 → 107.2/127.2/147.2；Backend seed + Wasm `_test.go` 证据。排除（completed-boundary exclusions；**非** remaining blockers）：8s charge、four-charge queue、attack/ability hit、+3/+6、per-cast throttle、resource capacity/current/spend、Muramana transform/entity replacement、on-hit damage、full fidelity。本闭环**恰好是 direct-max-state Phase-A**，**不是**完整 Manaflow。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称 live/Admin/E2E 或 rebuilt Wasm asset。
