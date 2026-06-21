TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-15

# M4 Batch2/3/4 最小验证技能录入清单

关联文档：
1. `文档记录/概要设计/验证里程碑.md`
2. `文档记录/详细设计/最小验证/M3-单技能1v假人-验证计划.md`
3. `文档记录/详细设计/最小验证/M4-机制扩展分批Goal提示词.md`
4. `文档记录/测试记录/wasm/M4-Batch2-数值承载机制-开发验证记录-2026-05-14.md`
5. `文档记录/测试记录/wasm/M4-Batch3-判定与随机机制-开发验证记录-2026-05-14.md`
6. `文档记录/测试记录/wasm/M4-Batch4-运行时复杂机制-开发验证记录-2026-05-14.md`

## 1. 当前输入事实

本清单只回答 M4 Batch2/3/4 机制验证前，LoL published bundle 里最小需要录入或补全哪些英雄技能。它不是 runtime 实现计划，也不要求一次性全量导入英雄技能。

已核对的当前 published bundle：

| 字段 | 当前值 |
| --- | --- |
| gameId | `lol` |
| versionCode | `m4r3r_0515235406` |
| releaseDate | `2026-05-15` |
| publishedAt | `2026-05-15T15:54:07.211630Z` |
| heroes | 174 |
| skills | 26 |
| statusDefinitions | 0 |
| controlStateProfiles | 0 |
| statusActionControlRules | 31 |

`#/wasm-validation-m3` 只读取 `loadPublishedBundleSnapshot(apiBaseUrl, gameId)` 的当前发布版本和 bundle。Admin draft 里的技能不会进入页面，必须发布后才可验证。前端 bundle cache 只按 `versionCode` 判断命中；如果复用同一个 `versionCode` 重新发布，验证前需要清理页面缓存或使用新的 `versionCode`，否则页面可能仍读取旧 bundle。

2026-05-15 补充：先发布 `m4r2_luxw_v1610_20260515230233` 修正 `skill_lux_w` 护盾 AP 系数为 `0.40`，再通过 Admin API 补录 `skill_taric_q`、`skill_drmundo_r`、`skill_quinn_harrier_hit`、`skill_zed_r_death_mark`、`skill_vayne_w_silver_bolts`、`skill_ksante_r_all_out` 并发布 `m4r3_0515232452`。随后发现 M3/M4 页面会过滤 `skillKey=P` 的 passive 技能，因此把合成验证用的 `skill_quinn_harrier_hit.skillKey` 从 `P` 改为 `AA`；再修正 Quinn source metadata 的 UTF-8 路径字段，最终发布 `m4r3r_0515235406`。页面 Bundle 卡片已读取 `m4r3r_0515235406`。

当前可复用的已录入技能主要是：

| 技能 | 当前可复用点 | 不能直接承担的 M4 机制 |
| --- | --- | --- |
| `skill_ahri_q` / Ahri Q | 直伤、资源、冷却、一次延迟返回伤害 | 不是 DoT/HoT；没有护盾、治疗、标记、控制 gate、触发链 |
| `skill_brand_w` / Brand W | `schedule_tick + on_tick` 的延迟伤害形态 | 当前只有单次延迟伤害；`mvpExtensions.conditionalDamage` 不被 M3 adapter 执行 |
| `skill_katarina_r` / Katarina R | 多次 tick 伤害、`params.hitCount`、`params.channelDurationMs` | `channelDurationMs` 尚未放到 `mechanicsConfig.execution`，当前不能作为 M4.14 页面打断输入 |
| `skill_lux_q` / Lux Q | 已有伤害和 `apply_status:lux_q_root`，页面可证明状态施加 | 控制 gate 仍需要 status classifier/control rule adapter 或多动作页面输入 |
| `skill_leona_q/w/r` | 多个已录入技能可作为后续控制/延迟/直伤样板 | 当前没有 shield/heal/mark/interrupt/counter/mode 字段 |
| `skill_anivia_e` | 条件伤害语义在 `mvpExtensions` 中有备注 | `mvpExtensions.conditionalDamage` 不被 M3 adapter 执行，不能直接证明 M4.7 |

## 2. 页面和 adapter 可消费字段

技能进入 M3/M4 页面后，实际会被 `compileTinyGoV2ValidationInput(...)` 消费为 TinyGo V2 输入。当前最小可用字段如下：

