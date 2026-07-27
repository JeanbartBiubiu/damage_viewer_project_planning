TASK_KEY: wasm-generic-twitch-deadly-venom
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI 图奇 P 死亡毒液 Deadly Venom 机制验证记录

详细设计：[通用 ABI - 图奇 P 死亡毒液（Deadly Venom）机制详细设计](../../详细设计/wasm/通用ABI-图奇P死亡毒液DeadlyVenom机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_twitch|P|死亡毒液`：`completed/full/generic_runtime`（G8 `migrated`）。Wiki：`normalized/generic/twitch-p.json`；revision `4013286`；contentSha256 `1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44`。合同：max6 / 6000ms / 普攻叠 1 / 每秒真实伤害 / flat 1·2·3·4·5（L1/5/9/13/17+）+ `0.03*AP` / 锚定 provider tick。

本文件由 **Cursor 文档/治理切片**（`PLAN_REV: twitch-deadly-venom-anchored-tick-v3` 已过 DESIGN_REVIEW_ONLY，运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish 或 push。

| Worktree / 阶段 | Commit | 内容 |
| --- | --- | --- |
| Wasm primitive | `8612d0d` | anchored provider ticks |
| Exact Twitch Wasm | `7cb8b1d` | Twitch Deadly Venom CompileGeneric→RunGeneric |
| Backend owning | `e18c3ef` | tick_anchor 成对字段 + seed 合同 |
| Backend 集成 | `92e100e` | Backend 合入 |
| Web owning | `61b93bf` | TickSpec `anchorScope`/`anchorStateKey` 投影 |
| Web 集成 | `5a0931a` | Web 合入 |
| G8/Unified 审计 | `8e5ba82` | Twitch P → completed/full；G8 migrated |

## 2. 验证结果（实现轮抄录）

### 2.1 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Twitch Deadly Venom | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| `scripts/build-wasm.ps1` | PASS；产物 1,168,476 bytes |
| `node scripts/smoke-node.mjs` | PASS；canonical compile/run/release |

### 2.2 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused | PASS（19） |
| owning full `mvn test` | PASS（625） |
| integrated focused | PASS（17） |
| integrated full `mvn clean test` | **非全量通过**：434 ran / 34 failures（既有 CRLF 敏感 seed 断言 + 一个不可用归档源制品）；**新** Twitch anchor/seed/service 测试均通过。此为 worktree/环境级 caveat，**不是** Twitch 失败，也**不是**全量 PASS。 |

### 2.3 Web

| 验证 | 结果 |
| --- | --- |
| owning lint / typecheck / Vitest / build / generic | PASS；Vitest 330；generic 110 |
| integrated lint / typecheck / Vitest / build / generic | PASS；Vitest 136；generic 102 |

### 2.4 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified normal + `--check` | PASS；候选顺序不变；非 Twitch disposition drift = 0 |
| Unified 254 | completed 59 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 114 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 59 / partial 3 / none 192 |
| G8 242 | migrated 50 / partial 4 / blocked 119 / out_of_scope 69 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=72） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=72；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-twitch-deadly-venom` | PASS；映射两份新文档 |
| 针对 rg：计数 completed59 / blocked_runtime114 / migrated50；§5 无 Twitch P 当前 blocker | PASS |
| `git diff --check` | PASS |

## 4. 已实现边界

已实现：1v1 普攻叠毒 + 锚定每秒真实伤害 + 等级 flat + AP 比。排除：非普攻上毒、野怪特例、E/Contaminate、多目标、净化/免疫、完整游戏模拟、live migrate/publish/E2E。`actionableKeyCount=0` **不是**停工条件。
