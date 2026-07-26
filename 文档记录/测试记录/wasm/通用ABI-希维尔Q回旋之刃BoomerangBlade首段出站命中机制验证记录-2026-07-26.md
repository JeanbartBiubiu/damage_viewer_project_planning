TASK_KEY: wasm-generic-sivir-boomerang-blade-first-outbound-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 希维尔 Q 回旋之刃 Boomerang Blade 首段出站命中机制验证记录

详细设计：[通用 ABI - 希维尔 Q 回旋之刃（Boomerang Blade）首段出站命中机制详细设计](../../详细设计/wasm/通用ABI-希维尔Q回旋之刃BoomerangBlade首段出站命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_sivir|Q|回旋之刃`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Sivir/Q`，解析 `Template:Data Sivir/Boomerang Blade`；page `1308837` / rev `4016378` / timestamp `2026-05-11T05:05:57Z`；canonical raw bytes `2745`；SHA256 `0adcf3916b63e8b0ae6c2c7ad74d1796e3362a3a22682c58ef92aaccfae43e5e`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/sivir-q.json` bytes `3018` / SHA256 `2320f7ada83cceee979c52cd314395c6b41e2f50c50e3114e9bca0d39386ff02` plus pages sibling bytes `691` / SHA256 `adeab85889a4208b52f0b6cd3bcc3aef022a986dcad5168e1c817e3ab3323fa9` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `2745` bytes，SHA256 `b8d46412519f211b27f2575684693f407806cbbca337a80e775a1baf4c2396a4`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity`。governed tags 任务序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`ap_ratio`、`crit_scaling`、`immediate_impact_scaffold`（G8 保留该序；Unified canonical 输出排序时 `ap_ratio` 先于 `bonus_ad_ratio`——同一 membership，**不得**描述为语义差异；**无** completed salvage tag）。合同：Rank5 75 mana / **immediate cooldown scaffold 8000ms**；immediate selected-primary champion first-outbound-pass single physical hit scaffold；恰好一笔非暴击/不可复制物理命中 `(160 + 0.70 * (ad.resolved - ad.base) + 0.60 * ap.resolved) * (1 + 0.40 * min(1, max(0, crit_chance.resolved)))`（精确嵌套；每条 read path 恰好一次；**formula-local** crit clamp——generic formula reads **不**应用 DB attribute bounds；缺失 formula attrs 当前读零，**不得**主张 fail-closed；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op；**无** Q-specific type）；成功施放自动一次 `ability_started`；零 Q state/modifier/listener。交叉：armor100 raw290/348/406 → final145/174/203（含 negative/overcap clamp 与 bonusAD/AP counterproof）。mana225/HP1000/armor100（crit0.5）t0/t7999/t8000 → success/skip/success、两笔 Q damage、两次自动 Q `ability_started`、final mana75/HP652；mana74 resource skip。Sivir Q provider **standalone**。Backend 前置为 **external existing-data/check-only**（`hero_sivir`/ad/ap/crit_chance/mana）；seed **不**物化 identity/panel/resource；无 Sivir materializer；不 live-publish。Wasm fixtures **定义** crit_chance。**不**宣称 cast time、bonus attack speed、direction/range/width/geometry、projectile/travel/speed、nonchampion hit reduction、return pass、damage modifier reset、once-per-pass、spellshield、other ranks 或完整 Boomerang Blade/游戏保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: sivir-q-boomerang-blade-first-outbound-hit-phase-a-v3`；正式最终 DESIGN_READY `run-4db83782-b7af-4a56-8a75-2b687cc456a4`，runDelta0，2099 parseable events，61/61 groups，无 truncation/mutation，无 user decision；先前 v1 `run-a0605b7c-b2d4-4357-817c-05124931df2a` 为 valid REVISE（2226；63/63；delta0；DB bounds / seed 未证明 bounds 已接受）；v2 `run-fd9c2756-24b5-47fb-b1f0-8ba14511ba42` 为 valid REVISE（2199；46/46；delta0；缺失 attrs 读零、不得 fail-closed 已接受）；**v3 为正式最终 READY 门控**；运行时/审计已提交）填写。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。Production Wasm/public ABI/Web 变更**不**需要。英雄名 `_test.go` 仅为测试/治理身份，排除于生产构建；仅构造 generic provider/ability/operation/formula 合同；**无**英雄专用生产 runtime 分支或 public ABI 变更——**不**损害 generic runtime 实现主张。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-4db83782-b7af-4a56-8a75-2b687cc456a4` | READY；runDelta0；2099 parseable events；61/61 groups；无 truncation/mutation；无 user decision。v1/v2 REVISE 校正已接受 | **接受门控**（仅 v3） |
| Backend owning | owning `3ded9cb6f9cbeb020fd343c24402a7126290a79b`；`run-98d9646e-2360-499d-a12c-83e777d115e3` | runDelta3/outside0；主 focused64/64 + full Maven1023/1023 PASS；seed bytes32326 / SHA `4ba04a00…dbf189`；JUnit bytes63624 / SHA `2f3368a9…e467a`；README bytes299113 / SHA `913c80f6…b6cf95` | 接受 |
| Backend 镜像 | `b14c48f700fa2806eb6738bd1a474f06d2e95807`；`run-9b7da61c-19eb-4be2-b8dd-0ff4b74a3481` | runDelta3/outside0；6/6 complete groups；精确 parity；Sivir JUnit13/13 PASS。Combined mirror focused suite 另暴露既有 sibling Essence Reaver / Twisted Fate `must BEGIN` 失败——无关 caveat，未修复/未隐藏 | 接受 |
| Wasm exact | `bff4d16012980747b93a1264537e0f40dfb9f3dd`；`run-5834425f-e0d2-497b-8c40-b32406696cba` | runDelta1/outside0；focused ten top-level、count100、full Go、Go bench、TinyGo build、Node smoke/bench PASS；test bytes79086 / SHA `77a27da7…917cc44`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无生产/Web 写入；英雄名 `_test.go` 仅测试/治理身份 | 接受 |
| Web | 无本机制写入 | Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0`；Production 变更不需要 | 接受；无 Web 变更/拷贝 |
| 审计接受 | `6e8b55c3b32decff67a908ada5613af13306c5c6`；`run-9f321848-663f-4058-a3b1-7243bfc79728` | 首审计 `run-de678bf0…` HTTP/2 CANCEL 崩溃不作证据；恢复 run delta8/outside0；parseable 1590-line；无 truncation；主五检查 PASS；语义比较仅 Sivir Q G8/Unified 变化；provisional 仅移除 Sivir Q | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Sivir/Q` → `Template:Data Sivir/Boomerang Blade` / 1308837 / 4016378 / 2026-05-11T05:05:57Z / 2745 / `0adcf391…e43e5e` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/sivir-q.json`（3018 / `2320f7ad…86ff02`）plus pages sibling（691 / `adeab858…323fa9`）权威 |
| local raw caveat | 2745 bytes / SHA `b8d46412…2396a4`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Sivir Boomerang Blade first outbound hit / ten top-level / `-count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `bff4d16012980747b93a1264537e0f40dfb9f3dd` |
| test bytes / SHA | `79086` / SHA256 `77a27da736577acc9a1bfd6728472a2b84c6a07353314528b115b112b917cc44` |
| 实现 run | `run-5834425f-e0d2-497b-8c40-b32406696cba`；runDelta1/outside0 |
| 英雄名 `_test.go` 地位 | 测试/治理身份 only；排除于生产构建；仅构造 generic provider/ability/operation/formula 合同；无英雄专用生产 runtime 分支；**无**生产 runtime/ABI 变更；**不**损害 generic runtime 实现主张 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused64/64 + full Maven1023/1023）；owning `3ded9cb6f9cbeb020fd343c24402a7126290a79b`；run `run-98d9646e-2360-499d-a12c-83e777d115e3`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed bytes32326 / `4ba04a00c1d67a67fd581eaa1cd4edfbb08eeb9699d9e3c8da8eed3f03dbf189`；JUnit bytes63624 / `2f3368a98b132065be78b184230c3afa0b48c7f0d3db387061ab909b631e467a`；README bytes299113 / `913c80f677df682e258bd371be7941b80893f5566c83617b68efc6ea7fb6cf95` |
| Backend 镜像 | PASS；`b14c48f700fa2806eb6738bd1a474f06d2e95807`；run `run-9b7da61c-19eb-4be2-b8dd-0ff4b74a3481`；runDelta3/outside0；6/6 complete groups；精确 parity；Sivir JUnit13/13 PASS。Combined mirror focused suite 另暴露既有 sibling Essence Reaver / Twisted Fate `must BEGIN` 失败——无关 caveat，未修复/未隐藏 |
| seed 合同 | `db/game_manage/seeds/lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql` + `LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest`；精确嵌套物理 20220/20170；formula-local crit clamp；无 20230；无显式 event；无 Q-specific type；`hero_sivir`/ad/ap/crit_chance/mana external-existing-data/check-only；不物化 identity/panel/resource；无 Sivir materializer；standalone Q |
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
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Sivir Q 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Sivir Q；先前 completed/migrated 记录锁定；稳定 digests 不变（Unified `69832c2a…c018`；Wiki registry `927d8b5a…26c7`） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 六 tags（**任务序**同上）；空 `remainingGap`；Unified canonical 排序 `ap_ratio` 先于 `bonus_ad_ratio`——同一 membership，非语义差异；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 101 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 72 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 101 / partial 3 / none 150 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 91 / partial 4 / blocked 78 / OOS 69；inScope 173 |
| provisional | 75 = runtime72 / data3；hero73 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | **57**（Sivir Q **离开**该家族） |
| 报告口径 | 严格 verified completion **101/254=39.8%**；completed + provisional implementation-description coverage **176/254=69.3%**；75 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `6e8b55c3b32decff67a908ada5613af13306c5c6` |
| 首审计崩溃 | `run-de678bf0-0186-4918-8bd2-186650d097ea` SDK HTTP/2 CANCEL——**不**作接受证据 |
| 审计接受 run | `run-9f321848-663f-4058-a3b1-7243bfc79728`；runDelta8 / outside0；parseable 1590-line；无 truncation；主五检查通过；语义比较证明仅 Sivir Q G8/Unified 变化；provisional 仅移除 Sivir Q |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控与证据地位笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | 正式最终 READY `run-4db83782-b7af-4a56-8a75-2b687cc456a4`（2099；61/61；runDelta0） |
| v1 valid REVISE | `run-a0605b7c-b2d4-4357-817c-05124931df2a`（2226；63/63；delta0）；DB attr min/max 不被 formula reads 应用、seed 未证明 bounds 已接受；**不是**正式 READY 门控 |
| v2 valid REVISE | `run-fd9c2756-24b5-47fb-b1f0-8ba14511ba42`（2199；46/46；delta0）；缺失 formula attrs 读零、不得 fail-closed 已接受；非正式 READY 门控 |
| Standalone / check-only / formula | 独立 Q provider；external-existing-data/check-only；精确嵌套物理 + formula-local crit clamp；type 20220 / add 20170；无 20230；无 Q-specific type；Wasm fixtures 定义 crit_chance |
| 英雄名 `_test.go` | 测试/治理身份 only；排除生产构建；仅 generic 合同路径；无英雄专用生产分支；无生产 runtime/ABI 变更；不损害 generic runtime 实现主张 |
| 镜像 sibling caveat | Essence Reaver / Twisted Fate `must BEGIN` 既有失败——无关 caveat，未修复/未隐藏 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=115；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=115；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 check/rebuild/check） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost；immediate selected-primary champion first-outbound-pass single physical hit scaffold；immediate 8000ms cooldown scaffold；一笔非暴击/不可复制物理命中 `(160+0.70*(ad.resolved-ad.base)+0.60*ap.resolved)*(1+0.40*min(1,max(0,crit_chance.resolved)))`（精确嵌套；每条 read path 恰好一次；formula-local crit clamp；type 20220 / add 20170；无 20230；无显式 event op）；CD/mana 探针（t0/t7999/t8000；mana74 resource skip）；自动 `ability_started`；standalone Q provider；external-existing-data/check-only；Built/独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast time、bonus attack speed、direction/range/width/geometry、projectile/travel/speed、nonchampion hit reduction、return pass、damage modifier reset、once-per-pass、spellshield、ranks1-4、siblings/loadout/bootstrap、live/E2E/full-game/full Q/full-skill fidelity。本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 Q。不得主张 DB bounds 由 formula reads 应用或缺失 attr fail-closed。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Boomerang Blade 保真。英雄名 `_test.go` 仅为测试/治理身份，排除于生产构建，仅走 generic 合同路径，**不**损害 generic runtime 实现。