1. `heroes[].heroId`、`heroes[].baseStats`、`heroes[].statsByLevel`：决定 actor、HP、资源和属性。
2. `skills[].ownerType/ownerId/skillKey/name`：决定技能归属和页面选项。
3. `skills[].resourceCosts[]`、`skills[].cooldowns[]`：决定资源消耗和冷却证据。
4. `skills[].params.vars`：决定公式变量，例如 `base_damage`、`ap_damage`、`shield_amount`。
5. `skills[].timingProfile.phases`：页面可编辑，但当前 M3 adapter 的 channel 运行时证据主要看 `mechanicsConfig.execution.channelDurationMs`。
6. `skills[].mechanicsConfig.triggers[]`：当前 adapter 只把 `event.type = on_spell_cast` 编进 action effects；`on_tick` 只在 `schedule_tick` 解析时用于 DoT/HoT tick status。
7. raw action 可承载：`heal`、`grant_shield`、`apply_status`、`apply_mark`、`consume_mark`、`damage_from_recent`、`interrupt`、`increment_counter`。
8. `deal_damage` action 可承载：`formulaText/formulaVars`、`damageType`、`crit`、`mode`。

当前页面导出验收包包含 `case_meta`、`runInput`、`wasm_output` 和 `evidenceRows`。字段级证据覆盖 `done.actors`、`done.actionResults`、`done.tickResults`、`done.triggerResults` 和 `done.rng`。

## 3. 技能录入清单

### 3.1 Batch 2：数值承载机制

| 机制ID | 推荐英雄 | 推荐技能 | 当前是否已录入 | 缺失字段 | 最小录入字段 | 发布后页面验证 |
| --- | --- | --- | --- | --- | --- | --- |
| `M4.4-shield-min-001` | Lux | W `Prismatic Barrier`，新增 `skill_lux_w` | 是；`m4r2_luxw_v1610_20260515230233` 已发布 AP 系数 `0.40`，当前 `m4r3r_0515235406` 保留 | 完整护盾吸收仍缺多动作页面输入 | `resourceCosts`、`cooldowns`、`params.vars.shield_amount`、`mechanicsConfig.triggers[on_spell_cast].actions[{type: "grant_shield", shield: {statusId, target, durationMs, formulaText/formulaVars 或 amount}}]` | 选择 `M4.4 护盾` preset、英雄 `hero_lux`、技能 `skill_lux_w`。2026-05-15 页面复验：AP `18`，W1 raw/shield `47.2`，W5 raw/shield `107.2`，对齐游戏面板取整 `47/107`；完整“护盾吸收后 HP 变化”还需要页面支持 grant shield 后再安排一次 enemy fixed hit。 |
| `M4.5-heal-min-001` | Taric | Q `Starlight's Touch`，新增 `skill_taric_q` | 是；`m4r3r_0515235406` 已发布 | 有效治疗仍缺受损目标前置 HP | `resourceCosts`、`cooldowns`、`params.vars.heal_amount`、`mechanicsConfig.triggers[on_spell_cast].actions[{type: "heal", heal: {target, formulaText/formulaVars 或 amount}}]` | 选择 `M4.5 治疗` preset、英雄 `hero_taric`、技能 `skill_taric_q`。2026-05-15 页面复验：`accepted=true`，mana `300 -> 240`，cooldown `3000 ms`，`effect.0.kind=heal`，`rawAmount=127.7`，`overhealAmount=127.7`，HP `2393 -> 2393`；要证明 `healApplied > 0`，需要页面支持 initial HP override 或先安排一次固定受伤动作。 |
| `M4.8-dot-min-001` | Malzahar | E `Malefic Visions`，新增 `skill_malzahar_e` | 是；`m4r2_luxw_v1610_20260515230233` 已发布，当前 `m4r3r_0515235406` 保留 | 无；页面单 action 可证明最小 DoT | `resourceCosts`、`cooldowns`、`params.vars.tick_damage/tick_interval_ms/tick_count`、`mechanicsConfig` 中 `on_spell_cast -> schedule_tick` 和同 `tickKey` 的 `on_tick -> deal_damage` | 选择 `M4.8 DoT` preset、英雄 `hero_malzahar`、技能 `skill_malzahar_e`。2026-05-15 页面复验：AP `18`，E1 每跳 `23.6 magic`，`1000/2000/3000/4000 ms` 四跳，目标 HP `1000 -> 905.6`。 |
| `M4.9-hot-min-001` | DrMundo | R `Maximum Dosage`，新增 `skill_drmundo_r` | 是；`m4r3r_0515235406` 已发布 | 有效 HoT 仍缺受损自身前置 HP | `resourceCosts` 可空或 health cost、`cooldowns`、`params.vars.tick_heal/tick_interval_ms/tick_count`、`mechanicsConfig` 中 `on_spell_cast -> schedule_tick` 和同 `tickKey` 的 `on_tick -> {type: "heal"}` raw action | 选择 `M4.9 HoT` preset、英雄 `hero_drmundo`、技能 `skill_drmundo_r`。2026-05-15 页面复验：`accepted=true`，`processedEvents=5`，cooldown `120000 ms`，`effect.0.kind=apply_status`；3 个 tick 分别在 `1000/2000/3000 ms` 触发，每跳 `rawAmount=40`、`overhealAmount=40`，HP `2456 -> 2456`；要证明每跳有效治疗，需要 initial HP override 或先安排固定受伤动作。 |

