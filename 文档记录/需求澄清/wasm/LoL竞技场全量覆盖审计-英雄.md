TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-10 00:00:00

# LoL竞技场全量覆盖审计-英雄

日期：2026-04-10
状态：进行中
范围：英雄被动与技能按原子 entry 审计
基线：当前原始快照重建后共 `860` 条 champion entries

## 共享审计字段

- `runtimeLayer`：`formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter`
- `templateOrModel`：命中的模板或状态模型
- `coverageVerdict`：`covered / partial / gap / filtered`
- `gapOrConversionNote`：缺口、转换条件或过滤原因

## 英雄专属字段

- `ownerId`
- `skillSlot: P / Q / W / E / R / A`
- `isPassive`

## 审计表

| entryId | ownerId | skillSlot | entryNameZh | primaryGroup | scopeAssessment | runtimeLayer | templateOrModel | coverageVerdict | gapOrConversionNote | sourceRef |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| champion:Aatrox:passive | Aatrox | P | 赐死剑气 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered | 下次普攻附伤并按目标最大生命值治疗。 | ddragon/16.7.1/zh_CN/championFull.json#data.Aatrox.passive |
| champion:Aatrox:spell:AatroxQ | Aatrox | Q | 暗裔利刃 | 资源与节奏 | core_1v1 | tempo | cast_stage | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Aatrox.spells[0] |
| champion:Aatrox:spell:AatroxW | Aatrox | W | 恶火束链 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Aatrox.spells[1] |
| champion:Aatrox:spell:AatroxE | Aatrox | E | 暗影冲决 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Aatrox.spells[2] |
| champion:Aatrox:spell:AatroxR | Aatrox | R | 大灭 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Aatrox.spells[3] |
| champion:Ahri:passive | Ahri | P | 摄魂夺魄 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ahri.passive |
| champion:Ahri:spell:AhriQ | Ahri | Q | 欺诈宝珠 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ahri.spells[0] |
| champion:Ahri:spell:AhriW | Ahri | W | 妖异狐火 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ahri.spells[1] |
| champion:Ahri:spell:AhriE | Ahri | E | 魅惑妖术 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ahri.spells[2] |
| champion:Ahri:spell:AhriR | Ahri | R | 灵魄突袭 | 资源与节奏 | core_1v1 | tempo | remaining_charges + grant_charge | partial | 要区分剩余次数与击杀后补充次数。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ahri.spells[3] |
| champion:Akali:passive | Akali | P | 我流忍法！潜龙印 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Akali.passive |
| champion:Akali:spell:AkaliQ | Akali | Q | 我流奥义！寒影 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Akali.spells[0] |
| champion:Akali:spell:AkaliW | Akali | W | 我流奥义！霞阵 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 隐形、不可被选取和能量上限提升不进当前 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Akali.spells[1] |
| champion:Akali:spell:AkaliE | Akali | E | 我流奥义！隼舞 | 命中触发与标记结算 | needs_conversion | mark | mark_state + skill_gate_on_mark | partial | 拆成 E1 / E2；E2 仅在目标带标记时可释放。 | ddragon/16.7.1/zh_CN/championFull.json#data.Akali.spells[2] |
| champion:Akali:spell:AkaliR | Akali | R | 我流秘奥义！表里杀缭乱 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Akali.spells[3] |
| champion:Akshan:passive | Akshan | P | 无所不用 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Akshan.passive |
| champion:Akshan:spell:AkshanQ | Akshan | Q | 去而复还 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Akshan.spells[0] |
| champion:Akshan:spell:AkshanW | Akshan | W | 赴险夺人 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Akshan.spells[1] |
| champion:Akshan:spell:AkshanE | Akshan | E | 骄行荡寇 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Akshan.spells[2] |
| champion:Akshan:spell:AkshanR | Akshan | R | 恩怨相抵 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Akshan.spells[3] |
| champion:Alistar:passive | Alistar | P | 凯旋怒吼 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Alistar.passive |
| champion:Alistar:spell:Pulverize | Alistar | Q | 大地粉碎 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Alistar.spells[0] |
| champion:Alistar:spell:Headbutt | Alistar | W | 野蛮冲撞 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Alistar.spells[1] |
| champion:Alistar:spell:AlistarE | Alistar | E | 践踏 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Alistar.spells[2] |
| champion:Alistar:spell:FerociousHowl | Alistar | R | 坚定意志 | 比例与阈值 | core_1v1 | formula | damage_taken_modifier | partial | 伤害减免可并入公式层；解控部分仍属附带效果。 | ddragon/16.7.1/zh_CN/championFull.json#data.Alistar.spells[3] |
| champion:Ambessa:passive | Ambessa | P | 龙犬诡步 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ambessa.passive |
| champion:Ambessa:spell:AmbessaQ | Ambessa | Q | 暗袭 / 裂斩 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ambessa.spells[0] |
| champion:Ambessa:spell:AmbessaW | Ambessa | W | 铁令 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ambessa.spells[1] |
| champion:Ambessa:spell:AmbessaE | Ambessa | E | 血戮 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ambessa.spells[2] |
| champion:Ambessa:spell:AmbessaR | Ambessa | R | 公开处刑 | 控制效果与锁窗 | core_1v1 | control | control_apply + control_immunity_window | partial | 不可阻挡突进、压制和晕眩都属于主战斗链，不能继续过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ambessa.spells[3] |
| champion:Amumu:passive | Amumu | P | 诅咒之触 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Amumu.passive |
| champion:Amumu:spell:BandageToss | Amumu | Q | 绷带牵引 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Amumu.spells[0] |
| champion:Amumu:spell:AuraofDespair | Amumu | W | 绝望光环 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Amumu.spells[1] |
| champion:Amumu:spell:Tantrum | Amumu | E | 阿木木的愤怒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Amumu.spells[2] |
| champion:Amumu:spell:CurseoftheSadMummy | Amumu | R | 木乃伊之咒 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Amumu.spells[3] |
| champion:Anivia:passive | Anivia | P | 寒霜涅槃 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Anivia.passive |
| champion:Anivia:spell:FlashFrost | Anivia | Q | 寒冰闪耀 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Anivia.spells[0] |
| champion:Anivia:spell:Crystallize | Anivia | W | 寒冰屏障 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Anivia.spells[1] |
| champion:Anivia:spell:Frostbite | Anivia | E | 霜寒刺骨 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Anivia.spells[2] |
| champion:Anivia:spell:GlacialStorm | Anivia | R | 冰川风暴 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Anivia.spells[3] |
| champion:Annie:passive | Annie | P | 嗜火 | 叠层与时效 | core_1v1 | counter | counter_seed + stack_threshold_proc | covered | 起始满层通过 counter_seed 表达。 | ddragon/16.7.1/zh_CN/championFull.json#data.Annie.passive |
| champion:Annie:spell:AnnieQ | Annie | Q | 碎裂之火 | 资源与节奏 | core_1v1 | tempo | refund_cooldown | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Annie.spells[0] |
| champion:Annie:spell:AnnieW | Annie | W | 焚烧 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Annie.spells[1] |
| champion:Annie:spell:AnnieE | Annie | E | 熔岩护盾 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Annie.spells[2] |
| champion:Annie:spell:AnnieR | Annie | R | 提伯斯之怒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Annie.spells[3] |
| champion:Aphelios:passive | Aphelios | P | 传知者与真知者 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Aphelios.passive |
| champion:Aphelios:spell:ApheliosQ_ClientTooltipWrapper | Aphelios | Q | 武器技能 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Aphelios.spells[0] |
| champion:Aphelios:spell:ApheliosW | Aphelios | W | 月相轮转 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 主副武器切换属于 loadout / weapon mode 语义。 | ddragon/16.7.1/zh_CN/championFull.json#data.Aphelios.spells[1] |
| champion:Aphelios:spell:ApheliosE_ClientTooltipWrapper | Aphelios | E | 武器队列系统 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 武器队列系统不进入当前 1v1 公式链。 | ddragon/16.7.1/zh_CN/championFull.json#data.Aphelios.spells[2] |
| champion:Aphelios:spell:ApheliosR | Aphelios | R | 清辉夜凝 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Aphelios.spells[3] |
| champion:Ashe:passive | Ashe | P | 冰霜射击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ashe.passive |
| champion:Ashe:spell:AsheQ | Ashe | Q | 射手的专注 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ashe.spells[0] |
| champion:Ashe:spell:Volley | Ashe | W | 万箭齐发 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ashe.spells[1] |
| champion:Ashe:spell:AsheSpiritOfTheHawk | Ashe | E | 鹰击长空 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ashe.spells[2] |
| champion:Ashe:spell:EnchantedCrystalArrow | Ashe | R | 魔法水晶箭 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ashe.spells[3] |
| champion:AurelionSol:passive | AurelionSol | P | 星海焕然 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.AurelionSol.passive |
| champion:AurelionSol:spell:AurelionSolQ | AurelionSol | Q | 星河冲荡 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.AurelionSol.spells[0] |
| champion:AurelionSol:spell:AurelionSolW | AurelionSol | W | 星穹流丽 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.AurelionSol.spells[1] |
| champion:AurelionSol:spell:AurelionSolE | AurelionSol | E | 星芒凝汇 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.AurelionSol.spells[2] |
| champion:AurelionSol:spell:AurelionSolR | AurelionSol | R | 星天落瀑 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.AurelionSol.spells[3] |
| champion:Aurora:passive | Aurora | P | 驱灵奇术 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Aurora.passive |
| champion:Aurora:spell:AuroraQ | Aurora | Q | 飞去来咒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Aurora.spells[0] |
| champion:Aurora:spell:AuroraW | Aurora | W | 灵纱洞开 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 隐形与参与击杀后重置并存，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Aurora.spells[1] |
| champion:Aurora:spell:AuroraE | Aurora | E | 怪奇喷涌 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Aurora.spells[2] |
| champion:Aurora:spell:AuroraR | Aurora | R | 双界合一 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Aurora.spells[3] |
| champion:Azir:passive | Azir | P | 恕瑞玛的传承 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Azir.passive |
| champion:Azir:spell:AzirQWrapper | Azir | Q | 狂沙猛攻 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Azir.spells[0] |
| champion:Azir:spell:AzirW | Azir | W | 沙兵现身 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Azir.spells[1] |
| champion:Azir:spell:AzirEWrapper | Azir | E | 流沙移形 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Azir.spells[2] |
| champion:Azir:spell:AzirR | Azir | R | 禁军之墙 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Azir.spells[3] |
| champion:Bard:passive | Bard | P | 旅者的召唤 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Bard.passive |
| champion:Bard:spell:BardQ | Bard | Q | 星界束缚 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Bard.spells[0] |
| champion:Bard:spell:BardW | Bard | W | 游神圣坛 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Bard.spells[1] |
| champion:Bard:spell:BardE | Bard | E | 神奇旅程 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Bard.spells[2] |
| champion:Bard:spell:BardR | Bard | R | 调和命运 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Bard.spells[3] |
| champion:Belveth:passive | Belveth | P | 溶烛化紫 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Belveth.passive |
| champion:Belveth:spell:BelvethQ | Belveth | Q | 虚空激流 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Belveth.spells[0] |
| champion:Belveth:spell:BelvethW | Belveth | W | 上觐沉渊 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Belveth.spells[1] |
| champion:Belveth:spell:BelvethE | Belveth | E | 搠面皇锋 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Belveth.spells[2] |
| champion:Belveth:spell:BelvethR | Belveth | R | 万载豪筵 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Belveth.spells[3] |
| champion:Blitzcrank:passive | Blitzcrank | P | 法力屏障 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Blitzcrank.passive |
| champion:Blitzcrank:spell:RocketGrab | Blitzcrank | Q | 机械飞爪 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Blitzcrank.spells[0] |
| champion:Blitzcrank:spell:Overdrive | Blitzcrank | W | 过载运转 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Blitzcrank.spells[1] |
| champion:Blitzcrank:spell:PowerFist | Blitzcrank | E | 能量铁拳 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Blitzcrank.spells[2] |
| champion:Blitzcrank:spell:StaticField | Blitzcrank | R | 静电力场 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Blitzcrank.spells[3] |
| champion:Brand:passive | Brand | P | 炽热之焰 | 叠层与时效 | core_1v1 | counter | counter_state + stack_threshold_proc + periodic_proc | partial | 叠层、持续灼烧与满层后爆裂需要组合表达。 | ddragon/16.7.1/zh_CN/championFull.json#data.Brand.passive |
| champion:Brand:spell:BrandQ | Brand | Q | 火焰烙印 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Brand.spells[0] |
| champion:Brand:spell:BrandW | Brand | W | 烈焰之柱 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Brand.spells[1] |
| champion:Brand:spell:BrandE | Brand | E | 烈火燃烧 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Brand.spells[2] |
| champion:Brand:spell:BrandR | Brand | R | 烈焰风暴 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Brand.spells[3] |
| champion:Braum:passive | Braum | P | 震荡猛击 | 叠层与时效 | core_1v1 | counter | counter_state + stack_threshold_proc + lockout_window | partial | 目标级计数器，第 4 层触发后进入短锁窗。 | ddragon/16.7.1/zh_CN/championFull.json#data.Braum.passive |
| champion:Braum:spell:BraumQ | Braum | Q | 寒冬之咬 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Braum.spells[0] |
| champion:Braum:spell:BraumW | Braum | W | 挺身而出 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Braum.spells[1] |
| champion:Braum:spell:BraumE | Braum | E | 坚不可摧 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Braum.spells[2] |
| champion:Braum:spell:BraumRWrapper | Braum | R | 冰川裂隙 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Braum.spells[3] |
| champion:Briar:passive | Briar | P | 猩红诅咒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Briar.passive |
| champion:Briar:spell:BriarQ | Briar | Q | 冲头 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Briar.spells[0] |
| champion:Briar:spell:BriarW | Briar | W | 血莽 / 噬击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Briar.spells[1] |
| champion:Briar:spell:BriarE | Briar | E | 惊吼 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Briar.spells[2] |
| champion:Briar:spell:BriarR | Briar | R | 毙除 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Briar.spells[3] |
| champion:Caitlyn:passive | Caitlyn | P | 爆头 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Caitlyn.passive |
| champion:Caitlyn:spell:CaitlynQ | Caitlyn | Q | 和平使者 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Caitlyn.spells[0] |
| champion:Caitlyn:spell:CaitlynW | Caitlyn | W | 约德尔诱捕器 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Caitlyn.spells[1] |
| champion:Caitlyn:spell:CaitlynE | Caitlyn | E | 90口径绳网 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Caitlyn.spells[2] |
| champion:Caitlyn:spell:CaitlynR | Caitlyn | R | 让子弹飞 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Caitlyn.spells[3] |
| champion:Camille:passive | Camille | P | 适应性防御 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Camille.passive |
| champion:Camille:spell:CamilleQ | Camille | Q | 精准礼仪 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Camille.spells[0] |
| champion:Camille:spell:CamilleW | Camille | W | 战术横扫 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Camille.spells[1] |
| champion:Camille:spell:CamilleE | Camille | E | 钩索 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Camille.spells[2] |
| champion:Camille:spell:CamilleR | Camille | R | 海克斯最后通牒 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Camille.spells[3] |
| champion:Cassiopeia:passive | Cassiopeia | P | 优雅蛇行 | 属性派生与穿透顺序 | core_1v1 | attr | derived_stat_from_attrs | partial | 移动速度加成效率修正更像属性派生倍率。 | ddragon/16.7.1/zh_CN/championFull.json#data.Cassiopeia.passive |
| champion:Cassiopeia:spell:CassiopeiaQ | Cassiopeia | Q | 瘟毒爆炸 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Cassiopeia.spells[0] |
| champion:Cassiopeia:spell:CassiopeiaW | Cassiopeia | W | 剧毒迷雾 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Cassiopeia.spells[1] |
| champion:Cassiopeia:spell:CassiopeiaE | Cassiopeia | E | 双生毒牙 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Cassiopeia.spells[2] |
| champion:Cassiopeia:spell:CassiopeiaR | Cassiopeia | R | 石化凝视 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Cassiopeia.spells[3] |
| champion:Chogath:passive | Chogath | P | 肉食者 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Chogath.passive |
| champion:Chogath:spell:Rupture | Chogath | Q | 破裂 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Chogath.spells[0] |
| champion:Chogath:spell:FeralScream | Chogath | W | 野性尖叫 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Chogath.spells[1] |
| champion:Chogath:spell:VorpalSpikes | Chogath | E | 恐惧之刺 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Chogath.spells[2] |
| champion:Chogath:spell:Feast | Chogath | R | 盛宴 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Chogath.spells[3] |
| champion:Corki:passive | Corki | P | 海克斯科技军备 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Corki.passive |
| champion:Corki:spell:PhosphorusBomb | Corki | Q | 磷光炸弹 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Corki.spells[0] |
| champion:Corki:spell:CarpetBomb | Corki | W | 瓦尔基里俯冲 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Corki.spells[1] |
| champion:Corki:spell:GGun | Corki | E | 格林机枪 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Corki.spells[2] |
| champion:Corki:spell:MissileBarrage | Corki | R | 火箭轰击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Corki.spells[3] |
| champion:Darius:passive | Darius | P | 出血 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Darius.passive |
| champion:Darius:spell:DariusCleave | Darius | Q | 大杀四方 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Darius.spells[0] |
| champion:Darius:spell:DariusNoxianTacticsONH | Darius | W | 致残打击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Darius.spells[1] |
| champion:Darius:spell:DariusAxeGrabCone | Darius | E | 无情铁手 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Darius.spells[2] |
| champion:Darius:spell:DariusExecute | Darius | R | 诺克萨斯断头台 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Darius.spells[3] |
| champion:Diana:passive | Diana | P | 月银之刃 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Diana.passive |
| champion:Diana:spell:DianaQ | Diana | Q | 新月打击 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Diana.spells[0] |
| champion:Diana:spell:DianaOrbs | Diana | W | 苍白之瀑 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Diana.spells[1] |
| champion:Diana:spell:DianaTeleport | Diana | E | 月神冲刺 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Diana.spells[2] |
| champion:Diana:spell:DianaR | Diana | R | 月之降临 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Diana.spells[3] |
| champion:Draven:passive | Draven | P | 德莱文联盟 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Draven.passive |
| champion:Draven:spell:DravenSpinning | Draven | Q | 旋转飞斧 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Draven.spells[0] |
| champion:Draven:spell:DravenFury | Draven | W | 血性冲刺 | 资源与节奏 | needs_conversion | tempo | refund_cooldown | partial | 接住飞斧会刷新冷却，且同时提供移速与攻速。 | ddragon/16.7.1/zh_CN/championFull.json#data.Draven.spells[1] |
| champion:Draven:spell:DravenDoubleShot | Draven | E | 开道利斧 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Draven.spells[2] |
| champion:Draven:spell:DravenRCast | Draven | R | 冷血追命 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Draven.spells[3] |
| champion:DrMundo:passive | DrMundo | P | 想去哪就去哪 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.DrMundo.passive |
| champion:DrMundo:spell:DrMundoQ | DrMundo | Q | 病毒屠刀 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.DrMundo.spells[0] |
| champion:DrMundo:spell:DrMundoW | DrMundo | W | 电击疗法 | 历史值与时间窗口 | core_1v1 | history | gray_health_window + recast_burst | partial | 最近承伤会转入灰色生命值，再通过二段施放转成爆发与治疗。 | ddragon/16.7.1/zh_CN/championFull.json#data.DrMundo.spells[1] |
| champion:DrMundo:spell:DrMundoE | DrMundo | E | 大力行医 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.DrMundo.spells[2] |
| champion:DrMundo:spell:DrMundoR | DrMundo | R | 极限剂量 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.DrMundo.spells[3] |
| champion:Ekko:passive | Ekko | P | Z型驱动共振 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ekko.passive |
| champion:Ekko:spell:EkkoQ | Ekko | Q | 时间卷曲器 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ekko.spells[0] |
| champion:Ekko:spell:EkkoW | Ekko | W | 时光交错 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ekko.spells[1] |
| champion:Ekko:spell:EkkoE | Ekko | E | 相位俯冲 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ekko.spells[2] |
| champion:Ekko:spell:EkkoR | Ekko | R | 时空断裂 | 历史值与时间窗口 | core_1v1 | history | state_snapshot_rewind | partial | 需要读取过去数秒的位置与生命值快照，再回溯并结算治疗。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ekko.spells[3] |
| champion:Elise:passive | Elise | P | 蜘蛛女皇 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Elise.passive |
| champion:Elise:spell:EliseHumanQ | Elise | Q | 神经毒素 / 剧毒之蜇 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Elise.spells[0] |
| champion:Elise:spell:EliseHumanW | Elise | W | 自爆蜘蛛 / 掠行狂暴 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Elise.spells[1] |
| champion:Elise:spell:EliseHumanE | Elise | E | 结茧 / 盘丝 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Elise.spells[2] |
| champion:Elise:spell:EliseR | Elise | R | 蜘蛛形态 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Elise.spells[3] |
| champion:Evelynn:passive | Evelynn | P | 恶魔魅影 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Evelynn.passive |
| champion:Evelynn:spell:EvelynnQ | Evelynn | Q | 憎恨之刺 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Evelynn.spells[0] |
| champion:Evelynn:spell:EvelynnW | Evelynn | W | 引诱 | 命中触发与标记结算 | needs_conversion | mark | mark_state + mark_arm + mark_consume | covered | 按主收益线建模，默认成熟前不主动打破印记。 | ddragon/16.7.1/zh_CN/championFull.json#data.Evelynn.spells[1] |
| champion:Evelynn:spell:EvelynnE | Evelynn | E | 鞭笞 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Evelynn.spells[2] |
| champion:Evelynn:spell:EvelynnR | Evelynn | R | 最终抚慰 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Evelynn.spells[3] |
| champion:Ezreal:passive | Ezreal | P | 咒能高涨 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ezreal.passive |
| champion:Ezreal:spell:EzrealQ | Ezreal | Q | 秘术射击 | 资源与节奏 | core_1v1 | tempo | refund_cooldown | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ezreal.spells[0] |
| champion:Ezreal:spell:EzrealW | Ezreal | W | 精华跃动 | 命中触发与标记结算 | core_1v1 | mark | mark_state + mark_consume | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ezreal.spells[1] |
| champion:Ezreal:spell:EzrealE | Ezreal | E | 奥术跃迁 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ezreal.spells[2] |
| champion:Ezreal:spell:EzrealR | Ezreal | R | 精准弹幕 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ezreal.spells[3] |
| champion:Fiddlesticks:passive | Fiddlesticks | P | 巫骇草人 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 草人替身与扫描类语义不进当前主链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Fiddlesticks.passive |
| champion:Fiddlesticks:spell:FiddleSticksQ | Fiddlesticks | Q | 恐惧 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Fiddlesticks.spells[0] |
| champion:Fiddlesticks:spell:FiddleSticksW | Fiddlesticks | W | 五骨丰登 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Fiddlesticks.spells[1] |
| champion:Fiddlesticks:spell:FiddleSticksE | Fiddlesticks | E | 夜割 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Fiddlesticks.spells[2] |
| champion:Fiddlesticks:spell:FiddleSticksR | Fiddlesticks | R | 群鸦风暴 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Fiddlesticks.spells[3] |
| champion:Fiora:passive | Fiora | P | 决斗之舞 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Fiora.passive |
| champion:Fiora:spell:FioraQ | Fiora | Q | 破空斩 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Fiora.spells[0] |
| champion:Fiora:spell:FioraW | Fiora | W | 劳伦特心眼刀 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Fiora.spells[1] |
| champion:Fiora:spell:FioraE | Fiora | E | 夺命连刺 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Fiora.spells[2] |
| champion:Fiora:spell:FioraR | Fiora | R | 无双挑战 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Fiora.spells[3] |
| champion:Fizz:passive | Fizz | P | 伶俐斗士 | 比例与阈值 | core_1v1 | formula | damage_taken_modifier | covered | 固定减伤可直接落入公式层。 | ddragon/16.7.1/zh_CN/championFull.json#data.Fizz.passive |
| champion:Fizz:spell:FizzQ | Fizz | Q | 淘气打击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Fizz.spells[0] |
| champion:Fizz:spell:FizzW | Fizz | W | 海石三叉戟 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Fizz.spells[1] |
| champion:Fizz:spell:FizzE | Fizz | E | 古灵/精怪 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Fizz.spells[2] |
| champion:Fizz:spell:FizzR | Fizz | R | 巨鲨强袭 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Fizz.spells[3] |
| champion:Galio:passive | Galio | P | 巨像重击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Galio.passive |
| champion:Galio:spell:GalioQ | Galio | Q | 战争罡风 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Galio.spells[0] |
| champion:Galio:spell:GalioW | Galio | W | 杜朗护盾 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Galio.spells[1] |
| champion:Galio:spell:GalioE | Galio | E | 正义冲拳 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Galio.spells[2] |
| champion:Galio:spell:GalioR | Galio | R | 英雄登场 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Galio.spells[3] |
| champion:Gangplank:passive | Gangplank | P | 烈火审讯 | 叠层与时效 | core_1v1 | counter | periodic_proc | partial | 周期就绪后的下次近战攻击点燃目标。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gangplank.passive |
| champion:Gangplank:spell:GangplankQWrapper | Gangplank | Q | 枪火谈判 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gangplank.spells[0] |
| champion:Gangplank:spell:GangplankW | Gangplank | W | 坏血病疗法 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gangplank.spells[1] |
| champion:Gangplank:spell:GangplankE | Gangplank | E | 火药桶 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gangplank.spells[2] |
| champion:Gangplank:spell:GangplankR | Gangplank | R | 加农炮幕 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gangplank.spells[3] |
| champion:Garen:passive | Garen | P | 坚韧 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Garen.passive |
| champion:Garen:spell:GarenQ | Garen | Q | 致命打击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Garen.spells[0] |
| champion:Garen:spell:GarenW | Garen | W | 勇气 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Garen.spells[1] |
| champion:Garen:spell:GarenE | Garen | E | 审判 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Garen.spells[2] |
| champion:Garen:spell:GarenR | Garen | R | 德玛西亚正义 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Garen.spells[3] |
| champion:Gnar:passive | Gnar | P | 狂怒基因 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 怒气到阈值后变身属于形态切换。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gnar.passive |
| champion:Gnar:spell:GnarQ | Gnar | Q | 投掷回力标 / 投掷顽石 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gnar.spells[0] |
| champion:Gnar:spell:GnarW | Gnar | W | 亢奋 /  痛殴 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gnar.spells[1] |
| champion:Gnar:spell:GnarE | Gnar | E | 轻跳 / 猛踏 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Gnar.spells[2] |
| champion:Gnar:spell:GnarR | Gnar | R | 呐啊！ | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Gnar.spells[3] |
| champion:Gragas:passive | Gragas | P | 欢乐时光 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gragas.passive |
| champion:Gragas:spell:GragasQ | Gragas | Q | 滚动酒桶 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Gragas.spells[0] |
| champion:Gragas:spell:GragasW | Gragas | W | 醉酒狂暴 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Gragas.spells[1] |
| champion:Gragas:spell:GragasE | Gragas | E | 肉弹冲击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gragas.spells[2] |
| champion:Gragas:spell:GragasR | Gragas | R | 爆破酒桶 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Gragas.spells[3] |
| champion:Graves:passive | Graves | P | 新命运 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Graves.passive |
| champion:Graves:spell:GravesQLineSpell | Graves | Q | 穷途末路 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Graves.spells[0] |
| champion:Graves:spell:GravesSmokeGrenade | Graves | W | 烟幕弹 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Graves.spells[1] |
| champion:Graves:spell:GravesMove | Graves | E | 快速拔枪 | 资源与节奏 | core_1v1 | tempo | refund_cooldown | partial | 命中会缩短冷却并刷新防御属性，不属于最近承伤记忆。 | ddragon/16.7.1/zh_CN/championFull.json#data.Graves.spells[2] |
| champion:Graves:spell:GravesChargeShot | Graves | R | 终极爆弹 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Graves.spells[3] |
| champion:Gwen:passive | Gwen | P | 千穿百孔 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Gwen.passive |
| champion:Gwen:spell:GwenQ | Gwen | Q | 快刀剪乱 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gwen.spells[0] |
| champion:Gwen:spell:GwenW | Gwen | W | 丝缕缠流 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gwen.spells[1] |
| champion:Gwen:spell:GwenE | Gwen | E | 断续疾走 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gwen.spells[2] |
| champion:Gwen:spell:GwenR | Gwen | R | 引针簇射 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Gwen.spells[3] |
| champion:Hecarim:passive | Hecarim | P | 征战之路 | 属性派生与穿透顺序 | core_1v1 | attr | derived_stat_from_attrs | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Hecarim.passive |
| champion:Hecarim:spell:HecarimRapidSlash | Hecarim | Q | 暴走 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Hecarim.spells[0] |
| champion:Hecarim:spell:HecarimW | Hecarim | W | 恐惧之灵 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Hecarim.spells[1] |
| champion:Hecarim:spell:HecarimRamp | Hecarim | E | 毁灭冲锋 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Hecarim.spells[2] |
| champion:Hecarim:spell:HecarimUlt | Hecarim | R | 暗影冲击 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Hecarim.spells[3] |
| champion:Heimerdinger:passive | Heimerdinger | P | 海克斯科技亲和 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 与炮台邻近相关的移速不进当前主链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Heimerdinger.passive |
| champion:Heimerdinger:spell:HeimerdingerQ | Heimerdinger | Q | H-28 G 进化炮台 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Heimerdinger.spells[0] |
| champion:Heimerdinger:spell:HeimerdingerW | Heimerdinger | W | 海克斯科技微型导弹 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Heimerdinger.spells[1] |
| champion:Heimerdinger:spell:HeimerdingerE | Heimerdinger | E | CH-2电子风暴手雷 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Heimerdinger.spells[2] |
| champion:Heimerdinger:spell:HeimerdingerR | Heimerdinger | R | 升级！！！ | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 核心语义是下一个基础技能升级，不是黑默丁格本人进入控制免疫窗口。 | ddragon/16.7.1/zh_CN/championFull.json#data.Heimerdinger.spells[3] |
| champion:Hwei:passive | Hwei | P | 落款 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Hwei.passive |
| champion:Hwei:spell:HweiQ | Hwei | Q | 主题：灾 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Hwei.spells[0] |
| champion:Hwei:spell:HweiW | Hwei | W | 主题：靖 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Hwei.spells[1] |
| champion:Hwei:spell:HweiE | Hwei | E | 主题：悚 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Hwei.spells[2] |
| champion:Hwei:spell:HweiR | Hwei | R | 焚心绚华绘 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Hwei.spells[3] |
| champion:Illaoi:passive | Illaoi | P | 古神先知 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Illaoi.passive |
| champion:Illaoi:spell:IllaoiQ | Illaoi | Q | 触手猛击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Illaoi.spells[0] |
| champion:Illaoi:spell:IllaoiW | Illaoi | W | 严酷训诫 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Illaoi.spells[1] |
| champion:Illaoi:spell:IllaoiE | Illaoi | E | 灵魂试炼 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Illaoi.spells[2] |
| champion:Illaoi:spell:IllaoiR | Illaoi | R | 过界信仰 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Illaoi.spells[3] |
| champion:Irelia:passive | Irelia | P | 艾欧尼亚热诚 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Irelia.passive |
| champion:Irelia:spell:IreliaQ | Irelia | Q | 利刃冲击 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Irelia.spells[0] |
| champion:Irelia:spell:IreliaW | Irelia | W | 距破之舞 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Irelia.spells[1] |
| champion:Irelia:spell:IreliaE | Irelia | E | 比翼双刃 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Irelia.spells[2] |
| champion:Irelia:spell:IreliaR | Irelia | R | 先锋之刃 | 命中触发与标记结算 | core_1v1 | mark | mark_state + mark_refresh_or_unlock | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Irelia.spells[3] |
| champion:Ivern:passive | Ivern | P | 森林之友 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ivern.passive |
| champion:Ivern:spell:IvernQ | Ivern | Q | 根深敌固 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ivern.spells[0] |
| champion:Ivern:spell:IvernW | Ivern | W | 揠苗助攻 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ivern.spells[1] |
| champion:Ivern:spell:IvernE | Ivern | E | 种豆得瓜 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ivern.spells[2] |
| champion:Ivern:spell:IvernR | Ivern | R | 小菊！ | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ivern.spells[3] |
| champion:Janna:passive | Janna | P | 顺风而行 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Janna.passive |
| champion:Janna:spell:HowlingGale | Janna | Q | 飓风呼啸 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Janna.spells[0] |
| champion:Janna:spell:SowTheWind | Janna | W | 和风守护 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Janna.spells[1] |
| champion:Janna:spell:EyeOfTheStorm | Janna | E | 风暴之眼 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Janna.spells[2] |
| champion:Janna:spell:ReapTheWhirlwind | Janna | R | 复苏季风 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Janna.spells[3] |
| champion:JarvanIV:passive | JarvanIV | P | 战争律动 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.JarvanIV.passive |
| champion:JarvanIV:spell:JarvanIVDragonStrike | JarvanIV | Q | 巨龙撞击 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.JarvanIV.spells[0] |
| champion:JarvanIV:spell:JarvanIVGoldenAegis | JarvanIV | W | 黄金圣盾 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.JarvanIV.spells[1] |
| champion:JarvanIV:spell:JarvanIVDemacianStandard | JarvanIV | E | 德邦军旗 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.JarvanIV.spells[2] |
| champion:JarvanIV:spell:JarvanIVCataclysm | JarvanIV | R | 天崩地裂 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.JarvanIV.spells[3] |
| champion:Jax:passive | Jax | P | 无情连打 | 叠层与时效 | core_1v1 | counter | counter_state + stack_to_stat | partial | 连续普攻叠加攻速。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jax.passive |
| champion:Jax:spell:JaxQ | Jax | Q | 跳斩 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jax.spells[0] |
| champion:Jax:spell:JaxW | Jax | W | 蓄力一击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jax.spells[1] |
| champion:Jax:spell:JaxE | Jax | E | 反击风暴 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jax.spells[2] |
| champion:Jax:spell:JaxR | Jax | R | 武器大师 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jax.spells[3] |
| champion:Jayce:passive | Jayce | P | 海克斯科技电容 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | partial | 切换武器后短暂获得移速。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jayce.passive |
| champion:Jayce:spell:JayceToTheSkies | Jayce | Q | 苍穹之跃 / 电能震荡 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jayce.spells[0] |
| champion:Jayce:spell:JayceStaticField | Jayce | W | 闪电领域 / 超能电荷 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jayce.spells[1] |
| champion:Jayce:spell:JayceThunderingBlow | Jayce | E | 雷霆一击 / 加速之门 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jayce.spells[2] |
| champion:Jayce:spell:JayceStanceHtG | Jayce | R | 墨丘利之炮 / 墨丘利之锤 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jayce.spells[3] |
| champion:Jhin:passive | Jhin | P | 低语 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jhin.passive |
| champion:Jhin:spell:JhinQ | Jhin | Q | 曼舞手雷 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jhin.spells[0] |
| champion:Jhin:spell:JhinW | Jhin | W | 致命华彩 | 控制效果与锁窗 | needs_conversion | control | control_apply | partial | 主效果是远程伤害加禁锢；禁锢前置条件需要 recent damage gate，且 ally/trap 分支后续再拆。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jhin.spells[1] |
| champion:Jhin:spell:JhinE | Jhin | E | 万众倾倒 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jhin.spells[2] |
| champion:Jhin:spell:JhinR | Jhin | R | 完美谢幕 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jhin.spells[3] |
| champion:Jinx:passive | Jinx | P | 罪恶快感 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 击杀、史诗野怪和建筑触发的狂热属于事件层。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jinx.passive |
| champion:Jinx:spell:JinxQ | Jinx | Q | 枪炮交响曲！ | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Jinx.spells[0] |
| champion:Jinx:spell:JinxW | Jinx | W | 震荡电磁波！ | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jinx.spells[1] |
| champion:Jinx:spell:JinxE | Jinx | E | 嚼火者手雷！ | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jinx.spells[2] |
| champion:Jinx:spell:JinxR | Jinx | R | 超究极死神飞弹！ | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Jinx.spells[3] |
| champion:Kaisa:passive | Kaisa | P | 体表活肤 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kaisa.passive |
| champion:Kaisa:spell:KaisaQ | Kaisa | Q | 艾卡西亚暴雨 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kaisa.spells[0] |
| champion:Kaisa:spell:KaisaW | Kaisa | W | 虚空索敌 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kaisa.spells[1] |
| champion:Kaisa:spell:KaisaE | Kaisa | E | 极限超载 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kaisa.spells[2] |
| champion:Kaisa:spell:KaisaR | Kaisa | R | 猎手本能 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kaisa.spells[3] |
| champion:Kalista:passive | Kalista | P | 武术姿态 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kalista.passive |
| champion:Kalista:spell:KalistaMysticShot | Kalista | Q | 穿刺 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kalista.spells[0] |
| champion:Kalista:spell:KalistaW | Kalista | W | 哨兵 | 控制效果与锁窗 | core_1v1 | control | per_target_lockout | partial | 每目标冷却与重复施放锁窗应单独保留。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kalista.spells[1] |
| champion:Kalista:spell:KalistaExpungeWrapper | Kalista | E | 撕裂 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kalista.spells[2] |
| champion:Kalista:spell:KalistaRx | Kalista | R | 命运的召唤 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kalista.spells[3] |
| champion:Karma:passive | Karma | P | 聚能之炎 | 资源与节奏 | core_1v1 | tempo | refund_cooldown | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Karma.passive |
| champion:Karma:spell:KarmaQ | Karma | Q | 心灵烈焰 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Karma.spells[0] |
| champion:Karma:spell:KarmaSpiritBind | Karma | W | 坚定不移 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Karma.spells[1] |
| champion:Karma:spell:KarmaSolKimShield | Karma | E | 鼓舞 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Karma.spells[2] |
| champion:Karma:spell:KarmaMantra | Karma | R | 梵咒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Karma.spells[3] |
| champion:Karthus:passive | Karthus | P | 死亡契约 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 死亡后继续施法属于生命周期钩子。 | ddragon/16.7.1/zh_CN/championFull.json#data.Karthus.passive |
| champion:Karthus:spell:KarthusLayWasteA1 | Karthus | Q | 荒芜 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Karthus.spells[0] |
| champion:Karthus:spell:KarthusWallOfPain | Karthus | W | 痛苦之墙 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Karthus.spells[1] |
| champion:Karthus:spell:KarthusDefile | Karthus | E | 亵渎 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Karthus.spells[2] |
| champion:Karthus:spell:KarthusFallenOne | Karthus | R | 安魂曲 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Karthus.spells[3] |
| champion:Kassadin:passive | Kassadin | P | 虚空之石 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kassadin.passive |
| champion:Kassadin:spell:NullLance | Kassadin | Q | 虚无法球 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kassadin.spells[0] |
| champion:Kassadin:spell:NetherBlade | Kassadin | W | 虚空之刃 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kassadin.spells[1] |
| champion:Kassadin:spell:ForcePulse | Kassadin | E | 能量脉冲 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kassadin.spells[2] |
| champion:Kassadin:spell:RiftWalk | Kassadin | R | 虚空行走 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kassadin.spells[3] |
| champion:Katarina:passive | Katarina | P | 贪婪 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Katarina.passive |
| champion:Katarina:spell:KatarinaQ | Katarina | Q | 弹射之刃 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Katarina.spells[0] |
| champion:Katarina:spell:KatarinaW | Katarina | W | 伺机待发 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Katarina.spells[1] |
| champion:Katarina:spell:KatarinaEWrapper | Katarina | E | 瞬步 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Katarina.spells[2] |
| champion:Katarina:spell:KatarinaR | Katarina | R | 死亡莲华 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Katarina.spells[3] |
| champion:Kayle:passive | Kayle | P | 登神长阶 | 叠层与时效 | core_1v1 | counter | counter_state + stack_to_stat | partial | 等级与层数共同驱动攻速、移速、射程和焰浪增强。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kayle.passive |
| champion:Kayle:spell:KayleQ | Kayle | Q | 耀焰冲击 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kayle.spells[0] |
| champion:Kayle:spell:KayleW | Kayle | W | 星界恩典 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kayle.spells[1] |
| champion:Kayle:spell:KayleE | Kayle | E | 星火符刃 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kayle.spells[2] |
| champion:Kayle:spell:KayleR | Kayle | R | 圣裁之刻 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kayle.spells[3] |
| champion:Kayn:passive | Kayn | P | 暗裔魔镰 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kayn.passive |
| champion:Kayn:spell:KaynQ | Kayn | Q | 巨镰横扫 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kayn.spells[0] |
| champion:Kayn:spell:KaynW | Kayn | W | 利刃纵贯 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kayn.spells[1] |
| champion:Kayn:spell:KaynE | Kayn | E | 掠影步 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kayn.spells[2] |
| champion:Kayn:spell:KaynR | Kayn | R | 裂舍影 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kayn.spells[3] |
| champion:Kennen:passive | Kennen | P | 【忍法！雷缚印】 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kennen.passive |
| champion:Kennen:spell:KennenShurikenHurlMissile1 | Kennen | Q | 奥义！千鸟 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kennen.spells[0] |
| champion:Kennen:spell:KennenBringTheLight | Kennen | W | 奥义！电刃 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kennen.spells[1] |
| champion:Kennen:spell:KennenLightningRush | Kennen | E | 奥义！雷铠 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kennen.spells[2] |
| champion:Kennen:spell:KennenShurikenStorm | Kennen | R | 秘奥义！万雷天牢引 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kennen.spells[3] |
| champion:Khazix:passive | Khazix | P | 无形威胁 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Khazix.passive |
| champion:Khazix:spell:KhazixQ | Khazix | Q | 品尝恐惧 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Khazix.spells[0] |
| champion:Khazix:spell:KhazixW | Khazix | W | 虚空突刺 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Khazix.spells[1] |
| champion:Khazix:spell:KhazixE | Khazix | E | 跃击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Khazix.spells[2] |
| champion:Khazix:spell:KhazixR | Khazix | R | 虚空来袭 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Khazix.spells[3] |
| champion:Kindred:passive | Kindred | P | 千珏之印 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kindred.passive |
| champion:Kindred:spell:KindredQ | Kindred | Q | 乱箭之舞 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kindred.spells[0] |
| champion:Kindred:spell:KindredW | Kindred | W | 狼灵狂热 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kindred.spells[1] |
| champion:Kindred:spell:KindredEWrapper | Kindred | E | 横生惧意 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kindred.spells[2] |
| champion:Kindred:spell:KindredR | Kindred | R | 羊灵生息 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kindred.spells[3] |
| champion:Kled:passive | Kled | P | 怯战蜥蜴斯嘎尔 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kled.passive |
| champion:Kled:spell:KledQ | Kled | Q | 飞索捕熊器 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kled.spells[0] |
| champion:Kled:spell:KledW | Kled | W | 暴烈秉性 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Kled.spells[1] |
| champion:Kled:spell:KledE | Kled | E | 比武 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kled.spells[2] |
| champion:Kled:spell:KledR | Kled | R | 冲啊——！！ | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Kled.spells[3] |
| champion:KogMaw:passive | KogMaw | P | 来自艾卡西亚的惊喜 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.KogMaw.passive |
| champion:KogMaw:spell:KogMawQ | KogMaw | Q | 腐蚀唾液 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.KogMaw.spells[0] |
| champion:KogMaw:spell:KogMawBioArcaneBarrage | KogMaw | W | 生化弹幕 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.KogMaw.spells[1] |
| champion:KogMaw:spell:KogMawVoidOoze | KogMaw | E | 虚空淤泥 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.KogMaw.spells[2] |
| champion:KogMaw:spell:KogMawLivingArtillery | KogMaw | R | 活体大炮 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.KogMaw.spells[3] |
| champion:KSante:passive | KSante | P | 血性本能 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.KSante.passive |
| champion:KSante:spell:KSanteQ | KSante | Q | 无双陀斧 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.KSante.spells[0] |
| champion:KSante:spell:KSanteW | KSante | W | 辟路先锋 | 控制效果与锁窗 | core_1v1 | control | control_immunity_window | partial | 先显式保留霸体、不可阻挡和控制免疫窗口语义。 | ddragon/16.7.1/zh_CN/championFull.json#data.KSante.spells[1] |
| champion:KSante:spell:KSanteE | KSante | E | 大步驰援 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.KSante.spells[2] |
| champion:KSante:spell:KSanteR | KSante | R | 傲岸雄姿 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.KSante.spells[3] |
| champion:Leblanc:passive | Leblanc | P | 镜花水月 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Leblanc.passive |
| champion:Leblanc:spell:LeblancQ | Leblanc | Q | 恶意魔印 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Leblanc.spells[0] |
| champion:Leblanc:spell:LeblancW | Leblanc | W | 魔影迷踪 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Leblanc.spells[1] |
| champion:Leblanc:spell:LeblancE | Leblanc | E | 幻影锁链 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Leblanc.spells[2] |
| champion:Leblanc:spell:LeblancR | Leblanc | R | 故技重施 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Leblanc.spells[3] |
| champion:LeeSin:passive | LeeSin | P | 疾风骤雨 | 资源与节奏 | core_1v1 | tempo | resource_gate | partial | 技能后两次攻击返还能量并提供攻速。 | ddragon/16.7.1/zh_CN/championFull.json#data.LeeSin.passive |
| champion:LeeSin:spell:LeeSinQOne | LeeSin | Q | 天音波/回音击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.LeeSin.spells[0] |
| champion:LeeSin:spell:LeeSinWOne | LeeSin | W | 金钟罩/铁布衫 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.LeeSin.spells[1] |
| champion:LeeSin:spell:LeeSinEOne | LeeSin | E | 天雷破/摧筋断骨 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.LeeSin.spells[2] |
| champion:LeeSin:spell:LeeSinR | LeeSin | R | 猛龙摆尾 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.LeeSin.spells[3] |
| champion:Leona:passive | Leona | P | 日光 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Leona.passive |
| champion:Leona:spell:LeonaShieldOfDaybreak | Leona | Q | 破晓之盾 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Leona.spells[0] |
| champion:Leona:spell:LeonaSolarBarrier | Leona | W | 日蚀 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Leona.spells[1] |
| champion:Leona:spell:LeonaZenithBlade | Leona | E | 天顶之刃 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Leona.spells[2] |
| champion:Leona:spell:LeonaSolarFlare | Leona | R | 日炎耀斑 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Leona.spells[3] |
| champion:Lillia:passive | Lillia | P | 梦满枝 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lillia.passive |
| champion:Lillia:spell:LilliaQ | Lillia | Q | 飞花挞 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lillia.spells[0] |
| champion:Lillia:spell:LilliaW | Lillia | W | 惊惶木 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lillia.spells[1] |
| champion:Lillia:spell:LilliaE | Lillia | E | 流涡种 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lillia.spells[2] |
| champion:Lillia:spell:LilliaR | Lillia | R | 夜阑谣 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lillia.spells[3] |
| champion:Lissandra:passive | Lissandra | P | 冰脉驱役 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lissandra.passive |
| champion:Lissandra:spell:LissandraQ | Lissandra | Q | 寒冰碎片 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lissandra.spells[0] |
| champion:Lissandra:spell:LissandraW | Lissandra | W | 冰霜之环 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lissandra.spells[1] |
| champion:Lissandra:spell:LissandraE | Lissandra | E | 冰川之径 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lissandra.spells[2] |
| champion:Lissandra:spell:LissandraR | Lissandra | R | 冰封陵墓 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lissandra.spells[3] |
| champion:Lucian:passive | Lucian | P | 圣光银弹 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lucian.passive |
| champion:Lucian:spell:LucianQ | Lucian | Q | 透体圣光 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lucian.spells[0] |
| champion:Lucian:spell:LucianW | Lucian | W | 热诚烈弹 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lucian.spells[1] |
| champion:Lucian:spell:LucianE | Lucian | E | 冷酷追击 | 资源与节奏 | core_1v1 | tempo | refund_cooldown | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lucian.spells[2] |
| champion:Lucian:spell:LucianR | Lucian | R | 圣枪洗礼 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lucian.spells[3] |
| champion:Lulu:passive | Lulu | P | 皮克斯，仙灵伙伴 | 命中触发与标记结算 | core_1v1 | trigger | on_hit_proc | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lulu.passive |
| champion:Lulu:spell:LuluQ | Lulu | Q | 闪耀长枪 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lulu.spells[0] |
| champion:Lulu:spell:LuluW | Lulu | W | 奇思妙想 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lulu.spells[1] |
| champion:Lulu:spell:LuluE | Lulu | E | 帮忙，皮克斯！ | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lulu.spells[2] |
| champion:Lulu:spell:LuluR | Lulu | R | 狂野生长 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lulu.spells[3] |
| champion:Lux:passive | Lux | P | 光芒四射 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lux.passive |
| champion:Lux:spell:LuxLightBinding | Lux | Q | 光之束缚 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lux.spells[0] |
| champion:Lux:spell:LuxPrismaticWave | Lux | W | 曲光屏障 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Lux.spells[1] |
| champion:Lux:spell:LuxLightStrikeKugel | Lux | E | 透光奇点 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lux.spells[2] |
| champion:Lux:spell:LuxR | Lux | R | 终极闪光 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Lux.spells[3] |
| champion:Malphite:passive | Malphite | P | 花岗岩护盾 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Malphite.passive |
| champion:Malphite:spell:SeismicShard | Malphite | Q | 地震碎片 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Malphite.spells[0] |
| champion:Malphite:spell:Obduracy | Malphite | W | 雷霆拍击 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Malphite.spells[1] |
| champion:Malphite:spell:Landslide | Malphite | E | 大地震颤 | 属性派生与穿透顺序 | core_1v1 | attr | derived_stat_from_attrs | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Malphite.spells[2] |
| champion:Malphite:spell:UFSlash | Malphite | R | 势不可挡 | 控制效果与锁窗 | core_1v1 | control | control_apply + control_immunity_window | partial | 不可阻挡的位移和击飞应显式保留为控制结果态，而不是继续压成纯伤害条目。 | ddragon/16.7.1/zh_CN/championFull.json#data.Malphite.spells[3] |
| champion:Malzahar:passive | Malzahar | P | 虚空穿越 | 控制效果与锁窗 | needs_conversion | control | defensive_window + damage_taken_modifier | partial | 近期未受伤或未受控时获得减伤和抗控窗口，不能继续只记成减伤倍率。 | ddragon/16.7.1/zh_CN/championFull.json#data.Malzahar.passive |
| champion:Malzahar:spell:MalzaharQ | Malzahar | Q | 虚空召唤 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Malzahar.spells[0] |
| champion:Malzahar:spell:MalzaharW | Malzahar | W | 虚空虫群 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Malzahar.spells[1] |
| champion:Malzahar:spell:MalzaharE | Malzahar | E | 煞星幻象 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Malzahar.spells[2] |
| champion:Malzahar:spell:MalzaharR | Malzahar | R | 冥府之握 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Malzahar.spells[3] |
| champion:Maokai:passive | Maokai | P | 吸元秘术 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Maokai.passive |
| champion:Maokai:spell:MaokaiQ | Maokai | Q | 荆棘重击 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Maokai.spells[0] |
| champion:Maokai:spell:MaokaiW | Maokai | W | 扭曲突刺 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Maokai.spells[1] |
| champion:Maokai:spell:MaokaiE | Maokai | E | 树苗投掷 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Maokai.spells[2] |
| champion:Maokai:spell:MaokaiR | Maokai | R | 自然之握 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Maokai.spells[3] |
| champion:MasterYi:passive | MasterYi | P | 双重打击 | 叠层与时效 | core_1v1 | counter | counter_state + stack_threshold_proc | partial | 每隔若干次攻击触发双重打击。 | ddragon/16.7.1/zh_CN/championFull.json#data.MasterYi.passive |
| champion:MasterYi:spell:AlphaStrike | MasterYi | Q | 阿尔法突袭 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.MasterYi.spells[0] |
| champion:MasterYi:spell:Meditate | MasterYi | W | 冥想 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.MasterYi.spells[1] |
| champion:MasterYi:spell:WujuStyle | MasterYi | E | 无极剑道 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.MasterYi.spells[2] |
| champion:MasterYi:spell:Highlander | MasterYi | R | 高原血统 | 资源与节奏 | needs_conversion | tempo | refund_cooldown + duration_extend | partial | 参与击杀延长持续时间并被动减少其它技能冷却。 | ddragon/16.7.1/zh_CN/championFull.json#data.MasterYi.spells[3] |
| champion:Mel:passive | Mel | P | 灼灼之光 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Mel.passive |
| champion:Mel:spell:MelQ | Mel | Q | 耀光齐射 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Mel.spells[0] |
| champion:Mel:spell:MelW | Mel | W | 灵魂折镜 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Mel.spells[1] |
| champion:Mel:spell:MelE | Mel | E | 阳炎涡旋 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Mel.spells[2] |
| champion:Mel:spell:MelR | Mel | R | 鎏金蚀日 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Mel.spells[3] |
| champion:Milio:passive | Milio | P | 热情洋溢！ | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Milio.passive |
| champion:Milio:spell:MilioQ | Milio | Q | 火爆飞踢 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Milio.spells[0] |
| champion:Milio:spell:MilioW | Milio | W | 依依不舍 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Milio.spells[1] |
| champion:Milio:spell:MilioE | Milio | E | 融融情谊 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Milio.spells[2] |
| champion:Milio:spell:MilioR | Milio | R | 生生不息 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Milio.spells[3] |
| champion:MissFortune:passive | MissFortune | P | 厄运的眷顾 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.MissFortune.passive |
| champion:MissFortune:spell:MissFortuneRicochetShot | MissFortune | Q | 一箭双雕 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.MissFortune.spells[0] |
| champion:MissFortune:spell:MissFortuneViciousStrikes | MissFortune | W | 大步流星 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.MissFortune.spells[1] |
| champion:MissFortune:spell:MissFortuneScattershot | MissFortune | E | 枪林弹雨 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.MissFortune.spells[2] |
| champion:MissFortune:spell:MissFortuneBulletTime | MissFortune | R | 弹幕时间 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.MissFortune.spells[3] |
| champion:MonkeyKing:passive | MonkeyKing | P | 金刚不坏 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.MonkeyKing.passive |
| champion:MonkeyKing:spell:MonkeyKingDoubleAttack | MonkeyKing | Q | 粉碎打击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.MonkeyKing.spells[0] |
| champion:MonkeyKing:spell:MonkeyKingDecoy | MonkeyKing | W | 真假猴王 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.MonkeyKing.spells[1] |
| champion:MonkeyKing:spell:MonkeyKingNimbus | MonkeyKing | E | 腾云突击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.MonkeyKing.spells[2] |
| champion:MonkeyKing:spell:MonkeyKingSpinToWin | MonkeyKing | R | 大闹天宫 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.MonkeyKing.spells[3] |
| champion:Mordekaiser:passive | Mordekaiser | P | 黑暗起兮 | 叠层与时效 | core_1v1 | counter | counter_state + periodic_proc | partial | 对英雄打出 3 次攻击或技能后展开伤害光环。 | ddragon/16.7.1/zh_CN/championFull.json#data.Mordekaiser.passive |
| champion:Mordekaiser:spell:MordekaiserQ | Mordekaiser | Q | 破灭之锤 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Mordekaiser.spells[0] |
| champion:Mordekaiser:spell:MordekaiserW | Mordekaiser | W | 不坏之身 | 历史值与时间窗口 | core_1v1 | history | damage_exchange_memory + consume_to_shield_heal | partial | 储存造成和承受的伤害，再消费为护盾和治疗。 | ddragon/16.7.1/zh_CN/championFull.json#data.Mordekaiser.spells[1] |
| champion:Mordekaiser:spell:MordekaiserE | Mordekaiser | E | 断魂一扼 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Mordekaiser.spells[2] |
| champion:Mordekaiser:spell:MordekaiserR | Mordekaiser | R | 轮回绝境 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Mordekaiser.spells[3] |
| champion:Morgana:passive | Morgana | P | 灵魂吸取 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Morgana.passive |
| champion:Morgana:spell:MorganaQ | Morgana | Q | 暗之禁锢 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Morgana.spells[0] |
| champion:Morgana:spell:MorganaW | Morgana | W | 折磨之影 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Morgana.spells[1] |
| champion:Morgana:spell:MorganaE | Morgana | E | 黑暗之盾 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Morgana.spells[2] |
| champion:Morgana:spell:MorganaR | Morgana | R | 灵魂镣铐 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Morgana.spells[3] |
| champion:Naafiri:passive | Naafiri | P | 狂烈种群 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Naafiri.passive |
| champion:Naafiri:spell:NaafiriQ | Naafiri | Q | 暗裔犬牙 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Naafiri.spells[0] |
| champion:Naafiri:spell:NaafiriR | Naafiri | W | 暴吼 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Naafiri.spells[1] |
| champion:Naafiri:spell:NaafiriE | Naafiri | E | 剔骨本能 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Naafiri.spells[2] |
| champion:Naafiri:spell:NaafiriW | Naafiri | R | 猎狗血性 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Naafiri.spells[3] |
| champion:Nami:passive | Nami | P | 踏浪之行 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 为友军提供移速增益。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nami.passive |
| champion:Nami:spell:NamiQ | Nami | Q | 碧波之牢 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nami.spells[0] |
| champion:Nami:spell:NamiW | Nami | W | 冲击之潮 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nami.spells[1] |
| champion:Nami:spell:NamiE | Nami | E | 唤潮之佑 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nami.spells[2] |
| champion:Nami:spell:NamiR | Nami | R | 怒涛之啸 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nami.spells[3] |
| champion:Nasus:passive | Nasus | P | 吞噬灵魂 | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nasus.passive |
| champion:Nasus:spell:NasusQ | Nasus | Q | 汲魂痛击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nasus.spells[0] |
| champion:Nasus:spell:NasusW | Nasus | W | 枯萎 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nasus.spells[1] |
| champion:Nasus:spell:NasusE | Nasus | E | 灵魂烈焰 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nasus.spells[2] |
| champion:Nasus:spell:NasusR | Nasus | R | 死神降临 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nasus.spells[3] |
| champion:Nautilus:passive | Nautilus | P | 排山倒海 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nautilus.passive |
| champion:Nautilus:spell:NautilusAnchorDrag | Nautilus | Q | 疏通航道 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nautilus.spells[0] |
| champion:Nautilus:spell:NautilusPiercingGaze | Nautilus | W | 泰坦之怒 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nautilus.spells[1] |
| champion:Nautilus:spell:NautilusSplashZone | Nautilus | E | 暗流涌动 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nautilus.spells[2] |
| champion:Nautilus:spell:NautilusGrandLine | Nautilus | R | 深海冲击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nautilus.spells[3] |
| champion:Neeko:passive | Neeko | P | 天生幻魅 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Neeko.passive |
| champion:Neeko:spell:NeekoQ | Neeko | Q | 盛开花种 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Neeko.spells[0] |
| champion:Neeko:spell:NeekoW | Neeko | W | 两生花影 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Neeko.spells[1] |
| champion:Neeko:spell:NeekoE | Neeko | E | 缠结倒刺 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Neeko.spells[2] |
| champion:Neeko:spell:NeekoR | Neeko | R | 怒放 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Neeko.spells[3] |
| champion:Nidalee:passive | Nidalee | P | 寻觅 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nidalee.passive |
| champion:Nidalee:spell:JavelinToss | Nidalee | Q | 标枪投掷 / 推倒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nidalee.spells[0] |
| champion:Nidalee:spell:Bushwhack | Nidalee | W | 丛林伏击 / 猛扑 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nidalee.spells[1] |
| champion:Nidalee:spell:PrimalSurge | Nidalee | E | 野性奔腾 / 挥击 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nidalee.spells[2] |
| champion:Nidalee:spell:AspectOfTheCougar | Nidalee | R | 美洲狮形态 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 豹形态切换与技能替换不进当前主链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nidalee.spells[3] |
| champion:Nilah:passive | Nilah | P | 喜色川流 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nilah.passive |
| champion:Nilah:spell:NilahQ | Nilah | Q | 游刃万变 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nilah.spells[0] |
| champion:Nilah:spell:NilahW | Nilah | W | 轻纱飞漾 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nilah.spells[1] |
| champion:Nilah:spell:NilahE | Nilah | E | 纵情逐流 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nilah.spells[2] |
| champion:Nilah:spell:NilahR | Nilah | R | 神恩激荡 | 护盾治疗吸血 | core_1v1 | sustain | overheal_to_shield | partial | 过量治疗与护盾转换需要单独模板。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nilah.spells[3] |
| champion:Nocturne:passive | Nocturne | P | 暗影之刃 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nocturne.passive |
| champion:Nocturne:spell:NocturneDuskbringer | Nocturne | Q | 梦魇之径 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nocturne.spells[0] |
| champion:Nocturne:spell:NocturneShroudofDarkness | Nocturne | W | 黑暗庇护 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nocturne.spells[1] |
| champion:Nocturne:spell:NocturneUnspeakableHorror | Nocturne | E | 无言恐惧 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nocturne.spells[2] |
| champion:Nocturne:spell:NocturneParanoia | Nocturne | R | 鬼影重重 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nocturne.spells[3] |
| champion:Nunu:passive | Nunu | P | 弗雷尔卓德的召唤 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nunu.passive |
| champion:Nunu:spell:NunuQ | Nunu | Q | 吞噬 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nunu.spells[0] |
| champion:Nunu:spell:NunuW | Nunu | W | 史上最大雪球！ | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nunu.spells[1] |
| champion:Nunu:spell:NunuE | Nunu | E | 雪球飞射 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Nunu.spells[2] |
| champion:Nunu:spell:NunuR | Nunu | R | 绝对零度 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Nunu.spells[3] |
| champion:Olaf:passive | Olaf | P | 狂战之怒 | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Olaf.passive |
| champion:Olaf:spell:OlafAxeThrowCast | Olaf | Q | 逆流投掷 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Olaf.spells[0] |
| champion:Olaf:spell:OlafFrenziedStrikes | Olaf | W | 挺过去 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Olaf.spells[1] |
| champion:Olaf:spell:OlafRecklessStrike | Olaf | E | 鲁莽挥击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Olaf.spells[2] |
| champion:Olaf:spell:OlafRagnarok | Olaf | R | 诸神黄昏 | 控制效果与锁窗 | core_1v1 | control | control_immunity_window | partial | 施放时净化并在持续期间免疫这些控制，不应继续过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Olaf.spells[3] |
| champion:Orianna:passive | Orianna | P | 发条协奏 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Orianna.passive |
| champion:Orianna:spell:OrianaIzunaCommand | Orianna | Q | 指令：攻击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Orianna.spells[0] |
| champion:Orianna:spell:OrianaDissonanceCommand | Orianna | W | 指令：杂音 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Orianna.spells[1] |
| champion:Orianna:spell:OrianaRedactCommand | Orianna | E | 指令：防卫 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Orianna.spells[2] |
| champion:Orianna:spell:OrianaDetonateCommand | Orianna | R | 指令：冲击波 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Orianna.spells[3] |
| champion:Ornn:passive | Ornn | P | 活体锻炉 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ornn.passive |
| champion:Ornn:spell:OrnnQ | Ornn | Q | 火山突堑 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ornn.spells[0] |
| champion:Ornn:spell:OrnnW | Ornn | W | 风箱炎息 | 控制效果与锁窗 | core_1v1 | control | control_immunity_window | partial | 先显式保留霸体、不可阻挡和控制免疫窗口语义。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ornn.spells[1] |
| champion:Ornn:spell:OrnnE | Ornn | E | 炽烈冲锋 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ornn.spells[2] |
| champion:Ornn:spell:OrnnR | Ornn | R | 熔铸之神的召唤 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ornn.spells[3] |
| champion:Pantheon:passive | Pantheon | P | 矢志不退 | 叠层与时效 | core_1v1 | counter | counter_state + stack_threshold_proc | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Pantheon.passive |
| champion:Pantheon:spell:PantheonQ | Pantheon | Q | 贯星长枪 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Pantheon.spells[0] |
| champion:Pantheon:spell:PantheonW | Pantheon | W | 斗盾跃击 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Pantheon.spells[1] |
| champion:Pantheon:spell:PantheonE | Pantheon | E | 神佑枪阵 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Pantheon.spells[2] |
| champion:Pantheon:spell:PantheonR | Pantheon | R | 大荒星陨 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Pantheon.spells[3] |
| champion:Poppy:passive | Poppy | P | 钢铁大使 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Poppy.passive |
| champion:Poppy:spell:PoppyQ | Poppy | Q | 圣锤猛击 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Poppy.spells[0] |
| champion:Poppy:spell:PoppyW | Poppy | W | 坚定风采 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Poppy.spells[1] |
| champion:Poppy:spell:PoppyE | Poppy | E | 英勇冲锋 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Poppy.spells[2] |
| champion:Poppy:spell:PoppyR | Poppy | R | 持卫的裁决 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Poppy.spells[3] |
| champion:Pyke:passive | Pyke | P | 溺水之幸 | 历史值与时间窗口 | core_1v1 | history | gray_health_window + recast_burst | partial | 最近承伤会转入灰色生命值，并在脱离视野后加速恢复。 | ddragon/16.7.1/zh_CN/championFull.json#data.Pyke.passive |
| champion:Pyke:spell:PykeQ | Pyke | Q | 透骨尖钉 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Pyke.spells[0] |
| champion:Pyke:spell:PykeW | Pyke | W | 幽潭潜行 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Pyke.spells[1] |
| champion:Pyke:spell:PykeE | Pyke | E | 魅影浪洄 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Pyke.spells[2] |
| champion:Pyke:spell:PykeR | Pyke | R | 涌泉之恨 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Pyke.spells[3] |
| champion:Qiyana:passive | Qiyana | P | 凌人贵气 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Qiyana.passive |
| champion:Qiyana:spell:QiyanaQ | Qiyana | Q | 元素之怒 / 以绪塔尔之锋 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Qiyana.spells[0] |
| champion:Qiyana:spell:QiyanaW | Qiyana | W | 方圆塑令 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Qiyana.spells[1] |
| champion:Qiyana:spell:QiyanaE | Qiyana | E | 天纵之勇 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Qiyana.spells[2] |
| champion:Qiyana:spell:QiyanaR | Qiyana | R | 惊才绝景 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Qiyana.spells[3] |
| champion:Quinn:passive | Quinn | P | 侵扰 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Quinn.passive |
| champion:Quinn:spell:QuinnQ | Quinn | Q | 炫目攻势 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Quinn.spells[0] |
| champion:Quinn:spell:QuinnW | Quinn | W | 敏锐感知 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Quinn.spells[1] |
| champion:Quinn:spell:QuinnE | Quinn | E | 旋翔掠杀 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Quinn.spells[2] |
| champion:Quinn:spell:QuinnR | Quinn | R | 深入敌后 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Quinn.spells[3] |
| champion:Rakan:passive | Rakan | P | 异色羽裳 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rakan.passive |
| champion:Rakan:spell:RakanQ | Rakan | Q | 微光飞翎 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rakan.spells[0] |
| champion:Rakan:spell:RakanW | Rakan | W | 盛大登场 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rakan.spells[1] |
| champion:Rakan:spell:RakanE | Rakan | E | 轻舞成双 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rakan.spells[2] |
| champion:Rakan:spell:RakanR | Rakan | R | 惊鸿过隙 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rakan.spells[3] |
| champion:Rammus:passive | Rammus | P | 锥刺甲壳 | 属性派生与穿透顺序 | core_1v1 | attr | derived_stat_from_attrs | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rammus.passive |
| champion:Rammus:spell:PowerBall | Rammus | Q | 动力冲刺 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rammus.spells[0] |
| champion:Rammus:spell:DefensiveBallCurl | Rammus | W | 尖刺防御 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rammus.spells[1] |
| champion:Rammus:spell:PuncturingTaunt | Rammus | E | 狂乱嘲讽 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rammus.spells[2] |
| champion:Rammus:spell:Tremors2 | Rammus | R | 冲天猛撞 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rammus.spells[3] |
| champion:RekSai:passive | RekSai | P | 艾克塞之怒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.RekSai.passive |
| champion:RekSai:spell:RekSaiQ | RekSai | Q | 女王之怒 / 猎物搜寻 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.RekSai.spells[0] |
| champion:RekSai:spell:RekSaiW | RekSai | W | 遁地 / 破土而出 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.RekSai.spells[1] |
| champion:RekSai:spell:RekSaiE | RekSai | E | 狂野之噬 / 挖掘隧道 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.RekSai.spells[2] |
| champion:RekSai:spell:RekSaiR | RekSai | R | 虚空猛冲 | 控制效果与锁窗 | core_1v1 | control | control_immunity_window | partial | 先显式保留霸体、不可阻挡和控制免疫窗口语义。 | ddragon/16.7.1/zh_CN/championFull.json#data.RekSai.spells[3] |
| champion:Rell:passive | Rell | P | 溃敌沉力 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rell.passive |
| champion:Rell:spell:RellQ | Rell | Q | 裂阵 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rell.spells[0] |
| champion:Rell:spell:RellW_Dismount | Rell | W | 驭铁术：轰落 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rell.spells[1] |
| champion:Rell:spell:RellE | Rell | E | 全速冲锋 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rell.spells[2] |
| champion:Rell:spell:RellR | Rell | R | 极涌 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rell.spells[3] |
| champion:Renata:passive | Renata | P | 物尽其用 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renata.passive |
| champion:Renata:spell:RenataQ | Renata | Q | 铁腕竞合 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renata.spells[0] |
| champion:Renata:spell:RenataW | Renata | W | 及时救难 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renata.spells[1] |
| champion:Renata:spell:RenataE | Renata | E | 忠诚激励 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renata.spells[2] |
| champion:Renata:spell:RenataR | Renata | R | 恶意收购 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renata.spells[3] |
| champion:Renekton:passive | Renekton | P | 怒之领域 | 资源与节奏 | core_1v1 | tempo | resource_gate | partial | 怒气作为技能强化门槛。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renekton.passive |
| champion:Renekton:spell:RenektonCleave | Renekton | Q | 巨鳄狂袭 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Renekton.spells[0] |
| champion:Renekton:spell:RenektonPreExecute | Renekton | W | 冷酷捕猎 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renekton.spells[1] |
| champion:Renekton:spell:RenektonSliceAndDice | Renekton | E | 横冲直撞 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renekton.spells[2] |
| champion:Renekton:spell:RenektonReignOfTheTyrant | Renekton | R | 终极统治 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Renekton.spells[3] |
| champion:Rengar:passive | Rengar | P | 无形掠食者 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 草丛跳跃与狩猎语义涉及地形和身份条件。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rengar.passive |
| champion:Rengar:spell:RengarQ | Rengar | Q | 残忍无情 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rengar.spells[0] |
| champion:Rengar:spell:RengarW | Rengar | W | 战争咆哮 | 历史值与时间窗口 | core_1v1 | history | damage_memory_window + cleanse_cc | partial | 基于最近承伤值回复生命，强化状态下还会解除控制。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rengar.spells[1] |
| champion:Rengar:spell:RengarE | Rengar | E | 套索打击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rengar.spells[2] |
| champion:Rengar:spell:RengarR | Rengar | R | 狩猎律动 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rengar.spells[3] |
| champion:Riven:passive | Riven | P | 符文之刃 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Riven.passive |
| champion:Riven:spell:RivenTriCleave | Riven | Q | 折翼之舞 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Riven.spells[0] |
| champion:Riven:spell:RivenMartyr | Riven | W | 震魂怒吼 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Riven.spells[1] |
| champion:Riven:spell:RivenFeint | Riven | E | 勇往直前 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Riven.spells[2] |
| champion:Riven:spell:RivenFengShuiEngine | Riven | R | 放逐之锋 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Riven.spells[3] |
| champion:Rumble:passive | Rumble | P | 机械重组 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rumble.passive |
| champion:Rumble:spell:RumbleFlameThrower | Rumble | Q | 纵火盛宴 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rumble.spells[0] |
| champion:Rumble:spell:RumbleShield | Rumble | W | 破碎护盾 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Rumble.spells[1] |
| champion:Rumble:spell:RumbleGrenade | Rumble | E | 电子鱼叉 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rumble.spells[2] |
| champion:Rumble:spell:RumbleCarpetBomb | Rumble | R | 恒温灼烧 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Rumble.spells[3] |
| champion:Ryze:passive | Ryze | P | 奥术专精 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ryze.passive |
| champion:Ryze:spell:RyzeQWrapper | Ryze | Q | 超负荷 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ryze.spells[0] |
| champion:Ryze:spell:RyzeW | Ryze | W | 符文禁锢 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ryze.spells[1] |
| champion:Ryze:spell:RyzeE | Ryze | E | 法术涌动 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ryze.spells[2] |
| champion:Ryze:spell:RyzeR | Ryze | R | 曲境折跃 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ryze.spells[3] |
| champion:Samira:passive | Samira | P | 悍勇本色 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Samira.passive |
| champion:Samira:spell:SamiraQ | Samira | Q | 交火 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Samira.spells[0] |
| champion:Samira:spell:SamiraW | Samira | W | 锋旋 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Samira.spells[1] |
| champion:Samira:spell:SamiraE | Samira | E | 狂飙 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Samira.spells[2] |
| champion:Samira:spell:SamiraR | Samira | R | 炼狱扳机 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Samira.spells[3] |
| champion:Sejuani:passive | Sejuani | P | 北地之怒 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sejuani.passive |
| champion:Sejuani:spell:SejuaniQ | Sejuani | Q | 极寒突袭 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sejuani.spells[0] |
| champion:Sejuani:spell:SejuaniW | Sejuani | W | 凛冬之怒 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sejuani.spells[1] |
| champion:Sejuani:spell:SejuaniE | Sejuani | E | 永冻领域 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sejuani.spells[2] |
| champion:Sejuani:spell:SejuaniR | Sejuani | R | 极冰寒狱 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sejuani.spells[3] |
| champion:Senna:passive | Senna | P | 赦除 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Senna.passive |
| champion:Senna:spell:SennaQ | Senna | Q | 黑暗洞灭 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Senna.spells[0] |
| champion:Senna:spell:SennaW | Senna | W | 无尽厮守 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Senna.spells[1] |
| champion:Senna:spell:SennaE | Senna | E | 黑雾咒附 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Senna.spells[2] |
| champion:Senna:spell:SennaR | Senna | R | 暗影燎原 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Senna.spells[3] |
| champion:Seraphine:passive | Seraphine | P | 星光漫射 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Seraphine.passive |
| champion:Seraphine:spell:SeraphineQ | Seraphine | Q | 清籁穿云 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Seraphine.spells[0] |
| champion:Seraphine:spell:SeraphineW | Seraphine | W | 聚和心声 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Seraphine.spells[1] |
| champion:Seraphine:spell:SeraphineE | Seraphine | E | 增幅节拍 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Seraphine.spells[2] |
| champion:Seraphine:spell:SeraphineR | Seraphine | R | 炫音返场 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Seraphine.spells[3] |
| champion:Sett:passive | Sett | P | 沙场豪情 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sett.passive |
| champion:Sett:spell:SettQ | Sett | Q | 屈人之威 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sett.spells[0] |
| champion:Sett:spell:SettW | Sett | W | 蓄意轰拳 | 历史值与时间窗口 | core_1v1 | history | damage_memory_window + consume_to_shield_damage | partial | 记录最近承受的伤害，再把窗口值消费为护盾和真实伤害。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sett.spells[1] |
| champion:Sett:spell:SettE | Sett | E | 强手裂颅 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sett.spells[2] |
| champion:Sett:spell:SettR | Sett | R | 叹为观止 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sett.spells[3] |
| champion:Shaco:passive | Shaco | P | 背刺 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Shaco.passive |
| champion:Shaco:spell:Deceive | Shaco | Q | 欺诈魔术 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shaco.spells[0] |
| champion:Shaco:spell:JackInTheBox | Shaco | W | 惊吓魔盒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shaco.spells[1] |
| champion:Shaco:spell:TwoShivPoison | Shaco | E | 双面毒刃 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Shaco.spells[2] |
| champion:Shaco:spell:HallucinateFull | Shaco | R | 幻像 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Shaco.spells[3] |
| champion:Shen:passive | Shen | P | 忍法！气合盾 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shen.passive |
| champion:Shen:spell:ShenQ | Shen | Q | 奥义！暮临 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shen.spells[0] |
| champion:Shen:spell:ShenW | Shen | W | 奥义！魂佑 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shen.spells[1] |
| champion:Shen:spell:ShenE | Shen | E | 奥义！影缚 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Shen.spells[2] |
| champion:Shen:spell:ShenR | Shen | R | 秘奥义！慈悲度魂落 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shen.spells[3] |
| champion:Shyvana:passive | Shyvana | P | 龙鳞铁衣 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shyvana.passive |
| champion:Shyvana:spell:ShyvanaQ | Shyvana | Q | 焚焰打击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shyvana.spells[0] |
| champion:Shyvana:spell:ShyvanaW | Shyvana | W | 烈火圣盾 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Shyvana.spells[1] |
| champion:Shyvana:spell:ShyvanaE | Shyvana | E | 爆炎吐息 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Shyvana.spells[2] |
| champion:Shyvana:spell:ShyvanaR | Shyvana | R | 魔龙降世 | 控制效果与锁窗 | core_1v1 | control | control_immunity_window | partial | 先显式保留霸体、不可阻挡和控制免疫窗口语义。 | ddragon/16.7.1/zh_CN/championFull.json#data.Shyvana.spells[3] |
| champion:Singed:passive | Singed | P | 剧毒冲流 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | partial | 经过附近英雄时获得爆发性移速。 | ddragon/16.7.1/zh_CN/championFull.json#data.Singed.passive |
| champion:Singed:spell:PoisonTrail | Singed | Q | 剧毒踪迹 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Singed.spells[0] |
| champion:Singed:spell:MegaAdhesive | Singed | W | 强力粘胶 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Singed.spells[1] |
| champion:Singed:spell:Fling | Singed | E | 过肩摔 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Singed.spells[2] |
| champion:Singed:spell:InsanityPotion | Singed | R | 疯狂药剂 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Singed.spells[3] |
| champion:Sion:passive | Sion | P | 死亡荣耀 | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sion.passive |
| champion:Sion:spell:SionQ | Sion | Q | 残虐猛击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sion.spells[0] |
| champion:Sion:spell:SionW | Sion | W | 灵魂熔炉 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sion.spells[1] |
| champion:Sion:spell:SionE | Sion | E | 杀手怒吼 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sion.spells[2] |
| champion:Sion:spell:SionR | Sion | R | 蛮横冲撞 | 控制效果与锁窗 | core_1v1 | control | control_immunity_window | partial | 先显式保留霸体、不可阻挡和控制免疫窗口语义。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sion.spells[3] |
| champion:Sivir:passive | Sivir | P | 敏锐疾行 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sivir.passive |
| champion:Sivir:spell:SivirQ | Sivir | Q | 回旋之刃 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sivir.spells[0] |
| champion:Sivir:spell:SivirW | Sivir | W | 弹射 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sivir.spells[1] |
| champion:Sivir:spell:SivirE | Sivir | E | 法术护盾 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sivir.spells[2] |
| champion:Sivir:spell:SivirR | Sivir | R | 狩猎 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sivir.spells[3] |
| champion:Skarner:passive | Skarner | P | 战栗 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Skarner.passive |
| champion:Skarner:spell:SkarnerQ | Skarner | Q | 撼地 / 擎天 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Skarner.spells[0] |
| champion:Skarner:spell:SkarnerW | Skarner | W | 震地壁垒 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Skarner.spells[1] |
| champion:Skarner:spell:SkarnerE | Skarner | E | 以绪塔尔冲击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Skarner.spells[2] |
| champion:Skarner:spell:SkarnerR | Skarner | R | 毒刺贯体 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Skarner.spells[3] |
| champion:Smolder:passive | Smolder | P | 龙之研习 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Smolder.passive |
| champion:Smolder:spell:SmolderQ | Smolder | Q | 超级灼热龙息 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Smolder.spells[0] |
| champion:Smolder:spell:SmolderW | Smolder | W | 阿嚏！ | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Smolder.spells[1] |
| champion:Smolder:spell:SmolderE | Smolder | E | 扑棱，扑棱，扑棱！ | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Smolder.spells[2] |
| champion:Smolder:spell:SmolderR | Smolder | R | 妈----！ | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Smolder.spells[3] |
| champion:Sona:passive | Sona | P | 能量和弦 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sona.passive |
| champion:Sona:spell:SonaQ | Sona | Q | 英勇赞美诗 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sona.spells[0] |
| champion:Sona:spell:SonaW | Sona | W | 坚毅咏叹调 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sona.spells[1] |
| champion:Sona:spell:SonaE | Sona | E | 迅捷奏鸣曲 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 自我加速外还包含友军光环与减速能量和弦。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sona.spells[2] |
| champion:Sona:spell:SonaR | Sona | R | 狂舞终乐章 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sona.spells[3] |
| champion:Soraka:passive | Soraka | P | 拯救 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 朝低血量友军移动时加速。 | ddragon/16.7.1/zh_CN/championFull.json#data.Soraka.passive |
| champion:Soraka:spell:SorakaQ | Soraka | Q | 流星坠落 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Soraka.spells[0] |
| champion:Soraka:spell:SorakaW | Soraka | W | 星之灌注 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Soraka.spells[1] |
| champion:Soraka:spell:SorakaE | Soraka | E | 星体结界 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Soraka.spells[2] |
| champion:Soraka:spell:SorakaR | Soraka | R | 祈愿 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Soraka.spells[3] |
| champion:Swain:passive | Swain | P | 狂食鸦群 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Swain.passive |
| champion:Swain:spell:SwainQ | Swain | Q | 解脱之触 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Swain.spells[0] |
| champion:Swain:spell:SwainW | Swain | W | 帝国视界 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Swain.spells[1] |
| champion:Swain:spell:SwainE | Swain | E | 永不复行 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Swain.spells[2] |
| champion:Swain:spell:SwainR | Swain | R | 恶魔升华 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Swain.spells[3] |
| champion:Sylas:passive | Sylas | P | 破敌禁法 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sylas.passive |
| champion:Sylas:spell:SylasQ | Sylas | Q | 锁链鞭击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sylas.spells[0] |
| champion:Sylas:spell:SylasW | Sylas | W | 弑君突刺 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Sylas.spells[1] |
| champion:Sylas:spell:SylasE | Sylas | E | 潜掠/强掳 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sylas.spells[2] |
| champion:Sylas:spell:SylasR | Sylas | R | 其人之道 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 偷取敌方终极技能属于技能替换语义。 | ddragon/16.7.1/zh_CN/championFull.json#data.Sylas.spells[3] |
| champion:Syndra:passive | Syndra | P | 卓尔不凡 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Syndra.passive |
| champion:Syndra:spell:SyndraQ | Syndra | Q | 暗黑法球 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Syndra.spells[0] |
| champion:Syndra:spell:SyndraW | Syndra | W | 驱使念力 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Syndra.spells[1] |
| champion:Syndra:spell:SyndraE | Syndra | E | 弱者退散 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Syndra.spells[2] |
| champion:Syndra:spell:SyndraR | Syndra | R | 能量倾泻 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Syndra.spells[3] |
| champion:TahmKench:passive | TahmKench | P | 培养品味 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.TahmKench.passive |
| champion:TahmKench:spell:TahmKenchQ | TahmKench | Q | 巨舌鞭笞 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.TahmKench.spells[0] |
| champion:TahmKench:spell:TahmKenchW | TahmKench | W | 深渊潜航 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.TahmKench.spells[1] |
| champion:TahmKench:spell:TahmKenchE | TahmKench | E | 厚实表皮 | 历史值与时间窗口 | core_1v1 | history | gray_health_window + recast_burst | partial | 最近承伤会转入灰色生命值，并可在主动施放时转为护盾。 | ddragon/16.7.1/zh_CN/championFull.json#data.TahmKench.spells[2] |
| champion:TahmKench:spell:TahmKenchRWrapper | TahmKench | R | 大快朵颐 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.TahmKench.spells[3] |
| champion:Taliyah:passive | Taliyah | P | 浮石冲 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Taliyah.passive |
| champion:Taliyah:spell:TaliyahQ | Taliyah | Q | 石穿 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Taliyah.spells[0] |
| champion:Taliyah:spell:TaliyahWVC | Taliyah | W | 岩突 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Taliyah.spells[1] |
| champion:Taliyah:spell:TaliyahE | Taliyah | E | 撒石阵 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Taliyah.spells[2] |
| champion:Taliyah:spell:TaliyahR | Taliyah | R | 墙幔 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Taliyah.spells[3] |
| champion:Talon:passive | Talon | P | 刀锋之末 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Talon.passive |
| champion:Talon:spell:TalonQ | Talon | Q | 诺克萨斯式外交 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Talon.spells[0] |
| champion:Talon:spell:TalonW | Talon | W | 斩草除根 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Talon.spells[1] |
| champion:Talon:spell:TalonE | Talon | E | 刺客之道 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 翻越地形不进入当前 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Talon.spells[2] |
| champion:Talon:spell:TalonR | Talon | R | 暗影突袭 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Talon.spells[3] |
| champion:Taric:passive | Taric | P | 正气凌人 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Taric.passive |
| champion:Taric:spell:TaricQ | Taric | Q | 星光之触 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Taric.spells[0] |
| champion:Taric:spell:TaricW | Taric | W | 坚毅壁垒 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Taric.spells[1] |
| champion:Taric:spell:TaricE | Taric | E | 炫光 | 控制效果与锁窗 | core_1v1 | control | control_apply | partial | 延迟后造成伤害并眩晕目标，链式控制风险不能再被压成纯伤害公式。 | ddragon/16.7.1/zh_CN/championFull.json#data.Taric.spells[2] |
| champion:Taric:spell:TaricR | Taric | R | 宇宙之辉 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Taric.spells[3] |
| champion:Teemo:passive | Teemo | P | 游击队军备 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 隐形与草丛条件不进当前主链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Teemo.passive |
| champion:Teemo:spell:TeemoQ | Teemo | Q | 致盲吹箭 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Teemo.spells[0] |
| champion:Teemo:spell:TeemoW | Teemo | W | 小莫快跑 | 命中触发与标记结算 | core_1v1 | trigger | on_hit_proc | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Teemo.spells[1] |
| champion:Teemo:spell:TeemoE | Teemo | E | 毒性射击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Teemo.spells[2] |
| champion:Teemo:spell:TeemoR | Teemo | R | 种蘑菇 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Teemo.spells[3] |
| champion:Thresh:passive | Thresh | P | 地狱诅咒 | 属性派生与穿透顺序 | core_1v1 | attr | stack_to_stat | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Thresh.passive |
| champion:Thresh:spell:ThreshQ | Thresh | Q | 死亡判决 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Thresh.spells[0] |
| champion:Thresh:spell:ThreshW | Thresh | W | 魂引之灯 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Thresh.spells[1] |
| champion:Thresh:spell:ThreshE | Thresh | E | 厄运钟摆 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Thresh.spells[2] |
| champion:Thresh:spell:ThreshRPenta | Thresh | R | 幽冥监牢 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Thresh.spells[3] |
| champion:Tristana:passive | Tristana | P | 瞄准 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 随等级提升射程。 | ddragon/16.7.1/zh_CN/championFull.json#data.Tristana.passive |
| champion:Tristana:spell:TristanaQ | Tristana | Q | 急速射击 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Tristana.spells[0] |
| champion:Tristana:spell:TristanaW | Tristana | W | 火箭跳跃 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Tristana.spells[1] |
| champion:Tristana:spell:TristanaE | Tristana | E | 爆炸火花 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Tristana.spells[2] |
| champion:Tristana:spell:TristanaR | Tristana | R | 毁灭射击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Tristana.spells[3] |
| champion:Trundle:passive | Trundle | P | 国王的贡品 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Trundle.passive |
| champion:Trundle:spell:TrundleTrollSmash | Trundle | Q | 利齿撕咬 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Trundle.spells[0] |
| champion:Trundle:spell:trundledesecrate | Trundle | W | 冰封领域 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Trundle.spells[1] |
| champion:Trundle:spell:TrundleCircle | Trundle | E | 寒冰之柱 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Trundle.spells[2] |
| champion:Trundle:spell:TrundlePain | Trundle | R | 强权至上 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Trundle.spells[3] |
| champion:Tryndamere:passive | Tryndamere | P | 战斗狂怒 | 暴击资格与暴击策略 | manual_review | attr | crit_policy_gap | gap | 怒气被动增加暴击几率，暴露出英雄侧 crit chance 来源与消费缺口。 | ddragon/16.7.1/zh_CN/championFull.json#data.Tryndamere.passive |
| champion:Tryndamere:spell:TryndamereQ | Tryndamere | Q | 嗜血杀戮 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Tryndamere.spells[0] |
| champion:Tryndamere:spell:TryndamereW | Tryndamere | W | 蔑视 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Tryndamere.spells[1] |
| champion:Tryndamere:spell:TryndamereE | Tryndamere | E | 旋风斩 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Tryndamere.spells[2] |
| champion:Tryndamere:spell:UndyingRage | Tryndamere | R | 无尽怒火 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 免死属于当前明确跳过的生命周期类。 | ddragon/16.7.1/zh_CN/championFull.json#data.Tryndamere.spells[3] |
| champion:TwistedFate:passive | TwistedFate | P | 灌铅骰子 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.TwistedFate.passive |
| champion:TwistedFate:spell:WildCards | TwistedFate | Q | 万能牌 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.TwistedFate.spells[0] |
| champion:TwistedFate:spell:PickACard | TwistedFate | W | 选牌 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.TwistedFate.spells[1] |
| champion:TwistedFate:spell:CardmasterStack | TwistedFate | E | 卡牌骗术 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.TwistedFate.spells[2] |
| champion:TwistedFate:spell:Destiny | TwistedFate | R | 命运 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.TwistedFate.spells[3] |
| champion:Twitch:passive | Twitch | P | 死亡毒液 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Twitch.passive |
| champion:Twitch:spell:TwitchHideInShadows | Twitch | Q | 埋伏 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Twitch.spells[0] |
| champion:Twitch:spell:TwitchVenomCask | Twitch | W | 剧毒之桶 | 叠层与时效 | core_1v1 | counter | counter_state + periodic_proc | partial | 施加并周期增加死亡毒液层数。 | ddragon/16.7.1/zh_CN/championFull.json#data.Twitch.spells[1] |
| champion:Twitch:spell:TwitchExpunge | Twitch | E | 毒性爆发 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Twitch.spells[2] |
| champion:Twitch:spell:TwitchFullAutomatic | Twitch | R | 火力全开 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Twitch.spells[3] |
| champion:Udyr:passive | Udyr | P | 众灵纽带 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Udyr.passive |
| champion:Udyr:spell:UdyrQ | Udyr | Q | 狂暴爪击 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Udyr.spells[0] |
| champion:Udyr:spell:UdyrW | Udyr | W | 坚铁甲胄 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Udyr.spells[1] |
| champion:Udyr:spell:UdyrE | Udyr | E | 踏火蛮冲 | 控制效果与锁窗 | core_1v1 | control | control_apply + per_target_lockout | partial | 命中时眩晕目标但对同一目标有独立锁窗，觉醒状态还带控制免疫。 | ddragon/16.7.1/zh_CN/championFull.json#data.Udyr.spells[2] |
| champion:Udyr:spell:UdyrR | Udyr | R | 极凌飓风 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Udyr.spells[3] |
| champion:Urgot:passive | Urgot | P | 回响烈焰 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Urgot.passive |
| champion:Urgot:spell:UrgotQ | Urgot | Q | 腐蚀电荷 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Urgot.spells[0] |
| champion:Urgot:spell:UrgotW | Urgot | W | 净除 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Urgot.spells[1] |
| champion:Urgot:spell:UrgotE | Urgot | E | 鄙弃 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Urgot.spells[2] |
| champion:Urgot:spell:UrgotR | Urgot | R | 超越死亡的恐惧 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Urgot.spells[3] |
| champion:Varus:passive | Varus | P | 复仇之欲 | 基础属性加成 | needs_conversion | attr | flat_stat_bonus | partial | 击杀或助攻后获得攻速、攻击力和法强。 | ddragon/16.7.1/zh_CN/championFull.json#data.Varus.passive |
| champion:Varus:spell:VarusQ | Varus | Q | 穿刺之箭 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Varus.spells[0] |
| champion:Varus:spell:VarusW | Varus | W | 枯萎箭袋 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Varus.spells[1] |
| champion:Varus:spell:VarusE | Varus | E | 恶灵箭雨 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Varus.spells[2] |
| champion:Varus:spell:VarusR | Varus | R | 腐败锁链 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Varus.spells[3] |
| champion:Vayne:passive | Vayne | P | 暗夜猎手 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Vayne.passive |
| champion:Vayne:spell:VayneTumble | Vayne | Q | 闪避突袭 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Vayne.spells[0] |
| champion:Vayne:spell:VayneSilveredBolts | Vayne | W | 圣银弩箭 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vayne.spells[1] |
| champion:Vayne:spell:VayneCondemn | Vayne | E | 恶魔审判 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Vayne.spells[2] |
| champion:Vayne:spell:VayneInquisition | Vayne | R | 终极时刻 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vayne.spells[3] |
| champion:Veigar:passive | Veigar | P | 超凡邪力 | 属性派生与穿透顺序 | core_1v1 | attr | stack_to_stat | covered | 命中、击杀与拆塔永久提高法强。 | ddragon/16.7.1/zh_CN/championFull.json#data.Veigar.passive |
| champion:Veigar:spell:VeigarBalefulStrike | Veigar | Q | 黑暗祭祀 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Veigar.spells[0] |
| champion:Veigar:spell:VeigarDarkMatter | Veigar | W | 黑暗物质 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Veigar.spells[1] |
| champion:Veigar:spell:VeigarEventHorizon | Veigar | E | 扭曲空间 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Veigar.spells[2] |
| champion:Veigar:spell:VeigarR | Veigar | R | 能量爆裂 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Veigar.spells[3] |
| champion:Velkoz:passive | Velkoz | P | 有机体解构 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Velkoz.passive |
| champion:Velkoz:spell:VelkozQ | Velkoz | Q | 等离子裂变 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Velkoz.spells[0] |
| champion:Velkoz:spell:VelkozW | Velkoz | W | 虚空裂隙 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Velkoz.spells[1] |
| champion:Velkoz:spell:VelkozE | Velkoz | E | 构造分解 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Velkoz.spells[2] |
| champion:Velkoz:spell:VelkozR | Velkoz | R | 生命形态瓦解射线 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Velkoz.spells[3] |
| champion:Vex:passive | Vex | P | 终焉暮气 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vex.passive |
| champion:Vex:spell:VexQ | Vex | Q | 寒心波云 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Vex.spells[0] |
| champion:Vex:spell:VexW | Vex | W | 生人勿近 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vex.spells[1] |
| champion:Vex:spell:VexE | Vex | E | 溟濛渐染 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vex.spells[2] |
| champion:Vex:spell:VexR | Vex | R | 愁煞 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Vex.spells[3] |
| champion:Vi:passive | Vi | P | 爆裂护盾 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vi.passive |
| champion:Vi:spell:ViQ | Vi | Q | 强能冲拳 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vi.spells[0] |
| champion:Vi:spell:ViW | Vi | W | 爆弹重拳 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vi.spells[1] |
| champion:Vi:spell:ViE | Vi | E | 透体之劲 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vi.spells[2] |
| champion:Vi:spell:ViR | Vi | R | 天霸横空烈轰 | 控制效果与锁窗 | core_1v1 | control | control_apply + control_immunity_window | partial | 不可阻挡的锁定突进和击飞应显式保留为控制结果态。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vi.spells[3] |
| champion:Viego:passive | Viego | P | 君命已决 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Viego.passive |
| champion:Viego:spell:ViegoQ | Viego | Q | 破败王剑 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Viego.spells[0] |
| champion:Viego:spell:ViegoW | Viego | W | 千载幽咽 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Viego.spells[1] |
| champion:Viego:spell:ViegoE | Viego | E | 茫茫焦土 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Viego.spells[2] |
| champion:Viego:spell:ViegoR | Viego | R | 痛贯天灵 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Viego.spells[3] |
| champion:Viktor:passive | Viktor | P | 光荣进化 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 海克斯碎片驱动技能升级，属于元层成长。 | ddragon/16.7.1/zh_CN/championFull.json#data.Viktor.passive |
| champion:Viktor:spell:ViktorQ | Viktor | Q | 虹吸能量 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Viktor.spells[0] |
| champion:Viktor:spell:ViktorW | Viktor | W | 重力场 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Viktor.spells[1] |
| champion:Viktor:spell:ViktorE | Viktor | E | 海克斯射线 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Viktor.spells[2] |
| champion:Viktor:spell:ViktorR | Viktor | R | 奥术风暴 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Viktor.spells[3] |
| champion:Vladimir:passive | Vladimir | P | 血色契约 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Vladimir.passive |
| champion:Vladimir:spell:VladimirQ | Vladimir | Q | 鲜血转换 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Vladimir.spells[0] |
| champion:Vladimir:spell:VladimirSanguinePool | Vladimir | W | 血红之池 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vladimir.spells[1] |
| champion:Vladimir:spell:VladimirE | Vladimir | E | 血之潮汐 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Vladimir.spells[2] |
| champion:Vladimir:spell:VladimirHemoplague | Vladimir | R | 血之瘟疫 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Vladimir.spells[3] |
| champion:Volibear:passive | Volibear | P | 狂雷渐起 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Volibear.passive |
| champion:Volibear:spell:VolibearQ | Volibear | Q | 擂首一击 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Volibear.spells[0] |
| champion:Volibear:spell:VolibearW | Volibear | W | 暴怒撕咬 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Volibear.spells[1] |
| champion:Volibear:spell:VolibearE | Volibear | E | 霹天雳地 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Volibear.spells[2] |
| champion:Volibear:spell:VolibearR | Volibear | R | 天声震落 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Volibear.spells[3] |
| champion:Warwick:passive | Warwick | P | 血之饥渴 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Warwick.passive |
| champion:Warwick:spell:WarwickQ | Warwick | Q | 野兽之口 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Warwick.spells[0] |
| champion:Warwick:spell:WarwickW | Warwick | W | 鲜血追猎 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Warwick.spells[1] |
| champion:Warwick:spell:WarwickE | Warwick | E | 远祖嗥叫 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Warwick.spells[2] |
| champion:Warwick:spell:WarwickR | Warwick | R | 无尽束缚 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Warwick.spells[3] |
| champion:Xayah:passive | Xayah | P | 锐切 | 命中触发与标记结算 | core_1v1 | trigger | on_hit_proc | partial | 施放技能后数次普攻穿透并留下羽毛。 | ddragon/16.7.1/zh_CN/championFull.json#data.Xayah.passive |
| champion:Xayah:spell:XayahQ | Xayah | Q | 双刃 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Xayah.spells[0] |
| champion:Xayah:spell:XayahW | Xayah | W | 致死羽衣 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Xayah.spells[1] |
| champion:Xayah:spell:XayahE | Xayah | E | 倒钩 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Xayah.spells[2] |
| champion:Xayah:spell:XayahR | Xayah | R | 暴风羽刃 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Xayah.spells[3] |
| champion:Xerath:passive | Xerath | P | 法力澎湃 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Xerath.passive |
| champion:Xerath:spell:XerathArcanopulseChargeUp | Xerath | Q | 奥能脉冲 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Xerath.spells[0] |
| champion:Xerath:spell:XerathArcaneBarrage2 | Xerath | W | 毁灭之眼 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Xerath.spells[1] |
| champion:Xerath:spell:XerathMageSpear | Xerath | E | 冲击法球 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Xerath.spells[2] |
| champion:Xerath:spell:XerathLocusOfPower2 | Xerath | R | 奥术仪式 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Xerath.spells[3] |
| champion:XinZhao:passive | XinZhao | P | 果决 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.XinZhao.passive |
| champion:XinZhao:spell:XinZhaoQ | XinZhao | Q | 三重爪击 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.XinZhao.spells[0] |
| champion:XinZhao:spell:XinZhaoW | XinZhao | W | 风斩电刺 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.XinZhao.spells[1] |
| champion:XinZhao:spell:XinZhaoE | XinZhao | E | 无畏冲锋 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.XinZhao.spells[2] |
| champion:XinZhao:spell:XinZhaoR | XinZhao | R | 新月护卫 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.XinZhao.spells[3] |
| champion:Yasuo:passive | Yasuo | P | 浪客之道 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yasuo.passive |
| champion:Yasuo:spell:YasuoQ1Wrapper | Yasuo | Q | 斩钢闪 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yasuo.spells[0] |
| champion:Yasuo:spell:YasuoW | Yasuo | W | 风之障壁 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yasuo.spells[1] |
| champion:Yasuo:spell:YasuoE | Yasuo | E | 踏前斩 | 控制效果与锁窗 | core_1v1 | control | per_target_lockout + damage_ramp | partial | 对同一目标有独立冷却，连续穿刺时还会提高伤害。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yasuo.spells[2] |
| champion:Yasuo:spell:YasuoR | Yasuo | R | 狂风绝息斩 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yasuo.spells[3] |
| champion:Yone:passive | Yone | P | 狩人之道 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Yone.passive |
| champion:Yone:spell:YoneQ | Yone | Q | 错玉切 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yone.spells[0] |
| champion:Yone:spell:YoneW | Yone | W | 凛神斩 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yone.spells[1] |
| champion:Yone:spell:YoneE | Yone | E | 破障之锋 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yone.spells[2] |
| champion:Yone:spell:YoneR | Yone | R | 封尘绝念斩 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Yone.spells[3] |
| champion:Yorick:passive | Yorick | P | 牧魂人 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yorick.passive |
| champion:Yorick:spell:YorickQ | Yorick | Q | 临终仪式 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yorick.spells[0] |
| champion:Yorick:spell:YorickW | Yorick | W | 暗灵缠身 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yorick.spells[1] |
| champion:Yorick:spell:YorickE | Yorick | E | 哀伤之雾 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yorick.spells[2] |
| champion:Yorick:spell:YorickR | Yorick | R | 海屿悼词 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yorick.spells[3] |
| champion:Yunara:passive | Yunara | P | 初生之誓 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Yunara.passive |
| champion:Yunara:spell:YunaraQ | Yunara | Q | 灵蕴拳 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Yunara.spells[0] |
| champion:Yunara:spell:YunaraW | Yunara | W | 善恶轮 \| 寂灭掌 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Yunara.spells[1] |
| champion:Yunara:spell:YunaraE | Yunara | E | 明踪步 \| 夜影翻 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yunara.spells[2] |
| champion:Yunara:spell:YunaraR | Yunara | R | 定圣诀 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 超凡形态下基础技能升级属于形态强化。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yunara.spells[3] |
| champion:Yuumi:passive | Yuumi | P | 猫的博爱 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yuumi.passive |
| champion:Yuumi:spell:YuumiQ | Yuumi | Q | 摸鱼飞弹 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yuumi.spells[0] |
| champion:Yuumi:spell:YuumiW | Yuumi | W | 悠米出动！ | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yuumi.spells[1] |
| champion:Yuumi:spell:YuumiE | Yuumi | E | 旺盛精力 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yuumi.spells[2] |
| champion:Yuumi:spell:YuumiR | Yuumi | R | 魔典终章 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Yuumi.spells[3] |
| champion:Zaahen:passive | Zaahen | P | 不落之志 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zaahen.passive |
| champion:Zaahen:spell:ZaahenQ | Zaahen | Q | 暗裔长刀 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zaahen.spells[0] |
| champion:Zaahen:spell:ZaahenW | Zaahen | W | 厄影回锋 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zaahen.spells[1] |
| champion:Zaahen:spell:ZaahenE | Zaahen | E | 赤金突袭 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zaahen.spells[2] |
| champion:Zaahen:spell:ZaahenR | Zaahen | R | 大赦 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zaahen.spells[3] |
| champion:Zac:passive | Zac | P | 细胞分裂 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zac.passive |
| champion:Zac:spell:ZacQ | Zac | Q | 延伸打击 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zac.spells[0] |
| champion:Zac:spell:ZacW | Zac | W | 不稳定物质 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zac.spells[1] |
| champion:Zac:spell:ZacE | Zac | E | 橡筋弹弓 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zac.spells[2] |
| champion:Zac:spell:ZacR | Zac | R | 动感弹球 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zac.spells[3] |
| champion:Zed:passive | Zed | P | 影忍法！灭魂劫 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zed.passive |
| champion:Zed:spell:ZedQ | Zed | Q | 影奥义！诸刃 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zed.spells[0] |
| champion:Zed:spell:ZedW | Zed | W | 影奥义！分身 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zed.spells[1] |
| champion:Zed:spell:ZedE | Zed | E | 影奥义！鬼斩 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zed.spells[2] |
| champion:Zed:spell:ZedR | Zed | R | 禁奥义！瞬狱影杀阵 | 命中触发与标记结算 | core_1v1 | mark | stored_damage_on_mark | partial | 需要标记窗口内储伤并到期结算。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zed.spells[3] |
| champion:Zeri:passive | Zeri | P | 内能迁转 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zeri.passive |
| champion:Zeri:spell:ZeriQ | Zeri | Q | 电火迸射 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zeri.spells[0] |
| champion:Zeri:spell:ZeriW | Zeri | W | 强穿激光 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zeri.spells[1] |
| champion:Zeri:spell:ZeriE | Zeri | E | 灿丽花火 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zeri.spells[2] |
| champion:Zeri:spell:ZeriR | Zeri | R | 超限爆闪 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zeri.spells[3] |
| champion:Ziggs:passive | Ziggs | P | 一触即发 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ziggs.passive |
| champion:Ziggs:spell:ZiggsQ | Ziggs | Q | 弹跳炸弹 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ziggs.spells[0] |
| champion:Ziggs:spell:ZiggsW | Ziggs | W | 定点爆破 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Ziggs.spells[1] |
| champion:Ziggs:spell:ZiggsE | Ziggs | E | 海克斯爆破雷区 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ziggs.spells[2] |
| champion:Ziggs:spell:ZiggsR | Ziggs | R | 科学的地狱火炮 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Ziggs.spells[3] |
| champion:Zilean:passive | Zilean | P | 瓶中时光 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zilean.passive |
| champion:Zilean:spell:ZileanQ | Zilean | Q | 定时炸弹 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zilean.spells[0] |
| champion:Zilean:spell:ZileanW | Zilean | W | 穿梭未来 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zilean.spells[1] |
| champion:Zilean:spell:TimeWarp | Zilean | E | 时光发条 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zilean.spells[2] |
| champion:Zilean:spell:ChronoShift | Zilean | R | 时光倒流 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zilean.spells[3] |
| champion:Zoe:passive | Zoe | P | 烟火四射！ | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zoe.passive |
| champion:Zoe:spell:ZoeQ | Zoe | Q | 飞星乱入！ | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zoe.spells[0] |
| champion:Zoe:spell:ZoeW | Zoe | W | 窃法巧手 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zoe.spells[1] |
| champion:Zoe:spell:ZoeE | Zoe | E | 催眠气泡 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zoe.spells[2] |
| champion:Zoe:spell:ZoeR | Zoe | R | 折返跃迁 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 折返位移不进入当前 1v1 核心链路。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zoe.spells[3] |
| champion:Zyra:passive | Zyra | P | 荆棘花园 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zyra.passive |
| champion:Zyra:spell:ZyraQ | Zyra | Q | 致命棘刺 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | ddragon/16.7.1/zh_CN/championFull.json#data.Zyra.spells[0] |
| champion:Zyra:spell:ZyraW | Zyra | W | 狂野生长 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zyra.spells[1] |
| champion:Zyra:spell:ZyraE | Zyra | E | 缠绕之根 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zyra.spells[2] |
| champion:Zyra:spell:ZyraR | Zyra | R | 绞杀之藤 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | ddragon/16.7.1/zh_CN/championFull.json#data.Zyra.spells[3] |

## 当前备注

- 英雄必须按被动与技能拆 entry，不按整英雄合并判断。
- 阿卡丽 E1/E2、伊芙琳 W、布隆与布兰德计数器等已按前序结论做 override，不重复展开。
