TASK_KEY: wasm-generic-kogmaw-living-artillery
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-24

# 通用 ABI 克格莫 R 活体大炮 Living Artillery 缺失生命倍率与叠层耗蓝机制验证记录

详细设计：[通用 ABI - 克格莫 R 活体大炮（Living Artillery）缺失生命倍率与叠层耗蓝机制详细设计](../../详细设计/wasm/通用ABI-克格莫R活体大炮LivingArtillery缺失生命倍率与叠层耗蓝机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_kogmaw|R|活体大炮`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Kog'Maw/R`，解析 `Template:Data Kog'Maw/Living Artillery`；page `1307963` / rev `4007636` / timestamp `2026-04-12T08:34:32Z`；canonical raw bytes `2453`；SHA256 `32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 为非规范 `2452` bytes / SHA256 `11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth`。governed tags 序：`ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_and_ap_ratio`、`missing_health_damage_multiplier`、`stack_escalating_mana_cost`、`timed_provider_state`。合同：Rank3 CD `1000ms`；cost `40*(1+provider.state.living_artillery_stacks)` 在 operations 之前；stacks default0/max9/8000ms/refresh-on-write；恰好两条有序 operations（op0 非暴击/不可复制主目标魔法伤害；op1 provider-scope add1）；零 listener / ability-start。基底嵌套二元 `add(add(180,0.75*(resolvedAD-baseAD)),0.45*AP)`（**永不**背书三元 `add`）；倍率 ≥40% HP 为 `1+min(0.5,(5/6)*missingFraction)`，`<40%` 恰好 `2`。交叉：baseAD61/resolvedAD141/AP100→base285；maxHP1000/MR100：current1000→`285/142.5`；current400→`427.5/213.75`；current399→`570/285`；t0/t999/t1000 mana500 两成功+一 CD skip、costs40/80、mana380/state2；mana119 首次40后 resource skip、mana79/state1；十次成功 cost40..400 合计2200/cap9；8000ms lazy expiry/refresh。**不**宣称 delay/location/geometry/multitarget/sight/reveal/stealth 或完整 Living Artillery/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: kogmaw-r-living-artillery-phase-a-v2`；唯一有效 DESIGN_REVIEW v2 READY `run-723a2309-4a41-45ef-ad37-288f052cef50`，strict `grok-4.5`，effort high，fast false，runDelta0/diff0，1628 parseable，73 unique tool calls completed，无 truncation/mutation/unfinished；v1 `run-aa3c9386-69f2-4396-8305-c93dcb2c0c1e` 为 `REVISE` 且非干净门控，**无效**；运行时/Web/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-24**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_REVIEW v2（有效） | `run-723a2309-4a41-45ef-ad37-288f052cef50` | READY；1628 parseable；73 calls completed；runDelta0/diff0 | **唯一接受门控** |
| DESIGN_REVIEW v1 | `run-aa3c9386-69f2-4396-8305-c93dcb2c0c1e` | `REVISE`（resourceGate 缺 provider context/lazy expiry）；orphaned grep/read-only | **无效**；非门控 |
| Backend 初始 | `100679a`；`run-4f56303d-52bf-4d85-8cf3-dfaba1308a41` | seed + focused10/10；集成 `175b03a` | 接受（后经公式纠正） |
| Backend 公式纠正 | `473bd50`；`run-41587930-8f62-4b77-abb6-703a499ab83b` | 三元 `add`→嵌套二元；递归 arity JUnit；focused10/10；full Maven **770/770**；集成 `d563b67` | 接受；**永不**背书旧公式 |
| Wasm 实现 | `run-d4d07603-abc6-4386-9a92-a5e7c5f0a9c5` | delta3/outside0；含 orphaned read-running | allowlisted diff/主张独立核验；**不得**当作干净设计门控 |
| Wasm 测试纠正 / exact | `d58370a`；`run-674066df-a9fe-48bb-9ca7-8e2f24f889ea` | delta1/outside0；嵌套二元 seed 断言 | 接受 |
| Web 资产同步 | `38b9229`；`run-bbd076d3-9f3c-4527-a9d8-5f7567853dc2` | delta1/outside0；资产 `1,169,377` / `65A4…C6A0` | 接受；当前已同步 |
| 审计 | `e81b5b6`；`run-6d79d49c-b8ee-4103-83b7-80a0f8112730` | G8/Unified/registry/Batch-G；delta6/outside0；一笔 orphaned read-running；无 truncation | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Kog'Maw/R` → `Template:Data Kog'Maw/Living Artillery` / 1307963 / 4007636 / 2026-04-12T08:34:32Z / 2453 / `32f8dd8d…1ca8641` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-r.json` |
| local raw caveat | 2452 bytes / SHA `11db6c16…d5e447`；sidecar/pages 权威；非字节等价；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| provider-state cost gate + Kog'Maw focused | PASS |
| focused `-count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| 标准 `scripts/build-wasm.ps1` TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `d58370a` |
| 实现 run orphaned read-running | 存在一笔 non-terminal orphaned read-running；**不得**表述为干净设计门控；运行时合同已独立核验 |
| 测试纠正 | `run-674066df-a9fe-48bb-9ca7-8e2f24f889ea` 更新嵌套二元 seed 断言；delta1/outside0 |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| 初始 owning focused JUnit | PASS（10/10）；owning `100679a`；集成 `175b03a` |
| 公式纠正后 focused / full | PASS（10/10；full Maven **770/770**）；owning `473bd50`；集成 `d563b67` |
| 公式合同 | 嵌套二元 `add(add(180,0.75*bonusAD),0.45*AP)` + 递归二元 arity JUnit；**永不**背书不兼容三元 `add` |
| seed 路径 | `db/game_manage/seeds/lol_generic_kogmaw_living_artillery_seed.sql` + `LolGenericKogmawLivingArtillerySeedSqlTest` |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 资产同步 commit | `38b9229`；run `run-bbd076d3-9f3c-4527-a9d8-5f7567853dc2`（delta1/outside0） |
| 同步前陈旧资产（历史） | `1,155,992` / SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A` |
| 同步后当前资产 | **1,169,377** / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（与 Wasm build 精确一致） |
| Main lint / typecheck / Vitest / build | PASS（Vitest 21 files / 330 tests） |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产**已**为本 build 同步；**不得**把更早机制的陈旧资产漂移当作 Kog'Maw R 当前限制 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / registry / Batch-G checks | PASS；242/254 keys/order 不变；仅 Kog'Maw R 记录/机制语义变化（metadata source hash/generatedAt 除外） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 六 tags（序同上）；空 `remainingGap` |
| Unified 254 | sourceCount 12；completed 75 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 98 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 75 / partial 3 / none 176 |
| actionable | 0 |
| G8 242 | migrated 65 / partial 4 / blocked 104 / OOS 69 |
| Wiki-only registry check | candidate 242；migrated 48 / partial 5 / blocked 120 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 80 |
| Unified evidence task-key count | 61（不同度量；**不是**治理 tasks 计数） |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `e81b5b6` |
| 审计 run | `run-6d79d49c-b8ee-4103-83b7-80a0f8112730`；runDelta6 / outside0；一笔 orphaned read-running；无 truncation；独立 generator checks 与语义比较 PASS |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控与公式纠正笔记

| 验证 | 结果 |
| --- | --- |
| 唯一有效设计门控 | v2 READY `run-723a2309-4a41-45ef-ad37-288f052cef50` |
| v1 地位 | `REVISE`；resourceGate 缺 provider context/lazy expiry；orphaned grep/read-only → **非**干净门控、**非** READY |
| 三元 `add` 纠正 | 编译器仅消费二元 args0/1；最终公式为嵌套二元；旧不兼容公式**不得**被背书 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=88） |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=88；invalid_rules/duplicate_assignments/missing_docs/invalid_headers/unassigned_docs 全 0；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| `node tools/agent-governance/cli.mjs check`（只读） | 既有 peer content_drift=3：`task_rules.json` @ `damage_viewer_project_planning` / `damage_backend_dev` / `damage_web_dev`；仅报告；**不** sync |

## 4. 已实现边界

已实现：Rank-3 active 动态 cost/cooldown；provider-aware cost gate（含 lazy expiry）；immediate primary-target scaffold；嵌套二元基底魔法伤害 × 缺失生命倍率；timed `living_artillery_stacks`（default0/max9/8000ms/refresh-on-write）；恰好两条有序 operations；阈值交叉与 CD/resource/cap 日程；Web 资产与当前 build 同步。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：0.6s delay、location/range/radius/projectile/arc/collision/travel/area/multitarget、sight/reveal/stealth、ranks1–2、P/Q/W/E/basic/combo、equipment/runes/loadout、spell shield、animation、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Living Artillery 保真。
