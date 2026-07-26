TASK_KEY: wasm-generic-ezreal-arcane-shift-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-24

# 通用 ABI 伊泽瑞尔 E 奥术跃迁 Arcane Shift 主目标命中机制验证记录

详细设计：[通用 ABI - 伊泽瑞尔 E 奥术跃迁（Arcane Shift）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-伊泽瑞尔E奥术跃迁ArcaneShift主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_ezreal|E|奥术跃迁`：`completed/full/generic_runtime`（G8 governed `migrated` exact override `hero_ezreal|E`；保留 raw classification/tags/auditBaseline provenance）。Wiki：请求 `Template:Data Ezreal/E`，解析 `Template:Data Ezreal/Arcane Shift`；page `1307111` / rev `3989862` / timestamp `2026-02-03T23:19:20Z`；canonical raw bytes `1661`；SHA256 `7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 亦为 `1661` bytes / SHA256 `f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks`。governed tags 序：`ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（Unified canonical tags locale-sorted，同一精确集合）。合同：Rank5 70 mana / 14000ms CD；immediate primary-champion scaffold；恰好一笔非暴击/不可复制魔法 `add(add(280,0.60*(resolvedAD-baseAD)),0.75*AP)`；成功命中保留 Rising Spell Force 一层。交叉：baseAD60/resolvedAD110/AP200→raw460/MR100 mitigated230；分支 280/140、310/155、430/215、460/230；mana210 t0/t13999/t14000 → 两成功+一 CD skip、final mana70、HP540；mana69 → resource skip/不变/无事件。P 共存：E 成功 t0 + E CD skip t100 → 恰好一笔 E 伤害、一次 `ability_started`、一层 P stack、AS1.1。Backend seed ability/graph 自洽；`hero_ezreal`/ad/ap/mana **check-only**（不物化）；既有 P/R graphs 未触碰。**不**宣称 blink/homing/选敌/可见性/Essence Flux/弹道/reveal 或完整 Arcane Shift/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: ezreal-e-arcane-shift-primary-hit-phase-a-v3`；DESIGN_REVIEW READY `run-5b85f4a8-12d0-4bb6-ae0f-bfdaf86ceffb`，runDelta0/diff0，74 events / 37 unique direct calls all terminal，无 truncation/orphans/mutations，无 user decision；接受非阻塞：G8 override key=`hero_ezreal|E` 非完整 candidate key；较早 v1 `run-b73bbc17-2469-49a0-a3b8-d94a966e3cb7` / v2 `run-2a36db44-cd0f-4426-b8b7-f7f59ac24ea4` 文本 READY 因 orphaned read(s) **无效**，**不是**门控；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-24**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_REVIEW READY | `run-5b85f4a8-12d0-4bb6-ae0f-bfdaf86ceffb` | READY；74 events / 37 unique calls all terminal；runDelta0/diff0；无 truncation/orphans/mutations；无 user decision | **接受门控**（v3）；v1/v2 因 orphaned read(s) 无效；override key 非阻塞已接受 |
| Backend owning / 集成 | owning `89e6677`；集成 `0594b20`；`run-7a22587d-d67b-41b8-9180-7750db96f470` | 102 events / 44 unique calls all terminal；delta3/outside0；focused8/8；full Maven **805/805**；无 live seed | 接受 |
| Wasm exact | `065beb1`；`run-2cede25b-a62b-48ab-b6b4-1e41f27ee8eb` | 114 events / 53 unique calls all terminal；delta1/outside0；无 truncation/orphans；`-run EzrealArcaneShift -count=100` + full Go PASS | 接受；前两次 IMPLEMENTATION no-op/非接受 |
| Web | 无本机制写入 | 资产保持 `1,169,377` / `65A4…C6A0` 同步不变 | 接受；test-only Wasm 追加后资产未变 |
| 审计 | `8d776967…`；`run-a183dc38-5a80-4119-9503-bf39a1cb3d65` | G8/Unified/registry/Batch-G；169 events / 79 unique calls all terminal；runDelta6/outside0；无 truncation/orphans；仅 Ezreal E 语义对象变化 | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Ezreal/E` → `Template:Data Ezreal/Arcane Shift` / 1307111 / 3989862 / 2026-02-03T23:19:20Z / 1661 / `7ac83f7e…27347` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-e.json` |
| local raw caveat | 1661 bytes / SHA `f48a3270…01792`；sidecar/pages 权威；非字节等价主张；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `go test ./internal/runtime -run EzrealArcaneShift -count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| 标准 `scripts/build-wasm.ps1` TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `065beb1e13f21b92e010500cf493eae444876946` |
| 接受实现 run | `run-2cede25b-a62b-48ab-b6b4-1e41f27ee8eb`；114 events / 53 unique calls all terminal；delta1/outside0；无 truncation/orphans |
| 前两次 fresh IMPLEMENTATION | `run-ba28be1e-bef0-4dcf-becf-682a8dc49337`（delta0；一笔 orphan；无文件）与 `run-abd75288-3a65-4ad8-99ed-1630adc2c6f1`（status error；delta0；无文件）——no-op/**未接受** |
| 生产 Wasm 写入/commit | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（8/8）；owning `89e66774cd37f3cd49992d884a600a85cebf9cfe` |
| owning full Maven | PASS（**805/805**）；集成 `0594b2044f99722b4e8ff07594061e0d78b3d176` |
| 实现 run | `run-7a22587d-d67b-41b8-9180-7750db96f470`；102 events / 44 unique calls all terminal；delta3/outside0 |
| seed 合同 | `db/game_manage/seeds/lol_generic_ezreal_arcane_shift_primary_hit_seed.sql` + `LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest` + README；ability/graph 自洽；`hero_ezreal`/ad/ap/mana check-only（不物化）；不触碰既有 P/R；嵌套二元 `280+0.60*bonusAD+0.75*AP` |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit | **无** |
| 当前源资产 | **1,169,377** / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（与标准 Wasm build 精确一致；本轮 test-only Wasm 追加后**保持同步且不变**） |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本 test-only Wasm 追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / registry / Batch-G checks | PASS；242/254 keys/order 不变；仅 Ezreal E 记录/机制语义变化（metadata source hash/generatedAt 除外） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 五 tags（序同上）；空 `remainingGap`；exact override `hero_ezreal\|E`；保留 raw baseline provenance |
| Unified 254 | sourceCount 12；completed 79 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 94 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 79 / partial 3 / none 172 |
| actionable | 0 |
| G8 242 | migrated 69 / partial 4 / blocked 100 / OOS 69 |
| Wiki-only registry check | candidate 242；migrated 48 / partial 5 / blocked 120 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 77 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `8d7769677285cfde65af3596318137be8651c7ee` |
| 审计 run | `run-a183dc38-5a80-4119-9503-bf39a1cb3d65`；strict model；runDelta6 / outside0；169 events / 79 unique calls all terminal；无 truncation/orphans；四 generator checks PASS；直接语义比较证明 G8/Unified key order 不变且仅 Ezreal E 对象变化 |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-5b85f4a8-12d0-4bb6-ae0f-bfdaf86ceffb`（v3） |
| 接受非阻塞 | G8 override key 为 owner/skill `hero_ezreal\|E`，不是完整 candidate key |
| 较早 v1 | `run-b73bbc17-2469-49a0-a3b8-d94a966e3cb7` 文本 READY；因一笔 orphaned read **无效**；**不是**门控 |
| 较早 v2 | `run-2a36db44-cd0f-4426-b8b7-f7f59ac24ea4` 文本 READY；因两笔 orphaned reads **无效**；**不是**门控 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=92） |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=92；invalid_rules/duplicate_assignments/missing_docs/invalid_headers/unassigned_docs 全 0；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| `node tools/agent-governance/cli.mjs check`（只读） | 既有 peer content_drift=3：`task_rules.json` @ `damage_viewer_project_planning` / `damage_backend_dev` / `damage_web_dev`；仅报告；**不** sync |

## 4. 已实现边界

已实现：Rank5 immediate primary-champion scaffold；70 mana / 14000ms CD；单次非暴击/不可复制魔法 `280+0.60*(resolvedAD-baseAD)+0.75*AP`（嵌套二元）；成功命中保留 Rising Spell Force 一层；分支与默认交叉；mana210 CD 日程与 mana69 resource skip；既有 Ezreal P 共存；Web 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：blink/homing/nearest-target selection/visibility/Essence Flux priority、projectile/travel/reveal、ranks1–4、other Ezreal skills/basic、loadout/crit/on-hit、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Arcane Shift 保真。
