TASK_KEY: wasm-generic-azir-conquering-sands-one-soldier-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-27

# 通用 ABI 阿兹尔 Q 狂沙猛攻单沙兵选定主目标 Phase-A 验证记录

详细设计：[通用 ABI - 阿兹尔 Q 狂沙猛攻（Conquering Sands）单沙兵选定主目标 Phase-A 详细设计](../../详细设计/wasm/通用ABI-阿兹尔Q狂沙猛攻单沙兵选定主目标Phase-A详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_azir|Q|狂沙猛攻`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Azir/Q`，解析 `Template:Data Azir/Conquering Sands`；page `1306850` / rev `4024967` / timestamp `2026-06-04T07:26:59Z`；canonical raw bytes `2512`；SHA256 `168e2568c6795859e68831eb23b59b62d249aceb07cf3740403b1616516b51f2`；normalized sidecar bytes `3119` / SHA256 `9e2cfc28ced422699bbb40722ba46d82167c79f34bbd696f2fc4080e52120fb7` plus pages sibling bytes `684` / SHA256 `a15a3c54079cd8a75584c9725bb792441103ff27cafa31fa136d076791fa71f4` 为权威；sourceCount **仍为 12**。本地 raw materialization 为 `2510` bytes，SHA256 `6885ead987cae40fa37992d170337007629e3f12ebfc494eb3a1f54b5fb110e4`——**local raw materialization caveat**；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_assume_one_existing_sand_soldier_selected_primary_single_magic_hit; immediate_impact_scaffold; magic_140_plus_0_55_ap; mana110_listed_cooldown6000ms_scaffold; no_soldier_entity_spawn_count_formation_command_path_target_location_dash_collision_geometry_multitarget_slow_or_full_fidelity`。G8 governed tags 序：`ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`one_existing_soldier_selected_primary_hit_scaffold`。公式：`140+0.55*ap.resolved`（嵌套二元；AP path 恰好一次）；CritEligible false。交叉：AP0/MR0→140/140；AP100/MR100→195/97.5；mana330 t0/t5999/t6000 success/skip/success、mana110/HP805、两笔 Q damage、两次 `ability_started`；mana109 skip。一个既有沙兵仅为 caller/scenario 假定，永不状态门控。Backend external-existing-data/check-only；standalone Q；无 live。Wasm 英雄名 `_test.go` 仅为测试/治理证据并排除生产构建；**无**生产英雄 switch。**仅**单沙兵选定主目标单次魔法命中 Phase-A；**不**宣称完整 Q；Jhin P / Yunara P 仍 deferred；Aphelios OOS；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1`；DESIGN_READY `run-33d1ffcf-4e3f-4304-8b19-51bdbff92d68`；运行时/审计已提交）填写。下列验证结果按实现与主会话复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-27**。**本切片未发明 docs commit**（docs commit pending driver）。

本轮**未**执行 live migration、Admin publish、push、browser E2E、production TinyGo runtime、public ABI 或 Web 变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。本 test-only 切片**未**要求、亦**未**执行生产 Wasm/Web 资产重建。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-33d1ffcf-4e3f-4304-8b19-51bdbff92d68` | DESIGN_REVIEW_ONLY READY；strict grok-4.5/high/false；runDelta0/outside0；1671 parseable；无 truncation/mutation | **接受门控** |
| Backend owning | `dd214a3501601098f73267900aa6a199626d5b31`；`run-1a22222a-f467-4069-bdb7-b2729ff6fbed` | runDelta3/outside0；events1440；focused 37/37 PASS；driver full Maven 1132/1132 PASS；seed29560/`9263b65f…`；JUnit50880/`9409b991…`；external check-only；无 live | 接受 |
| Wasm exact | `5580ae77d30764de1b8f4974072f55680cce137b`；`run-04125cb2-8079-47b6-8b1a-fc795924d1ca` | runDelta1/outside0；events1447；exact `_test.go` bytes66442/`ea86be56…`；focused Azir 与四 sibling PASS；precommit full 仅 dirty-test；提交后 full `go test -count=1 ./...` 与 bench PASS；生产 runtime/ABI/Web/asset 不变 | **接受** |
| 审计首轮 | `run-2c236416-03a5-44ac-ac77-8cf17cc5c243` | 意图八路径 diff，但 Temp 下创建 `azir-pre-snapshot.json` / `azir-validate.mjs`；driver 已删除并确认缺席 | **拒绝** |
| 审计接受恢复 | `140ae71e71757bf698a50a0368ed10f31b87f098`；`run-daf2b308-5659-45ad-9dbf-e4e47efe9d3e` | finished；duration231462ms；runDelta0/outside0；events1115；无 truncation；无 mutation/Temp/仓库写入；ADOPTED；五 check + target-record/order/provisional-removal/override uniqueness + `git diff --check` PASS | **接受** |
| Web | 无本机制写入 | 无 Web / 生产 Wasm / public ABI 变更；**未**资产重建 | 接受 |

## 2. 验证结果（实现轮与主会话抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved / page / rev / timestamp / canonical / SHA | PASS；`Template:Data Azir/Q` → `Template:Data Azir/Conquering Sands` / 1306850 / 4024967 / 2026-06-04T07:26:59Z / 2512 / `168e2568…6b51f2` |
| normalized / pages | 3119 / `9e2cfc28…120fb7`；pages 684 / `a15a3c54…fa71f4` 权威 |
| local raw caveat | 2510 / `6885ead9…b110e4`；非源矛盾 |
| sourceCount | 仍为 12；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Azir / siblings / post-commit full Go / bench | PASS（Driver；`run-04125cb2…` 后提交验收） |
| exact commit | `5580ae77d30764de1b8f4974072f55680cce137b` |
| exact path | `generic_azir_conquering_sands_one_soldier_primary_hit_test.go`（仅新 `_test.go`） |
| bytes / SHA | 66442 / `ea86be56…e9887188` |
| 英雄名 `_test.go` 地位 | 测试/治理证据 only；排除生产构建；无生产英雄 switch / generic-runtime specialization |
| 生产 Wasm / Web 写入 / 资产重建 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| focused / full Maven | PASS 37/37；PASS 1132/1132（Driver） |
| owning commit / run | `dd214a3501601098f73267900aa6a199626d5b31`；`run-1a22222a-f467-4069-bdb7-b2729ff6fbed`；delta3/outside0；1440 events |
| seed 合同 | standalone Q；seed29560/`9263b65f…05eae149`；JUnit50880/`9409b991…26e4fb`；external check-only（hero_azir/AP/mana；不物化 identity/panel/resource）；无 live |
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
| 五审计 `--check` + target-record/order/provisional-removal/override uniqueness + `git diff --check` | PASS（Driver；接受 commit `140ae71e…`） |
| G8 governed | `migrated`；四 tags（G8 序）；空 `remainingGap` |
| Unified 254 | sourceCount12；completed113 / actionable0 / blocked_runtime60 / blocked_data3 / OOS72 / regression5 / stale1 |
| coverage | full113 / partial3 / none138 |
| registry 242 | migrated48 / partial5 / blocked120 / OOS69（不变） |
| G8 242 | migrated103 / partial4 / blocked66 / OOS69 |
| provisional | 63 = runtime60 / data3；hero62 / item1；**Azir Q 缺席** |
| `implementation_gap_no_unresolved_data_fields` | **为 52** |
| `blocked_runtime` + blocker `blocked_data` | **仍为 1**（勿与 impl-gap 混淆） |
| digests | Unified `69832c2a…c018`；Wiki `927d8b5a…26c7`（不变） |
| 报告口径 | 严格 verified completion **113/254=44.5%**；completed+provisional coverage **176/254=69.3%** |
| OOS / 真队列 | `out_of_scope=72` 为最终跳过分类，无实现/模板/后续队列；真剩余队列 **仅 63** = blocked_runtime60 + blocked_data3 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；总体 Goal 仍活跃 |

### 2.6 审计切片（含拒绝/恢复诚实记录）

| 验证 | 结果 |
| --- | --- |
| 首轮审计 run | `run-2c236416-03a5-44ac-ac77-8cf17cc5c243`；Temp scratch `azir-pre-snapshot.json` / `azir-validate.mjs`——**拒绝** |
| 接受恢复/采纳 | `run-daf2b308-5659-45ad-9dbf-e4e47efe9d3e`；delta0/outside0；1115 events；ADOPTED；无 Temp/仓库写入 |
| 接受审计 commit | `140ae71e71757bf698a50a0368ed10f31b87f098` |
| Driver 独立验收 | 五 checks + target-record/order/provisional-removal/override uniqueness + `git diff --check` PASS |
| live / publish / push / E2E | 未执行 |

### 2.7 设计门控

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-33d1ffcf-4e3f-4304-8b19-51bdbff92d68`（1671 events；grok-4.5/high/false；runDelta0；无 truncation/mutation） |
| Backend / Wasm | external check-only standalone seed；英雄名 `_test.go` 验收证据 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON / tasks | PASS（tasks=127；unique key；exact 两 docs；无其它 task delta） |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| G8 / Unified / provisional / Wiki-only / Batch-G `--check` | 全部 PASS（审计已接受；本切片复跑 check/diff） |
| `git diff --check` | PASS；仅四条 allowlist 路径变更 |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 check/rebuild/check） |
| SQLite | **未**触碰 |
| commit / push | **未**执行；**未**发明 docs commit（pending driver） |

## 4. 已实现边界

已实现：Rank-5 假定一个既有沙兵、选定主目标魔法 `140+0.55*ap.resolved`；mana110/listed CD scaffold 6000ms；恰好一笔非暴击/不可复制魔法伤害量子；CritEligible false；standalone Q provider；external check-only Backend；Wasm 测试-only 证据。排除（completed-boundary exclusions；**非** remaining blockers）：ranks1–4、soldier entity/spawn/count/formation/state/gate、command/path/dash/collision、target location/geometry/multitarget、slow、siblings/loadout、live/full fidelity。本闭环**恰好是一次假定单沙兵选定主目标魔法命中**，**不是**完整 Q。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成。
