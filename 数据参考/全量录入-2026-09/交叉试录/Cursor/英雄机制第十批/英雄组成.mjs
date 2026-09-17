import {start,datum,fixed,input,calc,sourceOnly} from './计算树候选.mjs';
import {common,formula,pending,exclude,statEffect,effect,result,pn,attr,op,add,mul,val,fval} from './候选.mjs';
const targetHP=attr('hp','TARGET','TOTAL'),missingHP=attr('hp','TARGET','MISSING');
function rows(x,items){for(const[source,key,name,scale]of items)datum(x,source,key,name,scale==null?{}:{scale});}
function damageGap(x){pending(x,'伤害资格及实际事件','确定伤害公式尚未接实际命中；暴击、吸血、法术护盾及归属资格未逐项证明，不创建默认DAMAGE、空命中规则或占位过程。','来源');}
function skip(x,names,reason){for(const name of names)sourceOnly(x,'DataValues.'+name,reason,'范围外');}

// 格雷福斯：采纳草稿的首弹/后续弹、两段Q、初始W、E逐层防御、R两分支源值。
{
 const x=start('graves_p');rows(x,[['CritDamageRatio','crit_damage_ratio','暴击弹丸伤害增幅系数']]);
 const first=calc(x,'SingleBulletDamage','single_bullet_damage','同一目标首颗弹丸物理伤害','总攻击力乘实际等级系数；原31点表的等级索引未证');
 const next=calc(x,'MultiBulletDamage','subsequent_bullet_damage','同一目标后续弹丸物理伤害','原计算为首弹伤害的0.333倍');
 calc(x,'CritDamageMult','crit_pellet_increase','暴击弹丸伤害增幅比例','原节点mStat9未解码，以实际输入保留；不以角色基础暴击倍率2替代活体属性');
 fixed(x,'normal_pellet_count','非暴击弹丸总数',4,'当前中文明确每次攻击发射4颗弹丸。','当前绑定keyTooltip');
 fixed(x,'crit_pellet_count','暴击弹丸总数',6,'当前中文明确暴击改为6颗。','当前绑定keyTooltip');
 fixed(x,'ammo_capacity','弹药容量',2,'当前中文明确只有2颗子弹。','当前绑定keyTooltip');
 fixed(x,'normal_followup_count','四弹全中时后续弹丸数',3,'明确4弹减首弹1颗；仅用于全部命中同一英雄的分支。','当前绑定keyTooltip：4−1');
 formula(x,'four_pellets_same_target','非暴击四弹全中同一目标总伤害',add(first,mul(pn('normal_followup_count'),next)),'条件是非暴击且四弹真实命中同一英雄；不把该条件当每次攻击默认。');
 skip(x,['StructureDamageReduction'],'只对建筑减伤，不应用于当前英雄。');exclude(x,'非英雄击退','原文仅击退非英雄，纯非英雄结果不录入。');
 pending(x,'弹药、装填及弹丸命中','攻击速度影响装填和开火间隔的函数未证；实际弹数、命中分布、弹药消耗与装填未接线。','系统');damageGap(x);
}
{
 const x=start('graves_q');common(x);rows(x,[['BaseDamage','base_damage','火药卷基础物理伤害'],['FirstADRatio','bonus_ad_ratio','火药卷额外攻击力系数'],['BaseDetonationDamage','detonation_base_damage','引爆基础物理伤害'],['bADDetonationRatio','detonation_bonus_ad_ratio','引爆额外攻击力系数']]);
 calc(x,'TotalDamage','initial_damage','火药卷物理伤害','第一段基础值加额外攻击力系数');calc(x,'TotalDetonationDamage','detonation_damage','火药卷引爆物理伤害','第二段基础值加逐级额外攻击力系数，不能自动与第一段叠加');
 fixed(x,'normal_detonation_delay_ms','普通引爆等待时间（毫秒）',1000,'当前中文明确1秒后引爆；不是假造客户端数组。','当前绑定keyTooltip');
 sourceOnly(x,'DataValues.TerrainCollisionDelay','原字段0.2秒保留，中文称碰地形后引爆；实际碰撞到爆炸消费链未证，不能当作纯几何删掉或直接把冲突补零。');
 pending(x,'两段伤害与地形提前引爆','延迟影响1V1实际伤害时点，保留普通1秒及碰撞源字段；两段实际命中及提前时序未接线。','系统');damageGap(x);
}
{
 const x=start('graves_w');common(x);rows(x,[['BaseDamage','base_damage','烟幕初始基础魔法伤害'],['SlowAmount','slow_ratio','烟幕减速比例',.01],['SmokeDuration','smoke_duration_ms','烟幕存在时间（毫秒）',1000],['SlowDuration','slow_linger_ms','原减速时长字段（毫秒）',1000]]);
 calc(x,'ImpactDamage','impact_damage','烟幕初始冲击魔法伤害','基础伤害加0.6法强');skip(x,['SmokeRadius'],'纯烟幕空间半径，不进入本轮数值组成。');
 pending(x,'烟幕减速与区域失明','烟幕存在4秒，原减速字段0.5秒；区域内刷新、离开延续及失明控制资格未证，不能以0.5秒替代整片烟幕作用或将失明当伤害。','系统');damageGap(x);
}
{
 const x=start('graves_e');common(x);rows(x,[['ArmorPerStack','armor_per_stack','每层护甲'],['MRGrantPercent','mr_grant_ratio','每层魔抗相对护甲比例'],['BuffDuration','buff_duration_ms','纯爷们层数持续（毫秒）',1000],['MaxStacks','max_stacks','纯爷们最大层数'],['CooldownPerHit','cooldown_reduction_per_pellet_ms','每颗弹丸命中减少冷却（毫秒）',1000]]);
 const mr=calc(x,'MRGrant','mr_per_stack','每层魔法抗性','每层护甲乘0.5');
 input(x,'current_grit_stacks','当前实际纯爷们层数','只接已确认的当前层数，合法0至8；不默认满层，也不由朝向猜层数。','INTEGER');
 fixed(x,'normal_dash_stacks','普通突进获得层数',1,'中文普通突进获得一层。','当前绑定keyTooltip');fixed(x,'toward_enemy_total_stacks','朝敌人突进单次获得总层数',2,'中文为获得2层总数，不是在1层基础上额外增加2层。','当前绑定keyTooltip');fixed(x,'ammo_reload_count','突进装填子弹数',1,'当前中文明确装填一颗子弹。','当前绑定keyTooltip');
 formula(x,'current_grit_armor','当前层数护甲总增益',mul(pn('armor_per_stack'),pn('current_grit_stacks')),'每层护甲乘当前实际层数。');formula(x,'current_grit_mr','当前层数魔抗总增益',mul(mr,pn('current_grit_stacks')),'每层魔抗乘当前实际层数。');
 statEffect(x,'grit_armor','纯爷们当前护甲增益',fval('current_grit_armor'),'armor',{duration:val('buff_duration_ms'),description:'将已确认的当前总层数作为单份属性快照，持续4秒；刷新替换总值。朝向、叠层和非小兵伤害刷新未自动触发。'});
 statEffect(x,'grit_mr','纯爷们当前魔抗增益',fval('current_grit_mr'),'magic_resistance',{duration:val('buff_duration_ms'),description:'已确认总层数的魔抗快照，与护甲同时应用/取消；不自行叠到8层。'});
 effect(x,'pellet_cooldown_reduction','单颗真实弹丸命中减少E冷却',[result('reduce_e','减少快速拔枪冷却','COOLDOWN_CHANGE','SOURCE',val('cooldown_reduction_per_pellet_ms'),{operation:'REDUCE',affectedSkillScope:{mode:'SKILLS',skillKeys:['graves_e'],skillCategoryKeys:[]}})],null,'中文明确每颗弹丸命中减少0.5秒，候选为500毫秒；真实弹丸命中事件尚未接线。');
 skip(x,['DashSpeed','DashMaxDistance','DashMinDistance','DashAngle'],'纯位移几何不进入当前数值；朝敌人获得两层的资格另行保留。');pending(x,'纯爷们与弹药的状态事件','层数刷新和朝英雄双层、弹丸命中减少冷却、装填一颗子弹均须实际事件；不创建默认触发或过程。','系统');
}
{
 const x=start('graves_r');common(x);rows(x,[['RBaseDamage','base_damage','爆破弹直击基础物理伤害'],['RFalloffDamage','explosion_base_damage','爆裂分支基础物理伤害']]);
 calc(x,'Damage','direct_damage','终极爆弹直击物理伤害','首个目标伤害');calc(x,'FalloffDamage','explosion_damage','终极爆弹爆裂物理伤害','仅爆裂分支命中当前英雄时使用；未证明同一目标可同时承受直击与爆裂，不合并');skip(x,['RKnockbackDistance'],'自身后坐位移距离为几何，不用于当前伤害公式。');damageGap(x);
}

