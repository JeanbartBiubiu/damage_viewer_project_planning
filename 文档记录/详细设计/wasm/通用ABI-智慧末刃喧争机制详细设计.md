TASK_KEY: wasm-generic-wits-end-fray
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 智慧末刃喧争（item_3091）机制详细设计

关联验证记录：[通用 ABI 智慧末刃喧争机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务迁移 G8 精确候选 `item_passive|3091|item_passive|喧争`。

## 1. 目标与边界

数值真源为 `C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json` 的 current item 3091：基础攻击造成 45 点额外魔法伤害，属于 on-hit。

现有 Generic ABI 的 `event/basic_attack_hit`、source-owner listener、opponent damage 与 `copyable_on_hit` 可直接表达，不增加 DDL、Wasm ABI/DTO 或生产 runtime。item 的 `OnHitAppliesLifeSteal` 标签不是本候选的伤害公式；治疗/吸血语义不纳入此 DPS 数据合同。

## 2. 数据合同

| 环节 | 合同 |
| --- | --- |
| provider | 独立 passive provider，仅 mount 到 `item_3091` |
| listener | `event/basic_attack_hit` + `event/source_owner`，每原始命中最多一次 |
| damage | opponent target、const 45、magic、value-policy `add` |
| on-hit replay | `copyable_on_hit=true`，鬼索 phantom 仅复放该伤害且不递归 |

`magic_resist=100` 时，独立公式交叉值为 `45 * 100 / (100 + 100) = 22.5`。seed 使用幂等 upsert，不执行 destructive SQL、live migration 或 publish。

## 3. 验收结果

- Backend seed/静态 SQL 合同与全量 Maven 测试通过。
- TinyGo 验证原始命中 45/22.5、source/target 隔离，以及鬼索 phantom 恰复放一次而不递归，并完成全量运行、构建和 smoke 验证。
- Web 仅投影 source 的 provider/listener/damage 与 copyable-on-hit 标记，target 无 provider；lint/typecheck/Vitest/build 全部通过。
- G8 只迁移 `喧争`，task governance rebuild/query 可解析两份文档。

## 4. 非目标

- 吸血、治疗、资源或防御层效果。
- 新 runtime、DDL、随机暴击、attack-start、Spellblade、Energized。
- live 发布与浏览器 live E2E。
