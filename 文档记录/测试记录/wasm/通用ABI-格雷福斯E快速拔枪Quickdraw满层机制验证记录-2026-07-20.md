TASK_KEY: wasm-generic-graves-quickdraw-max-stack
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI 格雷福斯 E 快速拔枪 Quickdraw 满层机制验证记录

详细设计：[通用 ABI - 格雷福斯 E 快速拔枪（Quickdraw）Phase-A 满层机制详细设计](../../详细设计/wasm/通用ABI-格雷福斯E快速拔枪Quickdraw满层机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Graves E / Quickdraw（快速拔枪）**Phase-A rank-5 满层 True Grit 近似**（治理口径 `completed/full/generic_runtime`，G8 `migrated`；**不**宣称完整游戏技能保真）：mana40 / CD12000ms；一次 cast `override` `true_grit_stacks` 0→8（max8 / untimed）；armor/bonus_armor 各 +152；MR/bonus_MR 各 +76；CompileFrame→RunFrame→ReleaseSessionFrame。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | pending / sibling worktree HEAD（实现未单独提交则记当前 HEAD） | 幂等 seed + 静态 SQL 合同 |
| Wasm | pending / 当前 worktree HEAD `4f78f9a`（实现文件未提交前不发明新 hash） | generic 合同回归 + G8/unified generator/`--check` |
| Web | 无本任务变更 | 既有 assembler 投影（validation-only） |

Wiki E 真源：`normalized/generic/graves-e.json`；revision `4007744`；contentSha256 `ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1`。Bootstrap 面板 provenance **不是** E 数值真理。跨 worktree 证据路径已齐；本记录**不执行** live migration、Admin publish、push 或浏览器 live E2E。Phase-A 排除（非 remainingGap）：intermediate stacks / 4s refresh/expiry / dash geometry / reload / attack reset / pellet CDR / targeting/collision/multi-target / full fidelity / live/E2E。

## 2. Design review（v5）

| 项 | 结果 |
| --- | --- |
| PLAN_REV | `graves-e-max-stack-phase-a-v5` |
| VERDICT | **READY** |
| 模型合同 | strict `grok-4.5` / `effort=high` / `fast=false` |
| runDelta | `0`（allowlist 外无变更） |
| 事件日志 | 完整；只读核对 Wiki SHA、state override、nested AST、audit 增量与 exact override |
| mutation | **无**（`DESIGN_REVIEW_ONLY`；未创建/编辑/删除任何文件） |

## 3. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericGravesQuickdrawMaxStackSeedSqlTest test`（implementation run） | PASS，10/10 |
| 同上（driving-model 复验，本记录创建时） | PASS，10/10 |
| `mvn test`（全量，driving-model） | PASS，600/600，Failures 0 / Errors 0 / Skipped 0 |

静态合同：`provider_hero_graves_quickdraw_max_stack` + `ability_hero_graves_quickdraw`；`true_grit_stacks` SQL `duration_ms=NULL` / refresh NULL → DTO `durationMs=0`；四条 flat-add；不覆写 Graves P 图。证据：`db/game_manage/seeds/lol_generic_graves_quickdraw_max_stack_seed.sql`。无 live DB / DDL / migration / publish。

## 4. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 -run GravesQuickdrawMaxStack ./internal/runtime/`（implementation run） | PASS |
| 同上（driving-model 复验，本记录创建时） | PASS |
| `go test -count=1 ./...`（driving-model） | PASS，TinyGo V2 全包通过 |
| `go run ./cmd/bench`（driving-model） | PASS；generic-run 100 samples，mean 137.87µs，p95 535.70µs |
| `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1`（driving-model） | PASS；`dist/tinygo_engine_v2.wasm` 1,155,992 bytes |
| `node .\scripts\smoke-node.mjs`（driving-model） | PASS；真实 compile → run（targetFinalHp=900）→ release |
| `node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2`（driving-model） | PASS；mean 0.388ms，p95 0.715ms |

实现为**既有 generic** ability/cost/cooldown/state/attribute modifier 管线，无 runtime / ABI / DTO 扩展。证据：`wasm/tinygo_engine_v2/internal/runtime/generic_graves_quickdraw_max_stack_test.go`。探针：代数 152/76；首次施放 0→8 与属性解析；CD skip；第二施 cap；Release 后不可再跑；无 damage/reload/geometry 图。

## 5. Web

| 验证 | 结果 |
| --- | --- |
| 源码变更 | **无**；Web 仅 validation-only |
| `npm run lint`（driving-model） | PASS；60 个 production source 无 legacy REST/module 引用 |
| `npm run typecheck`（driving-model） | PASS |
| `npm run test`（driving-model） | PASS；21 files / 309 tests |
| `npm run build`（driving-model） | PASS；production build 包含 1,155.99kB TinyGo Wasm；仅有既有 chunk-size warning |
| live E2E / 浏览器对 live backend | NOT RUN；不在 Phase-A 范围，**未声称** |

## 6. G8 / unified 与治理

| 验证 | 结果 |
| --- | --- |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs` + `--check` | PASS（audit implementation run；driving-model 复跑 `--check`） |
| `node 最小验证/数据/build-unified-mechanism-inventory.mjs` + `--check` | PASS（audit implementation run；driving-model 复跑 `--check`） |
| `node tools/task-governance/cli.mjs check` / `rebuild` / `docs wasm-generic-graves-quickdraw-max-stack` | PASS；SQLite 已通过显式 `rebuild` 重建；未运行 `--fix-headers` |
| Planning worktree `node tools/task-governance/cli.mjs check` | PASS（66 tasks；其 canonical 分支保持用户给定基线，无本任务写入） |

期望计数：G8 migrated48 / partial5 / blocked120 / out_of_scope69；unified completed56 / blocked_runtime117 / blocked_data3 / out_of_scope72 / regression_only5 / stale_or_duplicate1；completionMode full56 / partial5 / none193；`actionableKeyCount=0`。

Graves E exact generic 为 `migrated` / unified `completed/full/generic_runtime`；`remainingGap`/`blocker`/`runtimeGapEvidence` 已清空；离开原 `implementation_gap_no_unresolved_data_fields`。

## 7. 残余风险 / 边界

已实现（Phase-A）：满层 True Grit 直接 override + 四抗性 flat-add + mana/CD。Phase-A 排除：中间叠层 / 4s 刷新过期 / dash / reload / attack reset / pellet CDR / 碰撞多目标 / live/publish/E2E。后续不得把本 completed/full 误读为完整快速拔枪 / 完整游戏技能保真。Commit hash 待各自 worktree 正式提交后由 driving model 回填。