// 金克丝：采纳草稿的模式成本区分及上下限；百分比点和时间转成明确系统单位。
{
 const x=start('jinx_p');rows(x,[['BuffDuration','buff_duration_ms','罪恶快感持续（毫秒）',1000],['ASBuff','attack_speed_ratio','每次攻速增益比例',.01],['MSBuff','initial_move_speed_ratio','初始移动速度增益比例',.01],['AssistMarkerDuration','assist_marker_duration_ms','参与击杀伤害标记窗口（毫秒）',1000]]);fixed(x,'champion_max_stacks','英雄参与击杀攻速最大层数',5,'当前中文明确至多叠加5次，不设置当前层数默认。','当前绑定keyTooltip');
 sourceOnly(x,'DataValues.MSDecayRate','原衰减0.875参数的时间函数未证；不能均分六秒。');pending(x,'收益触发与攻速叠加','英雄参与击杀保留；史诗野怪/建筑触发只留外部来源条件，自身收益不整项删除。攻速是加算还是对总攻速乘算、逐层刷新及突破上限规则未证，只存确定比例和窗口。','系统');
}
{
 const x=start('jinx_q');common(x,{mana:false});rows(x,[['RocketTAD','rocket_total_ad_ratio','火箭总攻击力系数'],['RocketBonusRange','rocket_bonus_range','火箭额外攻击距离'],['RocketASPDPenalty','rocket_bonus_attack_speed_penalty','火箭攻速加成减少比例'],['MinigunAttackSpeedMax','minigun_max_attack_speed_ratio','轻机枪最大额外攻速比例',.01],['MinigunAttackSpeedDuration','minigun_stack_duration_ms','轻机枪攻速层时长（毫秒）',1000],['MinigunAttackSpeedStacks','minigun_max_stacks','轻机枪最大层数']]);
 fixed(x,'rocket_mana_cost','每发火箭法力消耗',20,'官方cost与当前mana均20；当前keyCost明确每发火箭，mDoesNotConsumeMana=true表示切换不扣这笔法力。','官方cost + manaValues + 当前keyCost');calc(x,'RocketDamage','rocket_damage','火箭当前目标物理伤害','1.1总攻击力，只取当前目标');
 effect(x,'rocket_mana_cost','每发真实火箭消耗法力',[result('consume_rocket_mana','消耗火箭法力','RESOURCE_CHANGE','SOURCE',val('rocket_mana_cost'),{attributeKey:'mana',operation:'CONSUME'})],null,'仅真实火箭攻击扣20法力；不能挂到武器切换施放。');
 statEffect(x,'rocket_range','火箭模式额外攻击距离',val('rocket_bonus_range'),'attack_range',{description:'仅鱼骨头激活时提供攻击距离；退出该模式必须显式移除，未创建默认武器选择和初始化规则。'});
 skip(x,['RocketAoERadius'],'只排除附近多目标分发，主目标火箭伤害保留。');pending(x,'武器切换、攻速层和冷却修正','轻机枪每层数值函数未证，不将最大值除3；层一次消散一层，切火箭后仅首击继承。切换冷却0.9秒且不受急速，但不生成冷却过程或默认武器状态。','系统');damageGap(x);
}
{
 const x=start('jinx_w');common(x,{cast:false});rows(x,[['Damage','base_damage','震荡波基础物理伤害'],['ADRatio','total_ad_ratio','震荡波总攻击力系数'],['SlowPercent','slow_ratio','震荡波减速比例',.01],['SlowDuration','slow_duration_ms','震荡波减速持续（毫秒）',1000]]);calc(x,'TotalDamage','damage','震荡波物理伤害','基础值加1.4总攻击力');
 for(const n of ['JinxLowEndWCastTime','JinxWASpeedCastTimeScalarPerHundrethSecond'])sourceOnly(x,'DataValues.'+n,'攻击速度缩短施法时间属于1V1时序；保留原值，求值未证，不作为范围外删掉也不套固定0.25秒。');exclude(x,'单纯显形视野','视野显示不进入当前数值计算；减速与伤害保留。');pending(x,'减速与实际命中','减速资格、护盾和真实命中事件未接线。','系统');damageGap(x);
}
{
 const x=start('jinx_e');common(x);rows(x,[['Damage','base_damage','手雷基础魔法伤害'],['RootDuration','root_duration_ms','手雷禁锢持续（毫秒）',1000],['GrenadeDuration','grenade_duration_ms','手雷存在时间（毫秒）',1000],['GrenadeArmTime','arm_time_ms','手雷部署武装延迟（毫秒）',1000]]);calc(x,'TotalDamage','damage','嚼火者手雷魔法伤害','命中当前英雄的一次爆炸，不能把3颗布置直接乘三');pending(x,'陷阱、禁锢与中断位移','0.5秒武装延迟影响单挑，不作为几何删除；手雷消耗、同一目标是否再次触发、禁锢和中断位移资格未证。','系统');exclude(x,'三颗手雷布置几何','只排除空间布置，不删除命中时序和中断位移控制依赖。');damageGap(x);
}
{
 const x=start('jinx_r');common(x);rows(x,[['BaseDamage','base_damage_floor','飛弹下限基础伤害'],['MaxDamage','base_damage_max','飞弹上限基础伤害'],['PercentDamage','missing_health_ratio','飞弹目标已损生命伤害比例',.01]]);
 const lo=calc(x,'DamageFloor','damage_floor','飞弹基础伤害下限','不含已损生命项，飞行时间插值未证'),hi=calc(x,'DamageMax','damage_max','飞弹基础伤害上限','不含已损生命项');formula(x,'missing_health_bonus','已损失生命额外伤害',mul(pn('missing_health_ratio'),missingHP),'当前中文明确目标已损生命比例伤害。');formula(x,'max_damage_with_missing_health','飞弹上限加已损生命伤害',add(hi,mul(pn('missing_health_ratio'),missingHP)),'仅伤害上限分支；不以飞行时间或距离自行线性插值。');
 skip(x,['AoEDamageMult','AoERadius'],'仅附近目标分发，当前主目标伤害独立保留。');skip(x,['MonsterExecuteMax'],'仅野怪已损生命封顶，当前敌方英雄不使用。');pending(x,'飞行时间增伤','当前中文说明时间超过1秒继续提升，但没有完整增伤函数；只保留下限、上限与已损生命确定项。','来源');damageGap(x);
}

