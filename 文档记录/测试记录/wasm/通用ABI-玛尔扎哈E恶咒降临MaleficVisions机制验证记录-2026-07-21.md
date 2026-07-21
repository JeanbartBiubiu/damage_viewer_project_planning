TASK_KEY: wasm-generic-malzahar-malefic-visions
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI 玛尔扎哈 E 恶咒降临 Malefic Visions 机制验证记录

详细设计：[通用 ABI - 玛尔扎哈 E 恶咒降临（Malefic Visions）机制详细设计](../../详细设计/wasm/通用ABI-玛尔扎哈E恶咒降临MaleficVisions机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_malzahar|E|恶咒降临`：`completed/full/generic_runtime`（Unified EXTRA，**非** G8）。EXTRA sidecar：`数据参考/lol-wiki-extra-mechanisms/normalized/generic/malzahar-e.json`；page `1308233` / rev `4015185` / timestamp `2026-05-03`；contentSha256 `9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84`。合同：Rank5 mana100/CD7000；active cast 仅覆盖目标 `active=1`；state max1/duration4000/`refresh_on_write`；anchored 250/0；16 inclusive magic ticks t250..4000；每跳 `13.75+0.05AP`，合计 `220+0.80AP`。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: malzahar-e-anchored-dot-phase-a-v2`；DESIGN_REVIEW READY `run-2570cf99-908e-4d13-83c1-eb265282cd34`；fail-closed 驱动审计：runDelta0、1560 event lines parseable、无 truncation/mutation；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish 或 push。

| Worktree / 阶段 | Commit | 内容 |
| --- | --- | --- |
| Sidecar Wasm | `7159cd6` | EXTRA Wiki sidecar 捕获 |
| Sidecar Backend cherry-pick | `d8649bd` | Backend 侧 sidecar |
| Backend owning | `8444018` | seed + focused 合同 |
| Backend 集成 | `4351827` | Backend 合入 |
| Wasm exact | `0e69db1` | Malefic Visions CompileGeneric→RunGeneric |
| Anchored primitive | `8612d0d` | anchored provider ticks |
| Unified 审计 | `3e9a715` | Malzahar E → completed/full；EXTRA |
| Web owning（既有） | `61b93bf` | TickSpec 锚定投影 |
| Web 集成（既有） | `5a0931a` | Web 合入 |

## 2. 验证结果（实现轮抄录）

### 2.1 Sidecar 身份

| 验证 | 结果 |
| --- | --- |
| upstream identity / redirect / hash | PASS；upstream raw 2228 / hash `9098ee2f…ba84` |
| on-disk raw 序列化 | 仓库 trailing-whitespace 序列化 → disk raw 2226；**上游身份仍为 2228/hash** |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Malzahar Malefic Visions | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| `scripts/build-wasm.ps1` | PASS；产物 1,168,476 bytes |
| `node scripts/smoke-node.mjs` | PASS；canonical compile/run/release |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused | PASS（11） |
| owning full `mvn test` | PASS（632） |
| integrated focused | PASS（11） |
| integrated full `mvn clean test` | **非全量通过**：451 ran / 34 failures（既有 CRLF 敏感 legacy seed 断言）；**新** Malzahar 7 测与 GenericTickAnchor 4 均通过。此为 worktree 行尾 caveat，**不是** Malzahar 失败，也**不是**全量 PASS。 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| owning lint / typecheck / Vitest / build / generic | PASS；Vitest 330；generic 110 |
| integrated lint / typecheck / Vitest / build / generic | PASS；Vitest 136；generic 102 |
| 本机制 Web 代码变更 | 无 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| Unified normal + `--check` | PASS；sourceCount 12；key order 不变；非 Malzahar disposition drift = 0 |
| Unified 254 | completed 60 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 113 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 60 / partial 3 / none 191 |
| actionable | 0 |
| G8 check | PASS；**不变** 242 = migrated 50 / partial 4 / blocked 119 / OOS 69 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=73） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=73；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-malzahar-malefic-visions` | PASS；映射两份新文档 |
| 针对 rg：Malzahar 不在 §5 当前 blocker；12=9+3；completed60 / blocked_runtime113 / migrated50 | PASS |
| `git diff --check` | PASS |

## 4. 已实现边界

已实现：Rank-5 主目标锚定 magic DoT（250ms×16 inclusive）。排除：Q/R refresh、death spread/bounce/multitarget、2% mana restore/minion execute、cleanse/immunity、indirect/spell-effect、ranks1-4、cast targeting、mid-duration AP snapshot mutation、live/E2E/full fidelity。Batch-J 仅 historical regression。`actionableKeyCount=0` **不是**停工条件。
