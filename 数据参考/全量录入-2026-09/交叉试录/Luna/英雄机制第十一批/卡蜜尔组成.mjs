import {begin,common,data,literal,runtime,formula,requireCalc,pn,attr,add,mul,damagePending,healPending,pending,exclude,excludeData,breakpoints} from './候选.mjs';

// 被动：冷却等级断点和护盾比例断点保留；mStat=12且未给formula的护盾来源不擅自映射。
{
  const x=begin('camille_p');
  data(x,'ShieldDuration','shield_duration_ms','适应性护盾持续时间（毫秒）',{scale:1000});
  const cooldown=requireCalc(x,'PassiveCooldown').mFormulaParts?.[0];
  if(cooldown?.__type!=='ByCharLevelBreakpointsCalculationPart'||cooldown?.mLevel1Value==null)throw Error('卡蜜尔P冷却断点字段不符');
  breakpoints(x,'passive_cooldown_seconds','适应性防御被动冷却（秒）',cooldown);
  const shield=requireCalc(x,'ShieldAmount');
  const shieldPart=shield.mFormulaParts?.[0];
  if(shieldPart?.mStat!==12||shieldPart?.mSubpart?.__type!=='ByCharLevelBreakpointsCalculationPart')throw Error('卡蜜尔P护盾树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.ShieldAmount.mFormulaParts[0]',raw:shieldPart,semantic:'护盾树只有mStat=12且省略mStatFormula；已知断点比例保留，属性枚举不扩推。官方文字虽称最大生命值，当前窄映射证据不足以把该组合直接写成hp。'});
  breakpoints(x,'shield_level_ratio','护盾比例等级值',shieldPart.mSubpart);
  runtime(x,'shield_stat_value','适应性护盾未解码属性值','ShieldAmount的mStat=12且无mStatFormula；只接受实际运行时属性值，不能把未证枚举默认成最大生命或0。');
  formula(x,'shield_amount','适应性防御护盾值',mul(pn('shield_level_ratio'),pn('shield_stat_value')),'护盾值=等级断点比例×运行时mStat12属性值；来源文本与具体属性绑定仍待系统核对。');
  pending(x,'护盾伤害类型与触发','官方明确受到敌方英雄攻击后按物理/魔法伤害类型生成对应护盾并有被动冷却；伤害类型选择、法术护盾资格和属性来源未接线。','系统');
}

