import {begin,common,data,literal,parameter,formula,pn,attr,add,mul,clean,val,fval,behavior,life,result,effect,damage,statEffect,processStart,hit,pending,exclude,plan} from './英雄工具.mjs';

function namedBonusAd(x,calc,index,name){
 const p=x.p.mSpellCalculations[calc].mFormulaParts[index];
 if(p.__type!=='StatByNamedDataValueCalculationPart'||p.mStat!==2||p.mStatFormula!==2||p.mDataValue!==name)throw Error('额外攻击力项不符 '+x.c.skillKey+'/'+calc);
}
function namedTotalAd(x,calc,index,name){
 const p=x.p.mSpellCalculations[calc].mFormulaParts[index];
 if(p.__type!=='StatByNamedDataValueCalculationPart'||p.mStat!==2||p.mStatFormula!=null||p.mDataValue!==name)throw Error('总攻击力项不符 '+x.c.skillKey+'/'+calc);
}
function shield(x,key,name,formulaKey,duration){
 effect(x,key,name,[result('shield',name,'NORMAL_SHIELD','SOURCE',fval(formulaKey),{absorbedDamageTypeKey:null,decayMode:'NONE'},behavior,null)],life(duration),'独立普通护盾；耗尽会结束本效果生命周期。激活条件另行接线。');
}


{
 const x=begin('vi_p');
 const shieldPart=x.p.mSpellCalculations.TotalShield.mFormulaParts[0];
 if(shieldPart.__type!=='StatByCoefficientCalculationPart'||shieldPart.mStat!==12||shieldPart.mStatFormula!=null)throw Error('TotalShield不是最大生命系数');
 literal(x,'shield_max_hp_ratio','护盾最大生命系数',clean(shieldPart.mCoefficient),'当前根TotalShield：mStat=12、系数.12，按最大生命。','mSpellCalculations.TotalShield');
 data(x,'ShieldDuration','shield_duration_ms','护盾持续时间（毫秒）',{scale:1000});
 data(x,'CDReductionOn3Hit','cd_reduction_on_3_hit_ms','第三次爆弹重拳缩短护盾冷却（毫秒）',{scale:1000});
 x.c.proofs.push({source:'mSpellCalculations.ShieldCooldown',raw:x.p.mSpellCalculations.ShieldCooldown.mFormulaParts[0],disposition:'10级空断点的缺省斜率没有冻结解码证明，不生成等级表；原始16、-.5、10级断点与19级-6完整保留。'});
 pending(x,'护盾冷却断点默认解码','当前ShieldCooldown的10级节点没有mBonusPerLevelAtAndAfter；未核缺省值，不把16递减到12后固定或简单贯穿18级当已证。','来源');
 formula(x,'shield','爆裂护盾值',mul(pn('shield_max_hp_ratio'),attr('hp')),'12%最大生命。');
 shield(x,'blast_shield','爆裂护盾','shield',val('shield_duration_ms'));
 pending(x,'技能或建筑物命中后激活与护盾冷却','护盾公式和3秒期限候选已配置；须在已激活技能实际命中敌人或建筑物后施加，并受本技能护盾冷却约束。CDReductionOn3Hit=4秒只由W第三次触发，不在P自建减少规则。');
 pending(x,'被动护盾冷却不是主动技能冷却过程','当前ShieldCooldown是护盾再获得冷却，没有主动施放入口；不建立零消耗空过程。');
}

{
 const x=begin('vi_q');common(x);
 data(x,'MinDamage','min_damage','最低蓄力基础物理伤害');
 data(x,'ADRatio','bonus_ad_ratio','额外攻击力系数');
 data(x,'MaxDamageMult','max_damage_multiplier','最高蓄力相对TotalDamage倍率');
 data(x,'SelfSlow','self_slow_percent_points','蓄力自身减速百分点');
 data(x,'ChargeDuration','charge_window_ms','蓄力窗口（毫秒）',{scale:1000});
 x.c.proofs.push({source:'DataValues.VFXChargeDuration',raw:x.p.DataValues.find(v=>v.name==='VFXChargeDuration'),disposition:'5秒仅为视觉时长，不进入1V1技能组成，也不作为伤害蓄满时点。'});
 data(x,'CanceledRefundTime','cancel_cooldown_ms','取消后冷却（毫秒）',{scale:1000});
 data(x,'ManaRefundPercent','cancel_mana_refund_ratio','取消后法力返还比例');
 data(x,'KnockbackDuration','knockback_duration_ms','击退时长字段（毫秒）',{scale:1000});
 namedBonusAd(x,'TotalDamage',1,'ADRatio');
 const min=add(pn('min_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS')));
 formula(x,'min_damage','最低蓄力物理伤害',min,'40/60/80/100/120 + .6额外攻击力。');
 formula(x,'max_damage','最高蓄力物理伤害',mul(min,pn('max_damage_multiplier')),'整个TotalDamage×2.5，额外攻击力一并放大，不是另加一份基础。');
 damage(x,'min_damage','最低蓄力命中伤害','min_damage','physics',{description:'独立最低伤害；实际蓄力插值未核前不在命中时改写。'});
 damage(x,'max_damage','最高蓄力命中伤害','max_damage','physics',{description:'独立最高伤害参考；ChargeDuration=6与VFXChargeDuration=5不证明伤害蓄满时点。'});
 processStart(x);x.c.write.processes.at(-1).cooldown=null;x.c.write.processes.at(-1).description='开始蓄力仅绑定已确证法力消耗；正常释放、取消与冷却起算未核，不以一次IMMEDIATE启动普通冷却。';
 pending(x,'普通冷却的起算阶段','正常冷却与取消后3秒参数分别保留；开始蓄力、正常释放、中断阶段尚未闭环，开始蓄力过程不启动普通冷却。');
 pending(x,'蓄力伤害时点与中间插值','候选已配置最低/最高公式；6秒窗口和5秒特效不能当作伤害蓄满时刻，不自建充能过程或线性插值。','来源');
 pending(x,'取消3秒冷却与50%法力返还','须实际取消事件；正常命中或蓄满释放不得走返还。尚未接线取消过程。');
 pending(x,'命中施加爆弹重拳与英雄碰撞停下','Q实际命中只结算本体伤害候选；W层数与碰撞位移另接。');
 exclude(x,'冲刺位移、击退空间和非英雄拉近','1V1保留对敌伤害；位移与空间查找后置。击退时长字段仅作来源保留。');
}

