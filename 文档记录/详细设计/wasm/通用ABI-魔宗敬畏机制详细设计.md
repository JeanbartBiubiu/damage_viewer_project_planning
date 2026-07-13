TASK_KEY: wasm-generic-manamune-awe
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 魔宗敬畏（item_3004）机制详细设计

关联验证记录：[通用 ABI 魔宗敬畏机制验证记录](../../测试记录/wasm/通用ABI-魔宗敬畏机制验证记录-2026-07-14.md)。本任务只迁移 G8 精确候选 `item_passive|3004|item_passive|敬畏`。

## 1. 目标与边界

数值真源为 `C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json` 的 current item 3004：额外攻击力等于最大法力值的 2%。既有 Batch-C 已录入 `item_3004` 的 `ad=35`、`mana=500` 与 `ability_haste=15`；本项只补独立动态 AD provider。

现有 Generic Formula read、provider-bound attribute modifier 和 `value_policy/add` 可直接表达 `0.02 * source.attr.mana.max`，不增加 DDL、Wasm ABI/DTO 或生产 runtime。

## 2. 数据合同

| 环节 | 合同 |
| --- | --- |
| provider | 独立 passive provider，仅 mount 到 `item_3004` |
| formula | `mul(0.02, source.attr.mana.max)` |
| modifier | source `ad` attribute modifier，value-policy `add` |
| state/listener | 无；最大法力变化应重新解析 modifier |

示例：source `mana.max=1000` 时，敬畏额外提供 20 AD。seed 使用幂等 upsert，不改 Batch-C 静态属性，不执行 destructive SQL、live migration 或 publish。

## 3. 非目标

- `item_passive|3004|item_passive|法力流`：8 秒 charge、on-hit/ability mana gain、360 bonus-mana cap。
- 魔切变形、资源增长、攻击触发、吸血、随机或主动技能轮转。
- live 发布与浏览器 live E2E。

## 4. 验收结果

- Backend seed/静态 SQL 合同与全量 Maven 测试通过。
- TinyGo 验证 `mana.max=0/1000/2000` 下 AD 动态为 0/20/40，source/target 隔离与动态重算，并完成全量验证。
- Web 只投影 source 的 formula/modifier，target 无 provider；lint/typecheck/Vitest/build 全部通过。
- G8 只迁移 `敬畏`，`法力流` 保持 blocked；task governance rebuild/query 可解析两份文档。
