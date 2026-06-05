TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-04

# V2 Batch L 单攻击方 DPS 咒刃下一次普攻状态计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置回归：[V2-BatchF-Canonical回归硬化计划.md](./V2-BatchF-Canonical回归硬化计划.md)

前置审计：[V2-BatchG-ADC被动覆盖审计与录入计划.md](./V2-BatchG-ADC被动覆盖审计与录入计划.md)

前置清单：[V2-BatchG-ADC被动覆盖清单.md](./V2-BatchG-ADC被动覆盖清单.md)

前置机制：[V2-BatchH-状态型普攻被动Runtime扩展计划.md](./V2-BatchH-状态型普攻被动Runtime扩展计划.md)

前置收口：[V2-BatchK-单攻击方DPS收口与鬼索幻影命中计划.md](./V2-BatchK-单攻击方DPS收口与鬼索幻影命中计划.md)

## 1. 本文档边界

本文档是后续跨 worktree 开发会话的执行真源，不是测试记录。当前会话只维护本文、总方案索引和任务治理映射；不得在本文档编写会话里新增 runtime、backend、web 或 seed 代码。

Batch L 继续服务“单攻击方站桩平 A DPS 展示”主线，只扩展 Batch G backlog 中的 `spellblade_next_attack_state` 机制。不把 V2 DPS 扩成完整主动技能轮转、1v1 模拟器或 action queue editor。

本批核心假设：

1. “施放技能后下一次普攻”不在本批自然模拟主动施法。
2. 页面通过 `scenarioStates` 显式假定“下一次普攻状态已经准备好”。
3. runtime 只负责在下一次符合条件的普攻命中时消耗该状态并结算被动操作。
4. 该结果只能证明“用户显式预置状态下的 DPS 对比”，不能证明完整实战 rotation。
5. 本批真实数据先 item-first，不把德莱文 Q 的接斧、双斧持有或循环再武装并入 Batch L。

## 2. 当前事实

1. Batch K 已完成 `phantom_hit_on_hit_repeat`，鬼索 3124 已以 current bundle `v2_batch_k_guinsoo_phantom_hit_001` 证明 on-hit damage、stacking stat modifier、phantom-hit repeat 三类 operation 可同时闭环。
2. Batch G 清单里 `needs_runtime_extension=37`；其中 `spellblade_next_attack_state=6`，样例包括德莱文 Q、黄昏与黎明、三相之力、巫妖之祸、黯影阔剑、夺萃之镰。
3. `distance_based_damage_modifier=11` 数量更多，但需要攻击距离或目标距离输入，会扩展页面和模拟规则，不适合紧接 Batch K。
4. `energized_charge_and_consume=6` 同样高价值，但需要移动/攻击充能、首次攻击状态和充能消耗口径，优先级低于 next-attack 状态。
5. 当前 `DPSPassiveEffectV2` 已有 `triggerKind`、`requiresScenarioStateId` 和 `operations[]`；`DPSScenarioStateV2` 已有 `stateId`、`activation`、`stacks`、`startTimeMs`、`durationMs`。
6. 当前 DPS runtime 支持的 trigger 只有 `on_basic_attack_hit`、`every_n_basic_attack_hit`、`stack_on_hit`、`stat_modifier_always_on`、`pre_enabled_state_modifier`；没有“一次性下一刀”语义。
7. 当前 `passiveActiveAt` 只判断 scenario state 是否存在、是否到达开始时间、是否过期；不会在触发后消费状态。
8. 当前伤害 operation 已支持 `amount`、`attackerAttr`、`attackerAttrRatio`、目标当前/最大/已损生命值比例等字段；装备属性会先合入攻击者属性快照。
9. 德莱文 Q 在 Batch G 清单中 `rankTableStatus=complete` 但 `levelDataStatus=missing`，不适合作为本批第一个真实发布 gate。
10. 装备咒刃项的 `levelDataStatus` 和 `rankTableStatus` 均为 `not_applicable`，更适合作为本批真实数据首证。

## 3. 目标

Batch L 分成三个连续 gate：

