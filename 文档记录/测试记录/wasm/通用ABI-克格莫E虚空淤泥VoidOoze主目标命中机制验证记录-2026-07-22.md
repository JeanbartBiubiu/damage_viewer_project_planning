TASK_KEY: wasm-generic-kogmaw-void-ooze-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 克格莫 E 虚空淤泥 Void Ooze 主目标命中机制验证记录

详细设计：[通用 ABI - 克格莫 E 虚空淤泥（Void Ooze）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-克格莫E虚空淤泥VoidOoze主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_kogmaw|E|虚空淤泥`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Kog'Maw/E`，解析 `Template:Data Kog'Maw/Void Ooze`；page `1307961` / rev `3965135` / timestamp `2025-11-11T17:05:55Z`；canonical raw bytes `1356`；SHA256 `1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 物化为 `1357` bytes / SHA256 `6744b3918c195c8beeb0f8cacb0a51a6cece1e4c140e14caf325536ae4940f72`（末尾换行）；sidecar 拥有 canonical 元数据，raw 仅存在/非空——**不是**源矛盾。边界：`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration`。合同：Rank5 active 100 mana / 12000ms CD；immediate primary-target scaffold（Wiki `Effect at cast time start` 兼容；无假 delay phase）；恰好一笔非暴击/不可复制魔法 `230 + 0.65*source.attr.ap.resolved`。交叉：AP100 → raw295；MR100 → mitigated147.5；t0/t11999/t12000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害；mana325 → final125。**不**宣称弹道/几何/多目标/淤泥场/减速或完整游戏保真。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: kogmaw-e-void-ooze-primary-hit-phase-a-v1`；DESIGN_REVIEW READY `run-9c0645bd-292c-4b86-8785-484e6acbee65`，agent `agent-86a6e50c-0ce5-4a01-949d-fb25004b414d`，strict model，runDelta0/outside0，1774 parseable，无 truncation/mutation；审查结论：boundary 允许、immediate 措辞正确、raw caveat、Backend 9 attrs/AP0；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW | `run-9c0645bd-292c-4b86-8785-484e6acbee65` | READY；agent `agent-86a6e50c-0ce5-4a01-949d-fb25004b414d`；1774 parseable |
| Backend owning | `b1752e4`；`run-88458c7b-af22-41d3-9a2f-6744b7a17098` | seed + focused 35/35；full 677/677；runDelta3/outside0；754 parseable |
| Backend 集成 | `24c1ddf` | Backend 合入 Wasm 分支 |
| Wasm exact | `3507920`；`run-6490f99c-d313-4221-9273-e52c6454a12b` | `generic_kogmaw_void_ooze_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 4/4；runDelta1/outside0；556 parseable |
| 审计 commit | `c673e4d`；`run-ec5f66dd-dff1-4dd5-9f05-bbb7b2dbe796` | G8/Unified 六路径；runDelta6/outside0；1095 parseable |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Kog'Maw/E` → `Template:Data Kog'Maw/Void Ooze` / 1307961 / 3965135 / 2025-11-11T17:05:55Z / 1356 / `1dd448ea…70794b` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-e.json` |
| local raw caveat | 1357 / `6744b391…0f72`（newline）；sidecar canonical；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_kogmaw_void_ooze_primary_hit_test.go` | PASS（4/4） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（35/35） |
| owning full `mvn test` | PASS（677/677） |
| integrated | PASS（合入 `24c1ddf`） |
| seed 合同 | 自包含；baseline hp635/mana325/ad61/ap0/AS0.665/armor24/MR30/hpregen0.75/manaregen1.75；恰好九条属性（含 AP）；保留 basic/W/Q；独立 `provider_hero_kogmaw_e_void_ooze_primary_hit`；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

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
| G8 / Unified normal + `--check` | PASS；ordered keys 不变；241 非 Kog'Maw E G8 与 253 非 Kog'Maw E Unified 解析对象字节等价；仅 Kog'Maw E governed disposition/evidence 变化；registry / Batch-G checks PASS |
| G8 governed 最终字段 | `genericClassification=migrated`；exact `genericMechanismTags`；空 `remainingGap`；raw upstream `classification`/`mechanismTags`/`auditBaseline`（含 multi_target provenance）为历史 provenance |
| Unified 254 | sourceCount 12；completed 65 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 108 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 65 / partial 3 / none 186 |
| actionable | 0 |
| G8 242 | migrated 55 / partial 4 / blocked 114 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 90 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `c673e4d` |
| 审计 run | `run-ec5f66dd-dff1-4dd5-9f05-bbb7b2dbe796`；agent `agent-dc8eb8ab-cc38-482d-810b-47e1cf2234a3`；runDelta6 / outside0；1095 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=78） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=78；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-kogmaw-void-ooze-primary-hit` | PASS；映射两份新文档 |
| 针对 rg：Kog'Maw E 不在 §5/§6 当前 blocker；离开 `implementation_gap`；12=9+3；completed65 / blocked_runtime108 / migrated55 | PASS |
| `git diff --check` | PASS |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-target impact scaffold；单次非暴击/不可复制魔法 `230+0.65*AP`；CD/mana 探针（t0/t12000 命中，t11999 阻挡；mana325→125）。排除：projectile/travel/path/range/width/speed/geometry/collision、all-enemies/multi-target/repeat、field/path blobs/every125/3s、slow60%/0.25s ticks/linger、cast timing beyond scaffold、ranks1–4、basic/W/Q/on-hit/equipment/loadout、live/E2E/full fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现。
