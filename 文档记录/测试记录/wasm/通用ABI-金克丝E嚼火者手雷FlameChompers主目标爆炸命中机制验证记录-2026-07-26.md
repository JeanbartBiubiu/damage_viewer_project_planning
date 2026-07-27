TASK_KEY: wasm-generic-jinx-flame-chompers-primary-explosion-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 金克丝 E 嚼火者手雷 Flame Chompers 主目标爆炸命中机制验证记录

详细设计：[通用 ABI - 金克丝 E 嚼火者手雷（Flame Chompers!）主目标爆炸命中机制详细设计](../../详细设计/wasm/通用ABI-金克丝E嚼火者手雷FlameChompers主目标爆炸命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_jinx|E|嚼火者手雷！`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Jinx/E`，解析 `Template:Data Jinx/Flame Chompers!`；page `1307600` / rev `3993368` / timestamp `2026-02-21T15:35:19Z`；canonical raw bytes `1786`；SHA256 `64562ed4adb34c932810970fd9b9c016b46329d6f956541d334c60d2bc9d83ee`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/jinx-e.json` bytes `2228` / SHA256 `de7922f66deb96c8652dd1a0509105b49cdcf22278d1fd591bc366060987183a` plus pages sibling bytes `694` / SHA256 `f2822e5708dd024c582575a9298c12b6e6cd66b37e3365ea8749e8e1d49b360d` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `1784` bytes，SHA256 `aabb099fd172522682e40f0826e4971797c3a047787ef3c5af902bc4b673a551`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold`。合同：Rank5 90 mana / 10000ms CD；immediate selected-primary-champion single magic explosion-hit scaffold；恰好一笔非暴击/不可复制魔法爆炸命中 `290 + 1.00 * source.attr.ap.resolved`（精确嵌套二元；**恰好一次 AP 读取**；伤害类型 **20221** + add 策略 **20170**；**无** 20230；**无**显式 event op；**无** E-specific type）；成功施放自动一次 `ability_started`；零 E state/modifier/listener。交叉：MR100 AP0 → raw290/final145；AP100 → raw390/final195；无关 AD 反证。mana270/AP100/HP1000/MR100 t0/t9999/t10000 → success/skip/success、两笔 E damage、两次自动 E `ability_started`、final mana90/HP610；mana89 resource skip。standalone E + 有界 E/W isolation；不合成 P/Q/R/basic。Backend `hero_jinx`/ap/mana **external-existing-data/check-only**；不物化 identity/panel/resource；不 live-publish。**不**宣称 three-Chomper layout/landing/arming/lifetime/location/direction/range/geometry/area/multitarget/contact/acquisition/knockdown/root/Wind Wall/Braum/spellshield/vision/other ranks 或完整 Flame Chompers!/游戏保真；本闭环**恰好是一次选定主目标魔法爆炸命中量子**，**不是**完整 E 或一次游戏内 E 总命中；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: jinx-e-flame-chompers-primary-explosion-hit-phase-a-v1`；有效 DESIGN_READY `run-893fcb26-cd49-4bb2-9bc7-4a231b13762f`，strict grok/high/fast=false，runDelta0，1750 parseable event lines，无 truncation/mutation/user decision，无 prior REVISE；运行时/审计已提交）填写。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。英雄名 `_test.go` 仅为测试/治理 fixture，排除于 normal/TinyGo 生产构建；仅构造 generic Provider/Ability/Formula 路径；**无**英雄专用生产分支或 public ABI 变更——**不**损害 generic 实现主张。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-893fcb26-cd49-4bb2-9bc7-4a231b13762f` | READY；strict grok/high/fast=false；runDelta0；1750 parseable；无 truncation/mutation/user decision；无 prior REVISE；production Wasm/public ABI/Web 不需要 | **接受门控** |
| Backend owning | owning `df08d6b341d85b3c43bc70e33e43eae0cb736ac8`；`run-1f38cae0-444e-4601-b316-9a74886b6b44` | runDelta3/outside0；主 focused37 / full1032 PASS；seed bytes27322 / SHA `686ff89b…7583ee6f`；JUnit bytes46529 / SHA `519c3e5c…00d35a`；README bytes305324 / SHA `bc71abfe…86b7be` | 接受 |
| Backend 镜像 | `3b26d3e74a6eb460bb641f42a1909f9735eb7dbd`；`run-1554558c-1d6b-4add-9cd8-4d52c89a6b97` | runDelta3/outside0；精确 parity；主 focused18 PASS | 接受 |
| Wasm exact | `9320b4dafc6225a3a20829de17223a0a6d715787`；`run-5b26afad-2b5f-42b7-bc71-81ae5aaff897` | runDelta1/outside0；focused7/count=100/E+W/full Go/Go bench/TinyGo/Node smoke+bench PASS；test bytes63966 / SHA `59ee84f4…53741b`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无生产/Web 写入；英雄名 `_test.go` 仅测试/治理 fixture | 接受 |
| Web | 无本机制写入 | Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` | 接受；无 Web 变更/拷贝 |
| 审计接受 | `577d8c584f65b001e7a8000cc8c6ac333727629f`；`run-c7d01be2-4efd-4e7a-b81d-99e72017758e` | runDelta8/outside0；1233 event lines；无 truncation；主五检查 PASS；语义比较仅 Jinx E G8/Unified 变化；provisional 仅移除 Jinx E | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Jinx/E` → `Template:Data Jinx/Flame Chompers!` / 1307600 / 3993368 / 2026-02-21T15:35:19Z / 1786 / `64562ed4…9d83ee` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/jinx-e.json`（2228 / `de7922f6…87183a`）plus pages sibling（694 / `f2822e57…9b360d`）权威 |
| local raw caveat | 1784 bytes / SHA `aabb099f…73a551`；sidecar/pages 权威；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Jinx Flame Chompers primary explosion hit（7 top-level）/ `-count=100` / E+W | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0` |
| Node canonical compile/run/release smoke + bench | PASS |
| exact commit | `9320b4dafc6225a3a20829de17223a0a6d715787` |
| test bytes / SHA | `63966` / SHA256 `59ee84f4b61bee5f86d8cc374204e2551161e18fd20b20d9db17d8b51553741b` |
| 实现 run | `run-5b26afad-2b5f-42b7-bc71-81ae5aaff897`；runDelta1/outside0 |
| 英雄名 `_test.go` 地位 | 测试/治理 fixture only；排除于 normal/TinyGo 生产构建；仅构造 generic Provider/Ability/Formula 路径；**无**英雄专用生产分支或 public ABI 变更；**不**损害 generic 实现主张 |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused / full | PASS（主 focused37 / full1032）；owning `df08d6b341d85b3c43bc70e33e43eae0cb736ac8`；run `run-1f38cae0-444e-4601-b316-9a74886b6b44`；runDelta3/outside0 |
| seed / JUnit / README SHA256 | seed bytes27322 / `686ff89b4f29b1697e478d2f1b676d80a9bd3288e460bea4f57e0a3b7583ee6f`；JUnit bytes46529 / `519c3e5ce2844d41bdc348441056352fb893633ca084bb261f63bffd0300d35a`；README bytes305324 / `bc71abfed04e04299a78bc8f17ae17ad619e779cb014d65bf8ed3912eb86b7be` |
| Backend 镜像 | PASS；`3b26d3e74a6eb460bb641f42a1909f9735eb7dbd`；run `run-1554558c-1d6b-4add-9cd8-4d52c89a6b97`；runDelta3/outside0；精确 parity；主 focused18 PASS |
| seed 合同 | `db/game_manage/seeds/lol_generic_jinx_flame_chompers_primary_explosion_hit_seed.sql` + `LolGenericJinxFlameChompersPrimaryExplosionHitSeedSqlTest`；一笔精确嵌套二元魔法 20221/20170；一次 AP 读；无 20230；无显式 event；无 E-specific type；`hero_jinx`/ap/mana external-existing-data/check-only；不物化 identity/panel/resource；standalone E；有界 E/W isolation |
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
| Registry / Batch-G / G8 / Unified / provisional generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Jinx E 记录/机制语义变化（metadata source hash/generatedAt 除外）；provisional 仅移除 Jinx E；先前 completed/migrated 记录锁定；稳定 digests 不变（Unified `69832c2a…c018`；Wiki registry `927d8b5a…26c7`） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap`；raw upstream 仅 provenance |
| Unified 254 | sourceCount 12；completed 102 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 71 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 102 / partial 3 / none 149 |
| actionable | 0 |
| registry 242 | migrated 48 / partial 5 / blocked 120 / OOS 69 |
| G8 242 | migrated 92 / partial 4 / blocked 77 / OOS 69；inScope 173 |
| provisional | 74 = runtime71 / data3；hero72 / item2；卡片仍为 unverified nonclaims |
| `implementation_gap_no_unresolved_data_fields` | **56**（Jinx E **离开**该家族） |
| 报告口径 | 严格 verified completion **102/254=40.2%**；completed + provisional implementation-description coverage **176/254=69.3%**；74 张 template-eligible blocked 键均有 provisional 卡；provisional **不是** completed 主张 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `577d8c584f65b001e7a8000cc8c6ac333727629f` |
| 审计接受 run | `run-c7d01be2-4efd-4e7a-b81d-99e72017758e`；runDelta8 / outside0；1233 event lines；无 truncation；主五检查 PASS；语义比较证明仅 Jinx E G8/Unified 变化；provisional 仅移除 Jinx E |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控与证据地位笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-893fcb26-cd49-4bb2-9bc7-4a231b13762f`；无 prior REVISE |
| Standalone / E/W isolation / check-only / AP-only | 独立 E provider；有界 E/W isolation；external-existing-data/check-only `hero_jinx`/ap/mana；精确嵌套二元魔法 `290+1.00*ap.resolved`（一次 AP 读）；type 20221 / add 20170；无 20230；无 E-specific type |
| 英雄名 `_test.go` | 测试/治理 fixture only；排除生产构建；仅 generic 合同路径；无生产 runtime/ABI 变更；不损害 generic 实现主张 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=116；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（read-only；tasks=116；invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 rebuild） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate selected-primary-champion single magic explosion-hit scaffold；一笔非暴击/不可复制魔法爆炸命中 `290+1.00*ap.resolved`（精确嵌套二元；一次 AP 读；type 20221 / add 20170；无 20230；无显式 event op）；CD/mana 探针（t0/t9999/t10000；mana89 resource skip）；自动 `ability_started`；standalone E + 有界 E/W isolation；Built/独立 Web worktree 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：three-Chomper layout/count/identity、location/direction/range/geometry/area/multitarget、landing/arming/lifetime delays、contact/collision/acquisition/one-per-champion、knockdown/root/CC、Wind Wall/Braum/spell-shield exception/vision、ranks1-4、P/Q/W/R/basic/loadout/bootstrap、live/Admin/E2E/full-game/full E/full-skill fidelity。本闭环**恰好是一次选定主目标魔法爆炸命中量子**，**不是**完整 E 或一次游戏内 E 总命中。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Flame Chompers! 保真。