| Gate | 目标 | 可单独通过 |
| --- | --- | --- |
| `L-contract-pass` | 收敛 next-attack 状态契约，Cursor prompt 限定写入范围，确认 Batch F/H/K 回归仍是护栏 | 是 |
| `L-runtime-pass` | wasm 支持一次性 next-attack state trigger，synthetic canonical tests、全量 Go tests、bench、TinyGo build、Node smoke 通过 | 是 |
| `L-real-data-pass` | 至少一个真实装备咒刃 seed dry-run/import/publish 通过，current bundle 和 V2 DPS 页面能从 published bundle 跑出一次性触发证据 | 否，必须建立在 `L-runtime-pass` 上 |
| `L-freshness-pass` | 页面 current version、wasm asset hash 和导出 payload 均来自本批最新产物，避免 stale bundle/wasm 误判 | 否，必须伴随 `L-real-data-pass` |

如果 runtime 已闭环但真实装备公式、seed 发布或页面证据不足，只能报告 `L-runtime-pass` 和 `L-real-data-blocked`，不能宣称 Batch L 完成。

## 4. 非目标

1. 不实现主动技能轮转、自动施法、技能冷却调度或 action queue editor。
2. 不把“施放技能”自然插入 DPS 时间线；本批只能用 `scenarioStates` 显式预置。
3. 不实现德莱文 Q 接斧刷新、双斧持有、循环再武装或主动技能预置后的持续 rotation。
4. 不实现 `energized_charge_and_consume`。
5. 不实现 `distance_based_damage_modifier`。
6. 不实现 `seeded_random_crit_sequence` 或 on-crit 真实随机序列。
7. 不实现 `execute_threshold`、生存收益、护盾、治疗、吸血或多目标弹射。
8. 不在 TypeScript 页面、adapter 或 backend seed 脚本里计算 DPS 结果；伤害、触发、状态消耗和输出证据必须来自 wasm。
9. 不把缺公式、缺 published 数据或缺页面证据的装备伪装成 `ok`。
10. 不把德莱文 Q 作为本批必须完成的真实发布 gate；它可以作为后续 hero passive 扩展项，必须先补齐英雄等级数据。

## 5. Runtime 契约建议

### 5.1 Trigger 命名

新增 DPS triggerKind：

```json
{
  "triggerKind": "next_basic_attack_after_state",
  "requiresScenarioStateId": "item_3078_spellblade_ready",
  "operations": [
    {
      "kind": "damage",
      "source": "trinity_force_spellblade",
      "damageType": "physical",
      "attackerAttr": "ad",
      "attackerAttrRatio": 2.0
    }
  ]
}
```

机制标签仍沿用 Batch G 的 `spellblade_next_attack_state`，用于 audit/backlog 分类。runtime triggerKind 不使用 `spellblade` 字样，因为德莱文 Q、黯影阔剑夜行者也属于“下一次普攻状态”，但不是严格装备咒刃。

### 5.2 Scenario state 语义

`scenarioStates` 只表达本次 DPS 对比的显式假定：

```json
{
  "stateId": "item_3078_spellblade_ready",
  "sourceType": "item_passive",
  "sourceId": "3078",
  "activation": "assumed_spell_cast_before_start",
  "startTimeMs": 0,
  "durationMs": 0
}
```

规则：

1. `durationMs=0` 表示本次 scenario 假定该状态在首个可触发普攻前不会自然过期，但仍必须在第一次触发后由 runtime 消耗。
2. 如果真实数据提供明确持续时间，可以写 `durationMs`，runtime 必须遵守 `timeMs < startTimeMs + durationMs`。
3. 如果启用了该 passive 但 scenario state 缺失，curve 必须 `blocked`；如果 state 未到 `startTimeMs` 或已过期，则本次命中不能触发该 passive。
4. `selection.scenarioStates` 和 `resolvedSnapshot.scenarioStates` 必须都能导出，证明用户选择和 wasm 实际输入一致。
5. 状态消费只影响本次 curve 内部运行，不反写 published bundle。

### 5.3 消耗规则

`next_basic_attack_after_state` 的语义：

