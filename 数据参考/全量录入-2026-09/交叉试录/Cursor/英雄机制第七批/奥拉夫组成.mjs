import {begin,common,data,literal,formula,pn,attr,add,mul,op,clean,val,fval,behavior,life,result,effect,damage,statEffect,processStart,hit,pending,exclude,plan} from './英雄工具.mjs';

function namedBonusAdCoeff(x,calc,index,coeff){
 const p=x.p.mSpellCalculations[calc].mFormulaParts[index];
 if(p.__type!=='StatByCoefficientCalculationPart'||p.mStat!==2||p.mStatFormula!==2||clean(p.mCoefficient)!==coeff)throw Error('额外攻击力系数不符 '+x.c.skillKey+'/'+calc);
}
function namedTotalAd(x,calc,index,name){
 const p=x.p.mSpellCalculations[calc].mFormulaParts[index];
 if(p.__type!=='StatByNamedDataValueCalculationPart'||p.mStat!==2||p.mStatFormula!=null||p.mDataValue!==name)throw Error('总攻击力项不符 '+x.c.skillKey+'/'+calc);
}
function namedTotalAdCoeff(x,calc,index,coeff){
 const p=x.p.mSpellCalculations[calc].mFormulaParts[index];
 if(p.__type!=='StatByCoefficientCalculationPart'||p.mStat!==2||p.mStatFormula!=null||clean(p.mCoefficient)!==coeff)throw Error('总攻击力系数不符 '+x.c.skillKey+'/'+calc);
}
function shield(x,key,name,formulaKey,duration){
 effect(x,key,name,[result('shield',name,'NORMAL_SHIELD','SOURCE',fval(formulaKey),{absorbedDamageTypeKey:null,decayMode:'NONE'},behavior,null)],life(duration),'独立普通护盾；耗尽结束本效果，不取消其它独立效果。');
}

{
 const x=begin('olaf_p');
 data(x,'MaxStatsThreshold','max_stats_threshold','达到满额时的剩余生命比例');
 const asPart=x.p.mSpellCalculations.MaxAttackSpeed.mFormulaParts[0],lsPart=x.p.mSpellCalculations.MaxLifeSteal.mFormulaParts[0];
 if(asPart.__type!=='ByCharLevelInterpolationCalculationPart'||asPart.mScaleByStatProgressionMultiplier!==true)throw Error('MaxAttackSpeed不是带成长倍率的插值');
 if(lsPart.__type!=='ByCharLevelInterpolationCalculationPart'||lsPart.mScaleByStatProgressionMultiplier!==true)throw Error('MaxLifeSteal不是带成长倍率的插值');
 literal(x,'max_attack_speed_start','攻速上限插值起点',clean(asPart.mStartValue),'MaxAttackSpeed.mStartValue=.5；mScaleByStatProgressionMultiplier=true，不按1–18级普通线性展开。','mSpellCalculations.MaxAttackSpeed');
 literal(x,'max_attack_speed_end','攻速上限插值终点',clean(asPart.mEndValue),'MaxAttackSpeed.mEndValue=1。','mSpellCalculations.MaxAttackSpeed');
 literal(x,'max_lifesteal_start','生命偷取上限插值起点',clean(lsPart.mStartValue),'MaxLifeSteal.mStartValue=.08。','mSpellCalculations.MaxLifeSteal');
 literal(x,'max_lifesteal_end','生命偷取上限插值终点',clean(lsPart.mEndValue),'MaxLifeSteal.mEndValue=.25。','mSpellCalculations.MaxLifeSteal');
 x.c.proofs.push({source:'当前DataValues.AttackSpeedPerMissingHPPerc',raw:x.p.DataValues.find(v=>v.name==='AttackSpeedPerMissingHPPerc'),disposition:'未采用.009每1%缺血去代替未解码的MaxAttackSpeed成长倍率'});
 pending(x,'MaxAttackSpeed/MaxLifeSteal成长倍率插值','端点.5→1与.08→.25已保留；mScaleByStatProgressionMultiplier未解码，不以1–18级普通线性或AttackSpeedPerMissingHPPerc=.009冒充本等级上限。','来源');
 pending(x,'缺血比例到收益的中间映射','当前绑定只证明基于已损失生命、剩余30%时达到上限；没有missingHP/maxHP/.7的线性函数证据。已撤两条进度公式及专用输入，只保留5个确证阈值与端点。','来源');
 pending(x,'持续动态属性不能引用计算时输入','未来补齐动态缺血收益仍受PERSISTENT+MOMENT_EVALUATION递归禁止RUNTIME_INPUT的约束；不能用快照绕过随缺血改变的需求。当前没有相关公式或持续效果。','系统');
}

