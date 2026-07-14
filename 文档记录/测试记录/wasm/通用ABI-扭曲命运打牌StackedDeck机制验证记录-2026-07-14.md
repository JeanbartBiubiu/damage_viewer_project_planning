TASK_KEY: wasm-generic-twisted-fate-stacked-deck
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI 扭曲命运打牌 Stacked Deck 机制验证记录

详细设计：[通用 ABI - 扭曲命运打牌（Stacked Deck）rank5 机制详细设计](../../详细设计/wasm/通用ABI-扭曲命运打牌StackedDeck机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Twisted Fate E / Stacked Deck **rank5**：+50% AS；每 4 次 source-owner `basic_attack_hit` 触发魔法伤害 `raw = 165 + 0.20 * (resolved AD - base AD) + 0.40 * AP`，`copyable_on_hit=false`。独立交叉：raw `254.6`，`MR=100` → `127.3`。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | （尚未创建） | `lol_generic_twisted_fate_stacked_deck_seed.sql` 与静态 SQL 契约测试 |
| Wasm | （尚未创建） | `generic_twisted_fate_stacked_deck_test` 与 G8 JSON/CSV 重生成 |
| Web | （尚未创建） | combat-data assembler 的 Stacked Deck 投影回归 |

跨 worktree commits **尚未创建**；本 Planning 记录只固化已执行的文件/测试证据，不把未提交变更写成已入库假话。本轮未执行 live migration、Admin publish 或浏览器对 live backend 的 E2E。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericTwistedFateStackedDeckSeedSqlTest test` | PASS，11/11 |

静态合同确认 rank5 only：+50% AS attribute modifier、每 4 击 condition sequence、上述 magic formula、`copyable_on_hit=false`；无建筑物 50% 减免、其它 rank、Q/W/R、DDL 扩展或自动 publish。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `generic_twisted_fate_stacked_deck_test` | PASS：+50% AS；hit1–3 no proc；hit4/hit8 raw254.6、MR100⇒127.3；reset；独立公式 |

实现只复用现有 provider state、condition sequence、attribute modifier 与 formula/resistance pipeline，无 runtime/DDL 扩展。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| combatDataAssembler projection test | PASS（本批次） |
| `npm run lint` | PASS（本批次） |
| `npm run typecheck` | PASS（本批次） |
| `npm test` / build | PASS（本批次） |

Assembler 回归确认 rank5 Stacked Deck 合同投影；未宣称 live publish 或完整英雄技能轮转。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS。Stacked Deck rank5 为 `migrated`，证据指向本 task 与 Backend seed。聚合为 `migrated=20 / partial=4 / blocked=180 / out_of_scope=38`；migrated-only 为 `8.26%`（all）/`9.80%`（in-scope），migrated+partial 为 `9.92%`（all）/`11.76%`（in-scope）。

`node tools/task-governance/cli.mjs rebuild` 与 task/docs query 通过。rebuild 报告的既有 unassigned docs / 缺失 review archive 与本任务无关，未修改。本项不宣称 G8 全量 goal 已完成。

## 6. 已实现与未实现边界

已实现：rank5 +50% AS；每 4 击 magic raw/抗性结算；hit1–3 不触发；hit4/8 与 reset；独立公式交叉。未建模/未执行：建筑物 50% 伤害减免、其它 rank、Q/W/R 主动技能、live migration 与 publish。