1. 在普攻命中后的 passive 处理阶段判断。
2. 只在 `requiresScenarioStateId` 对应状态 active 且尚未被消费时触发。
3. 触发后立即把该 passive 或该 scenario state 标记为 consumed，同一 curve 后续普攻不再触发。
4. 一次普攻内只触发一次该 passive；不能因 phantom-hit 或其他 copied on-hit 再触发。
5. 触发次数必须进入 `SkillPassiveTriggers`、`ItemPassiveTriggers` 或 `ExternalPassiveTriggers`，按 `sourceCategory` 路由。
6. 伤害必须进入 `damageTimeline`、`damageBySource`、`effectBreakdown`、`damageByType` 和总伤害。
7. 消耗事件建议进入 `effectBreakdown`，`kind=next_attack_state_consume` 或 message 中明确 `consumedScenarioStateId=...`。
8. 该机制不得改变 `attackCount`、攻击间隔或普攻 cadence；只改变命中后的额外伤害和触发证据。

### 5.4 顺序规则

Batch L 不新建全局事件优先级，只复用现有 DPS passive 顺序：

1. 基础普攻伤害先结算。
2. 已启用 passive 按 `resolvedSnapshot.passiveEffects[]` 顺序处理。
3. `next_basic_attack_after_state` 与普通 on-hit、every-N、stack-on-hit 同属 passive 阶段。
4. 如果同一次普攻内同时存在多个 next-attack passive，按 passive 数组顺序逐个判断和消费。
5. `phantom_hit_on_hit_repeat` 继续在普通 passive 后处理；Batch L 的 next-attack state 不应被 phantom-hit 复制或二次消费。

## 6. 数据范围

### 6.1 首批真实装备候选

优先候选：

| itemId | 名称 | passive | 处理建议 |
| --- | --- | --- | --- |
| `3078` | 三相之力 | 咒刃 | 首选 real-data gate，额外物理伤害，页面对比直观 |
| `3508` | 夺萃之镰 | 咒刃 | 第二候选，额外物理伤害并有法力收益；本批只录 DPS 伤害，不录法力收益 |
| `3100` | 巫妖之祸 | 咒刃 | 第三候选，额外魔法伤害，公式可能依赖 AP，需要确认属性字段 |

暂不作为首批 gate：

| itemId/owner | 名称 | 原因 |
| --- | --- | --- |
| `2510` | 黄昏与黎明 | sourceText 中出现额外治疗和攻击特效重复语义，容易越界到生存或 phantom 机制 |
| `3179` | 黯影阔剑 | 夜行者需要“未被敌人看见”状态，和 spellcast 语义不同，可后续复用 next-attack trigger |
| `hero_draven Q` | 旋转飞斧 | 英雄等级数据缺失，且属于主动技能预置状态，先不作为发布 gate |

### 6.2 公式 gate

真实 seed 必须满足：

1. 每个 damage operation 的 `damageType`、`amount`、`attackerAttr`、`attackerAttrRatio` 或其他公式字段有可审计来源。
2. 如果真实咒刃公式要求 `base_ad`，而当前 web/wasm 投影只稳定提供 `ad`，必须二选一：
   - 补齐 `base_ad` / `bonus_ad` 等属性投影和测试。
   - 将该装备标记为 `L-real-data-blocked`，只保留 synthetic runtime pass。
3. 不允许用总 AD 近似 base AD，除非文档和 seed 中明确写为本批人工假设，并且页面显示该曲线是 scenario/assumption，不是自然真实公式。
4. 如果 Data Dragon 本地文本缺少数值，seed 必须补充 `source` 字段说明公式来源；不能只靠脚本猜。

## 7. 写入范围

后续开发会话的允许写入范围：

| Worktree | 允许写入 |
| --- | --- |
| `C:\project\damage_wasm_dev` | `wasm/tinygo_engine_v2/internal/model/types.go`、`wasm/tinygo_engine_v2/internal/runtime/dps_driver.go`、`wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go`、必要的 `scripts/build-wasm.ps1` 输出、Batch L seed/audit/test record |
| `C:\project\damage_backend_dev` | `最小验证/V2-Batch-L-*.seed.json`、`最小验证/V2-Batch-L-*.audit.json`、`server/data_manage/src/test/java/.../KatarinaMvpImportMainTest.java`、必要的 import/publish 测试 |
| `C:\project\damage_web_dev` | `web/src/engine/tinygoV2DpsAdapter.ts`、`web/src/pages/WasmValidationV2DpsPage.tsx`、同步后的 `web/src/engine/wasm/tinygo_engine_v2.wasm` |
| `C:\project\damage_viewer_project_planning` | 本计划、测试记录、任务治理映射 |