{
 const x=begin('vi_w');
 data(x,'MaxHealthDamage','max_health_damage_percent_points','基础最大生命伤害百分点');
 data(x,'ADCoefficient','bonus_ad_health_coefficient','每1额外攻击力计入最大生命伤害的系数');
 literal(x,'tooltip_percent_scale','TotalDamageTooltip外层比例',0.01,'当前根TotalDamageTooltip.mMultiplier.mNumber=.01；百分点字段须先乘此外层再乘目标最大生命。','mSpellCalculations.TotalDamageTooltip.mMultiplier');
 data(x,'AttackSpeed','attack_speed_ratio','第三次触发攻速加成比例',{scale:.01});
 data(x,'ShredAmount','armor_shred_ratio','护甲削减比例',{scale:.01});
 data(x,'SharedBuffsDuration','buff_duration_ms','攻速与破甲持续时间（毫秒）',{scale:1000});
 data(x,'StacksBeforeEffect','stacks_before_effect','触发前已有层数');
 data(x,'MarkerBuffDuration','marker_duration_ms','同目标标记时长（毫秒）',{scale:1000});
 literal(x,'trigger_hit_count','同目标触发攻击次数',3,'主说明：对相同目标的每第三次攻击。','Spell_ViW_Tooltip');
 namedBonusAd(x,'TotalDamageTooltip',1,'ADCoefficient');
 const inner=add(pn('max_health_damage_percent_points'),mul(pn('bonus_ad_health_coefficient'),attr('attack_damage','SOURCE','BONUS')));
 formula(x,'damage','爆弹重拳额外物理伤害',mul(mul(pn('tooltip_percent_scale'),inner),attr('hp','TARGET')),'外层×.01×(4/5/6/7/8 + .035×额外攻击力)×目标最大生命；即基础4–8%加每100额外攻击力3.5%。');
 statEffect(x,'attack_speed','爆弹重拳攻速',val('attack_speed_ratio'),'bonus_attack_speed_percent',{duration:val('buff_duration_ms')});
 x.c.proofs.push({source:'当前DataValues.MonsterDamageCap',raw:x.p.DataValues.find(v=>v.name==='MonsterDamageCap'),disposition:'野怪上限后置，不写入1V1伤害公式'});
 pending(x,'第三次同目标、Q施加与P减冷却','伤害公式与4秒攻速候选已配置；同目标两层后第三次、Q命中施层、以及只由本触发缩短P冷却4秒均未接线，不能任意普攻或W技能命中结算。');
 pending(x,'第三次伤害的法术护盾与暴击资格','当前根与绑定只证明额外物理伤害；没有法术护盾或暴击资格的冻结依据，伤害效果已撤出候选，不能由通用damage默认RESULT与DISALLOWED代填。','来源');
 pending(x,'百分比削甲独立来源组合','20%持续4秒已确证；不能借用黑色切割者专属乘区或固定护甲减值冒充该来源。','系统');
 exclude(x,'野怪伤害上限','英雄目标完整伤害保留；野怪支路后置不能删掉英雄第三次伤害。');
}