### 3.2 Batch 3：判定与随机机制

| 机制ID | 推荐英雄 | 推荐技能 | 当前是否已录入 | 缺失字段 | 最小录入字段 | 发布后页面验证 |
| --- | --- | --- | --- | --- | --- | --- |
| `M4.6-mark-apply-001` | Quinn | E `Vault`，新增 `skill_quinn_e` | 是；`m4r2_luxw_v1610_20260515230233` 已发布，当前 `m4r3r_0515235406` 保留 | 无；页面单 action 可证明 mark apply | `resourceCosts`、`cooldowns`、`params.vars.mark_duration_ms` 可选、`mechanicsConfig.triggers[on_spell_cast].actions[{type: "apply_mark", mark: {markId, target}}]` | 选择 `M4.6 标记施加` preset、英雄 `hero_quinn`、技能 `skill_quinn_e`。2026-05-15 页面复验：`effect.0.kind=apply_mark`、`markId=quinn_harrier_mark`、`markActive=true`、`markCount=1`。 |
| `M4.7-conditional-hit-001` | Quinn | E + basic attack / `Harrier` 消耗技能，新增 `skill_quinn_harrier_hit` | 是；`m4r3r_0515235406` 已发布，合成验证 skillKey 为 `AA` | true path 仍缺同一 run 内两动作输入 | `skill_quinn_e` 负责 `apply_mark`；`skill_quinn_harrier_hit` 在 `mechanicsConfig.condition.requiresMark` 或根 `requiresMark` 填同一 `markId`，`consumesMark=true`，并带一个 `deal_damage` action | 选择 `M4.7 条件命中` preset、英雄 `hero_quinn`、技能 `skill_quinn_harrier_hit`。2026-05-15 页面复验 false path：`accepted=false`、`blockedReason=required_mark_missing`、`conditionKind=mark`、`conditionId=quinn_harrier_mark`、无 effect。true path 需要页面支持先执行 `skill_quinn_e` 再执行消耗技能，当前页面不能用一个 preset 选择两个不同 action。 |
| `M4.11-crit-min-001` | Gangplank | Q `Parrrley`，新增 `skill_gangplank_q` | 是；`m4r2_luxw_v1610_20260515230233` 已发布，当前 `m4r3r_0515235406` 保留 | 同一页面输入只能证明当前 seed 分支 | `resourceCosts`、`cooldowns`、`params.vars.base_damage/ad_ratio`、`mechanicsConfig.triggers[on_spell_cast].actions[deal_damage]` 内加入 `crit: {critPolicy 或 policy, critChance 或 chance, critMultiplier 或 multiplier}` | 选择 `M4.11 暴击` preset、英雄 `hero_gangplank`、技能 `skill_gangplank_q`。2026-05-15 页面复验：`critRoll=0.4932122668392295`、`critResult=true`、`critMultiplier=2`、raw `74`、final `148`。 |
| `M4.12-rng-seed-001` | Gangplank | Q `Parrrley`，复用 `skill_gangplank_q` | 是；`m4r2_luxw_v1610_20260515230233` 已发布，当前 `m4r3r_0515235406` 保留 | 缺页面 seed 输入，不能覆盖不同 seed 分支 | 同 M4.11，但 `critPolicy="seeded_random"`、`critChance` 固定为可分支值，例如 `0.5` | 当前页面可重复运行同一输入，验证同 seed 结果稳定和 `done.rng[0]` 字段存在；2026-05-15 页面复验同 seed 输出稳定为 `0.4932122668392295`。不同 seed 分支需要页面增加 seed 输入或允许编辑 `runInput.seed` 后运行。 |

