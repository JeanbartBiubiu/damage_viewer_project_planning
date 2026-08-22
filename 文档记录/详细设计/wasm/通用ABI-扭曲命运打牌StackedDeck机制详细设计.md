TASK_KEY: wasm-generic-twisted-fate-stacked-deck
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 扭曲命运打牌（Stacked Deck）rank5 机制详细设计

关联验证记录：[通用 ABI 扭曲命运打牌 Stacked Deck 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务只迁移 G8 精确候选中的 Twisted Fate E / Stacked Deck **rank5** 合同。

## 1. 目标与边界

目标是用现有 Generic ABI 精确表达 rank5 打牌被动：永久 +50% 攻击速度，以及每第 4 次 `basic_attack_hit` 触发一次额外魔法伤害。不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程。

本项明确只复用：

- provider state（命中计数与 reset）
- condition sequence（第 4 击 gate）
- attribute modifier（+50% AS）
- formula / resistance pipeline（raw 魔法伤害 → MR 结算）

不引入周期调度、建筑物特例、多 rank 参数表或主动技能轮转扩展。

## 2. 数据合同

| 环节 | 合同 |
| --- | --- |
| scope | 仅 rank5 |
| AS | source attribute modifier，+50% attack speed |
| cadence | 每 4 次 `event/basic_attack_hit`（source-owner）触发一次 |
| damage | magic，`raw = 165 + 0.20 * (resolved AD - base AD) + 0.40 * AP` |
| on-hit replay | `copyable_on_hit=false` |
| state | provider 命中计数；proc 后 reset，使 hit4 / hit8 均可独立触发 |

示例交叉：独立公式 raw `254.6`，目标 `magic_resist=100` 时结算为 `127.3`。seed 使用幂等 upsert，不执行 destructive SQL、live migration 或 publish。

## 3. 非目标

- 其它 rank 数值与成长表。
- 对建筑物的 50% 伤害减免。
- Q / W / R 主动技能与选牌轮转。
- live migration、Admin publish、浏览器对 live backend 的 E2E。
- 把代表机制计为其它 exact candidate 已迁移，或宣称 G8 全量 goal 完成。

## 4. 验收结果

- Backend seed / 静态 SQL 合同与 `LolGenericTwistedFateStackedDeckSeedSqlTest`（11/11）通过。
- TinyGo `generic_twisted_fate_stacked_deck_test` 覆盖 +50% AS、hit1–3 不触发、hit4/8 raw254.6→MR100 后 127.3、reset 与独立公式。
- Web combatDataAssembler 投影测试与 lint/typecheck/test/build 由本批次执行通过。
- G8 将该候选标为 `migrated`；聚合更新为 `migrated=20 / partial=4 / blocked=180 / out_of_scope=38`；task governance rebuild/query 可解析两份文档。
