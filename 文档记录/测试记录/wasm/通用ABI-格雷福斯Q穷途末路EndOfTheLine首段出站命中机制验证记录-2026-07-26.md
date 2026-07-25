TASK_KEY: wasm-generic-graves-end-of-the-line-first-outbound-pass
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 格雷福斯 Q 穷途末路 End of the Line 首段出站命中机制验证记录

详细设计：[通用 ABI - 格雷福斯 Q 穷途末路（End of the Line）首段出站命中机制详细设计](../../详细设计/wasm/通用ABI-格雷福斯Q穷途末路EndOfTheLine首段出站命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_graves|Q|穷途末路`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Graves/Q`，解析 `Template:Data Graves/End of the Line`；page `1307367` / rev `4007501` / timestamp `2026-04-11T22:23:57Z`；canonical raw bytes `2266`；SHA256 `c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/graves-q.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `2265` bytes，SHA256 `cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`（**无** completed salvage tag）。合同：Rank5 80 mana / 6000ms CD；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；恰好一笔非暴击/不可复制物理命中 `150 + 0.65 * (source.attr.ad.resolved - source.attr.ad.base)`（精确二元树；显式 bonus AD 减法；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动一次 `ability_started`；零 Q state/modifier/listener/matcher/repeat/control；**无** Q-specific type。交叉：base0/resolved0/armor0 → raw/final150；base60/resolved60/armor0 → raw/final150；base60/resolved160/armor0 → raw/final215；base60/resolved160/armor100 → raw215/final107.5；base60/resolved260/armor100 → raw280/final140；base0/resolved100 与 base60/resolved160 在 armor0 下均 raw/final215。mana240/baseAD60/resolvedAD160/HP1000/armor100 t0/t5999/t6000 → success/skip/success、两笔 Q damage、final mana80/HP785、两次自动 Q `ability_started`；mana79 resource skip / mana/HP 不变 / 无 Q damage/event。显式 Q/E isolation：Q **不**改变 True Grit；E **不**产生 Q 伤害；Q seed **不含** E rows。Graves Q provider **standalone**；不依赖 Graves P/E/W/R/True Grit/basic；不合成 Batch-B 或 sibling Graves。Backend 无 repository-owned `hero_graves`/AD/mana materializer；seed/JUnit 仅 external-existing-data/check-only；不物化 identity/panel/resource；不 live-publish。**不**宣称 cast/direction/range/width/line/projectile/pass-through/multitarget/trail/terrain/collision、delayed2s 或 terrain0.2s detonation/perpendicular/reverse wave/second pass/total、once-per-pass/spellshield/Wind Wall/Braum terrain/other ranks 或完整 End of the Line/游戏保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: graves-q-end-of-the-line-first-outbound-pass-phase-a-v2`；有效 DESIGN_READY `run-03dd4514-ca50-414f-adbc-a97b126ea974`，strict model，runDelta0/diff0，2178/2178 parseable events / 59/59 complete tool groups，无 truncation/mutation；先前 v1 `run-957c034a-14a9-4649-8af3-52c39c4cc116` 返回 REVISE，但因未完成只读 grep 组无效为正式门控，路径校正已接受进 v2 且该 run 无写入；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-03dd4514-ca50-414f-adbc-a97b126ea974` | READY；2178 events / 59/59 complete tool groups；runDelta0/diff0；无 truncation/mutation。v1 `run-957c034a…` 无效为正式门控 | **接受门控**（仅 v2） |
| Backend owning | owning `9294292d38a614f61bb73062224aabbc756d28a5`；`run-bc2c80e8-3cad-445b-bff0-94d104147631` | runDelta3/outside0；主 focused50 / full943 PASS；seed SHA `e17d4739…f88ca0`；JUnit SHA `16cafe13…6b00ac`；README SHA `e7dddfcd…0296a6` | 接受 |
| Backend 镜像 | `a54cf6f6671daf4039d6eccfe18aab4d9327c15f`；`run-43d31e5d-0bf4-408f-a345-873e4cb25b34` | runDelta3/outside0；精确 parity | 接受 |
| Wasm exact | `c16107ec4420113d9a31d78c11f7f91182d662cf`；`run-d574c128-ca46-4fcb-9581-98b438cd983e` | runDelta1/outside0；focused7/full/bench/build/smoke/benchmark PASS；test bytes66870 / SHA `a95e0d96…8c8e77`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 | 接受 |
| Web | 无本机制写入 | Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` | 接受；无 Web 变更/拷贝 |
| 审计接受 | `4585926af29144eae6c0b40b710757da188f7565`；`run-8dbc58fd-cee2-423b-95f5-0d66016e6cf6` | strict model；runDelta8/outside0；主五检查通过；语义比较仅 Graves Q G8/Unified 变化；provisional 仅移除 Graves Q | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Graves/Q` → `Template:Data Graves/End of the Line` / 1307367 / 4007501 / 2026-04-11T22:23:57Z / 2266 / `c1884000…41345c5` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/graves-q.json` plus pages sibling 权威 |
| local raw caveat | 2265 bytes / SHA `cd2744fb…df0377`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Graves End of the Line first outbound pass | PASS（focused7） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke | PASS |
| generic benchmark | PASS |
| exact commit | `c16107ec4420113d9a31d78c11f7f91182d662cf` |
| test bytes / SHA | `66870` / SHA256 `a95e0d9632b0fe45aaec9440ccd89c381d6903f2c99ab761581736ec1f8c8e77` |
| 实现 run | `run-d574c128-ca46-4fcb-9581-98b438cd983e`；runDelta1/outside0 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused50 / full943）；owning `9294292d38a614f61bb73062224aabbc756d28a5`；run `run-bc2c80e8-3cad-445b-bff0-94d104147631`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed `e17d4739f2d98d213c3a5ff3e6ab3943f9e2e474f882e03bccca01492af88ca0`；JUnit `16cafe131d75221eb916e96619c14d3ae630d1ba8debb485b75ab9a61a6b00ac`；README `e7dddfcdf14b9c481d4a7217df2e7fbf49adcf0e77e81031c57f3871e00296a6` |
| Backend 镜像 | PASS；`a54cf6f6671daf4039d6eccfe18aab4d9327c15f`；run `run-43d31e5d-0bf4-408f-a345-873e4cb25b34`；runDelta3/outside0；精确 parity |
| seed 合同 | `db/game_manage/seeds/lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql` + `LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest`；一笔精确二元物理 20220/20170；无 20230；无显式 event；无 Q-specific type；`hero_graves`/ad/mana external-existing-data/check-only；不物化 identity/panel/resource；standalone；无 sibling 合成；Q seed 无 E rows |
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
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Graves Q 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Graves Q；先前 completed/migrated 记录锁定；稳定 digests 不变 |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap`；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 94 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 79 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 94 / partial 3 / none 157 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 84 / partial 4 / blocked 85 / OOS 69；inScope 173 |
| provisional | 82 = runtime79 / data3；hero80 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | 62 |
| 报告口径 | 严格 verified completion **94/254=37.0%**；completed + provisional implementation-description coverage **176/254=69.3%**；82 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `4585926af29144eae6c0b40b710757da188f7565` |
| 审计接受 run | `run-8dbc58fd-cee2-423b-95f5-0d66016e6cf6`；strict model；runDelta8 / outside0；主五检查通过；语义比较证明仅 Graves Q G8/Unified 变化；provisional 仅移除 Graves Q |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-03dd4514-ca50-414f-adbc-a97b126ea974` |
| 无效 v1 门控 | `run-957c034a-14a9-4649-8af3-52c39c4cc116` 返回 REVISE，但因一个未完成只读 grep 组无效为正式门控；路径校正已接受进 v2；该 run 无写入 |
| Standalone / check-only / bonus AD / Q/E isolation | 不合成 Batch-B/sibling；external-existing-data/check-only `hero_graves`/ad/mana；精确二元物理 `150+0.65*(ad.resolved-ad.base)`；type 20220 / add 20170；无 20230；无 Q-specific type；Q 不改变 True Grit；E 无 Q damage；Q seed 无 E rows |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=108；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=108；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；一笔非暴击/不可复制物理命中 `150+0.65*(ad.resolved-ad.base)`（精确二元；type 20220 / add 20170；无 20230；无显式 event op；显式 bonus AD 减法）；CD/mana 探针（t0/t5999/t6000；mana79 resource skip）；自动 `ability_started`；显式 Q/E isolation；standalone provider；Built/独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast/direction/range/width/line/geometry/projectile/travel/pass-through/multitarget/powder trail/terrain/collision、delayed 2s 或 terrain 0.2s detonation、perpendicular area/reverse wave/second pass/total damage、once-per-pass/spellshield/Wind Wall/Braum terrain、ranks1-4、other Graves abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live/E2E/full-game/full End of the Line/full-skill fidelity。本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 End of the Line 保真。
