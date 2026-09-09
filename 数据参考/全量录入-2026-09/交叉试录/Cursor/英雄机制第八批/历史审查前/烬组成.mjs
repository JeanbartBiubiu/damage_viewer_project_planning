import {begin,common,data,literal,parameter,formula,pn,attr,add,mul,fval,damage,hit,runtime,pending,exclude} from './英雄工具.mjs';

function proof(x,source,raw,semantic){x.c.proofs.push({source,raw,semantic});}
function levelCurve(x,key,name,part){
 if(part?.__type!=='ByCharLevelBreakpointsCalculationPart')throw Error('Jhin等级曲线节点不符');
 const values=Array.from({length:18},(_,i)=>{let v=part.mLevel1Value;for(const b of part.mBreakpoints??[])if(i+1>=b.mLevel)v+=b.mAdditionalBonusAtThisLevel??0;return Math.round(v*1e6)/1e6;});
 parameter(x,key,name,values,'当前计算式的角色等级断点，取1至18级；19级及以后不计本批已覆盖。','CHARACTER_LEVEL');
 x.c.proofs.push({parameterKey:key,source:'mSpellCalculations角色等级断点',raw:part,values});
}
function growth(x,key,name,part){
 if(part?.__type!=='ByCharLevelBreakpointsCalculationPart'||!Number.isFinite(part.mLevel1Value)||!Number.isFinite(part.mInitialBonusPerLevel))throw Error('JhinP等级增长节点不符');
 let value=part.mLevel1Value,step=part.mInitialBonusPerLevel;const values=[value];
 for(let level=2;level<=18;level++){
  const b=(part.mBreakpoints??[]).find(v=>v.mLevel===level);
  if(b?.mBonusPerLevelAtAndAfter!=null)step=b.mBonusPerLevelAtAndAfter;
  if(b?.mAdditionalBonusAtThisLevel!=null)value+=b.mAdditionalBonusAtThisLevel;
  value+=step;values.push(value);
 }
 const cleanValues=values.map(v=>Math.round(v*1e6)/1e6);
 x.c.write.parameters.push({parameterKey:key,name,valueType:'DECIMAL',valueMode:'CHARACTER_LEVEL',fixedValue:null,levelValues:Object.fromEntries(cleanValues.map((v,i)=>[String(i+1),v])),description:'当前完整计算树按初始每级增量及10、12级切换逐级展开1至18级。',sortOrder:(x.c.write.parameters.length+1)*10});
 x.c.proofs.push({parameterKey:key,source:'mSpellCalculations角色等级增长断点',raw:part,values:cleanValues});
}

{
 const x=begin('jhin_p');
 const calc=x.p.mSpellCalculations;
 data(x,'MaxAmmo','max_ammo','低语弹药数');
 data(x,'ReloadTime','reload_time_ms','低语完整装填时间（毫秒）',{scale:1000});
 data(x,'HasteDuration','crit_move_speed_duration_ms','暴击后移动速度持续（毫秒）',{scale:1000});
 data(x,'OutOfCombatTimeBeforeReload','out_of_combat_reload_delay_ms','脱战后自动装填等待（毫秒）',{scale:1000});
 data(x,'FourthShotDamageMult','fourth_shot_damage_multiplier','第四发攻击倍率');
 data(x,'CritReductionPercent','crit_damage_reduction_ratio','烬暴击伤害降低比例');
 data(x,'BaseAttackSpeed','base_attack_speed','低语基础攻击速度');
 data(x,'PercentAttackSpeedPerLevel','attack_speed_per_level_ratio','每级额外攻击速度比例');
 data(x,'CritMoveSpeedPercentASRatio','crit_move_speed_attack_speed_ratio','暴击移动速度对额外攻速系数');
 const execute=calc.FourthShotExecutePercent.mFormulaParts?.[0];
 const total=calc.TotalADPercent;
 const totalParts=total.mFormulaParts??[];
 const speed=calc.CritMoveSpeedPercent;
 if(execute?.__type!=='ByCharLevelBreakpointsCalculationPart'||totalParts.length!==3||speed?.mFormulaParts?.[1]?.mStat!==4)throw Error('JhinP计算树节点不符');
 levelCurve(x,'fourth_shot_execute_percent','第四发对目标已损失生命额外比例',execute);
 growth(x,'level_attack_damage_percent','烬等级攻击力比例',totalParts[0]);
 literal(x,'critical_attack_damage_ratio','暴击几率转攻击力比例',.35,'TotalADPercent第二项mStat=8、系数.35。','mSpellCalculations.TotalADPercent');
 literal(x,'attack_speed_damage_ratio','额外攻速转攻击力比例',.3,'TotalADPercent第三项mStat=4/mStatFormula=2、系数.3；只表达输入关系，不从最终攻击力反推额外攻速。','mSpellCalculations.TotalADPercent');
 literal(x,'base_crit_move_speed_percent','暴击后基础移动速度比例',.14,'CritMoveSpeedPercent首项固定.14；不把它当最终移动速度。','mSpellCalculations.CritMoveSpeedPercent');
 proof(x,'mSpellCalculations.TotalADPercent',total,'等级比例+.35暴击几率+.3额外攻击速度；最终攻击力换算和反馈读取时点未绑定。');
 proof(x,'mSpellCalculations.CritMoveSpeedPercent',speed,'暴击移动速度比例为.14+.44额外攻击速度；只保留公式，不创建反馈属性效果。');
 formula(x,'fourth_shot_bonus_damage','第四发已损生命额外物理伤害',mul(pn('fourth_shot_execute_percent'),attr('hp','TARGET','MISSING')),'等级1至5为15%、6至10为20%、11至18为25%；不是低于阈值处决。');
 formula(x,'total_attack_damage_percent','烬总攻击力转换比例',add(pn('level_attack_damage_percent'),mul(pn('critical_attack_damage_ratio'),attr('critical_strike_chance')),mul(pn('attack_speed_damage_ratio'),attr('bonus_attack_speed_percent'))),'等级比例+.35×暴击几率+.3×额外攻速；不在当前技能自身反复读取最终攻击力。');
 formula(x,'crit_move_speed_percent','暴击后移动速度比例',add(pn('base_crit_move_speed_percent'),mul(pn('crit_move_speed_attack_speed_ratio'),attr('bonus_attack_speed_percent'))),'.14+.44×额外攻速；实际触发和移动速度结果另接线。');
 pending(x,'弹药、第四发与装填状态','四发计数、第四发必暴击、重装2.5秒及脱战8秒装填需要普通攻击状态和真实消费事件；已损生命额外部分不替换普通攻击本体。');
 pending(x,'攻击力与暴击移动速度转换','当前完整关系已保存；基础攻速、额外攻速和暴击几率到最终攻击力的取值时点及循环反馈未核，不能创建无条件自益或从最终值反推输入。');
 pending(x,'第四发伤害资格','第四发必暴击及已损生命额外物理伤害的法术护盾、暴击和吸血资格需实际攻击结果上下文；本轮只保留额外数学关系。');
 exclude(x,'野怪已损生命封顶','扩展说明的野怪800封顶不在一名敌方英雄范围内；英雄目标已损生命比例保留。');
}

