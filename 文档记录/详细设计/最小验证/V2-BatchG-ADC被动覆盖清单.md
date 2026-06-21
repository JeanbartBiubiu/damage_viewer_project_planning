TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-20

# V2 Batch G ADC 被动覆盖清单

生成脚本：`最小验证/数据/build-v2-batch-g-adc-passive-audit.mjs`

机器清单：`最小验证/V2-Batch-G-adc-passive-audit.json`

## 汇总

- Marksman 英雄候选池：33
- ADC 成装候选池：53
- 候选被动/技能条目：242
- 分类计数：ready_to_encode=1；already_covered=13；needs_runtime_extension=37；needs_manual_baseline=45；out_of_scope_for_single_target_dps=146

## 机制 backlog 汇总

- `distance_based_damage_modifier`：11 项。样例：未来守护者/墨丘利之炮 / 墨丘利之锤；复仇之矛/武术姿态；正义天使/登神长阶；永猎双子/千珏之印；德玛西亚之翼/旋翔掠杀；沙漠玫瑰/悍勇本色；沙漠玫瑰/交火；瘟疫之源/火力全开；暗夜猎手/闪避突袭；海克斯镜片 C44/高倍望远镜；海克斯镜片 C44/奥术瞄准
- `energized_charge_and_consume`：6 项。样例：斯塔缇克电刃/电疗；疾射火炮/神射手；岚切/盈能；岚切/弩箭；电震涡流剑/通电；电震涡流剑/苍穹
- `spellblade_next_attack_state`：6 项。样例：荣耀行刑官/旋转飞斧；黄昏与黎明/咒刃；三相之力/咒刃；巫妖之祸/咒刃；黯影阔剑/夜行者；夺萃之镰/咒刃
- `seeded_random_crit_sequence`：5 项。样例：寒冰射手/冰霜射击；戏命师/低语；赏金猎人/弹幕时间；不破之誓/初生之誓；猎魔人弩箭/开战弹幕
- `stacking_stat_modifier_on_hit`：5 项。样例：寒冰射手/射手的专注；探险家/咒能高涨；法外狂徒/快速拔枪；黑色切割者/切割；鬼索的狂暴之刃/沸腾打击
- `damage_multiplier_or_health_ratio`：2 项。样例：永猎双子/横生惧意；多米尼克领主的致意/巨人杀手
- `execute_threshold`：2 项。样例：收集者/死；赛瑞尔达的怨恨/严寒
- `phantom_hit_on_hit_repeat`：1 项。样例：鬼索的狂暴之刃/沸腾打击

## 覆盖表

