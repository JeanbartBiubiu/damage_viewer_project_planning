TASK_KEY: wasm-generic-kaisa-void-seeker-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 卡莎 W 虚空索敌 Void Seeker 主目标命中机制验证记录

详细设计：[通用 ABI - 卡莎 W 虚空索敌（Void Seeker）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-卡莎W虚空索敌VoidSeeker主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_kaisa|W|虚空索敌`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Kai'Sa/W`，解析 `Template:Data Kai'Sa/Void Seeker`；page `1353553` / rev `4034696` / timestamp `2026-06-23T21:14:14Z`；canonical raw bytes `1843`；SHA256 `aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/kaisa-w.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 物化为 `1842` bytes / SHA256 `496936a80f17b2b0fe0dcb18a2f7e237e77b22ee687b3a59a2a24b775f9b5802`（末尾换行）；sidecar 拥有 canonical 元数据，raw 仅存在/非空——**不是**源矛盾。边界：`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund`。合同：Rank5 active 75 mana / 14000ms CD；immediate primary-target scaffold（Wiki 0.4s cast 与 `Effect at cast time end` **显式排除**而非近似）；恰好一笔非暴击/不可复制魔法 `130 + 1.30*source.attr.ad.resolved + 0.45*source.attr.ap.resolved`；**AD 为 total AD，永不 bonus AD**。交叉：totalAD100 / AP100 → raw305；MR100 → mitigated152.5；t0/t13999/t14000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害；mana345 → final195；目标 HP1000 → final695。governed tags 仅 `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold`（**无** `total_ad_ratio`；`bonus_ad_ratio` 为假）。**不**宣称施放延迟/弹道/几何/视野揭示/Plasma 进化/冷却返还或完整游戏保真。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: kaisa-w-void-seeker-primary-hit-phase-a-v2`；DESIGN_REVIEW v2 READY `run-3ae202d3-6cbd-42a2-8748-2ddd9dee34c9`，agent `agent-87fa12f8-a079-4590-b762-18189a2f2cd3`，strict model，runDelta0/outside0，721 parseable，无 truncation/task/mutation；v1 `run-3068c8fb-91ab-4c3d-b5f8-2a98096d16d6` 因 truncation **无效**且非共识门控；审查结论：boundary 允许、immediate 排除 0.4s cast、total AD 显式写在 boundary/reason/formula、无 `total_ad_ratio` tag；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW v2 | `run-3ae202d3-6cbd-42a2-8748-2ddd9dee34c9` | READY；agent `agent-87fa12f8-a079-4590-b762-18189a2f2cd3`；721 parseable |
| Backend owning | `9d9200a`；`run-f5555bba-5bfb-45f8-bd61-9053d1dcaf9b` | seed + focused 56/56；full 696/696；runDelta3/outside0；953 parseable |
| Backend 日期修正 | `run-1445d17f-9c01-4518-bd3e-2fe15a2efe71` | agent `agent-8ed95b08-be03-42ac-a40a-2b47da2dad2b`；delta2/runDeltaOutside0 |
| Backend 集成 | `1dc8d5b` | Backend 合入 Wasm 分支 |
| Wasm exact | `41e88a2`；`run-4c648ac1-bfe8-4eef-8d50-f7b61b3a5c04` | `generic_kaisa_void_seeker_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 4/4；runDelta1/outside0；703 parseable |
| Wasm gofmt | `run-29592ea2-1092-4375-abcc-76e3bf14edd0` | agent `agent-04b215ed-9ccd-490b-bd4e-01183e19ff00`；delta1/outside0 |
| 审计 commit | `26285fa`；`run-e68c0b2d-1ffe-40cc-9f2a-b7d574960519` | G8/Unified 六路径；runDelta6/outside0；1153 parseable |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Kai'Sa/W` → `Template:Data Kai'Sa/Void Seeker` / 1353553 / 4034696 / 2026-06-23T21:14:14Z / 1843 / `aa4ba76c…e3d1` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/kaisa-w.json` |
| local raw caveat | 1842 / `496936a8…5802`（newline）；sidecar canonical；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_kaisa_void_seeker_primary_hit_test.go` | PASS（4/4） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666` |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |
| runtime 伤害类型 | magic `20221`；无 physical `20220` |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（56/56） |
| owning full `mvn test` | PASS（696/696） |
| integrated | PASS（合入 `1dc8d5b`） |
| seed 合同 | 自包含；baseline hp640/mana345/ad59/ap0/AS0.644/armor25/MR30/hpregen0.8/manaregen1.64；恰好九条属性（含 AP）；保留 basic/Second Skin/Supercharge；独立 `provider_hero_kaisa_w_void_seeker_primary_hit`；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

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
| G8 / Unified normal + `--check` | PASS；ordered keys 不变；241 非 Kai'Sa W G8 与 253 非 Kai'Sa W Unified 解析对象字节等价；仅 Kai'Sa W governed disposition/evidence 变化；registry / Batch-G checks PASS |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（`ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）；空 `remainingGap`；raw upstream `classification`/`mechanismTags`/`auditBaseline`（含 `meta_or_non_target_dps`/`blocked_data` provenance）为历史 provenance |
| Unified 254 | sourceCount 12；completed 67 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 106 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 67 / partial 3 / none 184 |
| actionable | 0 |
| G8 242 | migrated 57 / partial 4 / blocked 112 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 88 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `26285fa` |
| 审计 run | `run-e68c0b2d-1ffe-40cc-9f2a-b7d574960519`；agent `agent-a9bde30d-9104-445c-ac59-b715f12099cd`；runDelta6 / outside0；1153 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=80） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=80；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-kaisa-void-seeker-primary-hit` | PASS；映射两份新文档 |
| 针对 rg：Kai'Sa W 不在 §5/§6 当前 blocker；离开 `implementation_gap`；12=9+3；completed67 / blocked_runtime106 / migrated57 | PASS |
| `git diff --check` | PASS |
| `node tools/agent-governance/cli.mjs check`（只读） | 仅既有 planning/backend/web `task_rules` peer drift；**不** sync |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-target impact scaffold（0.4s cast / `Effect at cast time end` **排除**）；单次非暴击/不可复制魔法 `130+1.30*totalAD+0.45*AP`；CD/mana/HP 探针（t0/t14000 命中，t13999 阻挡；mana345→195；HP1000→695）。排除：cast0.4/`Effect at cast time end`、projectile/travel/collision/first-enemy acquisition、location/range3000/width200/speed1750/geometry/spellshield、sight/reveal/true sight 4s、Plasma/Second Skin/Caustic Wounds 耦合、evolution/cooldown refund、ranks1–4、equipment/loadout、live/E2E/full fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现；total AD **不是** bonus AD，且 **无** `total_ad_ratio` governed tag。
