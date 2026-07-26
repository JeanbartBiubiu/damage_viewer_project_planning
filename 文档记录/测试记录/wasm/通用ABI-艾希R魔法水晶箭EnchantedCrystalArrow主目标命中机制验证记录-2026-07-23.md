TASK_KEY: wasm-generic-ashe-enchanted-crystal-arrow-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-23

# 通用 ABI 艾希 R 魔法水晶箭 Enchanted Crystal Arrow 主目标命中机制验证记录

详细设计：[通用 ABI - 艾希 R 魔法水晶箭（Enchanted Crystal Arrow）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-艾希R魔法水晶箭EnchantedCrystalArrow主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_ashe|R|魔法水晶箭`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Ashe/R`，解析 `Template:Data Ashe/Enchanted Crystal Arrow`；page `1306811` / rev `4026934` / timestamp `2026-06-10T19:09:50Z`；canonical raw bytes `2394`；SHA256 `1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/ashe-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 为非规范 `2393` bytes / SHA256 `2bce161be04aa2cbe770a7402651929cfb3a7781d7a7ca828b93d1de68d4bb28`；修剪终端 LF 得到 `2392` bytes 与第三哈希，**不是** canonical——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight`。合同：Rank3 active 100 mana / 60000ms CD；immediate primary-target scaffold（cast0.25 / `Effect at cast time start` / 弹道 / 距离眩晕 / 周围 AOE/Frost / 视野 **显式排除**而非近似）；恰好一笔非暴击/不可复制魔法 `600 + 1.20*source.attr.ap.resolved`。交叉：AP200 → raw840；MR100 → mitigated420；t0/t59999/t60000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害；mana280 → final80；目标 HP1000 → final160。governed tags 序：`ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold`。**不**宣称施放延迟/弹道/眩晕/AOE/Frost/视野或完整 Enchanted Crystal Arrow/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1`；DESIGN_REVIEW_ONLY READY `run-6bd37601-dadd-4892-8bc8-c025bd88bdbf`，strict `grok-4.5`，effort high，fast false，结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1`，runDeltaCount 0，653/653 parseable，无 truncation/mutation；权威 verdict = 完整 `createPlan` 事件；两条非阻塞笔记已吸收；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-23**（驱动环境 Asia/Shanghai），即使构建工具打印更晚墙钟时间亦以本日期为准。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW_ONLY | `run-6bd37601-dadd-4892-8bc8-c025bd88bdbf` | READY；strict `grok-4.5`；effort high；fast false；runDelta0；653/653 parseable；权威 = `createPlan` |
| Backend owning | `5d4a13f`；`run-4403ee34-dbcf-4a78-8973-97591b0679b5` | seed + focused 39/39；full 732/732；delta3/outside0 |
| Backend → Wasm 集成 | `2f820e4` | Backend 合入 Wasm 分支 |
| Wasm exact | `bb3dd81`；`run-1e007813-e5b5-4dd2-9352-548240b02737` | `generic_ashe_enchanted_crystal_arrow_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 4/4；delta1/outside0 |
| 审计 commit | `7c73c74`；`run-f5c2483f-e851-485a-8063-383417143cfb` | G8/Unified/registry/Batch-G；runDelta6/outside0；1182/1182 parseable；ordered keys 不变，仅 Ashe R 解析对象语义变化 |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Ashe/R` → `Template:Data Ashe/Enchanted Crystal Arrow` / 1306811 / 4026934 / 2026-06-10T19:09:50Z / 2394 / `1d9ccefa…450664f` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/ashe-r.json` |
| local raw caveat | 2393 bytes / SHA `2bce161…d4bb28`；修剪终端 LF → 2392 + 第三哈希 ≠ canonical；sidecar/pages 权威；非字节等价；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_ashe_enchanted_crystal_arrow_primary_hit_test.go` | PASS（4/4） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（generic 100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`（相对既有 build **未变**） |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |
| runtime 伤害类型 | magic `20221`；无 physical `20220` |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（39/39） |
| owning full `mvn test` | PASS（732/732） |
| integrated | PASS（合入 `2f820e4`） |
| seed 合同 | 自包含；baseline hp610/mana280/ad59/ap0/AS0.658/armor26/MR30/hpregen3.5/manaregen7；恰好九条属性（含 AP）；保留 Q Rangers Focus / W Volley；独立 `provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit`；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

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
| G8 / Unified / registry / Batch-G checks | PASS；ordered keys 不变；仅 Ashe R governed disposition/evidence 语义变化（除生成时间戳） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap`；raw upstream（含历史 `blocked_data`）为历史 provenance |
| Unified 254 | sourceCount 12；completed 71 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 102 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 71 / partial 3 / none 180 |
| actionable | 0 |
| G8 242 | migrated 61 / partial 4 / blocked 108 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 84 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `7c73c74` |
| 审计 run | `run-f5c2483f-e851-485a-8063-383417143cfb`；runDelta6 / outside0；1182/1182 parseable |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=84；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` | PASS |
| `node tools/agent-governance/cli.mjs check`（只读；如触发） | 既有 peer drift 若存在则仅报告；**不** sync |

## 4. 已实现边界

已实现：Rank-3 active cost/cooldown；immediate primary-target impact scaffold（cast0.25 / `Effect at cast time start` / 弹道 / 距离眩晕 / 周围 AOE/Frost / 视野 **排除**）；单次非暴击/不可复制魔法 `600+1.20*AP`；CD/mana/HP 探针（t0/t60000 命中，t59999 阻挡；mana280→80；HP1000→160）。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast0.25/`Effect at cast time start`、projectile/travel/collision/range/speed/geometry、distance-scaled stun、surrounding same-damage AOE/Frost、sight、ranks1–2、Ashe P/Q/W/basic/on-hit/equipment/loadout、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Enchanted Crystal Arrow 保真。
