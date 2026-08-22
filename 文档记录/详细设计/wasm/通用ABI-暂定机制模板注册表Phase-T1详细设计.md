TASK_KEY: wasm-generic-provisional-mechanism-template-registry
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 暂定机制模板注册表 Phase-T1 详细设计

关联验证记录：[通用 ABI 暂定机制模板注册表 Phase-T1 验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务仅落地 **provisional template-registry 基础设施**（Phase-T1 scaffold → Phase-T2 连续刷新 → **Phase-T3/v4 批量机械草稿填充**）：独立派生生成器 + 当前过滤目标集上的暂定草稿卡片。**不**宣称任何机制已实现、已 completed/full/ready/migrated，**不**暗示 runtime / Backend 实现，**不**改变 Unified / G8 / Wiki-only registry / Batch-G 真源或计数。文件名保留 Phase-T1；正文当前描述 **Phase-T3/v4** 与 schema **v3**。冻结方案：`FROZEN_PLAN_REV provisional-mechanism-template-registry-phase-t3-bulk-draft-fill-v4`（冻结 schema `provisional-mechanism-template-registry-v3`）。已接受实现 commit：`77c89e8b5a2f83e24655fbcc26cd69889254a075`（`feat(audit): prefill provisional mechanism drafts`）。

历史承接：Phase-T1 scaffold（commit `59ddcc0e…`）与 Phase-T2 连续刷新（plan `…phase-t2-dynamic-refresh-v1` / schema v2 / commit `8965d18d…` / DESIGN_READY `run-9431ac75-f0dc-486e-9b9d-45fe092fea82`）仍有效；本切片在其之上做 **批量机械 draft fill**，不重新设计基础设施本身。

## 1. 目的与非目标

### 1.1 目的

- 为 Unified 过滤目标集（`partial_actionable` / `ready_to_implement` / `blocked_runtime` / `blocked_data`）生成共享形状的暂定草稿卡片，**加速后续逐卡验证与有界 Phase-A**，但 **不构成**机制完成。
- Phase-T2 能力保留：在 stable key/order 门控下 **连续刷新**——summary / status / sourceKind / templateKind / excluded 计数 **每次运行派生**；动态输入 hash/bytes 仅作 provenance，**不是**相等性 pin。
- Phase-T3/v4：对当前全部目标卡 **机械填充** source-linked draft（source pointers、粗粒度 Phase-A 候选合同、未解析 Wiki formula 快照、通用 operation-graph 骨架、两枚 null-input/null-expected fixture 占位、exclusions / review prompts）。草稿 **不是** 数值或行为保真宣称。
- 以独立派生注册表承载卡片；**不得**进入 Unified ACTIVE / GENERATOR allowlist 或 `currentInputHashes`；`sourceCount` **仍为 12**。
- 冻结 schema `provisional-mechanism-template-registry-v3` 与 plan `provisional-mechanism-template-registry-phase-t3-bulk-draft-fill-v4`。

### 1.2 非目标

- **不**把任何 provisional 行标为 completed / full / ready / migrated；`completedBoundary` **保持 null**。
- **不**实现 runtime、Backend seed、Web、G8、Unified、Wiki registry、Batch-G、live migration / publish / push。
- **不**改写 Unified / G8 / Wiki-only registry / Batch-G 产物或生成器真源（本基础设施本身不写这些真源）。
- **不**把机械草稿当作已核验 Phase-A 或 completion truth（显式 nonclaim `no_mechanical_draft_as_verified_phase_a_claim`）。
- **不**把 `sourceText` / legacy classification / `auditBaseline` 当作 completion truth。
- 未知 status / key / order 漂移仍 **fail-closed**；有意 254/242 key-order 变更须新 plan revision。

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

`metadata.inputs` **恰好**上述两份（Unified + Wiki registry）；动态 `sha256` / `byteSize` 仅 provenance，**不**作相等性 pin。Provisional 输出仍在 Unified ACTIVE/GENERATOR allowlists 与 `currentInputHashes` **之外**。

CLI：默认写入；只读 `--check`（语义 JSON 比对 **仅忽略** `metadata.generatedAt`，不写盘）。

当前已提交产物（实现 commit `77c89e8b…`）：

| 产物 | SHA256 | bytes |
| --- | --- | ---: |
| 生成器 | `986adf20f300f536de68871c2332a297c35088634f9df92d7483a67ce0e8c96a` | 65139 |
| JSON | `0eb359812b731ca2a4d8ec196dba9bacfb607cf64c68498aded2c47b5f11898e` | 604038 |
| CSV | `9d908f92b8de469c1b8ca4067270afe3b7e65aaf89c6955a87c9f32f9b525526` | 404572 |

## 3. 目标集与当前计数

八状态穷尽划分；目标过滤：`partial_actionable` / `ready_to_implement` / `blocked_runtime` / `blocked_data`；排除：`completed` / `out_of_scope` / `regression_only` / `stale_or_duplicate`；目标与排除 **不相交** 且合计 **254**。

当前 Unified / 模板快照（与真实 Unified 一致；**非**机制完成宣称）：

| 维度 | 计数 |
| --- | ---: |
| Unified completed | 102 |
| partial_actionable | 0 |
| ready_to_implement | 0 |
| blocked_runtime | 71 |
| blocked_data | 3 |
| out_of_scope | 72 |
| regression_only | 5 |
| stale_or_duplicate | 1 |
| sourceCount | 12 |
| actionableKeyCount | 0 |
| templates（目标集） | **74** |
| hero_skill / item_passive | 72 / 2 |
| runtime_contract_placeholder / data_contract_placeholder | 71 / 3 |

报告口径：

- 严格 verified completion：**102/254 = 40.2%**
- completed + provisional implementation-description coverage：**176/254 = 69.3%**（`(102+74)/254`）

每张目标卡仍为 `templateState=provisional_unverified`；均有机械填充、source-linked draft；**无一**晋升 completed/full/ready/migrated；`completedBoundary=null`；八个 verification gate 均为 `pending`；恰好 **七** 条显式 nonclaims（含 `no_mechanical_draft_as_verified_phase_a_claim`）。

## 4. 源解析语义

| 字段来源 | 内容 |
| --- | --- |
| Unified | identity / status / completionMode / lane / blocker / tags / sourceRefs；`mechanismTags` **精确** Unified 数组与顺序 |
| Wiki-only（按 key） | `inventoryOrdinal`；hero/item provenance |
| 禁止作 completion truth | `sourceText`、legacy classification、`auditBaseline` |

Hero 字段抽取：必须遵守 sidecar `fieldPresence[name] === true`；`false` 或缺失字段 **忽略**，不得当作存在。

Item 解析：读取 current-items **manifest** 与 **normalized** 输入；唯一性门控 **仅**针对目标 item ID；无关重复 item ID **不**阻塞目标卡。

Provenance 形状：

- hero：`pageId` 非空；`wikiItemId=null`；`wikiEffectSlots=[]`；精确 `sourceRef`；draft `sourcePointers.kind=hero_wiki_sidecar`
- item：`pageId=null`；非空 `wikiItemId` + `wikiEffectSlots`；精确 `sourceRef`；draft `sourcePointers.kind=item_wiki_current_items`；`localEqualsCanonicalClaim=false`（本地/canonical hash 分离）
- key / ordinal 唯一；目标集与过滤结果 fail-closed 相等

## 5. 嵌套 draft 合同 / 语义（schema v3）

顶层键序：`metadata` → `summary` → `templates`。

`metadata`：`schemaVersion` / `planRevision` / `generatedAt` / `stableKeyOrders` / `inputs`（恰好 Unified + Wiki registry 两输入）。

每行模板键序含：`draftContract` / `verificationGates` / `nonclaims`。

`draftContract`（机械草稿；**非**保真宣称）键序与语义：

| 键 | 语义 |
| --- | --- |
| `draftState` | `mechanical_unverified` |
| `sourcePointers` | 源路径、本地/canonical hash-size、field/effect refs |
| `phaseATemplate` | 粗粒度候选 id / basisStatus / basisTags；`requiresIndividualDesignReview=true` |
| `rank` / `resourceCost` / `cooldownMs` / `target` / `timing` | 候选占位；多数 `verification=pending`；归一化值常为 null |
| `formula` | 未解析 Wiki markup 快照；`expression=null`；`claim=unparsed_markup_not_numeric_truth` |
| `operationGraph` | 通用骨架节点/边；`concreteIds` / `concreteTypeIds` 为 null |
| `fixtures` | 恰好两枚：`baseline_quantum` 与 `boundary_or_counterproof`；`inputs`/`expected` 均为 null |
| `completedBoundary` | **恒 null** |
| `exclusions` | 候选排除 + review prompts（供后续人工/逐卡核验） |

八 gate id（序，均 `pending`）：`wiki_identity_and_revision`、`wiki_numeric_contract`、`bounded_phase_a_plan`、`design_review_ready`、`backend_seed_and_junit`、`wasm_generic_test`、`g8_unified_audit`、`docs_and_governance`。

七 nonclaims（序）：`no_numeric_or_behavioral_fidelity_claim`、`no_runtime_support_claim`、`no_backend_materialization_claim`、`no_g8_or_unified_status_change`、`no_live_publish_or_migration`、`no_new_completed_full_or_ready_assertion`、`no_mechanical_draft_as_verified_phase_a_claim`。

CSV 列序相对 Phase-T1/T2 行身份列保持兼容；`draftContractJson` / `verificationGatesJson` / `nonclaimsJson` 承载上述嵌套内容。

## 6. Fail-closed 门控与验证

- 未知 Unified status、目标集不等、key/order digest 漂移 → fail-closed。
- Hero：缺 `fieldPresence` 对象、或把 `fieldPresence[name]!==true` 的字段当存在 → fail-closed。
- Item：缺 manifest/normalized、目标 item 不唯一/找不到 → fail-closed；**仅**目标 ID 强制唯一。
- Draft 形状：键序、gate 数/序、七 nonclaims、`completedBoundary===null`、fixtures 长度与 id/purpose、`phaseATemplate.requiresIndividualDesignReview===true` 等均严格校验。
- `--check` 只读；默认写 + check 语义比对仅忽略 `generatedAt`。

主路径验证（实现后已通过，且 check 模式 pre/post hash 证明只读）：provisional generator `--check`；Wiki registry `--check`；Batch-G `--check`；G8 `--check`；Unified `--check`；自定义 74-card invariants；`git diff --check`。

## 7. 与 Unified / G8 边界

- 本注册表 **在** Unified ACTIVE / GENERATOR source allowlist / `currentInputHashes` **之外**
- `sourceCount` 保持 **12**；本 Phase **无** production runtime / Backend / Web / G8 / Unified / Wiki registry / Batch-G / live migration / publish / push 变更
- 当前真源快照：Unified254/source12 completed102 / partial0 / ready0 / blocked_runtime71 / blocked_data3 / OOS72 / regression5 / stale1；`actionableKeyCount=0`；template74；tasks116

## 8. 审查与实现史（诚实记录）

### 8.1 Phase-T1 / T2（保留）

| 阶段 | Run / Commit | 裁决 | 说明 |
| --- | --- | --- | --- |
| Valid v1 review | `run-8a3fdb13-f309-4f36-8462-bbc6d6cc8849` | **REVISE** | 吸收进 Phase-T1 v2：Unified tags / registry ordinal / hero·item provenance / 冻结 schemas / hash-bound pins |
| 首次 v2 | `run-d0066442-17c0-45ae-99d1-de95678eaa35` | READY 但 **无效门控** | 缺 completed event；**不得**称为 valid gate |
| Valid fresh v2 READY（Phase-T1） | `run-311a86b9-d5c6-4f1a-93ff-578ffa349c33` | **接受门控** | 1510/1510；54/54；runDelta0 |
| Cursor Phase-T1 实现 | `run-e4e135bc-18cf-49d8-a52d-19e29e335bfc` | 成功 | 恰好三白名单文件；未 commit |
| Phase-T1 已提交 | `59ddcc0e7c174bf4f07e5af94ba1eea402ca0817` | 接受 | 生成器 + JSON + CSV |
| Valid Phase-T2 DESIGN_READY | `run-9431ac75-f0dc-486e-9b9d-45fe092fea82` | **接受门控** | 1128/1128；29/29；runDelta0 |
| Cursor Phase-T2 实现 | `run-2f635aa4-5cca-41a0-8fea-0896c1f07876` | 成功 | 生成器 + JSON；CSV 字节相同 |
| Phase-T2 已提交 | `8965d18df042e7d54d91d9aaa6475d906afbe2c8` | 接受 | schema v2 / 连续刷新 |

### 8.2 Phase-T3 / v4 bulk mechanical draft fill（当前）

| 阶段 | Run / Commit | 裁决 | 说明 |
| --- | --- | --- | --- |
| v1 design review | `run-5f37c2fa-3a0b-4b4a-973c-0336b1dc4afd` | **REVISE** | runDelta0。接受：item lookup 形状；拆分 local/canonical item hashes；`metadata.inputs` 保持两输入；七 nonclaims；恰好四文档治理范围 / 复用既有 task |
| v2 design review | `run-14459b5f-fa7b-49fa-9fae-b60ca4b31469` | **REVISE** | runDelta0。接受：hero `fields.*` + `fieldPresence`；读 item manifest + normalized；完整冻结嵌套 schema |
| v3 design review | `run-8e65d20b-3d90-498a-82de-eb33b76f7494` | **READY** | runDelta0；2585/2585 parseable；50/50 complete tool groups；无 mutation |
| 首次实现尝试 | （agent 创建前瞬时网络失败） | 失败 | 零 events / 零 run delta；无 worktree mutation |
| Retry 实现 | `run-043b48e0-1e32-4697-87f8-eaec6a304a13` | 成功 | 恰好三实现文件；runDelta3/outside0；1221 parseable；51/51 complete tool groups；checks passed |
| Post-impl v4 amendment review | `run-691568c9-bf77-4b88-a436-f9ddcbc94f58` | **READY** | runDelta0；1110 parseable；27/27 complete tool groups。冻结：目标作用域 item 唯一性；权威 hero `fieldPresence` 语义 |
| Repair 实现 | `run-5163661c-b63e-4c01-b99a-f98deede7b87` | 成功 | 同一实现 allowlist；runDelta2/outside0；967 parseable；19/19 complete tool groups；生成器+JSON 变更；CSV 内容无需 plan-only rewrite |
| 已接受实现 commit | `77c89e8b5a2f83e24655fbcc26cd69889254a075` | 接受 | `feat(audit): prefill provisional mechanism drafts` |

## 9. 完成语义

本 feature-level 任务 **完成**仅表示：模板注册表已具备 Phase-T2 连续刷新 + Phase-T3/v4 对全部 **74** 张目标卡的机械草稿填充，且校验通过。**批量填充加速后续逐卡验证，但不构成机制完成。** **无一** 机制行变为 completed/full/ready/migrated；**无** runtime/Backend 实现含义；八 gate 仍 pending；七 nonclaims 仍成立。后续每张卡仍须 Wiki 核验、有界计划、有效设计审查、实现测试、审计与文档/治理，方可晋升。后续机制审计可在其有界工作流中刷新 provisional 产物；**不得**硬编码下一单个机制；`actionableKeyCount=0` **不是**停工条件。
