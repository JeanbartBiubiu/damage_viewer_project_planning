TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-08

# V2 ADC 随机组合机制头脑风暴与缺口分析

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置机制：[V2-BatchO-单攻击方DPS事件化联动机制计划.md](./V2-BatchO-单攻击方DPS事件化联动机制计划.md)

真实装备闭环前置：[V2-BatchP-单攻击方DPS真实装备联动闭环计划.md](./V2-BatchP-单攻击方DPS真实装备联动闭环计划.md)

编辑器前置：[V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md](./V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md)

乘区前置：[V2-BatchR-DPS乘区与属性修饰平台计划.md](./V2-BatchR-DPS乘区与属性修饰平台计划.md)

## 1. 文档边界

本文是一次基于当前系统代码的 ADC 机制头脑风暴与缺口审计。它不是测试记录，不证明真实发布数据已经覆盖，也不要求立即进入实现。

本文使用“随机组合装备/技能”的方式逼近后续真实用户会提出的问题：如果用户把 ADC 的技能、装备、目标侧装备混搭起来，当前 V2 `single_attacker_dps` 能否表达其数值机制；如果不能，缺的是 runtime、数据契约、Web authoring、发布数据，还是当前单标靶 DPS 范围本身。

以下判断来自 2026-06-08 当前 worktree 定点核对，工作区当时已有未提交改动，因此结论应视为“当前工作区事实”，不是已提交主线事实。

## 2. 核对入口

### 2.1 Wasm runtime / model

1. `wasm/tinygo_engine_v2/internal/model/types.go`
   - `DPSPassiveEffectV2`
   - `DPSPassiveOperationV2`
   - `DPSPassiveTriggerSpecV2`
   - `DPSPassiveTriggerMatcherV2`
2. `wasm/tinygo_engine_v2/internal/runtime/dps_driver.go`
   - `runSingleAttackerDPSCurve`
3. `wasm/tinygo_engine_v2/internal/runtime/dps_basic_attack.go`
   - `processBasicAttackAction`
   - `processSkillAction`
4. `wasm/tinygo_engine_v2/internal/runtime/dps_passive_dispatcher.go`
   - `processAttackPassives`
   - `processSkillPassives`
   - `applyIncomingDamageModifiers`
   - `linkedPassiveMatchesEvent`
5. `wasm/tinygo_engine_v2/internal/runtime/dps_operation_handlers.go`
   - `applyPassiveOperation`
   - `applyStatModifier`
   - `triggerDamageAtStacks`
6. `wasm/tinygo_engine_v2/internal/runtime/dps_energized.go`
   - energized charge / consume logic
7. `wasm/tinygo_engine_v2/internal/runtime/dps_validation.go`
   - DPS passive validation and supported trigger / operation checks

### 2.2 Web authoring / adapter

1. `web/src/types/api.ts`
   - `Item.skillRefs`
   - `Skill.mechanicsConfig`
2. `web/src/engine/tinygoV2DpsAdapter.ts`
   - reads `skill.mechanicsConfig.dpsPassiveEffects`
   - projects item-owned skill passives through `item.skillRefs`
3. `web/src/components/skill-editor/skillModels.ts`
   - `summarizeDpsPassiveEffects`
   - `validateDpsPassiveEffects`
   - `parseMechanicsConfig` / `stringifyMechanicsConfig`
4. `web/src/components/skill-editor/SkillMechanicsConfigEditor.tsx`
   - read-only DPS passive summary
5. `web/src/pages/admin/resources/items/modal.tsx`
   - structured `skillRefs`
6. `web/src/pages/WasmValidationV2DpsPage.tsx`
   - ADC equipment selection, target equipment selection, passive summary and trigger evidence

## 3. 当前可表达能力

当前系统已经不是“只能打普通普攻”的早期状态。`single_attacker_dps` 现在有 `activeActions` 调度，能把普攻和技能 action 都通过 `PerformCastAt` 执行，再由 DPS lane 自己写入伤害时间线和被动触发证据。

已能表达或已有 runtime 证据的机制：

1. 普攻基础 DPS：攻速、暴击 expected policy、物理/魔法抗性、目标 HP timeline。
2. 固定 on-hit 伤害：例如短剑类额外伤害、英雄被动附伤。
3. 公式型 on-hit 伤害：固定值、攻击者属性比例、目标当前生命值、目标最大生命值、目标已损生命值、最小值。
4. every-N-hit：例如海妖、薇恩 W、第三下触发类被动。
5. 叠层后触发伤害：`add_stack` + `trigger_damage_at_stacks`。
6. 叠层属性修饰：例如鬼索式攻速叠层、黑切式目标护甲削减。
7. 常驻 / 预启用属性修饰：装备属性、状态预设、开局带 buff。
8. DoT：固定 tick 间隔、持续时间、刷新、按当前公式结算。
9. energized 充能并消耗：真实普攻充能、阈值、上限、起始 charge scenario、触发后消费。
10. phantom hit：鬼索式复制可复制 on-hit damage，且不会递归复制 phantom 或 target-side trigger。
11. owner-aware linked effect：attacker / target ownerRole、on_damage_dealt、on_damage_taken、on_spell_hit、trigger matcher。
12. target-side 基础装备：反甲式反伤 evidence、黑切式目标护甲削减、incoming percent damage_modifier synthetic proof。
13. 技能命中触发入口：`processSkillAction` 可产生 `on_spell_hit` 和 `procScope=active_skill`，可作为卢登类机制的 runtime 入口。

## 4. Web / 数据配置边界

当前边界是清晰的：

1. `item.skillRefs` 只保存装备引用哪些 item-owned skill。
2. 机制本体在被引用 skill 的 `mechanicsConfig.dpsPassiveEffects[]`。
3. Web adapter 先按装备 `skillRefs` 找到 item-owned skill，再读取 skill 的 `dpsPassiveEffects`。
4. attacker 装备被动默认走 `ownerRole=attacker`；target 装备被动必须显式 `ownerRole=target`。
5. Admin skill 页面能通过 JSON 完整编辑 `mechanicsConfig.dpsPassiveEffects`，并有只读摘要和最小校验。
6. Admin skill 页面还没有字段级结构化 authoring；装备页面也不展示被引用 skill 的 DPS passive 摘要。

这意味着：系统已经可以通过 JSON 配置和 WasmValidation 消费 ADC 装备/技能被动，但还不能让数据录入人员用安全的表单方式批量 authoring 复杂被动。

## 5. 随机组合审计

### 5.1 组合 A：金克丝 + 海妖 + 鬼索 + 破败

假设：

1. 金克丝只看普通普攻曲线，不模拟火箭 AOE。
2. 海妖是 every-N-hit 额外伤害。
3. 鬼索提供叠层攻速和 phantom hit。
4. 破败提供目标当前生命值 on-hit。

判断：大体可模拟。

依据：

1. every-N-hit、target current HP ratio、stacking stat modifier、phantom hit copyable damage 都有 runtime 支持。
2. phantom hit 只复制标记为 `phantomHitCopyable` 的 damage，适合控制哪些 on-hit 被鬼索复制。

缺口 / 疑问：

1. 金克丝 Q 火箭的范围伤害、鱼骨头额外射程和 AOE 不属于当前单标靶 DPS。
2. 真实发布数据必须逐项核对 item-owned skill 和 `skillRefs`；runtime 支持不等于当前 bundle 已录好。
3. 如果某个 on-hit 的真实规则是不被 phantom hit 复制，需要数据侧准确设置 `phantomHitCopyable=false`。

### 5.2 组合 B：薇恩 + 鬼索 + 海妖 + 收集者

假设：

1. 薇恩 W 是三环真实伤害。
2. 鬼索复制可复制 on-hit。
3. 海妖 every-N-hit。
4. 收集者需要低血量斩杀阈值。

判断：三环、鬼索、海妖可模拟；收集者斩杀阈值缺机制。

依据：

1. `trigger_damage_at_stacks` 可表达三环。
2. `damageType=true` 可表达真实伤害。
3. `phantom_hit_on_hit_repeat` 可复制可复制 on-hit damage。

缺口 / 疑问：

1. 当前 DPS passive operation 没有 `execute_threshold` / damage 后 HP 阈值即死语义。
2. 斩杀必须定义顺序：先应用本次伤害，再检查目标当前 HP / 最大 HP 比例，再标记击杀。
3. 斩杀 evidence 不能混入普通 damageBySource，否则会污染 DPS 解释。

### 5.3 组合 C：卡莎 + 纳什之牙 + 羊刀 + 目标反甲

假设：

1. 卡莎被动按命中叠层并触发额外伤害。
2. 纳什提供 AP ratio on-hit。
3. 羊刀复制部分 on-hit。
4. 目标侧反甲在受到普攻后对 attacker 造成反伤。

判断：核心可模拟，目标侧反伤只适合作为 evidence，不宜宣称完整生存闭环。

依据：

1. 叠层、AP ratio on-hit、phantom hit、ownerRole=target + on_damage_taken 都有 runtime 入口。
2. 输出已存在 `AttackerDamageTimeline` / `AttackerDamageBySource`，可记录 attacker 受到的反伤。

缺口 / 疑问：

1. 当前 DPS 的主目标是 target damage curve，不是 attacker 存活模拟。
2. 反甲递归触发、攻击者死亡停止、吸血抵消反伤等完整生存语义不应默认宣称支持。
3. 如果反甲要按护甲或重伤等更复杂条件变化，需要更完整 target/attacker 状态上下文。

### 5.4 组合 D：女警 + 火炮/疾射火炮类充能 + 斯塔缇克类连锁

假设：

1. 火炮类效果依赖 energized 充能。
2. 电刀类效果造成额外魔法伤害，真实游戏可能有连锁/多目标。

判断：单体 energized 附伤可模拟；移动充能、射程、多目标连锁缺失。

依据：

