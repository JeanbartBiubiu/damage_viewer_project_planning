TASK_KEY: wasm-generic-ezreal-mystic-shot-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 伊泽瑞尔 Q 秘术射击 Mystic Shot 主目标命中机制验证记录

详细设计：[通用 ABI - 伊泽瑞尔 Q 秘术射击（Mystic Shot）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-伊泽瑞尔Q秘术射击MysticShot主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_ezreal|Q|秘术射击`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Ezreal/Q`，解析 `Template:Data Ezreal/Mystic Shot`；page `1307107` / rev `4013233` / timestamp `2026-04-28T21:19:30Z`；canonical raw bytes `2054`；SHA256 `be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-q.json` bytes `2527` / SHA256 `b7e8639d6fd82df4c66c4f883078b54274b4a1708fdca6bf2703d70a0518ab47` plus pages sibling bytes `692` / SHA256 `f5f133eef00f3dd4cdc95c0513d3371851b71d890a61b9e8de93716ccd107060` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `2052` bytes，SHA256 `d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`ap_ratio`、`immediate_impact_scaffold`（**无** `total_ad_ratio`；**无** stale `cooldown_or_haste_without_rotation`；**无** salvage/meta tag）。合同：Rank5 40 mana / 4500ms CD；immediate selected-primary enemy champion single physical hit scaffold；恰好一笔非暴击/不可复制物理命中 `120 + 1.30 * source.attr.ad.resolved + 0.40 * source.attr.ap.resolved`（精确嵌套二元树；**total AD 直接读取**；**不得**减 base AD；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op；**无** Q-specific type）；成功施放自动一次 `ability_started`；成功命中保留 Rising Spell Force 一层；零 Q state/modifier/listener。交叉 raw/final：198/99、328/164、238/119、368/184；base 反证两路径均 328/164。mana120 t0/t4499/t4500 → success/skip/success、两笔 Q damage、两次自动 Q `ability_started`、final mana40/HP632；mana39 resource skip。P 共存：一层 stack AS1.0→1.1，随后 cooldown skip 无变化。Ezreal Q provider **standalone**；**保留**既有 P/E/R；Backend `hero_ezreal`/ad/ap/mana **external-existing-data/check-only**；不物化 identity/panel/resource；不 live-publish。**不**宣称 direction/range/cast timing、projectile/travel/collision/first-enemy acquisition/on-hit/CD reduction/dual tags/lifesteal/spellshield/other ranks 或完整 Mystic Shot/游戏保真；本闭环**恰好是一次选定主目标敌方英雄物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: ezreal-q-mystic-shot-primary-hit-phase-a-v2`；有效 DESIGN_READY `run-619e5122-3fae-49bc-b291-054a6ac63836`，1639/1639 parseable events / 45/45 complete tool groups，runDelta0，无 truncation/mutation，user decision none；先前 v1 `run-aeadbd2b-d92f-40ac-824f-86730635f0ad` 为 valid REVISE（2072/2072；36/36；delta0；`total_ad` tag 与 impl-gap-family 校正均已接受），非正式 READY 门控；运行时/审计已提交）填写。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。英雄名 `_test.go` 仅为机制级回归/治理证据，排除于 normal/TinyGo 生产构建；**无**生产 runtime/ABI 实现变更。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-619e5122-3fae-49bc-b291-054a6ac63836` | READY；1639 events / 45/45 complete tool groups；runDelta0；无 truncation/mutation；user decision none。v1 valid REVISE 校正已接受，非正式 READY 门控 | **接受门控**（仅 v2） |
| Backend owning | owning `41fce6a3c0585ab7c425ebdfb251e7775c83ad37`；`run-679d546c-1e89-40e1-b085-f259a8ba528b` | runDelta3/outside0；主 focused11 / full998 PASS；seed bytes29100 / SHA `13e78f71…b265574`；JUnit bytes58894 / SHA `17025b15…550dc3e`；README bytes284316 / SHA `7d442658…b63aa3f` | 接受 |
| Backend 镜像 | `ae66c5644357d36c96a0a6e84bc30906935b92ed`；`run-e67ff0d6-acf7-49c9-a73a-c502cc3028cd` | runDelta3/outside0；精确 parity | 接受 |
| Wasm exact | `000e253f5a6d744f7209d9ebd417ea1d91684bbb`；`run-0d56a32e-d0f3-43fa-8574-10311a72810d` | runDelta1/outside0；focused/count=100/full/build/smoke/bench PASS；test bytes68455 / SHA `6e8ceb79…0196032`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据 | 接受 |
| Web | 无本机制写入 | Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` | 接受；无 Web 变更/拷贝 |
| 审计接受 | `b3cbd6bdd7d9fba472994659495d884e74c14774`；`run-4272960b-8e68-4893-aa9b-38f443cb1a82` | runDelta8/outside0；主五检查通过；语义比较仅 Ezreal Q G8/Unified 变化；provisional 仅移除 Ezreal Q | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Ezreal/Q` → `Template:Data Ezreal/Mystic Shot` / 1307107 / 4013233 / 2026-04-28T21:19:30Z / 2054 / `be5a2486…4b533` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-q.json`（2527 / `b7e8639d…18ab47`）plus pages sibling（692 / `f5f133ee…107060`）权威 |
| local raw caveat | 2052 bytes / SHA `d8348b3b…b05dbd`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Ezreal Mystic Shot primary hit / `-count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `000e253f5a6d744f7209d9ebd417ea1d91684bbb` |
| test bytes / SHA | `68455` / SHA256 `6e8ceb7929feda298a91cfcdf51a51db60b665d8ae029813ec07f6ae90196032` |
| 实现 run | `run-0d56a32e-d0f3-43fa-8574-10311a72810d`；runDelta1/outside0 |
| 英雄名 `_test.go` 地位 | 机制级回归/治理证据 only；排除于 normal/TinyGo 生产构建；**无**生产 runtime/ABI 变更 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused11 / full998）；owning `41fce6a3c0585ab7c425ebdfb251e7775c83ad37`；run `run-679d546c-1e89-40e1-b085-f259a8ba528b`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed bytes29100 / `13e78f715b0320a79c9a57c02bfa64fa72dd05aff0de2e8b2d5f4eb74b265574`；JUnit bytes58894 / `17025b1541d9775c5133f38f82bd8e0d87d36a126112349197dfc4cbf550dc3e`；README bytes284316 / `7d442658db53672367d75659518cd965e981b939d6cda96fc428bc9afb63aa3f` |
| Backend 镜像 | PASS；`ae66c5644357d36c96a0a6e84bc30906935b92ed`；run `run-e67ff0d6-acf7-49c9-a73a-c502cc3028cd`；runDelta3/outside0；精确 parity |
| seed 合同 | `db/game_manage/seeds/lol_generic_ezreal_mystic_shot_primary_hit_seed.sql` + `LolGenericEzrealMysticShotPrimaryHitSeedSqlTest`；一笔精确嵌套二元物理 20220/20170；total AD 直读；无 20230；无显式 event；无 Q-specific type；成功命中保留 Rising Spell Force 一层；`hero_ezreal`/ad/ap/mana external-existing-data/check-only；不物化 identity/panel/resource；standalone Q；保留既有 P/E/R |
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
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Ezreal Q 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Ezreal Q；先前 completed/migrated 记录锁定；稳定 digests 不变（Unified `69832c2a…c018`；Wiki registry `927d8b5a…26c7`） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上；**无** `total_ad_ratio`/stale haste/salvage）；空 `remainingGap`；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 99 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 74 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 99 / partial 3 / none 152 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 89 / partial 4 / blocked 80 / OOS 69；inScope 173 |
| provisional | 77 = runtime74 / data3；hero75 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | **仍为 58**（Ezreal Q **不在**该家族） |
| 报告口径 | 严格 verified completion **99/254=39.0%**；completed + provisional implementation-description coverage **176/254=69.3%**；77 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `b3cbd6bdd7d9fba472994659495d884e74c14774` |
| 审计接受 run | `run-4272960b-8e68-4893-aa9b-38f443cb1a82`；runDelta8 / outside0；主五检查通过；语义比较证明仅 Ezreal Q G8/Unified 变化；provisional 仅移除 Ezreal Q |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控与证据地位笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-619e5122-3fae-49bc-b291-054a6ac63836` |
| v1 valid REVISE | `run-aeadbd2b-d92f-40ac-824f-86730635f0ad`（2072/2072；36/36；delta0）；`total_ad` tag 与 impl-gap-family 校正均已接受；**不是**正式 READY 门控 |
| Standalone / P 共存 / check-only / total AD + AP | 独立 Q provider；保留既有 P/E/R；P 共存一层 Rising Spell Force；external-existing-data/check-only `hero_ezreal`/ad/ap/mana；精确嵌套二元物理 `120+1.30*ad.resolved+0.40*ap.resolved`（total AD 直读）；type 20220 / add 20170；无 20230；无 Q-specific type；禁止 `total_ad_ratio`/stale haste/salvage governed tags |
| 英雄名 `_test.go` | 机制级回归/治理证据 only；排除生产构建；无生产 runtime/ABI 变更 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=113；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=113；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 rebuild） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate selected-primary enemy champion single physical hit scaffold；一笔非暴击/不可复制物理命中 `120+1.30*ad.resolved+0.40*ap.resolved`（精确嵌套二元；type 20220 / add 20170；无 20230；无显式 event op；total AD 直读 + AP；不减 base）；成功命中保留 Rising Spell Force 一层；CD/mana 探针（t0/t4499/t4500；mana39 resource skip）；自动 `ability_started`；P 共存；standalone Q provider；保留既有 P/E/R；Built/独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：direction/range/cast timing、projectile/travel/collision/first-enemy acquisition/miss、on-hit/on-attack、1.5s current cooldown reduction、basic+spell dual tags、lifesteal/vamp、spellshield/buffering、multitarget/nonchampions、ranks1-4、other Ezreal abilities beyond coexistence、live/E2E/full-game/full Mystic Shot/full-skill fidelity。本闭环**恰好是一次选定主目标敌方英雄物理命中**，**不是**完整 Q。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Mystic Shot 保真。
