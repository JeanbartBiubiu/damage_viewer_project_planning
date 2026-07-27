TASK_KEY: wasm-generic-senna-dawning-shadow-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 赛娜 R 暗影燎原 Dawning Shadow 主目标命中机制验证记录

详细设计：[通用 ABI - 赛娜 R 暗影燎原（Dawning Shadow）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-赛娜R暗影燎原DawningShadow主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_senna|R|暗影燎原`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Senna/R`，解析 `Template:Data Senna/Dawning Shadow`；page `1409580` / rev `4008033` / timestamp `2026-04-13T04:08:13Z`；canonical raw bytes `2356`；SHA256 `4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/senna-r.json` bytes `2597` / SHA256 `79ced482a8489f211cacba8cedd4fe0f02a87f0360c5bf95d824c1d735f66307` plus pages sibling bytes `689` / SHA256 `9b7fcb0a8e28dbbe38b6e890966421a6857772c2029315225e59bd041f9e704e` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `2353` bytes，SHA256 `1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（**无** completed salvage tag）。合同：Rank3 100 mana / 100000ms CD；immediate selected-primary enemy champion single physical hit scaffold；恰好一笔非暴击/不可复制物理命中 `550 + 1.15 * (source.attr.ad.resolved - source.attr.ad.base) + 0.70 * source.attr.ap.resolved`（精确嵌套二元树；**bonus AD 显式减法**；不得按 total-AD 直读；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动一次 `ability_started`；零 R state/modifier/listener/matcher/repeat/control/projectile/wave；**无** R-specific type。交叉：base60/resolved60/AP0/armor0 → raw/final550；base60/resolved160/AP0/armor0 → raw/final665；base60/resolved60/AP100/armor0 → raw/final620；base60/resolved160/AP100/armor0 → raw/final735；base60/resolved140/AP100/armor100 → raw712/final356；base60/resolved220/AP100/armor100 → raw804/final402；base0/resolved100 与 base60/resolved160 在 AP0/armor0 下均 raw/final665。mana300/baseAD60/resolvedAD140/AP100/armor100/HP1000 t0/t99999/t100000 → success/skip/success、两笔 R damage、final mana100/HP288、两次自动 R `ability_started`；mana99 resource skip / mana/HP 不变 / 无 R damage/event。Senna R provider **standalone**；**保留**既有 Senna W；**显式证明** R/W isolation；不合成 P/Q/E/basic/loadout/bootstrap 或 siblings。Backend 无 repository-owned `hero_senna`/AD/AP/mana materializer；seed/JUnit 仅 external-existing-data/check-only；不物化 identity/panel/resource；不 live-publish。**不**宣称 cast time 1s/effect-at-cast-time-start/queue time 0.5s、global/direction/wave/geometry/projectile/travel/AOE/reveal/shield/Mist/spellshield/other ranks 或完整 Dawning Shadow/游戏保真；本闭环**恰好是一次选定主目标敌方英雄物理命中**，**不是**完整 R；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: senna-r-dawning-shadow-primary-hit-phase-a-v3`；有效 DESIGN_READY `run-d6961d41-4530-4298-be06-3b38a88da864`，strict top-level model，runDelta0，1175/1175 parseable events / 59/59 complete tool groups，无 truncation/mutation；先前 v1/v2 虽技术上 READY，但各因一个非终态 tool group 无效为正式门控，**不得**引为有效门控；运行时/审计已提交）填写。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。英雄名 `_test.go` 仅为机制级回归/治理证据，排除于 normal/TinyGo 生产构建；**无**生产 runtime/ABI 实现变更。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-d6961d41-4530-4298-be06-3b38a88da864` | READY；1175 events / 59/59 complete tool groups；runDelta0；无 truncation/mutation。v1/v2 虽 READY 但各因一个非终态 tool group 无效为正式门控 | **接受门控**（仅 v3） |
| Backend owning | owning `b774a8dd3db8d686ac602c052e613639726603c2`；`run-bd288908-9bda-4622-a899-fdccefc01842` | runDelta3/outside0；主 focused71 / full987 PASS；seed bytes30279 / SHA `ecec375b…01867bc`；JUnit bytes57319 / SHA `8854b329…29ad71c`；README bytes277142 / SHA `aa5360f5…f6b5b2` | 接受 |
| Backend 镜像 | `431692307cfdf6ce08d39b972b1c36686df16264`；`run-027e2f56-782d-4fbd-b339-93d197fdbc35` | runDelta3/outside0；精确 parity | 接受 |
| Wasm exact | `a8e4c0894b2ca9b077bce83ff3e925c74a6d903f`；`run-04b39596-8f35-4a43-a52c-1c10b4d2c2ef` | runDelta1/outside0；focused/full/build/smoke/bench PASS；test bytes73643 / SHA `a42359e9…f39fa9`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据 | 接受 |
| Web | 无本机制写入 | Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` | 接受；无 Web 变更/拷贝 |
| 审计接受 | `eb6fd9f99a0981f215c9eacf07f20667d89705dc`；`run-9c552457-7f3d-44a7-b24f-7429563c2337` | strict model；runDelta8/outside0；主五检查通过；语义比较仅 Senna R G8/Unified 变化；provisional 仅移除 Senna R | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Senna/R` → `Template:Data Senna/Dawning Shadow` / 1409580 / 4008033 / 2026-04-13T04:08:13Z / 2356 / `4de188cc…c9de36` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/senna-r.json`（2597 / `79ced482…f66307`）plus pages sibling（689 / `9b7fcb0a…f9e704e`）权威 |
| local raw caveat | 2353 bytes / SHA `1b448ff4…3195dc`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Senna Dawning Shadow primary hit | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `a8e4c0894b2ca9b077bce83ff3e925c74a6d903f` |
| test bytes / SHA | `73643` / SHA256 `a42359e98452dfd3d1429fc12f8735daefd77b0da2269ba7b345200b9ff39fa9` |
| 实现 run | `run-04b39596-8f35-4a43-a52c-1c10b4d2c2ef`；runDelta1/outside0 |
| 英雄名 `_test.go` 地位 | 机制级回归/治理证据 only；排除于 normal/TinyGo 生产构建；**无**生产 runtime/ABI 变更 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused71 / full987）；owning `b774a8dd3db8d686ac602c052e613639726603c2`；run `run-bd288908-9bda-4622-a899-fdccefc01842`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed bytes30279 / `ecec375b39b28326b511dcd691184a18a9e1399c30e7951930d0e55a801867bc`；JUnit bytes57319 / `8854b329513b8d11063140204c7c6d7c7443e12a358d552d957e1dd8729ad71c`；README bytes277142 / `aa5360f567a54537e58aa380e95dc26a8c450373ca7a8f8846a798afe3f6b5b2` |
| Backend 镜像 | PASS；`431692307cfdf6ce08d39b972b1c36686df16264`；run `run-027e2f56-782d-4fbd-b339-93d197fdbc35`；runDelta3/outside0；精确 parity |
| seed 合同 | `db/game_manage/seeds/lol_generic_senna_dawning_shadow_primary_hit_seed.sql` + `LolGenericSennaDawningShadowPrimaryHitSeedSqlTest`；一笔精确嵌套二元物理 20220/20170；无 20230；无显式 event；无 R-specific type；`hero_senna`/ad/ap/mana external-existing-data/check-only；不物化 identity/panel/resource；standalone；保留既有 W；显式 R/W isolation；不合成 P/Q/E/basic/siblings |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit / 拷贝 | **无** |
| 当前 Built / 独立 Web worktree 资产 | **1,169,377** / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`（与标准 Wasm build 精确一致） |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本机制级回归证据追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Senna R 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Senna R；先前 completed/migrated 记录锁定；稳定 digests 不变（Unified `69832c2a…c018`；Wiki registry `927d8b5a…26c7`） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 五 tags（序同上）；空 `remainingGap`；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 98 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 75 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 98 / partial 3 / none 153 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 88 / partial 4 / blocked 81 / OOS 69；inScope 173 |
| provisional | 78 = runtime75 / data3；hero76 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | 58 |
| 报告口径 | 严格 verified completion **98/254=38.6%**；completed + provisional implementation-description coverage **176/254=69.3%**；78 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `eb6fd9f99a0981f215c9eacf07f20667d89705dc` |
| 审计接受 run | `run-9c552457-7f3d-44a7-b24f-7429563c2337`；strict model；runDelta8 / outside0；主五检查通过；语义比较证明仅 Senna R G8/Unified 变化；provisional 仅移除 Senna R |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控与证据地位笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-d6961d41-4530-4298-be06-3b38a88da864` |
| 无效 v1/v2 门控 | 先前 v1/v2 虽技术上返回 READY，但各因一个非终态 tool group 无效为正式门控；**不得**引为有效门控 |
| Standalone / R-W isolation / check-only / bonus AD + AP | 独立 R provider；保留既有 W；显式 R/W isolation；不合成 P/Q/E/basic；external-existing-data/check-only `hero_senna`/ad/ap/mana；精确嵌套二元物理 `550+1.15*(ad.resolved-ad.base)+0.70*ap.resolved`；type 20220 / add 20170；无 20230；无 R-specific type |
| 英雄名 `_test.go` | 机制级回归/治理证据 only；排除生产构建；无生产 runtime/ABI 变更 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=112；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=112；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 rebuild） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-3 active cost/cooldown；immediate selected-primary enemy champion single physical hit scaffold；一笔非暴击/不可复制物理命中 `550+1.15*(ad.resolved-ad.base)+0.70*ap.resolved`（精确嵌套二元；type 20220 / add 20170；无 20230；无显式 event op；bonus AD 显式减法 + AP）；CD/mana 探针（t0/t99999/t100000；mana99 resource skip）；自动 `ability_started`；standalone provider；保留既有 Senna W；显式 R/W isolation；Built/独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast time 1s/effect-at-cast-time-start/queue time 0.5s、global targeting/direction/broad or narrow wave geometry/width、projectile/travel/speed/destruction、AOE/multitarget、enemy reveal/self reveal/allied or self shield、Mist scaling/Mist Wraith hits/path sight、spellshield、ranks1-2、other Senna abilities/passives（除保留既有 W 并证明 isolation）/siblings/loadout/bootstrap、equipment/crit/on-hit、live/E2E/full-game/full Dawning Shadow/full-skill fidelity。本闭环**恰好是一次选定主目标敌方英雄物理命中**，**不是**完整 R。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Dawning Shadow 保真。