{
 const x=begin('olaf_q');common(x);
 data(x,'BaseDamage','base_damage','逆流投掷基础物理伤害');
 literal(x,'bonus_ad_ratio','额外攻击力系数',1,'当前根TotalDamage第二项mStat=2、mStatFormula=2、mCoefficient=1。','mSpellCalculations.TotalDamage');
 data(x,'SlowAmount','slow_ratio','减速比例');
 data(x,'ShredAmount','armor_shred_ratio','护甲削减比例');
 data(x,'DebuffDuration','shred_duration_ms','护甲削减持续（毫秒）',{scale:1000});
 data(x,'MinSlowDuration','min_slow_duration_ms','最短减速时长（毫秒）',{scale:1000});
 data(x,'MaxSlowDuration','max_slow_duration_ms','最长减速时长（毫秒）',{scale:1000});
 data(x,'MinSlowDistance','min_slow_distance','最短减速参考距离');
 data(x,'MaxSlowDistance','max_slow_distance','最长减速参考距离');
 data(x,'MinimumCooldown','pickup_cooldown_floor_ms','拾斧后剩余冷却下限（毫秒）',{scale:1000});
 namedBonusAdCoeff(x,'TotalDamage',1,1);
 if(Math.abs(x.p.spellCastTime-0.25)>1e-6||Math.abs(x.p.mCastTime-0.25)>1e-6)throw Error('Q施法时间字段不一致');
 literal(x,'cast_time_ms','施法时间（毫秒）',250,'根spellCastTime与mCastTime均为.25秒。','spellCastTime+mCastTime');
 formula(x,'damage','逆流投掷物理伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'70/120/170/220/270 + 1.0额外攻击力。');
 damage(x,'axe_damage','逆流投掷实际伤害','damage','physics');
 processStart(x,{stepKey:'cast_time',stepType:'DELAY',detail:{delayValue:val('cast_time_ms')}});hit(x,'axe_damage');
 x.c.proofs.push({source:'TooltipCDRefund',raw:x.p.mSpellCalculations.TooltipCDRefund,disposition:'拾斧把剩余冷却缩到该计算（含冷却倍率），不是固定减少2.5秒'});
 pending(x,'拾斧将剩余冷却设为TooltipCDRefund','MinimumCooldown=2.5秒候选已配置；须实际拾取事件把剩余冷却设到该值（可受冷却倍率），不能写成REDUCE 2500毫秒。');
 pending(x,'减速幅度/时长随距离','减速比例按技能等级30–50%，时长1–3秒依距离；最短/最长时长与距离字段已保留，不猜线性插值，也无减速状态目录。','来源');
 pending(x,'百分比削甲独立来源组合','20%持续4秒已确证；不能借用黑色切割者专属乘区或固定护甲减值冒充该来源。','系统');
 exclude(x,'斧落地空间、多目标和野怪额外伤害','英雄目标伤害保留；拾斧空间与野怪额外伤害后置。');
}

{
 const x=begin('olaf_w');common(x);
 data(x,'Attackspeed','attack_speed_ratio','额外攻速比例');
 data(x,'Duration','attack_speed_duration_ms','攻速持续（毫秒）',{scale:1000});
 data(x,'BaseShield','base_shield','护盾基础值');
 data(x,'ShieldPercMissingHP','missing_hp_ratio','已损失生命护盾系数');
 data(x,'ShieldDuration','shield_duration_ms','护盾持续（毫秒）',{scale:1000});
 data(x,'ThresholdForMax','max_shield_hp_threshold','护盾满额剩余生命比例');
 literal(x,'one','生命比例单位',1,'用1减去剩余生命阈值得到满额已损失比例。');
 const uncapped=add(pn('base_shield'),mul(pn('missing_hp_ratio'),attr('hp','SOURCE','MISSING')));
 const capped=add(pn('base_shield'),mul(pn('missing_hp_ratio'),mul(op('SUBTRACT',pn('one'),pn('max_shield_hp_threshold')),attr('hp'))));
 formula(x,'uncapped_shield','未封顶护盾',uncapped,'基础10/40/70/100/130 + .175已损失生命。');
 formula(x,'max_shield','低于30%生命时的护盾上限',capped,'基础 + .175×(1-.3)×最大生命。');
 formula(x,'shield','挺过去护盾值',op('MIN',uncapped,capped),'已损失生命护盾在剩余生命低于30%时按上限封顶。');
 shield(x,'cast_shield','挺过去护盾','shield',val('shield_duration_ms'));
 statEffect(x,'attack_speed','挺过去攻速',val('attack_speed_ratio'),'bonus_attack_speed_percent',{duration:val('attack_speed_duration_ms'),description:'独立5秒攻速；护盾2.5秒耗尽不得提前取消本效果。'});
 processStart(x,{effects:['cast_shield','attack_speed']});
}

{
 const x=begin('olaf_e');common(x,{mana:false});
 data(x,'BaseDamage','base_damage','鲁莽挥击基础真实伤害');
 literal(x,'total_ad_ratio','总攻击力系数',0.5,'当前根TotalDamage第二项mStat=2、无mStatFormula、mCoefficient=.5，按总攻击力。','mSpellCalculations.TotalDamage');
 data(x,'HealthCostPercent','health_cost_ratio','生命消耗相对本次伤害比例');
 data(x,'ChampionRefresh','champion_attack_cdr_ms','英雄普攻缩短冷却（毫秒）',{scale:1000});
 data(x,'Cast_Time_Base','cast_time_base_ms','无额外攻速时施放时间（毫秒）',{scale:1000});
 data(x,'Cast_Time_Min','cast_time_min_ms','施放时间下限（毫秒）',{scale:1000});
 data(x,'Cast_Time_Attack_Speed_Cap','cast_time_bonus_as_cap','影响施放时间的额外攻速上限字段');
 namedTotalAdCoeff(x,'TotalDamage',1,0.5);
 const dmg=add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage')));
 formula(x,'damage','鲁莽挥击真实伤害',dmg,'70/115/160/205/250 + .5总攻击力。');
 formula(x,'health_cost','施放生命消耗',mul(pn('health_cost_ratio'),dmg),'HealthCostCalc=.4×TotalDamage；不用旧30%或法力。');
 damage(x,'reckless_damage','鲁莽挥击实际伤害','damage','real');
 effect(x,'health_cost','施放生命消耗',[result('consume_health','消耗生命','RESOURCE_CHANGE','SOURCE',fval('health_cost'),{attributeKey:'hp',operation:'CONSUME'})],null,'仅本次伤害40%的生命消耗；击杀返还须另接因果。');
 x.c.write.processes.push({processKey:'cast',name:'施放'+x.c.name,activationType:'ACTIVE',description:'只绑定生命消耗与基础冷却；不生成命中，也不把未解码攻速函数写成延迟。',sortOrder:10,cooldown:{durationValue:val('cooldown_ms'),startMoment:{momentType:'PROCESS_START',stepKey:null}},steps:[{stepKey:'start',name:'施放开始',description:null,sortOrder:10,stepType:'IMMEDIATE',detail:{}}],effectBindings:[{bindingKey:'health_cost',effectKey:'health_cost',moment:{momentType:'PROCESS_START',stepKey:null},sortOrder:10}],stateOperations:[]});
 hit(x,'reckless_damage');
 x.c.proofs.push({source:'旧BaseHealthCost/HealthCostADRatio计算',raw:x.p.mSpellCalculations['{fcf1daee}'],disposition:'不采用；当前生命消耗以HealthCostCalc=.4×TotalDamage为准'});
 pending(x,'击杀返还本次生命消耗','返还必须由本次鲁莽挥击伤害造成的击杀触发；不能任意击杀或其它技能伤害返还。');
 pending(x,'英雄普攻缩短E冷却1秒','ChampionRefresh=1秒候选已配置；须实际英雄普攻命中再减少冷却，不能用本技能命中或假事件代替。');
 pending(x,'额外攻速影响施放时间的完整函数','250毫秒到175毫秒与攻速上限字段已保留；完整插值未显式，不猜函数，也不把spellCastTime=.25且mCastTime空当作已证延迟。','来源');
 exclude(x,'野怪普攻减2秒冷却','英雄普攻减1秒参数保留；野怪2秒后置。');
}

{
 const x=begin('olaf_r');common(x);
 data(x,'Resists','passive_resist','被动双抗');
 data(x,'FlatAD','base_attack_damage','主动基础攻击力');
 data(x,'PercentTotalADAmp','total_ad_ratio','主动总攻击力加成系数');
 data(x,'Duration','active_duration_ms','主动基础持续（毫秒）',{scale:1000});
 data(x,'DurationExtension','champion_hit_extension_ms','英雄攻击或鲁莽挥击延长（毫秒）',{scale:1000});
 data(x,'Haste','move_speed_ratio','朝向敌方英雄加速比例');
 data(x,'HasteDuration','move_speed_duration_ms','朝向加速持续（毫秒）',{scale:1000});
 namedTotalAd(x,'AD',1,'PercentTotalADAmp');
 formula(x,'active_attack_damage','主动获得的攻击力',add(pn('base_attack_damage'),mul(pn('total_ad_ratio'),attr('attack_damage'))),'10/20/30 + .25总攻击力的独立算术；读取时点与排除自身增益的口径尚未确证，不据此指定快照或持续读取。');
 statEffect(x,'passive_armor','诸神黄昏被动护甲',val('passive_resist'),'armor');
 statEffect(x,'passive_magic_resistance','诸神黄昏被动魔抗',val('passive_resist'),'magic_resistance');
 processStart(x);
 pending(x,'主动攻击力的读取时点与自增益排除','当前根只给出总攻击力算式，没有证明应用时快照或持续读取；不能因为技术上避免反馈而指定游戏取值时点。撤出主动AD效果及过程绑定，独立公式保留。','来源');
 pending(x,'被动双抗的学习时点','10/15/20双抗效果候选已配置；R未学习时不应存在，不能用对局开始初始化代替升级获得。');
 pending(x,'英雄普攻或E命中延长2.5秒','延长不是把期限刷新成固定3秒；须实际命中英雄的攻击或鲁莽挥击。');
 pending(x,'朝向敌方英雄的加速条件','20/45/70%与1秒候选已配置；不能无条件施加移动速度。');
 pending(x,'净化与控制免疫','通用控制净化不能只移除眩晕；当前没有通用净化/免疫能力，不以STATUS_OPERATION清眩晕冒充。','系统');
}

export {plan};
