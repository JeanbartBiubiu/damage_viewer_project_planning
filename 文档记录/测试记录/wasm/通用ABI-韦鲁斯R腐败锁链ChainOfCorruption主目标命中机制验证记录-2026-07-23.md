TASK_KEY: wasm-generic-varus-chain-of-corruption-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-23

# 通用 ABI 韦鲁斯 R 腐败锁链 Chain of Corruption 主目标命中机制验证记录

详细设计：[通用 ABI - 韦鲁斯 R 腐败锁链（Chain of Corruption）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-韦鲁斯R腐败锁链ChainOfCorruption主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_varus|R|腐败锁链`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Varus/R`，解析 `Template:Data Varus/Chain of Corruption`；page `1309977` / rev `4008213` / timestamp `2026-04-14T05:44:24Z`；canonical raw bytes `5223`；SHA256 `62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/varus-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 为非规范 `5222` bytes / SHA256 `aa50685e07a4a974baa7f4a3bf43689f930dd20ac144fa03b72886daf8242207`；修剪终端 LF 得到 `5221` bytes / SHA256 `a5b638836ce4976afc3e79852655826b82ecb357f2c54d36a0c885202129b585`，**不是** canonical——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget`。合同：Rank3 active 100 mana / 60000ms CD；immediate primary-champion scaffold（unspecified cast delay / `Effect at cast time end` / 弹道 / 几何 / 方向 / root / reveal / Blight / tendril / 传播 / 多目标 **显式排除**而非近似）；恰好一笔非暴击/不可复制魔法 `350 + 1.00*source.attr.ap.resolved`。交叉：AP200 → raw550；MR100 → mitigated275；t0/t59999/t60000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害/状态突变；mana300 → final100；目标 HP1000 → final450。governed tags 序：`ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold`。Backend seed 对 Batch-B `hero_varus` 身份与 AP 为 check-only，自包含 ensure mana 定义与 hero_varus mana320/320，**不**写入 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values`。**不**宣称施放延迟/弹道/禁锢/揭示/Blight/触须/传播或多目标或完整 Chain of Corruption/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: varus-r-chain-of-corruption-primary-hit-phase-a-v1`；DESIGN_REVIEW_ONLY READY `run-d8c81fca-952c-4ca8-86c6-14b648de96f6`，strict `grok-4.5`，effort high，fast false，结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=varus-r-chain-of-corruption-primary-hit-phase-a-v1`，runDeltaCount 0，2298/2298 parseable，无 truncation/mutation；非阻塞笔记已吸收；较早 SDK/API 初始化失败非审查证据；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-23**（驱动环境 Asia/Shanghai），即使构建工具打印更晚墙钟时间亦以本日期为准。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW_ONLY | `run-d8c81fca-952c-4ca8-86c6-14b648de96f6` | READY；strict `grok-4.5`；effort high；fast false；runDelta0；2298/2298 parseable |
| Backend owning | `067b0f8`；`run-2b0e4920-0451-430d-8c74-c324d19f130b` | seed + focused 9/9；full 750/750；delta3/outside0；659/659 parseable；禁止身份/面板写入0、DDL0、DELETE0 |
| Backend → Wasm 集成 | `982145c` | Backend 合入 Wasm 分支 |
| Wasm exact | `74f3b22`；`run-62f7fad2-fba4-45e6-9fc6-b858b1141487` | `generic_varus_chain_of_corruption_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 5/5；delta1/outside0；1139/1139 parseable |
| 审计 commit | `9c0b831`；`run-242965a8-506f-43c2-a8d2-03fb26a19656` | G8/Unified/registry/Batch-G；runDelta6/outside0；1395/1395 parseable；ordered keys 不变，仅 Varus R 解析对象语义变化 |
| Web | 无本机制源码变更 | 资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Varus/R` → `Template:Data Varus/Chain of Corruption` / 1309977 / 4008213 / 2026-04-14T05:44:24Z / 5223 / `62b397cc…83e4ed` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/varus-r.json` |
| local raw caveat | 5222 bytes / SHA `aa50685e…242207`；修剪终端 LF → 5221 / `a5b63883…29b585` ≠ canonical；sidecar/pages 权威；非字节等价；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_varus_chain_of_corruption_primary_hit_test.go` | PASS（5/5） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（generic 100 samples） |
| 初步直接 TinyGo（无 `WASMOPT`） | **未接受**；非本切片权威构建证据 |
| 标准 `scripts/build-wasm.ps1` TinyGo / Wasm build | PASS；产物 1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`（相对既有 build **未变**） |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |
| runtime 伤害类型 | magic `20221`；无 physical `20220` |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（9/9） |
| owning full `mvn test` | PASS（750/750） |
| integrated | PASS（合入 `982145c`） |
| seed 合同 | Batch-B `hero_varus` 身份与 AP 定义/实体值 check-only；自包含 ensure mana 定义与 hero_varus mana320/320；**不**写入 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values`；独立 `provider_hero_varus_r_chain_of_corruption_primary_hit`；保留 basic / W / E；幂等 revision guard；可执行 SQL 禁止身份/面板写入0、DDL0、DELETE0；无 auto-publish/live execution |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码变更 | 无（零写入） |
| Web Wasm 资产现状（独立限制，非机制 blocker） | 当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`；冻结计划零生产 Wasm/Web 写入，漂移未扩大亦未同步；报告为既有 artifact-currentness drift |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / registry / Batch-G checks | PASS；ordered keys 不变；仅 Varus R governed disposition/evidence 语义变化（除生成时间戳） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap` |
| Unified 254 | sourceCount 12；completed 73 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 100 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 73 / partial 3 / none 178 |
| actionable | 0 |
| G8 242 | migrated 63 / partial 4 / blocked 106 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 82 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `9c0b831` |
| 审计 run | `run-242965a8-506f-43c2-a8d2-03fb26a19656`；runDelta6 / outside0；1395/1395 parseable |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=86；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` | PASS |
| `node tools/agent-governance/cli.mjs check`（只读；如触发） | 既有 peer drift 若存在则仅报告；**不** sync |

## 4. 已实现边界

已实现：Rank-3 active cost/cooldown；immediate primary-champion impact scaffold（unspecified cast delay / `Effect at cast time end` / 弹道 / 几何 / 方向 / root / reveal / Blight / tendril / 传播 / 多目标 **排除**）；单次非暴击/不可复制魔法 `350+1.00*AP`；CD/mana/HP 探针（t0/t60000 命中，t59999 阻挡；mana300→100；HP1000→450）。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：unspecified cast delay/`Effect at cast time end`、projectile/travel/speed/collision/global geometry/direction/facing/interception/spellshield/untargetable、root/reveal/tenacity/cleanse/CC immunity、Blight creation/0.65/1.2/1.75 schedule/rank0/W coupling/detonation/state、tendril ground anchor/0.25 seeking/range/area/secondary/repeat/spread/multitarget、ranks1–2、Varus P/Q/W/E/basic/on-hit/equipment/loadout、live/E2E/full-game/full-skill fidelity。Batch-B identity/AP check-only 与自包含 mana ensure 为 seed 执行前置，**不是**未解决数据缺口。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Chain of Corruption 保真。
