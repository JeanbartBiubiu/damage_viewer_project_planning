TASK_KEY: wasm-generic-xayah-double-daggers-primary-two-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI 霞 Q 双刃 Double Daggers 主目标双击机制验证记录

详细设计：[通用 ABI - 霞 Q 双刃（Double Daggers）主目标双击机制详细设计](../../详细设计/wasm/通用ABI-霞Q双刃DoubleDaggers主目标双击机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_xayah|Q|双刃`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Xayah/Q`，解析 `Template:Data Xayah/Double Daggers`；page `1324541` / rev `4008615` / timestamp `2026-04-15T00:26:21Z`；canonical raw bytes `2615`；SHA256 `8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/xayah-q.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。live redirect page `1324536` / rev `2864045` 仅为 live request detail，**不是** stored sidecar。本地 raw materialization 亦为 `2615` bytes / SHA256 `6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`。合同：Rank5 35 mana / 8000ms CD；immediate primary-champion scaffold；恰好两次有序 distinct left/right 非暴击/不可复制物理，各自 `105+0.50*(resolvedAD-baseAD)`（嵌套二元 `add`）；成功施放自动一次 `ability_started`（无显式 event op）；零 Q state/modifier/listener/matcher/repeat/control/projectile/AOE/feather-ground/movement。交叉：baseAD60/resolvedAD60 各105/合计210，armor100 各52.5/合计105；resolvedAD110 各130/合计260，armor100 各65/合计130。mana105/HP1000/armor100 t0/t7999/t8000 → 两成功+一 CD skip、四笔伤害、final mana35/HP740、两次 `ability_started`；mana34 resource skip/不变。W isolation：type `62012` + W relation + listener `ability_id IS NULL` + ALL `{20205,20212,62012}`；runtime ability type matcher、`AbilityRef` 空；Q 成功/skip 不武装 W；W 成功仅武装 W、零 Q 伤害；**不**改变 W 分类或 40 mana/14000ms/4000ms/+55%/×1.25 合同。**不**宣称 cast time/lockout/geometry/projectile/spellshield/later-target reduction/feather/E 或完整 Double Daggers/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: xayah-q-double-daggers-primary-two-hit-phase-a-v3`；DESIGN_REVIEW READY `run-136665fe-8126-4aa8-aa1d-fb65934d2a39`，strict `grok-4.5`，effort high，fast false，runDelta0/diff0，162 tool events / 81 unique calls all terminal，无 truncation/orphans/mutations，无 user decision；较早 v1/v2 **不是**接受门控；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-25**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_REVIEW READY | `run-136665fe-8126-4aa8-aa1d-fb65934d2a39` | READY；162 events / 81 calls all terminal；runDelta0/diff0；无 truncation/orphans/mutations；无 user decision | **接受门控**（v3）；v1/v2 非门控 |
| Backend owning | owning `8ace954`；`run-3c2645ea-3900-4646-abdc-e78c27c67e3c` | runDelta0；64 events / 25 calls；focused18/18；owning full Maven **813/813**；首轮 `run-b39fb6ca…` 写后中断 | 接受恢复实现；首轮非最终审计 |
| Backend 集成 | `6bab0b8`；`run-f84ba8c6-61c6-4727-9d5b-faec7d301fc6` | runDelta0/outside0；74/37；focused Q/W **17/17**；无效冲突 run `run-32a65624…`；Wasm worktree full Maven CRLF caveat | 接受；CRLF 非 Xayah 失败 |
| Wasm exact | `dd7dae6`；`run-8fbe36dd-25b2-4428-a92d-b3bf3f537555` | runDelta2/outside0；1077 events；52 calls complete；无 truncation；focused + `-count=100` + full Go PASS | 接受 |
| Web | 无本机制写入 | 资产保持 `1,169,377` / `65A4…C6A0` 同步不变 | 接受；无 Web 变更/拷贝 |
| 审计 | `d94d35a`；`run-aae6eb8d-b707-4458-8085-d643824efae3` | G8/Unified `--check`；runDelta6/outside0；1028 events；80 calls complete；无 truncation；仅 Xayah Q 对象变化；W hashes 不变 | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Xayah/Q` → `Template:Data Xayah/Double Daggers` / 1324541 / 4008615 / 2026-04-15T00:26:21Z / 2615 / `8010e567…990fd` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/xayah-q.json` |
| live redirect | page1324536 / rev2864045 仅 live request detail；非 stored sidecar |
| local raw caveat | 2615 bytes / SHA `6a1fde0a…974de`；sidecar/pages 权威；非字节等价主张；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `Xayah(DoubleDaggers\|DeadlyPlumage)` | PASS |
| `XayahDoubleDaggers -count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| 标准 `scripts/build-wasm.ps1` TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `dd7dae6a02cb960d258b10838551e4238e5efa42` |
| 实现 run | `run-8fbe36dd-25b2-4428-a92d-b3bf3f537555`；runDelta2/outside0；1077 parseable；52 calls complete；无 truncation |
| 生产 Wasm / Web 写入/commit | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（18/18）；owning `8ace954` |
| owning full Maven | PASS（**813/813**）；恢复 run `run-3c2645ea-3900-4646-abdc-e78c27c67e3c` |
| 集成 focused Q/W | PASS（17/17）；集成 `6bab0b854d919efec2394dbc875cc3402daa84f9`；接受 `run-f84ba8c6-61c6-4727-9d5b-faec7d301fc6` |
| Wasm worktree full Maven | **不是**干净全绿：632 tests / 51 既有 legacy seed 失败（`core.autocrlf=true` + 旧测试硬编码 LF）——环境/legacy CRLF caveat；新 Q/W 测试通过；**非** Xayah 失败；**非**全量通过主张 |
| 无效/非接受 run | 首轮 owning `run-b39fb6ca…` 写后中断；冲突 run `run-32a65624…` 越权规范化 Q seed |
| seed 合同 | `db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql` + `LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest`；两次有序 left/right 嵌套二元；W isolation check-only |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit / 拷贝 | **无** |
| 当前源资产 | **1,169,377** / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（与标准 Wasm build 精确一致；Built 与 Web 源资产同字节/同 SHA） |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本 test-only Wasm 追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified generator `--check` | PASS；242/254 keys/order 不变；仅 Xayah Q 记录/机制语义变化（metadata source hash/generatedAt 除外） |
| Xayah W canonical object hashes | 不变：G8 `dd91a84a1e307ab4540b9d0f422c3715334ecdac3ac01580c5cb04859f6d938f`；Unified `b03237eb01927cccdfa38f2abacd12f2cf0a17cf0b5bbcde75f06b7870b45ed4` |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap` |
| Unified 254 | sourceCount 12；completed 80 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 93 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 80 / partial 3 / none 171 |
| actionable | 0 |
| G8 242 | migrated 70 / partial 4 / blocked 99 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 76 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `d94d35a2fa0f499578580d28d72e05ed5ff7b5bf` |
| 审计 run | `run-aae6eb8d-b707-4458-8085-d643824efae3`；runDelta6 / outside0；1028 parseable；80 calls complete；无 truncation；G8/Unified `--check` PASS；仅 Xayah Q 机制对象变化 |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-136665fe-8126-4aa8-aa1d-fb65934d2a39`（v3） |
| 较早 v1/v2 | **不是**接受门控 |
| W isolation | ability-type listener isolation only；不重分类 W；不改变 W 数值/公式/state/modifier 合同 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=93；本切片写入后） |
| `node tools/task-governance/cli.mjs check` / rebuild | **未**执行（主会话将在 review 后 `check → rebuild → check`） |
| `git diff --check` / 变更路径核对 | PASS；仅六条 allowlist 路径变更 |
| SQLite / `--fix-headers` | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-champion two-feather impact scaffold；两次有序非暴击/不可复制物理 `105+0.50*(resolvedAD-baseAD)`（嵌套二元）；CD/mana 探针（t0/t7999/t8000；mana34 resource skip）；自动 `ability_started`；W ability-type listener isolation 共存；Web 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast time/attack lockout/effect-at-cast-end、direction/range/width/geometry、projectile/travel/collision/interception/spellshield、later-target reduction、multitarget/formation/area、feather generation/ground/E、ranks1–4、other skills/basic/loadout/crit/on-hit、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Double Daggers 保真。
