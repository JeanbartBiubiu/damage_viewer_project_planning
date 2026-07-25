TASK_KEY: wasm-generic-provisional-mechanism-template-registry
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 暂定机制模板注册表 Phase-T1 详细设计

关联验证记录：[通用 ABI 暂定机制模板注册表 Phase-T1 验证记录](../../测试记录/wasm/通用ABI-暂定机制模板注册表Phase-T1验证记录-2026-07-25.md)。本任务仅落地 **provisional template-registry 基础设施**：独立派生生成器 + 87 张暂定草稿卡片。**不**宣称 87 行中任何机制已实现、已 completed/full/ready，**不**暗示 runtime / Backend 实现，**不**改变 Unified / G8 / Wiki-only registry / Batch-G 真源或计数。冻结方案：`FROZEN_PLAN_REV provisional-mechanism-template-registry-phase-t1-v2`（有效 DESIGN_READY `run-311a86b9-d5c6-4f1a-93ff-578ffa349c33`；strict `grok-4.5` / high / fast=false；1510/1510 parseable event lines / 54/54 complete tool groups；零 truncation；runDelta0/diff0；无 mutating activity / blocker / nonblocking / user decision）。

## 1. 目的与非目标

### 1.1 目的

- 为当前 Unified 过滤目标集（`partial_actionable` / `ready_to_implement` / `blocked_runtime` / `blocked_data`）生成 **87** 张共享形状的暂定草稿卡片，加速后续逐卡或有界批次的 Wiki 核验与 Phase-A 推进。
- 以独立派生注册表承载卡片；**不得**进入 Unified ACTIVE / GENERATOR allowlist 或 `currentInputHashes`；`sourceCount` **仍为 12**。
- 冻结 schema `provisional-mechanism-template-registry-v1` 与 plan `provisional-mechanism-template-registry-phase-t1-v2`；Phase-T1 精确计数绑定两份输入 hash pin。

### 1.2 非目标

- **不**把任何 provisional 行标为 completed / full / ready / migrated。
- **不**实现 runtime、Backend seed、Web、live migration / publish。
- **不**改写 Unified / G8 / Wiki-only registry / Batch-G 产物或生成器真源。
- **不**把 `sourceText` / legacy classification / `auditBaseline` 当作 completion truth。
- 输入漂移时 **不得**静默接受；须新 plan revision 与刷新 pin。

## 2. 产物与输入 pin

| 角色 | 路径 |
| --- | --- |
| 生成器 | `最小验证/数据/build-provisional-mechanism-template-registry.mjs` |
| JSON | `最小验证/provisional-mechanism-template-registry.json` |
| CSV | `最小验证/provisional-mechanism-template-registry.csv` |
| 输入 Unified | `最小验证/unified-mechanism-inventory.json` |
| 输入 Wiki-only | `最小验证/wiki-only-mechanism-candidate-registry.json` |

| 输入 | SHA256 | bytes | count |
| --- | --- | ---: | ---: |
| Unified | `05f6705e7966b71578918df57237ee84894056dcba60a53c0e4a4ed13ef0d3eb` | 1047006 | 254 |
| Wiki-only registry | `06b2a124daf77dd84cf2970361fdb4ee854dbebfe8e7cbe1825a02988414bb0a` | 640928 | 242 |

CLI：默认写入；只读 `--check`（语义 JSON 比对 **仅忽略** `metadata.generatedAt`，不写盘）。

## 3. 目标集与精确计数（hash-bound）

过滤 Unified 相对序，目标 status ∈ `{partial_actionable, ready_to_implement, blocked_runtime, blocked_data}` → **恰好 87**：

| 维度 | 计数 |
| --- | ---: |
| partial_actionable | 0 |
| ready_to_implement | 0 |
| blocked_runtime | 84 |
| blocked_data | 3 |
| hero_skill | 85 |
| item_passive | 2 |
| actionable_contract_placeholder | 0 |
| runtime_contract_placeholder | 84 |
| data_contract_placeholder | 3 |
| 排除 completed | 89 |
| 排除 out_of_scope | 72 |
| 排除 regression_only | 5 |
| 排除 stale_or_duplicate | 1 |

每行：`templateState=provisional_unverified`；`draftContract` 全 null/空数组；八个 verification gate 均为 `pending`；六条显式 nonclaims。

## 4. 字段权威与 provenance

| 字段来源 | 内容 |
| --- | --- |
| Unified | identity / status / completionMode / lane / blocker / tags / sourceRefs；`mechanismTags` **精确** Unified 数组与顺序 |
| Wiki-only（按 key） | `inventoryOrdinal`；hero/item provenance |
| 禁止作 completion truth | `sourceText`、legacy classification、`auditBaseline` |