1. `energized_charge_and_consume` 支持真实普攻充能、阈值、上限、起始 charge 和触发后消费。
2. `damage` operation 可表达触发时单体附伤。

缺口 / 疑问：

1. energized 目前只支持真实普攻充能，不支持移动距离充能。
2. 不支持射程输入，因此不能证明“远距离命中”或“高倍望远镜/火炮射程收益”。
3. 多目标 chain lightning 不属于当前 single target DPS；只能近似成主目标单体附伤，但文档和页面不得宣称等价。

### 5.5 组合 E：艾希 + 无尽 + 兰顿目标侧减暴伤

假设：

1. 艾希或高暴击 ADC 走 expected crit。
2. 目标装备兰顿只降低暴击伤害。

判断：当前会 blocked，不能自然模拟“只减暴击伤害”。

依据：

1. `damage_modifier` 支持 incoming percent modifier。
2. 但 `critOnly=true` 需要 crit context。
3. 当前普攻和技能 pre-damage context 的 `HasCritContext=false`，validation / runtime 会阻止静默近似。

缺口 / 疑问：

1. 需要 DPS damage context 明确暴击上下文：expected crit contribution 还是 seeded per-hit crit。
2. 如果继续用 expected crit，必须能解释“只降低暴击部分”而不是把整段伤害直接乘一个系数。
3. 如果切 seeded crit，需要输出 roll、命中序列和可复现 seed。

### 5.6 组合 F：卢锡安 + 耀光/三相 + 纳沃利

假设：

1. 技能后下一次普攻触发咒刃。
2. 卢锡安被动双枪需要技能后额外普攻/额外 on-hit。
3. 纳沃利影响技能冷却或依赖暴击/普攻缩短技能循环。

判断：咒刃最小状态可模拟；完整技能-普攻循环和冷却收益仍不足。

依据：

1. `next_basic_attack_after_state` + scenario state 可表达“下一次普攻状态”。
2. `activeActions` 已能调度 skill action，runtime 有 `on_spell_hit`。

缺口 / 疑问：

1. 缺少面向用户的完整 rotation authoring：技能何时放、命中几段、普攻穿插规则、技能冷却重置。
2. passive 自身缺少通用 internal cooldown / proc cooldown。
3. 纳沃利类 cooldown refund/reduce 不是当前 DPS passive operation。

### 5.7 组合 G：韦鲁斯 + 羊刀 + AP on-hit + 引爆层数技能

假设：

1. 普攻叠枯萎层数。
2. 技能命中引爆层数，按层数和 AP/目标生命值造成伤害。
3. 羊刀可能复制普攻 on-hit 叠层。

判断：普攻叠层与按层触发伤害可模拟；“技能引爆已有层数”的真实 rotation 需要明确 action 事件和状态边界。

依据：

1. `add_stack` 和 `trigger_damage_at_stacks` 可表达层数伤害。
2. `processSkillAction` 能产生 spell hit 上下文。

缺口 / 疑问：

1. 当前 `trigger_damage_at_stacks` 是 operation 级触发，不是通用“某技能消费另一个 passive 的 stack” DSL。
2. 如果 stack 来源和引爆技能属于不同 skill/passive，需要明确跨 passive stack key 作用域。
3. 技能命中次数、蓄力、穿透、多目标均不在当前闭环。

### 5.8 组合 H：厄斐琉斯武器系统 + 飓风 + 多目标 on-hit

假设：

1. 厄斐琉斯不同武器改普攻行为。
2. 飓风复制攻击到多个目标。
3. 多目标 on-hit 会影响总输出。

判断：不适合当前 V2 single target DPS，不能宣称支持。

缺口：

1. 多武器队列、弹药、目标选择、多目标、分裂箭都超出当前单攻击方单标靶 DPS。
2. 如果产品要支持该类问题，需要先定义 multi-target DPS 或 encounter simulator，而不是往 `DPSPassiveEffectV2` 继续塞特例。

### 5.9 组合 I：莎弥拉 / 泽丽 / 卡莉丝塔位移类收益

假设：

1. 技能和普攻与位移、距离、角度、目标位置有关。
2. 输出受到操作节奏和命中环境影响。

判断：多数不适合当前单标靶数值曲线。

缺口：

1. 当前没有距离、坐标、弹道、移动速度、施法取消、碰撞、命中率输入。
2. 可录入部分只能是“固定命中的单体 damage action”，不能代表英雄真实机制。

## 6. 缺口分层

### 6.1 Runtime 缺口

1. `execute_threshold`：收集者、赛瑞尔达低血量阈值类机制。
2. Crit context：兰顿式只影响暴击伤害、on-crit 分支、seeded crit sequence。
3. Passive internal cooldown：一次触发后 X 秒内不再触发。
4. Cooldown refund / reduce / reset：纳沃利、朔极、技能循环装备。
5. Sustain operations：lifesteal、omnivamp、heal、shield、overheal shield。
6. Distance / range modifier：火炮、镜片、高倍望远镜、部分英雄射程/距离增伤。
7. Multi-target / projectile / chain：飓风、电刀、九头蛇、AOE 技能。
8. Cross-passive shared state：一个 skill/passive 叠层，另一个 skill/passive 消费。
9. Rich DoT stacking：多实例 DoT、独立快照、动态刷新策略。
10. Full survival closure：attacker HP、护盾、吸血、反伤导致死亡后的停止规则。

### 6.2 数据契约 / authoring 缺口

1. `dpsPassiveEffects` 缺字段级结构化编辑器。
2. item 页面缺被引用 skill 的 DPS passive 摘要和跳转。
3. 缺少机制模板库：on-hit、every-N、三环、energized、phantom hit、target-side retaliation、incoming modifier。
4. 缺少“当前机制是否 runtime-supported / page-supported / published-supported”的 authoring 提示。
5. target-side 装备必须强制提示 `ownerRole=target`，否则数据容易被错误当 attacker passive。

### 6.3 页面 / 验证缺口

1. WasmValidation 是验证页，不是 authoring 页。
2. 页面能选择装备和启用被动，但不能构造完整技能 rotation。
3. 页面缺 per-curve 初始状态的更完整输入，例如初始 charge、初始 stack、预启用 buff、目标装备状态。
4. 页面缺多 action timeline authoring：先技能、后普攻、再技能引爆。
5. 页面缺“真实发布数据覆盖证明”和“synthetic runtime proof”的并列展示，容易混淆。

### 6.4 范围外缺口

以下能力不应在当前 `single_attacker_dps` 中硬塞：

1. 多目标总伤。
2. 地图、视野、金币、复活、建筑物。
3. 友军 buff / 团战阵型。
4. 位移与弹道命中率。
5. 完整战斗 AI 或最优 rotation 搜索。

## 7. 找茬式测试维度

本节不再按“哪些机制能做”来写，而是按测试工程的方式故意构造极端、非法、冲突和高组合复杂度输入。测试目标不是让所有组合都通过，而是确认系统能给出正确数值、明确 blocked reason，或暴露真实缺口。

### 7.1 属性边界值

| 维度 | 组合假设 | 当前代码判断 | 需要补的验证或缺口 |
| --- | --- | --- | --- |
| 暴击率 0% | 6 件无暴击装，`crit_chance=0` | expected crit scalar 应为 1 | 需要页面展示 rawDamage 不含暴击期望 |
| 暴击率 25% / 50% / 100% | 常规 ADC 暴击装组合 | `resolveCritApplication` 接受 `0..1`，expected scalar 为 `1 + chance * (multiplier - 1)` | 已有 25%、50%、100% 测试迹象，但应补真实装备 6 件组合 |
| 暴击率 101% | 4~6 件暴击装导致超过 100% | 当前不是 clamp；`resolveCritApplication` 对 chance > 1 返回 numeric error，DPS 会 blocked | 必须决定产品语义：Web adapter clamp 到 1，还是 runtime blocked 并提示装备配置异常 |
| 暴击率 150% | 6 件装备都给 25% 暴击率 | 当前会 blocked，不会按 150% 期望暴击继续放大 | 这是高优先级缺口；用户会自然这样配装，页面不能只显示“算不了”而不解释 |
| 负暴击率 | 数据错误或 debuff 导致 `<0` | 当前会 numeric blocked | 需要 authoring 校验提前拦截 |
| 暴击伤害 0 | `crit_damage=0` | crit multiplier 为 0 时 runtime 会归一为 1 | 需要确认这是预期兼容还是数据错误 |
| 暴击伤害 <0 | 错误数据 | 当前会 numeric blocked | Admin 保存和发布前应拦截 |
| 暴击伤害极大 | 例如 10x | 当前只要 finite 且非负可计算 | 需要防止结果溢出、图表压扁、DPS 数值显示失真 |
| 攻速 0 / 缺失 | 装备或英雄数据缺 `attack_speed` | `validateDPSCurve` 要求正攻速，否则 blocked | 页面应把缺失归因到数据，不应显示空图 |
| 攻速 2.99 / 3.00 / 3.01 | 边界攻击速度 | 已有 cap 边界测试：effective cap 3.0，overflow 单独记录 | 这是好的模式，应在 UI 中显示 raw/effective/overflow |
| 攻速 10 | 多件攻速装 + 鬼索 + 技能 buff | runtime clamp 到 3.0，overflow 很大 | 需要确认装备/技能 buff 是否仍影响其他机制，例如“溢出攻速转化”类未来机制 |
| 攻速负数 | 错误 debuff 或数据录入 | readFirstPositiveAttr 不会接受，最终 blocked | Admin 需要防止 stat_modifier 把攻速乘成负数 |
| AD 为 0 | 只看 on-hit 或法伤 ADC | 基础普攻 raw 可能为 0，但 on-hit 仍可输出 | 应测试“基础伤害为 0 但被动有伤害”是否正常展示 |
| AD 负数 | 数据错误 | 可能导致 rawDamage 非法或被 applyDamage 阻塞 | 需要明确 blocked reason，而不是负伤害治疗目标 |
| 护甲 / 魔抗 0 | 无抗性木桩 | 正常计算 | 应作为大多数边界的 baseline |
| 护甲 / 魔抗极高 | 1000+ 抗性木桩 | mitigation 公式应输出很小但非负伤害 | 图表和 breakdown 要能解释 |
| 护甲 / 魔抗为负 | 负抗性目标 | `applyPositiveResistancePenetration` 仅对正抗性穿透，负抗性会进入 mitigation | 需要确认负抗性公式与 LoL 语义一致 |
| 穿甲比例 >100% | 多来源穿透叠加 | 当前 percent pen clamp 到 `0..1` | 需要 evidence 显示被 clamp，避免用户误以为 150% 穿透继续收益 |
| 固定穿甲极大 | flat pen 大于护甲 | 当前正抗性穿透后最低 0 | 合理，但需要测试与负抗性目标叠加时不会反向放大 |
| HP 为 1 | 斩杀、已损生命值、当前生命值比例边界 | 基础 damage 可杀死目标，stopReason target_dead | execute 缺失时不能表达收集者 |
| CurrentHP 为 0 | 用户想表达“开局 0 血”或错误数据 | 当前不是 blocked；`CurrentHP<=0` 路径会回退到 MaxHP 语义 | 必须文档化：当前不支持用 0 表达开局死亡；建议改成显式 blocked 或 UI 提示 fallback |
| CurrentHP > MaxHP | 错误木桩数据或护盾误填 HP | 当前需要专项核对，可能直接进入伤害计算 | 应当 blocked 或 clamp，并输出原因 |
| HP 极大 | 10M 木桩 | 计算能跑，但 timeline 可能很长 | 需要 MaxEvents / Duration 保护 |
| HP NaN / Inf | JSON 或转换链异常 | 局部 damage path 有 NaN/Inf 防线，但 validate 未统一兜底 | 应在 runInput validate 前统一 blocked |
| MaxHP 为 0 | 错误目标 | validate 要求 target max hp positive，blocked | 已有基础防线 |
| MaxHP NaN / Inf | 错误目标 | 当前要专项核对，不能假设所有路径都拦截 | P0 数值输入防线 |

