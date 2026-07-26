TASK_KEY: wasm-generic-vayne-condemn-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 薇恩 E 恶魔审判 Condemn 主目标命中机制验证记录

详细设计：[通用 ABI - 薇恩 E 恶魔审判（Condemn）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-薇恩E恶魔审判Condemn主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_vayne|E|恶魔审判`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Vayne/E`，解析 `Template:Data Vayne/Condemn`；page `1309990` / rev `4008541` / timestamp `2026-04-14T23:45:40Z`；raw bytes `2380`；SHA256 `f2b2ba17b90ff5096a9a154f8d1fd4cc43ed3e1be4ebb502cb644acf17712c37`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/vayne-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。边界：`rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile`。合同：Rank5 active 90 mana / 12000ms CD；immediate primary-target scaffold；恰好一笔非暴击/不可复制物理 `190 + 0.50*(source.attr.ad.resolved-source.attr.ad.base)`。交叉：baseAD60 / resolvedAD140 → bonusAD80 → raw230；armor100 → mitigated115；t0/t12000 命中，t11999 恰好一次 cooldown skip 且无 mana/伤害；mana232 → final52。**不**宣称击退/地形/墙体加成/眩晕/弹道或完整游戏保真。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: vayne-e-condemn-primary-hit-phase-a-v1`；DESIGN_REVIEW READY `run-f03ab9ee-acd4-4a9b-b9ea-85a743822e0e`，agent `agent-672db211-9a8d-4079-8e1c-4db1480d5382`，strict `grok-4.5/high/fast=false`，runDelta0/outside0，1957 parseable，无 truncation/mutation；审查修正已接受：`single_hit`、`wall_bonus`、Backend AP preflight 不必要、清掉 governed generic 陈旧状态；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW | `run-f03ab9ee-acd4-4a9b-b9ea-85a743822e0e` | READY；agent `agent-672db211-9a8d-4079-8e1c-4db1480d5382`；1957 parseable |
| Backend owning | `e7d28f6`；`run-26f83a4e-e820-41ea-a359-ab3d785a2908` | seed + focused 36/36；full 668/668；runDelta3/outside0；850 parseable |
| Backend 集成 | `61290cb` | Backend 合入 Wasm 分支 |
| Wasm exact | `252f799`；`run-0900ab3c-c49b-45e1-acef-5b31756cae4b` | `generic_vayne_condemn_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 4/4；runDelta1/outside0；903 parseable |
| 审计 commit | `881cb1c`；`run-ccd0f5f0-8428-4da8-b1ac-1bed98da5153` | G8/Unified 六路径；runDelta6/outside0；840 parseable |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / bytes / SHA | PASS；`Template:Data Vayne/E` → `Template:Data Vayne/Condemn` / 1309990 / 4008541 / 2026-04-14T23:45:40Z / 2380 / `f2b2ba17…2c37` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/vayne-e.json` |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_vayne_condemn_primary_hit_test.go` | PASS（4/4） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（36/36） |
| owning full `mvn test` | PASS（668/668） |
| integrated | PASS（合入 `61290cb`） |
| seed 合同 | 自包含；`hero_vayne` baseline 与 mana232；保留 basic/Silver Bolts/Tumble；独立 `provider_hero_vayne_e_condemn_primary_hit`；恰好八条必需属性定义；AP 不要求；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

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
| G8 / Unified normal + `--check` | PASS；ordered keys 不变；241 非 Vayne G8 与 253 非 Vayne Unified 解析对象字节等价；仅 Vayne E governed disposition/evidence 变化；registry / Batch-G checks PASS |
| G8 governed 最终字段 | `genericClassification=migrated`；exact `genericMechanismTags`；空 `remainingGap`；raw upstream `classification`/`mechanismTags`/`auditBaseline` 为历史 provenance |
| Unified 254 | sourceCount 12；completed 64 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 109 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 64 / partial 3 / none 187 |
| actionable | 0 |
| G8 242 | migrated 54 / partial 4 / blocked 115 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 91 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `881cb1c` |
| 审计 run | `run-ccd0f5f0-8428-4da8-b1ac-1bed98da5153`；agent `agent-dbc56bfe-a1ca-4a0d-bba6-5fd5819b21a8`；runDelta6 / outside0；840 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=77） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=77；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-vayne-condemn-primary-hit` | PASS；映射两份新文档 |
| 针对 rg：Vayne E 不在 §5/§6 当前 blocker；离开 `implementation_gap`；12=9+3；completed64 / blocked_runtime109 / migrated54 | PASS |
| `git diff --check` | PASS |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-target impact scaffold；单次非暴击/不可复制物理 `190+0.50*(resolvedAD-baseAD)`；CD/mana 探针（t0/t12000 命中，t11999 阻挡；mana232→52）。排除：knockback/displacement475/direction、terrain/player-generated terrain collision、wall bonus `285+0.75bAD` 与 total `475+1.25bAD`、stun/control1.5s、cast0.25/effect-at-cast-end、projectile/missile speeds2200/2000/range550/geometry/cancel、ranks1–4、Silver Bolts/basic/on-hit/equipment/loadout coupling、multi-target/repeat、live/E2E/full fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现。