// 韦鲁斯：保留两种击杀来源的自身收益，基础冷却返还和蓄力收益分别核单位与资格。
{
 const x=start('varus_p');rows(x,[['PassiveAS','champion_attack_speed_ratio','英雄参与击杀攻速比例'],['AStoADMinion','nonchampion_ad_ratio','普通击杀攻击力换算系数'],['AStoAPMinion','nonchampion_ap_ratio','普通击杀法强换算系数'],['AStoADChampion','champion_ad_ratio','英雄参与击杀攻击力换算系数'],['AStoAPChampion','champion_ap_ratio','英雄参与击杀法强换算系数']]);
 for(const[key,id,name]of [['MinionAS','ordinary_attack_speed','普通击杀实际攻速比例'],['ChampionAS','champion_attack_speed','英雄参与击杀攻速比例'],['ASDuration','buff_duration_seconds','击杀增益实际持续秒数'],['MinionAD','ordinary_ad','普通击杀攻击力增益'],['MinionAP','ordinary_ap','普通击杀法强增益'],['ChampionAD','champion_ad','英雄参与击杀攻击力增益'],['ChampionAP','champion_ap','英雄参与击杀法强增益']])calc(x,key,id,name,'当前绑定的自身收益，普通击杀与英雄参与击杀为替代分支而非同时叠加');
 for(const n of ['PassiveASMinion','PassiveASRatio','PassiveASRatioMinion','NewASCap'])sourceOnly(x,'DataValues.'+n,'当前具名计算未引用；不以旧字段替代实际等级节点或猜突破上限值。');
 pending(x,'持续时间与属性换算口径','等级时长和普通攻速断点不展开；mStat4/formula2未知，AD/AP换算保留实际输入。自身收益不因触发源可为小兵而整项删除；外部准备状态和真实击杀归因需接线。','系统');
}
{
 const x=start('varus_q');common(x,{channelDuration:true});rows(x,[['BaseDamageMax','max_base_damage','满蓄力基础物理伤害'],['tADRatioMax','max_bonus_ad_ratio','满蓄力额外攻击力系数'],['ChargeMultiplierInverse','minimum_damage_multiplier','未蓄力相对满蓄力系数'],['MaxChargeAmp','max_charge_bonus_ratio','原最大蓄力增幅比例'],['ManaRefund','mana_refund_ratio','取消时法力消耗返还比例'],['MaxChannelDuration','cancel_deadline_ms','未释放取消期限（毫秒）',1000],['MoveSpeedMod','self_slow_ratio','蓄力自身减速比例',-1]]);
 calc(x,'TotalDamageMax','damage_max','满蓄力穿刺之箭物理伤害','原字段名含tAD但计算节点显式mStat2/formula2，按额外攻击力计算');calc(x,'TotalDamageMinTooltip','damage_min','最小蓄力穿刺之箭物理伤害','源计算直接用ChargeMultiplierInverse乘满蓄力伤害');
 input(x,'actual_mana_spent','本次实际已消耗法力','只取本次蓄力已确认的法力消耗；不能假定等于未修正基础成本。');formula(x,'cancel_mana_refund','取消蓄力法力返还量',mul(pn('mana_refund_ratio'),pn('actual_mana_spent')),'达到4秒未释放而取消时返还本次消耗50%；不当冷却比例使用，也不无条件恢复。');
 sourceOnly(x,'DataValues.CDRefund','原字段3的当前取消冷却消费链未证，当前中文只明确法力返还；不猜成3秒或50%冷却效果。');skip(x,['FalloffPercent','MinDamagePercent'],'只针对箭先命中其他敌人后的多目标衰减；当前1V1直接首个英雄不使用。');pending(x,'蓄力伤害和W引爆提升','蓄力时间到增幅的完整函数未证，不在两个端点间猜线性。Q根显式0施法时间只表示该字段，不表示箭立刻命中。W枯萎引爆与主动增伤跨技能资格保留。','系统');damageGap(x);
}
{
 const x=start('varus_w');common(x);rows(x,[['BasePercentHPPerStack','base_hp_ratio_per_stack','每层枯萎基础最大生命比例'],['VarusWOnHitDamage','on_hit_base_damage','枯萎箭袋普攻附伤基础值'],['OnHitRatio','on_hit_ap_ratio','普攻附伤法强系数'],['OnHitADRatio','on_hit_bonus_ad_ratio','普攻附伤额外攻击力系数'],['WQHealthDamage','q_empower_missing_hp_ratio','主动Q增伤基础已损生命比例'],['VarusWMaxChargeHPDamage','max_q_empower_multiplier','主动Q满蓄力增伤倍数'],['CDRPerBlightStack','base_cooldown_refund_ratio_per_stack','每层引爆返还基础冷却比例'],['DebuffDuration','blight_duration_ms','枯萎层持续（毫秒）',1000],['MaxStacks','max_blight_stacks','枯萎最大层数']]);
 const per=calc(x,'PercentHPPerStack','hp_ratio_per_stack','每层枯萎最大生命伤害比例','基础比例加法强×0.01×0.013'),on=calc(x,'OnHitDamage','on_hit_damage','枯萎箭袋普攻额外魔法伤害','基础值加0.25法强和0.15额外攻击力');
 calc(x,'MaxPercentHPPerStack','three_stack_hp_ratio','三层枯萎伤害比例上限展示','原tooltipOnly的3倍，仅上限展示，不作为当前层数');const empowered=calc(x,'QEmpowerPercentHP','q_empower_ratio','主动Q基础已损生命比例','仅W主动强化后的下一次Q'),max=calc(x,'MaxQEmpowerPercentHP','q_empower_max_ratio','主动Q满蓄力已损生命比例','确定上限1.5倍，实际蓄力过程不插值');
 input(x,'actual_detonated_stacks','本次实际引爆枯萎层数','只接实际已引爆的0至3层，不默认满层。','INTEGER');input(x,'affected_skill_base_cooldown_ms','被返还技能基础冷却毫秒','原文明确每层返还基础冷却的13%；需给对应技能该等级基础冷却，不用剩余冷却代替。');
 formula(x,'detonation_damage','本次引爆枯萎魔法伤害',mul(mul(per,pn('actual_detonated_stacks')),targetHP),'当前目标最大生命比例乘真实引爆层数；Q蓄力引爆提升另行接入。');formula(x,'q_empower_missing_damage','主动强化Q基础魔法增伤',mul(empowered,missingHP),'目标已损生命乘W主动基础比例。');formula(x,'q_empower_max_missing_damage','主动强化Q满蓄力魔法增伤',mul(max,missingHP),'目标已损生命乘满蓄力上限，不自动判断蓄力完成。');formula(x,'base_cooldown_refund_ms','对应基础技能冷却返还毫秒',mul(mul(pn('base_cooldown_refund_ratio_per_stack'),pn('actual_detonated_stacks')),pn('affected_skill_base_cooldown_ms')),'13%×实际引爆层数×对应技能基础冷却毫秒；每个受影响技能分别求值，不把同一毫秒数同时用于不同基础冷却。');
 for(const n of ['VarusWDebuffDuration','VarusWMaxStacks'])sourceOnly(x,'DataValues.'+n,'当前文本实际引用同值DebuffDuration/MaxStacks；保留重复原字段，不建重复参数。');skip(x,['MaxMonsterDamage','QEmpowerMonsterCap'],'只对野怪封顶，不用于当前英雄。');pending(x,'枯萎层与跨技能消费','W普攻附伤和叠层、Q/E/R引爆、R分期叠层、W主动的下一Q消费未接线。基础冷却返还依每个技能分别计算，当前无冷却效果或触发规则。','系统');damageGap(x);
}
{
 const x=start('varus_e');common(x);rows(x,[['BaseDamage','base_damage','恶灵箭雨基础物理伤害'],['BonusADRatio','bonus_ad_ratio','恶灵箭雨额外攻击力系数'],['SlowPercent','slow_ratio','污染地面减速比例',-1],['GrievousAmount','grievous_ratio','重伤治疗削减比例'],['GrievousDuration','grievous_duration_ms','原重伤刷新时长（毫秒）',1000],['GroundDuration','ground_duration_ms','污染地面存在时间（毫秒）',1000]]);calc(x,'TotalDamage','damage','恶灵箭雨物理伤害','一次箭雨伤害，不能当4秒每跳伤害');sourceOnly(x,'DataValues.DebuffDuration','原同值4秒字段保留，实际减速与重伤离开区域的延续关系未证，不以4秒覆盖0.5秒重伤字段。');skip(x,['AoERange'],'纯地面空间半径，不进入数值组成。');pending(x,'地面减速与重伤','停留、离开刷新及重伤与其他来源合并口径待核；不能借用黑切或其他来源乘区直接给治疗属性加算。','系统');damageGap(x);
}
{
 const x=start('varus_r');common(x);rows(x,[['BaseDamage','base_damage','腐败锁链基础魔法伤害'],['RootDuration','root_duration_ms','腐败锁链禁锢时间（毫秒）',1000],['PassiveStacks','passive_stacks_total','禁锢期间给予枯萎总层数'],['TimeBetweenStackAddition','stack_interval_ms','原枯萎加层间隔（毫秒）',1000]]);calc(x,'TotalDamage','damage','腐败锁链初始魔法伤害','当前英雄一次命中伤害，不乘后续扩散目标数');skip(x,['VarusRTargetAcquisitionRange','VarusRTargetLeashRange','VarusRLeashTimer'],'仅锁链传播到其他英雄的空间与等待字段，当前首个1V1目标不执行扩散。');for(const n of ['PassiveStacksAdded','VarusWDebuffDuration','VarusWMaxStacks'])sourceOnly(x,'DataValues.'+n,'与当前中文层数/其他技能W有关的重复原值保留，不重复建枯萎身份或猜新的叠层消费。');pending(x,'禁锢期间逐次叠层','2秒禁锢、总3层、原间隔0.5秒可确定；首层何时添加以及每层刷新/引爆依赖未证，不默认瞬间3层。','系统');damageGap(x);
}