### 7.2 六件装备组合攻击面

六件装备不是简单把六个 itemId 串起来。测试要区分属性叠加、被动叠加、唯一被动、重复装备、目标装备和技能状态之间的冲突。

| 组合 | 故意找茬点 | 当前风险判断 | 应补测试 |
| --- | --- | --- | --- |
| 6 件暴击装，`crit_chance=1.5` | 暴击率超过上限 | 当前 runtime blocked；Web adapter 只是累加 `statModifiers`，未见装备侧 clamp | `crit_chance` 超 1 的 blocked reason 是否能直接告诉用户“暴击率超过100%” |
| 6 件攻速装 + 鬼索叠满 | raw AS 远大于 3.0 | runtime cap 到 3.0 并记录 overflow | 验证 overflow 是否展示；确认鬼索后续层数不会让 event loop 过密 |
| 6 件固定 AD 装 + 技能按 base AD | base/resolved 区分 | `AttackerAttrRead=base` 会忽略装备 stats，缺 view 会 blocked | 需要组合测试同一曲线里同时有 base AD 咒刃和 resolved AD on-hit |
| 6 件穿甲装 + 黑切目标削甲 | 正抗性穿透 + target stat_modifier 叠加 | target armor shred 可影响后续 mitigation；穿透只读 attacker attrs | 需要验证顺序：先黑切削目标甲，再下次普攻穿透 |
| 6 件吸血/护盾装 | sustain 不影响 target DPS | 当前缺 lifesteal/heal/shield passive operation | 页面应标注“不进入当前 DPS”，不能悄悄忽略 |
| 6 件带 unique 被动同名装备 | 唯一被动去重 | 当前 enabledPassiveEffects 按 id，装备 stats 按 item 累加；没有通用 unique passive group | 需要数据契约支持 uniqueGroup 或 authoring 校验 |
| 重复 6 件同一装备 | 重复装备是否合法 | adapter 当前按 itemIds 迭代累加，是否允许重复取决于页面输入 | 需要明确游戏模式是否允许重复；不允许则 Web 应去重或 blocked |
| attacker 6 件 + target 6 件 | 双方装备同时影响 | targetEquipmentStats 已有路径，target ownerRole 有 preflight | 需要验证 attacker 装备不会进入 target，target 被动不会误当 attacker |
| 装备属性有限但被动缺 skillRefs | 只有 stats，没有机制 | 当前 stats 会生效，被动不会 | 页面必须显示“被动未接入”，避免误判装备完整支持 |
| item `skillRefs=[]` 或字段缺失 | item 有多个 item-owned skills | 当前 adapter 的 `itemSkillLinkedByRefs` 对空集合返回 true，等价于匹配该 item owner 下所有 skill | P0：必须决定空引用是“无被动”还是“全匹配”；当前语义容易静默多算 |
| item skillRefs 指向不存在 skill | 引用断裂 | adapter 找不到 skill 时被动缺失，可能只剩 stats | 需要 published-contract checker 报断链 |
| item skillRefs 指向 hero skill | ownerType 错误 | item selector 只选 item-owned skill，但后端/seed 数据可能绕过 | adapter 要忽略或 blocked，并给 authoring 错误 |
| item skillRefs 指向其他 item 的 skill | ownerId 错误 | selector 可防一部分，JSON/seed 可绕过；adapter 只收 `ownerType=item && ownerId=itemId`，错误时可能静默丢失 | 发布链必须校验 `skill.ownerType=item && skill.ownerId=itemId` |
| item skillRefs 重复 | JSON 手填重复 id | Select 多选通常去重，但 JSON/后端不一定拒绝 | 应统一去重或报错，避免 published-contract 与页面数量不一致 |

### 7.2.1 `skillRefs` P0 断链测试

`skillRefs` 是当前真实装备被动闭环里最容易“看起来能跑、实际多算或少算”的位置。P0 测试应覆盖：

1. `skillRefs` 缺失：期望是 blocked、stats-only warning，还是全匹配，必须二选一并写进契约。
2. `skillRefs=[]`：不能继续让不同工程师按不同直觉理解；当前 adapter 语义是全匹配。
3. `skillRefs=["bad_id"]`：后端保存/发布应 blocked。
4. `skillRefs=["hero_skill_x"]`：即使 skill 存在，也必须因 ownerType/ownerId 不匹配 blocked。
5. `skillRefs=["other_item_skill"]`：必须 blocked，不能只在 adapter 静默丢失。
6. `skillRefs=["same","same"]`：去重或 blocked，要有明确规则。
7. item 有两个 item-owned skill，但只引用一个：只应启用被引用 skill，另一个不能被空引用语义误带入。
8. target item 的 skillRefs 指向 attacker ownerRole passive：应在 preflight 给出 ownerRole mismatch。

测试结论应写成三色结果：

1. green：引用精确，ownerType/ownerId/ownerRole 均正确。
2. yellow：只有 stats 生效，被动未接入，页面必须提示 stats-only。
3. red：引用断裂、跨 owner、ownerRole 错误或空引用语义不明确，必须 blocked。

### 7.3 被动触发边界

| 机制 | 边界输入 | 当前判断 | 找茬目标 |
| --- | --- | --- | --- |
| `every_n_basic_attack_hit` | `everyN=0` | validation blocked | blocked reason 是否指向具体 passive |
| `every_n_basic_attack_hit` | `everyN=1` | 每次普攻触发 | 与 on-hit 普通被动顺序是否稳定 |
| `every_n_basic_attack_hit` | `everyN=999` | 短 duration 内永不触发 | 页面应显示“未触发”，不是认为被动缺失 |
| `add_stack` | `maxStacks=0` | validation blocked | JSON authoring 需要提前拦截 |
| `add_stack` | stack duration 正好在下一次普攻时间过期 | runtime 有 expire 边界逻辑 | 需要测试 `time == expireAt` 是有效还是过期 |
| `trigger_damage_at_stacks` | `triggerStacks > maxStacks` | 永远不触发 | 应有 authoring warning |
| `trigger_damage_at_stacks` | `resetStacks=false` | 达阈值后可能每次继续触发 | 对三环类通常应 reset；不 reset 要有 evidence |
| `phantom_hit_on_hit_repeat` | `repeatCount=0/2` | validation 要求 1 | 正确 blocked |
| `phantom_hit_on_hit_repeat` | copyable damage 缺失 | validation blocked | 正确 blocked |
| `phantom_hit_on_hit_repeat` | phantom hit 再触发 phantom | runtime 用 `phantomDepth` 防递归 | 需要回归测试防无限循环 |
| `energized_charge_and_consume` | `chargeGain=0` | validation blocked | 正确 blocked |
| `energized_charge_and_consume` | 初始 charge=99，gain=25 | 下次普攻后 ready，再下一次触发还是当次触发需要明确 | 文档/测试必须锁定时序 |
| `energized_charge_and_consume` | 初始 charge=100 | t=0 第一击是否直接触发 | 已有 Batch N 语义，但应纳入边界矩阵 |
| `energized_charge_and_consume` | `consumeChargeOnTrigger=false` | validation blocked | 防止无限每击触发 |
| DoT | duration=4000, tick=1000 | expireAt=4000 是否含 tick | 当前测试包含 4000 tick | UI 应解释边界 |
| DoT | tickIntervalMs=500 | validation / runtime 不支持 override | blocked，不应近似成 1000 |

### 7.4 事件顺序与叠加顺序

当前最容易出现“数值看起来对，但解释错”的地方是顺序。

必须专门找茬的顺序：

