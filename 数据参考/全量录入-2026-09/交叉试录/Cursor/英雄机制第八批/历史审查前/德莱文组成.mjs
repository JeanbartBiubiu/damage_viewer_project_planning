import {begin,data,literal,formula,pn,attr,add,mul,val,common,statEffect,effect,result,runtime,pending,exclude} from './英雄工具.mjs';

function explicitBonusAD(x,calc,dataName=null,coefficient=null){
 const part=x.p.mSpellCalculations[calc].mFormulaParts.find(v=>v.mStat===2);
 if(!part||part.mStatFormula!==2)throw Error('缺少明确额外攻击力节点 '+x.c.skillKey);
 if(dataName&&part.mDataValue!==dataName)throw Error('额外攻击力数据源不符');
 if(coefficient!==null&&Math.abs(part.mCoefficient-coefficient)>1e-6)throw Error('额外攻击力系数不符');
 x.c.proofs.push({semantic:'攻击力加成值',source:'mSpellCalculations.'+calc,raw:part,independentEvidence:'当前Draven R升级列表RCoefficient明确nameOverride=Spell_ListType_BonusADRatio；同mStat2/mStatFormula2组合。'});
 return attr('attack_damage','SOURCE','BONUS');
}
function noAutomaticDamage(x,component='实际伤害接线'){
 pending(x,component,'确定伤害公式独立保留；当前资料没有足够证据确定该分支的法术护盾、暴击及吸血资格与真实触发供值。本轮不使用默认RESULT/null或普通命中代替这些规则。');
}
function costOnly(x){
 common(x);
 pending(x,'施放过程与冷却起算','消耗和基础冷却参数已核对；独立法力消耗效果未接施放过程，不根据通用helper猜当前技能的起算点、蓄留或再次施放行为。');
}
{
 const x=begin('draven_p');
 data(x,'StackGain','catch_adoration_gain','接斧获得崇拜层数');
 data(x,'PercentOfStacksLost','death_adoration_loss_ratio','阵亡损失崇拜比例',{scale:.01});
 pending(x,'R依赖的当前崇拜层数','崇拜同时决定R处决阈值，不能与金币奖励一并排除。R保留明确当前层数输入；P接斧加层、英雄击杀消费全部层数的生命周期与跨技能状态尚未接线。');
 pending(x,'死亡扣层整数舍入','当前主根给出50%扣层，但奇数层扣除的取整方式未明确；不创建取整公式或猜初始层数。','来源');
 exclude(x,'金币与赏金统计','PassiveGoldBase、PassiveGoldPerStack及历史金币统计不影响当前1V1伤害；不录入奖励计算。');
 exclude(x,'非英雄单位/建筑击杀及特殊模式叠层','小兵野怪建筑、连续击杀小兵奖励和Cherry回合层数不在本批1V1范围。接斧与R层数依赖保留。');
}
{
 const x=begin('draven_q');costOnly(x);
 data(x,'BaseDamage','base_bonus_damage','旋转飞斧额外基础伤害');
 data(x,'ADScaling','bonus_ad_ratio','旋转飞斧额外攻击力系数');
 data(x,'DurationTOOLTIP','idle_axe_expiry_ms','未攻击丢弃飞斧说明期限（毫秒）',{scale:1000});
 literal(x,'max_held_axes','可同时持有飞斧数',2,'当前主技能官方与mLocKeys均明确可同时持有2把旋转飞斧。','mLocKeys.keyTooltip');
 formula(x,'bonus_attack_damage','旋转飞斧额外物理伤害',add(pn('base_bonus_damage'),mul(pn('bonus_ad_ratio'),explicitBonusAD(x,'TotalDamage','ADScaling'))),'当前主根40/45/50/55/60 + .75/.85/.95/1.05/1.15额外攻击力；是普通攻击的额外部分，不再加第二份基础普攻。');
 pending(x,'飞斧期限差异','当前说明DurationTOOLTIP=6秒未攻击丢弃；同根AxeDuration=5.75秒用途未明确，不能替换成5.75秒生命周期。','来源');
 pending(x,'飞斧状态与接住后的三处联动','真实持斧攻击、消耗、接住、P加层和W重置必须保持同一因果；不在每次普通攻击无条件造成Q额外伤害，不用落点空间跳过理由删掉P/W依赖。');
 noAutomaticDamage(x);
 exclude(x,'斧头落点和建筑回弹','飞斧抛物线/落点拾取空间计算及建筑不回弹分支后置；独立额外伤害与接斧依赖仍保留。');
}
{
 const x=begin('draven_w');costOnly(x);
 data(x,'Temp_AS','attack_speed_gain_ratio','血性冲刺攻击速度加成比例',{scale:.01});
 data(x,'Temp_ASDuration','attack_speed_duration_ms','血性冲刺攻速持续（毫秒）',{scale:1000});
 data(x,'Temp_MSMod','initial_move_speed_ratio','血性冲刺初始移速加成比例',{scale:.01});
 data(x,'Temp_MSDuration','move_speed_duration_ms','血性冲刺移速衰减期限（毫秒）',{scale:1000});
 x.c.proofs.push({semantic:'百分比文案与另一数值源交叉相等',source:'当前mLocKeys.keyTooltip/Temp_AS及AttackSpeed',temp:x.p.DataValues.find(d=>d.name==='Temp_AS').values.slice(1,6),ratio:x.p.DataValues.find(d=>d.name==='AttackSpeed').values.slice(1,6)});
 statEffect(x,'attack_speed_gain','血性冲刺独立攻速加成',val('attack_speed_gain_ratio'),'bonus_attack_speed_percent',{duration:val('attack_speed_duration_ms'),description:'本技能自身额外攻速增加20/25/30/35/40个百分点，持续3秒。与1.5秒移速衰减分开，不用移速结束提前移除攻速。本效果独立保存候选，实际施放与刷新接线另核。'});
 effect(x,'catch_axe_cooldown_reset','接住旋转飞斧后W冷却重置',[result('reset_w','重置血性冲刺冷却','COOLDOWN_CHANGE','SOURCE',null,{affectedSkillScope:{mode:'SKILLS',skillKeys:['draven_w'],skillCategoryKeys:[]},operation:'RESET'})],null,'仅表达已发生接斧时重置本W，不是P任意加层都重置，也没有以命中事件假扮拾取。');
 pending(x,'接斧真实事件','独立W重置效果已构造，但尚无接住旋转飞斧的真实事件或状态转换供给；不能挂任意Q命中/P层变化。');
 pending(x,'移动速度衰减函数','当前主文案明确1.5秒持续衰减；Temp_MSDecay负数没有单位或更新频率，不能猜线性衰减、固定周期或把整个期限写成不衰减移速。','来源');
 exclude(x,'幽灵碰撞','无视单位碰撞体积属于本批暂不实现的纯空间行为。');
}
{
 const x=begin('draven_e');costOnly(x);
 data(x,'BaseDamage','base_damage','开道利斧基础伤害');
 literal(x,'bonus_ad_ratio','开道利斧额外攻击力系数',.5,'当前TotalDamage计算树显式mStat=2/mStatFormula=2/mCoefficient=.5。','mSpellCalculations.TotalDamage');
 data(x,'SlowAmount','slow_ratio','开道利斧减速比例',{scale:.01});
 data(x,'SlowDuration','slow_duration_ms','开道利斧减速期限（毫秒）',{scale:1000});
 data(x,'KnockbackDuration','knockback_duration_ms','开道利斧击退期限原值（毫秒）',{scale:1000});
 formula(x,'hit_damage','开道利斧直接物理伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),explicitBonusAD(x,'TotalDamage',null,.5))),'当前主根75/110/145/180/215+.5额外攻击力。');
 pending(x,'减速与击退控制','减速20/25/30/35/40%、2秒和击退0.5秒保留参数；当前目录只有眩晕，不能用眩晕代替击退、伪造减速字典或用null法术护盾范围占位。','系统');
 noAutomaticDamage(x);
 exclude(x,'横向击退路径','向两侧击退的空间路径后置，控制时长依赖没有排除。');
}
{
 const x=begin('draven_r');costOnly(x);
 data(x,'RBaseDamage','base_damage','冷血追命首个单位基础伤害');
 data(x,'RCoefficient','bonus_ad_ratio','冷血追命额外攻击力系数');
 data(x,'RMinDamagePercent','minimum_damage_ratio','连续命中伤害最低比例',{scale:.01});
 data(x,'RDamageReductionPerHit','damage_reduction_per_hit','每次命中降低伤害比例');
 data(x,'RPassiveStacksCoefficient','adoration_execute_coefficient','崇拜层数处决阈值系数');
 runtime(x,'current_adoration_stacks','本次R伤害时当前崇拜层数','必须来自本德莱文P的当前非负整数层数；R本次伤害前/后但英雄击杀消费前的准确读取时点仍待接线。没有初始层数默认值。','INTEGER');
 formula(x,'first_target_damage','冷血追命本方向首个单位伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),explicitBonusAD(x,'RCalculatedDamage','RCoefficient'))),'每个飞行方向重置后的首个单位基础伤害200/300/400 +1.1/1.3/1.5额外攻击力；不自动合并往返两次命中。');
 const counter=x.p.mSpellCalculations.RPassiveTrueDamage.mFormulaParts[0];
 if(counter.__type!=='BuffCounterByNamedDataValueCalculationPart'||counter.mDataValue!=='RPassiveStacksCoefficient'||counter.mBuffName!=='{577427b5}')throw Error('R崇拜引用不符');
 x.c.proofs.push({source:'mSpellCalculations.RPassiveTrueDamage',raw:counter,semantic:'这是处决生命阈值，不是另一次固定真实伤害'});
 formula(x,'adoration_execute_threshold','冷血追命崇拜处决生命阈值',mul(pn('current_adoration_stacks'),pn('adoration_execute_coefficient')),'R造成伤害后敌方英雄剩余生命严格低于此阈值时才满足处决；阈值为当前P崇拜层数×1，不是再追加等额真实伤害。当前仅独立数学关系，无执行绑定。');
 pending(x,'同目标往返与伤后处决','同一个敌方英雄可能被去程及回程分别命中；反向时伤害重置与再次施放仍保留，不能因多目标支路后置而固定为单次伤害。处决需本次R实际造成伤害后的同一目标生命与P当前层数，不能每次施法直接处决或额外加层数真实伤害。');
 pending(x,'施法时间与冷却起算','当前mCastTime=.5、spellCastTime=1并存；未确认用途，不建1秒或.5秒过程来猜R起算。','来源');
 noAutomaticDamage(x);
 exclude(x,'多个单位穿透排序','其他单位导致的逐个减伤与排序执行后置；最低50%/每命中5%的原值参数留供核对，1V1同目标往返需求保留。');
}