| sourceKind | ownerId | ownerName | skillKey | passiveName | classification | mechanismTags | levelDataStatus | rankTableStatus | blockedReason | needsUserData |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hero_skill | hero_akshan | 影哨 | P | 无所不用 | out_of_scope_for_single_target_dps | survivability_only | missing | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| hero_skill | hero_akshan | 影哨 | Q | 去而复还 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | missing | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| hero_skill | hero_akshan | 影哨 | W | 赴险夺人 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_akshan | 影哨 | E | 骄行荡寇 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_akshan | 影哨 | R | 恩怨相抵 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_aphelios | 残月之肃 | P | 传知者与真知者 | needs_manual_baseline | dps_relevant_manual_review | missing | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_aphelios | 残月之肃 | Q | 武器技能 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_aphelios | 残月之肃 | W | 月相轮转 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_aphelios | 残月之肃 | E | 武器队列系统 | out_of_scope_for_single_target_dps | no_single_target_dps_effect | missing | not_applicable | 未发现会改变当前单攻击方单标靶 DPS 的效果。 |  |
| hero_skill | hero_aphelios | 残月之肃 | R | 清辉夜凝 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_ashe | 寒冰射手 | P | 冰霜射击 | needs_runtime_extension | seeded_random_crit_sequence | missing | not_applicable | 涉及 on-crit 分支或暴击状态变化，当前 critPolicy=expected 不能证明真实触发序列。 |  |
| hero_skill | hero_ashe | 寒冰射手 | Q | 射手的专注 | needs_runtime_extension | stacking_stat_modifier_on_hit | missing | complete | 需要 timed stack stat modifier 聚合和掉层语义。 |  |
| hero_skill | hero_ashe | 寒冰射手 | W | 万箭齐发 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_ashe | 寒冰射手 | E | 鹰击长空 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_ashe | 寒冰射手 | R | 魔法水晶箭 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_azir | 沙漠皇帝 | P | 恕瑞玛的传承 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_azir | 沙漠皇帝 | Q | 狂沙猛攻 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_azir | 沙漠皇帝 | W | 沙兵现身 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_azir | 沙漠皇帝 | E | 流沙移形 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_azir | 沙漠皇帝 | R | 禁军之墙 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_caitlyn | 皮城女警 | P | 爆头 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_caitlyn | 皮城女警 | Q | 和平使者 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_caitlyn | 皮城女警 | W | 约德尔诱捕器 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_caitlyn | 皮城女警 | E | 90口径绳网 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_caitlyn | 皮城女警 | R | 让子弹飞 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_corki | 英勇投弹手 | P | 海克斯科技军备 | needs_manual_baseline | dps_relevant_manual_review | missing | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_corki | 英勇投弹手 | Q | 磷光炸弹 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_corki | 英勇投弹手 | W | 瓦尔基里俯冲 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_corki | 英勇投弹手 | E | 格林机枪 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_corki | 英勇投弹手 | R | 火箭轰击 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_draven | 荣耀行刑官 | P | 德莱文联盟 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_draven | 荣耀行刑官 | Q | 旋转飞斧 | needs_runtime_extension | spellblade_next_attack_state | missing | complete | 需要“施法后下一次普攻”状态；当前不做主动技能轮转。 |  |
| hero_skill | hero_draven | 荣耀行刑官 | W | 血性冲刺 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_draven | 荣耀行刑官 | E | 开道利斧 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_draven | 荣耀行刑官 | R | 冷血追命 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_ezreal | 探险家 | P | 咒能高涨 | needs_runtime_extension | stacking_stat_modifier_on_hit | missing | not_applicable | 需要 timed stack stat modifier 聚合和掉层语义。 |  |
| hero_skill | hero_ezreal | 探险家 | Q | 秘术射击 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | missing | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| hero_skill | hero_ezreal | 探险家 | W | 精华跃动 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_ezreal | 探险家 | E | 奥术跃迁 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_ezreal | 探险家 | R | 精准弹幕 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_graves | 法外狂徒 | P | 新命运 | needs_manual_baseline | dps_relevant_manual_review | missing | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_graves | 法外狂徒 | Q | 穷途末路 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_graves | 法外狂徒 | W | 烟幕弹 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_graves | 法外狂徒 | E | 快速拔枪 | needs_runtime_extension | stacking_stat_modifier_on_hit | missing | complete | 需要 timed stack stat modifier 聚合和掉层语义。 |  |
| hero_skill | hero_graves | 法外狂徒 | R | 终极爆弹 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_jayce | 未来守护者 | P | 海克斯科技电容 | out_of_scope_for_single_target_dps | no_single_target_dps_effect | missing | not_applicable | 未发现会改变当前单攻击方单标靶 DPS 的效果。 |  |
| hero_skill | hero_jayce | 未来守护者 | Q | 苍穹之跃 / 电能震荡 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_jayce | 未来守护者 | W | 闪电领域 / 超能电荷 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_jayce | 未来守护者 | E | 雷霆一击 / 加速之门 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_jayce | 未来守护者 | R | 墨丘利之炮 / 墨丘利之锤 | needs_runtime_extension | distance_based_damage_modifier | missing | complete | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_jhin | 戏命师 | P | 低语 | needs_runtime_extension | seeded_random_crit_sequence | missing | not_applicable | 涉及 on-crit 分支或暴击状态变化，当前 critPolicy=expected 不能证明真实触发序列。 |  |
| hero_skill | hero_jhin | 戏命师 | Q | 曼舞手雷 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_jhin | 戏命师 | W | 致命华彩 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_jhin | 戏命师 | E | 万众倾倒 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_jhin | 戏命师 | R | 完美谢幕 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_jinx | 暴走萝莉 | P | 罪恶快感 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_jinx | 暴走萝莉 | Q | 枪炮交响曲！ | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_jinx | 暴走萝莉 | W | 震荡电磁波！ | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_jinx | 暴走萝莉 | E | 嚼火者手雷！ | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_jinx | 暴走萝莉 | R | 超究极死神飞弹！ | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_kaisa | 虚空之女 | P | 体表活肤 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_kaisa | 虚空之女 | Q | 艾卡西亚暴雨 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | complete | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_kaisa | 虚空之女 | W | 虚空索敌 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | complete | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_kaisa | 虚空之女 | E | 极限超载 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | complete | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_kaisa | 虚空之女 | R | 猎手本能 | out_of_scope_for_single_target_dps | multi_target_or_area | complete | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kalista | 复仇之矛 | P | 武术姿态 | needs_runtime_extension | distance_based_damage_modifier | missing | not_applicable | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_kalista | 复仇之矛 | Q | 穿刺 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_kalista | 复仇之矛 | W | 哨兵 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_kalista | 复仇之矛 | E | 撕裂 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kalista | 复仇之矛 | R | 命运的召唤 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_kayle | 正义天使 | P | 登神长阶 | needs_runtime_extension | distance_based_damage_modifier | missing | not_applicable | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_kayle | 正义天使 | Q | 耀焰冲击 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kayle | 正义天使 | W | 星界恩典 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | missing | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| hero_skill | hero_kayle | 正义天使 | E | 星火符刃 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kayle | 正义天使 | R | 圣裁之刻 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kindred | 永猎双子 | P | 千珏之印 | needs_runtime_extension | distance_based_damage_modifier | missing | not_applicable | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_kindred | 永猎双子 | Q | 乱箭之舞 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kindred | 永猎双子 | W | 狼灵狂热 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kindred | 永猎双子 | E | 横生惧意 | needs_runtime_extension | damage_multiplier_or_health_ratio | missing | complete | 当前 DPSPassiveEffect 不能表达全局伤害增幅或缺目标额外生命值字段。 |  |
| hero_skill | hero_kindred | 永猎双子 | R | 羊灵生息 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kogmaw | 深渊巨口 | P | 来自艾卡西亚的惊喜 | out_of_scope_for_single_target_dps | multi_target_or_area | complete | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kogmaw | 深渊巨口 | Q | 腐蚀唾液 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_kogmaw | 深渊巨口 | W | 生化弹幕 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_kogmaw | 深渊巨口 | E | 虚空淤泥 | out_of_scope_for_single_target_dps | multi_target_or_area | complete | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_kogmaw | 深渊巨口 | R | 活体大炮 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | complete | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_lucian | 圣枪游侠 | P | 圣光银弹 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_lucian | 圣枪游侠 | Q | 透体圣光 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_lucian | 圣枪游侠 | W | 热诚烈弹 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_lucian | 圣枪游侠 | E | 冷酷追击 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | missing | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| hero_skill | hero_lucian | 圣枪游侠 | R | 圣枪洗礼 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_missfortune | 赏金猎人 | P | 厄运的眷顾 | needs_manual_baseline | dps_relevant_manual_review | missing | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_missfortune | 赏金猎人 | Q | 一箭双雕 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_missfortune | 赏金猎人 | W | 大步流星 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | missing | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| hero_skill | hero_missfortune | 赏金猎人 | E | 枪林弹雨 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_missfortune | 赏金猎人 | R | 弹幕时间 | needs_runtime_extension | seeded_random_crit_sequence | missing | complete | 涉及 on-crit 分支或暴击状态变化，当前 critPolicy=expected 不能证明真实触发序列。 |  |
| hero_skill | hero_quinn | 德玛西亚之翼 | P | 侵扰 | needs_manual_baseline | dps_relevant_manual_review | missing | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_quinn | 德玛西亚之翼 | Q | 炫目攻势 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_quinn | 德玛西亚之翼 | W | 敏锐感知 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_quinn | 德玛西亚之翼 | E | 旋翔掠杀 | needs_runtime_extension | distance_based_damage_modifier | missing | complete | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_quinn | 德玛西亚之翼 | R | 深入敌后 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_samira | 沙漠玫瑰 | P | 悍勇本色 | needs_runtime_extension | distance_based_damage_modifier | missing | not_applicable | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_samira | 沙漠玫瑰 | Q | 交火 | needs_runtime_extension | distance_based_damage_modifier | missing | complete | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_samira | 沙漠玫瑰 | W | 锋旋 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_samira | 沙漠玫瑰 | E | 狂飙 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_samira | 沙漠玫瑰 | R | 炼狱扳机 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_senna | 涤魂圣枪 | P | 赦除 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_senna | 涤魂圣枪 | Q | 黑暗洞灭 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_senna | 涤魂圣枪 | W | 无尽厮守 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_senna | 涤魂圣枪 | E | 黑雾咒附 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_senna | 涤魂圣枪 | R | 暗影燎原 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_sivir | 战争女神 | P | 敏锐疾行 | needs_manual_baseline | dps_relevant_manual_review | missing | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_sivir | 战争女神 | Q | 回旋之刃 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_sivir | 战争女神 | W | 弹射 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_sivir | 战争女神 | E | 法术护盾 | out_of_scope_for_single_target_dps | survivability_only | missing | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| hero_skill | hero_sivir | 战争女神 | R | 狩猎 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_smolder | 炽炎雏龙 | P | 龙之研习 | needs_manual_baseline | dps_relevant_manual_review | missing | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_smolder | 炽炎雏龙 | Q | 超级灼热龙息 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_smolder | 炽炎雏龙 | W | 阿嚏！ | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_smolder | 炽炎雏龙 | E | 扑棱，扑棱，扑棱！ | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_smolder | 炽炎雏龙 | R | 妈----！ | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_teemo | 迅捷斥候 | P | 游击队军备 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_teemo | 迅捷斥候 | Q | 致盲吹箭 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | complete | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_teemo | 迅捷斥候 | W | 小莫快跑 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | complete | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_teemo | 迅捷斥候 | E | 毒性射击 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_teemo | 迅捷斥候 | R | 种蘑菇 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | complete | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_tristana | 麦林炮手 | P | 瞄准 | out_of_scope_for_single_target_dps | no_single_target_dps_effect | missing | not_applicable | 未发现会改变当前单攻击方单标靶 DPS 的效果。 |  |
| hero_skill | hero_tristana | 麦林炮手 | Q | 急速射击 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_tristana | 麦林炮手 | W | 火箭跳跃 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_tristana | 麦林炮手 | E | 爆炸火花 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_tristana | 麦林炮手 | R | 毁灭射击 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_twistedfate | 卡牌大师 | P | 灌铅骰子 | out_of_scope_for_single_target_dps | no_single_target_dps_effect | missing | not_applicable | 未发现会改变当前单攻击方单标靶 DPS 的效果。 |  |
| hero_skill | hero_twistedfate | 卡牌大师 | Q | 万能牌 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_twistedfate | 卡牌大师 | W | 选牌 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_twistedfate | 卡牌大师 | E | 卡牌骗术 | needs_manual_baseline | every_n_hit | missing | complete | 候选机制可表达，但该英雄尚无 1-18 级 statsByLevel；Batch G gate 禁止进入 ready seed。 | TwistedFate 1-18 statsByLevel: hp/mana/ad/armor/magic_resist/hp_regen/mana_regen/attack_speed |
| hero_skill | hero_twistedfate | 卡牌大师 | R | 命运 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_twitch | 瘟疫之源 | P | 死亡毒液 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_twitch | 瘟疫之源 | Q | 埋伏 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_twitch | 瘟疫之源 | W | 剧毒之桶 | out_of_scope_for_single_target_dps | control_only | complete | not_applicable | 仅控制或减速，不改变当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_twitch | 瘟疫之源 | E | 毒性爆发 | out_of_scope_for_single_target_dps | multi_target_or_area | complete | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_twitch | 瘟疫之源 | R | 火力全开 | needs_runtime_extension | distance_based_damage_modifier | complete | complete | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_varus | 惩戒之箭 | P | 复仇之欲 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_varus | 惩戒之箭 | Q | 穿刺之箭 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | complete | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| hero_skill | hero_varus | 惩戒之箭 | W | 枯萎箭袋 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_varus | 惩戒之箭 | E | 恶灵箭雨 | out_of_scope_for_single_target_dps | survivability_only | complete | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| hero_skill | hero_varus | 惩戒之箭 | R | 腐败锁链 | out_of_scope_for_single_target_dps | multi_target_or_area | complete | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_vayne | 暗夜猎手 | P | 暗夜猎手 | out_of_scope_for_single_target_dps | multi_target_or_area | complete | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_vayne | 暗夜猎手 | Q | 闪避突袭 | needs_runtime_extension | distance_based_damage_modifier | complete | complete | 当前 curve 没有攻击距离/目标距离输入。 |  |
| hero_skill | hero_vayne | 暗夜猎手 | W | 圣银弩箭 | already_covered | existing_batch_b_seed | complete | not_applicable |  |  |
| hero_skill | hero_vayne | 暗夜猎手 | E | 恶魔审判 | needs_manual_baseline | dps_relevant_manual_review | complete | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_vayne | 暗夜猎手 | R | 终极时刻 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | complete | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_xayah | 逆羽 | P | 锐切 | needs_manual_baseline | dps_relevant_manual_review | missing | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_xayah | 逆羽 | Q | 双刃 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_xayah | 逆羽 | W | 致死羽衣 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_xayah | 逆羽 | E | 倒钩 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_xayah | 逆羽 | R | 暴风羽刃 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_yunara | 不破之誓 | P | 初生之誓 | needs_runtime_extension | seeded_random_crit_sequence | missing | not_applicable | 涉及 on-crit 分支或暴击状态变化，当前 critPolicy=expected 不能证明真实触发序列。 |  |
| hero_skill | hero_yunara | 不破之誓 | Q | 灵蕴拳 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_yunara | 不破之誓 | W | 善恶轮 \| 寂灭掌 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_yunara | 不破之誓 | E | 明踪步 \| 夜影翻 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_yunara | 不破之誓 | R | 定圣诀 | out_of_scope_for_single_target_dps | no_single_target_dps_effect | missing | not_applicable | 未发现会改变当前单攻击方单标靶 DPS 的效果。 |  |
| hero_skill | hero_zeri | 祖安花火 | P | 内能迁转 | needs_manual_baseline | on_hit | missing | not_applicable | on-hit 伤害描述缺少可审计数值。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_zeri | 祖安花火 | Q | 电火迸射 | needs_manual_baseline | dps_relevant_manual_review | missing | complete | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| hero_skill | hero_zeri | 祖安花火 | W | 强穿激光 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | missing | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| hero_skill | hero_zeri | 祖安花火 | E | 灿丽花火 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| hero_skill | hero_zeri | 祖安花火 | R | 超限爆闪 | out_of_scope_for_single_target_dps | multi_target_or_area | missing | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| item_passive | 2501 | 霸王血铠 | item_passive | 专横 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 2501 | 霸王血铠 | item_passive | 报复 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 2510 | 黄昏与黎明 | item_passive | 咒刃 | needs_runtime_extension | spellblade_next_attack_state | not_applicable | not_applicable | 需要“施法后下一次普攻”状态；当前不做主动技能轮转。 |  |
| item_passive | 2512 | 猎魔人弩箭 | item_passive | 守夜 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | not_applicable | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| item_passive | 2512 | 猎魔人弩箭 | item_passive | 开战弹幕 | needs_runtime_extension | seeded_random_crit_sequence | not_applicable | not_applicable | 涉及 on-crit 分支或暴击状态变化，当前 critPolicy=expected 不能证明真实触发序列。 |  |
| item_passive | 2517 | 无穷饥渴 | item_passive | 饥馑 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | not_applicable | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| item_passive | 2517 | 无穷饥渴 | item_passive | 盛宴 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 2520 | 破垒者 | item_passive | 成型炸药 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 2520 | 破垒者 | item_passive | 破坏 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 2523 | 海克斯镜片 C44 | item_passive | 高倍望远镜 | needs_runtime_extension | distance_based_damage_modifier | not_applicable | not_applicable | 当前 curve 没有攻击距离/目标距离输入。 |  |
| item_passive | 2523 | 海克斯镜片 C44 | item_passive | 奥术瞄准 | needs_runtime_extension | distance_based_damage_modifier | not_applicable | not_applicable | 当前 curve 没有攻击距离/目标距离输入。 |  |
| item_passive | 3004 | 魔宗 | item_passive | 敬畏 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3004 | 魔宗 | item_passive | 法力流 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3026 | 守护天使 | item_passive | 重生 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 3031 | 无尽之刃 | item_passive | 无被动或仅主动/属性 | out_of_scope_for_single_target_dps | stat_only_or_active_only | not_applicable | not_applicable | 无可录入装备被动；属性已由 Batch C 处理，主动效果不进 Batch G。 |  |
| item_passive | 3032 | 育恩塔尔荒野箭 | item_passive | 熟能生巧 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3032 | 育恩塔尔荒野箭 | item_passive | 疾风骤雨 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | not_applicable | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| item_passive | 3033 | 凡性的提醒 | item_passive | 重伤 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3036 | 多米尼克领主的致意 | item_passive | 巨人杀手 | needs_runtime_extension | damage_multiplier_or_health_ratio | not_applicable | not_applicable | 当前 DPSPassiveEffect 不能表达全局伤害增幅或缺目标额外生命值字段。 |  |
| item_passive | 3046 | 幻影之舞 | item_passive | 幽影华尔兹 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 3071 | 黑色切割者 | item_passive | 切割 | needs_runtime_extension | stacking_stat_modifier_on_hit | not_applicable | not_applicable | 需要 timed stack stat modifier 聚合和掉层语义。 |  |
| item_passive | 3071 | 黑色切割者 | item_passive | 热烈 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3072 | 饮血剑 | item_passive | 灵液护盾 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 3073 | 海克斯注力刚壁 | item_passive | 海克斯充能 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | not_applicable | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| item_passive | 3073 | 海克斯注力刚壁 | item_passive | 过载 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3074 | 贪欲九头蛇 | item_passive | 顺劈 | out_of_scope_for_single_target_dps | multi_target_or_area | not_applicable | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| item_passive | 3078 | 三相之力 | item_passive | 咒刃 | needs_runtime_extension | spellblade_next_attack_state | not_applicable | not_applicable | 需要“施法后下一次普攻”状态；当前不做主动技能轮转。 |  |
| item_passive | 3078 | 三相之力 | item_passive | 加快 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3085 | 卢安娜的飓风 | item_passive | 风怒 | out_of_scope_for_single_target_dps | multi_target_or_area | not_applicable | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| item_passive | 3087 | 斯塔缇克电刃 | item_passive | 电火花 | out_of_scope_for_single_target_dps | multi_target_or_area | not_applicable | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| item_passive | 3087 | 斯塔缇克电刃 | item_passive | 电疗 | needs_runtime_extension | energized_charge_and_consume | not_applicable | not_applicable | 需要移动/攻击充能、充能消耗和首次攻击状态语义。 |  |
| item_passive | 3091 | 智慧末刃 | item_passive | 喧争 | needs_manual_baseline | on_hit | not_applicable | not_applicable | on-hit 伤害描述缺少可审计数值。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3094 | 疾射火炮 | item_passive | 神射手 | needs_runtime_extension | energized_charge_and_consume | not_applicable | not_applicable | 需要移动/攻击充能、充能消耗和首次攻击状态语义。 |  |
| item_passive | 3097 | 岚切 | item_passive | 盈能 | needs_runtime_extension | energized_charge_and_consume | not_applicable | not_applicable | 需要移动/攻击充能、充能消耗和首次攻击状态语义。 |  |
| item_passive | 3097 | 岚切 | item_passive | 弩箭 | needs_runtime_extension | energized_charge_and_consume | not_applicable | not_applicable | 需要移动/攻击充能、充能消耗和首次攻击状态语义。 |  |
| item_passive | 3100 | 巫妖之祸 | item_passive | 咒刃 | needs_runtime_extension | spellblade_next_attack_state | not_applicable | not_applicable | 需要“施法后下一次普攻”状态；当前不做主动技能轮转。 |  |
| item_passive | 3115 | 纳什之牙 | item_passive | 艾卡西亚之咬 | needs_manual_baseline | on_hit | not_applicable | not_applicable | on-hit 伤害描述缺少可审计数值。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3124 | 鬼索的狂暴之刃 | item_passive | 怨怒 | already_covered | on_hit, flat_magic_damage | not_applicable | not_applicable |  |  |
| item_passive | 3124 | 鬼索的狂暴之刃 | item_passive | 沸腾打击 | needs_runtime_extension | stacking_stat_modifier_on_hit, phantom_hit_on_hit_repeat | not_applicable | not_applicable | 需要 timed stacking stat modifier 与 phantom-hit 复制攻击特效语义。 |  |
| item_passive | 3139 | 水银弯刀 | item_passive | 无被动或仅主动/属性 | out_of_scope_for_single_target_dps | stat_only_or_active_only | not_applicable | not_applicable | 无可录入装备被动；属性已由 Batch C 处理，主动效果不进 Batch G。 |  |
| item_passive | 3142 | 幽梦之灵 | item_passive | 鬼影萦绕 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 3146 | 海克斯科技枪刃 | item_passive | 无被动或仅主动/属性 | out_of_scope_for_single_target_dps | stat_only_or_active_only | not_applicable | not_applicable | 无可录入装备被动；属性已由 Batch C 处理，主动效果不进 Batch G。 |  |
| item_passive | 3153 | 破败王者之刃 | item_passive | 雾之锋 | already_covered | on_hit, target_current_hp_ratio | not_applicable | not_applicable |  |  |
| item_passive | 3153 | 破败王者之刃 | item_passive | 抓挠之影 | out_of_scope_for_single_target_dps | slow, control_only | not_applicable | not_applicable | 只产生减速，不改变当前单标靶 DPS 曲线。 |  |
| item_passive | 3156 | 玛莫提乌斯之噬 | item_passive | 救主灵刃 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 3161 | 朔极之矛 | item_passive | 龙之力量 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | not_applicable | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| item_passive | 3161 | 朔极之矛 | item_passive | 专注意志 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3179 | 黯影阔剑 | item_passive | 夜行者 | needs_runtime_extension | spellblade_next_attack_state | not_applicable | not_applicable | 需要“施法后下一次普攻”状态；当前不做主动技能轮转。 |  |
| item_passive | 3179 | 黯影阔剑 | item_passive | 封锁 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 3181 | 破舰者 | item_passive | 船长 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 3181 | 破舰者 | item_passive | 登舰小组 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 3302 | 界弓 | item_passive | 晦影 | ready_to_encode | on_hit, flat_magic_damage | not_applicable | not_applicable |  |  |
| item_passive | 3302 | 界弓 | item_passive | 交相 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 3508 | 夺萃之镰 | item_passive | 咒刃 | needs_runtime_extension | spellblade_next_attack_state | not_applicable | not_applicable | 需要“施法后下一次普攻”状态；当前不做主动技能轮转。 |  |
| item_passive | 3748 | 巨型九头蛇 | item_passive | 顺劈 | out_of_scope_for_single_target_dps | multi_target_or_area | not_applicable | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| item_passive | 3748 | 巨型九头蛇 | item_passive | 顺劈 | out_of_scope_for_single_target_dps | multi_target_or_area | not_applicable | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| item_passive | 3814 | 夜之锋刃 | item_passive | 废除 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 6333 | 死亡之舞 | item_passive | 无视痛苦 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 6333 | 死亡之舞 | item_passive | 蔑视 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 6333 | 死亡之舞 | item_passive | 无视痛苦 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 6609 | 炼金朋克链锯剑 | item_passive | 劈削 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 6610 | 焚天 | item_passive | 光盾打击 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 6631 | 挺进破坏者 | item_passive | 顺劈 | out_of_scope_for_single_target_dps | multi_target_or_area | not_applicable | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| item_passive | 6672 | 海妖杀手 | item_passive | 放倒它 | already_covered | every_n_hit, target_missing_hp_amp | not_applicable | not_applicable |  |  |
| item_passive | 6673 | 不朽盾弓 | item_passive | 救主灵刃 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 6675 | 纳沃利烁刃 | item_passive | 超凡入圣 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | not_applicable | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| item_passive | 6676 | 收集者 | item_passive | 死 | needs_runtime_extension | execute_threshold | not_applicable | not_applicable | 需要阈值击杀语义和 damage 后 HP 顺序。 |  |
| item_passive | 6676 | 收集者 | item_passive | 税 | out_of_scope_for_single_target_dps | meta_or_non_target_dps | not_applicable | not_applicable | 金币、视野、友军、建筑物、复活、解控或非战斗状态效果不影响当前单标靶 DPS 曲线。 |  |
| item_passive | 6692 | 星蚀 | item_passive | 永升之月 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 6694 | 赛瑞尔达的怨恨 | item_passive | 严寒 | needs_runtime_extension | execute_threshold | not_applicable | not_applicable | 需要阈值击杀语义和 damage 后 HP 顺序。 |  |
| item_passive | 6695 | 巨蛇之牙 | item_passive | 掠盾者 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 6695 | 巨蛇之牙 | item_passive | 掠盾者 | out_of_scope_for_single_target_dps | survivability_only | not_applicable | not_applicable | 治疗、吸血或护盾属于生存收益，当前 DPS 输出不闭环。 |  |
| item_passive | 6696 | 公理圆弧 | item_passive | 涌动 | out_of_scope_for_single_target_dps | cooldown_or_haste_without_rotation | not_applicable | not_applicable | 当前不做主动技能轮转，冷却收益不能转成 DPS 曲线证据。 |  |
| item_passive | 6697 | 狂妄 | item_passive | 盛名 | needs_manual_baseline | dps_relevant_manual_review | not_applicable | not_applicable | 文本可能影响 DPS，但脚本无法从本地 Data Dragon 可靠还原数值或 rank 表。 | 完整 tooltip 数值或训练营截图 |
| item_passive | 6698 | 亵渎九头蛇 | item_passive | 顺劈 | out_of_scope_for_single_target_dps | multi_target_or_area | not_applicable | not_applicable | 多目标、弹射或范围收益不属于当前单标靶 DPS。 |  |
| item_passive | 6699 | 电震涡流剑 | item_passive | 通电 | needs_runtime_extension | energized_charge_and_consume | not_applicable | not_applicable | 需要移动/攻击充能、充能消耗和首次攻击状态语义。 |  |
| item_passive | 6699 | 电震涡流剑 | item_passive | 苍穹 | needs_runtime_extension | energized_charge_and_consume | not_applicable | not_applicable | 需要移动/攻击充能、充能消耗和首次攻击状态语义。 |  |
