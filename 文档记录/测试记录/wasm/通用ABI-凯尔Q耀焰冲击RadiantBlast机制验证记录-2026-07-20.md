TASK_KEY: wasm-generic-kayle-radiant-blast
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI 凯尔 Q 耀焰冲击 Radiant Blast 机制验证记录

详细设计：[通用 ABI - 凯尔 Q 耀焰冲击（Radiant Blast）Phase-A rank5 机制详细设计](../../详细设计/wasm/通用ABI-凯尔Q耀焰冲击RadiantBlast机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Kayle Q / Radiant Blast（耀焰冲击）**Phase-A rank5 主目标 1v1**（治理口径 `completed/full/generic_runtime`，G8 `migrated`；**不**宣称完整游戏技能保真）：魔法伤害 `180+0.60*bonusAD+0.50*AP`；先伤后击碎；`kayle_q_sundered` 4000ms → armor/MR −15%；100 mana / 8000ms CD。

| Worktree | 内容 |
| --- | --- |
| Backend | 幂等 seed、reserved-type fail-closed 合同与静态 SQL 测试（driving model 已最终校验） |
| Wasm | generic runtime 合同回归 + G8/unified generator/`--check`（driving model 已复验） |
| Web | 既有 assembler 投影（validation-only；driving model 已最终校验；本任务无 Web 文件变更） |

Wiki Q 真源：`数据参考/lol-wiki-current-champions/normalized/generic/kayle-q.json`；revision `4005105`；contentSha256 `ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c`。Backend bootstrap 面板 provenance **不是** Q 数值真理；本地无 Module dump 时不编造 SHA。跨 worktree 证据路径已齐；本记录**不执行** live migration、Admin publish 或浏览器 live E2E。Phase-A 排除（非 remainingGap）：slow / portal delay / windup cast / projectile / cross-secondary / ranks1–4 / death persistence / live/E2E/完整保真。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericKayleRadiantBlastSeedSqlTest test`（sibling worktree） | PASS，9/9 |
| `mvn test`（全量） | PASS，579/579 |

静态合同确认 rank5 Radiant Blast：ability / 100 mana / 8000ms CD / damage-then-`kayle_q_sundered` / armor+MR percent_add −15%；**无 live DB**、无 DDL、无 migration、无自动 publish。证据：`db/game_manage/seeds/lol_generic_kayle_radiant_blast_seed.sql`。生产 seed **不含** 测试探针 ability。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 ./internal/runtime -run TestKayleRadiantBlast` | PASS（driving model 复验） |
| `go test -count=1 ./...` | PASS（driving model 复验） |
| `go run ./cmd/bench` | PASS（driving model 复验） |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` | PASS（driving model 复验） |
| `node 最小验证/数据/build-unified-mechanism-inventory.mjs --check` | PASS（driving model 复验） |

实现为**既有 generic** ability/cost/cooldown/provider-target state/attribute modifier 管线，无 runtime / ABI / DTO 扩展。CompileGeneric → RunGeneric 证据：`wasm/tinygo_engine_v2/internal/runtime/generic_kayle_radiant_blast_test.go`。目标交叉：raw 254（AD base100/resolved140/AP100）、先伤后 shred→85、物理+魔法 probe、4000ms 回 100、mana/CD、ops 顺序、无 slow/projectile/multi-target。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run lint` / `npm run typecheck` | PASS；lint 扫描 60 个生产源码文件 |
| `npm run test` | PASS，21 files / 309 tests |
| `npm run build` | PASS；现有 generic assembler / Worker / Wasm 宿主链构建通过，本任务 **无 Web 文件变更** |
| live E2E / 浏览器对 live backend | NOT RUN；不在本 Phase-A 验证范围内，**未声称** |

## 5. G8 / unified 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS；`node 最小验证/数据/build-unified-mechanism-inventory.mjs --check` PASS。Kayle Q exact generic 为 `migrated` / unified `completed/full/generic_runtime`，证据指向本 task（wasm test + backend seed），`remainingGap`/`blocker`/`runtimeGapEvidence` 已清空；排除分支以 completedBoundary exclusions 记录。

期望计数：G8 migrated 46 / partial 5 / blocked 122 / out_of_scope 69；unified completed 54 / blocked_runtime 118 / blocked_data 4 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1；completionMode full 54 / partial 5 / none 195；`actionableKeyCount=0`。

Planning 治理：`node tools/task-governance/cli.mjs check` PASS；`rebuild` 后 `docs wasm-generic-kayle-radiant-blast` 映射两份 feature 文档。不跑 `--fix-headers`。

## 6. 残余风险 / 边界

已实现（Phase-A）：rank5 主目标魔法伤害 + 15% 抗性击碎 4000ms + 100 mana / 8000ms CD。Phase-A 排除：slow/portal/windup/projectile/cross-secondary/ranks1–4/death persistence/live/publish/E2E。后续不得把本 completed/full 误读为完整耀焰冲击 / 完整游戏技能保真。
