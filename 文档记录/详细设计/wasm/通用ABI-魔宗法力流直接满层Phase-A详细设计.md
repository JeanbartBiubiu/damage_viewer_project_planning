TASK_KEY: wasm-generic-manamune-manaflow-direct-max-state
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 魔宗法力流（Manaflow）直接满层 Phase-A 详细设计

关联验证记录：[通用 ABI 魔宗法力流直接满层 Phase-A 验证记录](../../测试记录/wasm/通用ABI-魔宗法力流直接满层Phase-A验证记录-2026-07-26.md)。本任务将精确候选 `item_passive|3004|item_passive|法力流` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime`（历史 auditBaseline：`periodic_charge_tick` / `attack_or_ability_hit_resource_gain` / `state_driven_max_mana_and_transform`，仅溯源）。**用户已批准** direct maximum-state 近似。**仅** always-on `mana.resolved += 360` Phase-A；**不**宣称完整 Manaflow / 充能进度 / Muramana 变形 / 完整游戏保真。既有敬畏 provider 现读 `source.attr.mana.resolved`；两隔离 item providers 均挂 `item_3004`；两遍 materialize 后敬畏才消费有效法力。Jhin P / Yunara P 仍为用户推迟的 `blocked_runtime`，**不是** `out_of_scope`。Aphelios **OOS**。**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV manamune-manaflow-direct-max-state-phase-a-v2`（DESIGN_READY `run-0e2afc59-dafa-44b8-8f94-44d1d66c653d`；v1 REVISE `run-233c2dd6-1fd7-4a11-91c4-827aef784a33`，三条 issue 已全部接受进 v2。Production Wasm / public ABI / Web 变更**不**需要——本切片为 seed + test-only 合同，**未**要求、亦**未**执行生产 Wasm 资产重建/同步）。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对 item 3004 法力流建立**有界 direct-max-state Phase-A** 证据闭环：始终 on 的 source-only 有效法力 `+360`，使既有敬畏（2% 有效法力 → AD）在同挂时消费含 +360 的 `mana.resolved`，候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- 8s charging / four-charge queue
- attack / ability hit 触发
- incremental +3 / +6 bonus mana
- per-cast throttle
- resource capacity / current mutation 或 spending
- Muramana transform / entity replacement
- on-hit damage / full Manaflow fidelity
- live migration / Admin publish / browser E2E
- production item/hero switch / generic-runtime specialization

**精确直接满层近似有界完成 ≠ 完整 Manaflow 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `item_passive\|3004\|item_passive\|法力流` |
| Wiki | Module:ItemData/data；revid `4030984`；timestamp `2026-06-17T23:47:20Z` |
| content SHA | `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d` |
| normalized SHA | `17769e0891a0cfc3873abe3d74f1806e8b7a1bc5b21258308c0612121f4b56f4`（`current-items.normalized.json#item_3004_slots_pass2+pass3`） |
| 用户政策 | 批准 direct maximum-state 近似（满层 +360），**不**要求本 Phase 建模充能进度 |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `item_3004_manaflow_direct_max_state_approximation; source_only_always_on_plus_360_effective_mana; existing_manamune_awe_consumes_effective_mana; two_isolated_item_providers_mounted_to_item_3004; no_charge_progression_timer_queue_attack_or_ability_hit_trigger_per_cast_throttle_incremental_plus3_plus6_resource_current_or_max_mutation_muramana_transform_entity_replacement_on_hit_damage_resource_spend_or_full_fidelity` |
| G8 governed tags（序） | `source_only_effective_mana_modifier`、`awe_effective_mana_dependency`、`phase_a_excludes_charge_progression_and_transform` |
| Manaflow provider | 独立 always-on source attribute provider：`mana.resolved += 360`（const 360 add） |
| 不变面 | Base / Current / Max / resource / 静态 item mana500 / identity **不变** |
| 敬畏兼容 | 既有 Awe：`ad add = 0.02 * source.attr.mana.resolved`；两遍 materialize 后消费有效法力 |
| 隔离 | 两 providers：`item:manamune_awe` + `item:manamune_manaflow_max_state`；均 mount `item_3004`；顺序确定性 |
| 数值交叉 | input mana 0/1000/2000 → effective 360/1360/2360；source AD100 → combined 107.2/127.2/147.2 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E；**不**宣称 rebuilt/synced Wasm asset |

