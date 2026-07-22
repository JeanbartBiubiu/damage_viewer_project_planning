TASK_KEY: wasm-generic-twisted-fate-wild-cards-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 卡牌大师 Q 万能牌 Wild Cards 主目标命中机制验证记录

详细设计：[通用 ABI - 卡牌大师 Q 万能牌（Wild Cards）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-卡牌大师Q万能牌WildCards主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_twistedfate|Q|万能牌`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Twisted Fate/Q`，解析 `Template:Data Twisted Fate/Wild Cards`；page `1309741` / rev `3950864` / timestamp `2025-08-31T01:31:17Z`；canonical raw bytes `1237`；SHA256 `9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/twistedfate-q.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 物化为 `1235` bytes / SHA256 `dd26f599619f0597426137b819bdfa36699e48449234a4adeae35dbad7e4dbc4`（换行/物化差异）；sidecar 拥有 canonical 身份，raw 仅存在/非空——**不是**源矛盾。边界：`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget`。合同：Rank5 active 100 mana / 5000ms CD；immediate primary-target scaffold（Wiki cast0.25 与 `Effect at cast time end` **显式排除**而非近似）；恰好一笔非暴击/不可复制魔法 `240 + 0.50*(source.attr.ad.resolved-source.attr.ad.base) + 0.85*source.attr.ap.resolved`。交叉：baseAD52 / resolvedAD100 / AP100 → raw349；MR100 → mitigated174.5；t0/t4999/t5000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害；mana333 → final133；目标 HP1000 → final651。Wiki once-per-pass **仅**正当化单次直击主目标，**不是** runtime pass/projectile/collision 保真。governed tags 集合恰好为 `ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（G8 保留 override 序；Unified `localeCompare` 序列化可使 `ap_ratio` 先于 `bonus_ad_ratio`；集合相同）。**不**宣称施放延迟/扇形三牌锥形/弹道/几何/碰撞/pass/多目标或完整 Wild Cards/游戏保真。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: twisted-fate-q-wild-cards-primary-hit-phase-a-v2`；DESIGN_REVIEW v2 READY `run-16802cbb-4260-4c94-ae5d-558bc87f9f25`，agent `agent-2cb881b9-d728-408b-af3b-a2cafb514f0a`，strict model，runDelta0，582 parseable，无 truncation/mutation，无 issues；v1 `run-bbf86b5a-17cd-46bb-ab3c-aec082987b65` / agent `agent-1c8201b0-6a9a-4669-aa5e-f2b4b50581f2` READY，715 parseable，三条非阻塞笔记已吸收进 v2；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-22**（驱动环境 Asia/Shanghai），即使构建工具打印更晚墙钟时间亦以本日期为准。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW v2 | `run-16802cbb-4260-4c94-ae5d-558bc87f9f25` | READY；agent `agent-2cb881b9-d728-408b-af3b-a2cafb514f0a`；582 parseable；无 issues |
| DESIGN_REVIEW v1 | `run-bbf86b5a-17cd-46bb-ab3c-aec082987b65` | READY；agent `agent-1c8201b0-6a9a-4669-aa5e-f2b4b50581f2`；715 parseable；非阻塞笔记吸收进 v2 |
| Backend owning | `18b959e`；`run-66075a3a-2320-4863-a74f-fb9fafdf8070` | seed + focused 20/20；full 705/705；runDelta3/outside0；784 parseable |
| Backend 集成 | `a0da4f8` | Backend 合入 Wasm 分支 |
| Wasm exact | `589db93`；`run-36abdca4-a9ae-4e59-a160-ee207c80d307` | `generic_twisted_fate_wild_cards_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 4/4；runDelta1/outside0；800 parseable |
| 审计 commit | `906951f`；`run-b053aa53-4c8d-49eb-96df-2ba72e274910` | G8/Unified/registry/Batch-G；runDelta6/outside0；1233 parseable；ordered keys 不变，仅 TF Q 解析对象变化 |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Twisted Fate/Q` → `Template:Data Twisted Fate/Wild Cards` / 1309741 / 3950864 / 2025-08-31T01:31:17Z / 1237 / `9cdd62cc…d597` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/twistedfate-q.json` |
| local raw caveat | 1235 / `dd26f599…e4dbc4`（newline/materialization）；sidecar canonical；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_twisted_fate_wild_cards_primary_hit_test.go` | PASS（4/4） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`（相对既有 build **未变**） |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |
| runtime 伤害类型 | magic `20221`；无 physical `20220` |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（20/20） |
| owning full `mvn test` | PASS（705/705） |
| integrated | PASS（合入 `a0da4f8`） |
| seed 合同 | 自包含；baseline hp604/mana333/ad52/ap0/AS0.625/armor24/MR30/hpregen1.1/manaregen1.6；恰好九条属性（含 AP）；保留 basic/Stacked Deck；独立 `provider_hero_twistedfate_q_wild_cards_primary_hit`；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| owning lint / typecheck / Vitest / build | PASS；Vitest 330 |
| integrated lint / typecheck / Vitest / build | PASS；Vitest 136 |
| 本机制 Web 源码变更 | 无（零写入） |
| Web Wasm 资产现状（独立限制，非机制 blocker） | 当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`；冻结计划零生产 Wasm/Web 写入，漂移未扩大亦未同步；报告为既有 artifact-currentness drift |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / registry / Batch-G checks | PASS；ordered keys 不变；241 非 TF Q G8 与 253 非 TF Q Unified 解析对象字节等价；仅 TF Q governed disposition/evidence 变化 |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 五 tags（集合同上）；空 `remainingGap`；raw upstream `classification`/`mechanismTags`/`auditBaseline` 为历史 provenance |
| Unified 254 | sourceCount 12；completed 68 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 105 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 68 / partial 3 / none 183 |
| actionable | 0 |
| G8 242 | migrated 58 / partial 4 / blocked 111 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 87 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `906951f` |
| 审计 run | `run-b053aa53-4c8d-49eb-96df-2ba72e274910`；agent `agent-5a633c14-fe06-45a7-af0e-fced8db5300c`；runDelta6 / outside0；1233 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=81） |
| `node tools/task-governance/cli.mjs rebuild`（无 `--fix-headers`） | PASS；tasks=81；header_updates=0 |
| `node tools/task-governance/cli.mjs check`（rebuild 后） | PASS |
| `node tools/task-governance/cli.mjs docs wasm-generic-twisted-fate-wild-cards-primary-hit` | PASS；映射两份新文档 |
| 针对 rg：TF Q 不在 §5/§6 当前 blocker；离开 `implementation_gap`；12=9+3；completed68 / blocked_runtime105 / migrated58 | PASS |
| `git diff --check` | PASS |
| `node tools/agent-governance/cli.mjs check`（只读） | 既有 peer drift：planning/backend/web 三处 `task_rules.json` content_drift=3；**不** sync |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-target impact scaffold（cast0.25 / `Effect at cast time end` **排除**）；单次非暴击/不可复制魔法 `240+0.50*(ad.resolved-ad.base)+0.85*AP`；CD/mana/HP 探针（t0/t5000 命中，t4999 阻挡；mana333→133；HP1000→651）。排除：cast0.25/`Effect at cast time end`、fan/three cards/cone/angles/direction、projectile/travel/collision/pass、range1450/width80/speed1000/geometry、AOE/multitarget/repeat、spellshield、ranks1–4、W/E/basic/Stacked Deck/on-hit/equipment/loadout、live/E2E/full fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现；不得误称完整 Wild Cards 保真。