1. 基础普攻伤害是否先于 attacker on-hit。
2. attacker on-hit 是否先于 target on_damage_taken retaliation。
3. incoming `damage_modifier` 是否在 damage timeline 写入前生效。
4. target `stat_modifier` 是否影响当前这一下，还是下一下。
5. 黑切削甲、穿甲、damage_modifier 同时存在时的顺序。
6. phantom hit 是否在 target retaliation 之后，还是只复制 attacker on-hit。
7. DoT tick 与同时间点普攻谁先执行。
8. 同一时间多个 active actions 是否按 priority / listOrder 稳定排序。
9. blocked curve 是否污染同 batch 其他 curve。
10. target 死亡后同时间剩余 passives 是否还执行。

当前代码已有部分保护：scheduler 按 active action priority/listOrder，blocked curve 结果隔离，phantomDepth 防递归，incoming damage_modifier 有专门 pre-damage 管线。但组合级测试仍不足，尤其是“黑切 + 兰顿 + 鬼索 + DoT + target 反甲”这类混合顺序。

### 7.5 非法 JSON / authoring 测试

| 输入 | 当前风险 | 应有行为 |
| --- | --- | --- |
| `dpsPassiveEffects` 不是数组 | skillModels 会报 error | Admin 禁止保存 |
| 缺 `version` 或 `triggers` | validateDpsPassiveEffects 报错 | Admin 禁止保存 |
| `ownerRole` 缺失 | 兼容默认 attacker，有 warning | target 装备必须禁止缺失 |
| `ownerRole=target` 放在 attacker 装备里 | adapter 应不当 attacker 被动执行 | 页面显示 skipped / blocked reason |
| `ownerRole=attacker` 放在 target 装备里 | target preflight 应报 mismatch | 不能静默忽略 |
| `operations.kind` 拼错 | skillModels warning，runtime validation blocked | warning 应升级为保存阻断还是发布阻断需要确认 |
| `damageType` 拼错 | runtime validation blocked | Admin 应提前固定枚举 |
| `targetRole=self` | runtime validation blocked | Admin 应提前固定枚举 |
| 数值字段字符串 `"25"` | TS 可能透传，Go JSON 到 float 可能失败或为 0 取决于路径 | 后端发布校验必须阻断 |
| `NaN` / `Infinity` | JSON 本身不合法或被过滤 | authoring 层应阻断 |
| 重复 passiveId / triggerId | 运行时 key 可能冲突 | 需要 compile/publish 阶段唯一性校验 |
| 空 sourceId | runtime validation blocked | Admin 应必填 |
| `maxStacks=999999999` | 合法 finite，但没有业务意义 | 应 authoring warning 或上限，否则压力测试可能失真 |
| `chargeCap=999999999` | 合法 finite，但超出实际机制 | 应 authoring warning 或上限 |
| `durationMs=999999999` | 可能制造长期状态和巨大 timeline | 应受 duration / MaxEvents 保护，并提示配置异常 |

### 7.5.1 NaN / Inf / 极大 finite 输入防线

测试不能只覆盖 JSON 解析失败，还要覆盖“合法 JSON 但数值荒谬”的输入：

1. `crit_chance=1.5`：合法数字，但超业务上限，当前 runtime blocked。
2. `attack_speed=1e9`：合法数字，应被 cap，不能制造 0ms interval。
3. `armor=1e9`：合法数字，应输出接近 0 的有限伤害，不应 NaN。
4. `armor=-1e9`：合法数字，负抗公式是否仍稳定，需要测试。
5. `targetCurrentHpRatio=1e6`：合法数字，但可能一击超大伤害，应 finite 且可解释。
6. `targetMaxHpRatio=-1`：合法数字但语义非法，应 blocked，而不是治疗目标。
7. `targetMissingHpAmp=1e6`：合法数字但图表会失真，应限制或提示。
8. `chargeGainPerBasicAttack=1e9`：应 clamp 到 cap 或 blocked，不能让 charge 变 NaN。
9. `DurationMs=1e9`：不能生成无限 timeline，应受 MaxEvents 或页面限制。
10. `MaxEvents=1`：应稳定 event_limit，并且同 batch 其他 curve 不受污染。

这些测试的核心判断标准是：合法 JSON 不等于合法机制；finite 数字也不等于可接受业务输入。

### 7.6 输出解释测试

随机组合很容易出现“结果是 ok，但用户无法判断哪些机制真的生效”。因此需要把输出解释也作为测试对象：

1. `DamageTimeline` 必须能区分 basic attack、item on-hit、hero passive、phantom hit、DoT tick。
2. `ItemPassiveTriggers` 和 `SkillPassiveTriggers` 必须能区分 sourceCategory。
3. `EffectBreakdown` 必须显示 attribute read 是 base 还是 resolved。
4. 攻速超过 cap 时必须展示 raw/effective/overflow。
5. 暴击 expected 模式必须展示 critPolicy 和 crit multiplier 来源。
6. 被 blocked 时不能只有 `blocked`，要能指向具体 passive、operation 或装备数据。
7. synthetic runtime proof 和真实 published bundle proof 必须分开展示。

## 8. 高风险随机组合清单

这一节按“测试人员故意找麻烦”的方式列组合。每个组合都应该最终转成一条或多条测试、页面 preflight 或 authoring 规则。

### 8.1 超上限暴击套

组合：

1. 任意 ADC。
2. 6 件都含 25% 暴击率的装备。
3. 目标装备兰顿或其他 `critOnly` damage_modifier。

预期问题：

1. `crit_chance=1.5` 当前会让 crit resolution blocked。
2. `critOnly` 又需要 crit context，也会 blocked。
3. 如果 Web 未来 clamp 到 1，则兰顿仍不知道 expected crit 中哪部分是暴击贡献。

结论：

这是最高优先级找茬用例。它同时暴露“属性上限策略”和“暴击上下文策略”两个缺口。

### 8.2 超攻速鬼索套

组合：

1. 高基础攻速 ADC。
2. 6 件攻速装。
3. 鬼索叠满。
4. 额外技能攻速 buff scenario。

预期问题：

1. rawAttackSpeed 可能远大于 3。
2. effectiveAttackSpeed 应固定 3。
3. overflowAttackSpeed 应保留证据。
4. 事件数量不能因为 raw AS 进入 0ms interval。

结论：

runtime 方向较稳，但页面解释必须补。后续若出现“溢出攻速转伤害/特效”机制，需要新规则。

### 8.3 穿甲与削甲叠满套

组合：

1. 6 件穿甲/百分比穿甲装。
2. 黑切 target armor shred。
3. 目标护甲从 0、100、1000、-50 各测一条曲线。

预期问题：

1. percent pen clamp 到 100%。
2. flat pen 不应把正护甲穿成负数。
3. target armor shred 与 attacker penetration 的顺序必须明确。
4. 负护甲目标不能被错误 clamp 到 0，除非产品明确选择。

结论：

这是 Batch R 乘区和属性修饰平台的重要回归用例。

### 8.4 多个 every-N 与 phantom hit 混合套

组合：

1. 薇恩 W 三环。
2. 海妖三下。
3. 鬼索 phantom hit。
4. 另一个 every-2 on-hit。

预期问题：

1. 每个 passive 的 hitCounts 必须独立。
2. phantom hit 是否计入 every-N 要受 matcher / procScope 控制。
3. 第 6 次命中多个 passive 同时触发时顺序稳定。

结论：

需要组合测试，不应只测单个 every-N。

### 8.5 Energized 多来源套

组合：

1. 火炮类 energized。
2. 电刀类 energized。
3. 迅刃/技能穿插。
4. 初始 charge 分别为 0、99、100、125。

预期问题：

1. 多个 energized 是否共享 chargeKey。
2. chargeCap 是否 clamp。
3. 初始超过 cap 是否 clamp 或 blocked。
4. 当次命中是先 gain 后 check，还是先 check 后 gain。

结论：

当前 energized 合同偏窄，只适合真实普攻充能并消耗；多来源共享规则需要明确。

### 8.6 反甲 + 吸血 + 护盾套

组合：

1. ADC 有饮血/盾弓/吸血。
2. 目标有反甲。
3. 攻击者低血量。

预期问题：

1. 当前反伤可作为 attacker damage evidence。
2. 但吸血、护盾、攻击者死亡停止规则缺失。
3. 如果页面只展示 target DPS，会掩盖“攻击者已死”问题。

结论：

不要在当前页面宣称生存闭环。应另拆 sustain / survival batch。

### 8.7 技能轮转触发装备套

组合：

1. 卢锡安技能后被动双枪。
2. 耀光下一次普攻。
3. 卢登 on_spell_hit。
4. 纳沃利缩短技能冷却。

预期问题：

1. runtime 有 skill active action 和 on_spell_hit。
2. 但页面缺完整 rotation authoring。
3. passive internal cooldown / cooldown refund 缺失。

结论：

可以做最小 timeline 输入，但不能直接宣称完整 rotation。

### 8.8 重复装备与唯一被动套

组合：

1. 6 件同一件暴击装。
2. 6 件同一件带唯一被动装备。
3. 同一 item-owned skill 被多个 itemRefs 指向。

预期问题：

1. stats 是否重复叠加取决于 itemIds 是否去重。
2. unique passive group 当前不是一等契约。
3. duplicate passiveId / triggerId 可能导致 runtime key 冲突。

结论：

需要 product rule：竞技场是否允许重复装备。如果不允许，Web selection 应拦；如果允许，需要 uniqueGroup 契约。

### 8.9 目标装备误接入套

组合：

1. target 选择反甲，但反甲 item-owned skill 缺 `ownerRole=target`。
2. attacker 选择一个误写 `ownerRole=target` 的装备。
3. 两边都带同一个 item。

预期问题：

1. target preflight 已有 mismatch reason。
2. attacker 装备被动不应执行 target-owned passive。
3. 页面要显示“有 skillRefs 但 ownerRole 错误”，而不是只显示无被动。

结论：

这是 Web adapter / authoring 层最高优先级测试之一。

### 8.10 空 skillRefs 多算套

组合：

