TASK_KEY: wasm-generic-kaisa-supercharge
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI 卡莎 E 极限超载 Supercharge 机制验证记录

详细设计：[通用 ABI - 卡莎 E 极限超载（Supercharge）rank5 机制详细设计](../../详细设计/wasm/通用ABI-卡莎E极限超载Supercharge机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Kai'Sa E / Supercharge（极限超载）**Phase-A rank5 1v1 攻速分支**（治理口径 `completed/full/generic_runtime`，G8 `migrated`；**不**宣称完整游戏技能保真）：ability `ability_hero_kaisa_e_supercharge` / key `supercharge`；30 mana、10000ms cooldown；通用 `ability_started` listener 作为**充能完成近似**（非字面 cast-start）；provider-scoped timed state 4000ms——**Wasm fixture** `supercharge_as_active` / **Backend seed** `supercharge_active`（provider-local/data-defined，本证据语义等价，**非**跨 bundle 字面同键）；`attack_speed` `percent_add` 公式 `0.80 * provider.state.<active>`。交叉：base AS `0.60 * (1 + 0.80) = 1.08`；mana `100 → 70`；state 到期后 AS 回 `0.60`；冷却阻断重复施放。仅复用既有 generic ability/cost/cooldown/listener/state/modifier；无 DDL / ABI / DTO 扩展。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `275fd67` | 幂等 seed 与静态 SQL 合同测试 |
| Wasm | `588e0f7` | 既有 generic runtime 合同回归 + G8 generator/`--check` 更新 |
| Web | `58962a4` | 既有 generic assembler 投影回归（test-only，无产品 special case） |

Wiki：`数据参考/lol-wiki-current-champions/normalized/generic/kaisa-e.json`；revision `4038391`；contentSha256 `327dc441e84bf2b320dccbe9099b4e98bf42562529e95facd417fbbc27d99e24`。跨 worktree 交付提交已齐；本 Planning 记录只固化证据，**不执行** live migration、Admin publish 或浏览器对 live backend 的 E2E。用户批准排除（非 remainingGap）：移动速度+幽灵、attack-windup、真实充能/cast 时序、每次普攻 0.5s CD 返还、进化隐形、其它 rank、完整 rotation/cadence、多目标、live migration/publish/E2E。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericKaisaSuperchargeSeedSqlTest test` | PASS，9 tests |
| `mvn test`（GPT-owned） | PASS，318 tests |

静态合同确认 rank5 Supercharge：ability / 30 mana / 10000ms CD / `ability_started`→Backend seed state key `supercharge_active` 4000ms / `attack_speed` percent_add `0.80*state`；与 Wasm fixture `supercharge_as_active` 语义等价（非跨 bundle 字面同键）；**无 live DB**、无 DDL、无 migration、无自动 publish。证据：`db/game_manage/seeds/lol_generic_kaisa_supercharge_seed.sql`。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 -run TestKaisaSupercharge ./internal/runtime/` | PASS |
| `go test -count=1 ./...` | PASS |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check`（Wasm 仓根） | PASS |

实现为**既有 generic** ability/cost/cooldown/listener/state/modifier 管线，无 runtime / ABI / DTO 扩展。CompileGeneric → RunGeneric 证据：`wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_supercharge_test.go`（Wasm fixture state key `supercharge_as_active`）。目标交叉：`0.60→1.08`、mana `100→70`、到期回 `0.60`、CD 阻断重复施放；`ability_started` 文档化为充能完成近似。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run test`（GPT-owned） | PASS，114 tests（assembler 59） |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |

仅 projection / unit 合同；无 live backend、无 E2E；无产品专用 special case。

## 5. G8 / unified 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS；`node 最小验证/数据/build-unified-mechanism-inventory.mjs --check` PASS。Kai'Sa E exact generic 为 `migrated` / unified `completed/full/generic_runtime`，证据指向本 task（wasm test + backend seed），`remainingGap`/`blocker` 已清空；排除分支以 exclusions 记录。本项不宣称完整游戏技能保真，亦不虚构 live DB / Admin publish / 浏览器 live E2E。

Planning 治理：`node tools/task-governance/cli.mjs check` PASS；`wasm-generic-kaisa-supercharge` completion note 已更新为 Phase-A completed/full 边界说明。

## 6. 残余风险 / 边界

已实现（Phase-A）：rank5 E 的 30 mana / 10000ms CD、`ability_started`（充能完成近似）→4000ms timed state（Wasm fixture `supercharge_as_active` / Backend seed `supercharge_active`；语义等价，非跨 bundle 字面同键）、`attack_speed` percent_add `0.80*state`。用户批准排除：移动速度+幽灵、attack-windup、真实充能/cast 时序、每次普攻 0.5s CD 返还、进化隐形、其它 rank、完整 rotation/cadence、多目标、live migration/publish/E2E。后续不得把本 completed/full 误读为完整极限超载 / 完整游戏技能保真。
