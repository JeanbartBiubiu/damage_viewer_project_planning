TASK_KEY: wasm-generic-teemo-blinding-dart
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 提莫 Q 致盲吹箭 Blinding Dart 机制验证记录

详细设计：[通用 ABI - 提莫 Q 致盲吹箭（Blinding Dart）机制详细设计](../../详细设计/wasm/通用ABI-提莫Q致盲吹箭BlindingDart机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_teemo|Q|致盲吹箭`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Teemo/Q`，解析 `Template:Data Teemo/Blinding Dart`；page `1308208` / rev `3948425` / timestamp `2025-08-19T15:37:23Z`；raw bytes `1639`；SHA256 `4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/teemo-q.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。边界：`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry`。合同：Rank5 active 90 mana / 7000ms CD；immediate primary-target scaffold；恰好一笔非暴击/不可复制魔法 `260 + 0.70*source.attr.ap.resolved`。交叉：AP200 → raw400；MR100 → mitigated200；t0/t7000 命中，t6999 恰好一次 cooldown skip 且无 mana/伤害；mana334 → final154。控制排除先例：Draven E / Kayle Q。**不**宣称致盲保真或完整游戏保真。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: teemo-q-blinding-dart-phase-a-v1`；DESIGN_REVIEW READY `run-b74658a7-e987-4a8e-809a-3d3feb8313cb`，agent `agent-61db099b-b672-4f5d-9d15-d21c37c85cb7`，strict `grok-4.5/high/fast=false`，runDelta0/outside0，2171 parseable，无 truncation/mutation；审查修正已接受；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW | `run-b74658a7-e987-4a8e-809a-3d3feb8313cb` | READY；agent `agent-61db099b-b672-4f5d-9d15-d21c37c85cb7`；2171 parseable |
| Backend owning | `1803c8c`；`run-3a2fdad1-f014-46c6-8610-8245a05b558f` | seed + focused 34/34；full 659/659；runDelta3/outside0；799 parseable |
| Backend 集成 | `7e27f33` | Backend 合入 Wasm 分支 |
| Wasm exact | `6470c5d`；`run-4582c628-9cae-410a-86a1-bba210886b6e` | `generic_teemo_blinding_dart_test.go`；CompileGeneric→RunGeneric；focused 4/4；runDelta1/outside0；613 parseable |
| 审计 commit | `14b793e`；`run-6180b4c1-152e-400f-b2b8-3d157fe0565a` | G8/Unified 六路径；runDelta6/outside0；1113 parseable |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / bytes / SHA | PASS；`Template:Data Teemo/Q` → `Template:Data Teemo/Blinding Dart` / 1308208 / 3948425 / 2025-08-19T15:37:23Z / 1639 / `4e3c475e…40a7` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/teemo-q.json` |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_teemo_blinding_dart_test.go` | PASS（4/4） |
| `go test ./... -count=1` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（34/34） |
| owning full `mvn test` | PASS（659/659） |
| integrated | PASS（合入 `7e27f33`） |
| seed 合同 | 自包含；`hero_teemo` baseline（AP0、mana334）；保留 basic/Toxic Shot；独立 `provider_hero_teemo_q_blinding_dart`；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| owning lint / typecheck / Vitest / build | PASS；Vitest 330 |
| integrated lint / typecheck / Vitest / build | PASS；Vitest 136 |
| 本机制 Web 源码变更 | 无 |
| Web Wasm 资产现状（独立限制，非机制 blocker） | 当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`；冻结计划零生产 Wasm/Web 写入，漂移未扩大亦未同步 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified normal + `--check` | PASS；ordered keys 不变；241 非 Teemo G8 与 253 非 Teemo Unified 解析对象字节等价；仅 Teemo governed disposition/evidence 变化；registry / Batch-G checks PASS |
| G8 governed 最终字段 | `genericClassification=migrated`；exact `genericMechanismTags`；空 `remainingGap`；无 `dataGapEvidence`；raw upstream `classification`/`mechanismTags`/`auditBaseline` 为历史 provenance |
| Unified 254 | sourceCount 12；completed 63 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 110 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 63 / partial 3 / none 188 |
| actionable | 0 |
| G8 242 | migrated 53 / partial 4 / blocked 116 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 92 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `14b793e` |
| 审计 run | `run-6180b4c1-152e-400f-b2b8-3d157fe0565a`；agent `agent-bd5725db-d95a-4bdb-91b9-d9e61c55fd77`；runDelta6 / outside0；1113 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=76） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=76；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-teemo-blinding-dart` | PASS；映射两份新文档 |
| 针对 rg：Teemo Q 不在 §5/§6 当前 blocker；离开 `implementation_gap`；12=9+3；completed63 / blocked_runtime110 / migrated53 | PASS |
| `git diff --check` | PASS |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-target impact scaffold；单次非暴击/不可复制魔法 `260+0.70*AP`；CD/mana 探针（t0/t7000 命中，t6999 阻挡；mana334→154）。排除：blind/control 与 2–3s 持续时间、0.25s cast、projectile/speed2500/range/geometry/collision/selection、ranks1–4、on-hit/equipment/Toxic Shot/basic-attack coupling/rotation、multi-target、live/E2E/full fidelity。控制排除先例：Draven E / Kayle Q。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称致盲保真。
