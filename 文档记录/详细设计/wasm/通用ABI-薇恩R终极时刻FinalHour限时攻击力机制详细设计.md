TASK_KEY: wasm-generic-vayne-final-hour-timed-bonus-ad
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-23

# 通用 ABI - 薇恩 R 终极时刻（Final Hour）限时攻击力机制详细设计

关联验证记录：[通用 ABI 薇恩 R 终极时刻 Final Hour 限时攻击力机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_vayne|R|终极时刻` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 Night Hunter 移速/朝向、Tumble 冷却/施放/冲刺/重置、隐身/潜行、击杀延长/资格/上限、动画/弹道变化，或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV vayne-r-final-hour-timed-bonus-ad-phase-a-v2`（第三轮新鲜 DESIGN_REVIEW_ONLY READY `run-5057146f-6059-43e2-a146-4575ef2236fe`；strict `grok-4.5`；effort high；fast false；结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=vayne-r-final-hour-timed-bonus-ad-phase-a-v2`；1465/1465 parseable；97 tool calls 均 completed；无 truncation / 内部委派 / mutation；runDelta0 / diff0。v1 READY 因嵌套 task 证据截断**无效**，不得作为门控；其 ability-start listener 串扰发现已由 v2 直接 `state_change` 吸收）。稳定键/名称唯一为 `终极时刻`；对已知错写 fail-closed（检出与纠正过程见验证记录）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_vayne\|R\|终极时刻` |
| Wiki | 请求 `Template:Data Vayne/R`，解析为 `Template:Data Vayne/Final Hour`；pageId `1309991`；revision `3807995`；timestamp `2024-11-05T22:07:10Z`；canonical raw bytes `2015`；SHA256 `e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/vayne-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw 为非规范 `2012` bytes / SHA256 `343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement` |
| governed tags（序） | `ability_cost_cooldown`、`cast_triggered_timed_bonus_ad`、`flat_ad_add`、`timed_provider_state` |
| Rank-3 active | 80 mana；70000ms cooldown；成功施放后 **direct provider-scope override** `const1` `state_change` → `final_hour_active`（default0 / max1 / 12000ms / refresh-on-write）；source AD add `65 * provider.state.final_hour_active`；R **本身无伤害** |
| 数值交叉 | fixture AD60 → 激活 125 → 到期 60；armor100 普攻物理探针：激活中 raw/mitigated `125/62.5`，到期后 `60/30`。t0 / t69999 / t70000：两次成功施放 + 恰好一次 cooldown skip（不扣 mana、不写状态）；mana300 → final140；第二次成功施放重新武装状态 |
| 结构约束 | **零** listener 行；**零** `ability_started` / `source_owner` scaffold |
| seed 执行前置 | Backend seed 对 Batch-B `hero_vayne` 身份与 AD/mana 属性定义/实体值为 **check-only**；自包含 ensure mana 资源投影 `232/232`；**不**写入 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values`。Fixture mana300 仅属 Wasm 夹具，不与 Backend seed 混用。此为文档化 seed 执行前置，**不是**未解决公式/Wiki 数据缺口 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A 架构与排除

本机制是 **cast 触发的限时 provider-state 自增益**：null-duration impact + on_enter sequence → 单一 direct `state_change`（override const1 / `state_scope/provider`）；AD modifier 以 `provider.state.final_hour_active` 门控 flat add。**不是** ability-start listener 近似，也**不是** Night Hunter / Tumble / stealth / takedown 的部分建模。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| Night Hunter movement speed / direction | 移速与朝向增益全部排除 |
| Tumble cooldown / cast / dash / reset | Tumble 冷却缩减、施放、冲刺、重置全部排除 |
| invisibility / stealth | 隐身与潜行全部排除 |
| takedown / qualification / extension / cap | 击杀资格、延长、上限全部排除 |
| animation / projectile changes | 动画与弹道外观变化排除 |
| ranks 1–2 | 仅 Rank3 |
| Vayne P / Q / W / E / basic / Silver Bolts / Condemn | 无其它技能/普攻/圣银弩箭/恶魔审判耦合；若既有 provider 已存在则保留，缺失亦不作为本 seed 前置 |
| items / runes / loadout | 无装备/符文/负荷耦合 |
| direct R damage / target effects | R 本身无伤害与目标效果 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki vayne-r.json (page1309991/rev3807995；canonical SHA e417f1cf…)
  → Backend seed（Batch-B identity/AD/mana check-only；self-contained mana ensure 232/232；
     provider_hero_vayne_r_final_hour_timed_bonus_ad）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 单一 provider-scope state_change（final_hour_active=1；12000ms；refresh_on_write）
    → source AD add 65 * provider.state.final_hour_active
    → fixture-only armor100 普攻物理探针（激活 125/62.5；到期 60/30）；R 无伤害
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql`：Batch-B `hero_vayne` / AD / mana 属性 **check-only**；自包含 ensure mana 资源 `232/232`；仅挂载独立 `provider_hero_vayne_r_final_hour_timed_bonus_ad`；一条 active ability（80 mana / 70000ms）、timed provider state `final_hour_active`、AD add modifier、null-duration impact + on_enter → 单一 `state_change`；**零** listener / `ability_started` / `source_owner`。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。初始 owning `4440c3d` / 集成 `2710647`；主审检出稳定键错写后纠正 owning `8eb9f2a` / 集成 `18dbff1`（见验证记录）；focused JUnit 10/10；full Maven 760/760 |
| Web | 既有 generic 投影；**无**本任务 Web 源码变更（零写入）。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `3a35a95`（`wasm/tinygo_engine_v2/internal/runtime/generic_vayne_final_hour_timed_bonus_ad_test.go`）；真实 CompileGeneric / RunGeneric；focused 8/8、`-count=100` 与 full `go test -count=1 ./...` PASS；标准 `scripts/build-wasm.ps1` TinyGo build PASS（1,168,476 bytes；前后 SHA256 不变 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime / Web 源码或资产写入 |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放 | 扣 80 mana；写入 `final_hour_active`；AD60→125；CD 武装 |
| 激活窗口内 armor100 普攻物理探针 | raw/mitigated `125/62.5` |
| 状态到期（12000ms） | AD125→60；探针回 `60/30` |
| t69999（CD 内） | 恰好一次 cooldown skip；不扣 mana、不写状态 |
| t70000 再次成功 | 再扣 80 mana；重新武装状态；mana300→140 |
| 失败/停止 | Batch-B 前置缺失 fail-closed；既有无关 resource 冲突 fail-closed；禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW_ONLY READY（有效门控） | 第三轮新鲜 `run-5057146f-6059-43e2-a146-4575ef2236fe`；strict `grok-4.5`；effort high；fast false；`REVIEWED_PLAN_REV=vayne-r-final-hour-timed-bonus-ad-phase-a-v2`；READY；1465/1465 parseable；97 tool calls 均 completed；无 truncation/内部委派/mutation；runDelta0 / diff0 |
| DESIGN_REVIEW v1（无效） | 嵌套 task 证据截断；**不是**门控证据；ability-start listener 串扰发现已由 v2 direct `state_change` 吸收 |
| Backend 初始 owning / 集成 | owning `4440c3d`；集成 `2710647`；实现 run `run-15784837-0624-4bda-9410-b3d91e0eedac`（delta3/outside0；1019/1019；无 truncation；focused10/10；full Maven760/760） |
| Backend 稳定键纠正 | 主审检出稳定键错写（细节见验证记录）；纠正 run `run-f017e85b-5d1c-4194-bc3e-63dce8e1897e`（delta3/outside0；886/886；focused10/10）；owning `8eb9f2a`；集成 `18dbff1` |
| Backend→Wasm 镜像清理 | Cursor 多 worktree 编辑器曾将三处 Backend 纠正镜像写入 Wasm（**不**接受为集成）；cleanup `run-a7d8aa5e-f015-47c4-a4c8-c92b1312a4d8` 将这三处 Wasm 路径恢复 HEAD（runDelta3/outside0；既有未跟踪 Wasm 测试未动），再正常 cherry-pick 纠正 owning commit |
| Wasm exact | `3a35a95`；初始实现 `run-3f60586c-fe4d-48d5-99a8-e06223443f08`（delta1/outside0；含一笔对不存在候选文件的 orphaned read-running，该单次 read 非终端证据，但 allowlisted diff 与运行时主张已独立核验——**不得**当作干净设计门控）；稳定键纠正 `run-a204706f-6f37-4fac-9df8-5eeb90ab41ee`（delta1/outside0；437/437；focused 8 PASS） |
| 审计 commit | `ce62f902`；实现 run `run-d0e7ff61-9b48-4422-8d30-6bfcfe9f4e5d`（delta6/outside0；1249/1249；无 truncation） |
| 最终清单 | G8 242 = migrated64 / partial4 / blocked105 / OOS69；Unified sourceCount12 / total254；completed74 / partial_actionable0 / ready0 / blocked_runtime99 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full74 / partial3 / none177；actionable0；`implementation_gap_no_unresolved_data_fields=81`；Wiki-only registry check candidate242 / migrated48 / partial5 / blocked120 / OOS69；Batch-G check PASS；242/254 keys/order 不变 |

## 6. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|cast_triggered_timed_bonus_ad|flat_ad_add|timed_provider_state`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 242/254 不变；**仅** Vayne R 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状限制（非 Vayne R 机制 blocker）**：冻结计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`。记录为独立 artifact-currentness 限制，**不得**误读为 Vayne R 机制未闭环；**不得**在本切片同步资产。

非目标（再次强调）：Night Hunter 移速/朝向、Tumble 冷却/施放/冲刺/重置、隐身/潜行、击杀延长/资格/上限、动画/弹道、ranks1–2、Vayne P/Q/W/E/basic/Silver Bolts/Condemn、items/runes/loadout、direct R damage/target effects、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Final Hour/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Batch-B check-only 与自包含 mana ensure 是 seed 执行合同，**不是**未解决数据缺口。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1309991 / rev3807995 / timestamp2024-11-05T22:07:10Z / canonical raw2015 / SHA256 `e417f1cf…1e25d682d`；sidecar/pages canonical；local raw2012 materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_vayne\|R\|终极时刻`；对已知错写 fail-closed（见验证记录） |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | Rank3 80 mana / 70000ms；AD60→125→60；探针 125/62.5 与 60/30；t0/t69999/t70000 两成功 + 一 CD skip；mana300→140；零 listener / ability-start scaffold；R 无伤害 |
| Backend | 初始 `4440c3d`/`2710647` + 纠正 `8eb9f2a`/`18dbff1`；focused10/10；full760/760 |
| Wasm | exact `3a35a95`；focused8/8；full Go / `-count=100` / 标准脚本 TinyGo / Node smoke PASS；产物字节/SHA 不变 |
| 审计 | commit `ce62f902`；G8 migrated + 空 remainingGap；Unified completed/full；counts 与 §5 最终清单一致 |
| 设计门控 | 仅第三轮新鲜 READY `run-5057146f…` 有效；v1 截断无效 |
| Web | 无本机制源码写入；资产漂移仅记录 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