不允许写入：

1. 与 V2 DPS 无关的 admin 页面。
2. 通用 1v1 rotation 入口。
3. 未经说明的 DB 配置，例如本机 `application.yml` 的 datasource host。
4. `.codegraph/*.db*`、service stdout/stderr、Playwright 临时截图以外的生成噪音。

## 8. 执行顺序

1. GPT/Codex：在 `wasm/dev`、`backend/dev`、`web/dev`、planning `master` 分别检查 `git status --short -uall`。
2. GPT/Codex：读取最近层 `AGENTS.md` / README；开发改代码时必须先走 Cursor 协同流程。
3. GPT/Codex：收敛本批 Cursor prompt，写清目标、允许写入范围、非目标、验证命令、停止条件。
4. Cursor：实现 wasm trigger 和 synthetic tests；不得改 seed 或 web。
5. GPT/Codex：review Cursor diff 和日志，先跑 wasm targeted tests。
6. Cursor 或 GPT/Codex 按流程：补 backend seed/audit 和 import dry-run 测试，只做首批真实装备。
7. Backend：dry-run 通过后再 import/publish，确认 current bundle 包含 Batch L seed。
8. Web：同步 wasm，更新 adapter/page 只展示和导出证据，不手算伤害。
9. GPT/Codex：集中运行 backend/web/wasm 验证矩阵和 Playwright。
10. GPT/Codex：写测试记录，明确 `L-contract-pass`、`L-runtime-pass`、`L-real-data-pass` 或 blocked 状态。

任何一步失败，只修当前步，不允许跨步伪装。例如 backend current bundle 没有 next-attack trigger 时，web 不得用 synthetic 数据伪装 published real case；wasm 没有输出消耗证据时，web 不得自己补证据。

## 9. 验证命令

### Wasm

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "NextAttack|Spellblade|Canonical|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

必须新增或覆盖的测试：

1. `TestSingleAttackerDPSNextAttackStateFiresOnce`
2. `TestSingleAttackerDPSNextAttackStateRequiresScenarioState`
3. `TestSingleAttackerDPSNextAttackStateRespectsStartAndDuration`
4. `TestSingleAttackerDPSNextAttackStateConsumesBeforeLaterHits`
5. `TestSingleAttackerDPSNextAttackStateDoesNotFireFromPhantomHit`
6. `TestSingleAttackerDPSNextAttackStateDoesNotChangeCadence`
7. `TestSingleAttackerDPSSpellbladeFixture`

### Backend

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-L-spellblade-next-attack.seed.json --versionCode=v2_batch_l_spellblade_next_attack_001 --gameId=lol"
```

dry-run 通过后再执行真实 import/publish。发布验证必须证明：

1. current version 为 `v2_batch_l_spellblade_next_attack_001` 或最终约定版本号。
2. 首批 item 的 `skillRefs` 能找到 Batch L passive skill。
3. `mechanicsConfig.dpsPassiveEffects[].triggerKind` 包含 `next_basic_attack_after_state`。
4. 对应 passive 有 `requiresScenarioStateId`。
5. `mechanicsConfig.dpsScenarioStates[]` 包含同名 `stateId`。
6. damage operation 有明确公式字段和 source。

### Web

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

Playwright 至少验证：

1. `#/wasm-validation-v2-dps`
2. `#/wasm-validation-v2-dps-multi-hero`
3. `#/wasm-validation-v2-dps-stacking-passive` 不回退 Batch H/K 鬼索证据。
4. Batch L 首批装备曲线可以选择 scenario state 并运行。
5. 导出 JSON 能复核 selection、resolvedSnapshot、curveResults、damageTimeline、itemPassiveTriggers、effectBreakdown。

### Governance

```powershell
cd C:\project\damage_viewer_project_planning
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
```

## 10. 页面与导出要求

页面只需要做必要证据展示，不做大范围 UI 美化：