### 3.3 Batch 4：运行时复杂机制

| 机制ID | 推荐英雄 | 推荐技能 | 当前是否已录入 | 缺失字段 | 最小录入字段 | 发布后页面验证 |
| --- | --- | --- | --- | --- | --- | --- |
| `M4.13-control-min-001` | Lux | Q `Light Binding`，补全现有 `skill_lux_q` | 是；`m4r2_luxw_v1610_20260515230233` 已发布，可证明状态施加，当前 `m4r3r_0515235406` 保留 | 控制 gate 仍缺 status classifier/control rule adapter 或多动作页面输入 | 保留现有 damage；把 raw action 改成 `{type: "apply_status", status: {statusId: "lux_q_root", kind: "control", target: "enemy", durationMs: 2000}}` | 选择 `M4.13 控制` preset、英雄 `hero_lux`、技能 `skill_lux_q`。2026-05-15 页面复验：输出 `deal_damage` + `apply_status`，`statusId=lux_q_root`；“控制阻止施法”需要 adapter 输出 status classifier 和 `statusActionControlRules`，否则只能算状态施加准备完成。 |
| `M4.14-interrupt-min-001` | Katarina + Leona | Katarina R 作为 channel，Leona Q/R 作为 interrupt source | 部分；`skill_katarina_r` 有 hit/tick 参数但没有 adapter 可读的 channel 字段；Leona 技能未带 interrupt action | `mechanicsConfig.execution.channelDurationMs`、interrupt raw action、多动作 preset | `skill_katarina_r.mechanicsConfig.execution.channelDurationMs=2500`；`skill_leona_q` 或 `skill_leona_r` 增加 `{type: "interrupt", interrupt: {target: "enemy"}}` 或控制打断字段 | 当前页面不能选择两个不同英雄技能形成“先 channel 后 interrupt”的序列。需要 M3/M4 页面新增 Batch4 interrupt preset：先 self Katarina R，再 enemy Leona interrupt。 |
| `M4.16-trigger-chain-min-001` | Brand | 被动 `Blaze` + W `Pillar of Flame`，补 `skill_brand_passive` 或触发定义 | 否；`skill_brand_w` 只有延迟伤害，conditional 备注在 `mvpExtensions` | published bundle 到 `engineBundle.triggers[]` 的映射、trigger owner/event/effects | 最小数据应表达 `on_damage_taken` 或 `on_damage_dealt` 触发一层 follow-up effect，例如 `triggerId`、`event`、`ownerRole/ownerId`、`requiresDamage`、`effects[]` | 当前 adapter 没有从技能数据编译 `engineBundle.triggers[]`，所以录技能后页面仍不能验证 `done.triggerResults`。这是 adapter 阻塞项，不应先大批录入触发类技能。 |
| `M4.17-history-window-min-001` | Zed | R `Death Mark`，新增 `skill_zed_r_death_mark` | 是；`m4r3r_0515235406` 已发布 | 完整历史窗口仍缺先前伤害事件和多动作 preset | `params.vars.history_window_ms/multiplier`；`mechanicsConfig` 中一个先造成或记录伤害的 action，以及后续 `{type: "damage_from_recent", recent: {historyWindowMs, multiplier, damageType}}` | 选择 `M4.17 历史窗口` preset、英雄 `hero_zed`、技能 `skill_zed_r_death_mark`。2026-05-15 页面复验：`accepted=true`，`effect.0.kind=damage_from_recent`，`historyWindowMs=4000`，`damageType=true`，无前置 history 时 HP `1000 -> 1000`。完整窗口内/外读取需要多动作时序 preset 或 runInput 编辑能力。 |
| `M4.18-counter-min-001` | Vayne | W `Silver Bolts`，新增 `skill_vayne_w_silver_bolts` | 是；`m4r3r_0515235406` 已发布 | counter read formula、重复命中序列仍缺 | `mechanicsConfig.stacks` 可描述 `silver_bolts_stack`；actions 至少含 `{type: "increment_counter", counter: {counterKey, amount}}`；读 counter 的伤害公式需要能产出 TinyGo formula op `counter` | 选择 `M4.18 计数器` preset、英雄 `hero_vayne`、技能 `skill_vayne_w_silver_bolts`。2026-05-15 页面复验：`accepted=true`，`effect.0.kind=increment_counter`，`counterKey=vayne_silver_bolts_stack`，`counterAfter=1`。完整“读取计数器后结算”仍是 adapter/page 阻塞项。 |
| `M4.19-mode-augment-min-001` | KSante | R `All Out`，新增 `skill_ksante_r_all_out` 或 debug mode action | 是；`m4r3r_0515235406` 已发布 | augmented path 仍缺 `runInput.modeAugments` 页面控制 | 伤害 action 中加入 `mode: {modeAugmentId: "ksante_all_out", modeMultiplier: 2}`；如需要模式开关技能，还需记录模式状态来源 | 选择 `M4.19 模式强化` preset、英雄 `hero_ksante`、技能 `skill_ksante_r_all_out`。2026-05-15 页面复验 normal path：`accepted=true`，`rawAmount=191.6`，`finalDamage=191.6 physical`，`modeAugmentId=ksante_all_out`，`modeMultiplier=2`，HP `1000 -> 808.4`。augmented path 需要页面增加 mode augment 输入或 preset。 |

