TASK_KEY: wasm-generic-graves-new-destiny
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI 格雷福斯 P 新命运 New Destiny 机制验证记录

详细设计：[通用 ABI - 格雷福斯 P 新命运（New Destiny）Phase-A 贴脸机制详细设计](../../详细设计/wasm/通用ABI-格雷福斯P新命运NewDestiny机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Graves P / New Destiny（新命运）**Phase-A 贴脸最大弹丸 1v1**（治理口径 `completed/full/generic_runtime`，G8 `migrated`；**不**宣称完整游戏技能保真）：合并物理 `AD*F(x)*(1+3*s)`；C2 natural/forced override；一次 damage + 一次 `basic_attack_hit`；`copyable_on_hit=false`。

| Worktree | 内容 |
| --- | --- |
| Backend | 幂等 seed 与静态 SQL 合同（并行 worktree；driving model 最终校验） |
| Wasm | generic runtime 合同回归 + G8/unified generator/`--check`（本记录记录已跑结果） |
| Web | 既有 assembler 投影（validation-only；本任务无 Web 文件变更） |

Wiki P 真源：`normalized/generic/graves-p.json`；revision `4038342`；contentSha256 `553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8`。Bootstrap 面板 provenance（`graves-champion-data.json`）**不是** P 数值真理。跨 worktree 证据路径已齐；本记录**不执行** live migration、Admin publish 或浏览器 live E2E。Phase-A 排除（非 remainingGap）：精确装填公式（Wiki unknown）/ 弹药装填 / 弹道多目标 / RNG / live/E2E/完整保真。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericGravesNewDestinySeedSqlTest test`（sibling worktree） | NOT RUN HERE（Backend 并行；driving model 最终校验） |
| `mvn test`（全量） | NOT RUN HERE |

静态合同预期：`provider_hero_graves_new_destiny` + `ability_hero_graves_basic_attack`；一次 damage + 一次 hit；两条 scoped C2 override；无 live DB / DDL / migration / publish。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 ./internal/runtime -run GravesNewDestiny` | PASS（implementation agent，2026-07-20） |
| `go test -count=1 ./...` | NOT RUN HERE（可选；driving model 可复验） |
| `go run ./cmd/bench` | NOT RUN HERE（可选；driving model 可复验） |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs`（再生） | PASS（implementation agent） |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` | PASS（implementation agent） |
| `node 最小验证/数据/build-unified-mechanism-inventory.mjs`（再生） | PASS（implementation agent） |
| `node 最小验证/数据/build-unified-mechanism-inventory.mjs --check` | PASS（implementation agent） |

实现为**既有 generic** ability/formula/C2/emit_event 管线，无 runtime / ABI / DTO 扩展。CompileFrame → RunFrame → ReleaseSessionFrame 证据：`wasm/tinygo_engine_v2/internal/runtime/generic_graves_new_destiny_test.go`。探针：四独立 raw 交叉校验；抗性+护盾且 C2 证据在抗性前；natural/forced 同公式不双乘；单 damage + 单 hit；无 reload/projectile/multitarget 状态。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| lint / typecheck / test / build | NOT RUN HERE；本任务无 Web 文件变更 |
| live E2E / 浏览器对 live backend | NOT RUN；不在本 Phase-A 验证范围内，**未声称** |

## 5. G8 / unified 与治理

期望计数：G8 migrated 47 / partial 5 / blocked 121 / out_of_scope 69；unified completed 55 / blocked_runtime 118 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1；completionMode full 55 / partial 5 / none 194；`actionableKeyCount=0`。

Graves P exact generic 为 `migrated` / unified `completed/full/generic_runtime`，`dataGapEvidence.missingFields=[]`；Wiki reload unknown 仅作 completed-boundary exclusion。

Planning 治理：`node tools/task-governance/cli.mjs check` / `rebuild` / `docs wasm-generic-graves-new-destiny`（本实现将跑；不跑 `--fix-headers`）。

## 6. 残余风险 / 边界

已实现（Phase-A）：贴脸合并普攻 + C2 override + 单 hit 契约。Phase-A 排除：装填/弹药/弹道/多目标/RNG/live/publish/E2E。后续不得把本 completed/full 误读为完整新命运 / 完整游戏技能保真。

## 7. Driving-model final validation（2026-07-20）

- Backend focused：`mvn -Dtest=LolGenericGravesNewDestinySeedSqlTest test`，`11/11` PASS。
- Backend full：`mvn test`，`590/590` PASS。
- Wasm focused：`go test -count=1 ./internal/runtime -run GravesNewDestiny` PASS。
- Wasm full + native bench：`go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS。
- TinyGo：`scripts/build-wasm.ps1` PASS，产物 `1,155,992 bytes`。
- Node generic ABI：compile/run/release smoke PASS；10 iterations bench PASS（mean `0.412ms`, p95 `0.684ms`）。
- Web validation-only：lint 60 production files PASS；typecheck PASS；21 files / 309 tests PASS；production build PASS。
- Audit generators：G8 `--check` PASS（47/5/121/69）；unified `--check` PASS（completed 55、blocked_runtime 118、blocked_data 3、actionableKeyCount 0）。
- Governance：task `check/rebuild/docs wasm-generic-graves-new-destiny` PASS；agent-governance 仅保留已知的 Wasm `task_rules.json` 相对 planning 真源漂移。
- 未执行 live migration、publish、push 或浏览器 live E2E。
