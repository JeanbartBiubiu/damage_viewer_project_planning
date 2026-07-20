TASK_KEY: wasm-generic-xayah-deadly-plumage
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI 霞 W 致死羽衣 Deadly Plumage 机制验证记录

详细设计：[通用 ABI - 霞 W 致死羽衣（Deadly Plumage）Phase-A rank5 机制详细设计](../../详细设计/wasm/通用ABI-霞W致死羽衣DeadlyPlumage机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Xayah W / Deadly Plumage（致死羽衣）**Phase-A rank5 1v1 近似**（治理口径 `completed/full/generic_runtime`，G8 `migrated`；**不**宣称完整游戏技能保真）：40 mana、14000ms cooldown；`ability_started` → 4000ms timed `deadly_plumage_active`；`attack_speed` percent_add `0.55*state`；source-owned pipeline `basic_damage * (1 + 0.25 * deadly_plumage_active)` @ `outgoing_pre_mitigation`（合并 1.25×，排除 on-hit/proc）；expected-crit 一次后再 ×1.25 一次；Guinsoo phantom 不重放非 CopyableOnHit 基攻且不重跑倍率。W 本身无 damage 操作。

| Worktree | Commit（当前基线） | 内容 |
| --- | --- | --- |
| Backend | `084f4dc` | 幂等 seed 与静态 SQL 合同测试（focused 10/10；本任务未单独提交则记 worktree HEAD） |
| Wasm | `58fd761` | generic runtime 合同回归 + G8/unified generator/`--check`（本任务未单独提交则记 worktree HEAD） |
| Web | `b14638a` | 既有 assembler 投影（validation-only；无 live E2E；本任务不改 Web 文件） |

Wiki：`数据参考/lol-wiki-current-champions/normalized/generic/xayah-w.json`；revision `4010669`；contentSha256 `09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7`。跨 worktree 证据已齐；本记录**不执行** live migration、Admin publish 或浏览器 live E2E。用户批准排除（非 remainingGap）：移速/Rakan/Runaan/多目标/projectile/in-flight/ward/blind/dodge/block/独立次级羽刃/其它 rank/完整 live 保真。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| focused `LolGenericXayahDeadlyPlumageSeedSqlTest`（sibling worktree） | PASS，10 tests / 0 failures |
| `mvn test`（GPT-owned 全量） | PASS，570 tests / 0 failures / 0 errors / 0 skipped |

静态合同确认 rank5 Deadly Plumage：ability / 40 mana / 14000ms CD / timed AS + pipeline basic_damage×1.25 excl on-hit/proc；shared types `62006/62009` fail-closed；**无 live DB**、无 DDL、无 migration、无自动 publish。证据：`db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql`。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 -run XayahDeadlyPlumage ./internal/runtime/` | PASS（本实现执行） |
| `go test -count=1 ./...` | PASS（本实现执行） |
| `go run ./cmd/bench` | PASS（本实现执行） |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` | PASS（本实现执行） |
| `node 最小验证/数据/build-unified-mechanism-inventory.mjs --check` | PASS（本实现执行） |

实现为**既有 generic** ability/cost/cooldown/listener/state/attribute+pipeline modifier 管线，无 runtime / ABI / DTO 扩展。CompileGeneric → RunGeneric 证据：`wasm/tinygo_engine_v2/internal/runtime/generic_xayah_deadly_plumage_test.go`。目标交叉：mana/CD/AS、inactive ×1.00 / active ×1.25、crit p=0/0.25/1、on-hit/proc 排除、phantom 非重放、W 无 damage ops。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| assembler 投影（既有 pipeline modifier 路径） | PASS；`npm run lint`、`npm run typecheck`、`npm run test`（309/309）、`npm run build` 均通过；本任务 **无 Web 文件变更** |
| live E2E / 浏览器对 live backend | NOT RUN；需 live backend，且不在本 Phase-A 验证范围内，**未声称** |

既有 assembler 投影 kind/command/channel/bucket/stage/value/condition，并对 pipeline modifier 使用 `target_attr_key='hp'` 占位。无产品专用 special case。

## 5. G8 / unified 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS；`node 最小验证/数据/build-unified-mechanism-inventory.mjs --check` PASS。Xayah W exact generic 为 `migrated` / unified `completed/full/generic_runtime`，证据指向本 task（wasm test + backend seed），`remainingGap`/`blocker`/`runtimeGapEvidence` 已清空；排除分支以 completedBoundary exclusions 记录。

期望计数：G8 migrated 45 / partial 5 / blocked 123 / out_of_scope 69；unified completed 53 / blocked_runtime 119 / blocked_data 4 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1；completionMode full 53 / partial 5 / none 196；`actionableKeyCount=0`。

Planning 治理：`node tools/task-governance/cli.mjs check` PASS；`rebuild` 后 `docs wasm-generic-xayah-deadly-plumage` 映射两份 feature 文档。不跑 `--fix-headers`。`node tools/agent-governance/cli.mjs check` 仅报告已知的 Wasm worktree `db/task_doc_governance/task_rules.json` 单项漂移；未手抄覆盖 planning/master 真源。

## 6. 残余风险 / 边界

已实现（Phase-A）：rank5 W 的 40 mana / 14000ms CD、4000ms timed AS +55%、合并 basic_damage ×1.25（expected-crit 一次）、on-hit/proc/phantom 排除。用户批准排除：移速/Rakan/Runaan/多目标/projectile/in-flight/ward/blind/dodge/block/独立次级羽刃/其它 rank/live migration/publish/E2E。后续不得把本 completed/full 误读为完整致死羽衣 / 完整游戏技能保真。