## 4. 建议录入顺序

推荐按“页面立刻可见程度”和“复用英雄数量”分三轮录入。

1. 第一轮：补页面单 action 可直接导出证据的技能。
   - `skill_quinn_e`：M4.6 标记施加。
   - `skill_malzahar_e`：M4.8 DoT。
   - `skill_lux_w`：M4.4 护盾施加证据。
   - `skill_gangplank_q`：M4.11/M4.12 暴击/RNG 的单 seed 证据。

2. 第二轮：补已有技能的字段缺口，避免新增太多英雄。
   - 修 `skill_lux_q` 的 `apply_status` 字段，使它至少能输出 M4.13 状态施加证据。
   - 修 `skill_katarina_r` 的 `mechanicsConfig.execution.channelDurationMs`，让它成为 M4.14 channel 输入。
   - `skill_taric_q` 和 `skill_drmundo_r` 已补录并可证明 overheal/clamp；它们的有效治疗证据仍依赖页面 initial HP override。

3. 第三轮：等页面/adapter 支持后再录复杂组合技能。
   - M4.7：Quinn mark true path，需要同一 run 内两个不同 action。
   - M4.14：Katarina channel + Leona interrupt，需要跨英雄多 action 时序。
   - M4.16：需要 adapter 把发布数据编译为 `engineBundle.triggers[]`。
   - M4.17：Zed R 需要历史写入和窗口读取的多动作时序。
   - M4.18：Vayne W 需要 counter formula read 和重复命中 preset。
   - M4.19：KSante R 需要 `runInput.modeAugments` 页面控制。

## 5. 阻塞项

1. `M4.4` 完整吸收、`M4.5` 有效治疗、`M4.7` true path、`M4.14` 打断、`M4.17` 历史窗口都需要 M3/M4 页面支持两个或多个不同 action 的固定时序输入。
2. `M4.5` 和 `M4.9` 的有效治疗需要 actor 初始 HP 低于 max HP；当前页面没有 initial HP override，只能通过先受伤动作或页面字段补齐。
3. `M4.13` 的状态施加可以靠技能 raw action 输出，但控制 gate 需要 adapter 消费 status classifier 和 `statusActionControlRules`，当前 M3 adapter 没有这条映射。
4. `M4.16` 需要从 published skill/status 数据编译 `engineBundle.triggers[]`；当前 adapter 没有触发链发布数据入口。
5. `M4.18` 的 counter read 需要 formula 编译器支持 `counter` 读，当前页面公式文本只支持四则、`max/min`、属性和变量引用。
6. `M4.19` 需要页面能设置 `runInput.modeAugments`，否则只能看到 `modeActive=false`。
7. 每次录入后必须重新发布 bundle；如果 `versionCode` 不变，验证前清理前端 bundle cache 或使用新版本号。

## 6. 最小完成口径

本清单的完成口径不是“所有推荐技能都已经录入”，而是后续录入 agent 可以逐项执行：

1. 每个 M4 Batch2/3/4 机制都有推荐英雄和推荐技能。
2. 每个机制都标明了当前 published bundle 是否已录入。
3. 每个机制都列出了缺失字段和最小录入字段。
4. 每个机制都说明了发布后在 `#/wasm-validation-m3` 的验证方式。
5. 对当前页面或 adapter 无法覆盖的机制，阻塞项已显式列出，不把“录入技能”误判为“验收可完成”。