1. 一个 item 下有两个 item-owned skill：一个是真实被动，一个是历史/测试/废弃 skill。
2. item 的 `skillRefs` 缺失或为空数组。
3. 页面选择该装备。

预期问题：

1. 当前 adapter 会把空引用视为全匹配，有可能把两个 skill 的 `dpsPassiveEffects` 都投进 snapshot。
2. 如果废弃 skill 仍带 passive，结果会多算。
3. 页面很难从最终 DPS 曲线看出“多算了一个废弃被动”。

结论：

这是比“引用不存在”更危险的错误，因为它不会失败，而是可能成功输出错误结果。建议改成：空 `skillRefs` 表示无引用；需要全匹配时必须写显式 sentinel 或迁移脚本补齐引用。

### 8.11 ownerId 指错少算套

组合：

1. item A 的 `skillRefs` 指向 skill X。
2. skill X 存在，且 `ownerType=item`，但 `ownerId=item B`。
3. item A 被选中。

预期问题：

1. 后端如果只校验 skill 存在，会放过。
2. adapter 会因 ownerId 不匹配而不读取 skill X。
3. 页面表现为 stats-only 或少一个被动，而不是明确错误。

结论：

published-contract checker 必须校验引用对象的 ownerType/ownerId，不应只校验 skillId 存在。

### 8.12 HP=0 fallback 套

组合：

1. 目标 `CurrentHP=0`、`MaxHP=3000`。
2. 用户期望表示“目标已死”或低血线测试。
3. 搭配收集者 / 已损生命值 / 当前生命值比例被动。

预期问题：

1. 当前 `CurrentHP<=0` 会回退到 MaxHP，不会开局死亡。
2. 已损生命值类公式会按满血目标算，不是低血线。
3. 收集者类 execute 将来若接入，也会因 fallback 得到完全不同结果。

结论：

需要明确 target initial HP 输入语义。低血线测试应使用正数 `CurrentHP`，例如 1、MaxHP*0.05、MaxHP*0.5；0 应 blocked 或显示 fallback。

### 8.13 随机组合样本库

以下样本不要求真实游戏最优出装，只用于把机制打散重组，逼出系统边界。每条都应最终转成 synthetic payload、published bundle 检查或页面验收用例。

| # | 随机组合 | 主要攻击面 | 当前判断 | 缺口 / 疑问 |
| --- | --- | --- | --- | --- |
| 1 | 艾希 + 6 暴击装 + 兰顿目标 | 暴击率 150%、critOnly 减伤 | 会撞到 `crit_chance>1` 与 crit context 双重边界 | 产品要决定暴击溢出 blocked、clamp 还是转收益。 |
| 2 | 烬 + 无尽 + 收集者 + 火炮 | 第 4 发、暴击序列、execute、距离 | 当前不能证明真实第 4 发，也缺 execute | seeded crit 与 execute threshold 都是 runtime 缺口。 |
| 3 | 金克丝 + 鬼索 + 海妖 + 破败 | every-N、phantom、当前 HP on-hit | 核心可 synthetic，但顺序必须测 | phantom 是否推进海妖；破败 HP basis 用 attack_start 还是 current。 |
| 4 | 薇恩 + 鬼索 + 海妖 + 目标反甲 | 三环 true damage、phantom、反伤 | 输出侧可近似，生存闭环不支持 | 反伤只做 attackerDamage evidence，不能影响继续输出。 |
| 5 | 卡莎 + 纳什 + 羊刀 + AP on-hit | AP ratio、stack、phantom | 部分可表达 | skill/passive 跨 key 消费 stack 的语义需要确认。 |
| 6 | 卢锡安 + 三相 + 夺萃 + 鬼索 | spellblade、双枪、phantom | 只能预置 next-attack；不能完整 rotation | 双枪第二段是否算 basic hit、是否推进 charge/stack 需要状态机。 |
| 7 | 德莱文 + Q 斧 + 三相 | 技能后下一击、特殊普攻 | 可用 scenario state 做 synthetic | 没有接斧/掉斧/多斧状态机，不能宣称完整。 |
| 8 | EZ + 三相 + 纳沃利 + 魔宗 | 技能轮转、CD refund、魔宗数值 | 当前不足 | 缺主动技能 timeline、cooldown refund、manual baseline。 |
| 9 | 图奇 + 飓风 + 电刀 + 九头蛇 | DoT、弹射、多目标 chain | 单目标范围外 | 只能主目标 DoT；副目标收益必须 out-of-scope。 |
| 10 | 希维尔 + 飓风 + 海妖 | 弹射是否触发 on-hit/every-N | 单目标范围外 | 不应让弹射推进主目标 every-N。 |
| 11 | 厄斐琉斯 + 飓风 + 鬼索 | 武器系统、多目标、phantom | 不适合当前 DPS | 需要武器队列/弹药/副目标模型。 |
| 12 | 格雷福斯 + 6 攻速装 + 鬼索 | 特殊普攻、换弹、AS cap | AS cap 可测，换弹不支持 | raw/effective/overflow 可证明；霰弹/换弹不能平均化。 |
| 13 | 泽丽 + 纳沃利 + 三相 | 普攻替代、技能轮转 | 当前不能完整支持 | Q 类普攻替代需要 action classifier 与 cadence 决策。 |
| 14 | 凯特琳 + 火炮 + 爆头 | 距离、特殊普攻、暴击收益 | 距离不支持 | 爆头距离/陷阱/网命中 baseline 需人工。 |
| 15 | 卡莉丝塔 + 距离收益 + 攻速装 | 位移/距离/攻速 | 距离与位移不支持 | 只能测攻速曲线，不能测武术姿态真实收益。 |
| 16 | Samira + 近远 Q + 收集者 | 距离分支、execute | 两个关键缺口 | 近/远距离分支没有输入；execute 未实现。 |
| 17 | Kindred + 标记 + 火炮 | 标记成长、距离 | 不适合直接录入 | 标记属于长期状态；距离收益缺输入。 |
| 18 | Kayle + 登神 + 鬼索 | 等级阶段、距离/溅射、phantom | 低阶可 scenario，高阶不足 | 需要等级阶段状态和多目标/距离拆分。 |
| 19 | Corki + 魔宗 + 穿甲/法穿混合 | 混伤、manual baseline、穿透 | 基础混伤可测，真实被动缺 baseline | 需要明确物理/魔法/真实分布和 rank 数值。 |
| 20 | Quinn + E + 火炮 | 距离/位移后收益 | 当前不足 | 缺位移和命中距离上下文。 |
| 21 | 6 穿甲装 + 黑切 + 负护甲目标 | 护甲乘区、shred、穿透 | 可作为 Batch R 核心回归 | 顺序、clamp、负抗性公式必须有逐击 evidence。 |
| 22 | 6 同一件鬼索 | 重复 stats、唯一被动、duplicate passive | 产品规则未定 | UI 禁止、adapter 去重、runtime blocked 三选一。 |
| 23 | 6 同一件海妖 | every-N 多实例 | 高风险假阳性 | 若允许重复装备，要定义每件独立计数还是唯一被动。 |
| 24 | 电刀 + 火炮 + 岚切 + 电震涡流剑 | 多 energized | 部分可 synthetic | chargeKey 共享/隔离、移动充能、多目标 chain 都要拆开。 |
| 25 | 反甲目标 + 兰顿目标 + ADC 吸血 | target-side + survival | target-side 可 evidence，survival 不闭环 | 页面不能让用户误以为算了生存胜负。 |
| 26 | item `skillRefs=[]` + 废弃 passive | 发布数据断链 | 当前最高风险静默多算 | 必须改契约或至少加 checker。 |
| 27 | item A 引用 item B 的 skill | 发布数据错链 | 静默少算风险 | ownerType/ownerId 校验必须前移到发布检查。 |
| 28 | skill passive 缺 `ownerRole` 的 target 装备 | 目标装备误接入 | 页面已有部分 reason，但仍需合同化 | target 装备必须强制 ownerRole=target。 |
| 29 | `CurrentHP=0` + 收集者 | HP fallback + execute | 当前会按满血语义 | execute 接入前必须先修 HP 输入语义。 |
| 30 | NaN 攻速 + Inf 暴击 + 极大 on-hit | 非法 JSON / 数字防线 | 不应进入 runtime 正常曲线 | authoring/adapter/runtime 至少一层字段级 blocked。 |

这 30 组覆盖了五类结果：当前可 synthetic 验证、需要 runtime 扩展、需要 authoring/数据契约、需要产品规则、明确范围外。后续如果要自动生成随机组合，应先把每件装备和技能打上机制标签，再按上面的攻击面挑 pairwise / triple-wise 组合，而不是无目标地随机抽 6 件。

## 9. 英雄池找茬矩阵

本节把 Batch G 的 ADC/射手候选按“最容易测出系统假阳性”的机制切开。目标不是马上实现全部英雄，而是防止后续看到某个英雄名时误以为“已有 on-hit / stack / activeActions 就等于支持真实机制”。

