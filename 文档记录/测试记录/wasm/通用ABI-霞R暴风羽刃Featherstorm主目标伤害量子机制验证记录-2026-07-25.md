TASK_KEY: wasm-generic-xayah-featherstorm-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI 霞 R 暴风羽刃 Featherstorm 主目标伤害量子机制验证记录

详细设计：[通用 ABI - 霞 R 暴风羽刃（Featherstorm）主目标伤害量子机制详细设计](../../详细设计/wasm/通用ABI-霞R暴风羽刃Featherstorm主目标伤害量子机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_xayah|R|暴风羽刃`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Xayah/R`，解析 `Template:Data Xayah/Featherstorm`；page `1324544` / rev `4008617` / timestamp `2026-04-15T00:26:44Z`；canonical raw bytes `1761`；SHA256 `cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/xayah-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 亦为 `1761` bytes / SHA256 `debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`。Phase-A 语义框定：将 leveling-labeled 数值的一次所选施加应用到所选主冠军，作为有界物理伤害量子；**不**证明 Wiki/完整 R 为 once-only，亦**不**证明完整 Featherstorm 仅有一次总命中；**不**建模五次伤害操作或同目标多羽基数。合同：Rank3 100 mana / 100000ms CD；immediate primary-champion scaffold；恰好一笔非暴击/不可复制物理 `400+1.00*(resolvedAD-baseAD)`（嵌套二元 `add`）；成功施放自动一次 `ability_started`（无显式 event op）；零 R state/modifier/listener/matcher/repeat/control/projectile/AOE/feather-ground/movement/untargetable。交叉：baseAD60/resolvedAD60 raw400，armor0=400，armor100=200；resolvedAD110 raw450，armor0=450，armor100=225。mana300/HP1000/armor100 t0/t99999/t100000 → 两成功+一 CD skip、两笔 R damage-quantum、final mana100/HP550、两次自动 R `ability_started`；mana99 resource skip/不变。W/Q/R isolation：type `62012` + W relation + listener `ability_id IS NULL` + ALL `{20205,20212,62012}`；runtime ability type matcher、`AbilityRef` 空；R/Q 不武装 W；W 自武装；R 仍一量子、Q 仍双击；Q 为可选独立 sibling。Backend R seed 为 Xayah/ad/mana 与校正后 W isolation 的 external-existing-data/check-only；不物化 identity/panel/resource；不突变 W/Q；不 live-publish。**不**宣称 multi-feather/五投射/leap/ghosted/delay/lockout/geometry/projectile/feather/E 或完整 Featherstorm/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: xayah-r-featherstorm-primary-hit-phase-a-v2`；DESIGN_REVIEW READY `run-4a01857d-8151-416b-95a5-cf62dd8b2769`，strict `grok-4.5`，effort high，fast false，runDelta0/diff0，1303 event lines / 86 tool events / 43 calls all terminal，无 truncation/mutation，无 user decision；v1 `run-b3d8f4b0-37fe-4d6c-8b50-6c20fa945a6c` REVISE **不是**接受门控；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-25**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_REVIEW READY | `run-4a01857d-8151-416b-95a5-cf62dd8b2769` | READY；1303 events / 86 tool events / 43 calls all terminal；runDelta0/diff0；无 truncation/mutation；无 user decision | **接受门控**（v2）；v1 REVISE 非门控 |
| Backend owning | owning `354fd287`；`run-7443696e-f4f1-4e42-92f5-9a1735a01c3a` | runDelta3/outside0；791 events；all terminal；focused R/Q/W **25/25**；owning full Maven **821/821**；规划 26 非通过计数 | 接受 |
| Backend 集成 | `741e1ff`；`run-dcff2c73-8a7d-4276-9169-154e603dfdad` | runDelta3/outside0；strict；无 truncation；focused R/Q/W **25/25**；README +39 R；**未**重跑全量 Maven | 接受；不得主张 Wasm-worktree 全量 Maven 通过 |
| Wasm exact | `57ec17c`；`run-9594cfdb-b1b9-4d7f-9035-05205a346832` | runDelta1/outside0；1321 events；strict；无 truncation；focused 5/11 + full Go + bench + TinyGo + Node smoke PASS | 接受 |
| Web | 无本机制写入 | Built/Web 资产保持 `1,169,377` / `65A4…C6A0` 同步不变 | 接受；无 Web 变更/拷贝 |
| 审计 | `893298e`；`run-1513d389-1c07-4a86-8d2c-a233e39c75da` | G8/Unified generate+`--check`；runDelta6/outside0；1071 events；strict；无 truncation；仅 Xayah R 对象变化；W/Q hashes 不变 | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Xayah/R` → `Template:Data Xayah/Featherstorm` / 1324544 / 4008617 / 2026-04-15T00:26:44Z / 1761 / `cb5c8ba5…5b3077` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/xayah-r.json` |
| local raw caveat | 1761 bytes / SHA `debf23b0…43ace1`；sidecar/pages 权威；非字节等价主张；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused XayahFeatherstorm | PASS（5 top-level / 11 subcases） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `57ec17c` |
| 实现 run | `run-9594cfdb-b1b9-4d7f-9035-05205a346832`；runDelta1/outside0；1321 events；strict；无 truncation |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused R/Q/W static SQL | PASS（**25/25** = W9+Q8+R8）；owning `354fd287` |
| owning full Maven | PASS（**821/821**）；run `run-7443696e-f4f1-4e42-92f5-9a1735a01c3a`；runDelta3/outside0；791 events |
| 集成 focused R/Q/W | PASS（25/25）；集成 `741e1ff`；run `run-dcff2c73-8a7d-4276-9169-154e603dfdad`；README +39 R |
| Wasm worktree full Maven | **未**重跑；owning Backend 全量已过；peer 有已知无关 legacy CRLF；**不得**主张 Wasm-worktree 全量 Maven 通过 |
| 规划计数校正 | 较早期望 26 仅为规划计数误差；**不是**已通过计数 |
| seed 合同 | `db/game_manage/seeds/lol_generic_xayah_featherstorm_primary_hit_seed.sql` + `LolGenericXayahFeatherstormPrimaryHitSeedSqlTest`；一笔嵌套二元物理量子；Xayah/ad/mana + 校正后 W isolation check-only；不物化 identity/panel/resource；不突变 W/Q |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit / 拷贝 | **无** |
| 当前源资产 | **1,169,377** / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（Built 与 Web 源资产同字节/同 SHA；与标准 Wasm build 精确一致） |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本 test-only Wasm 追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Xayah R 记录/机制语义变化（metadata source hash/generatedAt 除外） |
| Xayah W/Q canonical object hashes | 不变：G8 W `dd91a84a1e307ab4540b9d0f422c3715334ecdac3ac01580c5cb04859f6d938f`；Unified W `b03237eb01927cccdfa38f2abacd12f2cf0a17cf0b5bbcde75f06b7870b45ed4`；G8 Q `8305be23180eab1fb0189710defbf546deb1e9bdd0b935119a05ed37dda823ba`；Unified Q `83a2402fd27bf0f2a32d39ce81049b9f4af939333b6519b4532a9703c8fd13a5` |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap` |
| Unified 254 | sourceCount 12；completed 81 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 92 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 81 / partial 3 / none 170 |
| actionable | 0 |
| G8 242 | migrated 71 / partial 4 / blocked 98 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 75 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `893298e` |
| 审计 run | `run-1513d389-1c07-4a86-8d2c-a233e39c75da`；runDelta6 / outside0；1071 events；strict；无 truncation；G8/Unified generate+`--check` PASS；仅 Xayah R 机制对象变化 |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-4a01857d-8151-416b-95a5-cf62dd8b2769`（v2） |
| 较早 v1 | REVISE `run-b3d8f4b0-37fe-4d6c-8b50-6c20fa945a6c`（缺少 per-feather 措辞 ≠ 证明 full-R once-only）；**不是**接受门控 |
| 语义框定 | damage-quantum only；**无** Wiki-proven once-only / one total hit / five ops / same-target multi-feather 主张 |
| W/Q isolation | ability-type listener isolation + Q optional sibling；不重分类 W/Q；不改变 W/Q 数值/公式/state/modifier 合同 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=94；本切片写入后） |
| `node tools/task-governance/cli.mjs check` / rebuild | **未**执行（主会话将在 review 后 `check → rebuild → check`） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite / `--fix-headers` | **未**触碰 |

## 4. 已实现边界

已实现：Rank-3 active cost/cooldown；immediate primary-champion one physical damage-quantum scaffold；一笔非暴击/不可复制物理 `400+1.00*(resolvedAD-baseAD)`（嵌套二元）；CD/mana 探针（t0/t99999/t100000；mana99 resource skip）；自动 `ability_started`；W ability-type listener isolation 与 Q 双击隔离共存；Web 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：multi-feather same-target stacking/cardinality、five projectile identities/five damage ops、whole-R once-only/Wiki-proven once-only/one total hit claim、leap/ghosted/untargetable、one-second delay、attack/cast lockout、direction/cone/range/geometry、projectile/travel/collision/multitarget、feather generation/ground/E、other ranks、P/E/basic/equipment/loadout/crit/on-hit、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Featherstorm 保真。
