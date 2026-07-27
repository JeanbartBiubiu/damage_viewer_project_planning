TASK_KEY: wasm-generic-jhin-dancing-grenade-primary-first-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 烬 Q 曼舞手雷 Dancing Grenade 主目标首击机制验证记录

详细设计：[通用 ABI - 烬 Q 曼舞手雷（Dancing Grenade）主目标首击机制详细设计](../../详细设计/wasm/通用ABI-烬Q曼舞手雷DancingGrenade主目标首击机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_jhin|Q|曼舞手雷`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Jhin/Q`，解析 `Template:Data Jhin/Dancing Grenade`；page `1307579` / rev `4007611` / timestamp `2026-04-12T07:23:12Z`；canonical raw bytes `1913`；SHA256 `522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/jhin-q.json` bytes `2388` / SHA256 `6f5c6dcc9771140136705f8e6554cb999f7ec5a1272515d5cbd03b910bdd20b1` plus pages sibling bytes `682` / SHA256 `642d7c88a064cd3107a4cf9f51a75be2ca91bb2e904afd6cfa8cf3ead92b7897` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `1911` bytes，SHA256 `17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`ap_ratio`、`immediate_impact_scaffold`（**无** `total_ad_ratio`；**无** completed salvage tag）。合同：Rank5 60 mana / 5000ms CD；immediate selected-primary-champion first-grenade single physical hit scaffold；恰好一笔非暴击/不可复制物理命中 `144 + 0.74 * source.attr.ad.resolved + 0.60 * source.attr.ap.resolved`（精确嵌套二元树；**total AD 直接读取**；不得减 base AD，亦不得称为 bonus AD；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动一次 `ability_started`；零 Q state/modifier/listener/matcher/repeat/control/projectile/bounce；**无** Q-specific type。交叉：AD0/AP0/armor0 → raw/final144；AD100/AP0/armor0 → raw/final218；AD0/AP100/armor0 → raw/final204；AD100/AP100/armor0 → raw/final278；AD100/AP100/armor100 → raw278/final139；AD200/AP100/armor100 → raw352/final176；baseAD0 与 baseAD60 在 resolvedAD100/AP0/armor0 下均 raw/final218。mana180/baseAD60/resolvedAD100/AP100/HP1000/armor100 t0/t4999/t5000 → success/skip/success、两笔 Q damage、final mana60/HP722、两次自动 Q `ability_started`；mana59 resource skip / mana/HP 不变 / 无 Q damage/event。Jhin Q provider **standalone**；显式 Q/W isolation（preserve existing W；Q seed 无 W rows）；不合成 P/E/R/basic；不合成 Batch-B 或 sibling Jhin。Backend 无 repository-owned `hero_jhin`/AD/AP/mana materializer；seed/JUnit 仅 external-existing-data/check-only；不物化 identity/panel/resource；不 live-publish。**不**宣称 cast/cancel/projectile/acquisition/bounce/nearest-unhit/death-amp/max-bounce/spellshield/other ranks 或完整 Dancing Grenade/游戏保真；本闭环**恰好是一次选定主目标首雷物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: jhin-q-dancing-grenade-primary-first-hit-phase-a-v1`；有效 DESIGN_READY `run-a8330b2c-ee29-46b5-9cd1-98edcb39b7c0`，strict model，runDelta0/diff0，1888/1888 parseable events / 35/35 complete tool groups，无 truncation/mutation；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-a8330b2c-ee29-46b5-9cd1-98edcb39b7c0` | READY；1888 events / 35/35 complete tool groups；runDelta0/diff0；无 truncation/mutation | **接受门控** |
| Backend owning | owning `ce2259465897a07fd68531f8e0994b2dc481bdf0`；`run-72245e2f-6b1f-4bec-84a8-684b81ba8bfd` | runDelta3/outside0；主 focused61 / full965 PASS；seed SHA `414da928…73db11`；JUnit SHA `b2c7a800…7f38ca`；README SHA `96dfddaa…d38fc6` | 接受 |
| Backend 镜像 | `488898e9848d6952796733f454ae7c6f75a5fa65`；`run-299aaaa4-8cae-4473-b035-5e70701f9e87` | runDelta3/outside0；精确 parity | 接受 |
| Wasm exact | `f70be27662ef57c9e154d2067e7a0678739c746e`；`run-02c77f33-d0dd-4ea8-830d-bbef38f3e25f` + gofmt `run-ae92e35e-1531-4659-8e57-4c9a2bfce106` | runDelta1/outside0 各一次；focused/full/bench/build/smoke/benchmark PASS；最终 test bytes71563 / SHA `deaa6604…99679cc4`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；**诚实记录**机械 gofmt formatting correction（语义不变） | 接受 |
| Web | 无本机制写入 | Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` | 接受；无 Web 变更/拷贝 |
| 审计接受 | `10a32116d30ab584562acdaeb61d8a2738f34348`；`run-2dd9…` | strict model；runDelta8/outside0；主五检查通过；语义比较仅 Jhin Q G8/Unified 变化；provisional 仅移除 Jhin Q | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Jhin/Q` → `Template:Data Jhin/Dancing Grenade` / 1307579 / 4007611 / 2026-04-12T07:23:12Z / 1913 / `522c4b91…1685f1` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/jhin-q.json`（2388 / `6f5c6dcc…dd20b1`）plus pages sibling（682 / `642d7c88…2b7897`）权威 |
| local raw caveat | 1911 bytes / SHA `17deceae…6dd0cb`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Jhin Dancing Grenade primary first hit | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke | PASS |
| generic benchmark | PASS |
| exact commit | `f70be27662ef57c9e154d2067e7a0678739c746e` |
| test bytes / SHA（最终） | `71563` / SHA256 `deaa660439d9a5ac8132eb79ad0c16b11c67acf4d5ae03d48110baed99679cc4` |
| 实现 run | `run-02c77f33-d0dd-4ea8-830d-bbef38f3e25f`；runDelta1/outside0 |
| 机械 gofmt 修正 | `run-ae92e35e-1531-4659-8e57-4c9a2bfce106`；runDelta1/outside0；**仅**格式；语义/断言/标识符不变；诚实记录为 formatting correction，**不是**合同失败 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused61 / full965）；owning `ce2259465897a07fd68531f8e0994b2dc481bdf0`；run `run-72245e2f-6b1f-4bec-84a8-684b81ba8bfd`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed `414da9285d861111cd7f0753768d4082366f7515ef3f67cc81cd5ec0c373db11`；JUnit `b2c7a800aad33db993f2e07958e537e26bc5f09d6848d70a2ff21cc6ee7f38ca`；README `96dfddaa841eeddc5af48c049aae797b190177ad7b0d4a8ae5287f1191d38fc6` |
| Backend 镜像 | PASS；`488898e9848d6952796733f454ae7c6f75a5fa65`；run `run-299aaaa4-8cae-4473-b035-5e70701f9e87`；runDelta3/outside0；精确 parity |
| seed 合同 | `db/game_manage/seeds/lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql` + `LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest`；一笔精确嵌套二元物理 20220/20170；无 20230；无显式 event；无 Q-specific type；`hero_jhin`/ad/ap/mana external-existing-data/check-only；不物化 identity/panel/resource；standalone；显式 Q/W isolation；无 sibling 合成 |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit / 拷贝 | **无** |
| 当前 Built / 独立 Web worktree 资产 | **1,169,377** / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`（与标准 Wasm build 精确一致） |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本 test-only Wasm 追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Jhin Q 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Jhin Q；先前 completed/migrated 记录锁定；稳定 digests 不变 |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上；无 `total_ad_ratio`/salvage）；空 `remainingGap`；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 96 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 77 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 96 / partial 3 / none 155 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 86 / partial 4 / blocked 83 / OOS 69；inScope 173 |
| provisional | 80 = runtime77 / data3；hero78 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | 60 |
| 报告口径 | 严格 verified completion **96/254=37.8%**；completed + provisional implementation-description coverage **176/254=69.3%**；80 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `10a32116d30ab584562acdaeb61d8a2738f34348` |
| 审计接受 run | `run-2dd9…`；strict model；runDelta8 / outside0；主五检查通过；语义比较证明仅 Jhin Q G8/Unified 变化；provisional 仅移除 Jhin Q |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控与 formatting 笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-a8330b2c-ee29-46b5-9cd1-98edcb39b7c0` |
| Standalone / check-only / total AD + AP | 显式 Q/W isolation；不合成 P/E/R/basic；external-existing-data/check-only `hero_jhin`/ad/ap/mana；精确嵌套二元物理 `144+0.74*ad.resolved+0.60*ap.resolved`；type 20220 / add 20170；无 20230；无 Q-specific type；禁止 `total_ad_ratio`/salvage |
| Formatting correction | 实现轮 `run-02c77f33…` 后另有机械 gofmt `run-ae92e35e…`；**仅**格式修正；最终 bytes71563 / SHA `deaa6604…`；诚实记录，**不是**合同失败或语义变更 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=110；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=110；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 rebuild） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate selected-primary-champion first-grenade single physical hit scaffold；一笔非暴击/不可复制物理命中 `144+0.74*ad.resolved+0.60*ap.resolved`（精确嵌套二元；type 20220 / add 20170；无 20230；无显式 event op；total AD 直读 + AP）；CD/mana 探针（t0/t4999/t5000；mana59 resource skip）；自动 `ability_started`；standalone provider（显式 Q/W isolation）；Built/独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast time/unit-targeted cancel conditions、projectile travel/first-target acquisition、bounce to up to three additional targets/nearest-unhit priority、target-death +35% later-bounce amplification/maximum final bounce、spellshield bounce-persistence、ranks1-4、other Jhin abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live/E2E/full-game/full Dancing Grenade/full-skill fidelity。本闭环**恰好是一次选定主目标首雷物理命中**，**不是**完整 Q。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Dancing Grenade 保真。