| 机制类别 | 代表英雄 / 技能 | 当前系统判断 | 找茬边界 | 优先级 |
| --- | --- | --- | --- | --- |
| 暴击序列 / on-crit 分支 | 艾希 P、烬 P、赏金 R、Yunara P、猎魔人弩箭 | 当前 DPS lane 只接受 `critPolicy=expected`。普通 runtime 有 crit 计算入口，但单攻方 DPS 被动缺少逐击 roll、seed、on-crit 状态和“暴击贡献拆分”上下文。 | 0%、50%、100%、150% 暴击率；烬第 4 发不能用平均暴击替代；艾希“不能正常暴击但按暴击率增伤”不能误当普通 crit；`critOnly` modifier 缺 crit context 必须 blocked。 | P0 |
| 攻速叠层 / 掉层 | 艾希 Q、EZ P、金克丝 P、格雷福斯 E、克格莫 Q/W | `stat_modifier`、perStack 和 attack interval evidence 已可表达第一层；但全局攻速 cap 固定 3.0，溢出只记录，不转化为额外收益。 | 叠层刷新还是延长；掉层后下一次普攻间隔是否重算；攻速 buff 是否影响已经排程的下一击；raw AS 10 不能造成 0ms interval。 | P0 |
| 距离 / 射程收益 | 杰斯 R、Kalista P、Kayle P、Kindred P、Quinn E、Samira P/Q、Twitch R、Vayne Q、火炮/镜片 | 当前 curve 没有攻击距离、目标距离、施法距离、命中距离输入；这类机制不能伪编码成固定增伤。 | 距离 0、最大射程、超射程；近战/远程形态切换；距离影响“能否命中”还是“命中后伤害”；按施放距离还是命中距离取值。 | P1 |
| 多目标 / 弹射 / AOE | 阿克尚 E、艾希 W/R、金克丝 Q、希维尔 W、霞羽毛、厄斐琉斯武器、泽丽、卢安娜、电刀、九头蛇 | `single_attacker_dps` 不闭环副目标、弹射、范围收益。最多可记录主目标单段，不应把副目标收益折算回单目标。 | 副目标伤害不能混入主目标 DPS；弹射是否推进 every-N/stack 必须显式 blocked 或隔离；副目标击杀触发不能污染主目标曲线。 | P1 |
| 技能后下一击 / spellblade | 德莱文 Q、卢锡安 P、耀光、三相、巫妖、夺萃、黄昏与黎明、黯影阔剑 | 已有 `next_basic_attack_after_state` 与 `ScenarioStates`，可表达“预置下一击状态”；但没有完整 rotation 求解。 | 无施法事件时不能自动产生 spellblade；状态只触发一次并 consume；phantom 不复制 spellblade；多层 next-attack 状态按优先级还是最新状态。 | P0 |
| 叠层触发伤害 | 薇恩 W、卡莎 P、韦鲁斯 W、图奇 P、黑切、鬼索 | 已有 `add_stack`、`trigger_damage_at_stacks`、DoT、perStack stat、phantom copyable；风险在顺序和状态作用域。 | 第 N 层是加层前还是加层后触发；触发后 reset；持续时间 refresh/extend；不同 passive 同名 stackKey 是否隔离；phantom 是否推进 stack/every-N。 | P0 |
| 特殊普攻 / 普攻替代 | 烬第 4 发、格雷福斯霰弹/换弹、泽丽 Q、厄斐琉斯武器普攻、卢锡安双枪 | `basicAttackActions` 可以挂多个普攻 action，但不是弹药、换弹、武器队列或普攻替代系统。 | 多 basic action 如何选择；特殊普攻是否仍带 `action/basic_attack` classifier；双击第二段是否推进 on-hit/charge；换弹空窗是否停止 DPS。 | P0 |
| 资源 / 武器 / 形态状态机 | 厄斐琉斯 P/W/E、金克丝 Q、杰斯锤炮、格雷福斯弹药、泽丽能量 | 只能用 `ScenarioStates` 人工预置，不能自动切武器、耗弹、切形态或求最优循环。 | 初始形态/弹药作为 baseline 输入；资源不足应 blocked 还是跳过 action；状态切换后下一击 skill/action 是否变；耗弹是否影响攻速或停顿。 | P1 |
| 生存收益 | 阿克尚 P、饮血、盾弓、死亡之舞、Maw、守护天使、巨蛇 | 当前 DPS 输出不闭环治疗、吸血、护盾、复活。target-side 反伤可以作为 evidence，但不是 attacker 生存模拟。 | 生存收益不得改变 target HP；吸血不反哺输出窗口；反伤导致 attacker 死亡是否停止输出目前应声明不支持；护盾削减不等于 DPS。 | P2 |
| 手工 baseline | 厄斐琉斯全套、格雷福斯 P、飞机 P/E、凯特琳 E/R、魔宗、纳沃利、死亡之舞 | Batch G 多处 `needs_manual_baseline`，本地 Data Dragon 无法还原完整数值/rank 表；系统能力不能替代真值。 | 固定等级、技能等级、装备、目标抗性；记录逐击 timeline；缺 baseline 时测试标 pending/manual，不得写成 supported。 | P0 |

英雄池的找茬结论是：P0 不是“最难实现”，而是“最容易把已有能力误判为支持”的类别。暴击序列、攻速叠层、next-attack、叠层/phantom、特殊普攻都必须先用 synthetic case 锁住边界，再谈真实英雄录入。

## 10. 装备池找茬矩阵

装备比英雄更危险，因为用户会自然组合 6 件装备，且页面看起来更像“自由搭配”。以下矩阵按装备录入、组合、目标侧装备和页面解释四层找茬。

| 装备类别 | 代表装备 | 当前系统判断 | 找茬边界 | 产物要求 |
| --- | --- | --- | --- | --- |
| 纯属性装 | 无尽、凡性、轻语类、攻速暴击装 | `resolveEquipmentStats` 会累加装备 stats；是否允许重复 itemIds 是产品规则，不是 runtime 自动真理。 | 6 件同装；暴击率 150%；攻速 10；百分比穿透叠到 100%+；负护甲目标。 | Web adapter 单测 + 页面 warning。 |
| 唯一被动 / 重复被动 | 鬼索、海妖、破败、界弓、同 item-owned skill 多次引用 | 当前缺一等 `uniqueGroup` 契约。重复 item 或重复 skillRef 可能造成多算或 key 冲突。 | 同 passiveId 两份；同 triggerId 两份；同 skill 被两个 itemRefs 指向；重复装备是否 stats 叠加但唯一被动不叠加。 | published checker + adapter preflight。 |
| on-hit 固定/比例伤害 | 纳什、智慧末刃、破败、界弓、海妖 | 固定 on-hit、目标当前 HP、目标已损 HP、every-N 已有部分支持；风险在数值来源和 phantom copyable。 | phantom 是否复制；目标 HP basis 用 attack_start 还是 current；true damage 是否绕过抗性；同一击多个 on-hit 顺序。 | Go runtime 组合测试。 |
| every-N / stack trigger | 海妖、薇恩类、卡莎类、黑切、鬼索 | 单机制可跑，组合机制需要锁定每个 passive 独立 hitCounts 和 stackKey。 | every-2 + every-3 + phantom 第 6 击；触发后 reset；phantom 是否推进计数；stackKey 撞名。 | Go runtime P0 测试。 |
| energized | 电刀、火炮、岚切、电震涡流剑 | 已有攻击充能和 consume-on-trigger 合同；不支持移动充能、距离收益、多目标 chain。 | 初始 charge 0/99/100/125；多个 energized 是否共享 chargeKey；先 check 后 gain 还是先 gain 后 check；cap 超限 blocked/clamp。 | Go runtime + 页面 evidence。 |
| spellblade / next attack | 三相、巫妖、夺萃、黄昏与黎明、黯影阔剑 | 可用 scenario 预置下一击，但没有完整“施法后自动产生”。 | 没有 skill action 时不得触发；skill miss 是否触发；多 spellblade 同时存在唯一组；phantom 不复制 spellblade。 | Runtime synthetic + rotation 页面需求。 |
| execute / low HP | 收集者、赛瑞尔达严寒 | 当前缺 `execute_threshold`，不能用一次普通 damage 近似。 | damage 前检查还是 damage 后检查；阈值按 current/max 还是 remaining after mitigation；execute 是否计入 TotalDamage；目标 CurrentHP=0 fallback。 | Batch S 级 runtime 扩展。 |
| target-side 防御装备 | 反甲、兰顿、减暴伤、反伤、incoming modifier | target ownerRole/on_damage_taken 已有入口；`critOnly` 缺 crit context 会 blocked。 | target skill 缺 `ownerRole=target`；attacker item 误写 target ownerRole；反伤是否进 attackerDamageTimeline；减暴伤只影响暴击贡献。 | Adapter preflight + 页面可见 reason。 |
| sustain / shield / revive | 饮血、盾弓、Maw、死亡之舞、守护天使 | 当前不应计入 DPS 输出闭环。 | 护盾是否延长输出窗口；吸血是否抵消反伤；复活是否重启 timeline；死亡之舞延迟伤害是否影响 target DPS。 | 明确 out-of-scope 或另开 survival batch。 |
| multi-target / chain | 卢安娜、电刀 chain、九头蛇、希维尔式弹射 | 当前单目标 DPS 不支持完整副目标收益。 | 副目标 on-hit 是否推进主目标计数；chain 目标数量输入；副目标击杀收益；AOE 不能重复算到主目标。 | blocked/out-of-scope 测试。 |
| active / cooldown / refund | 纳沃利、朔极、幽梦、水银、守护天使主动/复活类 | 当前不做主动 rotation、技能 CD 贪心释放和非伤害主动。 | 使用主动时间点；冷却缩减影响 action timeline；主动只改移速/解控不应进入 DPS。 | rotation 或 encounter simulator。 |

装备池优先级比英雄池更靠前的项是 `skillRefs` 和 unique/重复问题：它们不需要复杂 runtime 机制，也可能让页面输出“看似成功但数值错误”的曲线。

## 11. 可执行找茬 Backlog

### 11.1 P0：先防假阳性

1. `skillRefs=[]`：构造 item 下有两个 item-owned skills，其中一个是废弃 passive。当前 adapter 会全匹配，预期应改为 visible warning / blocked / 迁移后显式引用，不能静默多算。
2. `skillRefs` ownerId mismatch：item A 引用 skill X，但 skill X 的 `ownerId=item B`。预期 published checker 和页面 preflight 明确失败，不能表现为 stats-only。
3. 6 暴击装：`crit_chance=1.5`。预期 runtime blocked reason 可读，页面说明是 clamp/blocked/转化中的哪一种产品语义。
4. `critOnly` 兰顿类 modifier：在 expected crit 下必须 blocked 或提供 crit contribution context，不能直接把整段 incoming damage 乘系数。
5. `CurrentHP=0`：确认当前 fallback 到 MaxHP 的行为，并决定页面显示 fallback 还是直接 blocked。
6. 重复 itemIds：明确 stats 是否重复累加；如果产品禁止重复装备，Web selection/preflight 必须拦截。
7. duplicate passiveId / triggerId：同一 payload 内重复 key 应 blocked 或稳定隔离，不能出现后写覆盖和随机计数。
8. every-2 + every-3 + phantom：第 6 击多机制同时触发时顺序、hitCounts、phantom 复制范围必须稳定。
9. next-basic-attack state：无施法事件时不得自动触发 spellblade；预置 state 只能 consume 一次。
10. manual baseline pending：Batch G 标记 `needs_manual_baseline` 的条目，缺训练营/tooltip 真值时不得进入 supported 统计。