## 4. 通用 ABI 图

```text
Wiki Module:ItemData/data (revid4030984；content SHA e7818eff…；normalized 17769e08…)
  → Backend seed（lol_generic_manamune_awe_seed.sql @ 615eda1b）
     provider_item_3004_manamune_manaflow_max_state：mana add = const 360
     provider_item_3004_manamune_awe：ad add = 0.02 * source.attr.mana.resolved
     两 mount → item_3004；Batch-C 静态 mana500 不变
    → Wasm CompileGeneric → two-pass materialize
       Manaflow 先写入 mana.resolved
       Awe 再读 resolved → combined AD
    → 英雄/装备名 _test.go 仅为回归/治理证据（排除生产）
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_manamune_awe_seed.sql`（bytes `17817`；SHA256 `be0147276694d8696b678cd75ea247d8b280487662fe8e389ee8ce06f190ad77`） |
| JUnit | `LolGenericManamuneAweSeedSqlTest`（bytes `21617`；SHA256 `99fb0d79cfb6aa4122d86036351d730ccf1dcfb50a83d40295008a73ce99aff7`） |
| README | `server/data_manage/README.md`（Backend owning 切片内更新） |
| owning | `615eda1b080f229251e6b1a133a5d3dfd15ad858`（backend/dev） |
| 主验证 | focused **18** PASS；full Maven **1069** PASS |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_manamune_awe_test.go`（**仅** `_test.go`） |
| bytes / SHA | `23844` / SHA256 `75522eb4e32e97f014dab86eba2b7403ee456a46940c7af18ab75277ddd2c6b7` |
| commit | `aba6beeed4c9e964b2392db888dccfdd140e5765` |
| 地位 | 装备名 `_test.go` **仅为**回归/治理证据，**排除**于生产构建；**无**生产 item/hero switch |
| 主验证 | focused / full `go test -count=1 ./...` / `go run ./cmd/bench` PASS |
| 生产 / Web | **无**生产 Wasm / public ABI / asset / Web 写入；**未**资产重建/同步 |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| Manaflow only；input mana 0/1000/2000 | effective mana 360/1360/2360；Base/Current/Max 不变 |
| Awe only；AD100；mana 0/1000/2000 | AD 100/120/140 |
| Awe+Manaflow；AD100；mana 0/1000/2000 | AD 107.2/127.2/147.2 |
| provider 顺序反转 | 同结果（确定性） |
| target / 未装备 source | 无 Manaflow/Awe provider 投影 |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计 commit | `158e2fb60c0ee581bade80d32482672478c84764` |
| 主验收 | 五审计 check + exact semantics PASS；`git diff --check` PASS |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated97/partial4/blocked72/OOS69；Unified254/source12 completed107/blocked_runtime66/blocked_data3/OOS72/regression5/stale1；full107/partial3/none144；actionable0；provisional69=runtime66/data3；hero68/item1 |
| 报告口径 | 严格 verified completion **107/254=42.1%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**。真剩余队列 **仅 69** = blocked_runtime66 + blocked_data3 |
| 完成语义 | Manaflow Phase-A 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **121** |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | revid4030984 / timestamp2026-06-17T23:47:20Z / content SHA `e7818eff…` / normalized SHA `17769e08…` |
| 边界 | exact `completedBoundary`；直接满层 +360，不是完整 Manaflow |
| Backend | owning `615eda1b…`；focused18 + full1069；无 live |
| Wasm | exact `aba6bee…`；仅 `_test.go`；无生产/Web/资产重建 |
| 审计 | 接受 `158e2fb…`；counts 与 §8 一致；tasks121 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 / rebuilt Wasm asset |