{
 const x=begin('jhin_q');common(x);
 data(x,'BaseDamage','base_damage','曼舞手雷基础物理伤害');
 data(x,'ADRatio','total_ad_ratio','曼舞手雷总攻击力系数');
 data(x,'PercentAmpOnKill','kill_bounce_amp_ratio','曼舞手雷击杀后续弹跳增伤比例');
 data(x,'NumberOfBounces','bounce_count','曼舞手雷后续弹跳次数');
 data(x,'BounceRange','bounce_range','曼舞手雷弹跳查找距离');
 const parts=x.p.mSpellCalculations.TotalDamage.mFormulaParts??[];
 if(parts[1]?.mStat!==2||parts[1]?.mDataValue!=='ADRatio'||parts[2]?.mCoefficient!==.6000000238418579)throw Error('JhinQ计算树节点不符');
 literal(x,'unresolved_scaling_coefficient','曼舞手雷未解码属性系数',.6,'TotalDamage第三项只有.6系数，mStat/mStatFormula省略，不默认法强。','mSpellCalculations.TotalDamage');
 runtime(x,'unresolved_scaling_attribute','曼舞手雷未解码属性输入','当前TotalDamage第三项属性枚举缺失；待同版本默认映射核对后绑定，不能猜法强或填0。');
 proof(x,'mSpellCalculations.TotalDamage',parts,'首目标为44/69/94/119/144 + .44/.515/.59/.665/.74总攻击力 + .6×未解码属性输入。');
 formula(x,'first_target_damage','曼舞手雷首目标物理伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL')),mul(pn('unresolved_scaling_coefficient'),pn('unresolved_scaling_attribute'))),'首目标完整公式；第三项只保留明确.6和运行时输入。');
 damage(x,'first_target_damage','曼舞手雷首目标命中伤害','first_target_damage','physics');
 hit(x,'first_target_damage');
 pending(x,'未解码属性与实际命中','首目标公式需要未解码属性输入；实际命中、法术护盾和吸血资格按真实技能结果接线，不能把未知输入当法强。');
 pending(x,'施放成本与冷却起算','基础成本和冷却已复用；弹跳命中并不等于施放结束，过程起算点本轮不猜。');
 exclude(x,'后续弹跳和击杀增伤','最多4目标、后续弹跳及每次击杀后35%增伤属于多目标事件；保留参数和跨事件依赖，不在1V1首目标效果中自动执行。');
}

