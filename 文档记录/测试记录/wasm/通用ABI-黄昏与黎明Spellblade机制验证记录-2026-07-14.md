TASK_KEY: wasm-generic-dusk-and-dawn-spellblade
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI 黄昏与黎明 Spellblade 机制验证记录

详细设计：[通用 ABI - 黄昏与黎明 Spellblade（item_2510）机制详细设计](../../详细设计/wasm/通用ABI-黄昏与黎明Spellblade机制详细设计.md)。

> 本文件名保持 `…验证记录-2026-07-14.md`；本记录已自 2026-07-14 主伤害 partial 延伸至 **2026-07-21 exact 全合同完成**（heal + +200ms delayed repeat）。

## 1. 范围与本地提交

已闭环候选 `item_passive|2510|item_passive|咒刃`：`completed/full/generic_runtime`（G8 `migrated`）。Wiki：item 2510；revid `4030984`；SHA `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`。

Exact 合同：10s ready；魔法 `0.75 base AD + 0.10 resolved AP`；自身治疗一次 `0.10 AP + 0.03 bonus HP`；强化命中后 +200ms 一次 canonical copyable-on-hit replay；1.5s ICD 自强化命中起算；自身 Spellblade 伤害 non-copyable；五步共享 ready gate；无递归。

| Worktree / 阶段 | Commit | 内容 |
| --- | --- | --- |
| Backend owning | `fc37d59` | `delay_ms` schema/log + 兼容迁移、mapper/API 默认 0、2510 seed 顺序 damage/heal/repeat/icd/ready、JUnit |
| Web owning | `ee5c091` | `delayMs`→`repeatDelayMs`、省略/0 legacy、admin 非负整数/默认 0 |
| Wasm primitive | `dc45881` | 可选 `repeatDelayMs` + `GenericEventTriggeredContinuation` |
| Backend integration | `2b47a8d` | Backend 合入 Wasm 分支 |
| Wasm-branch Web integration | `d225ddf` | Web 合约合入当前 Wasm 分支架构 |
| item test | `c9d9779` | `generic_dusk_and_dawn_spellblade_test.go` exact heal/+200ms |
| audit | `1566426` | G8 `migrated` + Unified `completed/full` |

本轮**未**执行 live migration、Admin publish、push 或浏览器对 live backend 的 E2E。

## 2. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 ./internal/compile/ ./internal/scheduler/ ./internal/runtime/ -run "RepeatDelay\|TriggeredContinuation\|…"`（primitive） | PASS |
| `go test -count=1 ./internal/runtime -run DuskAndDawn`（item 集成） | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| `scripts/build-wasm.ps1` | PASS |
| `node scripts/smoke-node.mjs` | PASS |

独立数值：`baseAD=100`、`AP=100` 时 raw=85，`magic_resist=100` 后=42.5。Heal 探针（AP=100、bonus HP=1000）期望 40。回归覆盖 arm/consume、ICD、ready expiry、snapshot、Guinsoo phantom 隔离、heal 一次、+200ms copyable replay、未武装跳过 heal/repeat。

## 3. Backend

| 验证 | 结果 |
| --- | --- |
| focused `mvn -Dtest=LolGenericDuskAndDawnSpellbladeSeedSqlTest test` | PASS |
| full `mvn test` / package（owning + 合入校验） | PASS |

静态契约：item_2510 only mount；10s ready；命中起算 1.5s ICD；精确魔法 + heal；`repeat delay_ms=200`；操作序 `damage → heal → repeat → ICD → ready`；`copyable_on_hit=false`；共享 ready gate；无自动 publish。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| focused assembler + registry（delayMs 200 / omitted / 0；admin blank→0 / 负值拒绝） | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS（8 files / 117 tests） |
| `npm run build` | PASS |
| `npm run test:wasm-generic` | PASS（4 files / 85 tests） |

Assembler：`delayMs>0`→`repeatDelayMs`；省略/`0` 不投影该字段。Admin：非负整数、空白默认 0。owning `ee5c091` 与 Wasm-branch 集成 `d225ddf` 均已校验。

## 5. G8 / Unified 与治理

| 验证 | 结果 |
| --- | --- |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs` + `--check` | PASS |
| `node 最小验证/数据/build-unified-mechanism-inventory.mjs` + `--check` | PASS |
| 相对 pre-run 基线的 key/非 2510 分类 parity 断言 | PASS |
| `node tools/task-governance/cli.mjs check` / `rebuild`（SQLite only）/ `docs wasm-generic-dusk-and-dawn-spellblade` | PASS；未运行 `--fix-headers` |

当前计数：G8 migrated=49 / partial=4 / blocked=120 / out_of_scope=69；Unified total254；completed=57 / blocked_runtime=116 / blocked_data=3 / out_of_scope=72 / regression_only=5 / stale_or_duplicate=1；full=57 / partial=4 / none=193；`actionableKeyCount=0`。

2510：`remainingGap` 空；Unified blocker 空、`runtimeGapEvidence=null`。

## 6. 已实现边界

已实现：item_2510 exact Spellblade（主伤害 + heal + +200ms delayed copyable on-hit + ready/ICD + 共享 gate + 非递归）。排除：live migration/publish、多 Spellblade unique-group、完整 gameplay rotation、浏览器 live E2E。不得再把 heal / delayed repeat 描述为 gap。
