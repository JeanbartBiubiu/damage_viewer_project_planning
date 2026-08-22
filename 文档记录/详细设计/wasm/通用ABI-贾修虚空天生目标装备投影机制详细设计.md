TASK_KEY: wasm-generic-jaksho-voidborn-target-loadout
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI - 贾修虚空天生目标装备投影机制详细设计

关联验证记录：[通用 ABI 贾修虚空天生目标装备投影机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `item_passive|6665|item_passive|虚空天生` 标为 `completed/full/generic_runtime`；关闭此前 partial 的真实 target equipment/loadout 投影缺口。G8 不含 6665（EXTRA Unified），G8 计数不变。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `item_passive\|6665\|item_passive\|虚空天生` |
| Wiki | current item 6665；manifest revid `4030984`；SHA `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d` |
| 静态面板 | HP 350 / armor 45 / magic_resist 45 |
| 被动 | 进入英雄战斗 5s 后，额外护甲与额外魔抗各 +30%（只乘 bonus 桶，不乘总抗） |
| status | `completed/full/generic_runtime` |
| 发布边界 | **不**执行 live migration / Admin publish / push |

## 2. 端到端数据流

```text
Backend tag/item
  → Web target loadout + derived bonus buckets
  → namespaced target-owned provider
  → Wasm 5s tick / attribute modifiers
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 `item_6665`；`62011 / tag/loadout_equipment` eligibility relation；**不**误用 ADC tag；**不**在 DB 写静态 `bonus_armor` / `bonus_magic_resist`（bonus 桶由 Web 派生） |
| Web | 可选 `targetEquipmentEntityIds`；资格为 `tag/adc_completed_item` ∪ `tag/loadout_equipment`；target-only 聚合总抗 + 派生 bonus；target-owned provider mount |
| Wasm | 显式 total + bonus 输入；`provider_item_6665_jaksho_voidborn_resilience` 仅挂 target；t=5000 `full_stack` 0→1；后续 tick 幂等；source 无该 provider |

## 3. 属性优先级与 explicit-bonus-row-wins

装配顺序（target combatant）：

1. 英雄 base / stage 属性
2. 所选装备 `entity_attribute_values.baseValue` 求和（最多 6、唯一、须在 union 资格集）
3. **仅 target**：从各装备的 `armor` / `magic_resist` 派生 `bonus_armor` / `bonus_magic_resist`，并入总和
4. numeric overrides（最终覆盖）

**explicit-bonus-row-wins**：同一装备实体若已有显式 `bonus_armor`（或 `bonus_magic_resist`）行，则**不得**再把该实体的 `armor`（或 `magic_resist`）计入派生 bonus；显式行优先。英雄 base/stage 的 armor/MR **永不**进入 bonus 桶。

精确对齐证据输入（hero 30/30 + item_6665 45/45）：

| 时刻 | total armor/MR | bonus armor/MR |
| --- | ---: | ---: |
| 激活前 | 75 / 75 | 45 / 45 |
| t=5000（+30% bonus） | 88.5 / 88.5 | 45 / 45（bonus 桶本身不变；modifier 加到 total） |
| 后续 tick | 仍 88.5 / 88.5 | 幂等，不叠乘 |

公式：`armor += 0.30 * max(0, bonus_armor.resolved) * full_stack`；MR 同理。

## 4. 兼容与 source 行为

- 既有 `sourceEquipmentEntityIds` / ADC Batch-C 静态聚合与 source-side on-hit mount **不变**。
- source loadout **不**派生 bonus 抗性桶；若显式把 `item_6665` 选为 source 装备，provider 仍按既有规则挂到 `source::provider_item_6665_jaksho_voidborn_resilience`，但其 bonus 抗性输入须由既有 source 数据/override 明确提供。此 source 分支不属于本次 target-loadout completed 边界。
- `listAdcCompletedItemEntityIds` 与 `ADC_COMPLETED_ITEM_TYPE_KEY` 保留；新增 `LOADOUT_EQUIPMENT_TYPE_KEY` 仅扩展资格 union。
- 未选 target 装备时行为与旧合同一致。

## 5. 非目标 / 排除

- 自动战斗态检测、战斗结束过期卸层
- live migration / Admin publish / push / 浏览器对 live backend 的 E2E
- Backend 静态 bonus 行重复写入、把 6665 误标为 `tag/adc_completed_item`
- 将 1.3× **总抗** 误当作合同（只乘 bonus）

## 6. 证据锚点

| Worktree / 阶段 | Commit |
| --- | --- |
| Backend owning | `6db9c4a` |
| Backend → Wasm 集成 | `0aa35a9` |
| Web owning | `c3db5a4` |
| Web → Wasm 集成 | `2649b34` |
| Wasm 真实投影对齐回归 | `3f40a39` |
| Unified 审计 | `c946581` |

验证命令与结果见关联验证记录。治理任务 `wasm-generic-jaksho-voidborn-target-loadout` 映射本文与验证记录两份文档。