### 11.2 P1：锁住组合边界

1. energized 0/99/100/125 初始 charge，验证先 check/consume 再 gain 的顺序和 evidence。
2. 多 energized 共享 / 不共享 chargeKey，验证 chargeCap、threshold、consumeChargeOnTrigger 合同。
3. armor shred + percent pen + flat pen + 负护甲，验证顺序、clamp 和 LoL 式负抗性公式。
4. attack_speed 2.99/3.00/3.01/10，验证 raw/effective/overflow/interval evidence。
5. target-side 反伤 + attacker-side lifesteal，确认反伤只做 evidence，lifesteal 不闭环 attacker 生存。
6. distance-based 机制全部 blocked/out-of-scope，除非输入显式提供 distance。
7. multi-target 机制全部 blocked/out-of-scope，主目标单段近似必须带 UI 标记。
8. spellblade 多来源唯一组，确认三相/巫妖/夺萃不能全部叠加，除非产品明确允许。
9. stackKey 撞名：两个 passive 使用同一 stackKey 时是共享、隔离还是 blocked。
10. NaN/Inf/极大 finite 数值：authoring、adapter、runtime 三层都要有统一边界。

### 11.3 P2：拆成独立方向

1. 结构化 `dpsPassiveEffects` authoring，不再只靠 JSON。
2. item 页面展示被引用 skill 的 DPS passive 摘要和跳转。
3. full rotation authoring：手工固定 timeline 优先，自动最优释放后置。
4. sustain / survival：attacker HP、shield、lifesteal、反伤死亡停手规则另开闭环。
5. multi-target / encounter simulator：副目标、弹射、AOE、击杀收益另建模型。
6. seeded crit：如果要支持烬/艾希/赏金这类机制，必须输出 seed、roll、逐击 crit evidence。
7. published-contract checker：每次装备/技能录入后自动校验 ownerType/ownerId/skillRefs/ownerRole/unsupported mechanism。

### 11.4 等价类与边界值设计

这里把“随机组合”收敛成可执行测试设计，不用穷举所有英雄和装备。每个维度至少取低值、正常值、上界、越界、非法值、冲突组合。

| 输入维度 | 有效等价类 | 边界值 / 非法值 | 预期 oracle |
| --- | --- | --- | --- |
| 暴击率 | 0、0.25、0.5、1.0 | -0.01、1.01、1.5、NaN、Inf | `crit_chance>1` 当前应 blocked；未来若 clamp/转化，页面和 evidence 必须明示。 |
| 暴击伤害 | 1.0、1.75、2.0、额外 critDamage 装备 | 0、负数、极大值、字符串数值 | expected crit 必须可解释基础伤害和暴击贡献；`critOnly` 没 context 不得静默近似。 |
| 攻速 | 0.625、1.0、2.5、3.0 | 0、负数、3.01、10、NaN、Inf | raw/effective/overflow/interval 四个字段一致；interval 不得低于 cap 对应值。 |
| 目标 HP | 满血、半血、1 HP | 0、负数、CurrentHP > MaxHP、MaxHP=0 | 当前 0 fallback 必须显示；低血线测试必须用正数 HP；execute 接入前不能假装支持。 |
| 护甲/MR | 0、100、300、1000 | 负护甲、百分比穿透 >100%、flat pen 极大 | 负抗性走公式；穿透/shred 顺序可复现；不得因为 clamp 掩盖削甲收益。 |
| 装备数量 | 0、1、3、6 件不同装备 | 7 件、6 件同 ID、空字符串 ID、不存在 ID | 产品规则决定 blocked/去重/重复叠加；adapter 必须给出可见 reason。 |
| `skillRefs` | 显式引用 1 个、引用多个 | 缺失、空数组、重复引用、不存在 skill、ownerId mismatch | 不允许“成功但多算/少算”无提示；published checker 必须比运行页更早发现。 |
| `ownerRole` | attacker、target | 缺失、拼写错误、attacker 装备写 target、target 装备写 attacker | target-side 装备 preflight 必须解释；attacker 不执行 target-owned passive。 |
| energized charge | 0、99、100、cap | cap+1、threshold=0、gain=0、多装备同 chargeKey | check/consume/gain 顺序必须由 evidence 证明；共享 chargeKey 要有产品语义。 |
| stack / every-N | every-2、every-3、stack 3 层触发 | N=0、负数、同名 stackKey、duplicate passiveId | 每个 passive 计数隔离或显式共享；第 N 击多触发顺序稳定。 |
| 时间与事件数 | 1s、10s、60s、MaxEvents 正常 | MaxEvents=0/1、duration=0、极长 duration | event_limit 不污染其他 curve；首攻 0ms 和后续 cadence 可解释。 |
| JSON 数字 | finite number | NaN、Inf、极大 finite、字符串、null、空对象 | authoring、adapter、runtime 三层至少一层阻断，且错误指向字段路径。 |

这张表的重点是“可观测 oracle”。如果测试只断言 `status=ok` 或总 DPS 大于 0，就不能发现多算 skillRefs、唯一被动重复、critOnly 静默近似、HP fallback 这类高风险错误。

### 11.5 状态机与顺序测试

ADC 机制最容易出错的不是单个公式，而是一击内多个状态的先后顺序。建议把一次 basic attack 拆成以下固定检查点，并在 evidence 中能看到至少关键节点：

1. 读取攻击者/目标快照：属性、当前 HP、已有 scenario state、已有 stacks、energized charge。
2. 计算本次普攻 cadence：raw AS、effective AS、overflow AS、nextAttackAtMs。
3. 结算本体伤害：命中、expected crit、抗性、穿透、incoming modifier。
4. 触发 attacker on-basic-hit / on-hit damage：海妖、破败、纳什、智慧末刃等。
5. 触发 attacker on-damage-dealt：伤害后追加、叠层后触发、lifesteal 若未来接入。
6. 触发 target on-damage-taken：反甲、兰顿、target-side incoming modifier。
7. 处理 energized：ready check、consume、damage、gain 的真实顺序。
8. 处理 phantom hit：只能复制标记为 copyable 的 on-hit，且不得递归复制 phantom。
9. 更新 stacks / states / cooldown：consume next-attack、刷新/掉层、internal cooldown。
10. 输出 timeline / breakdown：每个 sourceCategory、passiveId、operationId 可追踪。

每个高风险组合至少选一个“顺序断言”：

1. `破败 + 海妖 + 鬼索`：目标当前 HP 比例应使用 attack_start 还是 current，phantom 是否复制破败，是否推进海妖计数。
2. `黑切 + 穿甲装 + 负护甲目标`：先削甲还是先穿透，第二击开始是否使用新护甲。
3. `兰顿 + 无尽 + 150% 暴击率`：如果暴击 blocked，兰顿不能再产生误导性减伤曲线。
4. `反甲 + 吸血 + 低血 attacker`：当前只能记录反伤 evidence，不能让吸血抵消反伤并继续输出。
5. `三相 + 卢锡安双枪 + 鬼索`：next-attack、第二段普攻、phantom 三者不能互相递归。

### 11.6 组合爆炸裁剪策略

不要随机生成所有 6 装备排列。更有效的策略是先按机制标签覆盖 pairwise，再人为加入三类“坏组合”：

1. 同类叠满：6 暴击、6 攻速、6 穿甲、6 on-hit、6 生存装，用来测 cap、clamp、重复、范围外解释。
2. 异类同击：on-hit + every-N + energized + phantom + target-side modifier，用来测一击内顺序。
3. 数据断链：合法 itemId + 错 skillRefs / ownerRole / ownerId，用来测发布数据契约。
4. 范围外诱导：卢安娜 + 电刀 + 九头蛇 + 多目标英雄，用来确认系统不会把副目标收益塞进单目标。
5. 手工 baseline 缺失：厄斐琉斯、格雷福斯、飞机、纳沃利、魔宗，用来确认 pending/manual 状态不会被算作 supported。

最小集合建议：

1. `6 暴击装 + 兰顿目标`：暴击 cap、crit context、target-side modifier。
2. `6 攻速装 + 鬼索满层`：AS cap、overflow、phantom cadence。
3. `破败 + 海妖 + 鬼索 + 纳什 + 智慧末刃 + 界弓`：多 on-hit、ratio、every-N、phantom。
4. `黑切 + 多米尼克 + 凡性 + 负护甲目标`：shred、penetration、负抗性。
5. `电刀 + 火炮 + 岚切 + 电震涡流剑`：energized 共享/隔离 charge。
6. `三相 + 巫妖 + 夺萃 + 卢锡安 passive`：spellblade unique 与 next-attack state。
7. `反甲 + 兰顿 + Thornmail-like target passive + attacker lifesteal`：target-side 与 survival 边界。
8. `卢安娜 + 电刀 + 九头蛇 + 希维尔 W`：multi-target out-of-scope。
9. `item skillRefs=[] + 废弃 passive`：静默多算。
10. `skillRefs 指向 ownerId 错误 skill`：静默少算。

这 10 组比纯随机更有价值，因为每组都有明确 oracle，失败后能直接定位到 runtime、adapter、authoring、published checker 或产品范围。

### 11.7 验收口径

