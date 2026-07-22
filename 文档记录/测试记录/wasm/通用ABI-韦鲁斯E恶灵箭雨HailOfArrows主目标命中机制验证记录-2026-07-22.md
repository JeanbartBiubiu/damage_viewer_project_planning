TASK_KEY: wasm-generic-varus-hail-of-arrows-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 韦鲁斯 E 恶灵箭雨 Hail of Arrows 主目标命中机制验证记录

详细设计：[通用 ABI - 韦鲁斯 E 恶灵箭雨（Hail of Arrows）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-韦鲁斯E恶灵箭雨HailOfArrows主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_varus|E|恶灵箭雨`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Varus/E`，解析 `Template:Data Varus/Hail of Arrows`；page `1309978` / rev `3969402` / timestamp `2025-11-24T16:03:58Z`；canonical raw bytes `1750`；SHA256 `7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/varus-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 物化为 `1748` bytes / SHA256 `42ebcd88aef5fc4f1889d4b40b062368902d6d35cfa76e624a1ba3f8789c468f`（换行差异）；sidecar 拥有 canonical 元数据，raw 仅存在/非空——**不是**源矛盾。**真实源字段矛盾（已审查）**：同 revision description + labeled rank 表明确物理 `60 to 180 (+90% bonus AD)`，孤立 `damagetype=Magic` 矛盾；reviewed policy 以 description + labeled rank table 管辖本物理分支，runtime 用 physical，`Magic` 披露且永不作 runtime 真源。边界：`rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation`。合同：Rank5 active 90 mana / 10000ms CD；immediate primary-target scaffold（Wiki 0.5s landing delay **显式排除**而非近似）；恰好一笔非暴击/不可复制物理 `180 + 0.90*(source.attr.ad.resolved-source.attr.ad.base)`。交叉：baseAD59 / resolvedAD159 → raw270；armor100 → mitigated135；t0/t9999/t10000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害；mana320 → final140。**不**宣称落地延迟/几何/多目标/箭雨场/减速/重伤/枯萎引爆或完整游戏保真。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: varus-e-hail-of-arrows-primary-hit-phase-a-v1`；DESIGN_REVIEW READY `run-49be1bd0-cd86-4a36-a72e-c2d5de455338`，agent `agent-462468cd-584a-4257-a6f1-d95deecca933`，strict model，runDelta0/outside0，1393 parseable，无 truncation/mutation；审查结论：bounded completed/full 接受、物理证据解析孤立 Magic、0.5s 明确排除、Backend 8 attrs/无 AP、独立 W 共存；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW | `run-49be1bd0-cd86-4a36-a72e-c2d5de455338` | READY；agent `agent-462468cd-584a-4257-a6f1-d95deecca933`；1393 parseable |
| Backend owning | `a08cdfd`；`run-faf113ed-5739-4653-ae52-f46e1c260592` | seed + focused 46/46；full 687/687；runDelta3/outside0；851 parseable |
| Backend 集成 | `e924afd` | Backend 合入 Wasm 分支 |
| Wasm exact | `6be94af`；`run-139b5b23-1be8-4de4-a845-9ef6fee4ef15` | `generic_varus_hail_of_arrows_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 4/4；runDelta1/outside0；657 parseable |
| 审计 commit | `37217fd`；`run-c3c9d485-7116-42e4-b8b6-2a88b0794496` | G8/Unified 六路径；runDelta6/outside0；1192 parseable |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Varus/E` → `Template:Data Varus/Hail of Arrows` / 1309978 / 3969402 / 2025-11-24T16:03:58Z / 1750 / `7b4be71b…58e9` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/varus-e.json` |
| local raw caveat | 1748 / `42ebcd88…468f`（newline）；sidecar canonical；非源矛盾 |
| 源字段矛盾策略 | description + labeled rank table → physical；孤立 `damagetype=Magic` 披露且非 runtime 真源；**真实源字段矛盾**（异于 raw-byte caveat） |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_varus_hail_of_arrows_primary_hit_test.go` | PASS（4/4） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |
| runtime 伤害类型 | physical `20220`；无 magic `20221` |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（46/46） |
| owning full `mvn test` | PASS（687/687） |
| integrated | PASS（合入 `e924afd`） |
| seed 合同 | 自包含；baseline hp600/mana320/ad59/AS0.658/armor24/MR30/hpregen0.7/manaregen1.6；恰好八条属性（无 AP）；保留 basic/W/Q；独立 `provider_hero_varus_e_hail_of_arrows_primary_hit`；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

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
| G8 / Unified normal + `--check` | PASS；ordered keys 不变；241 非 Varus E G8 与 253 非 Varus E Unified 解析对象字节等价；仅 Varus E governed disposition/evidence 变化；registry / Batch-G checks PASS |
| G8 governed 最终字段 | `genericClassification=migrated`；exact `genericMechanismTags`；空 `remainingGap`；raw upstream `classification`/`mechanismTags`/`auditBaseline`（含 false `survivability_only` provenance）为历史 provenance |
| Unified 254 | sourceCount 12；completed 66 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 107 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 66 / partial 3 / none 185 |
| actionable | 0 |
| G8 242 | migrated 56 / partial 4 / blocked 113 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 89 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `37217fd` |
| 审计 run | `run-c3c9d485-7116-42e4-b8b6-2a88b0794496`；agent `agent-f7d2997f-1db2-4552-bdde-f108439975b7`；runDelta6 / outside0；1192 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=79） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=79；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-varus-hail-of-arrows-primary-hit` | PASS；映射两份新文档 |
| 针对 rg：Varus E 不在 §5/§6 当前 blocker；离开 `implementation_gap`；12=9+3；completed66 / blocked_runtime107 / migrated56 | PASS |
| `git diff --check` | PASS |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-target impact scaffold（0.5s landing **排除**）；单次非暴击/不可复制物理 `180+0.90*(resolvedAD-baseAD)`；CD/mana 探针（t0/t10000 命中，t9999 阻挡；mana320→140）。排除：cast0.2419/landing0.5/travel timing、target-location/projectile/range925/radius300/collision/geometry、all-enemies/multi-target/repeat、four-second field、slow30–50%/0.25s linger、Grievous Wounds、Blighted Quiver stack consumption/~0.3s second detonation/W/Q/basic/on-hit coupling、ranks1–4、equipment/loadout、live/E2E/full fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现；孤立 `damagetype=Magic` **不是** runtime 真源。