// 克格莫：死亡后伤害、被动攻速和增伤分段独立保留，不模拟完整战斗执行。
{
 const x=start('kogmaw_p');rows(x,[['TooltipPassiveDuration','death_move_duration_ms','死亡后移动到爆炸时间（毫秒）',1000],['TooltipPassiveMS','max_death_move_speed_ratio','死亡后最高移动速度增幅']]);fixed(x,'initial_death_move_speed_ratio','死亡后初始移速增幅',.1,'当前中文明确初始10%，随后升至50%；不推测4秒线性。','当前绑定keyTooltip');calc(x,'PassiveDamage','death_explosion_damage','艾卡西亚式惊喜真实伤害','原端点140/650保留，实际等级值外供');pending(x,'死亡后移动与爆炸','死亡后4秒爆炸仍可影响1V1同归于尽，不能整项删除；移速增长函数、死亡后是否能处理事件及爆炸命中资格未接线。','系统');damageGap(x);
}
{
 const x=start('kogmaw_q');common(x);rows(x,[['AttackSpeed','passive_attack_speed_ratio','腐蚀唾液被动额外攻速比例'],['BaseDamage','base_damage','腐蚀唾液基础魔法伤害'],['APRatio','ap_ratio','腐蚀唾液法强系数'],['ShredAmount','resistance_shred_ratio','护甲与魔抗削减比例',.01],['ShredDuration','shred_duration_ms','双抗削减持续（毫秒）',1000]]);calc(x,'TotalDamage','damage','腐蚀唾液魔法伤害','基础值加0.9法强');statEffect(x,'passive_attack_speed','腐蚀唾液被动额外攻速',val('passive_attack_speed_ratio'),'bonus_attack_speed_percent',{description:'仅被动已学技能等级提供的额外攻速；初始化和等级变更由外部来源事件处理，不创建默认触发。'});pending(x,'双抗削减乘区与命中','百分比双抗削减需自己的合法乘区及跨来源组合口径；不复用黑切专用乘区，不把比例当作平减护甲，也不生成未证目标效果。','系统');damageGap(x);
}
{
 const x=start('kogmaw_w');common(x);rows(x,[['MaxHealthDamage','max_health_percent_points','每次附伤最大生命百分比点数'],['APRatio','ap_percent_points_ratio','每法强增加的最大生命百分比点数'],['Range','bonus_attack_range','生化弹幕额外攻击距离'],['Duration','duration_ms','生化弹幕持续（毫秒）',1000]]);const ratio=calc(x,'TotalHealthDamage','on_hit_max_hp_ratio','生化弹幕目标最大生命比例','原树明确0.01×(3/3.75/4.5/5.25/6 + 0.015×法强)，不能再多乘或少乘百分比换算');formula(x,'on_hit_damage','生化弹幕单次附加魔法伤害',mul(ratio,targetHP),'目标最大生命乘原计算输出比例；只在真实普通攻击附伤时消费。');statEffect(x,'attack_range','生化弹幕额外攻击距离',val('bonus_attack_range'),'attack_range',{duration:val('duration_ms'),description:'本次W激活持续8秒的额外攻击距离；不把附伤自动接到施放事件。'});skip(x,['MonsterDamageCap'],'只有野怪100伤害封顶，当前英雄不封顶。');pending(x,'攻击特效资格','当前说明明确攻击特效，但护盾/暴击/吸血及普攻本体重复结算未证，附伤只保留公式。','来源');damageGap(x);
}
{
 const x=start('kogmaw_e');common(x);rows(x,[['BaseDamage','base_damage','虚空淤泥基础魔法伤害'],['APRatio','ap_ratio','虚空淤泥法强系数'],['SlowAmount','slow_ratio','淤泥路径减速比例',.01],['TrailDuration','trail_duration_ms','淤泥路径持续（毫秒）',1000],['SlowDuration','slow_linger_ms','原减速短时刷新字段（毫秒）',1000]]);calc(x,'TotalDamage','damage','虚空淤泥魔法伤害','呕出胆汁的确定伤害；不能因路径持续3秒而假定每秒再次造成');pending(x,'路径与减速时序','3秒路径、0.25秒原减速刷新字段保留；进入/离开、再次受伤资格及护盾未证，不生成周期伤害或无条件减速。','系统');damageGap(x);
}
{
 const x=start('kogmaw_r');common(x,{mana:false});rows(x,[['Damage','base_damage','活体大炮基础魔法伤害'],['APRatio','ap_ratio','活体大炮法强系数'],['FinalDamageMult','low_health_multiplier','低生命分支伤害倍数'],['TooltipMissingHealthDamageAmp','missing_health_amp_per_point','每1%已损生命对应的增伤百分比点数'],['ManaCostDuration','mana_stack_window_ms','后续发射叠加费用窗口（毫秒）',1000],['BaseCost','base_cost','单次基础及每层额外法力'],['ManaCostCap','mana_cost_cap','单次法力消耗上限']]);
 const base=calc(x,'BaseDamageCalc','base_damage_value','活体大炮基础魔法伤害值','基础值加逐级法强系数和0.75额外攻击力');calc(x,'MaxDamageCalc','low_health_damage','低于40%生命替代伤害','原分支为2倍基础伤害，不与普通已损生命增伤叠加');
 fixed(x,'low_health_threshold','替代伤害严格生命阈值',.4,'当前中文低于40%使用替代伤害；恰好40%仍不是该分支。','当前绑定keyTooltip');fixed(x,'one','比例与费用的单位值',1,'用于明确文本的基础100%和首次发射计数。','当前中文数学单位');
 formula(x,'normal_missing_health_damage','生命不低于40%时伤害',mul(base,add(pn('one'),mul(pn('missing_health_amp_per_point'),op('DIVIDE',missingHP,targetHP)))),'每1%已损生命增加0.83333%伤害，百分比单位相消后系数乘已损生命比例；仅生命>=40%、最大生命>0分支，不自动选低生命分支。');
 input(x,'actual_prior_cost_stacks','本次发射前实际费用叠层数','只接当前8秒窗口中的已确认费用档数，非负整数；不得默认0或推断叠层刷新算法。','INTEGER');formula(x,'actual_mana_cost','本次活体大炮法力消耗',op('MIN',pn('mana_cost_cap'),mul(pn('base_cost'),add(pn('one'),pn('actual_prior_cost_stacks')))),'原文每次后续发射额外40，最多400；按实际已存在费用档数计算，不以基础mana_cost40替代所有发射。');effect(x,'mana_cost','本次活体大炮实际法力消耗',[result('consume_mana','消耗本次法力','RESOURCE_CHANGE','SOURCE',fval('actual_mana_cost'),{attributeKey:'mana',operation:'CONSUME'})],null,'只在真实发射时消费已核费用档数对应的法力；无默认叠层和自动施放规则。');
 sourceOnly(x,'DataValues.MidDamageMult','当前绑定不引用MidDamageCalc；不将未绑定的1.5倍分支当成新的生命阈值。');sourceOnly(x,'mSpellCalculations.MidDamageCalc','完整原树保留，当前文本只明确连续已损生命增伤及<40%替代分支。');sourceOnly(x,'DataValues.MaxExtraCost','原360额外费用上限等于400-40，已用当前文本400封顶，不另造费用阶段。');skip(x,['Range','VisionRadius','VisionDebuffDuration'],'纯射程或显形视野字段不进入当前数值；伤害与费用窗口保留。');pending(x,'生命分支和费用时序','实际生命检查时点、费用档数递增/刷新/回落及发射命中未接线；低于40%替代分支和普通增伤互斥。','系统');damageGap(x);
}
