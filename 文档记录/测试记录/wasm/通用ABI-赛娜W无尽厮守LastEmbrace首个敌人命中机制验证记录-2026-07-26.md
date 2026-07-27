TASK_KEY: wasm-generic-senna-last-embrace-first-enemy-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 赛娜 W 无尽厮守 Last Embrace 首个敌人命中机制验证记录

详细设计：[通用 ABI - 赛娜 W 无尽厮守（Last Embrace）首个敌人命中机制详细设计](../../详细设计/wasm/通用ABI-赛娜W无尽厮守LastEmbrace首个敌人命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_senna|W|无尽厮守`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Senna/W`，解析 `Template:Data Senna/Last Embrace`；page `1409576` / rev `4009139` / timestamp `2026-04-15T21:34:10Z`；canonical raw bytes `1656`；SHA256 `48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/senna-w.json` bytes `2120` / SHA256 `c570469e807dcf9a0713af6bb0da3ab8d3be1bc61f192a307b59e7a10a5fdc8b` plus pages sibling bytes `685` / SHA256 `7f9ffc935d079acb610a07925eccb865b2baf7ecabe16784960d34e2341f41f4` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `1651` bytes，SHA256 `737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`（**无** completed salvage tag）。合同：Rank5 70 mana / 11000ms CD；immediate selected-primary-champion first-enemy single physical hit scaffold；恰好一笔非暴击/不可复制物理命中 `230 + 0.90 * (source.attr.ad.resolved - source.attr.ad.base)`（精确二元树；显式 bonus AD 减法；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动一次 `ability_started`；零 W state/modifier/listener/matcher/repeat/control/root/secondary-target；**无** W-specific type。交叉：base0/resolved0/armor0 → raw/final230；base60/resolved60/armor0 → raw/final230；base60/resolved160/armor0 → raw/final320；base60/resolved160/armor100 → raw320/final160；base60/resolved260/armor100 → raw410/final205；base0/resolved100 与 base60/resolved160 在 armor0 下均 raw/final320。mana210/baseAD60/resolvedAD160/HP1000/armor100 t0/t10999/t11000 → success/skip/success、两笔 W damage、final mana70/HP680、两次自动 W `ability_started`；mana69 resource skip / mana/HP 不变 / 无 W damage/event。Senna W provider **standalone**；仅挂载本 W；不合成 P/Q/E/R/basic；不合成 W state/modifier/listener/root/control/secondary-target；不合成 Batch-B 或 sibling Senna。Backend 无 repository-owned `hero_senna`/AD/mana materializer；seed/JUnit 仅 external-existing-data/check-only；不物化 identity/panel/resource；不 live-publish。**不**宣称 cast/Effect at cast time end/direction/range/width/line/projectile/collision/acquisition、attachment/death spread/delayed root/root duration/surrounding AOE/untargetable/spellshield/other ranks 或完整 Last Embrace/游戏保真；本闭环**恰好是一次选定主目标首个敌人物理命中**，**不是**完整 W；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: senna-w-last-embrace-first-enemy-hit-phase-a-v2`；有效 DESIGN_READY `run-96bfe31f-f482-4fef-b6a7-38566d52b85c`，strict model，runDelta0/diff0，1900/1900 parseable events / 39/39 complete tool groups，无 truncation/mutation；先前 v1 `run-0ebc4622-b66e-43b9-9d32-f5817c93451f` 返回 READY，但因未完成只读 grep 组无效为正式门控，非阻塞建议已接受进 v2 且该 run 无写入；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-96bfe31f-f482-4fef-b6a7-38566d52b85c` | READY；1900 events / 39/39 complete tool groups；runDelta0/diff0；无 truncation/mutation。v1 `run-0ebc4622…` 虽 READY 但无效为正式门控 | **接受门控**（仅 v2） |
| Backend owning | owning `c0c309015e36f66d0523c20715ce887a786b252f`；`run-713c4d15-a004-4996-8322-9c0028c5eea3` | runDelta3/outside0；主 focused68 / full954 PASS；seed SHA `0327787a…95efc7`；JUnit SHA `9bb02ffd…5d75ff`；README SHA `1ad375f7…8c55af` | 接受 |
| Backend 镜像 | `b90607b7ab31f5e1527354dccf5af853b6254dc4`；`run-c70b5ca7-f9cb-4efa-bf1d-6cbbae344466` | runDelta3/outside0；精确 parity | 接受 |
| Wasm exact | `ebf77309e1e76f9a38aaeab9166e6d214bbf3847`；`run-5ba15211-723b-4ced-9ea0-e29152afd34c` | runDelta1/outside0；focused/full/bench/build/smoke/benchmark PASS；test bytes62703 / SHA `4a449fc0…696051`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 | 接受 |
| Web | 无本机制写入 | Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` | 接受；无 Web 变更/拷贝 |
| 审计接受 | `24e2dd3c5261dcba84ad021c3c05aaaa01e590af`；`run-fa34263a-ac06-44b4-a852-3e80417bda88` | strict model；runDelta8/outside0；主五检查通过；语义比较仅 Senna W G8/Unified 变化；provisional 仅移除 Senna W | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Senna/W` → `Template:Data Senna/Last Embrace` / 1409576 / 4009139 / 2026-04-15T21:34:10Z / 1656 / `48698aa2…3c8492` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/senna-w.json`（2120 / `c570469e…5fdc8b`）plus pages sibling（685 / `7f9ffc93…1f41f4`）权威 |
| local raw caveat | 1651 bytes / SHA `737cc69b…090d5e`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Senna Last Embrace first enemy hit | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke | PASS |
| generic benchmark | PASS |
| exact commit | `ebf77309e1e76f9a38aaeab9166e6d214bbf3847` |
| test bytes / SHA | `62703` / SHA256 `4a449fc09248fe7842b909a373edd5353d4fb1eed8831b655f9146bcd5696051` |
| 实现 run | `run-5ba15211-723b-4ced-9ea0-e29152afd34c`；runDelta1/outside0 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused68 / full954）；owning `c0c309015e36f66d0523c20715ce887a786b252f`；run `run-713c4d15-a004-4996-8322-9c0028c5eea3`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed `0327787ad71b6bd75cc595565fa11bcccd5554e9942c9a8b198b0f6faf95efc7`；JUnit `9bb02ffd38f3b79d62ff4264d3a55cb5fa41a56bd0a0f2622bc2d5f0d35d75ff`；README `1ad375f745be26dffe0b56500d66d6e4f6718259468f970b7a243fb2d58c55af` |
| Backend 镜像 | PASS；`b90607b7ab31f5e1527354dccf5af853b6254dc4`；run `run-c70b5ca7-f9cb-4efa-bf1d-6cbbae344466`；runDelta3/outside0；精确 parity |
| seed 合同 | `db/game_manage/seeds/lol_generic_senna_last_embrace_first_enemy_hit_seed.sql` + `LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest`；一笔精确二元物理 20220/20170；无 20230；无显式 event；无 W-specific type；`hero_senna`/ad/mana external-existing-data/check-only；不物化 identity/panel/resource；standalone；无 sibling 合成；仅 W 挂载 |
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
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Senna W 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Senna W；先前 completed/migrated 记录锁定；稳定 digests 不变 |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap`；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 95 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 78 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 95 / partial 3 / none 156 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 85 / partial 4 / blocked 84 / OOS 69；inScope 173 |
| provisional | 81 = runtime78 / data3；hero79 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | 61 |
| 报告口径 | 严格 verified completion **95/254=37.4%**；completed + provisional implementation-description coverage **176/254=69.3%**；81 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `24e2dd3c5261dcba84ad021c3c05aaaa01e590af` |
| 审计接受 run | `run-fa34263a-ac06-44b4-a852-3e80417bda88`；strict model；runDelta8 / outside0；主五检查通过；语义比较证明仅 Senna W G8/Unified 变化；provisional 仅移除 Senna W |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-96bfe31f-f482-4fef-b6a7-38566d52b85c` |
| 无效 v1 门控 | `run-0ebc4622-b66e-43b9-9d32-f5817c93451f` 返回 READY，但因一个未完成只读 grep 组无效为正式门控；非阻塞建议已接受进 v2；该 run 无写入 |
| Standalone / check-only / bonus AD | 仅 W 挂载；不合成 P/Q/E/R/basic 或 W state/modifier/listener/root/control/secondary-target；external-existing-data/check-only `hero_senna`/ad/mana；精确二元物理 `230+0.90*(ad.resolved-ad.base)`；type 20220 / add 20170；无 20230；无 W-specific type |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=109；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=109；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate selected-primary-champion first-enemy single physical hit scaffold；一笔非暴击/不可复制物理命中 `230+0.90*(ad.resolved-ad.base)`（精确二元；type 20220 / add 20170；无 20230；无显式 event op；显式 bonus AD 减法）；CD/mana 探针（t0/t10999/t11000；mana69 resource skip）；自动 `ability_started`；standalone provider（仅 W 挂载）；Built/独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast/Effect at cast time end/direction/range/width/line/geometry/projectile/travel/collision/first-enemy acquisition、attachment 1s/target-death early spread/delayed root/root duration/primary or surrounding AOE、untargetable/spellshield、ranks1-4、other Senna abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live/E2E/full-game/full Last Embrace/full-skill fidelity。本闭环**恰好是一次选定主目标首个敌人物理命中**，**不是**完整 W。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Last Embrace 保真。
