TASK_KEY: wasm-generic-manamune-awe
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 魔宗敬畏（item_3004）机制详细设计

关联验证记录：[通用 ABI 魔宗敬畏机制验证记录](../../测试记录/wasm/通用ABI-魔宗敬畏机制验证记录-2026-07-14.md)。本任务只迁移 G8 精确候选 `item_passive|3004|item_passive|敬畏`。

## 1. 目标与边界

数值真源为 `C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json` 的 current item 3004：额外攻击力等于最大法力值的 2%。既有 Batch-C 已录入 `item_3004` 的 `ad=35`、`mana=500` 与 `ability_haste=15`；本项只补独立动态 AD provider。

现有 Generic Formula read、provider-bound attribute modifier 和 `value_policy/add` 可直接表达 `0.02 * source.attr.mana.resolved`，不增加 DDL、Wasm ABI/DTO 或生产 runtime。

> **2026-07-26 兼容扩展（非本 task 重新闭环）**：为支持同装 `法力流` direct-max-state Phase-A，敬畏公式读路径由历史 `source.attr.mana.max` 校正为 `source.attr.mana.resolved`（G8 tag `source_only_dynamic_effective_mana_ad_modifier`）。法力流本身由独立 task [`wasm-generic-manamune-manaflow-direct-max-state`](./通用ABI-魔宗法力流直接满层Phase-A详细设计.md) 闭环；**不得**再写“法力流仍 blocked”。

## 2. 数据合同

| 环节 | 合同 |
| --- | --- |
| provider | 独立 passive provider，仅 mount 到 `item_3004` |
| formula | `mul(0.02, source.attr.mana.resolved)`（2026-07-14 初版曾为 `mana.max`；2026-07-26 起为 `.resolved`） |
| modifier | source `ad` attribute modifier，value-policy `add` |
| state/listener | 无；有效法力变化应重新解析 modifier |

示例：source 有效法力 `mana.resolved=1000`（Awe-only，且 Base=Current=Max=Resolved）时，敬畏额外提供 20 AD。与法力流满层直达 `+360` 同挂时，input mana 0/1000/2000 → effective 360/1360/2360，source AD100 → combined 107.2/127.2/147.2（两遍 materialize）。seed 使用幂等 upsert，不改 Batch-C 静态属性，不执行 destructive SQL、live migration 或 publish。

## 3. 非目标

- 法力流 **完整** 8 秒 charge、on-hit/ability mana gain、增量 +3/+6、Muramana 变形等（属法力流 completed-boundary exclusions；满层直达 +360 已由独立 Manaflow Phase-A 闭环，见上）。
- 资源增长 gameplay、攻击触发、吸血、随机或主动技能轮转。
- live 发布与浏览器 live E2E。

## 4. 验收结果

- Backend seed/静态 SQL 合同与全量 Maven 测试通过（2026-07-14 初版；2026-07-26 由 Backend `615eda1b` 兼容扩展 `.resolved` + Manaflow provider）。
- TinyGo 验证 Awe-only 下 `mana` 0/1000/2000 → AD 动态 0/20/40（base AD100 → 100/120/140），source/target 隔离与动态重算，并完成全量验证；2026-07-26 追加 combined Manaflow 交叉。
- Web 只投影 source 的 formula/modifier，target 无 provider；lint/typecheck/Vitest/build 全部通过（2026-07-14）。
- G8 `敬畏` 为 `migrated`；`法力流` 已于 2026-07-26 由独立 Manaflow Phase-A 标 `migrated`（不再 blocked）；task governance 可分别解析敬畏与法力流文档。
