TASK_KEY: wasm-generic-draven-stand-aside
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 德莱文 E 开道利斧 Stand Aside 机制验证记录

详细设计：[通用 ABI - 德莱文 E 开道利斧（Stand Aside）机制详细设计](../../详细设计/wasm/通用ABI-德莱文E开道利斧StandAside机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_draven|E|开道利斧`：`completed/full/generic_runtime`（G8 `migrated`）。Wiki：`Template:Data Draven/Stand Aside`；page `1307070` / rev `4034694` / timestamp `2026-06-23T21:12:57Z`；raw bytes `1168`；SHA256 `7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d`；reviewed sidecar `数据参考/lol-wiki-current-champions/normalized/generic/draven-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。边界：`rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget`。合同：Rank5 active 70 mana / 12000ms CD；immediate primary-target scaffold；一笔非暴击/不可复制物理 `215 + 0.50*(resolvedAD-baseAD)`。交叉：AD62/142/bonus80 → raw255；armor100 → mitigated127.5；t0/t12000 命中，t11999 cooldown-blocked 且不扣 mana。Canonical `AbilityDefinition` 无 cast-delay/phases；Wiki 250ms timing **显式排除**。**不**宣称完整游戏保真。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: draven-e-stand-aside-phase-a-v2`；DESIGN_REVIEW v1 **非** READY（superseded）；v2 READY `run-5317a2c2-4fbd-488e-b357-f4137248a6fd`，strict `grok-4.5/high/fast=false`，runDelta0/outside0，1565 parseable，无 truncation/mutation；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW v2 | `run-5317a2c2-4fbd-488e-b357-f4137248a6fd` | READY；agent `agent-cb876ac5-6868-4d9c-9dc9-a2587b2e23bf` |
| Backend owning | `5f1f2bb`；`run-9548e3da-9ca0-4247-9bcb-ff43e520bc72` | seed + focused 40/40；full 650/650；runDelta3/outside0；809 parseable |
| Backend 集成 | `09dbf07` | Backend 合入 Wasm 分支 |
| Wasm exact | `d1e6c32`；`run-1e720b4b-2d85-4961-bbf1-16b1affea5bb` | `generic_draven_stand_aside_test.go`；CompileGeneric→RunGeneric→ReleaseSession；runDelta1/outside0；622 parseable |
| 审计 commit | `2905b6d` | G8/Unified 六路径 |
| 首轮审计（非独立验收） | `run-0c1cfd87-7133-44f1-8ef1-2d4e7faff30f` | 产出六路径 diff 后外部终止于 postflight 前 |
| 审计恢复验证 | `run-16a3942e-31c9-426c-be3d-3d5926fc8d40`；agent `agent-b742e16c-6705-4c3f-be7f-a8265f965952` | strict；auditAvailable=true；runDelta2/outside0；652 parseable；主会话核验六路径 |
| Web | 无本机制变更 | owning/integrated 验证 PASS |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| template / page / rev / timestamp / bytes / SHA | PASS；`Template:Data Draven/Stand Aside` / 1307070 / 4034694 / 2026-06-23T21:12:57Z / 1168 / `7bb6ebdc…8e8d` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/draven-e.json` |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_draven_stand_aside_test.go` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| TinyGo / `scripts/build-wasm.ps1` | PASS；产物 1,168,476 bytes |
| `node scripts/smoke-node.mjs` | PASS；canonical compile/run/release |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（40/40） |
| owning full `mvn test` | PASS（650/650） |
| integrated | PASS（合入 `09dbf07`） |
| seed 合同 | 自包含；独立 `provider_hero_draven_e_stand_aside`；与 Q/W/basic 共存；幂等 revision guard；无 delete/DDL/auto-publish |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| owning lint / typecheck / Vitest / build / generic | PASS；Vitest 330；generic 110 |
| integrated lint / typecheck / Vitest / build / generic | PASS；Vitest 136；generic 102 |
| 本机制 Web 代码变更 | 无 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified normal + `--check` | PASS；key order 不变；非 Draven disposition drift = 0；registry / Batch-G checks PASS |
| Unified 254 | sourceCount 12；completed 62 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 111 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 62 / partial 3 / none 189 |
| actionable | 0 |
| G8 242 | migrated 52 / partial 4 / blocked 117 / OOS 69 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `2905b6d` |
| 首轮审计 | `run-0c1cfd87-7133-44f1-8ef1-2d4e7faff30f`（外部终止；**非**独立验收） |
| 恢复验证 | `run-16a3942e-31c9-426c-be3d-3d5926fc8d40`；runDelta2 / outside0；652 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=75） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=75；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-draven-stand-aside` | PASS；映射两份新文档 |
| 针对 rg：Draven E 不在 §5/§6 当前 blocker；离开 `implementation_gap`；12=9+3；completed62 / blocked_runtime111 / migrated52 | PASS |
| `git diff --check` | PASS |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-target impact scaffold；单次非暴击/不可复制物理 `215+0.50*bonusAD`；CD/mana 探针（t0/t12000 命中，t11999 阻挡）。排除：ranks1–4、projectile/travel、line/fan geometry、collision、target selection、multi-target/repeat、knock aside/airborne/slow/其他 CC、250ms cast timing（无 canonical 字段，禁止假 delay phase）、equipment/loadout、live/E2E/full fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成。