1. scenario state selector 能选中 `item_3078_spellblade_ready` 或最终 stateId。
2. 曲线 label 明确区分 baseline 和 spellblade-ready。
3. 汇总区显示首批 item 的 totalDamage、timeWindowDps、attackCount。
4. 事件时间线或调试明细能看到 spellblade damage 只在第一刀出现。
5. 导出 JSON 中能看到：
   - `selection.equipmentSet` 包含首批 item。
   - `selection.scenarioStates` 包含 ready state。
   - `resolvedSnapshot.passiveEffects[].triggerKind=next_basic_attack_after_state`。
   - `resolvedSnapshot.passiveEffects[].requiresScenarioStateId` 与 stateId 对齐。
   - `curveResults[].itemPassiveTriggers` 只出现一次。
   - `damageTimeline` 和 `effectBreakdown` 有咒刃 source。

页面不得自行补算触发次数、消耗次数或额外伤害。

## 11. Cursor Prompt 模板

后续进入编码会话时，GPT/Codex 应先按实际代码状态修订本模板，再启动 Cursor。

```text
目标：
实现 V2 single_attacker_dps 的 Batch L next-attack state 机制。新增 triggerKind=next_basic_attack_after_state，使 requiresScenarioStateId 对应状态 active 时，在下一次普攻命中 passive 阶段触发一次 operations，然后在同一 curve 内消费该状态，后续普攻不再触发。

允许写入范围：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

非目标：
- 不实现主动技能轮转、自动施法、action queue editor。
- 不实现 energized、distance-based、seeded random crit、execute、lifesteal/shield。
- 不改 backend seed、不改 web 页面、不同步 wasm 产物。
- 不在 TypeScript 或 backend 中计算 DPS 结果。

实现要求：
- supportedDPSTrigger 支持 next_basic_attack_after_state。
- validateDPSPassive 要求该 trigger 必须有 requiresScenarioStateId。
- runtime 使用现有 scenarioStates 的 startTimeMs/durationMs 判定 active。
- 第一次触发后在 curve 内消费，后续攻击不触发。
- 触发进入 passive trigger 列表，damage/effectBreakdown/damageTimeline 保留 source 证据。
- 不改变 attackCount、攻击间隔或普攻 cadence。
- 不允许 phantom-hit 复制或二次触发 next-attack state。

验证命令：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "NextAttack|Spellblade|Canonical|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench

停止条件：
- 如果发现需要新增完整 action queue 或主动技能调度，停止并报告。
- 如果需要改 backend/web 才能证明 synthetic runtime tests，不要继续扩大范围。
- 如果现有字段无法表达 state consumption evidence，先给出最小 DTO 字段建议和风险，不要私自扩展三端。
```

## 12. 完成标准

本批只有同时满足以下条件，才能标记完成：

1. `L-contract-pass`：计划、Cursor prompt、写入范围、非目标和验证命令已收敛。
2. `L-runtime-pass`：wasm 支持 `next_basic_attack_after_state`，targeted tests、全量 Go tests、bench、TinyGo build、Node smoke 全通过。
3. `L-real-data-pass`：至少一个真实装备咒刃 seed dry-run/import/publish 通过，current bundle 含 next-attack trigger 和 scenario state。
4. Web build 通过，页面能从 published bundle 运行 Batch L 首批装备 case。
5. 导出 JSON 能复核 ready state、一次性消费、触发时刻、伤害来源和伤害贡献。
6. Batch F canonical、Batch H stacking passive、Batch K phantom-hit、Batch J expected crit 不回退。
7. `L-freshness-pass`：页面 current version、wasm asset hash、dist wasm hash 和导出 payload 对齐本批产物，不复用 stale current bundle 或 stale wasm。
8. GPT/Codex review 无阻塞 findings。

## 13. 残余风险

1. 咒刃真实公式可能依赖 `base_ad`、`bonus_ad` 或 AP 等当前投影未稳定展示的字段；如果字段不完整，真实数据 gate 会 blocked。
2. 本批用 `scenarioStates` 预置“已施法后下一刀”，不是自然 rotation 证据，页面必须让用户看懂这个假设。
3. `durationMs=0` 作为“本次假定不自然过期”可能和真实 buff duration 不一致；若要严格训练营对齐，需要补真实 duration 数据。
4. 多个 next-attack passive 同时存在时，真实游戏可能有唯一被动冲突或优先级差异；本批只按 passive array order 处理，后续如需唯一被动规则再开独立批次。
5. 如果首批装备 sourceText 仍缺少数值，必须补公式来源或降级为 `L-real-data-blocked`。