{
 const x=begin('jhin_w');common(x);
 data(x,'BaseDamage','base_damage','致命华彩基础物理伤害');
 data(x,'RootDuration','root_duration_ms','致命华彩禁锢持续（毫秒）',{scale:1000});
 data(x,'MinionMod','minion_damage_ratio','致命华彩小兵伤害比例');
 data(x,'SpottingDuration','spotting_duration_ms','致命华彩标记窗口（毫秒）',{scale:1000});
 const part=x.p.mSpellCalculations.TotalDamage.mFormulaParts?.[1];
 if(part?.mStat!==2||Math.abs(part.mCoefficient-.5)>1e-6)throw Error('JhinW总攻击力来源不符');
 literal(x,'total_ad_ratio','致命华彩总攻击力系数',.5,'TotalDamage明确.5总攻击力系数；mStatFormula省略但当前官方说明为总攻击力。','mSpellCalculations.TotalDamage');
 proof(x,'mSpellCalculations.TotalDamage.mFormulaParts.1',part,'保留自身命中基础伤害，不因官方文字强调友方协助而删除自身伤害。');
 formula(x,'damage','致命华彩首个英雄物理伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),'70/105/140/175/210 +.5总攻击力；只保留首个英雄目标。');
 damage(x,'damage','致命华彩首个英雄命中伤害','damage','physics');
 hit(x,'damage');
 pending(x,'自身或友方伤害标记','当前summary含烬自身伤害，命中前4秒标记仍需真实伤害来源和同目标条件；不能因tooltip文字偏友方而删除自身标记依赖。');
 pending(x,'禁锢控制与低语增速','禁锢1.25/1.5/1.75/2/2.25秒、标记4秒及低语移动速度联动需要控制和被动状态能力；当前只有眩晕目录，不伪造禁锢或假根状态。');
 pending(x,'施放时序与冷却起算','当前castTime=.75、spellCastTime=.25并存；不猜射击到达和冷却起点，成本与冷却仅保留公共参数。');
 exclude(x,'队友协助及沿途非英雄单位','队友伤害触发禁锢和小兵/野怪穿透、多目标沿途筛选后置；自身首个英雄命中伤害保留。');
}

{
 const x=begin('jhin_e');
 exclude(x,'独立陷阱实体与触发','万众倾倒的隐形莲花陷阱、减速区域、2秒后爆炸和充能按既定范围后置；不制造无消耗或空伤害占位。');
 exclude(x,'击杀英雄尸体生成陷阱','被烬击杀后的尸体附近自动生成并引爆属于跨击杀和空间事件，本轮不接任意英雄击杀。');
 pending(x,'W的E陷阱标记依赖','W禁锢条件仍保留对本技能陷阱真实命中标记的依赖；跳过E实体不等于删除W的条件说明。');
}

{
 const x=begin('jhin_r');common(x);
 data(x,'Damage','base_damage','完美谢幕基础子弹物理伤害');
 data(x,'FourthShotMultiplier','fourth_shot_multiplier','完美谢幕第四发伤害倍率');
 data(x,'SlowPercent','slow_ratio','完美谢幕减速比例');
 data(x,'SlowDuration','slow_duration_ms','完美谢幕减速持续（毫秒）',{scale:1000});
 data(x,'PercentMissingAmp','missing_health_max_amp','完美谢幕已损生命最大增幅');
 data(x,'MInimumDelayBetweenShots','minimum_shot_interval_ms','完美谢幕两发最小间隔（毫秒）',{scale:1000});
 data(x,'ADRatio','total_ad_ratio','完美谢幕总攻击力系数');
 const calc=x.p.mSpellCalculations;
 const part=calc.DamageCalc.mFormulaParts?.[1];
 if(part?.mStat!==2||part?.mDataValue!=='ADRatio')throw Error('JhinR总攻击力来源不符');
 literal(x,'one','倍率基准值',1,'MaxIncreaseCalc为DamageCalc×(1+3)=基础伤害×4；只用于明确最大端点。','mSpellCalculations.MaxIncreaseCalc');
 literal(x,'shot_count','完美谢幕子弹数',4,'官方说明与当前技能根均明确4颗超级子弹；每发实际命中由同一引导过程供给。','official.tooltip + current root');
 proof(x,'mSpellCalculations.DamageCalc/MaxIncreaseCalc',calc,'基础64/128/192+.25总攻击力；最大端点为基础×4，目标已损生命到倍率的连续函数未显式。');
 formula(x,'base_damage','完美谢幕基础子弹伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),'64/128/192 +.25总攻击力；这是每颗子弹的未增幅端点。');
 formula(x,'maximum_damage','完美谢幕最大端点伤害',mul(fval('base_damage'),add(pn('one'),pn('missing_health_max_amp'))),'MaxIncreaseCalc明确为基础×4，仅表示目标已损生命增幅的最大端点。');
 pending(x,'已损生命连续增幅','当前只证基础端点与×4最大端点；目标已损生命到倍率的函数未显式，不能猜线性插值或把每发固定为最大伤害。');
 pending(x,'四发引导与第四发暴击','四发逐发实际命中、最小1秒间隔、第四发倍率2、减速80%持续.5秒及伤害资格需同一引导过程；不将第四发再套通常暴击伤害。');
 pending(x,'成本、引导与冷却起算','R基础成本与冷却已复用；固定位置、引导退出、子弹到达和冷却起点未核，不创建猜测过程。');
 exclude(x,'多目标穿透和空间弹道','本轮保留单一敌方英雄命中所需端点和控制参数；小兵/野怪穿透、其他目标拦截和空间路径后置。');
}