Provenance：

- hero：`pageId` 非空；`wikiItemId=null`；`wikiEffectSlots=[]`；精确 `sourceRef`
- item：`pageId=null`；非空 `wikiItemId` + `wikiEffectSlots`；精确 `sourceRef`
- key / ordinal 唯一；目标集与过滤结果 fail-closed 相等

## 5. JSON / CSV 合同

- 顶层键序：`metadata` → `summary` → `templates`
- `metadata`：`schemaVersion` / `planRevision` / `generatedAt` / `inputs`
- `draftContract` 键：`rank` / `resourceCost` / `cooldownMs` / `target` / `timing` / `formula` / `operationGraph` / `fixtures` / `completedBoundary` / `exclusions`（标量 null；数组空）
- 八 gate id（序）：`wiki_identity_and_revision`、`wiki_numeric_contract`、`bounded_phase_a_plan`、`design_review_ready`、`backend_seed_and_junit`、`wasm_generic_test`、`g8_unified_audit`、`docs_and_governance`（均 `pending`）
- 六 nonclaims（序）：`no_numeric_or_behavioral_fidelity_claim`、`no_runtime_support_claim`、`no_backend_materialization_claim`、`no_g8_or_unified_status_change`、`no_live_publish_or_migration`、`no_new_completed_full_or_ready_assertion`
- CSV 列（序）：`key`、`inventoryOrdinal`、`sourceKind`、`ownerId`、`skillKey`、`passiveName`、`currentStatus`、`currentCompletionMode`、`lane`、`blocker`、`mechanismTagsJson`、`unifiedSourceRefsJson`、`wikiOwnerName`、`wikiPageId`、`wikiItemId`、`wikiEffectSlotsJson`、`wikiSourceRef`、`templateState`、`templateKind`、`draftContractJson`、`verificationGatesJson`、`nonclaimsJson`

## 6. 与 Unified / G8 边界

- 本注册表 **在** Unified ACTIVE / GENERATOR source allowlist / `currentInputHashes` **之外**
- `sourceCount` 保持 **12**；Unified 254 / G8 242 / Wiki-only 242 / Batch-G 兼容投影 **无**本 Phase 语义变更
- 最终真源快照（本基础设施落地后仍成立）：registry242 migrated48/partial5/blocked120/OOS69；G8 242 migrated79/partial4/blocked90/OOS69/inScope173；Unified254/source12 completed89/blocked_runtime84/blocked_data3/OOS72/regression5/stale1，full89/partial3/none162，`implementation_gap`67，`actionableKeyCount=0`

## 7. 审查与实现史（诚实记录）

| 阶段 | Run / Commit | 裁决 | 说明 |
| --- | --- | --- | --- |
| Valid v1 review | `run-8a3fdb13-f309-4f36-8462-bbc6d6cc8849` | **REVISE** | 2096 parseable；39/39 complete tool groups；零 truncation；runDelta0/diff0。全部发现已吸收进 v2：Unified tags 权威；registry ordinal 权威；显式 hero/item provenance；冻结 JSON/CSV/gates/nonclaims；hash-bound Phase-T1 pins |
| 首次 v2 | `run-d0066442-17c0-45ae-99d1-de95678eaa35` | READY 但 **无效门控** | 一个只读 `read` tool group 缺 completed event（1308 parseable；零 truncation；runDelta0/diff0）。**不得**称为 valid gate |
| Valid fresh v2 READY | `run-311a86b9-d5c6-4f1a-93ff-578ffa349c33` | **接受门控** | strict grok-4.5/high/fast=false；1510/1510；54/54；零 truncation；runDelta0/diff0；无 mutating / blocker / nonblocking / user decision |
| Cursor 实现 | `run-e4e135bc-18cf-49d8-a52d-19e29e335bfc` | 成功 | strict grok-4.5/high/fast=false；delta3/outside0；984 parseable；25/25；零 truncation；恰好写入三白名单文件；未 commit |
| 已提交基础设施 | `59ddcc0e7c174bf4f07e5af94ba1eea402ca0817` | 接受 | 仅生成器 + JSON + CSV |

## 8. 完成语义

本 feature-level scaffold **完成**仅表示：模板注册表生成器与 87 张 provisional draft cards 已生成并校验。**无一** 87 机制行变为 completed/full/ready；**无** runtime/Backend 实现含义。后续每张卡仍须 Wiki 核验、有界计划、有效设计审查、实现测试、审计与文档/治理，方可晋升。
