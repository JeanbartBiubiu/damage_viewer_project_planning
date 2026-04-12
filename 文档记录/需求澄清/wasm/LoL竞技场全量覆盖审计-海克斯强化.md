TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-10 00:00:00

# LoL竞技场全量覆盖审计-海克斯强化

日期：2026-04-10
状态：进行中
范围：海克斯强化按单实体 entry 审计
基线：当前原始快照重建后共 `206` 条 augment entries

## 共享审计字段

- `runtimeLayer`：`formula / sustain / trigger / mark / attr / tempo / counter / history / control / filter`
- `templateOrModel`：命中的模板或状态模型
- `coverageVerdict`：`covered / partial / gap / filtered`
- `gapOrConversionNote`：缺口、转换条件或过滤原因

## 海克斯强化专属字段

- `apiName`
- `rarity`
- `dataValueKeys`

## 审计表

| entryId | entryNameZh | apiName | rarity | primaryGroup | scopeAssessment | runtimeLayer | templateOrModel | coverageVerdict | gapOrConversionNote | sourceRef |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| augment:93 | 热身动作 | WarmupRoutine | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[0] |
| augment:89 | 遁入暗影 | Vanish | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[1] |
| augment:166 | 连锁闪电 | ChainLightning | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[2] |
| augment:323 | 地狱三头犬 | Cerberus | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[3] |
| augment:87 | 台风 | Typhoon | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[4] |
| augment:108 | 自我毁灭 | SelfDestruct | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | communitydragon/latest/zh_cn/arena.json#augments[5] |
| augment:120 | 超越死亡的效劳 | ServeBeyondDeath | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[6] |
| augment:327 | 不灭守护 | UndyingGuard | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[7] |
| augment:66 | 量子计算 | QuantumComputing | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[8] |
| augment:23 | 魔鬼之舞 | DemonsDance | 1 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | communitydragon/latest/zh_cn/arena.json#augments[9] |
| augment:21 | 防御计略 | DefensiveManeuvers | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[10] |
| augment:243 | 质变：混沌 | TransmuteChaos | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[11] |
| augment:14 | 专属司机 | Chauffeur | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[12] |
| augment:129 | 神射法师 | Marksmage | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[13] |
| augment:231 | 光明守望者 | LightWarden | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[14] |
| augment:318 | 任务：疯狂帽子人 | Quest_MadHatter | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[15] |
| augment:6 | 利刃华尔兹 | BladeWaltz | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[16] |
| augment:94 | 自愿牺牲 | WillingSacrifice | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[17] |
| augment:308 | 火狐 | Firefox | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[18] |
| augment:223 | 召唤师革新 | SummonerRevolution | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[19] |
| augment:44 | 冰寒 | IceCold | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | communitydragon/latest/zh_cn/arena.json#augments[20] |
| augment:214 | 旋转至胜 | SpinToWin | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[21] |
| augment:5 | 号令之旗 | BannerofCommand | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[22] |
| augment:80 | 会心防守 | TankItOrLeaveIt | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[23] |
| augment:97 | 巫师式思考 | WitchfulThinking | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[24] |
| augment:154 | 任务：海牛阿福的勇士 | Quest_UrfsChampion | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[25] |
| augment:90 | 复仇 | Vengeance | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[26] |
| augment:28 | 侵蚀 | Erosion | 0 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[27] |
| augment:226 | 属性！ | Stats | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_shop_anvil_meta | filtered | 属性锻造器属于 loadout 预展开奖励，不直接进入战斗时公式。 | communitydragon/latest/zh_cn/arena.json#augments[28] |
| augment:54 | 物法皆修 | MasterofDuality | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[29] |
| augment:51 | 点亮他们！ | LightemUp | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[30] |
| augment:72 | 炽烈黎明 | SearingDawn | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[31] |
| augment:136 | 扇巴掌 | SlapAround | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[32] |
| augment:133 | 魔法飞弹 | MagicMissile | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | communitydragon/latest/zh_cn/arena.json#augments[33] |
| augment:135 | 法术苏醒 | Spellwake | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[34] |
| augment:193 | 星原之准 | CenterOfTheUniverse | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[35] |
| augment:65 | 超凡邪恶 | PhenomenalEvil | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[36] |
| augment:180 | 超强大脑 | BigBrain | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[37] |
| augment:92 | 易损 | Vulnerability | 1 | 暴击资格与暴击策略 | manual_review | formula | crit_policy_gap | gap | 装备效果和持续伤害可以暴击，属于 packet 资格策略。 | communitydragon/latest/zh_cn/arena.json#augments[38] |
| augment:10 | 炮灰 | CannonFodder | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_precombat_mobility | filtered | 大炮入场属于回合开场位移语义。 | communitydragon/latest/zh_cn/arena.json#augments[39] |
| augment:233 | 终极转盘 | UltimateRoulette | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[40] |
| augment:310 | 小丑学院 | ClownCollege | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[41] |
| augment:251 | 疼痛钝感 | NumbToPain | 0 | 比例与阈值 | manual_review | formula | incoming_damage_split_gap | gap | 部分所受伤害延后为持续流血，暴露 incoming damage split / delayed damage buffer 缺口。 | communitydragon/latest/zh_cn/arena.json#augments[42] |
| augment:322 | 强化之能量 | AugmentedPower | 0 | 比例与阈值 | needs_conversion | formula | damage_formula_base + source_packet_filter | partial | 只放大强化符文和装备来源的伤害，需要 packet source 过滤。 | communitydragon/latest/zh_cn/arena.json#augments[43] |
| augment:53 | 科学狂人 | MadScientist | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[44] |
| augment:57 | 山脉龙魂 | MountainSoul | 0 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | communitydragon/latest/zh_cn/arena.json#augments[45] |
| augment:88 | 终极刷新 | UltimateRevolution | 2 | 资源与节奏 | needs_conversion | tempo | reset_skill_cd | partial | 每回合一次，在施放终极技能后刷新终极技能。 | communitydragon/latest/zh_cn/arena.json#augments[46] |
| augment:236 | 诡术恶魔 | TricksterDemon | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[47] |
| augment:171 | 去质 | Dematerialize | 0 | 属性派生与穿透顺序 | core_1v1 | attr | adaptive_force | covered |  | communitydragon/latest/zh_cn/arena.json#augments[48] |
| augment:250 | 一板一眼 | SlowAndSteady | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[49] |
| augment:39 | 冰霜 幽灵 | FrostWraith | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | communitydragon/latest/zh_cn/arena.json#augments[50] |
| augment:79 | 战争交响乐 | SymphonyofWar | 2 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[51] |
| augment:86 | 精准奇才 | TrueshotProdigy | 2 | 控制效果与锁窗 | core_1v1 | control | per_target_lockout | partial | 每目标冷却与重复施放锁窗应单独保留。 | communitydragon/latest/zh_cn/arena.json#augments[52] |
| augment:30 | 尤里卡 | Eureka | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[53] |
| augment:60 | 海洋龙魂 | OceanSoul | 0 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[54] |
| augment:321 | 保镖 | Bodyguard | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[55] |
| augment:15 | 生机绽放 | CircleofDeath | 2 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[56] |
| augment:156 | 任务：沃格勒特的巫师帽 | Quest_WoogletsWitchcap | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_loadout_meta | filtered | 任务奖励依赖装备持有与替换，属于 loadout 元层。 | communitydragon/latest/zh_cn/arena.json#augments[57] |
| augment:27 | 大地苏醒 | Earthwake | 2 | 命中触发与标记结算 | core_1v1 | mark | mark_state | covered |  | communitydragon/latest/zh_cn/arena.json#augments[58] |
| augment:170 | 万用瞄准镜 | ScopedWeapons | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 攻击距离视为基础战斗属性。 | communitydragon/latest/zh_cn/arena.json#augments[59] |
| augment:103 | 面包和黄油 | BreadAndButter | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[60] |
| augment:82 | 残暴之力 | TheBrutalizer | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[61] |
| augment:76 | 天音爆 | SonicBoom | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[62] |
| augment:107 | 接二连三 | TwiceThrice | 1 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[63] |
| augment:239 | 共生突变 | SymbioticMutation | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[64] |
| augment:13 | 星界躯体 | CelestialBody | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[65] |
| augment:324 | 勇中最勇 | BravestoftheBrave | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[66] |
| augment:150 | 面包和果酱 | BreadAndJam | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[67] |
| augment:98 | 急急小子 | WithHaste | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[68] |
| augment:34 | 堕落圣盾 | FallenAegis | 0 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | communitydragon/latest/zh_cn/arena.json#augments[69] |
| augment:198 | 圣火 | HolyFire | 1 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[70] |
| augment:311 | 溢流 | Overflow | 1 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[71] |
| augment:35 | 感受燃烧 | FeeltheBurn | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[72] |
| augment:42 | 恶趣味 | GuiltyPleasure | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[73] |
| augment:71 | 更万用的瞄准镜 | ScopierWeapons | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 攻击距离视为基础战斗属性。 | communitydragon/latest/zh_cn/arena.json#augments[74] |
| augment:9 | 霸符兄弟 | BuffBuddies | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[75] |
| augment:125 | 副本BOSS | RaidBoss | 2 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[76] |
| augment:63 | 狂徒豪气 | OutlawsGrit | 1 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[77] |
| augment:26 | 唯快不破 | DontBlink | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[78] |
| augment:73 | 暗影疾奔 | ShadowRunner | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[79] |
| augment:45 | 炼狱导管 | InfernalConduit | 2 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | communitydragon/latest/zh_cn/arena.json#augments[80] |
| augment:205 | 物理转魔法 | ADAPt | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[81] |
| augment:4 | 回归基本功 | BacktoBasics | 2 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[82] |
| augment:224 | 棱彩蛋 | PrismaticEgg | 2 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[83] |
| augment:110 | 晾衣绳 | Clothesline | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[84] |
| augment:102 | 请勿追击 | DontChase | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[85] |
| augment:77 | 灵魂虹吸 | SoulSiphon | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[86] |
| augment:234 | 财运锻造器 | GambaAnvil | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[87] |
| augment:301 | 神圣干预 | DivineIntervention | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[88] |
| augment:84 | 穿针引线 | ThreadtheNeedle | 1 | 属性派生与穿透顺序 | core_1v1 | attr | penetration_modifier | covered |  | communitydragon/latest/zh_cn/arena.json#augments[89] |
| augment:151 | 面包和奶酪 | BreadAndCheese | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[90] |
| augment:149 | 不动如山 | Impassable | 1 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[91] |
| augment:317 | 潘朵拉的盒子 | PandorasBox | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_random_bundle_meta | filtered | 随机替换强化符文属于 loadout 元层。 | communitydragon/latest/zh_cn/arena.json#augments[92] |
| augment:33 | 弹簧飞爪 | ExtendoArm | 1 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[93] |
| augment:75 | 慢炖 | SlowCooker | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | communitydragon/latest/zh_cn/arena.json#augments[94] |
| augment:24 | 择日赴死 | DieAnotherDay | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[95] |
| augment:404 | 404 强化符文未找到 | Augment404 | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_debug_placeholder | filtered | 调试/占位强化，不进入主链路。 | communitydragon/latest/zh_cn/arena.json#augments[96] |
| augment:225 | 双刀流 | DualWield | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[97] |
| augment:405 | 强化符文405 | Augment405 | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_debug_placeholder | filtered | 依赖帽子占位机制的调试强化，不进入主链路。 | communitydragon/latest/zh_cn/arena.json#augments[98] |
| augment:78 | 灵魂连接 | SpiritLink | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[99] |
| augment:217 | 死亡触摸 | Deathtouch | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[100] |
| augment:192 | 任务：惩戒天使 | Quest_AngelofRetribution | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[101] |
| augment:17 | 职业杀手 | ContractKiller | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[102] |
| augment:138 | 渴血 | Goredrink | 0 | 护盾治疗吸血 | core_1v1 | sustain | lifesteal | covered |  | communitydragon/latest/zh_cn/arena.json#augments[103] |
| augment:312 | 我们马上就回来 | WellBeRightBack | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[104] |
| augment:333 | 任务：熔铸之神的仪式 | Quest_RiteOfTheForgeGod | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_shop_anvil_meta | filtered | 购买锻造器后升级装备属于 loadout 元层。 | communitydragon/latest/zh_cn/arena.json#augments[105] |
| augment:37 | 急救用具 | FirstAidKit | 0 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[106] |
| augment:61 | 回力OK镖 | OkBoomerang | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[107] |
| augment:357 | 双管齐下 | Hybrid | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[108] |
| augment:338 | 蜂巢思维 | HiveMind | 2 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[109] |
| augment:319 | 任务：三圣宝 | Quest_ThreeSacredTreasures | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[110] |
| augment:49 | 果汁盒 | JuiceBox | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[111] |
| augment:115 | 最万用的瞄准镜 | ScopiestWeapons | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered | 攻击距离视为基础战斗属性。 | communitydragon/latest/zh_cn/arena.json#augments[112] |
| augment:232 | 史莱姆时间 | SlimeTime | 0 | 护盾治疗吸血 | core_1v1 | sustain | heal_on_hit | covered |  | communitydragon/latest/zh_cn/arena.json#augments[113] |
| augment:216 | 恐惧使者 | Dreadbringer | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[114] |
| augment:320 | 精算风险 | CalculatedRisk | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[115] |
| augment:204 | 叠角龙 | StackosaurusRex | 0 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[116] |
| augment:206 | 魔法转物理 | escAPADe | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[117] |
| augment:194 | 精怪魔法 | FeyMagic | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[118] |
| augment:36 | 火上浇油 | Firebrand | 1 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[119] |
| augment:219 | 末日预言者 | Doomsayer | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[120] |
| augment:116 | 闪现向前 | Flashy | 1 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | communitydragon/latest/zh_cn/arena.json#augments[121] |
| augment:177 | 套娃 | NestingDoll | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[122] |
| augment:81 | 踢踏舞 | TapDancer | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[123] |
| augment:220 | 连拨击锤 | FanTheHammer | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[124] |
| augment:85 | 折磨之叉 | Tormentor | 0 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[125] |
| augment:104 | 仆从大师 | Minionmancer | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[126] |
| augment:331 | 多功能工具 | Multitool | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[127] |
| augment:313 | 坦克引擎 | TankEngine | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[128] |
| augment:29 | 虚幻武器 | EtherealWeapon | 1 | 命中触发与标记结算 | manual_review | trigger | ability_on_hit_bridge_gap | gap | 技能施加攻击特效并带每目标冷却，暴露 ability -> on-hit bridge 缺口。 | communitydragon/latest/zh_cn/arena.json#augments[129] |
| augment:62 | 全能龙魂 | OmniSoul | 2 | 需过滤或待人工归类 | needs_conversion | filter | filter_random_bundle_meta | filtered | 需在战斗前预展开为 3 个具体龙魂效果。 | communitydragon/latest/zh_cn/arena.json#augments[130] |
| augment:20 | 黎明使者的坚决 | DawnbringersResolve | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[131] |
| augment:207 | 纹丝不动 | HoldVeryStill | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[132] |
| augment:38 | 有始有终 | FromBeginningToEnd | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[133] |
| augment:335 | 避难所 | PanicRoom | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[134] |
| augment:240 | 寄生突变 | ParasiticMutation | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_random_bundle_meta | filtered | 每回合突变为敌方强化属于元层替换语义。 | communitydragon/latest/zh_cn/arena.json#augments[135] |
| augment:11 | 你摸不到 | CantTouchThis | 2 | 控制效果与锁窗 | core_1v1 | control | defensive_window | partial | 施放终极技能后获得短时 0 伤害和控制免疫窗口。 | communitydragon/latest/zh_cn/arena.json#augments[136] |
| augment:176 | 雪球大战！ | SnowballFight | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[137] |
| augment:47 | 关键暴击 | ItsCritical | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[138] |
| augment:200 | 血亲兄弟 | BloodBrother | 1 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[139] |
| augment:112 | 终极不可阻挡 | UltimateUnstoppable | 0 | 控制效果与锁窗 | core_1v1 | control | control_immunity_window | partial | 施放终极技能后获得短时霸体/控制免疫，不应继续过滤。 | communitydragon/latest/zh_cn/arena.json#augments[140] |
| augment:68 | 循环往复 | Recursion | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[141] |
| augment:228 | 属性叠属性叠属性！ | StatsOnStatsOnStats | 2 | 需过滤或待人工归类 | needs_conversion | filter | filter_shop_anvil_meta | filtered | 属性锻造器属于 loadout 预展开奖励，不直接进入战斗时公式。 | communitydragon/latest/zh_cn/arena.json#augments[142] |
| augment:22 | 灵巧 | Deft | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[143] |
| augment:41 | 歌利亚巨人 | Goliath | 2 | 属性派生与穿透顺序 | core_1v1 | attr | adaptive_force | covered |  | communitydragon/latest/zh_cn/arena.json#augments[144] |
| augment:242 | 榨汁机 | JuicePress | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[145] |
| augment:305 | 练腿日 | LegDay | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | communitydragon/latest/zh_cn/arena.json#augments[146] |
| augment:221 | 引路者 | Trailblazer | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | communitydragon/latest/zh_cn/arena.json#augments[147] |
| augment:1 | 加速巫术 | AcceleratingSorcery | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[148] |
| augment:343 | 正义之怒 | RighteousFury | 2 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[149] |
| augment:208 | 轨道镭射 | OrbitalLaser | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[150] |
| augment:344 | 能量充沛 | Energetic | 0 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | communitydragon/latest/zh_cn/arena.json#augments[151] |
| augment:58 | 秘术冲拳 | MysticPunch | 2 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | communitydragon/latest/zh_cn/arena.json#augments[152] |
| augment:105 | 家园卫士 | Homeguard | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_precombat_mobility | filtered | 回合开场移速与受伤后失效属于进场节奏语义。 | communitydragon/latest/zh_cn/arena.json#augments[153] |
| augment:3 | 虚无强化符文 | NullAugment | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_debug_placeholder | filtered | 占位强化，不进入主链路。 | communitydragon/latest/zh_cn/arena.json#augments[154] |
| augment:241 | 帽子戏法 | HatTrick | 1 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | communitydragon/latest/zh_cn/arena.json#augments[155] |
| augment:181 | 重量级打击手 | HeavyHitter | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | communitydragon/latest/zh_cn/arena.json#augments[156] |
| augment:67 | 古式佳酿 | RabbleRousing | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[157] |
| augment:195 | 巨人杀手 | GiantSlayer | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[158] |
| augment:238 | 质变：棱彩阶 | TransmutePrismatic | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_random_bundle_meta | filtered | 额外棱彩强化属于 meta/loadout 元层。 | communitydragon/latest/zh_cn/arena.json#augments[159] |
| augment:40 | 冰封地基 | FrozenFoundations | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[160] |
| augment:118 | 会心治疗 | CriticalHealing | 1 | 暴击资格与暴击策略 | manual_review | sustain | crit_policy_gap | gap | 治疗和护盾可以暴击，属于 heal/shield crit policy。 | communitydragon/latest/zh_cn/arena.json#augments[161] |
| augment:237 | 质变：黄金阶 | TransmuteGold | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[162] |
| augment:2 | 尖端发明家 | ApexInventor | 1 | 资源与节奏 | needs_conversion | tempo | item_haste_modifier | partial | 全局装备急速作用于所有装备技能冷却。 | communitydragon/latest/zh_cn/arena.json#augments[163] |
| augment:172 | 镜花水月 | MirrorImage | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[164] |
| augment:218 | 亵渎者 | Desecrator | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[165] |
| augment:141 | 全心为你 | AllForYou | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[166] |
| augment:50 | 基石法师 | KeystoneConjurer | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[167] |
| augment:174 | 镭射眼 | LaserEyes | 2 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[168] |
| augment:326 | 灵之灌注 | SpiritInfusion | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[169] |
| augment:227 | 属性叠属性！ | StatsOnStats | 1 | 需过滤或待人工归类 | needs_conversion | filter | filter_shop_anvil_meta | filtered | 属性锻造器属于 loadout 预展开奖励，不直接进入战斗时公式。 | communitydragon/latest/zh_cn/arena.json#augments[170] |
| augment:19 | 全凭身法 | Dashing | 2 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | communitydragon/latest/zh_cn/arena.json#augments[171] |
| augment:229 | 火爆甩卖 | FireSale | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_shop_anvil_meta | filtered | 售卖装备换钱属于商店/经济层。 | communitydragon/latest/zh_cn/arena.json#augments[172] |
| augment:52 | 闪电打击 | LightningStrikes | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[173] |
| augment:314 | 解脱者 | Unshackled | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[174] |
| augment:69 | 退敌力场 | Repulsor | 0 | 需过滤或待人工归类 | needs_conversion | filter | filter_out_of_scope | filtered | 控制、位移或区域机制先不进 1v1 核心链路。 | communitydragon/latest/zh_cn/arena.json#augments[175] |
| augment:113 | 老练狙神 | SkilledSniper | 1 | 资源与节奏 | core_1v1 | tempo | remaining_charges | partial | 可能需要区分充能、返还与重置。 | communitydragon/latest/zh_cn/arena.json#augments[176] |
| augment:175 | 寄生关系 | ParasiticRelationship | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[177] |
| augment:165 | 重启 | Restart | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[178] |
| augment:134 | 亮出你的剑 | DrawYourSword | 2 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[179] |
| augment:70 | 无休回复 | RestlessRestoration | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[180] |
| augment:25 | 俯冲轰炸 | DiveBomber | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_ratio | covered |  | communitydragon/latest/zh_cn/arena.json#augments[181] |
| augment:303 | 献祭：换取黄金阶 | GoHSacrificeForGold | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[182] |
| augment:7 | 大力 | BluntForce | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[183] |
| augment:109 | 誓约者 | Oathsworn | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[184] |
| augment:187 | 闪光弹 | Flashbang | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[185] |
| augment:336 | 瞄准脑袋 | AimForTheHead | 1 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | communitydragon/latest/zh_cn/arena.json#augments[186] |
| augment:123 | 召唤师峡谷的轮盘 | SummonersRoulette | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[187] |
| augment:302 | 献祭：换取白银阶 | GoHSacrificeForSilver | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_random_bundle_meta | filtered | 按回合换取额外强化属于 meta 元层。 | communitydragon/latest/zh_cn/arena.json#augments[188] |
| augment:74 | 缩小射线 | ShrinkRay | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[189] |
| augment:12 | 王车易位 | Castle | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[190] |
| augment:152 | 任务：钢化你心 | Quest_SteelYourHeart | 1 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[191] |
| augment:32 | 裁决使 | Executioner | 0 | 比例与阈值 | core_1v1 | formula | execute_threshold | covered |  | communitydragon/latest/zh_cn/arena.json#augments[192] |
| augment:18 | 巨像的勇气 | CourageoftheColossus | 2 | 护盾治疗吸血 | needs_conversion | sustain | shield_granted_proc | partial | 需要护盾事件订阅。 | communitydragon/latest/zh_cn/arena.json#augments[193] |
| augment:222 | 你的劳动果实 | FruitsOfYourLabor | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[194] |
| augment:46 | 炼狱龙魂 | InfernalSoul | 0 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[195] |
| augment:16 | 连招大师 | ComboMaster | 1 | 比例与阈值 | core_1v1 | formula | damage_formula_base | covered |  | communitydragon/latest/zh_cn/arena.json#augments[196] |
| augment:215 | 黑暗赐福 | DarkBlessing | 1 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[197] |
| augment:56 | 由心及物 | MindtoMatter | 0 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[198] |
| augment:211 | 杀戮时间到了 | ItsKillingTime | 1 | 命中触发与标记结算 | core_1v1 | mark | stored_damage_on_mark | partial | 终极技能后对全体敌人附着死亡标记，并储伤到期引爆。 | communitydragon/latest/zh_cn/arena.json#augments[199] |
| augment:96 | 时光之智慧 | WisdomofAges | 2 | 叠层与时效 | core_1v1 | counter | counter_state | partial | 可能需要 seed、阈值或周期触发。 | communitydragon/latest/zh_cn/arena.json#augments[200] |
| augment:304 | 献祭：换取棱彩阶 | GoHSacrificeForPrismatic | 2 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 以回合为单位换取额外棱彩强化，属于 meta 层。 | communitydragon/latest/zh_cn/arena.json#augments[201] |
| augment:43 | 位移魔术 | NowYouSeeMe | 0 | 需过滤或待人工归类 | skip_for_now | filter | filter_out_of_scope | filtered | 涉及主链路外语义，先过滤。 | communitydragon/latest/zh_cn/arena.json#augments[202] |
| augment:64 | 坚韧 | Perseverance | 1 | 基础属性加成 | core_1v1 | attr | flat_stat_bonus | covered |  | communitydragon/latest/zh_cn/arena.json#augments[203] |
| augment:48 | 珠光护手 | JeweledGauntlet | 2 | 暴击资格与暴击策略 | manual_review | formula | crit_policy_gap | gap | 技能暴击资格、暴击伤害倍率与 AP 转暴击几率属于独立 crit policy 缺口。 | communitydragon/latest/zh_cn/arena.json#augments[204] |
| augment:309 | 还有我的斧头！ | AndMyAxe | 1 | 资源与节奏 | needs_conversion | tempo | periodic_proc + refund_cooldown | partial | 自动施法、减速、双穿甲碎与拾取后缩冷却并存。 | communitydragon/latest/zh_cn/arena.json#augments[205] |

## 当前备注

- 海克斯强化后续可能需要按稀有度和内部 API 名批量筛选。
- 当前先做覆盖审计，不提前进入模式规则草案。
