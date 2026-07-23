TASK_KEY: wasm-generic-varus-chain-of-corruption-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-23

# 通用 ABI - 韦鲁斯 R 腐败锁链（Chain of Corruption）主目标命中机制详细设计

关联验证记录：[通用 ABI 韦鲁斯 R 腐败锁链 Chain of Corruption 主目标命中机制验证记录](../../测试记录/wasm/通用ABI-韦鲁斯R腐败锁链ChainOfCorruption主目标命中机制验证记录-2026-07-23.md)。本任务将精确候选 `hero_skill|hero_varus|R|腐败锁链` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称未指定施放延迟/弹道飞行/碰撞几何/方向/禁锢/揭示/Blight 日程/触须寻敌/传播/多目标，或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV varus-r-chain-of-corruption-primary-hit-phase-a-v1`（新鲜 DESIGN_REVIEW_ONLY READY `run-d8c81fca-952c-4ca8-86c6-14b648de96f6`；strict `grok-4.5`；effort high；fast false；结构化事件 `VERDICT=READY` / `REVIEWED_PLAN_REV=varus-r-chain-of-corruption-primary-hit-phase-a-v1`；runDeltaCount 0；2298/2298 JSONL 可解析；无 truncation/mutation。非阻塞笔记已吸收：自包含 mana ensure、仅 reserved-types + Batch-B 前置、exact Varus R override。较早 SDK/API 初始化失败**不得**当作审查证据）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_varus\|R\|腐败锁链` |
| Wiki | 请求 `Template:Data Varus/R`，解析为 `Template:Data Varus/Chain of Corruption`；pageId `1309977`；revision `4008213`；timestamp `2026-04-14T05:44:24Z`；canonical raw bytes `5223`；SHA256 `62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/varus-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw 为非规范 `5222` bytes / SHA256 `aa50685e07a4a974baa7f4a3bf43689f930dd20ac144fa03b72886daf8242207`；修剪其终端 LF 得到 `5221` bytes / SHA256 `a5b638836ce4976afc3e79852655826b82ecb357f2c54d36a0c885202129b585`，**不是** canonical。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget` |
| Rank-3 active | 100 mana；60000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `350 + 1.00 * source.attr.ap.resolved` |
| 数值交叉 | resolved AP200 → raw550；目标 MR100 → mitigated275。t0 / t59999 / t60000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害/状态突变；mana300 → final100；目标 HP1000 → final450 |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold` |
| seed 执行前置 | Backend seed **故意**将 Batch-B `hero_varus` 身份与 AP 定义/实体值视为 **外部 check-only 前置**；自包含 ensure mana 资源定义与 `hero_varus` mana320/320；**不**写入 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values`。这是已文档化的 seed 执行前置，**不是**未解决公式/Wiki 数据缺口，**不得**据此重开已完成的有界机制 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主英雄目标结算单次魔法伤害。Wiki 未指定 cast delay 与 `Effect at cast time end` **被显式排除**，而非建模或近似；**不**伪造 cast-delay phase。不代表真实弹道飞行、碰撞几何、方向、禁锢/揭示、Blight 叠层日程、触须寻敌/传播或多目标保真。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| unspecified cast delay / Effect at cast time end | 施放延迟与 cast-end 时序 **排除而非近似** |
| projectile / travel / speed / collision / global geometry / direction / facing / interception / spellshield / untargetable | 无弹道、碰撞、全局几何、方向与拦截合同 |
| root / reveal / tenacity / cleanse / CC immunity | 禁锢、揭示与相关 CC 排除 |
| Blight creation / 0.65/1.2/1.75 schedule / rank0 / W coupling / detonation / state | Blight 叠层与日程、W 耦合排除 |
| tendril ground anchor / 0.25 seeking / range / area / secondary / repeat / spread / multitarget | 触须寻敌与传播/多目标排除 |
| ranks 1–2 | 仅 Rank3 |
| Varus P / Q / W / E / basic / on-hit / equipment / loadout | 无其它技能/普攻/装备耦合；保留既有 basic / W / E providers，永不更新/删除/重建 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki varus-r.json (page1309977/rev4008213；canonical SHA 62b397cc…)
  → Backend seed（Batch-B identity/AP check-only；self-contained mana ensure 320/320；
     provider_hero_varus_r_chain_of_corruption_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation（350+1.00*AP；runtime magic 20221 / 无 20220）
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_varus_chain_of_corruption_primary_hit_seed.sql`：对 Batch-B `game_entities(hero_varus)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_varus,ap)` 仅 **check-only**；自包含 ensure `resource_definitions(mana)` 与 `entity_resource_values(hero_varus,mana)` 为 320/320；**不**写入 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values`。仅挂载独立 `provider_hero_varus_r_chain_of_corruption_primary_hit`；保留既有 basic / W Blighted Quiver / E Hail of Arrows；一条 active ability（100 mana / 60000ms）、null-duration impact + on_enter sequence、一笔魔法 `350+1.00*source.attr.ap.resolved` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `067b0f8` / Wasm 集成 `982145c`；focused JUnit 9/9；full Maven 750/750 |
| Web | 既有 generic 投影；**无**本任务 Web 源码变更（零写入）。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `74f3b22`（`wasm/tinygo_engine_v2/internal/runtime/generic_varus_chain_of_corruption_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 5/5 与 full `go test -count=1 ./...` PASS；generic bench100 PASS；标准 `scripts/build-wasm.ps1` TinyGo build PASS（1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`）；Node canonical compile/run/release smoke PASS。初步无 `WASMOPT` 的直接 TinyGo 调用**未**被接受；仓库构建脚本解析工具后通过。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW_ONLY READY | run `run-d8c81fca-952c-4ca8-86c6-14b648de96f6`；strict `grok-4.5`；effort high；fast false；结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=varus-r-chain-of-corruption-primary-hit-phase-a-v1`；runDeltaCount 0；2298/2298 parseable；无 truncation/mutation；非阻塞笔记（self-contained mana ensure、reserved-types + Batch-B 前置、exact Varus R override）已吸收；较早 SDK/API 初始化失败非审查证据 |
| Backend owning | `067b0f8`；实现 run `run-2b0e4920-0451-430d-8c74-c324d19f130b`（strict；delta3/outside0；659/659 parseable；无 truncation）；focused 9/9；full Maven 750/750；可执行 SQL 禁止身份/面板写入 0、DDL0、DELETE0 |
| Backend → Wasm 集成 | `982145c` |
| Wasm exact | `74f3b22`；实现 run `run-62f7fad2-fba4-45e6-9fc6-b858b1141487`（strict；delta1/outside0；1139/1139 parseable；truncation flags 全 false / 无 tool error）；focused 5/5；full Go / bench100 / 标准脚本 TinyGo / Node smoke PASS |
| 审计 commit | `9c0b831`；实现 run `run-242965a8-506f-43c2-a8d2-03fb26a19656`（strict；delta6/outside0；1395/1395 parseable；truncation flags 全 false / 无 tool error） |
| 最终清单 | G8 242 = migrated63 / partial4 / blocked106 / OOS69；Unified sourceCount12 / total254；completed73 / partial_actionable0 / ready0 / blocked_runtime100 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full73 / partial3 / none178；actionable0；`implementation_gap_no_unresolved_data_fields=82` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 242/254 不变；**仅** Varus R 解析行语义变化（除生成时间戳外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状限制（非 Varus R 机制 blocker）**：冻结 Varus R 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Varus R 机制未闭环；**不得**在本切片同步资产。

非目标（再次强调）：unspecified cast delay/`Effect at cast time end`、projectile/travel/speed/collision/global geometry/direction/facing/interception/spellshield/untargetable、root/reveal/tenacity/cleanse/CC immunity、Blight creation/0.65/1.2/1.75 schedule/rank0/W coupling/detonation/state、tendril ground anchor/0.25 seeking/range/area/secondary/repeat/spread/multitarget、ranks1–2、Varus P/Q/W/E/basic/on-hit/equipment/loadout、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Chain of Corruption/游戏技能保真；**未**声称总体 Goal 完成。Batch-B identity/AP check-only 与自包含 mana ensure 是 seed 执行合同，**不是**未解决数据缺口。

## 6. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1309977 / rev4008213 / timestamp2026-04-14T05:44:24Z / canonical raw5223 / SHA256 `62b397cc…83e4ed`；sidecar/pages canonical；local raw5222 / trim5221 materialization caveat 非源矛盾、非字节等价主张 |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | Rank3 100 mana / 60000ms；raw550 / mitigated275；t0/t59999/t60000 两命中 + 一 CD skip；mana300→100；HP1000→450 |
| Backend | owning `067b0f8` / 集成 `982145c`；focused9/9；full750/750；Batch-B identity/AP check-only + self-contained mana ensure |
| Wasm | exact `74f3b22`；focused5/5；full Go / bench100 / 标准脚本 TinyGo / Node smoke PASS；产物字节/SHA 不变；无 `WASMOPT` 的直接调用非接受证据 |
| 审计 | commit `9c0b831`；G8 migrated + 空 remainingGap；Unified completed/full + 空 blocker/gap evidence null；counts 与 §4 最终清单一致 |
| Web | 无本机制源码写入；资产漂移仅记录 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
