TASK_KEY: wasm-generic-vayne-final-hour-timed-bonus-ad
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-23

# 通用 ABI 薇恩 R 终极时刻 Final Hour 限时攻击力机制验证记录

详细设计：[通用 ABI - 薇恩 R 终极时刻（Final Hour）限时攻击力机制详细设计](../../详细设计/wasm/通用ABI-薇恩R终极时刻FinalHour限时攻击力机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_vayne|R|终极时刻`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Vayne/R`，解析 `Template:Data Vayne/Final Hour`；page `1309991` / rev `3807995` / timestamp `2024-11-05T22:07:10Z`；canonical raw bytes `2015`；SHA256 `e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/vayne-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 为非规范 `2012` bytes / SHA256 `343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement`。governed tags 序：`ability_cost_cooldown`、`cast_triggered_timed_bonus_ad`、`flat_ad_add`、`timed_provider_state`。合同：Rank3 active 80 mana / 70000ms CD；direct provider-scope override const1 `state_change` → `final_hour_active`（default0/max1/12000ms/refresh-on-write）；AD add `65 * provider.state.final_hour_active`；R **本身无伤害**；零 listener / 零 `ability_started`/`source_owner` scaffold。交叉：AD60→125→60；armor100 普攻物理探针激活中 `125/62.5`、到期后 `60/30`；t0/t69999/t70000 两次成功 + 恰好一次 CD skip（无 cost/state 写）；mana300→140；第二次成功重新武装。稳定键唯一为 `终极时刻`（对错写 `最终时刻` fail-closed；见 §2.7）。**不**宣称 Night Hunter/Tumble/隐身/takedown/动画或完整 Final Hour/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: vayne-r-final-hour-timed-bonus-ad-phase-a-v2-frozen`；有效 DESIGN_REVIEW_ONLY READY `run-5057146f-6059-43e2-a146-4575ef2236fe`，strict `grok-4.5`，effort high，fast false，`REVIEWED_PLAN_REV=vayne-r-final-hour-timed-bonus-ad-phase-a-v2`，1465/1465 parseable，97 tool calls 均 completed，无 truncation/内部委派/mutation，runDelta0/diff0；v1 READY 因嵌套 task 证据截断**无效**；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-23**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码或资产写入。本切片**未** rebuild SQLite / **未** `--fix-headers`。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_REVIEW_ONLY（有效） | `run-5057146f-6059-43e2-a146-4575ef2236fe` | 第三轮新鲜 READY；1465/1465；97 calls completed；runDelta0/diff0 | **接受为门控** |
| DESIGN_REVIEW v1 | （嵌套 task 证据截断） | READY 外观但 truncation | **无效**；非门控 |
| Backend 初始 | `4440c3d`；`run-15784837-0624-4bda-9410-b3d91e0eedac` | seed + focused10/10；full760/760；delta3/outside0；1019/1019 | 接受（后经稳定键纠正） |
| Backend → Wasm 初始集成 | `2710647` | Backend 合入 Wasm 分支 | 接受（后经纠正 cherry-pick） |
| Backend 稳定键纠正 | `8eb9f2a`；`run-f017e85b-5d1c-4194-bc3e-63dce8e1897e` | 主审检出 `最终时刻`→`终极时刻`；focused10/10；886/886；delta3/outside0 | 接受 |
| Backend 纠正集成 | `18dbff1` | 纠正合入 | 接受 |
| multi-worktree 镜像清理 | `run-a7d8aa5e-f015-47c4-a4c8-c92b1312a4d8` | 恢复被镜像写入的三处 Wasm 路径到 HEAD；runDelta3/outside0；未跟踪 Wasm 测试未动 | 接受为清理；**不**当作集成 |
| Wasm 初始 | `run-3f60586c-fe4d-48d5-99a8-e06223443f08` | delta1/outside0；含 orphaned read-running（不存在候选文件） | allowlisted diff/运行时主张独立核验；**不得**当作干净设计门控 |
| Wasm 稳定键纠正 / exact | `3a35a95`；`run-a204706f-6f37-4fac-9df8-5eeb90ab41ee` | focused 8 PASS；437/437；delta1/outside0 | 接受 |
| 审计 | `ce62f902`；`run-d0e7ff61-9b48-4422-8d30-6bfcfe9f4e5d` | G8/Unified/registry/Batch-G；delta6/outside0；1249/1249 | 接受 |
| Web | 无本机制源码变更 | 资产现状见 §2.4 | 报告-only |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Vayne/R` → `Template:Data Vayne/Final Hour` / 1309991 / 3807995 / 2024-11-05T22:07:10Z / 2015 / `e417f1cf…1e25d682d` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/vayne-r.json` |
| local raw caveat | 2012 bytes / SHA `343d19e3…7c7642`；sidecar/pages 权威；非字节等价；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_vayne_final_hour_timed_bonus_ad_test.go` | PASS（8/8；稳定键纠正后） |
| focused `-count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| 标准 `scripts/build-wasm.ps1` TinyGo / Wasm build | PASS；产物 1,168,476 bytes；前后 SHA256 不变 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666` |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime / Web 源码或资产写入 | 无 |
| 初始 Wasm run orphaned read-running | 存在一笔对不存在候选文件的 non-terminal read；**不得**表述为干净设计门控；运行时合同已独立核验 |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| 初始 owning focused JUnit | PASS（10/10）；full Maven 760/760 |
| 稳定键纠正后 focused / full | PASS（10/10；760/760） |
| integrated | PASS（`2710647` + 纠正 `18dbff1`） |
| seed 合同 | Batch-B `hero_vayne` / AD / mana 属性 check-only；自包含 ensure mana `232/232`；**不**写入 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values`；独立 `provider_hero_vayne_r_final_hour_timed_bonus_ad`；零 listener / ability-start scaffold；幂等 revision guard；无 DDL/DELETE/auto-publish/live |
| multi-worktree 镜像 | Cursor 编辑器曾把三处 Backend 纠正镜像进 Wasm；**未**接受为集成；cleanup run 恢复后正常 cherry-pick |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码变更 | 无（零写入） |
| Web Wasm 资产现状（独立限制，非机制 blocker） | 当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；冻结计划零生产 Wasm/Web 写入，漂移未扩大亦未同步；报告为既有 artifact-currentness drift |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / registry / Batch-G checks | PASS；242/254 keys/order 不变；仅 Vayne R 记录/机制语义变化（metadata source hash/generatedAt 除外） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（序同上）；空 `remainingGap` |
| Unified 254 | sourceCount 12；completed 74 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 99 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 74 / partial 3 / none 177 |
| actionable | 0 |
| G8 242 | migrated 64 / partial 4 / blocked 105 / OOS 69 |
| Wiki-only registry check | candidate 242；migrated 48 / partial 5 / blocked 120 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 81 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `ce62f902` |
| 审计 run | `run-d0e7ff61-9b48-4422-8d30-6bfcfe9f4e5d`；runDelta6 / outside0；1249/1249 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 稳定键 typo 检出与纠正（`最终时刻` → `终极时刻`）

| 验证 | 结果 |
| --- | --- |
| 主审发现 | Backend 初始实现出现错写 `最终时刻` |
| fail-closed 策略 | 稳定键/名称唯一接受 `终极时刻`；错写不得进入最终映射/标题/当前状态/汇总表 |
| Backend 纠正 | `run-f017e85b-5d1c-4194-bc3e-63dce8e1897e` → owning `8eb9f2a` → 集成 `18dbff1` |
| Wasm 纠正 | `run-a204706f-6f37-4fac-9df8-5eeb90ab41ee` → exact `3a35a95` |
| 文档/治理 | 本切片标题、headers、filenames、mappings、汇总全部使用 `终极时刻`；仅在本小节解释已检出并纠正的 typo |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=87；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` / 变更路径核对 | 仅四条 allowlist 路径变更 |
| `node tools/agent-governance/cli.mjs check`（只读；如触发） | 既有 peer drift 若存在则仅报告；**不** sync |

## 4. 已实现边界

已实现：Rank-3 active cost/cooldown；direct provider-scope override `final_hour_active`（12000ms / refresh-on-write）；flat AD add `65 * provider.state.final_hour_active`；AD60→125→60；armor100 普攻物理探针激活 `125/62.5` / 到期 `60/30`；t0/t69999/t70000 两成功 + 一 CD skip；mana300→140；第二次成功 re-arm；零 listener / 零 ability-start scaffold；R 无伤害。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：Night Hunter 移速/朝向、Tumble 冷却/施放/冲刺/重置、隐身/潜行、击杀延长/资格/上限、动画/弹道、ranks1–2、Vayne P/Q/W/E/basic/Silver Bolts/Condemn、items/runes/loadout、direct R damage/target effects、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Final Hour 保真。
