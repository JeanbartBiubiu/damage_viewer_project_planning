import {begin,plan,parameter,data,literal,formula,pn,attr,add,mul,op,val,fval,damage,pending,exclude,common,processStart,coeff,levelTable,breaks,runtime,statEffect,rule} from './英雄工具.mjs';
{
 const x=begin('sett_p');
 levelTable(x,'right_punch_base','右重拳额外基础伤害',x.p.mSpellCalculations.RightPunchBonus.mFormulaParts[0]);
 coeff(x,'RightPunchBonus',1,'right_punch_bonus_ad_ratio','右重拳额外攻击力倍率',{stat:2,kind:2});
 formula(x,'right_punch_bonus','右重拳额外物理伤害',add(pn('right_punch_base'),mul(pn('right_punch_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'当前右重拳计算树：等级5至90加0.55额外攻击力；不包含普通攻击本体。');
 damage(x,'right_punch_bonus','右重拳独立额外物理伤害','right_punch_bonus','physics',{delivery:'BASIC_ATTACK',block:null});
 breaks(x,'regen_per_missing_unit','每5%已损失生命的每5秒回复',x.p.mSpellCalculations['{7733e08c}'].mFormulaParts[0],.05);
 literal(x,'missing_health_unit','已损失生命比例单位',.05,'当前绑定说明MissingHealthUnit*500为5%；回复计算TooltipRegenPerMissingHealthCalc为当前断点计算×5。','Spell_SettPassive_Tooltip + tooltipregenpermissinghealthcalc');
 x.c.write.parameters=x.c.write.parameters.filter(p=>p.parameterKey!=='regen_per_missing_unit');
 pending(x,'缺血回复的时间单位','当前断点及Tooltip乘数可得到每5%缺血的显示数值0.15/0.5/1/2，但冻结说明未明确这是一秒还是五秒回复量。实库hp_regen按每5秒定义，不能直接把显示数值写成同单位。回复参数、公式、效果及初始化规则暂不进入业务候选，完整断点仍保留proofs。','来源');
 literal(x,'right_punch_reset_ms','未接右重拳时重置左拳（毫秒）',2000,'当前绑定扩展明确2秒内未打出右重拳即重置。','Spell_SettPassive_TooltipExtended');
 literal(x,'right_punch_attack_speed_multiplier','右拳相对左拳攻击速度倍数',8,'当前绑定扩展明确右拳攻速为左拳8倍，不采用未引用AttackSpeed=1.5。','Spell_SettPassive_TooltipExtended');
 pending(x,'左右拳交替、计时和攻击本体组合','右拳伤害已有独立候选；交替状态、2秒返回左拳、右拳8倍攻击节拍及与Q两拳/暴击本体组合仍需接线，不能每次攻击附加右拳。');
 exclude(x,'未引用旧数值','HealingCalc旧线性、GrabDuration等未被当前主说明引用且与当前机制不符，不按存在即录。');
}
{
 const x=begin('sett_q');common(x);data(x,'BaseDamage','base_damage','每拳额外基础伤害');data(x,'EnemyMaxHealthDamage','target_max_hp_base_ratio','每拳目标最大生命基础倍率');data(x,'MaxHealthTADRatio','total_ad_to_target_hp_ratio','每点总攻击力增加的目标生命倍率');
 formula(x,'bonus_damage','每次强化拳额外物理伤害',add(pn('base_damage'),mul(add(pn('target_max_hp_base_ratio'),mul(pn('total_ad_to_target_hp_ratio'),attr('attack_damage'))),attr('hp','TARGET','TOTAL'))),'当前MaxHealthDamageCalc采用总攻击力；每拳基础10至50 + (1% + 每100总攻击力1/1.5/2/2.5/3%)目标最大生命。');
 damage(x,'empowered_punch','每次强化拳独立额外伤害','bonus_damage','physics',{delivery:'BASIC_ATTACK',block:null});
 data(x,'Duration','empowered_window_ms','双拳强化窗口（毫秒）',{scale:1000});data(x,'MSAmount','toward_champion_speed_ratio','朝英雄移动速度比例');data(x,'MSDuration','toward_champion_speed_duration_ms','朝英雄移速持续（毫秒）',{scale:1000});literal(x,'empowered_attacks','强化攻击次数',2,'当前官方和当前绑定说明明确下两次攻击。','official.tooltip + Spell_SettW_Tooltip');processStart(x);
 pending(x,'两次攻击共享4秒窗口及朝目标移动','不能把两个连续的4秒等待过程延长为8秒；需与P左/右拳交替和真实攻击消费、暴击组合接线。30%移速需要朝敌方英雄条件，不保存无条件移速。');
 exclude(x,'野怪伤害封顶与未引用生命成本','400野怪上限不应用于英雄；HealthCost等与当前明确无消耗相矛盾的旧字段不录。');
}
{
 const x=begin('sett_w');common(x);data(x,'BaseDamage','base_damage','轰拳基础伤害');data(x,'DamageConversionBase','grit_damage_base_ratio','豪意基础伤害转化倍率');coeff(x,'DamageConversion',1,'bonus_ad_grit_ratio','额外攻击力增加的豪意转化倍率',{stat:2,kind:2});data(x,'StoredHealth','max_grit_hp_ratio','豪意上限占自身最大生命比例');data(x,'ShieldConversion','grit_shield_ratio','豪意转护盾倍率');data(x,'DamageStored','incoming_damage_storage_ratio','受到伤害储存豪意倍率');
 data(x,'AdrenalineStorageWindow','grit_decay_delay_ms','停止受伤后豪意衰减等待（毫秒）',{scale:1000});data(x,'ShieldMaxDuration','shield_duration_ms','衰减护盾最长持续（毫秒）',{scale:1000});data(x,'ShieldDecayDelay','raw_shield_decay_delay_ms','护盾衰减延迟原值（毫秒）',{scale:1000});
 runtime(x,'released_grit','本次实际迸发豪意','本次主动消耗前的真实非负豪意快照，在捕获时点验证不超过当时最大生命50%；不默认满豪意，也不能消费后重新读清零资源或用后来最大生命重截断。');
 const cap=mul(pn('max_grit_hp_ratio'),attr('hp','SOURCE','TOTAL')),grit=pn('released_grit');
 formula(x,'max_grit','当前豪意上限',cap,'自身总生命50%，只用于储存与捕获时点校验，不再截断已经消耗的豪意快照。');formula(x,'released_grit_shield','本次豪意初始护盾',mul(grit,pn('grit_shield_ratio')),'已消耗真实豪意的100%初始护盾量，不按稍后最大生命重截断；公式不声明衰减曲线。');formula(x,'damage','本次轰拳伤害',add(pn('base_damage'),mul(grit,add(pn('grit_damage_base_ratio'),mul(pn('bonus_ad_grit_ratio'),attr('attack_damage','SOURCE','BONUS'))))),'当前DamageConversion为0.25+0.0025额外攻击力；使用已消费豪意快照，不按稍后最大生命重截断。未采用系数冲突的MaxDamage旧树。');
 damage(x,'central_punch','中央轰拳真实伤害','damage','real');damage(x,'outer_punch','边缘轰拳物理伤害','damage','physics');processStart(x);
 pending(x,'豪意储存、衰减、快照消费与中央分支','确证伤害与上限公式已配置候选。受到伤害的具体基准、豪意每步衰减和释放时点须接线；中心与边缘不能同时触发，也不能拿命中序号代替位置。');
 pending(x,'护盾衰减曲线','当前说明只说3秒持续衰减，根ShieldDecayDelay另有0.75秒；现普通护盾仅NONE或LINEAR_TO_ZERO，不能猜从0秒匀速或恒定3秒。初始护盾公式保留，效果待源证据。','来源');
 exclude(x,'未引用暴怒、移动速度等旧支路','Enrage各字段、MaxDamage旧树、MSDuration不由当前根绑定说明引用，不能据其名字附加机制。');
}
{
 const x=begin('sett_e');common(x,{cast:true});data(x,'BaseDamage','base_damage','裂颅基础伤害');coeff(x,'DamageCalc',1,'total_ad_ratio','裂颅总攻击力倍率',{stat:2});formula(x,'damage','强手裂颅伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage'))),'50至130 + 0.6总攻击力。');damage(x,'facebreaker_hit','强手裂颅实际命中伤害','damage','physics');data(x,'SlowAmount','slow_ratio','单侧命中减速比例');data(x,'SlowDuration','slow_duration_ms','减速持续（毫秒）',{scale:1000});data(x,'StunDuration','both_sides_stun_ms','两侧均擒获时眩晕（毫秒）',{scale:1000});processStart(x,{delay:true});rule(x,'actual_hit','裂颅实际命中',{eventType:'SKILL_HIT',detail:{sourceSkillKey:'sett_e'}},['facebreaker_hit']);
 x.c.write.parameters=x.c.write.parameters.filter(p=>p.parameterKey!=='both_sides_stun_ms');
 pending(x,'拉拽与单侧减速','1V1保留拉拽和70%减速0.5秒；不能用眩晕代替。目录尚无拉拽/减速状态为配置待补，不等同底层不支持。');exclude(x,'双侧眩晕与野怪额外伤害','单英雄目标无第二名敌人满足双侧条件；原始1秒仅保留proofs范围证据，不进入业务候选。野怪额外伤害不应用。');
}
{
 const x=begin('sett_r');common(x);data(x,'BaseDamage','base_damage','摔击基础伤害');coeff(x,'DamageCalc',1,'bonus_ad_ratio','摔击额外攻击力倍率',{stat:2,kind:2});data(x,'MaxHealthDamage','captured_bonus_hp_ratio','被擒英雄额外生命伤害倍率');formula(x,'captured_target_damage','被擒英雄中心摔击伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS')),mul(pn('captured_bonus_hp_ratio'),attr('hp','TARGET','BONUS'))),'1V1中当前受击目标即被擒英雄；200/300/400+1.2额外攻击力+40/50/60%被擒英雄额外生命。不能用总生命或误取旁观受击者生命。');damage(x,'captured_target_landing','被擒英雄摔落中心伤害','captured_target_damage','physics');data(x,'SlowAmount','slow_ratio','摔落减速比例');data(x,'SlowDuration','slow_duration_ms','摔落减速持续（毫秒）',{scale:1000});processStart(x);
 pending(x,'擒抱压制、落地来源及减速','需真实落地命中与被擒目标关联；不把施法开始或结束当作已落地。99%减速1秒、压制和运动期间依赖仍待配。');exclude(x,'附近其他敌人的距离衰减','当前只核被擒英雄中心伤害；旁观目标须按被擒英雄的额外生命计算，留待多目标范围。');
}
for(const key of ['sett_q','sett_w','sett_e','sett_r']){
 const s=plan.skills[key];s.notSavedProcesses=s.write.processes;s.write.processes=[];
 s.pending.push({kind:'配置',component:'当前无行为挂接的施法过程',reason:'真实POST返回PROCESS_BEHAVIOR_REQUIRED，随后GET404：过程需至少一个效果挂接或内部状态操作。当前只有冷却/延迟，故撤出该空行为过程并保留原请求证据；不虚构零消耗，也不把伤害绑到施法来代替实际命中。这不表示所有施法机制不支持，待实际施法行为有明确接线后补。'});
}
export {plan};
