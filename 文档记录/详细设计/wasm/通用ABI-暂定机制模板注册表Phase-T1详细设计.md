TASK_KEY: wasm-generic-provisional-mechanism-template-registry
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 暂定机制模板注册表 Phase-T1 详细设计

关联验证记录：[通用 ABI 暂定机制模板注册表 Phase-T1 验证记录](../../测试记录/wasm/通用ABI-暂定机制模板注册表Phase-T1验证记录-2026-07-25.md)。本任务仅落地 **provisional template-registry 基础设施**（Phase-T1 scaffold → Phase-T2 连续刷新）：独立派生生成器 + 当前过滤目标集上的暂定草稿卡片。**不**宣称任何机制已实现、已 completed/full/ready，**不**暗示 runtime / Backend 实现，**不**改变 Unified / G8 / Wiki-only registry / Batch-G 真源或计数。文件名保留 Phase-T1；正文记录 Phase-T2。冻结方案：`FROZEN_PLAN_REV provisional-mechanism-template-registry-phase-t2-dynamic-refresh-v1`（有效 DESIGN_READY `run-9431ac75-f0dc-486e-9b9d-45fe092fea82`；strict `grok-4.5` / high / fast=false；1128/1128 parseable event lines / 29/29 complete tool groups；零 truncation；runDelta0/diff0；无 blocker / user decision）。已接受非阻断项：保留 Phase-T1 文件名而内容记录 T2；有意 key/order 变更须新 plan revision。实现 commit：`8965d18df042e7d54d91d9aaa6475d906afbe2c8`。

## 1. 目的与非目标

### 1.1 目的

- 为 Unified 过滤目标集（`partial_actionable` / `ready_to_implement` / `blocked_runtime` / `blocked_data`）生成共享形状的暂定草稿卡片，加速后续逐卡或有界批次的 Wiki 核验与 Phase-A 推进。
- Phase-T2：在 stable key/order 门控下做 **连续刷新**——summary / status / sourceKind / templateKind / excluded 计数 **每次运行派生**；动态输入 hash/bytes 仅作 provenance，**不是**相等性 pin。
- 以独立派生注册表承载卡片；**不得**进入 Unified ACTIVE / GENERATOR allowlist 或 `currentInputHashes`；`sourceCount` **仍为 12**。
- 冻结 schema `provisional-mechanism-template-registry-v2` 与 plan `provisional-mechanism-template-registry-phase-t2-dynamic-refresh-v1`。

### 1.2 非目标

- **不**把任何 provisional 行标为 completed / full / ready / migrated。
- **不**实现 runtime、Backend seed、Web、live migration / publish。
- **不**改写 Unified / G8 / Wiki-only registry / Batch-G 产物或生成器真源（本基础设施本身不写这些真源）。
- **不**把 `sourceText` / legacy classification / `auditBaseline` 当作 completion truth。
- 未知 status / key / order 漂移仍 **fail-closed**；有意 254/242 key-order 变更须新 plan revision。稳定 key/order 下的后续 Unified 有意闭环可再生模板计数（例如 87→86）而 **无需** 改生成器代码或 plan revision。

## 2. 产物与稳定门控

| 角色 | 路径 |
| --- | --- |
| 生成器 | `最小验证/数据/build-provisional-mechanism-template-registry.mjs` |
| JSON | `最小验证/provisional-mechanism-template-registry.json` |
| CSV | `最小验证/provisional-mechanism-template-registry.csv` |
| 输入 Unified | `最小验证/unified-mechanism-inventory.json` |
| 输入 Wiki-only | `最小验证/wiki-only-mechanism-candidate-registry.json` |

稳定 digest 算法（精确）：`sha256(UTF8(keys.join("\n") + "\n"))`。

| 稳定门控 | count | key-order digest |
| --- | ---: | --- |
| Unified mechanisms | 254 | `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018` |
| Wiki candidates | 242 | `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7` |

动态输入 `sha256` / `byteSize` 写入 `metadata.inputs` 仅作 provenance，**不**作相等性 pin。未知 status / key / order 漂移仍 fail-closed。

CLI：默认写入；只读 `--check`（语义 JSON 比对 **仅忽略** `metadata.generatedAt`，不写盘）。

## 3. 目标集与八状态穷尽划分

八状态穷尽划分；目标过滤：`partial_actionable` / `ready_to_implement` / `blocked_runtime` / `blocked_data`；排除：`completed` / `out_of_scope` / `regression_only` / `stale_or_duplicate`；目标与排除 **不相交** 且合计 **254**。

`summary` / status / sourceKind / templateKind / excluded 计数 **每次运行派生**。当前快照（与真实 Unified 一致；**非**机制完成宣称）：

| 维度 | 计数 |
| --- | ---: |
| templates | 87 |
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

