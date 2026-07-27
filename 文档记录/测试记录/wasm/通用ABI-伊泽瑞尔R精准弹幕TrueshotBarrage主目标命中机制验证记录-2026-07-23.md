TASK_KEY: wasm-generic-ezreal-trueshot-barrage-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-23

# 通用 ABI 伊泽瑞尔 R 精准弹幕 Trueshot Barrage 主目标命中机制验证记录

详细设计：[通用 ABI - 伊泽瑞尔 R 精准弹幕（Trueshot Barrage）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-伊泽瑞尔R精准弹幕TrueshotBarrage主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_ezreal|R|精准弹幕`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Ezreal/R`，解析 `Template:Data Ezreal/Trueshot Barrage`；page `1307113` / rev `4013235` / timestamp `2026-04-28T21:20:36Z`；canonical raw bytes `1453`；SHA256 `e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 为非规范 `1450` bytes / SHA256 `ddc984665670fe9aee859ec740d63c101b04c7f504f610952f94fe67a014f943`；修剪终端 LF 得到 `1449` bytes / SHA256 `57a04bc0b2e42505bd9ec1b324fed4192aecb213ea22dade56f4e77ed553f3ce`；前加 BOM 得到 `1453` bytes / SHA256 `27fbea33e254bd4b139e49ca0bbface059f490d25fa74cd33b19846596a1c639`，**仍不是** canonical——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage`。合同：Rank3 active 100 mana / 90000ms CD；immediate primary-champion scaffold（cast1 / queue0.5 / `Effect at cast time start` / 弹道 / 几何 / 方向 / 多目标 / 视野 / 小兵或野怪修正伤害 **显式排除**而非近似）；恰好一笔非暴击/不可复制魔法 `750 + 1.00*(source.attr.ad.resolved - source.attr.ad.base) + 1.10*source.attr.ap.resolved`。交叉：base AD60 / resolved AD110 / bonus AD50 / AP200 → raw1020；MR100 → mitigated510；t0/t89999/t90000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害；mana300 → final100；目标 HP1500 → final480。governed tags 序：`ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`bonus_ad_ratio`、`immediate_impact_scaffold`。Backend seed 对 `hero_ezreal` / AD/AP / mana 为外部既有数据 check-only，**不**物化身份/面板/资源，**不**调用 Batch-B。**不**宣称施放延迟/队列/弹道/几何/多目标/视野/小兵野怪修正或完整 Trueshot Barrage/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: ezreal-r-trueshot-barrage-primary-hit-phase-a-v2`；DESIGN_REVIEW_ONLY READY `run-4324de07-a520-422b-a9bb-e0072955b3dc`，strict `grok-4.5`，effort high，fast false，结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=ezreal-r-trueshot-barrage-primary-hit-phase-a-v2`，runDeltaCount 0，1353/1353 parseable，无 truncation/mutation；非阻塞笔记已吸收；v1 REVISE 已并入 v2；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-23**（驱动环境 Asia/Shanghai），即使构建工具打印更晚墙钟时间亦以本日期为准。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW_ONLY | `run-4324de07-a520-422b-a9bb-e0072955b3dc` | READY；strict `grok-4.5`；effort high；fast false；runDelta0；1353/1353 parseable |
| Backend owning | `dea4538`；`run-86e431e9-6d40-4f41-85b3-459af643a844` | seed + focused 9/9；full 741/741；delta3/outside0；1106/1106 parseable |
| Backend → Wasm 集成 | `8c93017` | Backend 合入 Wasm 分支 |
| Wasm exact | `e13d887`；`run-3d4dafae-987e-4ec2-9284-a4d8b976b522` | `generic_ezreal_trueshot_barrage_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 5/5；delta1/outside0；907/907 parseable |
| 审计 commit | `c090aa1`；恢复 `run-89d56506-b5eb-4f04-b26a-434ab5026d99` | G8/Unified/registry/Batch-G；runDelta4/outside0；837/837 parseable；前序超时 `run-d696de7b…` **非**有效完成证据；ordered keys 不变，仅 Ezreal R 解析对象语义变化 |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Ezreal/R` → `Template:Data Ezreal/Trueshot Barrage` / 1307113 / 4013235 / 2026-04-28T21:20:36Z / 1453 / `e9d7f9d7…53580e0` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-r.json` |
| local raw caveat | 1450 bytes / SHA `ddc98466…014f943`；修剪终端 LF → 1449 / `57a04bc0…53f3ce`；BOM 前缀 → 1453 / `27fbea33…a1c639` ≠ canonical；sidecar/pages 权威；非字节等价；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_ezreal_trueshot_barrage_primary_hit_test.go` | PASS（5/5） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（generic 100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`（相对既有 build **未变**） |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |
| runtime 伤害类型 | magic `20221`；无 physical `20220` |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（9/9） |
| owning full `mvn test` | PASS（741/741） |
| integrated | PASS（合入 `8c93017`） |
| seed 合同 | 外部既有数据 check-only（`hero_ezreal` / ad / ap / mana 定义与实体值）；**不**物化身份/面板/资源；**不**调用 Batch-B；独立 `provider_hero_ezreal_r_trueshot_barrage_primary_hit`；保留 Rising Spell Force；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

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
| G8 / Unified / registry / Batch-G checks | PASS；ordered keys 不变；仅 Ezreal R governed disposition/evidence 语义变化（除生成时间戳） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 五 tags（序同上）；空 `remainingGap` |
| Unified 254 | sourceCount 12；completed 72 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 101 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 72 / partial 3 / none 179 |
| actionable | 0 |
| G8 242 | migrated 62 / partial 4 / blocked 107 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 83 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `c090aa1` |
| 审计恢复 run | `run-89d56506-b5eb-4f04-b26a-434ab5026d99`；runDelta4 / outside0；837/837 parseable |
| 前序超时 run | `run-d696de7b-8cdf-487d-9f0c-351c9c581108`；**不是**有效完成证据 |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=85；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` | PASS |
| `node tools/agent-governance/cli.mjs check`（只读；如触发） | 既有 peer drift 若存在则仅报告；**不** sync |

## 4. 已实现边界

已实现：Rank-3 active cost/cooldown；immediate primary-champion impact scaffold（cast1 / queue0.5 / `Effect at cast time start` / 弹道 / 几何 / 方向 / 多目标 / 视野 / 小兵野怪修正 **排除**）；单次非暴击/不可复制魔法 `750+1.00*bonusAD+1.10*AP`；CD/mana/HP 探针（t0/t90000 命中，t89999 阻挡；mana300→100；HP1500→480）。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast1/queue0.5/`Effect at cast time start`、projectile/travel/collision/global geometry/direction、multitarget/sight、minion/non-epic monster modified `300+1.00 bonus AD+1.10 AP`、ranks1–2、Ezreal P/Q/W/E/basic/on-hit/equipment/loadout、live/E2E/full-game/full-skill fidelity。外部既有数据 check-only 与「不调用 Batch-B」为 seed 执行前置，**不是**未解决数据缺口。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Trueshot Barrage 保真。
