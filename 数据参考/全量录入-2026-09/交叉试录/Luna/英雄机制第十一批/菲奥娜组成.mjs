import {begin,common,data,literal,runtime,formula,requireCalc,pn,attr,add,mul,damagePending,healPending,pending,exclude,excludeData,interpolation} from './候选.mjs';

// 被动：破绽的最大生命真实伤害、等级治疗和移动速度持续时间保留；破绽识别/命中事件待接线。
{
  const x=begin('fiora_p');
  data(x,'PassiveDamageADRatio','passive_bonus_ad_ratio','破绽伤害额外攻击力比例');
  data(x,'PassiveDamageBase','passive_base_damage_ratio','破绽伤害基础最大生命比例');
  data(x,'MovementSpeedDuration','movement_speed_duration_ms','破绽命中移动速度持续时间（毫秒）',{scale:1000});
  const heal=requireCalc(x,'PassiveHealAmount').mFormulaParts?.[0];
  interpolation(x,'passive_heal_amount','破绽命中治疗量',heal);
  const damage=requireCalc(x,'PassiveDamageTotal').mFormulaParts;
  if(damage?.[0]?.mDataValue!=='PassiveDamageBase'||damage?.[1]?.mStat!==2||damage?.[1]?.mStatFormula!==2||damage?.[1]?.mDataValue!=='PassiveDamageADRatio')throw Error('菲奥娜P伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.PassiveDamageTotal.mFormulaParts[1]',raw:damage[1],semantic:'mStat=2/mStatFormula=2按已证窄映射为额外攻击力；计算树显示为百分比。'});
  formula(x,'passive_damage_ratio','破绽最大生命伤害比例',add(pn('passive_base_damage_ratio'),mul(pn('passive_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'PassiveDamageTotal=基础最大生命比例+额外攻击力比例×额外攻击力。');
  formula(x,'passive_vital_true_damage','破绽命中最大生命真实伤害',mul(add(pn('passive_base_damage_ratio'),mul(pn('passive_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),attr('hp','TARGET','TOTAL')),'将PassiveDamageTotal百分比作用于当前敌方英雄最大生命值；表达式内联被动比例，命中触发单独接线。');
  const rDamage=requireCalc(x,'RDamageTotal');
  if(rDamage?.mMultiplier?.mNumber!==4||rDamage?.mModifiedGameCalculation!=='PassiveDamageTotal')throw Error('菲奥娜P大招伤害树字段不符');
  literal(x,'r_vital_count','大招破绽伤害次数',4,'RDamageTotal明确为4×PassiveDamageTotal。','mSpellCalculations.RDamageTotal');
  formula(x,'r_vital_true_damage','大招四处破绽最大生命真实伤害',mul(pn('r_vital_count'),mul(add(pn('passive_base_damage_ratio'),mul(pn('passive_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),attr('hp','TARGET','TOTAL'))),'内联RDamageTotal=4×PassiveDamageTotal；实际是否命中四处破绽由R事件提供。');
  damagePending(x,'passive_vital_hit','破绽命中真实伤害','passive_vital_true_damage');
  damagePending(x,'r_vital_hits','大招四处破绽真实伤害','r_vital_true_damage');
  healPending(x,'passive_vital_heal','破绽命中自我治疗','passive_heal_amount');
  pending(x,'破绽生成与命中','官方明确破绽15秒后或命中后刷新，攻击或技能命中破绽才产生伤害、治疗和移速；目标部位选择与实际命中事件未接线。','系统');
}

// Q：近身突刺的英雄物理伤害和命中后冷却缩短比例保留；建筑/守卫优先级属于目标选择。
{
  const x=begin('fiora_q');
  common(x,{cast:true});
  data(x,'Damage','base_damage','破空斩基础物理伤害');
  data(x,'bADRatio','bonus_ad_ratio','破空斩额外攻击力比例');
  data(x,'CDRefundPercent','cooldown_refund_ratio','命中敌人后的冷却缩短比例');
  const total=requireCalc(x,'TotalDamage').mFormulaParts;
  if(total?.[0]?.mDataValue!=='Damage'||total?.[1]?.mStat!==2||total?.[1]?.mStatFormula!==2||total?.[1]?.mSubpart?.mDataValue!=='BADRatio')throw Error('菲奥娜Q伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.TotalDamage.mFormulaParts[1]',raw:total[1],semantic:'StatBySubPart明确mStat=2/mStatFormula=2，子项BADRatio按已证窄映射为额外攻击力。'});
  formula(x,'total_damage','破空斩英雄命中物理伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'TotalDamage=Damage+bADRatio×额外攻击力。');
  damagePending(x,'champion_hit','破空斩英雄命中物理伤害','total_damage');
  pending(x,'命中后冷却缩短','官方明确命中敌人后冷却缩短50%；冷却变化基数、攻击特效与实际命中事件未接线，不把比例直接当毫秒。','系统');
  exclude(x,'守卫/建筑目标','官方目标优先级包含守卫和建筑；本批只保留一名敌方英雄的伤害，不新增空间或建筑专用目标支路。');
}

// W：招架期间减伤、刺击伤害与减速/攻速减益数值保留；招架免疫及定身分支不伪造结果。
{
  const x=begin('fiora_w');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','劳伦特心眼刀基础魔法伤害');
  data(x,'ParryDuration','parry_duration_ms','招架持续时间（毫秒）',{scale:1000});
  data(x,'CCDuration','debuff_duration_ms','命中后减速/攻击速度减益持续时间（毫秒）',{scale:1000});
  data(x,'MSSlowPercent','move_slow_ratio','移动速度减速比例',{scale:-1});
  data(x,'SmallBlockPercent','small_block_ratio','小幅减伤比例');
  data(x,'BigBlockPercent','big_block_ratio','大幅减伤比例');
  data(x,'AttackSlowPercent','attack_slow_ratio','攻击速度减速比例',{scale:-1});
  const stab=requireCalc(x,'StabDamage').mFormulaParts;
  if(stab?.[0]?.mDataValue!=='BaseDamage'||stab?.[1]?.mCoefficient==null||stab?.[1]?.mStat!=null)throw Error('菲奥娜W刺击树字段不符');
  literal(x,'stab_ap_ratio','刺击法强倍率',1,'StabDamage第二节点省略属性字段；按已证默认0映射为法强；客户端标记tooltipOnly。','mSpellCalculations.StabDamage.mFormulaParts[1]');
  formula(x,'stab_damage','劳伦特心眼刀刺击魔法伤害',add(pn('base_damage'),mul(pn('stab_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'StabDamage=BaseDamage+1×法强。');
  damagePending(x,'stab_hit','劳伦特心眼刀刺击魔法伤害','stab_damage');
  pending(x,'招架免疫与定身分支','官方明确招架所有伤害、控制及有害效果，格挡定身时改为晕眩；当前控制免疫/法术护盾资格、伤害来源判定和两种减伤边界未接线。','系统');
  pending(x,'刺击减速与攻击速度减益','移动速度与攻击速度负值已按来源符号转换为正减益比例；首个英雄命中、持续时间和定身替换规则待控制事件接线。','尚未接线');
}

// E：两次强化攻击的攻速、减速和总攻击力倍率保留；强化攻击事件单独接线。
{
  const x=begin('fiora_e');
  common(x,{cast:true});
  data(x,'BuffDuration','buff_duration_ms','强化攻击持续时间（毫秒）',{scale:1000});
  data(x,'SlowDuration','slow_duration_ms','第一次攻击减速持续时间（毫秒）',{scale:1000});
  data(x,'SlowPercent','slow_ratio','第一次攻击减速比例',{scale:-1});
  data(x,'ASPercent','attack_speed_ratio','强化攻击额外攻击速度比例');
  data(x,'AttackOnePercentTAD','first_attack_total_ad_ratio','第一次攻击总攻击力倍率');
  data(x,'AttackTwoPercentTAD','second_attack_total_ad_ratio','第二次攻击总攻击力倍率');
  formula(x,'first_attack_damage','夺命连刺第一次攻击总攻击力伤害',mul(pn('first_attack_total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL')),'AttackOnePercentTAD×总攻击力；第一次攻击的实际普攻本体与攻击特效由外部事件提供。');
  formula(x,'second_attack_damage','夺命连刺第二次攻击总攻击力伤害',mul(pn('second_attack_total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL')),'AttackTwoPercentTAD×总攻击力；第二次攻击必定暴击的资格留为事件条件。');
  damagePending(x,'first_attack_hit','夺命连刺第一次强化攻击','first_attack_damage');
  damagePending(x,'second_attack_hit','夺命连刺第二次强化攻击','second_attack_damage');
  pending(x,'两次攻击消费与暴击','官方明确下两次攻击获得攻速、第一次减速、第二次必定暴击；强化攻击队列、攻击本体/附伤和暴击消费未接线。','系统');
}

// R：保留四处破绽、自身移速和自身持续治疗；第三名友方英雄的治疗分发排除。
{
  const x=begin('fiora_r');
  common(x,{cast:true});
  data(x,'MarkDuration','mark_duration_ms','大招破绽标记持续时间（毫秒）',{scale:1000});
  excludeData(x,'PassiveAS','当前官方原文未绑定的客户端攻速字段，保留原始证据不接入。');
  data(x,'PercentMS','move_speed_ratio','目标附近移动速度比例');
  excludeData(x,'MSRingRadius','目标附近移动速度范围字段，仅空间参数。');
  data(x,'HealDuration','healing_source_duration_ms','说明中的治疗持续时间（毫秒）',{scale:1000});
  data(x,'HealPerSecond','healing_base_per_second','大招每秒基础治疗');
  data(x,'Ratio','healing_bonus_ad_ratio','大招每秒治疗额外攻击力系数');
  excludeData(x,'HealRingRadius','仅排除治疗圈几何半径，实际自身是否处在治疗圈内仍是生效条件。');
  for(const name of ['MinHealDuration','HealDurationExtension']){
    const raw=x.p.DataValues.find(d=>d.name===name);
    x.c.proofs.push({source:'DataValues.'+name,raw,sourcePending:true,semantic:'自身持续治疗相关来源字段，当前未证明消费链；不填缺值、不改成范围外。'});
  }
  const healCalc=requireCalc(x,'HealPerSecondCalc');
  if(healCalc.mFormulaParts?.[0]?.mDataValue!=='HealPerSecond'||healCalc.mFormulaParts?.[1]?.mStat!==2||healCalc.mFormulaParts?.[1]?.mStatFormula!==2||Math.abs(healCalc.mFormulaParts[1].mCoefficient-.6)>1e-6)throw Error('菲奥娜R每秒治疗树不符');
  x.c.proofs.push({source:'mSpellCalculations.HealPerSecondCalc',raw:healCalc,semantic:'当前绑定每秒治疗，保留自身分支；同版本官方英文描述明确Fiora and her allies，详见菲奥娜自身治疗补证.json。'});
  formula(x,'self_healing_per_second','无双挑战每秒自身治疗',add(pn('healing_base_per_second'),mul(pn('healing_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'按技能1至3级75/100/125，加0.6额外攻击力；这是每秒治疗量，不能直接作为每跳量或瞬时总治疗。');
  pending(x,'自身持续治疗触发与时序','命中四处破绽，或至少命中一处后目标阵亡，且自身实际位于治疗圈内才有治疗；当前说明5秒、MinHealDuration缺值及HealDurationExtension=1的动态链须另核，首跳与间隔未证，不生成默认瞬时或周期治疗。','系统');
  literal(x,'r_vital_count','大招破绽次数',4,'官方原文与RDamageTotal均明确最多四处破绽；真实命中次数仍由事件提供。','official.tooltip + Spell_FioraPassive.RDamageTotal');
  runtime(x,'passive_vital_damage_ratio','读取被动破绽伤害比例','R文本引用Spell_FioraPassive；具体被动等级/额外攻击力值由同次被动计算提供，不能在R内复制未知状态。');
  formula(x,'r_vital_true_damage','无双挑战四处破绽最大生命真实伤害',mul(mul(pn('r_vital_count'),pn('passive_vital_damage_ratio')),attr('hp','TARGET','TOTAL')),'RDamageTotal=4×被动破绽伤害比例×目标最大生命；跨技能被动值作为运行输入。');
  damagePending(x,'r_vital_hits','无双挑战破绽真实伤害','r_vital_true_damage');
  pending(x,'目标附近移速条件','官方明确目标附近获得被动移速；范围判定、衰减和主动标记消费未接线。','系统');
  exclude(x,'移速范围与未绑定攻速字段','MSRingRadius和PassiveAS只保留来源证据，不扩展空间或未绑定属性。');
  exclude(x,'第三名友方英雄治疗分发','只排除对其他友军的治疗分发；菲奥娜自己的持续治疗保留，参见同版本英文描述及当前客户端每秒公式。');
}