每行：`templateState=provisional_unverified`；`draftContract` 全 null/空数组；八个 verification gate 均为 `pending`；六条显式 nonclaims。模板行 / CSV schema、Unified-only tags 权威、Wiki provenance、null draft / 八 gates / 六 nonclaims 保持 Phase-T1 兼容；因此当前 CSV 与 Phase-T1 产物 **字节相同**。

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
- `metadata`：`schemaVersion` / `planRevision` / `generatedAt` / `stableKeyOrders` / `inputs`（相对 Phase-T1 新增 `stableKeyOrders`）
- `draftContract` 键：`rank` / `resourceCost` / `cooldownMs` / `target` / `timing` / `formula` / `operationGraph` / `fixtures` / `completedBoundary` / `exclusions`（标量 null；数组空）
- 八 gate id（序）：`wiki_identity_and_revision`、`wiki_numeric_contract`、`bounded_phase_a_plan`、`design_review_ready`、`backend_seed_and_junit`、`wasm_generic_test`、`g8_unified_audit`、`docs_and_governance`（均 `pending`）
- 六 nonclaims（序）：`no_numeric_or_behavioral_fidelity_claim`、`no_runtime_support_claim`、`no_backend_materialization_claim`、`no_g8_or_unified_status_change`、`no_live_publish_or_migration`、`no_new_completed_full_or_ready_assertion`
- CSV 列（序）：`key`、`inventoryOrdinal`、`sourceKind`、`ownerId`、`skillKey`、`passiveName`、`currentStatus`、`currentCompletionMode`、`lane`、`blocker`、`mechanismTagsJson`、`unifiedSourceRefsJson`、`wikiOwnerName`、`wikiPageId`、`wikiItemId`、`wikiEffectSlotsJson`、`wikiSourceRef`、`templateState`、`templateKind`、`draftContractJson`、`verificationGatesJson`、`nonclaimsJson`

后续有意 Unified 闭环可在 stable key/order 不变时再生模板（例如 87→86），**无需** 生成器代码或 plan revision；有意 key/order 变更仍须新 plan revision。

## 6. 与 Unified / G8 边界

- 本注册表 **在** Unified ACTIVE / GENERATOR source allowlist / `currentInputHashes` **之外**
- `sourceCount` 保持 **12**；Unified 254 / G8 242 / Wiki-only 242 / Batch-G 兼容投影 **无**本 Phase 语义变更
- 最终真源快照（本基础设施落地后仍成立）：registry242 migrated48/partial5/blocked120/OOS69；G8 242 migrated79/partial4/blocked90/OOS69；Unified254/source12 completed89/blocked_runtime84/blocked_data3/OOS72/regression5/stale1；template87；tasks103

## 7. 审查与实现史（诚实记录）

| 阶段 | Run / Commit | 裁决 | 说明 |
| --- | --- | --- | --- |
| Valid v1 review | `run-8a3fdb13-f309-4f36-8462-bbc6d6cc8849` | **REVISE** | 2096 parseable；39/39 complete tool groups；零 truncation；runDelta0/diff0。全部发现已吸收进 v2：Unified tags 权威；registry ordinal 权威；显式 hero/item provenance；冻结 JSON/CSV/gates/nonclaims；hash-bound Phase-T1 pins |
| 首次 v2 | `run-d0066442-17c0-45ae-99d1-de95678eaa35` | READY 但 **无效门控** | 一个只读 `read` tool group 缺 completed event（1308 parseable；零 truncation；runDelta0/diff0）。**不得**称为 valid gate |
| Valid fresh v2 READY（Phase-T1） | `run-311a86b9-d5c6-4f1a-93ff-578ffa349c33` | **接受门控** | strict grok-4.5/high/fast=false；1510/1510；54/54；零 truncation；runDelta0/diff0；无 mutating / blocker / nonblocking / user decision |
| Cursor Phase-T1 实现 | `run-e4e135bc-18cf-49d8-a52d-19e29e335bfc` | 成功 | strict grok-4.5/high/fast=false；delta3/outside0；984 parseable；25/25；零 truncation；恰好写入三白名单文件；未 commit |
| Phase-T1 已提交基础设施 | `59ddcc0e7c174bf4f07e5af94ba1eea402ca0817` | 接受 | 仅生成器 + JSON + CSV |
| Valid Phase-T2 DESIGN_READY | `run-9431ac75-f0dc-486e-9b9d-45fe092fea82` | **接受门控** | strict grok-4.5/high/fast=false；1128/1128；29/29；零 truncation；runDelta0/diff0；无 blocker / user decision。接受非阻断：保留 Phase-T1 文件名；key-order 变更须新 plan revision |
| Cursor Phase-T2 实现 | `run-2f635aa4-5cca-41a0-8fea-0896c1f07876` | 成功 | strict model；1311 parseable；31/31 complete tool groups；零 truncation；outside0。允许三路径；runDelta/content 变化恰好为生成器 + JSON；再生 CSV 字节相同 |
| Phase-T2 已提交基础设施 | `8965d18df042e7d54d91d9aaa6475d906afbe2c8` | 接受 | 仅生成器 + JSON（CSV 未变） |

## 8. 完成语义

本 feature-level scaffold **完成**仅表示：模板注册表生成器已具备 Phase-T2 连续刷新能力，且当前过滤目标集上的 provisional draft cards 已生成并校验。**无一** 机制行变为 completed/full/ready；**无** runtime/Backend 实现含义。后续每张卡仍须 Wiki 核验、有界计划、有效设计审查、实现测试、审计与文档/治理，方可晋升。后续机制审计可在其有界工作流中刷新 provisional 产物；**不得**硬编码下一单个机制。
