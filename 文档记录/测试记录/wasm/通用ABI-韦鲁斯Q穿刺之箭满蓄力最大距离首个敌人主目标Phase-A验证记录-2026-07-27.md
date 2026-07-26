TASK_KEY: wasm-generic-varus-piercing-arrow-max-charge-primary-first-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-27

# 通用 ABI 韦鲁斯 Q 穿刺之箭满蓄力最大距离首个敌人主目标 Phase-A 验证记录

详细设计：[通用 ABI - 韦鲁斯 Q 穿刺之箭（Piercing Arrow）满蓄力最大距离首个敌人主目标 Phase-A 详细设计](../../详细设计/wasm/通用ABI-韦鲁斯Q穿刺之箭满蓄力最大距离首个敌人主目标Phase-A详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_varus|Q|穿刺之箭`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Varus/Q`，解析 `Template:Data Varus/Piercing Arrow`；page `1309981` / rev `4026469` / timestamp `2026-06-09T22:00:25Z`；canonical raw bytes `3888`；SHA256 `bdbbe064008b969e153800f7d5cdb305f84eca1ef043d8e6f8ce41c5db2659dd`；normalized sidecar bytes `4131` / SHA256 `bb5af7baaf053d1266a3702664c2df09e89f67c6125e8cf6da15f28f5b0c1f8e` plus pages sibling bytes `689` / SHA256 `85975963850f79395fbeec142049176aa945a3728bcecc55ca01a7863d849f61` 为权威；sourceCount **仍为 12**。本地 raw materialization 为 `3888` bytes，SHA256 `5a350cecb53d37bd2640f7de3398c1be0a798a75f88c42eb327933920d487962`——**local raw materialization caveat**；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_max_charge_max_range_selected_primary_first_enemy_physical_hit; immediate_impact_scaffold; physical_360_plus_1_20_bonus_ad; mana70_listed_cooldown12000ms_scaffold; no_real_charge_channel_post_effect_cooldown_start_charge_duration_cooldown_reduction_pierce_falloff_projectile_geometry_blight_or_full_fidelity`。G8 governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`max_charge_max_range_selected_primary_first_hit_scaffold`。公式：`360+1.20*(ad.resolved-ad.base)`（嵌套二元；每条 AD path 恰好一次）；CritEligible false。交叉：baseAD60/resolved60/armor0→360/360；baseAD60/resolved160/armor100→480/240；mana210 t0/t11999/t12000 success/skip/success、mana70/HP520、两笔 Q damage、两次 `ability_started`；mana69 skip。Backend external-existing-data/check-only；standalone Q；与 W 共存；无 live。Wasm 英雄名 `_test.go` 仅为测试/治理证据并排除生产构建；**无**生产英雄 switch。**仅**满蓄力最大距离选定主目标首个敌人物理命中 Phase-A；**不**宣称完整 Q；Jhin P / Yunara P 仍 deferred；Aphelios OOS；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: varus-q-piercing-arrow-max-charge-primary-first-hit-phase-a-v1`；DESIGN_READY `run-0d43518f-0708-43c5-a9ab-3e34d3ad9e11`；运行时/审计已提交）填写。下列验证结果按实现与主会话复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-27**。**本切片未发明 docs commit**（docs commit pending driver）。

本轮**未**执行 live migration、Admin publish、push、browser E2E、production TinyGo runtime、public ABI 或 Web 变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。本 test-only 切片**未**要求、亦**未**执行生产 Wasm/Web 资产重建。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_READY | `run-0d43518f-0708-43c5-a9ab-3e34d3ad9e11` | DESIGN_REVIEW_ONLY READY；strict grok-4.5/high/false；runDelta0；1811 parseable；无 truncation/mutation | **接受门控** |
| Backend owning | `d4937812733e819e34fd6328240295848c75d17b`；`run-9a1fea38-a17f-4d9b-b4a1-a4229316933c` | runDelta3/outside0；events927；focused sibling JUnit 38/38 PASS；driver full Maven 1123/1123 PASS；seed29472/`7cef8329…`；JUnit50874/`ebb54d0c…`；无 live | 接受 |
| Wasm 中断 run | `run-177243d7-bbee-4f36-9485-9c9e82c6a14b` | 1095 parseable；in-scope edits 存在；driver 于正常完成前终止 | **不是**接受完成 run |
| Wasm 无增量复验 | `run-c277c097-4b20-49c1-927c-fafc114e02a9` | finished；events698；runDelta0/outside0；focused Q 与 Q+W 及 bench PASS；precommit full 仅既有 dirty-test 策略失败 | 接受复验 |
| Wasm 格式修复 | `run-74661f4a-2dc6-489d-ab18-2391736e383e` | runDelta1/outside0/events291；仅 exact test；`gofmt -d` clean | 接受格式修复 |
| Wasm exact | `df617949ffe39ee4733a2fbb300444833f612849` | post-format bytes63048/`a52e2f41…`；提交后 full `go test -count=1 ./...` PASS 与 bench PASS；生产 runtime/ABI/Web/asset 不变 | **接受** |
| 审计首轮 | `run-ff3cae8e-aed8-44cd-839e-76894a07985c` | 900000ms 超时；events 显示临时 create/delete `_debug_varusq.mjs` outside allowlist（尽管最终 outside0） | **拒绝** |
| 审计接受续跑 | `3a1e11d5db6218da8e4a68b33eb8646e1a304320`；`run-993a88d4-3ac4-4f0f-9471-f4ec5ebf5341` | finished；runDelta3/outside0；events762；无 truncation；无 temp/outside mutation；五 check + unique override/single-record drift/order PASS | **接受** |
| Web | 无本机制写入 | 无 Web / 生产 Wasm / public ABI 变更；**未**资产重建 | 接受 |

## 2. 验证结果（实现轮与主会话抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved / page / rev / timestamp / canonical / SHA | PASS；`Template:Data Varus/Q` → `Template:Data Varus/Piercing Arrow` / 1309981 / 4026469 / 2026-06-09T22:00:25Z / 3888 / `bdbbe064…db2659dd` |
| normalized / pages | 4131 / `bb5af7ba…0c1f8e`；pages 689 / `85975963…849f61` 权威 |
| local raw caveat | 3888 / `5a350cec…487962`；非源矛盾 |
| sourceCount | 仍为 12；无新源 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused Q / Q+W / bench | PASS（Driver；`run-c277c097…`） |
| post-commit full Go / bench | PASS `go test -count=1 ./...`；PASS `go run ./cmd/bench`（Driver；接受 commit 后） |
| exact commit | `df617949ffe39ee4733a2fbb300444833f612849` |
| exact path | `generic_varus_piercing_arrow_max_charge_primary_first_hit_test.go`（仅新 `_test.go`） |
| bytes / SHA | 63048 / `a52e2f41…c1c3fa5a` |
| 实现历史 | 中断 `run-177243d7…` 非接受；复验 `run-c277c097…` delta0；gofmt `run-74661f4a…` delta1 |
| 英雄名 `_test.go` 地位 | 测试/治理证据 only；排除生产构建；无生产英雄 switch / generic-runtime specialization |
| 生产 Wasm / Web 写入 / 资产重建 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| focused sibling / full Maven | PASS 38/38；PASS 1123/1123（Driver） |
| owning commit / run | `d4937812733e819e34fd6328240295848c75d17b`；`run-9a1fea38-a17f-4d9b-b4a1-a4229316933c`；delta3/outside0；927 events |
| seed 合同 | standalone Q；seed29472/`7cef8329…23579929`；JUnit50874/`ebb54d0c…69e6919`；external check-only；与 W 共存；无 live |
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
| 五审计 `--check` + unique override/single-record drift/order + `git diff --check` | PASS（Driver；接受 commit `3a1e11d…`） |
| G8 governed | `migrated`；四 tags（G8 序）；空 `remainingGap` |
| Unified 254 | sourceCount12；completed112 / actionable0 / blocked_runtime61 / blocked_data3 / OOS72 / regression5 / stale1 |
| coverage | full112 / partial3 / none139 |
| registry 242 | migrated48 / partial5 / blocked120 / OOS69（不变） |
| G8 242 | migrated102 / partial4 / blocked67 / OOS69 |
| provisional | 64 = runtime61 / data3；hero63 / item1；**Varus Q 缺席** |
| `implementation_gap_no_unresolved_data_fields` | **仍为 53** |
| `blocked_runtime` + blocker `blocked_data` | **仍为 1**（勿与 impl-gap 混淆） |
| digests | Unified `69832c2a…c018`；Wiki `927d8b5a…26c7`（不变） |
| 报告口径 | 严格 verified completion **112/254=44.1%**；completed+provisional coverage **176/254=69.3%** |
| OOS / 真队列 | `out_of_scope=72` 为最终跳过分类，无实现/模板/后续队列；真剩余队列 **仅 64** = blocked_runtime61 + blocked_data3 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；总体 Goal 仍活跃 |

### 2.6 审计切片（含拒绝/续跑诚实记录）

| 验证 | 结果 |
| --- | --- |
| 首轮审计 run | `run-ff3cae8e-aed8-44cd-839e-76894a07985c`；900000ms 超时；临时 `_debug_varusq.mjs` outside——**拒绝** |
| 接受续跑 | `run-993a88d4-3ac4-4f0f-9471-f4ec5ebf5341`；delta3/outside0；762 events；无 truncation；无 temp/outside |
| 接受审计 commit | `3a1e11d5db6218da8e4a68b33eb8646e1a304320` |
| Driver 独立验收 | 五 checks + unique override/single-record drift/order PASS |
| live / publish / push / E2E | 未执行 |

### 2.7 设计门控

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-0d43518f-0708-43c5-a9ab-3e34d3ad9e11`（1811 events；grok-4.5/high/false；runDelta0；无 truncation/mutation） |
| Backend / Wasm | external check-only standalone seed；英雄名 `_test.go` 验收证据 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON / tasks | PASS（tasks=126；unique key；exact 两 docs；无其它 task delta） |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| G8 / Unified / provisional / Wiki-only / Batch-G `--check` | 全部 PASS（审计已接受；本切片复跑 check/diff） |
| `git diff --check` | PASS；仅四条 allowlist 路径变更 |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；主会话将 check/rebuild/check） |
| SQLite | **未**触碰 |
| commit / push | **未**执行；**未**发明 docs commit（pending driver） |

## 4. 已实现边界

已实现：Rank-5 满蓄力/最大距离选定主目标（首个敌人）物理 `360+1.20*(ad.resolved-ad.base)`；mana70/listed CD scaffold 12000ms；恰好一笔非暴击/不可复制物理伤害量子；CritEligible false；standalone Q provider；与 W 共存；external check-only Backend；Wasm 测试-only 证据。排除（completed-boundary exclusions；**非** remaining blockers）：ranks1–4、variable charge/channel/release/cancel/interrupt、post-effect cooldown-start、charge-duration input、CD reduction while charging、real projectile/geometry、pierce/falloff/multitarget、Blight/W coupling、refund、animation/VFX、loadout、live/full fidelity。本闭环**恰好是一次满蓄力最大距离选定主目标首个敌人物理命中**，**不是**完整 Q。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成。
