TASK_KEY: wasm-generic-kaisa-supercharge
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15

# 通用 ABI 卡莎 E 极限超载 Supercharge 机制验证记录

详细设计：[通用 ABI - 卡莎 E 极限超载（Supercharge）rank5 机制详细设计](../../详细设计/wasm/通用ABI-卡莎E极限超载Supercharge机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Kai'Sa E / Supercharge（极限超载）**rank5**（游戏语义 `partial` / candidate-level）：ability `ability_hero_kaisa_e_supercharge` / key `supercharge`；30 mana、10000ms cooldown；通用 `ability_started` listener 作为**充能完成近似**（非字面 cast-start）；provider-scoped `supercharge_active` 4000ms；`attack_speed` `percent_add` 公式 `0.80 * provider.state.supercharge_active`。交叉：base AS `0.60 * (1 + 0.80) = 1.08`；mana `100 → 70`；state 到期后 AS 回 `0.60`；冷却阻断重复施放。仅复用既有 generic ability/cost/cooldown/listener/state/modifier；无 DDL / ABI / DTO 扩展。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `275fd67` | 幂等 seed 与静态 SQL 合同测试 |
| Wasm | `588e0f7` | 既有 generic runtime 合同回归 + G8 generator/`--check` 更新 |
| Web | `58962a4` | 既有 generic assembler 投影回归（test-only，无产品 special case） |

跨 worktree 交付提交已齐；本 Planning 记录只固化证据，**不执行** live migration、Admin publish 或浏览器对 live backend 的 E2E。未建模：移动速度+幽灵、attack-windup、真实充能/cast 时序、每次普攻 0.5s CD 返还、进化隐形、其它 rank、完整 rotation/cadence。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericKaisaSuperchargeSeedSqlTest test` | PASS，9 tests |
| `mvn test`（GPT-owned） | PASS，318 tests |

静态合同确认 rank5 Supercharge：ability / 30 mana / 10000ms CD / `ability_started`→`supercharge_active` 4000ms / `attack_speed` percent_add `0.80*state`；**无 live DB**、无 DDL、无 migration、无自动 publish。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 -run TestKaisaSupercharge ./internal/runtime/` | PASS |
| `go test -count=1 ./...` | PASS |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check`（Wasm 仓根） | PASS |

实现为**既有 generic** ability/cost/cooldown/listener/state/modifier 管线，无 runtime / ABI / DTO 扩展。目标交叉：`0.60→1.08`、mana `100→70`、到期回 `0.60`、CD 阻断重复施放；`ability_started` 文档化为充能完成近似。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run test`（GPT-owned） | PASS，114 tests（assembler 59） |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |

仅 projection / unit 合同；无 live backend、无 E2E；无产品专用 special case。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS。Kai'Sa E exact generic 为 `partial`，证据指向本 task，`sourceWorktree=wasm`。聚合为 `migrated=20 / partial=8 / blocked=176 / out_of_scope=38`（`inScope=204`）；partial `3.31%`；migrated+partial 为 `11.57%`（all）/`13.73%`（in-scope）。证据记录 28 条。Input SHA-256 仍为 `63b2460e5307419ec9d1dc776de453237f9fed359d777b0b4be1e846e6695004`。Kai'Sa E 已离开原 false-OOS→blocked 列表（该列表现为 5 条）。

Planning 治理：`node tools/task-governance/cli.mjs rebuild`、`tasks`、`docs wasm-generic-kaisa-supercharge` 均 PASS（详见本节执行后输出）。本项不宣称 G8 全量 goal 已完成，亦不虚构 live DB / Admin publish / 浏览器 live E2E。

## 6. 残余风险

已实现：rank5 E 的 30 mana / 10000ms CD、`ability_started`（充能完成近似）→4000ms `supercharge_active`、`attack_speed` percent_add `0.80*state`。未建模：移动速度+幽灵、attack-windup、真实充能/cast 时序、每次普攻 0.5s CD 返还、进化隐形、其它 rank、完整 rotation/cadence、live migration/publish/E2E。后续不得把本 partial 误计为完整极限超载 / 完整 E 闭环。