每条测试必须先判定它属于哪种结果，避免“不能模拟”被误当 bug，也避免“能跑出数值”被误当支持：

1. `supported-current`：当前 runtime、adapter、页面、发布数据都能支持，并且有 evidence。
2. `supported-synthetic-only`：runtime 能证明机制，但真实 bundle 未录入或页面未闭环。
3. `blocked-by-contract`：输入非法或机制缺上下文，应清晰 blocked。
4. `pending-manual-baseline`：需要训练营/tooltip 真值，不能进入 supported 统计。
5. `out-of-scope-single-target`：多目标、距离、弹道、生存闭环等不属于当前 `single_attacker_dps`。
6. `needs-runtime-extension`：需要新增 operation / trigger / state machine。
7. `needs-authoring-extension`：runtime 能承载，但录入和校验不安全。
8. `needs-product-decision`：重复装备、唯一被动、crit overflow 转化等必须先定产品语义。

页面和文档都应优先展示这个分类，而不是只展示 `ok/blocked`。随机组合头脑风暴的最终价值，是把“缺功能”拆成“不能做、暂不做、数据缺、UI 缺、规则未定、代码缺”。

## 12. 测试分层建议

### 12.1 Go runtime 单测

优先补这些测试：

1. `crit_chance=1.01` 和 `1.5`：明确 blocked reason。
2. `attack_speed=10`：effective=3、overflow=7、event interval 不低于 333ms。
3. 负护甲、极高护甲、穿透超过 100%。
4. 多 every-N passive 同时触发。
5. phantom hit 不计入不该计入的 every-N / energized。
6. energized 初始 charge 99 / 100 / 125。
7. target stat_modifier 与 attacker penetration 顺序。
8. duplicate passiveId / triggerId 的行为。
9. damage_modifier 多个来源叠加顺序。
10. MaxEvents 触发 event_limit 且不污染其他 curve。

### 12.2 Web adapter 单测

优先补这些测试：

1. 6 件暴击装累加到 `crit_chance=1.5` 时，adapter 是否保留、clamp 还是 preflight blocked。
2. 重复 itemIds 是否去重。
3. item `skillRefs` 指向不存在 skill。
4. item `skillRefs` 指向 ownerType 非 item。
5. target item skill 缺 `ownerRole=target`。
6. attacker item skill 写成 `ownerRole=target`。
7. `dpsPassiveEffect` 单数兼容路径是否仍保留。
8. `dpsPassiveEffects` 中 unknown operation 是否前端阻断。
9. 装备 stats 中 NaN/Infinity/字符串数值是否被过滤或阻断。
10. targetEquipmentStats 空对象是否与缺失对象有不同语义。
11. `skillRefs=[]` 不应全匹配，或至少必须有显式测试锁住当前全匹配语义。
12. `skillRefs` 指向 skill 存在但 ownerId 不匹配时必须可见失败。
13. 重复装备 itemIds 是否导致 stats 重复累加。
14. 重复 `skillRefs` 是否被去重或报错。

### 12.3 Admin authoring 测试

优先补这些测试：

1. DPS passive JSON 缺 version / triggers / operations。
2. operation kind 拼错。
3. ownerRole 缺失但 item 是 target 装备。
4. targetRole 非 attacker/target。
5. damageType 非 physical/magic/true。
6. numeric field 输入字符串、空字符串、负数、极大数。
7. `critOnly=true` 时显示“当前 DPS 缺 crit context”的强 warning。
8. item skillRefs 选择后展示被引用 skill 的 passive 摘要。
9. 保存后 stringify 不丢未知字段。
10. published-contract checker 能区分 runtime-supported 和 page-supported。

### 12.4 页面验收测试

优先补这些用户流：

1. 选择 6 件暴击装，页面给出可理解 blocked / warning。
2. 选择 6 件攻速装，图表展示 effective AS cap 和 overflow。
3. 选择黑切 + 高护甲目标，第二下开始伤害变化能解释。
4. 选择目标反甲，`AttackerDamageTimeline` 有 evidence，但 target DPS 不混入反伤。
5. 选择 target ownerRole 错误装备，页面显示具体 item reason。
6. 选择缺 skillRefs 的装备，页面显示 stats-only。
7. 选择 energized 初始满充，t=0 触发 evidence 清晰。
8. 选择鬼索 + 海妖 + 薇恩三环，多个 passive trigger 顺序稳定。

## 13. 找茬结论优先级

按“用户最容易遇到 + 最容易误导结果 + 当前系统最缺解释”的标准排序：

1. `skillRefs` 空引用全匹配：这是静默多算风险，优先级高于普通 blocked。
2. `skillRefs` ownerType/ownerId 指错：这是静默少算风险，必须进入 published-contract checker。
3. 暴击率超过 100%：当前 runtime blocked，但 Web/页面需要明确上限策略。
4. `critOnly` damage_modifier：兰顿类机制必须等 crit context，不能用 expected crit 静默近似。
5. `CurrentHP=0` fallback：用户直觉与系统语义相反，必须提示或改成 blocked。
6. 重复装备 / 唯一被动：当前契约不够明确，容易让 6 件同装测试得出错误结论。
7. NaN / Inf / 极大 finite 数值：需要统一输入防线，而不是依赖局部运行时 block。
8. 多 every-N + phantom hit：容易出现 hit count / procScope 误算。
9. energized 多来源共享 charge：需要统一 chargeKey 语义。
10. target armor shred + penetration 顺序：影响大量穿甲装备和黑切。
11. sustain / survival：当前不是 DPS 闭环，必须明确范围外或另拆。
12. 技能 rotation：runtime 有入口，页面 authoring 还不够。
13. 多目标/距离/弹道：应另立模拟方向，不应污染单标靶曲线。

## 14. 建议后续拆批

### 14.1 Batch S：Crit context 与斩杀阈值

目标：

1. 给 DPS damage context 增加 crit context。
2. 让 `damage_modifier.critOnly=true` 能解释 expected crit 或 seeded crit。
3. 增加 `execute_threshold` operation。

验收样例：

1. 兰顿 synthetic：只降低暴击部分或明确 blocked。
2. 收集者 synthetic：伤害后目标低于阈值，输出 execute evidence。

### 14.2 Batch T：Passive cooldown 与 rotation 最小输入

目标：

1. 增加 passive internal cooldown。
2. 增加最小 active skill timeline 输入。
3. 支持“技能后下一次普攻”“技能命中触发装备”“技能缩短冷却”的第一层验证。

验收样例：

1. 卢锡安式技能-普攻间隔。
2. 耀光类下一次普攻。
3. 卢登类 on_spell_hit 真实 action 触发。

### 14.3 Batch U：Sustain 与 attacker survival evidence

目标：

1. 增加 heal / shield / lifesteal / omnivamp operation。
2. 定义 attacker HP timeline 与反伤、吸血、护盾顺序。
3. 明确 sustain 是否计入 DPS 页面主结论，避免把生存收益误解释为输出。

### 14.4 Batch V：Authoring 模板与装备引用可视化

目标：

1. Admin skill 中提供 `dpsPassiveEffects` 字段级结构化编辑。
2. Admin item 中展示 `skillRefs` 指向 skill 的 DPS passive 摘要和跳转。
3. 增加机制模板：on-hit、every-N、stack trigger、energized、phantom hit、target retaliation、incoming modifier。

### 14.5 另立方向：Multi-target / encounter simulator

目标：

1. 如果要覆盖飓风、电刀、九头蛇、AOE、弹道和多目标，另起 multi-target DPS 或 encounter simulator。
2. 不把多目标收益折算进当前 single target DPS，除非明确作为近似并在 UI 标注。

## 15. 当前结论

当前 V2 DPS 已能覆盖很多 ADC 核心输出机制：on-hit、every-N、叠层、目标生命值比例、DoT、energized、phantom hit、目标侧反伤和基础 incoming modifier。下一阶段的主要问题不是“再补几个装备 ID”，而是补齐上下文和 authoring：

找茬视角下，最危险的不是“不支持”的机制，而是“看起来支持但边界没有解释”的机制：

1. 6 件暴击装导致 `crit_chance > 1` 时，当前 runtime 会 blocked；必须决定 clamp、blocked 还是溢出转化，不能让页面只给模糊失败。
2. 攻速超过 3.0 已有 cap 和 overflow evidence，这类清晰边界应作为其他属性的设计模板。
3. `critOnly` damage modifier、重复装备、唯一被动、skillRefs 断链、ownerRole 错误，是最容易导致错误结论的测试攻击面。
4. Runtime 上最优先的是 crit context、execute threshold、passive internal cooldown、rotation 最小输入。
5. Web 上最优先的是 `dpsPassiveEffects` 结构化 authoring、item `skillRefs` 摘要/跳转、以及装备组合 preflight。
6. 产品边界上必须继续守住 single target DPS，不要把多目标、位移、弹道和完整战斗模拟混入当前曲线。

## 16. 待确认问题

1. 后续是否接受 seeded crit 作为 DPS 可选模式，还是继续只做 expected crit？
2. 收集者类 execute 是否应计入 `TotalDamage`，还是单独输出 execute evidence？
3. sustain 是否进入当前 DPS 页面，还是另做 survival / effective HP 页面？
4. 技能 rotation 是只允许用户手工输入固定 timeline，还是要自动按 cooldown 贪心释放？
5. 多目标装备是否明确另起模拟器，避免污染 single target DPS 口径？
6. `crit_chance > 1` 的产品语义是 blocked、clamp 到 1，还是按具体游戏规则转化为其他收益？
7. 重复装备在目标游戏模式里是否允许；如果不允许，是 UI 去重还是 runtime blocked？
8. unique passive group 应在 item、skill 还是 dpsPassiveEffect 上建模？
9. target-side 反伤是否需要影响 attacker 存活，还是只作为非 DPS evidence？
10. published-contract checker 是否要成为每次装备录入后的强制门禁？