{
 const x=begin('vi_e');common(x,{cooldown:false});
 data(x,'BaseDamage','base_damage','透体之劲基础物理伤害');
 data(x,'ADRatio','total_ad_ratio','总攻击力系数');
 data(x,'AttackBuffDuration','attack_window_ms','强化攻击保留时长（毫秒）',{scale:1000});
 data(x,'StaticCooldown','static_cooldown_ms','充能之间静态冷却（毫秒）',{scale:1000});
 data(x,'BonusRange','bonus_range','额外攻击距离字段');
 const ammo=x.p.mMaxAmmo,recharge=x.p.mAmmoRechargeTime;
 if(!ammo||ammo[1]!==2||!recharge||recharge.length<6)throw Error('弹药字段缺失');
 literal(x,'max_ammo','最大充能层数',2,'当前根mMaxAmmo全级为2，与说明2层一致。','mMaxAmmo');
 parameter(x,'ammo_recharge_ms','充能恢复时间（毫秒）',recharge.slice(1,6).map(v=>Math.round(v*1000)),'当前根mAmmoRechargeTime索引1至5为12/11/10/9/8秒；与StaticCooldown=1秒及官方显示冷却分开。');
 x.c.proofs.push({parameterKey:'ammo_recharge_ms',source:'mAmmoRechargeTime',raw:recharge,offset:1,values:recharge.slice(1,6).map(v=>Math.round(v*1000))});
 namedTotalAd(x,'TotalDamageTooltip',1,'ADRatio');
 const omitted=x.p.mSpellCalculations.TotalDamageTooltip.mFormulaParts[2];
 if(omitted.__type!=='StatByCoefficientCalculationPart'||omitted.mStat!=null||clean(omitted.mCoefficient)!==1)throw Error('省略属性节点不是无枚举系数1');
 literal(x,'omitted_stat_coefficient','省略属性枚举节点系数',1,'第三项StatByCoefficientCalculationPart仅有mCoefficient=1，未写mStat；不默认作法强。','mSpellCalculations.TotalDamageTooltip.mFormulaParts.2');
 x.c.write.parameters.push({parameterKey:'omitted_stat_value',name:'省略属性节点的已核数值',valueType:'DECIMAL',valueMode:'RUNTIME_INPUT',fixedValue:null,levelValues:null,description:'须提供该省略枚举节点经证实的属性取值；缺失不填零，不把默认法强或0当作已证。',sortOrder:(x.c.write.parameters.length+1)*10});
 formula(x,'attack_damage','透体之劲整次攻击物理伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage')),mul(pn('omitted_stat_coefficient'),pn('omitted_stat_value'))),'10/30/50/70/90 + 1.1总攻击力 + 省略节点已核项；该总量是整次攻击，不能再加一份普通攻击。');
 processStart(x);
 pending(x,'省略属性枚举默认值','系数1已保留；无mStat/mStatFormula时不猜作法强，独立输入缺失不能填0冒充已证。','来源');
 pending(x,'整次攻击交付、弹药恢复与法术护盾资格','公式可独立核算；mMaxAmmo、恢复时间与1秒静态冷却已分列。强化窗口6秒、普攻替换、身后穿透和法术护盾阻挡颗粒未核，不造假普攻命中，也不把官方1秒冷却写成普通cooldown_ms。');
 exclude(x,'目标身后多对象空间','主目标整次攻击公式保留；身后范围查找后置。');
}

{
 const x=begin('vi_r');common(x);
 data(x,'RBaseDamage','base_damage','主目标基础物理伤害');
 data(x,'RBonusADRatio','bonus_ad_ratio','额外攻击力系数');
 data(x,'RStunDuration','primary_knockup_ms','主目标击飞时长（毫秒）',{scale:1000});
 x.c.proofs.push({source:'DataValues.SecondaryTargetStunDuration',raw:x.p.DataValues.find(v=>v.name==='SecondaryTargetStunDuration'),disposition:'纯沿途次目标，保留来源但不进入本轮1V1组成。'});
 x.c.proofs.push({source:'DataValues.SecondaryTargetDamageMultiplier',raw:x.p.DataValues.find(v=>v.name==='SecondaryTargetDamageMultiplier'),disposition:'纯沿途次目标，保留来源但不进入本轮1V1组成。'});
 namedBonusAd(x,'Damage',1,'RBonusADRatio');
 if(Math.abs(x.p.spellCastTime-0.25)>1e-6||Math.abs(x.p.mCastTime-0.25)>1e-6)throw Error('R施法时间字段不一致');
 literal(x,'cast_time_ms','施法时间（毫秒）',250,'根spellCastTime与mCastTime均为.25秒。','spellCastTime+mCastTime');
 formula(x,'primary_damage','主目标物理伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'150/250/350 + .9额外攻击力。');
 damage(x,'primary_damage','天霸横空烈轰主目标伤害','primary_damage','physics');
 processStart(x,{stepKey:'cast_time',stepType:'DELAY',detail:{delayValue:val('cast_time_ms')}});hit(x,'primary_damage');
 pending(x,'主目标击飞与次目标眩晕','主目标1.3秒保留组成，沿途.75秒仅保留来源，不得混用。当前目录仅有眩晕；击飞不是眩晕。PERSISTENT+TARGET状态不能配置非空spellShieldBlockScope，不以null绕过阻挡。','系统');
 pending(x,'主目标接触后的实际击飞施加','伤害实际命中规则已候选；击飞须在接触主目标后按1.3秒期限施加，不能用次目标.75秒或无期限状态代替。');
 exclude(x,'沿途空间、显形与次目标执行','主目标伤害保留；冲刺路径、不可阻挡位移和沿途次目标即使倍率为1也不在本轮空间执行。');
}

export {plan};
