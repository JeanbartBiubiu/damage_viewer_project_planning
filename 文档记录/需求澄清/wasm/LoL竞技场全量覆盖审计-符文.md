TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-10 00:00:00

# LoL竞技场全量覆盖审计-符文

日期：2026-04-10
状态：进行中
范围：符文按单实体 entry 审计
基线：当前原始快照重建后共 `61` 条 rune entries

## 共享审计字段

- `runtimeLayer`：`formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter`
- `templateOrModel`：命中的模板或状态模型
- `coverageVerdict`：`covered / partial / gap / filtered`
- `gapOrConversionNote`：缺口、转换条件或过滤原因

## 符文专属字段

- `runeTree`
- `slotIndex`
- `runeTier`

## 审计表

| entryId | entryNameZh | runeTree | slotIndex | primaryGroup | scopeAssessment | runtimeLayer | templateOrModel | coverageVerdict | gapOrConversionNote | sourceRef |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rune:8112 | 电刑 | 主宰 | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[0].rune[0] |
| rune:8128 | 黑暗收割 | 主宰 | 0 | 叠层与时效 | needs_conversion | counter | counter_state + stack_threshold_proc + refund_cooldown | partial | 低血量阈值、魂层与参与击杀后的刷新混在一起。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[0].rune[1] |
| rune:9923 | 丛刃 | 主宰 | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[0].rune[2] |
| rune:8126 | 恶意中伤 | 主宰 | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[1].rune[0] |
| rune:8139 | 血之滋味 | 主宰 | 1 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[1].rune[1] |
| rune:8143 | 猛然冲击 | 主宰 | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[1].rune[2] |
| rune:8137 | 第六感 | 主宰 | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[2].rune[0] |
| rune:8140 | 可怖纪念品 | 主宰 | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[2].rune[1] |
| rune:8141 | 深入守卫 | 主宰 | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[2].rune[2] |
| rune:8135 | 寻宝猎人 | 主宰 | 3 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[3].rune[0] |
| rune:8105 | 无情猎手 | 主宰 | 3 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[3].rune[1] |
| rune:8106 | 终极猎人 | 主宰 | 3 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[0].slot[3].rune[2] |
| rune:8351 | 冰川增幅 | 启迪 | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 冰川增幅含区域、多目标与友军伤害减免。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[0].rune[0] |
| rune:8360 | 启封的秘籍 | 启迪 | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[0].rune[1] |
| rune:8369 | 先攻 | 启迪 | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 先攻含金币收益，当前主链路外。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[0].rune[2] |
| rune:8306 | 海克斯科技闪现罗网 | 启迪 | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_mobility_spell_replace | filtered | 闪现冷却期间替换为引导位移，属于召唤师技能替换与位移语义。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[1].rune[0] |
| rune:8304 | 神奇之鞋 | 启迪 | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[1].rune[1] |
| rune:8321 | 返现 | 启迪 | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[1].rune[2] |
| rune:8313 | 三重补药 | 启迪 | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_consumable_meta | filtered | 按等级发放合剂，属于消耗品与成长奖励语义。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[2].rune[0] |
| rune:8352 | 时间扭曲补药 | 启迪 | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_consumable_meta | filtered | 只改写药水回复时序，属于消耗品语义。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[2].rune[1] |
| rune:8345 | 饼干配送 | 启迪 | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[2].rune[2] |
| rune:8347 | 星界洞悉 | 启迪 | 3 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[3].rune[0] |
| rune:8410 | 行近速率 | 启迪 | 3 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[3].rune[1] |
| rune:8316 | 多面手 | 启迪 | 3 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[1].slot[3].rune[2] |
| rune:8005 | 强攻 | 精密 | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[0].rune[0] |
| rune:8008 | 致命节奏 | 精密 | 0 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[0].rune[1] |
| rune:8021 | 迅捷步法 | 精密 | 0 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[0].rune[2] |
| rune:8010 | 征服者 | 精密 | 0 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[0].rune[3] |
| rune:9101 | 吸收生命力 | 精密 | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[1].rune[0] |
| rune:9111 | 凯旋 | 精密 | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[1].rune[1] |
| rune:8009 | 气定神闲 | 精密 | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[1].rune[2] |
| rune:9104 | 传说：欢欣 | 精密 | 2 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[2].rune[0] |
| rune:9105 | 传说：急速 | 精密 | 2 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[2].rune[1] |
| rune:9103 | 传说：血统 | 精密 | 2 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[2].rune[2] |
| rune:8014 | 致命一击 | 精密 | 3 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[3].rune[0] |
| rune:8017 | 砍倒 | 精密 | 3 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[3].rune[1] |
| rune:8299 | 坚毅不倒 | 精密 | 3 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[2].slot[3].rune[2] |
| rune:8437 | 不灭之握 | 坚决 | 0 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[0].rune[0] |
| rune:8439 | 余震 | 坚决 | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[0].rune[1] |
| rune:8465 | 守护者 | 坚决 | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[0].rune[2] |
| rune:8446 | 爆破 | 坚决 | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[1].rune[0] |
| rune:8463 | 生命源泉 | 坚决 | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[1].rune[1] |
| rune:8401 | 护盾猛击 | 坚决 | 1 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需订阅护盾获得事件。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[1].rune[2] |
| rune:8429 | 调节 | 坚决 | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[2].rune[0] |
| rune:8444 | 复苏之风 | 坚决 | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[2].rune[1] |
| rune:8473 | 骸骨镀层 | 坚决 | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[2].rune[2] |
| rune:8451 | 过度生长 | 坚决 | 3 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[3].rune[0] |
| rune:8453 | 复苏 | 坚决 | 3 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[3].rune[1] |
| rune:8242 | 坚定 | 坚决 | 3 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[3].slot[3].rune[2] |
| rune:8214 | 召唤：艾黎 | 巫术 | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 艾黎同时涉及友军护盾与返回锁定，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[0].rune[0] |
| rune:8229 | 奥术彗星 | 巫术 | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[0].rune[1] |
| rune:8230 | 相位猛冲 | 巫术 | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[0].rune[2] |
| rune:8224 | 公理秘术 | 巫术 | 1 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[1].rune[0] |
| rune:8226 | 法力流系带 | 巫术 | 1 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[1].rune[1] |
| rune:8275 | 灵光披风 | 巫术 | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[1].rune[2] |
| rune:8210 | 超然 | 巫术 | 2 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[2].rune[0] |
| rune:8234 | 迅捷 | 巫术 | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[2].rune[1] |
| rune:8233 | 绝对专注 | 巫术 | 2 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[2].rune[2] |
| rune:8237 | 焦灼 | 巫术 | 3 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[3].rune[0] |
| rune:8232 | 水上行走 | 巫术 | 3 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[3].rune[1] |
| rune:8236 | 风暴聚集 | 巫术 | 3 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/runesReforged.json#tree[4].slot[3].rune[2] |

## 当前备注

- 符文天然带路径和槽位层级，检索时不能只靠名字。
- 如果符文主要表达基础属性，优先落到属性层，不额外发明新模板。
