TASK_KEY: wasm-generic-draven-whirling-death-primary-outbound-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 德莱文 R 冷血追命首段主目标命中 Phase-A 验证记录

详细设计：[通用 ABI - 德莱文 R 冷血追命（Whirling Death）首段主目标命中 Phase-A 详细设计](../../详细设计/wasm/通用ABI-德莱文R冷血追命首段主目标命中Phase-A详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_draven|R|冷血追命`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Draven/R`，解析 `Template:Data Draven/Whirling Death`；page `1307072` / rev `4040576` / timestamp `2026-07-06T14:27:37Z`；canonical raw bytes `3079`；SHA256 `e38551b6eeefa0306cd40a3e15473c8983075f88edbe007915e3d9213a08adce`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/draven-r.json` bytes `3361` / SHA256 `74e8f95ca03c86a5c809255d6309e4639e949337f4f36ee4fcfd4e8403416754` plus pages sibling bytes `698` / SHA256 `d8f5a8856951ec09e60e0aacb38cd3d90e767bd2d347b74eee50282b29c96863` 为权威；sourceCount **仍为 12**。本地 raw materialization 为 `3079` bytes，SHA256 `1110179b1771c03c8ff67b428d6fa7a5b0ba42caf19e241ce512a199ef812059`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_selected_primary_champion_single_first_outbound_pass_hit; immediate_impact_scaffold; physical_400_plus_1_50_bonus_ad; no_cast_time_direction_projectile_travel_collision_sight_recast_reversal_return_homing_second_pass_execute_adoration_threshold_multitarget_damage_falloff_reset_map_edge_once_per_pass_geometry_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`。合同：Rank3 100 mana / 80000ms CD；immediate selected-primary first-outbound physical damage `400+1.50*(ad.resolved-ad.base)`（精确嵌套；显式 bonus AD 减法；type **20220** / add **20170**；**无** 20230；**无**显式 event；**无** R-specific type）；非暴击/不可复制；成功施放自动一次 `ability_started`。交叉：baseAD62/resolved162 → raw550 / armor100 mitigated275；zero-bonus raw400/mitigated200；mana361→161；HP1000→450；t0/t79999/t80000 success/skip/success；mana99 resource skip。Backend 自包含 ensure `hero_draven` + level-1 八属性面板 + mana361；独立 R provider；可与 Q/W/E/basic 共存；无 AP；无 DDL/delete/live/publish。Wasm 英雄名 `_test.go` 仅为验收证据并排除生产构建；共享 harness 故意推迟。**不**宣称 cast/direction/projectile/travel/collision/sight/recast/reversal/return/homing/second-pass/execute/Adoration/multitarget/falloff/reset/map-edge/once-per-pass/完整 R 保真；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 R；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: draven-r-whirling-death-primary-outbound-hit-phase-a-v2`；正式最终 DESIGN_READY `run-08960edd-4b96-45fc-91d1-97d96a10c14c`，runDelta0，1707/1707 parseable events，61/61 complete tool groups，无 truncation/mutation/blockers；先前 v1 `run-816b8669-982b-4bd6-9334-8dc865200c7f` 为 valid REVISE——runDelta0，2236/2236，74/74，无 truncation/mutation；接受 issues：impl-gap 期望 56→55；one-case shared table 非最小故用英雄名 test-only 文件；**v2 为正式最终 READY 门控**；运行时/审计已提交）填写。下列验证结果按实现与主会话复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-26**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。当前 Built 与独立 Web 资产 hash 校验一致（见 §2.4）——**不是**本 test-only 切片重建或变更生产 Wasm。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN v1 REVISE | `run-816b8669-982b-4bd6-9334-8dc865200c7f` | REVISE；runDelta0；2236/2236；74/74；无 truncation/mutation；接受 impl-gap56→55 与 hero-named test-only | 接受校正；**不是**正式 READY |
| DESIGN_READY v2 | `run-08960edd-4b96-45fc-91d1-97d96a10c14c` | READY；runDelta0；1707/1707；61/61；无 truncation/mutation/blockers | **接受门控** |
| Backend owning | `0aa03bc6d0d98e5c21c8e29d6ebbd9f66e950532`；`run-63aff27e-36b5-4463-bde8-87ea2e3df5c7` | exact 3 paths；runDelta3/outside0；740 parseable；43/43 complete；无 truncation；seed28256/`b94b4568…fcb8`；JUnit40185/`a1103baf…3b35`；README310636/`96dfcc24…1b32` | 接受 |
| Wasm exact | `5b1f661283cb0ddcc5f7649992ce18934eb41ccb`；`run-2dc1d10e-cb71-4905-b523-53af6eb45193` | exact one `_test.go`；runDelta1/outside0；726 parseable；40/40 complete；无 truncation；test42169/`78796042…19de` | 接受 |
| 审计 | `5a6ba206dfd1c95649a3003f9b79898461010087`；`run-5399d7f1-fb57-48c1-93b2-9aa2d5088178` | exact 8 paths；runDelta8/outside0；1374 parseable；77/78 complete；唯一 incomplete=只读 grep running；主独立重跑验收 | 接受 |
| Web | 无本机制写入 | 当前 Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`（当前 hash 校验） | 接受；无 Web 变更 |

## 2. 验证结果（实现轮与主会话抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Draven/R` → `Template:Data Draven/Whirling Death` / 1307072 / 4040576 / 2026-07-06T14:27:37Z / 3079 / `e38551b6…08adce` |
| normalized / pages | 3361 / `74e8f95c…416754`；pages 698 / `d8f5a885…96863` 权威 |
| local raw caveat | 3079 / `1110179b…812059`；非源矛盾 |
| sourceCount | 仍为 12；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| 定向 Draven R | PASS（主会话） |
| `go test -count=1 ./...` | PASS（主会话） |
| `go run ./cmd/bench` | PASS（最新 main 跑 mean_us 97.90） |
| exact commit | `5b1f661283cb0ddcc5f7649992ce18934eb41ccb` |
| test bytes / SHA | `42169` / SHA256 `78796042ebd79f7337fd77de552150f9198d7ae5ec2348a6009f29bc5ae219de` |
| 实现 run | `run-2dc1d10e-cb71-4905-b523-53af6eb45193`；runDelta1/outside0；726 events；40/40 |
| 英雄名 `_test.go` 地位 | 验收/治理证据 only；排除生产构建；仅 generic 合同路径；共享 harness 故意推迟直至多同质用例；无英雄专用生产分支 |
| 生产 Wasm / Web 写入 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| 定向 Draven/Graves matrix | PASS 51 tests（主会话） |
| `mvn test` | PASS 1043 tests（主会话） |
| owning commit / run | `0aa03bc6d0d98e5c21c8e29d6ebbd9f66e950532`；`run-63aff27e-36b5-4463-bde8-87ea2e3df5c7`；runDelta3/outside0；740 events；43/43 |
| seed / JUnit / README SHA256 | seed28256 / `b94b456855f07eef71834cffbb9188e9819fa830c70908dde974c43e4acefcb8`；JUnit40185 / `a1103baf63527243ef50d30d2b381cc074b07f5ac907e21b960439371ecd3b35`；README310636 / `96dfcc24fdc50ffc08cbd2cf9da8d48f65e390ca022a38e1a62c91f1ea031b32` |
| seed 合同 | self-contained hero_draven + level-1 八属性 + mana361；独立 R；共存 Q/W/E/basic；无 AP；物理 20220/20170 |
| live seed execution | **未**执行 |

### 2.4 Web / 资产 hash 校验

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit | **无** |
| 当前 Built / 独立 Web 资产 | **1,169,377** / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`（相互匹配） |
| 说明 | **当前 hash 校验**；**不是**本 test-only 切片重建或变更生产 Wasm；无 production runtime 变更 |
| Playwright / live E2E | **未**执行 |

### 2.5 G8 / Unified / provisional

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / provisional / Wiki-only / Batch-G `--check` | PASS（主会话；本切片亦复跑） |
| `git diff --check` | PASS |
| G8 governed | `migrated`；exact 四 tags；空 `remainingGap` |
| Unified 254 | sourceCount12；completed103 / partial_actionable0 / ready0 / blocked_runtime70 / blocked_data3 / OOS72 / regression5 / stale1 |
| coverage | full103 / partial3 / none148 |
| actionable | 0 |
| registry 242 | migrated48 / partial5 / blocked120 / OOS69（不变） |
| G8 242 | migrated93 / partial4 / blocked76 / OOS69 |
| provisional | 73 = runtime70 / data3；hero71 / item2；Draven R 缺席；卡片仍 unverified |
| `implementation_gap_no_unresolved_data_fields` | **恰好 55**（Draven R 离开该家族） |
| digests | Unified `69832c2a…c018`；Wiki `927d8b5a…26c7`（不变） |
| 报告口径 | 严格 verified completion **103/254=40.6%**；completed+provisional coverage **176/254=69.3%** |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；总体 Goal 仍活跃；应对剩余 73 张 provisional 重新排序 |

### 2.6 审计切片（诚实记录）

| 验证 | 结果 |
| --- | --- |
| 审计接受 commit | `5a6ba206dfd1c95649a3003f9b79898461010087` |
| 审计 run | `run-5399d7f1-fb57-48c1-93b2-9aa2d5088178`；exact 8 paths；runDelta8/outside0；1374 parseable；77/78 complete tool groups；无 truncation |
| 不完整组 | 唯一 incomplete：只读 grep（`overrideLookup|exactKey...`）仅有 running 事件；**无** mutating 事件不完整 |
| 主独立验收 | 主会话因此独立重跑并接受全部 generator check 与 exact record/count 断言 |
| live / publish / push / E2E | 未执行 |

### 2.7 设计门控

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-08960edd-4b96-45fc-91d1-97d96a10c14c`（1707/1707；61/61；runDelta0） |
| v1 valid REVISE | `run-816b8669-982b-4bd6-9334-8dc865200c7f`（2236/2236；74/74；delta0）；impl-gap56→55 与 hero-named test-only 已接受；非正式 READY |
| Backend / Wasm / harness | self-contained；共存 Q/W/E/basic；英雄名 `_test.go`；共享 harness 故意推迟 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON / tasks | PASS（tasks=117；本切片写入后） |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `node tools/task-governance/cli.mjs docs wasm-generic-draven-whirling-death-primary-outbound-hit` | PASS |
| G8 / Unified / provisional / Wiki-only / Batch-G `--check` | 全部 PASS |
| `git diff --check` | PASS；仅四条 allowlist 路径变更 |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 check/rebuild/check） |
| SQLite | **未**触碰 |
| commit / push | **未**执行 |

## 4. 已实现边界

已实现：Rank-3 active cost；immediate selected-primary first-outbound physical hit scaffold；80000ms CD；一笔非暴击/不可复制物理 `400+1.50*(ad.resolved-ad.base)`（20220/20170）；CD/mana 探针；自动 `ability_started`；Backend 自包含；Wasm 测试-only 证据。排除（completed-boundary exclusions；**非** remaining blockers；**非**已建模近似）：cast timing、direction/projectile/travel/collision/sight、recast/reversal/return/homing/second pass、execute/Adoration、multi-target/falloff/reset/map edge/once-per-pass geometry、ranks1–2、siblings/basic/loadout、live/E2E/full-R/full-game fidelity。本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 R。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成。
