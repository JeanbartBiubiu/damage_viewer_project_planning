TASK_KEY: wasm-generic-corki-phosphorus-bomb-primary-impact
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 库奇 Q 磷光炸弹 Phosphorus Bomb 主目标命中机制验证记录

详细设计：[通用 ABI - 库奇 Q 磷光炸弹（Phosphorus Bomb）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-库奇Q磷光炸弹PhosphorusBomb主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_corki|Q|磷光炸弹`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Corki/Q`，解析 `Template:Data Corki/Phosphorus Bomb`；page `1306953` / rev `4007588` / timestamp `2026-04-12T06:50:59Z`；canonical raw bytes `1531`；SHA256 `e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/corki-q.json` bytes `2148` / SHA256 `3c4584b2e8442e7ff2ae1d2d4c4d8dff4613efa98bf7ba4cd3ab44ef05c8572d` plus pages sibling bytes `691` / SHA256 `bff7e3533e2bba561c03e91da5d7c07ffc095e07a0669b321cc7fd480d18f42a` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `1529` bytes，SHA256 `c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（**无** salvage / `meta_or_non_target_dps` governed tags；raw upstream 历史字段仅 provenance）。合同：Rank5 80 mana / 7000ms CD；immediate selected-primary-champion single magic impact hit scaffold；恰好一笔非暴击/不可复制魔法命中 `240 + 1.25 * (source.attr.ad.resolved - source.attr.ad.base) + 1.00 * source.attr.ap.resolved`（精确嵌套二元树；**bonus AD 显式减法**；不得按 total-AD 直读；伤害类型 **20221** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动一次 `ability_started`；零 Q state/modifier/listener/matcher/repeat/control/projectile/explosion；**无** Q-specific type。交叉：base60/resolved60/AP0/MR0 → raw/final240；base60/resolved160/AP0/MR0 → raw/final365；base60/resolved60/AP100/MR0 → raw/final340；base60/resolved160/AP100/MR0 → raw/final465；base60/resolved156/AP100/MR100 → raw460/final230；base60/resolved220/AP100/MR100 → raw540/final270；base0/resolved100 与 base60/resolved160 在 AP0/MR0 下均 raw/final365。mana240/baseAD60/resolvedAD156/AP100/HP1000/MR100 t0/t6999/t7000 → success/skip/success、两笔 Q damage、final mana80/HP540、两次自动 Q `ability_started`；mana79 resource skip / mana/HP 不变 / 无 Q damage/event。Corki Q provider **standalone**；不合成 P/W/E/R/basic；不合成 Batch-B 或 sibling Corki。Backend 无 repository-owned `hero_corki`/AD/AP/mana materializer；seed/JUnit 仅 external-existing-data/check-only；不物化 identity/panel/resource；不 live-publish。**不**宣称 cast/location/range/radius/geometry/projectile/travel/minimum-time/explosion/AOE/multitarget/collision/acquisition/spellshield/sight/reveal/duration/other ranks 或完整 Phosphorus Bomb/游戏保真；本闭环**恰好是一次选定主目标魔法命中**，**不是**完整 Q；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: corki-q-phosphorus-bomb-primary-impact-phase-a-v1`；有效 DESIGN_READY `run-aa057cdf-e66c-473f-b3ac-919150ad1b38`，strict model，runDelta0，2062/2062 parseable events / 52/52 complete tool groups，无 truncation/mutation；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。英雄名 `_test.go` 仅为机制级回归/治理证据，排除于 normal/TinyGo 生产构建；**无**生产 runtime/ABI 实现变更。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-aa057cdf-e66c-473f-b3ac-919150ad1b38` | READY；2062 events / 52/52 complete tool groups；runDelta0；无 truncation/mutation | **接受门控** |
| Backend owning | owning `6003a7e1aeb083a937c880d4486bac974ab329bc`；`run-14d830d3-62f9-46fa-80a4-f94b6b41ecb8` | runDelta3/outside0；主 focused75 / full975 PASS；seed bytes29669 / SHA `fa1ac487…00ecdd3`；JUnit bytes56626 / SHA `16f0170e…cd5752`；README bytes269588 / SHA `538f73d1…0ae66f` | 接受 |
| Backend 镜像 | `b352677b63929c25f83df3a52c51cba0fd379f65`；`run-3356a0a5-a77b-4c09-903c-1d4104577015` | runDelta3/outside0；精确 parity | 接受 |
| Wasm exact | `b381b1e5a9d99fb73ca9a6b9098c2a39c5cbc546`；`run-07f7d8a7-0952-4c33-9877-335686845175` | runDelta1/outside0；focused/full/bench/build/smoke/benchmark PASS；最终 test bytes65821 / SHA `58f47763…a68a09`；独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据 | 接受 |
| Web | 无本机制写入 | 独立 Web worktree `1,169,377` / `65a4…c6a0`；Cursor 误比内嵌陈旧 `web/`（`1,101,630` / SHA `2ce1…`）mismatch 已澄清为错误比路径 caveat | 接受；无 Web 变更/拷贝 |
| 审计接受 | `6a0c450e7057de1c25a9eb066f666852d357f666`；`run-a5165548-52e8-4863-8be8-577b567ec07f` | strict model；runDelta8/outside0；主五检查通过；语义比较仅 Corki Q G8/Unified 变化；provisional 仅移除 Corki Q；`178/254=70.1%` 算术已驳回；正确 `(97+79)/254=69.3%` | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Corki/Q` → `Template:Data Corki/Phosphorus Bomb` / 1306953 / 4007588 / 2026-04-12T06:50:59Z / 1531 / `e71a474e…760365` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/corki-q.json`（2148 / `3c4584b2…c8572d`）plus pages sibling（691 / `bff7e353…18f42a`）权威 |
| local raw caveat | 1529 bytes / SHA `c39556a0…948ba6`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Corki Phosphorus Bomb primary impact | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke | PASS |
| generic benchmark | PASS |
| exact commit | `b381b1e5a9d99fb73ca9a6b9098c2a39c5cbc546` |
| test bytes / SHA（最终） | `65821` / SHA256 `58f477631d1b7580e22b5d187c3aa96bae4fffa785f576a3abb5bf84c8a68a09` |
| 实现 run | `run-07f7d8a7-0952-4c33-9877-335686845175`；runDelta1/outside0 |
| 英雄名 `_test.go` 地位 | 机制级回归/治理证据 only；排除于 normal/TinyGo 生产构建；**无**生产 runtime/ABI 变更 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused75 / full975）；owning `6003a7e1aeb083a937c880d4486bac974ab329bc`；run `run-14d830d3-62f9-46fa-80a4-f94b6b41ecb8`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed bytes29669 / `fa1ac4873824073c354b80fd5dc6c18055c82c23ae336c4a214259dba00ecdd3`；JUnit bytes56626 / `16f0170eb37a0e9545eed9ece169a30d81c90cda1e4b92245986ee9404cd5752`；README bytes269588 / `538f73d1ab9e63056fae2b4dac146e2b60628bcd46995ff99f9ff36e7f0ae66f` |
| Backend 镜像 | PASS；`b352677b63929c25f83df3a52c51cba0fd379f65`；run `run-3356a0a5-a77b-4c09-903c-1d4104577015`；runDelta3/outside0；精确 parity |
| seed 合同 | `db/game_manage/seeds/lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql` + `LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest`；一笔精确嵌套二元魔法 20221/20170；无 20230；无显式 event；无 Q-specific type；`hero_corki`/ad/ap/mana external-existing-data/check-only；不物化 identity/panel/resource；standalone；无 sibling 合成 |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit / 拷贝 | **无** |
| 当前独立 Web worktree 资产 | **1,169,377** / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`（与标准 Wasm build 精确一致） |
| 内嵌 `web/` mismatch caveat | Cursor 曾误比 Wasm worktree 内嵌陈旧副本 `1,101,630` / SHA `2ce1…` 并报告 mismatch；主会话核实独立 `C:\project\damage_web_dev` 精确 parity；**不是**独立 Web 失败 |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本机制级回归证据追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Corki Q 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Corki Q；先前 completed/migrated 记录锁定；稳定 digests 不变 |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 五 tags（序同上；无 salvage/`meta_or_non_target_dps` governed）；空 `remainingGap`；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 97 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 76 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 97 / partial 3 / none 154 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 87 / partial 4 / blocked 82 / OOS 69；inScope 173 |
| provisional | 79 = runtime76 / data3；hero77 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | 59 |
| 报告口径 | 严格 verified completion **97/254=38.2%**；completed + provisional implementation-description coverage **176/254=69.3%**；79 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张；审计助手 `178/254=70.1%` **已驳回** |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `6a0c450e7057de1c25a9eb066f666852d357f666` |
| 审计接受 run | `run-a5165548-52e8-4863-8be8-577b567ec07f`；strict model；runDelta8 / outside0；主五检查通过；语义比较证明仅 Corki Q G8/Unified 变化；provisional 仅移除 Corki Q；五 checks/semantic only Corki Q |
| 算术纠错 | 审计助手 `178/254=70.1%` 驳回；正确 `(97+79)/254=176/254=69.3%` |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控与证据地位笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-aa057cdf-e66c-473f-b3ac-919150ad1b38` |
| Standalone / check-only / bonus AD + AP | 不合成 P/W/E/R/basic；external-existing-data/check-only `hero_corki`/ad/ap/mana；精确嵌套二元魔法 `240+1.25*(ad.resolved-ad.base)+1.00*ap.resolved`；type 20221 / add 20170；无 20230；无 Q-specific type；禁止 salvage/`meta_or_non_target_dps` governed |
| 英雄名 `_test.go` | 机制级回归/治理证据 only；排除生产构建；无生产 runtime/ABI 变更 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=111；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=111；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 rebuild） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate selected-primary-champion single magic impact hit scaffold；一笔非暴击/不可复制魔法命中 `240+1.25*(ad.resolved-ad.base)+1.00*ap.resolved`（精确嵌套二元；type 20221 / add 20170；无 20230；无显式 event op；bonus AD 显式减法 + AP）；CD/mana 探针（t0/t6999/t7000；mana79 resource skip）；自动 `ability_started`；standalone provider；独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast time/location targeting/range/radius/geometry、projectile travel/minimum travel time/explosion、AOE/multitarget/surrounding、travel/impact-area sight/enemy-champion reveal/six-second duration、spellshield/collision/acquisition、ranks1-4、other Corki abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live/E2E/full-game/full Phosphorus Bomb/full-skill fidelity。本闭环**恰好是一次选定主目标魔法命中**，**不是**完整 Q。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Phosphorus Bomb 保真。
