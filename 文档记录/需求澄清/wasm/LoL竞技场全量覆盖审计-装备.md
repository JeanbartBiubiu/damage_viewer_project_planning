TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-10 00:00:00

# LoL竞技场全量覆盖审计-装备

日期：2026-04-10
状态：进行中
范围：装备按单实体 entry 审计
基线：当前原始快照重建后共 `702` 条 item entries

## 共享审计字段

- `runtimeLayer`：`formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter`
- `templateOrModel`：命中的模板或状态模型
- `coverageVerdict`：`covered / partial / gap / filtered`
- `gapOrConversionNote`：缺口、转换条件或过滤原因

## 装备专属字段

- `slotKind: stat_only / passive / active / mixed`
- `itemTags`

## 审计表

| entryId | entryNameZh | slotKind | primaryGroup | scopeAssessment | runtimeLayer | templateOrModel | coverageVerdict | gapOrConversionNote | sourceRef |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| item:1001 | 鞋子 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1001 |
| item:1004 | 仙女护符 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1004 |
| item:1006 | 治疗宝珠 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1006 |
| item:1011 | 巨人腰带 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1011 |
| item:1018 | 灵巧披风 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1018 |
| item:1026 | 爆裂魔杖 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1026 |
| item:1027 | 蓝水晶 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1027 |
| item:1028 | 红水晶 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1028 |
| item:1029 | 布甲 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1029 |
| item:1031 | 锁子甲 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1031 |
| item:1033 | 抗魔斗篷 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1033 |
| item:1035 | 灰烬小刀 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1035 |
| item:1036 | 长剑 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1036 |
| item:1037 | 十字镐 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1037 |
| item:1038 | 暴风之剑 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1038 |
| item:1039 | 冰雹刀刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1039 |
| item:1040 | 黑曜石锋刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1040 |
| item:1042 | 短剑 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1042 |
| item:1043 | 反曲之弓 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1043 |
| item:1052 | 增幅典籍 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1052 |
| item:1053 | 吸血鬼节杖 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1053 |
| item:1054 | 多兰之盾 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.1054 |
| item:1055 | 多兰之刃 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1055 |
| item:1056 | 多兰之戒 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1056 |
| item:1057 | 负极斗篷 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1057 |
| item:1058 | 无用大棒 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1058 |
| item:1082 | 黑暗封印 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.1082 |
| item:1083 | 萃取 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1083 |
| item:1090 | 任务：上路 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1090 |
| item:1091 | 任务：中路 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1091 |
| item:1092 | 任务：下路 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1092 |
| item:1093 | 任务：辅助 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1093 |
| item:1094 | 任务：打野 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1094 |
| item:1101 | 焰爪猫幼崽 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1101 |
| item:1102 | 风行狐幼体 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1102 |
| item:1103 | 踏苔蜥幼苗 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1103 |
| item:1104 | 先锋之眼 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1104 |
| item:1105 | 踏苔蜥幼苗 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1105 |
| item:1106 | 风行狐幼体 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1106 |
| item:1107 | 焰爪猫幼崽 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1107 |
| item:1111 | 嘉文一世之靴 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1111 |
| item:1200 | 上路任务 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1200 |
| item:1201 | 中路任务 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1201 |
| item:1202 | 下路任务 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1202 |
| item:1203 | 辅助任务 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1203 |
| item:1204 | 打野任务 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1204 |
| item:1205 |  | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1205 |
| item:1206 | 中路任务 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1206 |
| item:1207 | 下路任务 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1207 |
| item:1208 | 辅助任务 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1208 |
| item:1209 | 打野任务 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1209 |
| item:1220 | 解封的传送 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1220 |
| item:1221 | 上路任务 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1221 |
| item:1222 | 上路任务 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1222 |
| item:1500 | 穿透型子弹 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1500 |
| item:1501 | 防御工事 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1501 |
| item:1502 | 加固城防 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1502 |
| item:1503 | 典狱官之眼 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1503 |
| item:1504 | 前卫 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1504 |
| item:1505 | 加固城防 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1505 |
| item:1506 | 加固城防 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.1506 |
| item:1507 | 过载 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1507 |
| item:1508 | 反防御塔袜子 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1508 |
| item:1509 | 嗜好 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1509 |
| item:1510 | 弗瑞克风格的嗜好 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1510 |
| item:1511 | 超级士兵 装甲 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1511 |
| item:1512 | 超级士兵 能量场 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1512 |
| item:1515 | 防御塔镀层 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1515 |
| item:1516 | 建筑物赏金 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1516 |
| item:1517 | 建筑物赏金 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1517 |
| item:1518 | 建筑物赏金 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1518 |
| item:1519 | 建筑物赏金 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1519 |
| item:1520 | 过载 - 嚎哭深渊 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1520 |
| item:1521 | 钢铁防线 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.1521 |
| item:1522 | 防御塔威力升温 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1522 |
| item:1523 | 过载充能 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1523 |
| item:1524 | 增生 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.1524 |
| item:2001 | 回城 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2001 |
| item:2002 | 强化回城 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2002 |
| item:2003 | 生命药水 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2003 |
| item:2007 | 禁用回城 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2007 |
| item:2008 |  | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2008 |
| item:2010 | 永续意志夹心饼干 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2010 |
| item:2015 | 吉尔菲艾斯碎片 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.2015 |
| item:2019 | 钢铁印章 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2019 |
| item:2020 | 残暴之力 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2020 |
| item:2021 | 掘道钻头 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2021 |
| item:2022 | 荧尘 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2022 |
| item:2031 | 复用型药水 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2031 |
| item:2033 | 腐败药水 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2033 |
| item:2049 | 守护者护符 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2049 |
| item:2050 | 守护者法衣 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2050 |
| item:2051 | 守护者号角 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.2051 |
| item:2052 | 魄罗佳肴 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2052 |
| item:2055 | 控制守卫 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2055 |
| item:2056 | 侦察守卫 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2056 |
| item:2065 | 舒瑞娅的战歌 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2065 |
| item:2138 | 钢铁合剂 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2138 |
| item:2139 | 巫术合剂 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2139 |
| item:2140 | 愤怒合剂 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2140 |
| item:2141 | 帽子饮品 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2141 |
| item:2142 | 威能饮品 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2142 |
| item:2143 | 活力饮品 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2143 |
| item:2144 | 急速饮品 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2144 |
| item:2145 | 幸运骰子 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2145 |
| item:2146 | 增强版幸运骰子 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2146 |
| item:2150 | 技能合剂 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2150 |
| item:2151 | 贪财合剂 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2151 |
| item:2152 | 原力合剂 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | adaptive_force | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2152 |
| item:2161 | 班德尔威能饮品 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2161 |
| item:2162 | 班德尔活力饮品 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2162 |
| item:2163 | 班德尔急速饮品 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2163 |
| item:2403 | 小兵去质器 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.2403 |
| item:2420 | 探索者的护臂 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2420 |
| item:2421 | 碎裂的护臂 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2421 |
| item:2422 | 有点神奇之鞋 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2422 |
| item:2501 | 霸王血铠 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2501 |
| item:2502 | 无终恨意 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.2502 |
| item:2503 | 黯炎火炬 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2503 |
| item:2504 | 败魔 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2504 |
| item:2508 | 命定灰烬 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2508 |
| item:2510 | 黄昏与黎明 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2510 |
| item:2512 | 猎魔人弩箭 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2512 |
| item:2517 | 无穷饥渴 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2517 |
| item:2520 | 破垒者 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.2520 |
| item:2522 | 实现器 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2522 |
| item:2523 | 海克斯镜片 C44 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.2523 |
| item:2524 | 班德尔音管 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2524 |
| item:2525 | 原生质护带 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2525 |
| item:2526 | 耳语头环 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.2526 |
| item:2530 | 歌之权冠 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.2530 |
| item:3001 | 薄暮法袍 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3001 |
| item:3002 | 引路者 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.3002 |
| item:3003 | 大天使之杖 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.3003 |
| item:3004 | 魔宗 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.3004 |
| item:3005 | 鬼蟹 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.3005 |
| item:3006 | 狂战士胫甲 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3006 |
| item:3009 | 轻灵之靴 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.3009 |
| item:3010 | 共生鞋鱼 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3010 |
| item:3011 | 炼金科技纯化器 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3011 |
| item:3012 | 祝福圣杯 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3012 |
| item:3013 | 灵犀众魂 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3013 |
| item:3020 | 法师之靴 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3020 |
| item:3023 | 生命水井坠饰 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3023 |
| item:3024 | 冰川圆盾 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3024 |
| item:3026 | 守护天使 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3026 |
| item:3031 | 无尽之刃 | stat_only | 暴击资格与暴击策略 | manual_review | formula | crit_policy_gap | gap | 暴击伤害倍率不是普通属性加成，而是 crit multiplier policy。 | ddragon/16.7.1/zh_CN/item.json#data.3031 |
| item:3032 | 育恩塔尔荒野箭 | mixed | 资源与节奏 | needs_conversion | tempo | refund_cooldown | partial | 暴击时额外缩减冷却，依赖统一 on_crit 事件。 | ddragon/16.7.1/zh_CN/item.json#data.3032 |
| item:3033 | 凡性的提醒 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3033 |
| item:3035 | 最后的轻语 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered | 以原始快照为准，最后的轻语真实 id 为 3035。 | ddragon/16.7.1/zh_CN/item.json#data.3035 |
| item:3036 | 多米尼克领主的致意 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3036 |
| item:3039 | 阿塔玛的清算 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3039 |
| item:3040 | 炽天使之拥 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.3040 |
| item:3041 | 梅贾的窃魂卷 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.3041 |
| item:3042 | 魔切 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3042 |
| item:3044 | 净蚀 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3044 |
| item:3046 | 幻影之舞 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3046 |
| item:3047 | 铁板靴 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.3047 |
| item:3050 | 基克的聚合 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3050 |
| item:3051 | 缚炉之斧 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3051 |
| item:3053 | 斯特拉克的挑战护手 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.3053 |
| item:3057 | 耀光 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3057 |
| item:3065 | 振奋盔甲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3065 |
| item:3066 | 带翼的月板甲 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3066 |
| item:3067 | 燃烧宝石 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3067 |
| item:3068 | 日炎圣盾 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3068 |
| item:3070 | 女神之泪 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.3070 |
| item:3071 | 黑色切割者 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.3071 |
| item:3072 | 饮血剑 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal + overheal_to_shield | partial | 生命偷取溢出治疗转护盾。 | ddragon/16.7.1/zh_CN/item.json#data.3072 |
| item:3073 | 海克斯注力刚壁 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.3073 |
| item:3074 | 贪欲九头蛇 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3074 |
| item:3075 | 荆棘之甲 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3075 |
| item:3076 | 棘刺背心 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3076 |
| item:3077 | 提亚马特 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3077 |
| item:3078 | 三相之力 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3078 |
| item:3082 | 守望者铠甲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.3082 |
| item:3083 | 狂徒铠甲 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3083 |
| item:3084 | 心之钢 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3084 |
| item:3085 | 卢安娜的飓风 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3085 |
| item:3086 | 狂热 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3086 |
| item:3087 | 斯塔缇克电刃 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.3087 |
| item:3089 | 灭世者的死亡之帽 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3089 |
| item:3091 | 智慧末刃 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3091 |
| item:3094 | 疾射火炮 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.3094 |
| item:3095 | 已弃用的装备 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3095 |
| item:3097 | 岚切 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3097 |
| item:3100 | 巫妖之祸 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3100 |
| item:3102 | 女妖面纱 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3102 |
| item:3105 | 军团圣盾 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3105 |
| item:3107 | 救赎 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3107 |
| item:3108 | 恶魔法典 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3108 |
| item:3109 | 骑士之誓 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3109 |
| item:3110 | 冰霜之心 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.3110 |
| item:3111 | 水银之靴 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3111 |
| item:3112 | 守护者法球 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.3112 |
| item:3113 | 以太精魂 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3113 |
| item:3114 | 禁忌雕像 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3114 |
| item:3115 | 纳什之牙 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3115 |
| item:3116 | 瑞莱的冰晶节杖 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.3116 |
| item:3117 | 疾行之靴 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3117 |
| item:3118 | 残疫 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3118 |
| item:3119 | 凛冬之临 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.3119 |
| item:3121 | 末日寒冬 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3121 |
| item:3123 | 死刑宣告 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3123 |
| item:3124 | 鬼索的狂暴之刃 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.3124 |
| item:3128 | 冥火之拥 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3128 |
| item:3131 | 神圣之剑 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3131 |
| item:3133 | 考尔菲德的战锤 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3133 |
| item:3134 | 锯齿短匕 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3134 |
| item:3135 | 虚空之杖 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3135 |
| item:3137 | 蜕生 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3137 |
| item:3139 | 水银弯刀 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3139 |
| item:3140 | 水银饰带 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3140 |
| item:3142 | 幽梦之灵 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3142 |
| item:3143 | 兰顿之兆 | mixed | 暴击资格与暴击策略 | manual_review | formula | crit_policy_gap | gap | 减少所受暴击伤害属于防守侧 crit mitigation policy。 | ddragon/16.7.1/zh_CN/item.json#data.3143 |
| item:3144 | 斥候弹弓 | mixed | 资源与节奏 | needs_conversion | tempo | trigger + tempo | partial | 主动伤害与攻击缩短冷却并存。 | ddragon/16.7.1/zh_CN/item.json#data.3144 |
| item:3145 | 海克斯科技发电机 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3145 |
| item:3146 | 海克斯科技枪刃 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3146 |
| item:3147 | 幽魂面具 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3147 |
| item:3152 | 海克斯科技火箭腰带 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3152 |
| item:3153 | 破败王者之刃 | mixed | 命中触发与标记结算 | needs_conversion | trigger | on_hit_proc | partial | 同时含当前生命值伤害与第 3 次攻击减速，后续应支持主机制 + 次机制。 | ddragon/16.7.1/zh_CN/item.json#data.3153 |
| item:3155 | 海克斯饮魔刀 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.3155 |
| item:3156 | 玛莫提乌斯之噬 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3156 |
| item:3157 | 中娅沙漏 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3157 |
| item:3158 | 明朗之靴 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3158 |
| item:3161 | 朔极之矛 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.3161 |
| item:3165 | 莫雷洛秘典 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3165 |
| item:3170 | 迅速进军 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3170 |
| item:3171 | 猩红明朗 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3171 |
| item:3172 | 炮铜胫甲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3172 |
| item:3173 | 带链碾碎者 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.3173 |
| item:3174 | 装甲战靴 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3174 |
| item:3175 | 灵能使之靴 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3175 |
| item:3176 | 永远前进 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3176 |
| item:3177 | 守护者之刃 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3177 |
| item:3179 | 黯影阔剑 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3179 |
| item:3181 | 破舰者 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3181 |
| item:3184 | 守护者战锤 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3184 |
| item:3190 | 钢铁烈阳之匣 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3190 |
| item:3193 | 石像鬼石板甲 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.3193 |
| item:3211 | 幽魂斗篷 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3211 |
| item:3222 | 米凯尔的祝福 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3222 |
| item:3302 | 界弓 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3302 |
| item:3330 | 草间人 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3330 |
| item:3340 | 侦察守卫 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3340 |
| item:3348 | 奥术探测器 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.3348 |
| item:3349 | 透光奇点 | stat_only | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3349 |
| item:3363 | 远见改造 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.3363 |
| item:3364 | 神谕透镜 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3364 |
| item:3398 | 小型派对礼品 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3398 |
| item:3399 | 派对礼品 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3399 |
| item:3400 | 你也有份 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3400 |
| item:3430 | 毁坏仪式 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3430 |
| item:3504 | 炽热香炉 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3504 |
| item:3508 | 夺萃之镰 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3508 |
| item:3513 | 先锋之眼 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3513 |
| item:3599 | 卡莉丝塔的黑色长矛 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3599 |
| item:3600 | 卡莉丝塔的黑色长矛 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3600 |
| item:3742 | 亡者的板甲 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.3742 |
| item:3748 | 巨型九头蛇 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3748 |
| item:3801 | 晶体护腕 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3801 |
| item:3802 | 遗失的章节 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3802 |
| item:3803 | 万世催化石 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3803 |
| item:3814 | 夜之锋刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3814 |
| item:3850 | 窃法之刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3850 |
| item:3851 | 冰霜之牙 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3851 |
| item:3853 | 极冰碎片 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3853 |
| item:3854 | 钢铁护肩 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3854 |
| item:3855 | 符钢肩甲 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3855 |
| item:3857 | 白岩肩铠 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3857 |
| item:3858 | 圣物之盾 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3858 |
| item:3859 | 巨神峰圆盾 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3859 |
| item:3860 | 山脉壁垒 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3860 |
| item:3862 | 幽魂镰刀 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3862 |
| item:3863 | 鬼影新月 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3863 |
| item:3864 | 黑雾巨镰 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3864 |
| item:3865 | 云游图鉴 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3865 |
| item:3866 | 符文罗盘 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3866 |
| item:3867 | 异世珍藏 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3867 |
| item:3869 | 星界据守 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3869 |
| item:3870 | 圆梦使者 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3870 |
| item:3871 | 扎兹沙克的溃口 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3871 |
| item:3876 | 摩天雪橇 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3876 |
| item:3877 | 血鸣 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3877 |
| item:3901 | <rarityLegendary>随意开火</rarityLegendary><br><subtitleLeft><silver>500银蛇币</silver></subtitleLeft> | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.3901 |
| item:3902 | <rarityLegendary>死亡之女</rarityLegendary><br><subtitleLeft><silver>500银蛇币</silver></subtitleLeft> | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3902 |
| item:3903 | <rarityLegendary>鼓舞士气</rarityLegendary><br><subtitleLeft><silver>500银蛇币</silver></subtitleLeft> | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.3903 |
| item:3916 | 湮灭宝珠 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.3916 |
| item:4003 | 救生索 | mixed | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4003 |
| item:4004 | 幽魂弯刀 | mixed | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4004 |
| item:4005 | 帝国指令 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.4005 |
| item:4010 | 放血者的诅咒 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4010 |
| item:4011 | 花晓之剑 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.4011 |
| item:4012 | 食罪者 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.4012 |
| item:4013 | 闪电穗带 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4013 |
| item:4014 | 冰霜之锤 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.4014 |
| item:4015 | 困惑 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4015 |
| item:4016 | 无言承诺 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.4016 |
| item:4017 | 恶火小斧 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4017 |
| item:4401 | 自然之力 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4401 |
| item:4402 | 激发之匣 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4402 |
| item:4403 | 金铲铲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4403 |
| item:4628 | 视界专注 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4628 |
| item:4629 | 星界驱驰 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4629 |
| item:4630 | 枯萎珠宝 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4630 |
| item:4632 | 翠绿屏障 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4632 |
| item:4633 | 裂隙制造者 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4633 |
| item:4635 | 榨血睥睨 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4635 |
| item:4636 | 暗夜收割者 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4636 |
| item:4637 | 恶魔之拥 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4637 |
| item:4638 | 戒备眼石 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4638 |
| item:4641 | 萌动眼石 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4641 |
| item:4642 | 班德尔玻璃镜 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.4642 |
| item:4643 | 警觉眼石 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.4643 |
| item:4644 | 破碎王后之冕 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.4644 |
| item:4645 | 影焰 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.4645 |
| item:4646 | 风暴狂涌 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.4646 |
| item:5000 | 幸运阿福雕像 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.5000 |
| item:5001 | 黄金之心 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.5001 |
| item:5002 | 凯奇的幸运手 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.5002 |
| item:5003 | 贪婪之刃 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.5003 |
| item:5004 | 贤者之石 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.5004 |
| item:5005 | <font color='#C21807'>多</font><font color='#FFBF00'>彩</font><font color='#00A86B'>之</font><font color='#40E0D0'>药</font><font color='#8F00FF'>水</font> | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.5005 |
| item:5006 | 贪婪之“药水？” | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.5006 |
| item:6029 | 铁刺鞭 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6029 |
| item:6032 | 属性加成 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6032 |
| item:6035 | 密银黎明 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.6035 |
| item:6333 | 死亡之舞 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6333 |
| item:6609 | 炼金朋克链锯剑 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6609 |
| item:6610 | 焚天 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6610 |
| item:6616 | 流水法杖 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6616 |
| item:6617 | 月石再生器 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6617 |
| item:6620 | 海力亚的回响 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6620 |
| item:6621 | 黎明核心 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6621 |
| item:6630 | 渴血战斧 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6630 |
| item:6631 | 挺进破坏者 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6631 |
| item:6632 | 神圣分离者 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6632 |
| item:6653 | 兰德里的折磨 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6653 |
| item:6655 | 卢登的回声 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6655 |
| item:6656 | 永霜 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6656 |
| item:6657 | 时光之杖 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.6657 |
| item:6660 | 斑比的熔渣 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6660 |
| item:6662 | 冰脉护手 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6662 |
| item:6664 | 璀璨回响 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6664 |
| item:6665 | 千变者贾修 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6665 |
| item:6667 | 辉耀美德 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6667 |
| item:6670 | 正午箭袋 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6670 |
| item:6671 | 狂风之力 | mixed | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6671 |
| item:6672 | 海妖杀手 | mixed | 叠层与时效 | needs_conversion | counter | counter_state + damage_formula_ratio | partial | 第 N 次触发与已损失生命值伤害叠在一条文本里。 | ddragon/16.7.1/zh_CN/item.json#data.6672 |
| item:6673 | 不朽盾弓 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.6673 |
| item:6675 | 纳沃利烁刃 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.6675 |
| item:6676 | 收集者 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6676 |
| item:6677 | 狂怒小刀 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6677 |
| item:6690 | 剑翎 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6690 |
| item:6691 | 德拉克萨的暮刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6691 |
| item:6692 | 星蚀 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6692 |
| item:6693 | 暗行者之爪 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6693 |
| item:6694 | 赛瑞尔达的怨恨 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6694 |
| item:6695 | 巨蛇之牙 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6695 |
| item:6696 | 公理圆弧 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.6696 |
| item:6697 | 狂妄 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6697 |
| item:6698 | 亵渎九头蛇 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6698 |
| item:6699 | 电震涡流剑 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.6699 |
| item:6700 | 拉阔尔之盾 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.6700 |
| item:6701 | 禁忌时机 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.6701 |
| item:6702 | 侦察前方 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.6702 |
| item:7050 | 普朗克 占位 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.7050 |
| item:8001 | 厌恨锁链 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.8001 |
| item:8010 | 放血者的诅咒 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.8010 |
| item:8020 | 深渊面具 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.8020 |
| item:9168 | 锁定的武器栏位 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9168 |
| item:9171 | 旋风切割器 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9171 |
| item:9172 | 悠米无人机 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9172 |
| item:9173 | 耀光力场 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9173 |
| item:9174 | 斯塔缇克之剑 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9174 |
| item:9175 | 雌狮之怨 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9175 |
| item:9176 | 机关兔兔枪 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9176 |
| item:9177 | 炽烈短弓 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9177 |
| item:9178 | 歼灭者 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9178 |
| item:9179 | 战兔十字弩 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9179 |
| item:9180 | UwU魔爆炮 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9180 |
| item:9181 | 漩涡手套 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9181 |
| item:9183 | 回旋刃 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9183 |
| item:9184 | 战兔巨爆 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9184 |
| item:9185 | 反鲨海弹 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9185 |
| item:9187 | 提伯斯标准版 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9187 |
| item:9188 | 幻灵地雷 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9188 |
| item:9189 | 最终都市列车 | stat_only | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9189 |
| item:9190 | 回响蝠刃 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9190 |
| item:9192 | 爪爪投毒器 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9192 |
| item:9193 | 冰爆护甲 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9193 |
| item:9271 | 不息气旋 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9271 |
| item:9272 | 悠米无人机_最终版_最终最终版 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9272 |
| item:9273 | 爆破之拥 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9273 |
| item:9274 | 普朗比斯电雕机 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9274 |
| item:9275 | 包覆之光 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9275 |
| item:9276 | 双重兔兔弹幕 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9276 |
| item:9277 | 进化余烬射击 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9277 |
| item:9278 | 幻灵启示录 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9278 |
| item:9279 | 战兔至尊弩炮 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9279 |
| item:9280 | OwO魔爆炮 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9280 |
| item:9281 | 风暴护手 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9281 |
| item:9283 | 四重回旋刃 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9283 |
| item:9284 | 疾速兔降 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9284 |
| item:9285 | 不休踩弹 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9285 |
| item:9287 | 提伯斯（顶配版） | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9287 |
| item:9288 | 金克丝三连炸 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9288 |
| item:9289 | 最终都市特快 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9289 |
| item:9290 | 薇恩的炫彩刃 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9290 |
| item:9292 | 熊掌化学喷雾器 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9292 |
| item:9293 | 深度冻结 | stat_only | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.9293 |
| item:9300 | 喵喵枪 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.9300 |
| item:9301 | 盾牌猛击 | stat_only | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.9301 |
| item:9302 | 声波 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9302 |
| item:9303 | 木枷挥击 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9303 |
| item:9304 | 斩钢闪 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9304 |
| item:9305 | 触手重击 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9305 |
| item:9306 | 带翼羽刃 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9306 |
| item:9307 | 附灵飞弹 | stat_only | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.9307 |
| item:9308 | 兔子跳 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.9308 |
| item:9400 | 战猫弹幕 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9400 |
| item:9401 | 雄狮之光 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9401 |
| item:9402 | 幻灵回响 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9402 |
| item:9403 | 无情砍削 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9403 |
| item:9404 | 漂泊风暴 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9404 |
| item:9405 | 巨熊重击 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.9405 |
| item:9406 | 爱意飞射 | stat_only | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.9406 |
| item:9407 | 跳跃灵体 | stat_only | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.9407 |
| item:9408 | 胡萝卜撞击 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.9408 |
| item:123430 | 毁坏仪式 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.123430 |
| item:124011 | 花晓之剑 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.124011 |
| item:126697 | 狂妄 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.126697 |
| item:220000 | 属性加成 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220000 |
| item:220001 | 传说级战士装备 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220001 |
| item:220002 | 传说级射手装备 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220002 |
| item:220003 | 传说级刺客装备 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220003 |
| item:220004 | 传说级法师装备 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220004 |
| item:220005 | 传说级坦克装备 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220005 |
| item:220006 | 传说级辅助装备 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220006 |
| item:220007 | 棱彩装备 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220007 |
| item:220008 | 锻造器兑换券 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220008 |
| item:220009 | 黄金阶属性锻造器兑换券 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220009 |
| item:220010 | 棱彩阶属性锻造器兑换券 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220010 |
| item:220011 | 勇敢举动兑换券 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.220011 |
| item:221011 | 巨人腰带 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.221011 |
| item:221026 | 爆裂魔杖 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.221026 |
| item:221031 | 锁子甲 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.221031 |
| item:221038 | 暴风之剑 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.221038 |
| item:221043 | 反曲之弓 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.221043 |
| item:221053 | 吸血鬼节杖 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.221053 |
| item:221057 | 负极斗篷 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.221057 |
| item:221058 | 无用大棒 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.221058 |
| item:222022 | 荧尘 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.222022 |
| item:222051 | 守护者号角 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.222051 |
| item:222065 | 舒瑞娅的战歌 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.222065 |
| item:222141 | 帽子饮品 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.222141 |
| item:222502 | 无终恨意 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.222502 |
| item:222503 | 黯炎火炬 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.222503 |
| item:222504 | 败魔 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.222504 |
| item:222510 | 黄昏与黎明 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.222510 |
| item:222512 | 猎魔人弩箭 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.222512 |
| item:222517 | 无穷饥渴 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.222517 |
| item:222522 | 实现器 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.222522 |
| item:222523 | 海克斯镜片 C44 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.222523 |
| item:222524 | 班德尔音管 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.222524 |
| item:222525 | 原生质护带 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.222525 |
| item:222526 | 耳语头环 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.222526 |
| item:222530 | 歌之权冠 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.222530 |
| item:223001 | 薄暮法袍 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.223001 |
| item:223002 | 引路者 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.223002 |
| item:223003 | 大天使之杖 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.223003 |
| item:223004 | 魔宗 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.223004 |
| item:223005 | 鬼蟹 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.223005 |
| item:223006 | 狂战士胫甲 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223006 |
| item:223009 | 轻灵之靴 | stat_only | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.223009 |
| item:223011 | 炼金科技纯化器 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223011 |
| item:223020 | 法师之靴 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223020 |
| item:223026 | 守护天使 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223026 |
| item:223031 | 无尽之刃 | stat_only | 暴击资格与暴击策略 | manual_review | formula | crit_policy_gap | gap | 杰作无尽之刃同样直接改写暴击伤害倍率，属于 crit multiplier policy。 | ddragon/16.7.1/zh_CN/item.json#data.223031 |
| item:223032 | 育恩塔尔荒野箭 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.223032 |
| item:223033 | 凡性的提醒 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223033 |
| item:223036 | 多米尼克领主的致意 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223036 |
| item:223039 | 阿塔玛的清算 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223039 |
| item:223040 | 炽天使之拥 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.223040 |
| item:223042 | 魔切 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223042 |
| item:223046 | 幻影之舞 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223046 |
| item:223047 | 铁板靴 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.223047 |
| item:223050 | 基克的聚合 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223050 |
| item:223053 | 斯特拉克的挑战护手 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.223053 |
| item:223057 | 耀光 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.223057 |
| item:223065 | 振奋盔甲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223065 |
| item:223067 | 燃烧宝石 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223067 |
| item:223068 | 日炎圣盾 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223068 |
| item:223069 | 虚空献祭 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223069 |
| item:223071 | 黑色切割者 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223071 |
| item:223072 | 饮血剑 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223072 |
| item:223073 | 海克斯注力刚壁 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.223073 |
| item:223074 | 贪欲九头蛇 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223074 |
| item:223075 | 荆棘之甲 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223075 |
| item:223078 | 三相之力 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223078 |
| item:223084 | 心之钢 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.223084 |
| item:223085 | 卢安娜的飓风 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223085 |
| item:223087 | 斯塔缇克电刃 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223087 |
| item:223089 | 灭世者的死亡之帽 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223089 |
| item:223091 | 智慧末刃 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223091 |
| item:223094 | 疾射火炮 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.223094 |
| item:223095 | 岚切 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.223095 |
| item:223100 | 巫妖之祸 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223100 |
| item:223102 | 女妖面纱 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.223102 |
| item:223105 | 军团圣盾 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223105 |
| item:223107 | 救赎 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223107 |
| item:223109 | 骑士之誓 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223109 |
| item:223110 | 冰霜之心 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223110 |
| item:223111 | 水银之靴 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223111 |
| item:223112 | 守护者法球 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.223112 |
| item:223115 | 纳什之牙 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223115 |
| item:223116 | 瑞莱的冰晶节杖 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.223116 |
| item:223118 | 残疫 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223118 |
| item:223119 | 凛冬之临 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.223119 |
| item:223121 | 末日寒冬 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223121 |
| item:223124 | 鬼索的狂暴之刃 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.223124 |
| item:223135 | 虚空之杖 | stat_only | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223135 |
| item:223137 | 蜕生 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223137 |
| item:223139 | 水银弯刀 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223139 |
| item:223142 | 幽梦之灵 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223142 |
| item:223143 | 兰顿之兆 | mixed | 暴击资格与暴击策略 | manual_review | formula | crit_policy_gap | gap | 杰作兰顿之兆同样直接减免所受暴击伤害，属于 defender crit mitigation policy。 | ddragon/16.7.1/zh_CN/item.json#data.223143 |
| item:223146 | 海克斯科技枪刃 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223146 |
| item:223152 | 海克斯科技火箭腰带 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223152 |
| item:223153 | 破败王者之刃 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223153 |
| item:223156 | 玛莫提乌斯之噬 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223156 |
| item:223157 | 中娅沙漏 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.223157 |
| item:223158 | 明朗之靴 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223158 |
| item:223161 | 朔极之矛 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.223161 |
| item:223165 | 莫雷洛秘典 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223165 |
| item:223172 | 灵风 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223172 |
| item:223177 | 守护者之刃 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223177 |
| item:223181 | 破舰者 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223181 |
| item:223184 | 守护者战锤 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223184 |
| item:223185 | 守护者短匕 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223185 |
| item:223190 | 钢铁烈阳之匣 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223190 |
| item:223193 | 石像鬼石板甲 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.223193 |
| item:223222 | 米凯尔的祝福 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223222 |
| item:223302 | 界弓 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223302 |
| item:223504 | 炽热香炉 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.223504 |
| item:223508 | 夺萃之镰 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223508 |
| item:223742 | 亡者的板甲 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.223742 |
| item:223748 | 巨型九头蛇 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223748 |
| item:223814 | 夜之锋刃 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.223814 |
| item:224004 | 幽魂弯刀 | mixed | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/item.json#data.224004 |
| item:224005 | 帝国指令 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.224005 |
| item:224401 | 自然之力 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.224401 |
| item:224403 | 金铲铲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.224403 |
| item:224628 | 视界专注 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.224628 |
| item:224629 | 星界驱驰 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.224629 |
| item:224633 | 裂隙制造者 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.224633 |
| item:224636 | 暗夜收割者 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.224636 |
| item:224637 | 恶魔之拥 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.224637 |
| item:224644 | 破碎王后之冕 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.224644 |
| item:224645 | 影焰 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.224645 |
| item:224646 | 风暴狂涌 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.224646 |
| item:226035 | 密银黎明 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.226035 |
| item:226333 | 死亡之舞 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226333 |
| item:226609 | 炼金朋克链锯剑 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226609 |
| item:226610 | 焚天 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226610 |
| item:226616 | 流水法杖 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226616 |
| item:226617 | 月石再生器 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226617 |
| item:226620 | 海力亚的回响 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226620 |
| item:226621 | 黎明核心 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226621 |
| item:226630 | 渴血战斧 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226630 |
| item:226631 | 挺进破坏者 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226631 |
| item:226632 | 神圣分离者 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226632 |
| item:226653 | 兰德里的苦楚 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226653 |
| item:226655 | 卢登的回声 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.226655 |
| item:226656 | 永霜 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226656 |
| item:226657 | 时光之杖 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226657 |
| item:226662 | 冰脉护手 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226662 |
| item:226664 | 璀璨回响 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226664 |
| item:226665 | 千变者贾修 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226665 |
| item:226667 | 辉耀美德 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226667 |
| item:226671 | 狂风之力 | mixed | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226671 |
| item:226672 | 海妖杀手 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.226672 |
| item:226673 | 不朽盾弓 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.226673 |
| item:226675 | 纳沃利烁刃 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.226675 |
| item:226676 | 收集者 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226676 |
| item:226691 | 德拉克萨的暮刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226691 |
| item:226692 | 星蚀 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226692 |
| item:226693 | 暗行者之爪 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226693 |
| item:226694 | 赛瑞尔达的怨恨 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226694 |
| item:226695 | 巨蛇之牙 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226695 |
| item:226696 | 公理圆弧 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226696 |
| item:226697 | 狂妄 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226697 |
| item:226698 | 亵渎九头蛇 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226698 |
| item:226699 | 电震涡流剑 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.226699 |
| item:226701 | 禁忌时机 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.226701 |
| item:228001 | 厌恨锁链 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.228001 |
| item:228002 | 沃格勒特的巫师帽 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.228002 |
| item:228003 | 死亡之刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.228003 |
| item:228004 | 适应性头盔 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.228004 |
| item:228005 | 黑曜切割者 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.228005 |
| item:228006 | 血色之刃 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.228006 |
| item:228008 | 符文阔剑 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.228008 |
| item:228009 | 多功能工具 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.228009 |
| item:228020 | 深渊面具 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.228020 |
| item:322065 | 舒瑞娅的战歌 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.322065 |
| item:322526 | 耳语头环 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.322526 |
| item:322530 | 歌之权冠 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.322530 |
| item:323002 | 引路者 | mixed | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/item.json#data.323002 |
| item:323003 | 大天使之杖 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.323003 |
| item:323004 | 魔宗 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.323004 |
| item:323040 | 炽天使之拥 | mixed | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/item.json#data.323040 |
| item:323042 | 魔切 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.323042 |
| item:323050 | 基克的聚合 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.323050 |
| item:323070 | 女神之泪 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.323070 |
| item:323075 | 荆棘之甲 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.323075 |
| item:323107 | 救赎 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.323107 |
| item:323109 | 骑士之誓 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.323109 |
| item:323110 | 冰霜之心 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.323110 |
| item:323119 | 凛冬之临 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.323119 |
| item:323121 | 末日寒冬 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.323121 |
| item:323190 | 钢铁烈阳之匣 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.323190 |
| item:323222 | 米凯尔的祝福 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.323222 |
| item:323504 | 炽热香炉 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.323504 |
| item:324005 | 帝国指令 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.324005 |
| item:326616 | 流水法杖 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.326616 |
| item:326617 | 月石再生器 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.326617 |
| item:326620 | 海力亚的回响 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.326620 |
| item:326621 | 黎明核心 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.326621 |
| item:326657 | 时光之杖 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.326657 |
| item:328020 | 深渊面具 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.328020 |
| item:443054 | 暗钢利爪 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443054 |
| item:443055 | 爆鸣 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443055 |
| item:443056 | 魔王之冕 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443056 |
| item:443058 | 熔石之盾 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443058 |
| item:443059 | 星夜斗篷 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.443059 |
| item:443060 | 神圣之剑 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | adaptive_force | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443060 |
| item:443061 | 熵之力 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443061 |
| item:443062 | 血色赠礼 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.443062 |
| item:443063 | 艾莉莎的奇迹 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443063 |
| item:443064 | 飞升护符 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443064 |
| item:443069 | 断筋者 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.443069 |
| item:443079 | 涡轮炼金罐 | mixed | 控制效果与锁窗 | core_1v1 | control | control_immunity_window | partial | 先显式保留霸体、不可阻挡和控制免疫窗口语义。 | ddragon/16.7.1/zh_CN/item.json#data.443079 |
| item:443080 | 双生面具 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.443080 |
| item:443081 | 海克斯弹丸配枪 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.443081 |
| item:443083 | 狂徒铠甲 | mixed | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443083 |
| item:443090 | 收割者的过路费 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.443090 |
| item:443193 | 石像鬼石板甲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.443193 |
| item:444636 | 暗夜收割者 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.444636 |
| item:444637 | 恶魔之拥 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.444637 |
| item:444644 | 破碎王后之冕 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.444644 |
| item:446632 | 神圣分离者 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.446632 |
| item:446656 | 永霜 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.446656 |
| item:446667 | 辉耀美德 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.446667 |
| item:446671 | 狂风之力 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.446671 |
| item:446691 | 德拉克萨的暮刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.446691 |
| item:446693 | 暗行者之爪 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/item.json#data.446693 |
| item:447100 | 幻境之刃 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.447100 |
| item:447101 | 投机者之刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447101 |
| item:447102 | 实界裂缝 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447102 |
| item:447103 | 血术师之盔 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447103 |
| item:447104 | 激发之匣 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447104 |
| item:447105 | 至高天诺言 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447105 |
| item:447106 | 龙心 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447106 |
| item:447107 | 斩首者 | stat_only | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.447107 |
| item:447108 | 符文雕刻者 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447108 |
| item:447109 | 残忍 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447109 |
| item:447110 | 月华咒刃 | mixed | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/item.json#data.447110 |
| item:447111 | 霸王血铠 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447111 |
| item:447112 | 食肉斧剑 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447112 |
| item:447113 | 爆炸之球 | mixed | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447113 |
| item:447114 | 混响之刃 | mixed | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/item.json#data.447114 |
| item:447115 | 弑王 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447115 |
| item:447116 | 均衡十手 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | adaptive_force | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447116 |
| item:447118 | 炎术师的披风 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | adaptive_force | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447118 |
| item:447119 | 闪电杖 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447119 |
| item:447120 | 钻头长矛 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | adaptive_force | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447120 |
| item:447121 | 暮色之锋 | mixed | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/item.json#data.447121 |
| item:447122 | 黑洞护手 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447122 |
| item:447123 | 傀儡操纵器 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.447123 |
| item:550001 | 生命条色块：蓝色 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.550001 |
| item:550002 | 生命条色块：橙色 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.550002 |
| item:550003 | 生命条色块：绿色 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.550003 |
| item:550004 | 生命条色块：粉色 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.550004 |
| item:550005 | 生命条清理：重置颜色 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.550005 |
| item:550006 | 生命条色块：多彩 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.550006 |
| item:550007 | 派对礼品 | stat_only | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.550007 |
| item:663039 | 阿塔玛的清算 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.663039 |
| item:663056 | 魔王之冕 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.663056 |
| item:663058 | 熔石之盾 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.663058 |
| item:663059 | 星夜斗篷 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.663059 |
| item:663060 | 神圣之剑 | mixed | 属性派生与穿透顺序 | core_1v1 | attr | adaptive_force | covered |  | ddragon/16.7.1/zh_CN/item.json#data.663060 |
| item:663064 | 维迦的飞升护符 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.663064 |
| item:663146 | 海克斯科技枪刃 | mixed | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/item.json#data.663146 |
| item:663172 | 灵风 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.663172 |
| item:663193 | 石像鬼石板甲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.663193 |
| item:664011 | 花晓之剑 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.664011 |
| item:664403 | 金铲铲 | stat_only | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.664403 |
| item:664644 | 破碎王后之冕 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 默认归为基础属性加成；待后续抽样复核。 | ddragon/16.7.1/zh_CN/item.json#data.664644 |
| item:667101 | 投机者之刃 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.667101 |
| item:667109 | 残忍 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.667109 |
| item:667112 | 食肉斧剑 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.667112 |
| item:667666 | 收集者 | mixed | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/item.json#data.667666 |
| item:994403 | 金铲铲 | mixed | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/item.json#data.994403 |

## 当前备注

- 装备常把面板属性、主动、被动写在同一条文本里；必要时在备注里拆分判断。
- 源数据优先于旧索引，若旧文档样本 id 与快照不一致，以快照为准。
