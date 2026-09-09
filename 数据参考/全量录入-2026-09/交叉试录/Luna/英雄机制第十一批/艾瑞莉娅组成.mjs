import {begin,common,data,literal,runtime,formula,requireCalc,pn,attr,add,mul,damagePending,healPending,pending,exclude,excludeData,interpolation} from './候选.mjs';

// 被动：层数、攻速等级曲线和满层攻击附伤的数值关系保留；匿名计算节点不擅自解释。
{
  const x=begin('irelia_p');
  data(x,'BuffDuration','stack_duration_ms','层数持续时间（毫秒）',{scale:1000});
  data(x,'MaxStacks','max_stacks','最大层数');
  data(x,'OnHitStructureMod','structure_on_hit_multiplier','对建筑附伤倍率');
  data(x,'OnHitBaseDamage','on_hit_base_damage','满层攻击附伤基础值');
  data(x,'OnHitPerLevel','on_hit_per_level','满层攻击附伤等级字段');
  const asPart=requireCalc(x,'SingleStackAS').mFormulaParts?.[0];
  interpolation(x,'single_stack_attack_speed_percent','每层攻击速度（百分比点）',asPart);
  const onHit=requireCalc(x,'OnHitBonus').mFormulaParts;
  if(!onHit?.[0]||onHit[0].__type!=='{b22609db}'||onHit[1]?.mStat!==2||onHit[1]?.mStatFormula!==2||onHit[1]?.mCoefficient==null)throw Error('艾瑞莉娅P满层附伤计算树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.OnHitBonus.mFormulaParts',raw:onHit,semantic:'第一节点为未公开类型且引用OnHitBaseDamage/OnHitPerLevel；第二节点明确mStat=2/mStatFormula=2，按已证窄映射为额外攻击力。'});
  literal(x,'on_hit_bonus_ad_ratio','满层攻击附伤额外攻击力倍率',0.2,'OnHitBonus第二节点为0.2×额外攻击力；未把匿名第一节点猜成等级插值。','mSpellCalculations.OnHitBonus.mFormulaParts[1]');
  runtime(x,'on_hit_level_component','满层攻击附伤匿名等级项','OnHitBonus第一节点类型未公开，仅接受实际运行时根据OnHitBaseDamage与OnHitPerLevel求出的等级项；缺失不补零。');
  formula(x,'on_hit_bonus_magic_damage','满层攻击附加魔法伤害',add(add(pn('on_hit_base_damage'),pn('on_hit_level_component')),mul(pn('on_hit_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'保留已知基础项、等级项和0.2额外攻击力项；匿名等级项由运行输入提供。');
  damagePending(x,'on_hit_bonus_hit','满层普通攻击附加魔法伤害','on_hit_bonus_magic_damage');
  pending(x,'技能命中叠层与满层门槛','官方明确技能命中获得层数、满层才附加魔法伤害，攻击英雄/建筑/大型野怪会刷新持续时间；触发事件、层数消费及建筑实际伤害边界待系统接线。','系统');
  pending(x,'匿名等级项','OnHitBonus第一计算节点仅保留原始字段和运行输入，没有将OnHitPerLevel擅自乘以角色等级。','来源');
}

// Q：英雄命中物理伤害和自我治疗保留；小兵专用伤害与标记/死亡刷新只留证据。
{
  const x=begin('irelia_q');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','英雄命中基础物理伤害');
  data(x,'HealTADCoefficient','heal_total_ad_ratio','自我治疗总攻击力比例');
  excludeData(x,'DashSpeedBonus','突进速度表现/空间字段，不作为伤害或属性参数。');
  const champion=requireCalc(x,'ChampionDamage').mFormulaParts;
  if(champion?.[0]?.mDataValue!=='BaseDamage'||champion?.[1]?.mStat!==2||champion?.[1]?.mStatFormula!=null||champion?.[1]?.mCoefficient==null)throw Error('艾瑞莉娅Q英雄伤害树字段不符');
  literal(x,'total_ad_ratio','英雄命中总攻击力倍率',0.8,'ChampionDamage第二节点为mStat=2且省略mStatFormula；按已证默认0映射为总攻击力。','mSpellCalculations.ChampionDamage.mFormulaParts[1]');
  formula(x,'champion_damage','利刃冲击英雄命中物理伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),'ChampionDamage=BaseDamage+0.8×总攻击力；只保留英雄命中支路。');
  const heal=requireCalc(x,'HealAmount').mFormulaParts?.[0];
  if(heal?.mStat!==2||heal?.mDataValue!=='HealTADCoefficient'||heal?.mStatFormula!=null)throw Error('艾瑞莉娅Q治疗树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.HealAmount.mFormulaParts[0]',raw:heal,semantic:'mStat=2且省略mStatFormula；按已证默认0映射为总攻击力。'});
  formula(x,'heal_amount','利刃冲击自我治疗',mul(pn('heal_total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL')),'HealAmount=HealTADCoefficient×总攻击力；官方原文明确回复自身生命值。');
  damagePending(x,'champion_hit','利刃冲击英雄命中物理伤害','champion_damage');
  healPending(x,'self_heal','利刃冲击自我治疗','heal_amount');
  const minion=requireCalc(x,'MinionDamage');
  x.c.proofs.push({source:'mSpellCalculations.MinionDamage',raw:minion,excluded:true,semantic:'仅小兵专用伤害计算树；本批不新增小兵支路。'});
  exclude(x,'突进速度空间字段','DashSpeedBonus只保留原始证据，不作为伤害或属性参数。');
  exclude(x,'小兵专用伤害','官方说明仅对小兵使用MinionDamage；英雄候选不套用等级额外伤害。');
  pending(x,'标记/死亡刷新冷却','官方明确目标被标记或死于Q时刷新冷却；标记状态与死亡事件未接线，不把普通命中直接当作刷新。','系统');
}

// W：蓄力打击和双抗减伤公式保留；防御姿态的免控/免害边界留待状态系统。
{
  const x=begin('irelia_w');
  common(x,{cast:true,channelDuration:true});
  data(x,'MaxDuration','max_channel_duration_ms','最大蓄力时间（毫秒）',{scale:1000});
  data(x,'MinDamage','min_damage_base','最小蓄力物理伤害');
  data(x,'MaxDamage','max_damage_base','最大蓄力物理伤害');
  data(x,'MaxBonusRatio','max_bonus_ratio','最大蓄力倍率字段');
  data(x,'ChargeTimeForMax','charge_time_for_max_ms','达到最大伤害所需蓄力时间（毫秒）',{scale:1000});
  data(x,'MRReductionAmount','magic_reduction_multiplier','魔法减伤相对物理减伤倍率');
  excludeData(x,'BasePhysicalDR','旧/并行基础物理减伤字段；当前最终计算树未直接绑定。');
  const physical=requireCalc(x,'FinalPhysicalDR').mFormulaParts;
  if(physical?.[0]?.__type!=='ByCharLevelInterpolationCalculationPart'||physical?.[1]?.mCoefficient==null||physical?.[1]?.mStat!=null)throw Error('艾瑞莉娅W物理减伤树字段不符');
  interpolation(x,'final_physical_reduction_percent','蓄力期间物理减伤（百分比点）',physical[0]);
  literal(x,'physical_reduction_ap_ratio','蓄力物理减伤法强系数',0.08,'FinalPhysicalDR第二节点省略mStat/mStatFormula；按已证默认0映射为法强。','mSpellCalculations.FinalPhysicalDR.mFormulaParts[1]');
  formula(x,'final_physical_reduction_percent_with_ap','含法强的蓄力物理减伤（百分比点）',add(pn('final_physical_reduction_percent'),mul(pn('physical_reduction_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'FinalPhysicalDR=角色等级插值+0.08×法强；结果仍按原文百分比点表达。');
  const min=requireCalc(x,'MinDamageCalc').mFormulaParts;
  if(min?.[0]?.mDataValue!=='MinDamage'||min?.[1]?.mStat!==2||min?.[1]?.mStatFormula!=null||min?.[1]?.mCoefficient==null||min?.[2]?.mCoefficient==null||min?.[2]?.mStat!=null)throw Error('艾瑞莉娅W最小伤害树字段不符');
  literal(x,'min_damage_total_ad_ratio','最小蓄力总攻击力倍率',0.4,'MinDamageCalc第二节点为mStat=2且省略mStatFormula，映射总攻击力。','mSpellCalculations.MinDamageCalc.mFormulaParts[1]');
  literal(x,'min_damage_ap_ratio','最小蓄力法强倍率',0.5,'MinDamageCalc第三节点省略属性枚举，按已证默认0映射法强。','mSpellCalculations.MinDamageCalc.mFormulaParts[2]');
  formula(x,'min_damage','最小蓄力物理伤害',add(add(pn('min_damage_base'),mul(pn('min_damage_total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),mul(pn('min_damage_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'MinDamageCalc的三项加法树内联。');
  const max=requireCalc(x,'MaxDamageCalc').mFormulaParts;
  if(max?.[0]?.mDataValue!=='MaxDamage'||max?.[1]?.mStat!==2||max?.[1]?.mStatFormula!=null||max?.[1]?.mCoefficient==null||max?.[2]?.mCoefficient==null||max?.[2]?.mStat!=null)throw Error('艾瑞莉娅W最大伤害树字段不符');
  literal(x,'max_damage_total_ad_ratio','最大蓄力总攻击力倍率',1.2,'MaxDamageCalc第二节点为mStat=2且省略mStatFormula，映射总攻击力。','mSpellCalculations.MaxDamageCalc.mFormulaParts[1]');
  literal(x,'max_damage_ap_ratio','最大蓄力法强倍率',1.5,'MaxDamageCalc第三节点省略属性枚举，按已证默认0映射法强。','mSpellCalculations.MaxDamageCalc.mFormulaParts[2]');
  formula(x,'max_damage','最大蓄力物理伤害',add(add(pn('max_damage_base'),mul(pn('max_damage_total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),mul(pn('max_damage_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'MaxDamageCalc的三项加法树内联；客户端标记tooltipOnly，仅作为已证上限关系。');
  const magic=requireCalc(x,'FinalMagicDR');
  if(magic?.mModifiedGameCalculation!=='FinalPhysicalDR'||magic?.mMultiplier?.mDataValue!=='MRReductionAmount')throw Error('艾瑞莉娅W魔法减伤树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.FinalMagicDR',raw:magic,semantic:'FinalMagicDR为MRReductionAmount×FinalPhysicalDR；FinalPhysicalDR的法强项已内联，未使用公式引用节点。'});
  formula(x,'final_magic_reduction_percent','蓄力期间魔法减伤（百分比点）',mul(pn('magic_reduction_multiplier'),add(pn('final_physical_reduction_percent'),mul(pn('physical_reduction_ap_ratio'),attr('ability_power','SOURCE','TOTAL')))),'FinalMagicDR直接乘FinalPhysicalDR；表达式内联等级插值与法强项，保留百分比点单位。');
  damagePending(x,'min_release_hit','距破之舞最小蓄力物理伤害','min_damage');
  damagePending(x,'max_release_hit','距破之舞最大蓄力物理伤害','max_damage');
  pending(x,'蓄力免控与伤害减免消费','官方明确蓄力期间不可行动并降低物理/魔法伤害；控制免疫、法术护盾资格、伤害来源消费及释放时点未接线，不创建伪免疫结果。','系统');
  pending(x,'蓄力时长与伤害插值','只保存最大蓄力时长、达到最大伤害时长和两个端点公式；实际蓄力比例与中断规则未由本批补造。','尚未接线');
}

// E：双刀相向命中时的伤害、晕眩、标记和两次施放时间参数保留，位置选择留给空间系统。
{
  const x=begin('irelia_e');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','比翼双刃基础魔法伤害');
  data(x,'StunDuration','stun_duration_ms','晕眩持续时间（毫秒）',{scale:1000});
  data(x,'RevTime','recast_time_ms','再次施放时间（毫秒）',{scale:1000});
  data(x,'BuffDuration','recast_window_ms','再次施放窗口（毫秒）',{scale:1000});
  data(x,'CDBetweenCast','cooldown_between_cast_ms','两次施放间隔（毫秒）',{scale:1000});
  data(x,'MarkDuration','mark_duration_ms','重心不稳标记持续时间（毫秒）',{scale:1000});
  data(x,'APRatio','ability_power_ratio','魔法伤害法强倍率');
  excludeData(x,'MaxRange','刀锋位置/空间范围字段。');
  excludeData(x,'MinRange','刀锋位置/空间范围字段。');
  const total=requireCalc(x,'TotalDamage').mFormulaParts;
  if(total?.[0]?.mDataValue!=='BaseDamage'||total?.[1]?.mStat!=null||total?.[1]?.mDataValue!=='APRatio')throw Error('艾瑞莉娅E伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.TotalDamage.mFormulaParts[1]',raw:total[1],semantic:'StatByNamedDataValue省略属性字段；按已证默认0映射为法强。'});
  formula(x,'total_damage','比翼双刃魔法伤害',add(pn('base_damage'),mul(pn('ability_power_ratio'),attr('ability_power','SOURCE','TOTAL'))),'TotalDamage=BaseDamage+APRatio×法强。');
  damagePending(x,'blade_convergence_hit','比翼双刃相向命中魔法伤害','total_damage');
  exclude(x,'刀锋位置范围','MaxRange与MinRange只保留空间证据，不创建范围参数。');
  pending(x,'两刀相向命中与标记','官方明确两次施放后刀锋相向，对敌人晕眩并给英雄/大型野怪标记；位置、命中选择、标记消费未接线。','系统');
}

// R：首发弹幕和刃墙伤害公式保留；命中首个英雄后展开及穿墙触发仍待空间事件。
{
  const x=begin('irelia_r');
  common(x,{cast:true});
  data(x,'BaseMissileDamage','base_missile_damage','刀锋弹幕基础魔法伤害');
  data(x,'BaseZoneDamage','base_zone_damage','刃墙基础魔法伤害');
  data(x,'CCDuration','slow_duration_ms','刃墙减速持续时间（毫秒）',{scale:1000});
  data(x,'SlowAmount','slow_ratio','刃墙减速比例',{scale:.01});
  data(x,'MarkDuration','mark_duration_ms','重心不稳标记持续时间（毫秒）',{scale:1000});
  data(x,'ZoneDuration','zone_duration_ms','刃墙持续时间（毫秒）',{scale:1000});
  data(x,'CooldownAmount','cooldown_reduction_amount','根冷却修正字段');
  data(x,'APRatio','ability_power_ratio','魔法伤害法强倍率');
  const missile=requireCalc(x,'MissileDamage').mFormulaParts;
  const zone=requireCalc(x,'ZoneDamage').mFormulaParts;
  if(missile?.[0]?.mDataValue!=='BaseMissileDamage'||missile?.[1]?.mStat!=null||missile?.[1]?.mDataValue!=='APRatio'||zone?.[0]?.mDataValue!=='BaseZoneDamage'||zone?.[1]?.mStat!=null||zone?.[1]?.mDataValue!=='APRatio')throw Error('艾瑞莉娅R伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.MissileDamage/ZoneDamage',raw:{missile,zone},semantic:'两个StatByNamedDataValue均省略属性字段；按已证默认0映射为法强。'});
  formula(x,'missile_damage','先锋之刃弹幕魔法伤害',add(pn('base_missile_damage'),mul(pn('ability_power_ratio'),attr('ability_power','SOURCE','TOTAL'))),'MissileDamage=BaseMissileDamage+APRatio×法强。');
  formula(x,'zone_damage','先锋之刃刃墙魔法伤害',add(pn('base_zone_damage'),mul(pn('ability_power_ratio'),attr('ability_power','SOURCE','TOTAL'))),'ZoneDamage=BaseZoneDamage+APRatio×法强。');
  damagePending(x,'missile_hit','先锋之刃弹幕魔法伤害','missile_damage');
  damagePending(x,'zone_hit','先锋之刃刃墙魔法伤害','zone_damage');
  pending(x,'首个英雄展开与刃墙穿越','官方明确命中首个英雄后展开刃墙，穿过刃墙才触发后续伤害和减速；空间命中、目标选择、标记消费及CooldownAmount用途未接线。','系统');
}
