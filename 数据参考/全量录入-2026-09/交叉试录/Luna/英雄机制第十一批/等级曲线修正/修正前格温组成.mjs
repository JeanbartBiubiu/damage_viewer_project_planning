import {begin,common,data,literal,runtime,formula,requireCalc,pn,attr,add,mul,damagePending,healPending,pending,exclude,excludeData,interpolation} from './候选.mjs';

// 被动：目标最大生命魔法伤害和对英雄实际伤害的自我治疗关系保留；小兵/野怪执行分支排除。
{
  const x=begin('gwen_p');
  excludeData(x,'ExecuteThreshold','低生命小兵执行阈值；本批不新增小兵支路。');
  const healing=requireCalc(x,'HealingPercent').mFormulaParts?.[0];
  if(healing?.__type!=='NumberCalculationPart'||healing.mNumber==null)throw Error('格温P治疗比例树字段不符');
  literal(x,'healing_ratio','被动对英雄伤害治疗比例',0.67,'HealingPercent明确为67%伤害值；仅作为对英雄实际伤害的治疗比例。','mSpellCalculations.HealingPercent.mFormulaParts[0]');
  const percent=requireCalc(x,'{540bce84}');
  if(percent?.mFormulaParts?.[0]?.__type!=='NumberCalculationPart'||percent?.mFormulaParts?.[0]?.mNumber==null||percent?.mFormulaParts?.[1]?.mCoefficient==null||percent?.mFormulaParts?.[1]?.mStat!=null)throw Error('格温P生命伤害比例树字段不符');
  literal(x,'passive_base_damage_percent','被动最大生命伤害基础百分比点',1,'匿名{540bce84}第一项为数字1；当前显示为百分比，不把其直接当生命比例。','mSpellCalculations.{540bce84}.mFormulaParts[0]');
  literal(x,'passive_ap_damage_percent_per_ap','被动最大生命伤害法强百分比点系数',0.006,'匿名{540bce84}第二项为省略属性枚举的0.006系数；按已证默认0映射为法强。','mSpellCalculations.{540bce84}.mFormulaParts[1]');
  formula(x,'passive_damage_percent','被动最大生命伤害百分比点',add(pn('passive_base_damage_percent'),mul(pn('passive_ap_damage_percent_per_ap'),attr('ability_power','SOURCE','TOTAL'))),'匿名{540bce84}=1+0.006×法强，保留其百分比点口径。');
  const percentHp=requireCalc(x,'PercentHealth1000Cuts');
  if(percentHp?.mMultiplier?.mNumber==null||percentHp?.mModifiedGameCalculation!=='{540bce84}')throw Error('格温P最大生命伤害修改树字段不符');
  literal(x,'percent_to_ratio','百分比点转生命比例',0.01,'PercentHealth1000Cuts明确为0.01×{540bce84}；用于将百分比点转成目标最大生命比例。','mSpellCalculations.PercentHealth1000Cuts');
  x.c.proofs.push({source:'mSpellCalculations.PercentHealth1000Cuts',raw:percentHp,semantic:'PercentHealth1000Cuts=0.01×{540bce84}，与官方最大生命百分比文本相连。'});
  formula(x,'passive_damage_ratio','被动最大生命伤害比例',mul(pn('percent_to_ratio'),add(pn('passive_base_damage_percent'),mul(pn('passive_ap_damage_percent_per_ap'),attr('ability_power','SOURCE','TOTAL')))),'内联PercentHealth1000Cuts与匿名{540bce84}计算树。');
  formula(x,'passive_magic_damage','千穿百孔对英雄额外魔法伤害',mul(mul(pn('percent_to_ratio'),add(pn('passive_base_damage_percent'),mul(pn('passive_ap_damage_percent_per_ap'),attr('ability_power','SOURCE','TOTAL')))),attr('hp','TARGET','TOTAL')),'攻击附带目标最大生命比例的额外魔法伤害；表达式内联PercentHealth1000Cuts与匿名比例树。');
  const cap=requireCalc(x,'HealCap').mFormulaParts;
  if(cap?.[0]?.__type!=='ByCharLevelInterpolationCalculationPart'||cap?.[1]?.mCoefficient==null||cap?.[1]?.mStat!=null)throw Error('格温P治疗上限树字段不符');
  interpolation(x,'heal_cap_level','被动治疗等级上限',cap[0]);
  literal(x,'heal_cap_ap_ratio','被动治疗上限法强系数',0.07,'HealCap第二节点省略属性枚举；按已证默认0映射为法强。','mSpellCalculations.HealCap.mFormulaParts[1]');
  formula(x,'heal_cap','被动治疗上限',add(pn('heal_cap_level'),mul(pn('heal_cap_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'HealCap=等级插值+0.07×法强；上下限裁剪和实际治疗时点由运行时处理。');
  runtime(x,'actual_passive_hero_damage','被动对英雄实际额外伤害','治疗按被动对英雄造成的实际伤害计算；只接受结算后的实际值，不以未减免公式代替。');
  formula(x,'passive_heal_amount','千穿百孔对英雄自我治疗',mul(pn('healing_ratio'),pn('actual_passive_hero_damage')),'被动自我治疗=HealingPercent×对英雄实际额外伤害；HealCap作为独立上限参数。');
  damagePending(x,'passive_attack','千穿百孔对英雄额外魔法伤害','passive_magic_damage');
  healPending(x,'passive_heal','千穿百孔对英雄自我治疗','passive_heal_amount');
  for(const key of ['MonsterDamageCap','PassiveMaxQTooltip','PassiveMaxRTooltip','{4197830d}','{4097817a}','{5bade13c}','ExecuteDamage']){
    const calc=x.p.mSpellCalculations?.[key];
    if(calc)x.c.proofs.push({source:'mSpellCalculations.'+key,raw:calc,excluded:true,semantic:key==='MonsterDamageCap'||key==='ExecuteDamage'?'小兵/野怪专用支路；本批排除。':key==='PassiveMaxQTooltip'||key==='PassiveMaxRTooltip'||key==='{4197830d}'||key==='{4097817a}'?'扩展提示/派生显示字段；不重复生成伤害结果。':'被动层数内部状态计算节点；触发时序未接线。'});
  }
  exclude(x,'匿名提示/内部状态字段','PassiveMaxQTooltip、PassiveMaxRTooltip及匿名层数节点仅保留来源证据，不重复生成结果或状态过程。');
  exclude(x,'小兵/野怪专用效果','ExecuteThreshold、ExecuteDamage和MonsterDamageCap只服务小兵/野怪；本批只保留英雄伤害/治疗公式。');
  pending(x,'被动攻击命中与治疗上限','攻击命中、对英雄资格、护盾/吸血消费、HealCap裁剪和被动在Q/R中心命中的状态条件未接线。','系统');
}

// Q：各段魔法伤害及中心区域真实伤害转换比例保留；充能消费和小兵规则留证。
{
  const x=begin('gwen_q');
  common(x,{cast:true});
  excludeData(x,'InitialArcLength','剪刀初始区域长度，属于空间字段。');
  data(x,'SwipeDamageBase','final_swipe_base_damage','最终剪切基础魔法伤害');
  excludeData(x,'MiniDamageRatio','未绑定当前Final/Mini计算树的旧比例字段，保留原始证据。');
  data(x,'APRatio','final_swipe_ap_ratio','最终剪切法强倍率');
  data(x,'BuffDuration','charge_duration_ms','攻击充能持续时间（毫秒）',{scale:1000});
  data(x,'MiniSwipeBaseDamage','mini_swipe_base_damage','小剪切基础魔法伤害');
  data(x,'TrueDamageConversion','center_true_damage_ratio','中心区域真实伤害转换比例');
  excludeData(x,'ExecuteBonus','低生命小兵额外伤害字段；本批排除。');
  excludeData(x,'MinionMod','小兵伤害修正字段；本批排除。');
  excludeData(x,'ExecuteThreshold','低生命小兵执行阈值；本批排除。');
  data(x,'MiniSwipeAPRatio','mini_swipe_ap_ratio','小剪切法强倍率');
  const final=requireCalc(x,'FinalSwipeDamage').mFormulaParts;
  if(final?.[0]?.mDataValue!=='SwipeDamageBase'||final?.[1]?.mStat!=null||final?.[1]?.mDataValue!=='APRatio')throw Error('格温Q最终剪切树字段不符');
  const mini=requireCalc(x,'MiniSwipeDamage').mFormulaParts;
  if(mini?.[0]?.mDataValue!=='MiniSwipeBaseDamage'||mini?.[1]?.mStat!=null||mini?.[1]?.mDataValue!=='MiniSwipeAPRatio')throw Error('格温Q小剪切树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.FinalSwipeDamage/MiniSwipeDamage',raw:{final,mini},semantic:'两个StatByNamedDataValue均省略属性字段；按已证默认0映射为法强。'});
  formula(x,'final_swipe_damage','格温最终剪切魔法伤害',add(pn('final_swipe_base_damage'),mul(pn('final_swipe_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'FinalSwipeDamage=SwipeDamageBase+APRatio×法强。');
  formula(x,'mini_swipe_damage','格温小剪切魔法伤害',add(pn('mini_swipe_base_damage'),mul(pn('mini_swipe_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'MiniSwipeDamage=MiniSwipeBaseDamage+MiniSwipeAPRatio×法强。');
  literal(x,'max_mini_swipe_count','最大前置小剪切次数',5,'MaxDamage树将小剪切两项各乘5；不把实际充能层数固定为5。','mSpellCalculations.MaxDamage');
  const max=requireCalc(x,'MaxDamage').mFormulaParts?.[0];
  if(max?.__type!=='SumOfSubPartsCalculationPart')throw Error('格温Q最大伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.MaxDamage',raw:requireCalc(x,'MaxDamage'),semantic:'最大伤害树为最终剪切+5×小剪切法强项+5×小剪切基础项；以下公式内联子树。'});
  formula(x,'max_damage','格温Q最大魔法伤害',add(add(pn('final_swipe_base_damage'),mul(pn('final_swipe_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),mul(pn('max_mini_swipe_count'),add(pn('mini_swipe_base_damage'),mul(pn('mini_swipe_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))))),'MaxDamage树内联FinalSwipeDamage与MiniSwipeDamage；不把层数/中心区域命中伪造成过程。');
  damagePending(x,'final_swipe_hit','格温Q最终剪切魔法/真实伤害','final_swipe_damage');
  damagePending(x,'mini_swipe_hit','格温Q小剪切魔法/真实伤害','mini_swipe_damage');
  damagePending(x,'max_swipe','格温Q最大剪切魔法伤害','max_damage');
  exclude(x,'剪切空间和旧字段','InitialArcLength与未绑定当前计算树的MiniDamageRatio只保留来源证据。');
  pending(x,'充能层数与中心区域转换','官方明确每次攻击获得充能、消耗全部充能并在中心区域按比例转为真实伤害且施加被动；充能层数、切割次数、中心命中和伤害分包未接线。','系统');
  exclude(x,'小兵专用规则','ExecuteBonus、MinionMod、ExecuteThreshold仅用于小兵；不新增小兵伤害。');
}

// W：圣霭持续时间、结界内双抗和再次施放窗口保留；不可选取和空间边界留待状态系统。
{
  const x=begin('gwen_w');
  common(x,{cast:true});
  excludeData(x,'ZONE_VARS','缺少values的结界内部状态字段；不补零。');
  data(x,'ZoneDuration','zone_duration_ms','圣霭持续时间（毫秒）',{scale:1000});
  excludeData(x,'ZoneRadius','圣霭半径，属于空间字段。');
  excludeData(x,'ZonePullSpeed','圣霭移动速度，属于空间字段。');
  excludeData(x,'PullOffset','圣霭移动偏移，属于空间字段。');
  excludeData(x,'ZoneWallOffset','圣霭墙体偏移，属于空间字段。');
  data(x,'NewDashCooldown','recast_cooldown_ms','再次施放后新结界冷却窗口（毫秒）',{scale:1000});
  data(x,'RecastDelay','recast_delay_ms','再次施放延迟（毫秒）',{scale:1000});
  data(x,'BaseResists','base_resists','结界内基础额外双抗');
  excludeData(x,'DashTargetForgiveness','再次施放目标容错范围，属于空间字段。');
  const total=requireCalc(x,'TotalResists').mFormulaParts;
  if(total?.[0]?.mDataValue!=='BaseResists'||total?.[1]?.mCoefficient==null||total?.[1]?.mStat!=null)throw Error('格温W双抗树字段不符');
  literal(x,'resists_ap_ratio','结界内双抗法强系数',0.07,'TotalResists第二节点省略属性字段；按已证默认0映射为法强。','mSpellCalculations.TotalResists.mFormulaParts[1]');
  formula(x,'total_resists','圣霭结界内额外护甲和魔法抗性',add(pn('base_resists'),mul(pn('resists_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'TotalResists=BaseResists+0.07×法强；同时用于护甲和魔法抗性。');
  exclude(x,'圣霭空间字段','ZoneRadius、ZonePullSpeed、PullOffset、ZoneWallOffset和DashTargetForgiveness只保留空间证据；ZONE_VARS缺值不补零。');
  pending(x,'结界内外目标与不可选取','官方明确结界外敌人无法选取格温、结界内获得双抗且离开会结束/自动再次施放；空间边界、状态免疫、目标过滤和触发时点未接线。','系统');
}

// E：强化攻击附加魔法伤害、攻速/攻击距离和命中返还参数保留；冲刺空间和攻击事件待接线。
{
  const x=begin('gwen_e');
  common(x,{cast:true});
  excludeData(x,'DashRange','冲刺距离，属于空间字段。');
  excludeData(x,'DashSpeed','冲刺速度，属于空间字段。');
  excludeData(x,'WallCheatDistance','地形穿越偏移，属于空间字段。');
  data(x,'BuffDuration','buff_duration_ms','攻击强化持续时间（毫秒）',{scale:1000});
  data(x,'BaseAttackSpeed','base_attack_speed_percent','强化攻击基础攻速百分比点');
  data(x,'CDRefund','cooldown_refund_ratio','首次命中后的冷却返还比例');
  excludeData(x,'BonusAttackRange','强化攻击距离，属于攻击范围字段。');
  data(x,'BaseDamage','base_damage','强化攻击附加魔法伤害基础值');
  const as=requireCalc(x,'BonusAttackSpeed');
  if(as?.mMultiplier?.mNumber==null||as?.mFormulaParts?.[0]?.mDataValue!=='BaseAttackSpeed')throw Error('格温E攻速树字段不符');
  literal(x,'percent_to_ratio','攻速百分比点转比例',0.01,'BonusAttackSpeed明确为0.01×BaseAttackSpeed并按百分比显示。','mSpellCalculations.BonusAttackSpeed');
  formula(x,'bonus_attack_speed_ratio','强化攻击额外攻速比例',mul(pn('percent_to_ratio'),pn('base_attack_speed_percent')),'BonusAttackSpeed=0.01×BaseAttackSpeed。');
  const onHit=requireCalc(x,'OnHitDamage').mFormulaParts;
  if(onHit?.[0]?.mDataValue!=='BaseDamage'||onHit?.[1]?.mCoefficient==null||onHit?.[1]?.mStat!=null)throw Error('格温E附伤树字段不符');
  literal(x,'on_hit_ap_ratio','强化攻击附加伤害法强倍率',0.2,'OnHitDamage第二节点省略属性字段；按已证默认0映射为法强。','mSpellCalculations.OnHitDamage.mFormulaParts[1]');
  formula(x,'on_hit_damage','断续疾走强化攻击附加魔法伤害',add(pn('base_damage'),mul(pn('on_hit_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'OnHitDamage=BaseDamage+0.2×法强。');
  damagePending(x,'empowered_attack','断续疾走强化攻击附加魔法伤害','on_hit_damage');
  pending(x,'强化攻击与首次命中返还','官方明确持续期间强化攻击获得攻速、攻击距离和附加魔法攻击特效，首次命中返还冷却；攻击事件、持续时间、返还基数和法术护盾资格未接线。','系统');
  exclude(x,'冲刺空间效果','DashRange、DashSpeed、WallCheatDistance与BonusAttackRange只保留空间/范围证据。');
}

// R：三段针数的魔法伤害公式、减速和再次施放锁定时间保留；被动施加与层数时序留待状态事件。
{
  const x=begin('gwen_r');
  common(x,{cast:true});
  data(x,'DebuffDuration','slow_duration_ms','首段减速持续时间（毫秒）',{scale:1000});
  data(x,'SlowAmount','slow_amount_ratio','根减速比例字段');
  data(x,'BaseDamage','base_damage','每针基础魔法伤害');
  data(x,'InitialSlow','initial_slow_ratio','首段减速比例',{scale:-1});
  data(x,'SubsequentSlow','subsequent_slow_ratio','后续针重复命中减速比例',{scale:-1});
  data(x,'LockoutTime','recast_lockout_ms','两段再次施放间隔（毫秒）',{scale:1000});
  const total=requireCalc(x,'TotalDamage').mFormulaParts;
  if(total?.[0]?.mDataValue!=='BaseDamage'||total?.[1]?.mCoefficient==null||total?.[1]?.mStat!=null)throw Error('格温R单针伤害树字段不符');
  literal(x,'ap_ratio','每针魔法伤害法强倍率',0.1,'TotalDamage第二节点省略属性字段；按已证默认0映射为法强。','mSpellCalculations.TotalDamage.mFormulaParts[1]');
  formula(x,'total_damage','格温R单针魔法伤害',add(pn('base_damage'),mul(pn('ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'TotalDamage=BaseDamage+0.1×法强。');
  literal(x,'three_needles','第二段针数',3,'TotalDamage3明确为3×TotalDamage。','mSpellCalculations.TotalDamage3');
  literal(x,'five_needles','第三段针数',5,'TotalDamage5明确为5×TotalDamage。','mSpellCalculations.TotalDamage5');
  literal(x,'nine_needles','三段总针数',9,'MaxDamage明确为9×TotalDamage。','mSpellCalculations.MaxDamage');
  formula(x,'total_damage_3','格温R第二段魔法伤害',mul(pn('three_needles'),add(pn('base_damage'),mul(pn('ap_ratio'),attr('ability_power','SOURCE','TOTAL')))),'TotalDamage3=3×TotalDamage，表达式内联单针树。');
  formula(x,'total_damage_5','格温R第三段魔法伤害',mul(pn('five_needles'),add(pn('base_damage'),mul(pn('ap_ratio'),attr('ability_power','SOURCE','TOTAL')))),'TotalDamage5=5×TotalDamage，表达式内联单针树。');
  formula(x,'max_damage','格温R三段最大魔法伤害',mul(pn('nine_needles'),add(pn('base_damage'),mul(pn('ap_ratio'),attr('ability_power','SOURCE','TOTAL')))),'MaxDamage=9×TotalDamage，表达式内联单针树。');
  damagePending(x,'first_cast','格温R首段单针魔法伤害','total_damage');
  damagePending(x,'second_cast','格温R第二段三针魔法伤害','total_damage_3');
  damagePending(x,'third_cast','格温R第三段五针魔法伤害','total_damage_5');
  damagePending(x,'max_cast','格温R三段最大魔法伤害','max_damage');
  pending(x,'三段施放与被动施加','官方明确首段命中施加被动、最多两次再次施放且锁定间隔为1秒；针数、重复命中减速、被动层数和命中事件未接线。','系统');
}
