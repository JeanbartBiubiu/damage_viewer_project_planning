TASK_KEY: wasm-generic-varus-blighted-quiver
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-21

# 通用 ABI 韦鲁斯 W 枯萎箭袋 Blighted Quiver 机制验证记录

详细设计：[通用 ABI - 韦鲁斯 W 枯萎箭袋（Blighted Quiver）机制详细设计](../../详细设计/wasm/通用ABI-韦鲁斯W枯萎箭袋BlightedQuiver机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_varus|W|枯萎箭袋`：`completed/full/generic_runtime`（G8 `migrated`）。Wiki：`数据参考/lol-wiki-current-champions/normalized/generic/varus-w.json`；page `1309980` / rev `4026472` / timestamp `2026-06-09`；contentSha256 `16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2`；sourceCount **仍为 12**（无新源）。边界：`fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop`。合同：Rank5 被动 magic `40+0.15*bonusAD+0.25*AP` 后 Blight max3/6000ms/`refresh_on_write`；W active max1/5500ms；W-scoped 满充能 Q ordering scaffold：物理 `360+1.20*bonusAD` → W active `21%` missing HP（post-Q/pre-Blight）→ Blight 每层 maxHP `(5% + 1.3% per 100 AP)×1.5` → conditional resets。**不**完成真实 Varus Q key 或完整游戏保真。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: varus-w-blighted-quiver-phase-a-v2`；DESIGN_REVIEW v1 REVISE `run-8f9a302a-2d3f-4c13-843b-c894fded476e`；v2 READY `run-c24dbdbc-19d3-41e3-9a26-34dd66d41ce2`，valid read-only audit runDelta0/1726 parseable/无 mutation；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| Backend owning | `ca8809d` | seed + focused 41/41；full 641/641 |
| Backend 集成 | `5b2a18e` | Backend 合入 |
| Wasm exact | `d6f2ea5` | Blighted Quiver CompileGeneric→RunGeneric |
| Wasm 完成修复/审计（执行溯源） | `run-5d9a46d8-9ffe-4959-a91e-bd2ec964090a` | 首轮 Cursor TLS 中断后的完成轮；runDelta1/845 parseable/无 truncation；仅 exact test 路径（**非**机制 caveat） |
| G8/Unified 审计 | `run-ae4a525a-9fe7-4bdb-9c02-0cf228216197`；`85910fb` | six paths / runDelta6 / outside0；1067 parseable / 无 truncation |
| Web | 无本机制变更 | owning/integrated 验证 PASS |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| page / rev / timestamp / SHA | PASS；1309980 / 4026472 / 2026-06-09 / `16307174…01d2` |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Varus Blighted Quiver | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| `scripts/build-wasm.ps1` | PASS；产物 1,168,476 bytes |
| `node scripts/smoke-node.mjs` | PASS；canonical compile/run/release |

执行溯源（非机制 caveat）：首轮 Wasm 尝试遇 Cursor TLS 网络中断；完成修复/审计轮为 `run-5d9a46d8-9ffe-4959-a91e-bd2ec964090a`。

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused | PASS（41/41） |
| owning full `mvn test` | PASS（641/641） |
| integrated | PASS（合入 `5b2a18e`） |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| owning lint / typecheck / Vitest / build / generic | PASS；Vitest 330；generic 110 |
| integrated lint / typecheck / Vitest / build / generic | PASS；Vitest 136；generic 102 |
| 本机制 Web 代码变更 | 无 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified normal + `--check` | PASS；key order 不变；非 Varus disposition drift = 0；registry / Batch-G checks PASS |
| Unified 254 | sourceCount 12；completed 61 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 112 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 61 / partial 3 / none 190 |
| actionable | 0 |
| G8 242 | migrated 51 / partial 4 / blocked 118 / OOS 69 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 实现审计 run | `run-ae4a525a-9fe7-4bdb-9c02-0cf228216197`；commit `85910fb` |
| 路径 / delta | six paths；runDelta6；outside0 |
| 事件 | 1067 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=74） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=74；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-varus-blighted-quiver` | PASS；映射两份新文档 |
| 针对 rg：Varus W 不在 §5 当前 blocker；12=9+3；completed61 / blocked_runtime112 / migrated51 | PASS |
| `git diff --check` | PASS |

## 4. 已实现边界

已实现：Rank-5 被动 on-hit magic + 目标 Blight 叠层；W active 武装；W-scoped 满充能 Q ordering scaffold（物理 → W active missing-HP → Blight×1.5 → conditional reset）。排除：ranks1-4、可变充能、W CD/recast/death/CC、Q resource/channel/projectile/多目标、Blight CDR refund、其他技能消费者、monster caps、shield/blind/block/dodge、Spellblade suppression、Guinsoo/phantom/equipment interop、live/E2E/full fidelity。**不**完成真实 Varus Q key。`actionableKeyCount=0` **不是**停工条件。
