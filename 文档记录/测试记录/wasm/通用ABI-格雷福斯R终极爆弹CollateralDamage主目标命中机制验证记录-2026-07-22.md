TASK_KEY: wasm-generic-graves-collateral-damage-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 格雷福斯 R 终极爆弹 Collateral Damage 主目标命中机制验证记录

详细设计：[通用 ABI - 格雷福斯 R 终极爆弹（Collateral Damage）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-格雷福斯R终极爆弹CollateralDamage主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_graves|R|终极爆弹`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Graves/R`，解析 `Template:Data Graves/Collateral Damage`；page `1307373` / rev `4007499` / timestamp `2026-04-11T22:21:36Z`；canonical raw bytes `2722`；SHA256 `834843a7722fc9463e21e8d636b8adc644c220928b90f7bb4afedbaa08f85dd1`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/graves-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 为 `2723` bytes，恰含一个终端 LF；修剪该 LF 后得到 canonical bytes/hash——**terminal-LF materialization caveat**，**不是**源矛盾。边界：`rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage`。合同：Rank3 active 100 mana / 60000ms CD；immediate primary-target scaffold（cast delay / recoil / 弹道几何 / 直线多目标 / 爆炸锥 **显式排除**而非近似）；恰好一笔非暴击/不可复制物理 `575 + 1.50*bonus AD`。交叉：baseAD66 / resolvedAD120 / bonusAD54 → raw656；armor100 → mitigated328；t0/t59999/t60000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害；mana325 → final125；目标 HP1000 → final344。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`。Wiki 附加敌人减伤锥 `440 + 1.20 bonus AD` **仅**适用于额外敌人，对本主目标切片显式排除（非否认、未建模）。**不**宣称施放延迟/后坐力/弹道/直线多目标/爆炸锥或完整 Collateral Damage/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: graves-r-collateral-damage-primary-hit-phase-a-v2`；DESIGN_REVIEW_ONLY READY `run-51a3bb00-fc6b-4d01-9f66-d7fb0f3f47d7`，strict `grok-4.5`，effort high，fast false，结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=graves-r-collateral-damage-primary-hit-phase-a-v2`，runDeltaCount 0，792/792 parseable，无 truncation/mutation；权威 verdict = 完整 `createPlan` 事件；冻结 CD t0/t59999/t60000，忽略审查散文颠倒后两时间戳笔误；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-22**（驱动环境 Asia/Shanghai），即使构建工具打印更晚墙钟时间亦以本日期为准。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW_ONLY | `run-51a3bb00-fc6b-4d01-9f66-d7fb0f3f47d7` | READY；strict `grok-4.5`；effort high；fast false；runDelta0；792/792 parseable；权威 = `createPlan` |
| Backend owning | `9c1087b`；`run-bbfa015b-6d80-4349-8192-b5eb83108070` | seed + focused 39/39；full 723/723；delta3/outside0 |
| Backend → Wasm 集成 | `c2a8a97` | Backend 合入 Wasm 分支 |
| Wasm exact | `4abadf1`；`run-68881a1d-f746-4c95-add5-976e4ca9ee5c` | `generic_graves_collateral_damage_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 4/4；delta1/outside0 |
| Wasm gofmt | `run-3834b0bb-42c8-4c6e-8640-ef3ccf925284` | 机械 gofmt；delta1/outside0 |
| 审计 commit | `2f83a06`；`run-c71831ba-5fd7-4b61-8863-86c9e4551d0f` | G8/Unified/registry/Batch-G；final runDelta6/outside0；ordered keys 不变，仅 Graves R 解析对象语义变化 |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Graves/R` → `Template:Data Graves/Collateral Damage` / 1307373 / 4007499 / 2026-04-11T22:21:36Z / 2722 / `834843a7…f85dd1` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/graves-r.json` |
| local raw caveat | 2723 bytes；恰一终端 LF；修剪后 = canonical；terminal-LF materialization；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_graves_collateral_damage_primary_hit_test.go` | PASS（4/4） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（generic 100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`（相对既有 build **未变**） |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |
| runtime 伤害类型 | physical `20220`；无 magic `20221` |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（39/39） |
| owning full `mvn test` | PASS（723/723） |
| integrated | PASS（合入 `c2a8a97`） |
| seed 合同 | 自包含；baseline hp625/mana325/ad66/ap0/AS0.475/armor33/MR30/hpregen8/manaregen8；恰好九条属性；保留 P New Destiny / E Quickdraw / W Smoke Screen；独立 `provider_hero_graves_r_collateral_damage_primary_hit`；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| owning lint / typecheck / Vitest / build | PASS；Vitest 330 |
| integrated lint / typecheck / Vitest / build | PASS；Vitest 136 |
| 本机制 Web 源码变更 | 无（零写入） |
| Web Wasm 资产现状（独立限制，非机制 blocker） | 当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`；冻结计划零生产 Wasm/Web 写入，漂移未扩大亦未同步；报告为既有 artifact-currentness drift |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / registry / Batch-G checks | PASS；ordered keys 不变；仅 Graves R governed disposition/evidence 语义变化（除生成时间戳） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap`；raw upstream 为历史 provenance |
| Unified 254 | sourceCount 12；completed 70 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 103 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 70 / partial 3 / none 181 |
| actionable | 0 |
| G8 242 | migrated 60 / partial 4 / blocked 109 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 85 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `2f83a06` |
| 审计 run | `run-c71831ba-5fd7-4b61-8863-86c9e4551d0f`；final runDelta6 / outside0 |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=83；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` | PASS |
| `node tools/agent-governance/cli.mjs check`（只读；如触发） | 既有 peer drift 若存在则仅报告；**不** sync |

## 4. 已实现边界

已实现：Rank-3 active cost/cooldown；immediate primary-target impact scaffold（cast delay / recoil / 弹道 / 直线多目标 / 爆炸锥 **排除**）；单次非暴击/不可复制物理 `575+1.50*bonusAD`；CD/mana/HP 探针（t0/t60000 命中，t59999 阻挡；mana325→125；HP1000→344）。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast delay、recoil/displacement、projectile/travel/collision/range/speed/geometry、line/multitarget、explosion/cone、附加敌人 `440+1.20 bonus AD`、ranks1–2、P/E/W/basic/ammo/reload/True Grit/bonus resistance/on-hit/equipment/loadout、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Collateral Damage 保真。
