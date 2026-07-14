TASK_KEY: wasm-generic-ashe-rangers-focus
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI 艾希 Q 射手的专注 Rangers Focus 机制验证记录

详细设计：[通用 ABI - 艾希 Q 射手的专注（Ranger's Focus）rank5 机制详细设计](../../详细设计/wasm/通用ABI-艾希Q射手的专注RangersFocus机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Ashe Q / Ranger's Focus **rank5**（游戏语义 `partial`）：Focus 四层施放门控、30 mana、6 秒 Flurry、+75% AS、首发/后续 6/5 箭各 `raw = 0.28 * resolvedAD`、每次 Flurry 普攻只发一个 `basic_attack_hit`、Focus 刷新后 4/5/6/7 秒槽位掉层。交叉：`resolvedAD=100` → 首发 168、后续 140。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `46219f0` | optional `cast_condition_formula_key`（ability_definitions + log）、兼容 `ADD COLUMN IF NOT EXISTS` 合同、Ashe 幂等 seed 与静态 SQL 测试 |
| Wasm | `476b780` | `castCondition` 编译为能力自身 program；Focus 门控 skip 无副作用；Flurry/掉层/箭数公式与 G8 JSON/CSV 重生成 |
| Web | `452b036` | optional `castConditionFormulaKey` DTO/Admin；assembler `formulaRef`→`castCondition` 投影回归 |

跨 worktree 交付提交已齐；本 Planning 记录只固化证据，**不执行** live migration、Admin publish 或浏览器对 live backend 的 E2E。未建模：attack-timer reset、逐箭飞行、Frost Shot、吸血、建筑物/多目标、完整 rotation/cadence、其它 rank。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn test` | PASS，303/303 |
| SQL contract / seed 静态测试 | PASS：optional / absent / null；compatibility DDL 文本合同；Focus / castCondition / Q cost / Flurry data |

静态合同确认 optional `cast_condition_formula_key`、Ashe rank5 Focus 门控与 Flurry 数据；**未实际跑 DDL**、无 live migration、无自动 publish。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 ./...` | PASS |
| build-wasm / generic export smoke / bench | PASS |
| Ashe Rangers Focus 专门测试 | PASS：`<4` Focus 时无 mana/state/event 副作用；四层后可施放；4/5/6/7 秒逐层掉落；6/5×28% resolved AD；Flurry 期间不再积 Focus；无 `castCondition` 的能力兼容 |

实现将 `castCondition` 编译为能力自身 program，在已解析 `abilityRef` 的 owning mounted provider state 读 Focus；false 或 eval error 均 skip 且无资源/冷却/event 副作用。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run test` | PASS，8 files / 112 tests |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| build | PASS（仅既有 chunk-size warning） |

Assembler 与 Admin optional `castConditionFormulaKey` 字段回归通过；未宣称 live publish 或浏览器对 live backend E2E。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS。Ashe Q exact generic 为 `partial`，证据指向本 task，`sourceWorktree=wasm`。聚合为 `migrated=20 / partial=6 / blocked=178 / out_of_scope=38`（`inScope=204`）；partial `2.48%`；migrated+partial 为 `10.74%`（all）/`12.75%`（in-scope）。证据记录 26 条。Input SHA-256 `63b2460e5307419ec9d1dc776de453237f9fed359d777b0b4be1e846e6695004`。

本 Planning 批次不运行 governance rebuild（由驱动模型随后执行）。本项不宣称 G8 全量 goal 已完成，亦不虚构 live DB / Admin publish / 浏览器 live E2E。

## 6. 残余风险

已实现：Focus 四层门控、30 mana、6s Flurry、+75% AS、首发/后续 6/5 箭×28% resolved AD、单 `basic_attack_hit`、4/5/6/7s 掉层。未建模：attack-timer reset、逐箭飞行、Frost Shot、吸血、建筑物/多目标、完整 rotation/cadence、其它 rank、live migration/publish/E2E。后续不得把本 partial 误计为完整射手的专注闭环。
