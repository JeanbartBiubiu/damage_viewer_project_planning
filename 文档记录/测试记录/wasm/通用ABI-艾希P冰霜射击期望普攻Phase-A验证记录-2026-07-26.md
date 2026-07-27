TASK_KEY: wasm-generic-ashe-frost-shot-expected-basic-attack
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 艾希 P 冰霜射击期望普攻 Phase-A 验证记录

详细设计：[通用 ABI - 艾希 P 冰霜射击（Frost Shot）期望普攻 Phase-A 详细设计](../../详细设计/wasm/通用ABI-艾希P冰霜射击期望普攻Phase-A详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_ashe|P|冰霜射击`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Ashe/I`，解析 `Template:Data Ashe/Frost Shot`；page `1306803` / rev `4038216` / timestamp `2026-06-30T07:27:41Z`；canonical raw bytes `1880`；SHA256 `def2547f895e1533754e9265fd36f995a30258f11ca947cd737a70ea17df51da`；normalized sidecar bytes `2485` / SHA256 `575de3e4c99f9a92d3edd4076d33586d4f96b4e4a8511ff5925617e526ff2e2a` plus pages sibling bytes `672` / SHA256 `a8e2f81d77f85ad8d7a346ba9a3a3a354e675aa8cc9953765d5c6495f8bbd7ce` 为权威；sourceCount **仍为 12**。本地 raw materialization 为 `1880` bytes，SHA256 `5da5112e02a1c3aed266df1a424a33e8c4806c15d94991ec14c3bbaed2ca8378`——**local raw materialization caveat**；**故意不断言**字节等价，**不是**源矛盾。当前 total base crit multiplier **2.0**；runtime `crit_damage` 为总倍率，generic additive 可至 **2.3**。边界：`normal_basic_attack_expected_physical_damage; separate_ability_basic_attack; total_ad_times_one_plus_clamped_crit_chance_times_total_crit_multiplier_minus_one; generic_expected_crit_settlement; q_flurry_inactive_normal_attack_branch_only; exactly_one_basic_attack_hit_event; no_rng_crit_sequence_on_crit_event_frost_slow_critical_slow_duration_decay_randuins_specific_acceptance_runaans_cheap_shot_q_flurry_damage_integration_projectile_travel_attack_cadence_other_abilities_or_full_fidelity`。G8 governed tags 序：`expected_crit`、`separate_ability_basic_attack`、`generic_expected_crit_settlement`、`q_flurry_inactive_normal_attack_branch_only`。公式：`AD*((1-p)+p*m)=AD*(1+p*(m-1))`，既有 generic expected-crit settlement。交叉（total AD100）：p0/m2→100；p0.5/m2→150；p1/m2→200；armor100 p0.5/m2→raw150/final75；p0.5/m2.3→165。各 fixture：1× normal damage、1× `basic_attack_hit`、0× `ability_started`；Focus 继续叠层。Q Flurry 箭矢保持 crit-ineligible；Q 既有 completedBoundary **不变**。Backend 共享 P/Q seed 拥有基线 `crit_chance=0` / `crit_damage=2.0`、普通 `crit_eligible=true`、11 条 Flurry `false`，并补齐缺失 game-local `ability/basic_attack` relation（Web fail-closed，不按 key 猜测）。Wasm 英雄名 `_test.go` 仅为测试/治理证据并排除生产构建；**无**生产英雄 switch / generic-runtime specialization。**仅** expectation-only Phase-A；**不**宣称完整 Frost Shot 保真；Jhin P / Yunara P 仍为 deferred `blocked_runtime`；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: ashe-p-frost-shot-expected-basic-attack-phase-a-v3`；DESIGN_REVIEW_ONLY READY `run-b733503b-157d-47a8-b0db-cda8f53d768b`；运行时/审计已提交）填写。下列验证结果按实现与主会话复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push、browser E2E、production TinyGo runtime、public ABI 或 Web 变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。本 test-only 切片**未**要求、亦**未**执行生产 Wasm/Web 资产重建。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY v3 | `run-b733503b-157d-47a8-b0db-cda8f53d768b` | DESIGN_REVIEW_ONLY READY；runDelta0/outside0；2095 parseable；84/84 complete；无 truncation/mutation | **接受门控** |
| Backend owning | `0d8fcd44c1152e9e320134730b3d0da1f8d143e3`；`run-7fdd23e2-7a4c-4f3d-a38a-7c78534c9e53` | exact 3 paths；runDelta3/outside0；1006 parseable；57/57 complete；无 truncation；focused36 / full1056 PASS | 接受 |
| Wasm exact | `25b34ccda1f6a35b294dbf567cd3632e6bc8f7fa`；`run-97ee013f-a560-4645-9301-e814f879c03a` | exact existing `generic_ashe_rangers_focus_test.go`；runDelta1/outside0；714 parseable；40/40 complete；无 truncation；focused Ashe / full Go / bench PASS | 接受 |
| 审计 | `5f5442d768ef28714e91ec8b64d655142580f99a`；`run-1034ade7-693b-4dc4-a490-5a692f9f0f0c` | exact 8 paths；runDelta8/outside0；1204 parseable；83/83 complete；无 truncation；Driver 五 check + `git diff --check` PASS | 接受 |
| Web | 无本机制写入 | 无 Web / 生产 Wasm / public ABI 变更；**未**资产重建 | 接受 |

## 2. 验证结果（实现轮与主会话抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved / page / rev / timestamp / canonical / SHA | PASS；`Template:Data Ashe/I` → `Template:Data Ashe/Frost Shot` / 1306803 / 4038216 / 2026-06-30T07:27:41Z / 1880 / `def2547f…df51da` |
| normalized / pages | 2485 / `575de3e4…ff2e2a`；pages 672 / `a8e2f81d…bbd7ce` 权威 |
| local raw caveat | 1880 / `5da5112e…ca8378`；非源矛盾 |
| sourceCount | 仍为 12；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Ashe / full Go / bench | PASS（Driver） |
| exact commit | `25b34ccda1f6a35b294dbf567cd3632e6bc8f7fa` |
| exact path | 既有 `generic_ashe_rangers_focus_test.go`（仅 `_test.go`） |
| 实现 run | `run-97ee013f-a560-4645-9301-e814f879c03a`；runDelta1/outside0；714 events；40/40 |
| 英雄名 `_test.go` 地位 | 测试/治理证据 only；排除生产构建；无生产英雄 switch / generic-runtime specialization |
| 生产 Wasm / Web 写入 / 资产重建 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| focused / full Maven | PASS 36 / PASS 1056（零 failures/errors/skips；Driver） |
| owning commit / run | `0d8fcd44c1152e9e320134730b3d0da1f8d143e3`；`run-7fdd23e2-7a4c-4f3d-a38a-7c78534c9e53`；runDelta3/outside0；1006 events；57/57 |
| seed 合同 | 共享 P/Q；`crit_chance=0` / `crit_damage=2.0`；normal `crit_eligible=true`；11 Flurry `false`；补齐 `ability/basic_attack` type+relation（Web fail-closed） |
| live seed execution | **未**执行 |

### 2.4 Web / 资产

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit | **无** |
| 生产 Wasm / public ABI | **无**变更；本切片**未**要求资产重建 |
| Playwright / live E2E | **未**执行 |

### 2.5 G8 / Unified / provisional

| 验证 | 结果 |
| --- | --- |
| 五审计 `--check` + `git diff --check` | PASS（Driver；本切片亦复跑） |
| G8 governed | `migrated`；四 tags；空 `remainingGap` |
| Unified 254 | sourceCount12；completed105 / actionable0 / blocked_runtime68 / blocked_data3 / OOS72 / regression5 / stale1 |
| coverage | full105 / partial3 / none146 |
| registry 242 | migrated48 / partial5 / blocked120 / OOS69（不变） |
| G8 242 | migrated95 / partial4 / blocked74 / OOS69 |
| provisional | 71 = runtime68 / data3；hero69 / item2；Ashe P 缺席 |
| `implementation_gap_no_unresolved_data_fields` | **仍为 54** |
| `deterministic_random_crit_sequence` | **降至 3**（Ashe P 离开；Jhin P / Yunara P 仍 deferred `blocked_runtime`） |
| digests | Unified `69832c2a…c018`；Wiki `927d8b5a…26c7`（不变） |
| 报告口径 | 严格 verified completion **105/254=41.3%**；completed+provisional coverage **176/254=69.3%** |
| OOS / 真队列 | `out_of_scope=72` 为最终跳过分类，无实现/模板/后续队列；真剩余队列 **仅 71** = blocked_runtime68 + blocked_data3 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；总体 Goal 仍活跃 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `5f5442d768ef28714e91ec8b64d655142580f99a` |
| 审计 run | `run-1034ade7-693b-4dc4-a490-5a692f9f0f0c`；exact 8 paths；runDelta8/outside0；1204 events；83/83 complete；无 truncation |
| Driver 独立验收 | G8 / Unified / provisional / Wiki-only / Batch-G + `git diff --check` PASS |
| live / publish / push / E2E | 未执行 |

### 2.7 设计门控

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-b733503b-157d-47a8-b0db-cda8f53d768b`（DESIGN_REVIEW_ONLY；2095 events；84/84；runDelta0/outside0） |
| Backend / Wasm | 共享 P/Q seed；既有 separate BA；英雄名 `_test.go` 验收证据 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON / tasks | PASS（tasks=119；unique key；exact 两 docs；无其它 task delta） |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `node tools/task-governance/cli.mjs tasks` | 只读 SQLite 查询；本切片**未** rebuild，故尚未列出本新 task（预期；由主会话 rebuild 后复验） |
| `node tools/task-governance/cli.mjs docs wasm-generic-ashe-frost-shot-expected-basic-attack` | 只读 SQLite 查询；本切片**未** rebuild，故 0 行（预期；由主会话 rebuild 后复验） |
| G8 / Unified / provisional / Wiki-only / Batch-G `--check` | 全部 PASS |
| `git diff --check` | PASS；仅行尾 CRLF warning；仅四条 allowlist 路径变更 |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 check/rebuild/check） |
| SQLite | **未**触碰 |
| commit / push | **未**执行 |

## 4. 已实现边界

已实现：Flurry 未激活普通普攻期望物理 `AD*(1+p*(m-1))`；既有 generic expected-crit settlement；separate `ability/basic_attack`；恰好一次 `basic_attack_hit`；Focus 保留；Q Flurry 箭矢 crit-ineligible；共享 P/Q seed 基线 crit 与 fail-closed `ability/basic_attack` relation；Wasm 测试-only 证据。排除（completed-boundary exclusions；**非** remaining blockers）：RNG crit sequence、on-crit event、Frost slow、Critical Slow、duration decay、Randuin/Runaan/Cheap Shot、Q Flurry/P 伤害集成、projectile/travel、attack cadence、other abilities、full Frost Shot fidelity。本闭环**恰好是 expectation-only Phase-A 普通期望普攻**，**不是**完整 Frost Shot。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成。
