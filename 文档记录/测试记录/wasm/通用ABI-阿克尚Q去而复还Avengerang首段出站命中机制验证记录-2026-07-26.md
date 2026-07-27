TASK_KEY: wasm-generic-akshan-avengerang-first-outbound-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 阿克尚 Q 去而复还 Avengerang 首段出站命中机制验证记录

详细设计：[通用 ABI - 阿克尚 Q 去而复还（Avengerang）首段出站命中机制详细设计](../../详细设计/wasm/通用ABI-阿克尚Q去而复还Avengerang首段出站命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_akshan|Q|去而复还`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Akshan/Q`，解析 `Template:Data Akshan/Avengerang`；page `1502462` / rev `4007510` / timestamp `2026-04-11T22:35:01Z`；canonical raw bytes `2570`；SHA256 `1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/akshan-q.json` bytes `2948` / SHA256 `f6b0dd492d80c49a2259d366230f7d8f4c6d43a70688b42d0d0780e4866d9a1a` plus pages sibling bytes `688` / SHA256 `11d2da87557737fed487fb106a9ffb7b4a6d7f1d32391ce3a5c142f9128509e0` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `2570` bytes，SHA256 `407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`（**无** completed salvage tag）。合同：Rank5 80 mana / **immediate cooldown scaffold 5000ms**（真实 Wiki 冷却在飞镖返回后开始——为 completed-boundary exclusion，**不是** faithful approximation，亦**不是** blocker）；immediate selected-primary champion first-outbound-pass single physical hit scaffold；恰好一笔非暴击/不可复制物理命中 `165 + 0.70 * (source.attr.ad.resolved - source.attr.ad.base)`（精确嵌套二元树；显式 bonus AD 减法；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op；**无** Q-specific type）；成功施放自动一次 `ability_started`；零 Q state/modifier/listener。交叉：armor100 base52/resolved52 → raw165/final82.5；base52/resolved152 → raw235/final117.5；反证 base0/resolved100 与 base52/resolved152 均 raw/final235。mana240/baseAD52/resolvedAD152/armor100/HP1000 t0/t4999/t5000 → success/skip/success、两笔 Q damage、两次自动 Q `ability_started`、final mana80/HP765；mana79 resource skip。Akshan Q provider **standalone**；**保留** Dirty Fighting / basic 定义与挂载；Q **不**合成 Dirty Fighting ability-hit stacks。Backend 前置为 **absent-only** mana resource definition/value，经由 `ON CONFLICT DO NOTHING`，由既有 panel mana 派生，**永不覆盖**；hero/ad/mana panel EAV 与 Dirty Fighting/basic **repository-owned/preserved**；不 live-publish。**不**宣称 cast/effect-at-cast-end、direction/range/range extension/geometry、projectile/travel/speed/collision/return/homing、真实冷却在返回后开始、第二段回程/两段合计/once-per-pass、sight/reveal、movement speed/AP movement ratio/decay、nonchampion scaling、spellshield、Dirty Fighting ability-hit wiring、other ranks 或完整 Avengerang/游戏保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: akshan-q-avengerang-first-outbound-hit-phase-a-v4`；正式最终 DESIGN_READY `run-bde07e54-a7f2-4ba5-878c-39209b3593e0`，26/26 complete tool groups，runDelta0，无 truncation/mutation，无 user decision；**省略**聚合 event-total——不在冻结证据内；先前 v1 `run-0abb40b7-cab2-42aa-a91c-7c2ab7989ac7` 为 valid REVISE（1855/1855；46/46；delta0；absent-only mana 与 cooldown-start-after-return 文档化均已接受）；有效 v2 READY `run-11d562ed-9bb5-494c-8825-d8da61e6589a`（1682/1682；36/36；delta0）曾治理初始 Backend，被中止的 v2 Wasm test run **不是**完成证据；有效 v3 `run-f627e870-08fd-41a0-a148-c928c1be1d16` 返回 REVISE（2169/2169；52/52；delta0；fixture truth/scope 校正均已接受）；**v4 为正式最终 READY 门控**；运行时/审计已提交）填写。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。Production Wasm/public ABI/Web 变更**不**需要。英雄名 `_test.go` 仅为机制级回归/治理证据，排除于 normal/TinyGo 生产构建；**无**英雄专用生产分支；**无**生产 runtime/ABI 实现变更——**不**损害 generic runtime 实现主张。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-bde07e54-a7f2-4ba5-878c-39209b3593e0` | READY；26/26 complete tool groups；runDelta0；无 truncation/mutation；无 user decision；省略聚合 event-total。v1/v3 REVISE 校正已接受；v2 READY 非最终完成证据；被中止 v2 Wasm test 非完成证据 | **接受门控**（仅 v4） |
| Backend owning | owning `bd8dbcbd5768460a6921465dd3e6c8c6a464948f`；`run-70747b97-7856-45ed-89aa-56ea1c223360` | runDelta3/outside0；主 focused12 / full1010 PASS；seed bytes30848 / SHA `d45d8297…c81dcd`；JUnit bytes59429 / SHA `2f64e5c0…cac296`；README bytes291215 / SHA `188b0174…a5310b`（历史材料身份；非持续 Wasm 测试不变量） | 接受 |
| Backend 镜像 | `45d589a71aebfe9435c23c68a8fc007b7198f59c`；`run-5be3a5ed-b33b-4665-83fb-4012e26692fa` | runDelta3/outside0；精确 parity | 接受 |
| Wasm exact | `b58a54941463ebf6ec1350529915721fde381030`；`run-e99bc519-beea-449d-8947-95e9ca0ba7c7` | runDelta2/outside0；47/47 complete tool groups；focused Akshan/Ezreal、Akshan count100、full/build/smoke/bench PASS；Akshan test bytes66516 / SHA `dc922f42…618805`；Ezreal durability-repaired test bytes67920 / SHA `db308c2a…719767`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据 | 接受 |
| Web | 无本机制写入 | Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0`；Production 变更不需要 | 接受；无 Web 变更/拷贝 |
| 审计接受 | `144d6e9ed63b1e0c1371135acd48d30d85fb207c`；`run-dc10edec-b547-4b3d-a36a-b35a03e87e75` | runDelta8/outside0；88/88 complete tool groups；主五检查通过；语义比较仅 Akshan Q G8/Unified 变化；provisional 仅移除 Akshan Q | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Akshan/Q` → `Template:Data Akshan/Avengerang` / 1502462 / 4007510 / 2026-04-11T22:35:01Z / 2570 / `1cbf7dda…5b5f5b` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/akshan-q.json`（2948 / `f6b0dd49…6d9a1a`）plus pages sibling（688 / `11d2da87…8509e0`）权威 |
| local raw caveat | 2570 bytes / SHA `407e4671…b8c973`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Akshan Avengerang first outbound hit / Ezreal / `-count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `b58a54941463ebf6ec1350529915721fde381030` |
| Akshan test bytes / SHA | `66516` / SHA256 `dc922f4249cb87a5f6afda8f3a88dac011cc5a5683ff6c0a9a8c5cfd16618805` |
| Ezreal durability-repaired test bytes / SHA | `67920` / SHA256 `db308c2af5c6741fdc470e76a83edf2f71204fb3bc259cbb6c8f860fbb719767` |
| 实现 run | `run-e99bc519-beea-449d-8947-95e9ca0ba7c7`；runDelta2/outside0；47/47 complete tool groups |
| 英雄名 `_test.go` 地位 | 机制级回归/治理证据 only；排除于 normal/TinyGo 生产构建；无英雄专用生产分支；**无**生产 runtime/ABI 变更；**不**损害 generic runtime 实现主张 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused12 / full1010）；owning `bd8dbcbd5768460a6921465dd3e6c8c6a464948f`；run `run-70747b97-7856-45ed-89aa-56ea1c223360`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed bytes30848 / `d45d8297352597ecd4581fef40c80c1824e51e42b938b0bcfa6ae653cbc81dcd`；JUnit bytes59429 / `2f64e5c0bd960c8767d2b85847b342948de266bd4e13a1e92743f376d7cac296`；README bytes291215 / `188b0174fc7647efbdcaf6388d537afe1c164ed4dbda5b1ce549589b13a5310b`（历史材料身份；非持续 Wasm 测试不变量） |
| Backend 镜像 | PASS；`45d589a71aebfe9435c23c68a8fc007b7198f59c`；run `run-5be3a5ed-b33b-4665-83fb-4012e26692fa`；runDelta3/outside0；精确 parity |
| seed 合同 | `db/game_manage/seeds/lol_generic_akshan_avengerang_first_outbound_hit_seed.sql` + `LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest`；一笔精确嵌套二元物理 20220/20170；bonus AD 显式减法；无 20230；无显式 event；无 Q-specific type；absent-only mana `ON CONFLICT DO NOTHING`；hero/ad/mana panel EAV 与 Dirty Fighting/basic repository-owned/preserved；standalone Q；不合成 ability-hit stacks |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit / 拷贝 | **无** |
| 当前 Built / 独立 Web worktree 资产 | **1,169,377** / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`（与标准 Wasm build 精确一致） |
| Production Wasm / public ABI / Web 变更 | **不**需要 |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本机制级回归证据追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Akshan Q 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Akshan Q；先前 completed/migrated 记录锁定；稳定 digests 不变（Unified `69832c2a…c018`；Wiki registry `927d8b5a…26c7`） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap`；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 100 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 73 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 100 / partial 3 / none 151 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 90 / partial 4 / blocked 79 / OOS 69；inScope 173 |
| provisional | 76 = runtime73 / data3；hero74 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | **仍为 58**（Akshan Q **不在**该家族） |
| 报告口径 | 严格 verified completion **100/254=39.4%**；completed + provisional implementation-description coverage **176/254=69.3%**；76 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `144d6e9ed63b1e0c1371135acd48d30d85fb207c` |
| 审计接受 run | `run-dc10edec-b547-4b3d-a36a-b35a03e87e75`；runDelta8 / outside0；88/88 complete tool groups；主五检查通过；语义比较证明仅 Akshan Q G8/Unified 变化；provisional 仅移除 Akshan Q |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控与证据地位笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | 正式最终 READY `run-bde07e54-a7f2-4ba5-878c-39209b3593e0`（26/26；runDelta0；省略聚合 event-total） |
| v1 valid REVISE | `run-0abb40b7-cab2-42aa-a91c-7c2ab7989ac7`（1855/1855；46/46；delta0）；absent-only mana 与 cooldown-start-after-return 文档化均已接受；**不是**正式 READY 门控 |
| v2 READY（非最终完成证据） | `run-11d562ed-9bb5-494c-8825-d8da61e6589a`（1682/1682；36/36；delta0）曾治理初始 Backend；被中止的 v2 Wasm test run 暴露聚合 README-lock 缺陷与过时 fixture plan——**不是**完成证据 |
| v3 REVISE | `run-f627e870-08fd-41a0-a148-c928c1be1d16`（2169/2169；52/52；delta0）；fixture truth/scope 校正均已接受；非正式 READY 门控 |
| Standalone / Dirty Fighting / absent-only mana / bonus AD | 独立 Q provider；保留 Dirty Fighting/basic；Q 不合成 ability-hit stacks；absent-only mana `ON CONFLICT DO NOTHING`；精确嵌套二元物理 `165+0.70*(ad.resolved-ad.base)`；type 20220 / add 20170；无 20230；无 Q-specific type；immediate 5000ms CD scaffold ≠ 真实返回后冷却 |
| 英雄名 `_test.go` | 机制级回归/治理证据 only；排除生产构建；无英雄专用生产分支；无生产 runtime/ABI 变更；不损害 generic runtime 实现主张 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=114；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=114；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 check/rebuild/check） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost；immediate selected-primary champion first-outbound-pass single physical hit scaffold；immediate 5000ms cooldown scaffold；一笔非暴击/不可复制物理命中 `165+0.70*(ad.resolved-ad.base)`（精确嵌套二元；type 20220 / add 20170；无 20230；无显式 event op；显式 bonus AD 减法）；CD/mana 探针（t0/t4999/t5000；mana79 resource skip）；自动 `ability_started`；standalone Q provider；保留 Dirty Fighting/basic；Q 不合成 ability-hit stacks；absent-only mana `ON CONFLICT DO NOTHING`；Built/独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast/effect-at-cast-end、direction/range/range extension/geometry、projectile/travel/speed/collision/return/homing、真实冷却在返回后开始、second return pass/total two-pass/once-per-pass、sight/reveal、movement speed/AP movement ratio/decay、nonchampion scaling、spellshield、Dirty Fighting ability-hit wiring、ranks1-4、siblings/loadout/bootstrap、live/E2E/full-game/full Avengerang/full-skill fidelity。本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q。immediate 5000ms CD scaffold **不是**真实返回后冷却的 faithful approximation。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Avengerang 保真。英雄名 `_test.go` 仅为测试/治理身份，排除于生产构建，**不**损害 generic runtime 实现。