// Q：两段强化攻击的总攻击力伤害和第二段真实伤害转换字段保留；普攻触发留待攻击事件。
{
  const x=begin('camille_q');
  common(x,{cast:true});
  data(x,'QRampUpTime','q_ramp_up_time_ms','第二段强化所需间隔（毫秒）',{scale:1000});
  excludeData(x,'BonusAARange','强化攻击距离，属于空间/攻击范围字段。');
  data(x,'TADRatio','total_ad_ratio','强化攻击总攻击力倍率');
  data(x,'MSBonus','move_speed_ratio','强化攻击移动速度比例');
  data(x,'MSDuration','move_speed_duration_ms','移动速度持续时间（毫秒）',{scale:1000});
  data(x,'QEmpoweredAmp','empowered_damage_multiplier','第二段额外伤害倍率');
  data(x,'Q2Duration','second_attack_window_ms','第二段强化窗口（毫秒）',{scale:1000});
  data(x,'QTotalRecastTime','recast_window_ms','Q再次施放总窗口（毫秒）',{scale:1000});
  const conversion=requireCalc(x,'DamageConversionPercentage').mFormulaParts?.[0];
  if(conversion?.__type!=='ByCharLevelBreakpointsCalculationPart'||conversion?.mLevel1Value==null||conversion?.mInitialBonusPerLevel==null)throw Error('卡蜜尔Q真实伤害转换断点字段不符');
  x.c.proofs.push({source:'mSpellCalculations.DamageConversionPercentage.mFormulaParts[0]',raw:conversion,semantic:'mLevel1Value与mInitialBonusPerLevel已给，但17级断点未给增量；不自行插值或封顶。'});
  literal(x,'damage_conversion_level1_ratio','真实伤害转换一级比例',0.4,'DamageConversionPercentage的mLevel1Value；不猜17级未给出的断点增量。','mSpellCalculations.DamageConversionPercentage.mFormulaParts[0].mLevel1Value');
  literal(x,'damage_conversion_per_level_ratio','真实伤害转换每级增量',0.04,'DamageConversionPercentage的mInitialBonusPerLevel；不据此自行求出各级值。','mSpellCalculations.DamageConversionPercentage.mFormulaParts[0].mInitialBonusPerLevel');
  runtime(x,'current_damage_conversion_ratio','当前等级真实伤害转换比例','DamageConversionPercentage包含未给增量的17级断点；只接受已由运行时/后续数据核出的当前比例，不补插值。');
  const bonus=requireCalc(x,'BonusDamage').mFormulaParts?.[0];
  if(bonus?.mStat!==2||bonus?.mStatFormula!=null||bonus?.mDataValue!=='tADRatio')throw Error('卡蜜尔Q额外伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.BonusDamage.mFormulaParts[0]',raw:bonus,semantic:'mStat=2且省略mStatFormula；按已证默认0映射为总攻击力，tADRatio也对应总攻击力。'});
  formula(x,'bonus_damage','精准礼仪额外物理伤害',mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL')),'BonusDamage=tADRatio×总攻击力。');
  const empowered=requireCalc(x,'EmpoweredBonusDamage');
  if(empowered?.mMultiplier?.mDataValue!=='QEmpoweredAmp'||empowered?.mModifiedGameCalculation!=='BonusDamage')throw Error('卡蜜尔Q第二段伤害树字段不符');
  formula(x,'empowered_bonus_damage','精准礼仪第二段额外物理伤害',mul(pn('empowered_damage_multiplier'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),'EmpoweredBonusDamage=QEmpoweredAmp×BonusDamage，表达式内联BonusDamage。');
  formula(x,'empowered_true_damage_portion','精准礼仪第二段真实伤害转换部分',mul(pn('current_damage_conversion_ratio'),mul(pn('empowered_damage_multiplier'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL')))),'真实伤害部分=当前转换比例×第二段额外物理伤害；比例值不在本批猜等级。');
  damagePending(x,'first_attack','精准礼仪第一段强化攻击额外物理伤害','bonus_damage');
  damagePending(x,'second_attack','精准礼仪第二段强化攻击额外物理/真实伤害','empowered_bonus_damage');
  pending(x,'普攻间隔与第二段转换','官方明确两段攻击相隔至少QRampUpTime才强化并转化部分真实伤害；普攻消费、间隔判定和物理/真实分包未接线。','系统');
  exclude(x,'强化攻击范围字段','BonusAARange只保留攻击范围证据，不生成空间参数。');
  pending(x,'强化移动速度与再次施放','移动速度、两次窗口和无消耗再次施放的具体触发时点待攻击/状态事件接线。','尚未接线');
}

// W：内圈基础伤害、外沿最大生命伤害和外沿实际伤害治疗关系保留；外沿位置由空间事件决定。
{
  const x=begin('camille_w');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','战术横扫基础物理伤害');
  data(x,'BADRatio','bonus_ad_ratio','基础伤害额外攻击力倍率');
  data(x,'SlowDuration','slow_duration_ms','外沿减速持续时间（毫秒）',{scale:1000});
  data(x,'ChargeDuration','charge_duration_ms','蓄力时间（毫秒）',{scale:1000});
  data(x,'SlowPercentage','slow_ratio','外沿减速比例',{scale:.01});
  data(x,'OuterConeMaxHPDamage','outer_max_hp_damage_ratio','外沿目标最大生命伤害比例');
  data(x,'ADRequiredFor1PercentDamage','bonus_ad_per_one_percent','每百分之一外沿伤害所需额外攻击力');
  data(x,'ADRequiredTooltipOnly','outer_bonus_ad_ratio','外沿伤害额外攻击力比例');
  excludeData(x,'MonsterDamageReduction','非史诗级野怪专用减伤比例。');
  data(x,'OuterConeHealingRatio','outer_healing_ratio','外沿实际额外伤害治疗比例',{scale:.01});
  excludeData(x,'BlastLength','锥形范围长度，属于空间字段。');
  excludeData(x,'ConeAngle','锥形角度，属于空间字段。');
  const outer=requireCalc(x,'OuterEdgeTooltip').mFormulaParts;
  if(outer?.[0]?.mDataValue!=='OuterConeMaxHPDamage'||outer?.[1]?.mStat!==2||outer?.[1]?.mStatFormula!==2||outer?.[1]?.mDataValue!=='ADRequiredTooltipOnly')throw Error('卡蜜尔W外沿树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.OuterEdgeTooltip.mFormulaParts[1]',raw:outer[1],semantic:'外沿额外攻击力项明确mStat=2/mStatFormula=2，按已证窄映射为额外攻击力。'});
  formula(x,'outer_damage_ratio','战术横扫外沿最大生命伤害比例',add(pn('outer_max_hp_damage_ratio'),mul(pn('outer_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'OuterEdgeTooltip=OuterConeMaxHPDamage+ADRequiredTooltipOnly×额外攻击力。');
  const base=requireCalc(x,'BaseDamageTotal').mFormulaParts;
  if(base?.[0]?.mDataValue!=='BaseDamage'||base?.[1]?.mStat!==2||base?.[1]?.mStatFormula!==2||base?.[1]?.mDataValue!=='BADRatio')throw Error('卡蜜尔W基础伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.BaseDamageTotal.mFormulaParts[1]',raw:base[1],semantic:'基础伤害额外攻击力项明确mStat=2/mStatFormula=2，按已证窄映射为额外攻击力。'});
  formula(x,'base_damage_total','战术横扫基础物理伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'BaseDamageTotal=BaseDamage+BADRatio×额外攻击力。');
  formula(x,'outer_damage','战术横扫外沿额外物理伤害',mul(add(pn('outer_max_hp_damage_ratio'),mul(pn('outer_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),attr('hp','TARGET','TOTAL')),'外沿额外伤害=外沿最大生命伤害比例×敌方英雄最大生命；表达式内联外沿比例，外沿命中位置由空间事件提供。');
  runtime(x,'actual_outer_damage','战术横扫外沿实际额外伤害','官方治疗按敌方英雄实际额外伤害计算；只接受结算后的实际值，不能用未减免公式代替。');
  formula(x,'outer_heal_amount','战术横扫外沿自我治疗',mul(pn('outer_healing_ratio'),pn('actual_outer_damage')),'外沿自我治疗=OuterConeHealingRatio×实际额外伤害；治疗时点与多目标合并未接线。');
  damagePending(x,'base_hit','战术横扫基础物理伤害','base_damage_total');
  damagePending(x,'outer_hit','战术横扫外沿额外物理伤害','outer_damage');
  healPending(x,'outer_heal','战术横扫外沿自我治疗','outer_heal_amount');
  exclude(x,'外沿空间字段','BlastLength与ConeAngle只保留锥形空间证据，不生成范围参数。');
  exclude(x,'野怪额外规则','MonsterDamageReduction与MonsterHealthDamageCap只用于野怪支路，本批不新增。');
  pending(x,'外沿判定与实际治疗','官方明确外沿减速、额外最大生命伤害并按对英雄实际额外伤害治疗；位置判断、减速衰减、实际伤害值和治疗时点待空间/结算事件接线。','系统');
}

// E：落地命中物理伤害、击飞和攻速增益参数保留；钩索地形与冲刺路线属于空间接线。
{
  const x=begin('camille_e');
  common(x,{cast:true});
  excludeData(x,'EMinionMonsterGhostDuration','小兵/野怪钩索幽灵持续时间，不新增非英雄支路。');
  data(x,'KnockupDuration','knockup_duration_ms','敌方英雄击飞持续时间（毫秒）',{scale:1000});
  data(x,'ASBuff','attack_speed_ratio','落地后额外攻击速度比例');
  data(x,'BaseDamage','base_damage','落地基础物理伤害');
  excludeData(x,'DashSpeed','钩索/冲刺速度，属于空间字段。');
  data(x,'ASDuration','attack_speed_duration_ms','落地攻速持续时间（毫秒）',{scale:1000});
  data(x,'WallHangDuration','wall_hang_duration_ms','挂墙阶段时长（毫秒）',{scale:1000});
  excludeData(x,'E2LongDashRange','对敌冲刺距离，属于空间字段。');
  excludeData(x,'E2ShortDashRange','短冲刺距离，属于空间字段。');
  excludeData(x,'ECollisionRange','碰撞范围，属于空间字段。');
  data(x,'BADRatio','bonus_ad_ratio','落地伤害额外攻击力倍率');
  const total=requireCalc(x,'TotalDamage').mFormulaParts;
  if(total?.[0]?.mDataValue!=='BaseDamage'||total?.[1]?.mStat!==2||total?.[1]?.mStatFormula!==2||total?.[1]?.mDataValue!=='BADRatio')throw Error('卡蜜尔E伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.TotalDamage.mFormulaParts[1]',raw:total[1],semantic:'mStat=2/mStatFormula=2按已证窄映射为额外攻击力。'});
  formula(x,'total_damage','钩索落地物理伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'TotalDamage=BaseDamage+BADRatio×额外攻击力。');
  damagePending(x,'landing_hit','钩索落地物理伤害','total_damage');
  exclude(x,'钩索空间字段','DashSpeed、E2LongDashRange、E2ShortDashRange、ECollisionRange与小兵/野怪幽灵时长只保留来源证据。');
  pending(x,'钩索地形、碰撞和击飞','官方明确第一段附着地形、第二段向敌方英雄冲刺并在落地造成伤害/击飞/攻速；路线、命中范围、目标选择和攻速触发未接线。','系统');
}

// R：目标当前生命值百分比的额外魔法普攻伤害保留；缺值附伤字段与空间锁定不补造。
{
  const x=begin('camille_r');
  common(x,{cast:true});
  data(x,'RPercentCurrentHPDamage','current_hp_damage_percent','对目标当前生命值额外魔法伤害（百分比点）');
  excludeData(x,'ROnHitDamage','ROnHitDamage缺少values；官方只确认普攻附加魔法伤害，缺值不补0。');
  data(x,'RDuration','duration_ms','区域锁定持续时间（毫秒）',{scale:1000});
  excludeData(x,'RCircleRadius','锁定区域半径，属于空间字段。');
  literal(x,'percent_to_ratio','百分比点转比例',0.01,'RPercentCurrentHPDamage原文以百分比点显示，计算伤害时转换为比例。','official.tooltip + DataValues.RPercentCurrentHPDamage');
  formula(x,'on_hit_magic_damage','海克斯最后通牒目标当前生命额外魔法伤害',mul(mul(pn('percent_to_ratio'),pn('current_hp_damage_percent')),attr('hp','TARGET','CURRENT')),'额外魔法普攻伤害=RPercentCurrentHPDamage%×目标当前生命值；实际普攻事件负责消费。');
  damagePending(x,'on_hit','海克斯最后通牒额外魔法普攻伤害','on_hit_magic_damage');
  exclude(x,'锁定区域空间字段','RCircleRadius只保留区域半径证据，不生成空间参数。');
  pending(x,'锁定区域与普攻消费','官方明确卡蜜尔短暂不可选取、锁定目标并震开其他敌人，离开区域结束；区域、击退、不可选取状态和普攻命中/护盾资格未接线。','系统');
}
