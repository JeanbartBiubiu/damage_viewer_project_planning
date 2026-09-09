import {begin,common,data,literal,formula,pn,attr,add,mul,fval,runtime,pending,exclude} from './英雄工具.mjs';

function proof(x,source,raw,semantic){x.c.proofs.push({source,raw,semantic});}
function levelCurve(x,key,name,part){
 if(part?.__type!=='ByCharLevelBreakpointsCalculationPart')throw Error('Jhin等级曲线节点不符');
 runtime(x,key,name+'（等级曲线待核输入）','原树明确1级.15及6/11级附加值各.05，但省略初始和断点后每级增量；当前中文没有精确分段。不生成18级数组，须外部提供已核比例。');
 x.c.proofs.push({parameterKey:key,source:'mSpellCalculations角色等级断点',raw:part,unresolved:'未将省略的每级增量解码为0。'});
 pending(x,'第四发已损生命等级曲线','原树1级值及6/11级附加值明确，省略的每级增量仍未核，当前中文无精确分段。只保留未绑定比例输入。','来源');
}
function growth(x,key,name,part){
 if(part?.__type!=='ByCharLevelBreakpointsCalculationPart'||!Number.isFinite(part.mLevel1Value)||!Number.isFinite(part.mInitialBonusPerLevel))throw Error('JhinP等级增长节点不符');
 runtime(x,key,name+'（等级曲线待核输入）','原树明确1级.04、初始每级.01以及10/12级新斜率.02/.04；断点附加值省略且没有完整分段中文证明，不把缺项补0，不生成完整18级数组。');
 x.c.proofs.push({parameterKey:key,source:'mSpellCalculations角色等级增长断点',raw:part,unresolved:'断点附加值缺省语义未证；外部提供已核等级比例后才可独立算式。'});
 pending(x,'攻击力等级曲线缺省字段','1级.04与初始每级.01、10/12级新斜率明确，断点附加值未显式，当前中文无精确分段。撤旧18级默认展开，保留未绑定输入及原树证据。','来源');
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
 formula(x,'fourth_shot_bonus_damage','第四发已损生命额外物理伤害',mul(pn('fourth_shot_execute_percent'),attr('hp','TARGET','MISSING')),'外部已核等级比例×目标已损生命；没有默认等级曲线，不是低于阈值处决。');
 formula(x,'total_attack_damage_percent','烬总攻击力转换比例',add(pn('level_attack_damage_percent'),mul(pn('critical_attack_damage_ratio'),attr('critical_strike_chance')),mul(pn('attack_speed_damage_ratio'),attr('bonus_attack_speed_percent'))),'等级比例+.35×暴击几率+.3×额外攻速；不在当前技能自身反复读取最终攻击力。');
 formula(x,'crit_move_speed_percent','暴击后移动速度比例',add(pn('base_crit_move_speed_percent'),mul(pn('crit_move_speed_attack_speed_ratio'),attr('bonus_attack_speed_percent'))),'.14+.44×额外攻速；实际触发和移动速度结果另接线。');
 pending(x,'弹药、第四发与装填状态','四发计数、第四发必暴击、重装2.5秒及脱战8秒装填需要普通攻击状态和真实消费事件；已损生命额外部分不替换普通攻击本体。');
 pending(x,'攻击力与暴击移动速度转换','当前完整关系已保存；基础攻速、额外攻速和暴击几率到最终攻击力的取值时点及循环反馈未核，不能创建无条件自益或从最终值反推输入。','来源');
 pending(x,'第四发伤害资格','第四发必暴击及已损生命额外物理伤害的法术护盾、暴击和吸血资格需实际攻击结果上下文；本轮只保留额外数学关系。','来源');
 exclude(x,'野怪已损生命封顶','扩展说明的野怪800封顶不在一名敌方英雄范围内；英雄目标已损生命比例保留。');
}

{
 const x=begin('jhin_q');common(x);
 data(x,'BaseDamage','base_damage','曼舞手雷基础物理伤害');
 data(x,'ADRatio','total_ad_ratio','曼舞手雷总攻击力系数');
 const parts=x.p.mSpellCalculations.TotalDamage.mFormulaParts??[];
 if(parts[1]?.mStat!==2||parts[1]?.mDataValue!=='ADRatio'||parts[2]?.mCoefficient!==.6000000238418579)throw Error('JhinQ计算树节点不符');
 literal(x,'unresolved_scaling_coefficient','曼舞手雷未解码属性系数',.6,'TotalDamage第三项只有.6系数，mStat/mStatFormula省略，不默认法强。','mSpellCalculations.TotalDamage');
 runtime(x,'unresolved_scaling_attribute','曼舞手雷未解码属性输入','当前TotalDamage第三项属性枚举缺失；待同版本默认映射核对后绑定，不能猜法强或填0。');
 proof(x,'mSpellCalculations.TotalDamage',parts,'首目标为44/69/94/119/144 + .44/.515/.59/.665/.74总攻击力 + .6×未解码属性输入。');
 formula(x,'first_target_damage','曼舞手雷首目标物理伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL')),mul(pn('unresolved_scaling_coefficient'),pn('unresolved_scaling_attribute'))),'首目标完整公式；第三项只保留明确.6和运行时输入。');
 pending(x,'未解码属性与实际命中','首目标公式需要未解码属性输入；实际命中、法术护盾和吸血资格按真实技能结果接线，不能把未知输入当法强。','来源');
 pending(x,'施放成本与冷却起算','基础成本和冷却已复用；弹跳命中并不等于施放结束，过程起算点本轮不猜。','来源');
 exclude(x,'后续弹跳和击杀增伤','当前原文要求弹到未被此技能命中的附近另一目标，击杀只提高后续弹跳伤害；唯一英雄不能被同颗手雷反复弹跳。BounceRange、NumberOfBounces、PercentAmpOnKill无当前首目标公式或其他保留技能引用，撤正常候选，原值存历史与冻结来源。前置其他单位弹跳属于扩大场景后才恢复的条件，不给单目标默认加成。');
}

{
 const x=begin('jhin_w');common(x);
 data(x,'BaseDamage','base_damage','致命华彩基础物理伤害');
 data(x,'RootDuration','root_duration_ms','致命华彩禁锢持续（毫秒）',{scale:1000});
 data(x,'SpottingDuration','spotting_duration_ms','致命华彩标记窗口（毫秒）',{scale:1000});
 const part=x.p.mSpellCalculations.TotalDamage.mFormulaParts?.[1];
 if(part?.mStat!==2||Math.abs(part.mCoefficient-.5)>1e-6)throw Error('JhinW攻击力来源不符');
 literal(x,'attack_damage_ratio','致命华彩攻击力系数（口径待核）',.5,'TotalDamage明确mStat=2及系数.5；mStatFormula省略，官方正文只有计算占位，没有总攻击力说明。','mSpellCalculations.TotalDamage');
 runtime(x,'current_attack_damage_value','致命华彩本次攻击力输入（口径待核）','mStat=2但mStatFormula省略，无同版本TotalADRatio名称或明确总/额外AD正文，不默认总AD或0。');
 proof(x,'mSpellCalculations.TotalDamage.mFormulaParts.1',part,'只确认攻击力类型和.5系数，未确认总/额外口径；保留自身基础伤害，不因官方文字强调友方协助而删除自身伤害。');
 pending(x,'致命华彩攻击力取值口径','官方/当前中文只有TotalDamage占位，不能据此声称写明总AD；省略mStatFormula也没有具名TotalADRatio证明，改无默认输入。','来源');
 formula(x,'damage','致命华彩首个英雄物理伤害',add(pn('base_damage'),mul(pn('attack_damage_ratio'),pn('current_attack_damage_value'))),'70/105/140/175/210 +.5×外部已核攻击力输入；取值口径未绑定，只保留首个英雄目标。');
 pending(x,'首英雄伤害资格','当前冻结资料未证法术护盾、暴击及吸血资格；未建立默认伤害效果或实际命中触发，只保留伤害公式。','来源');
 pending(x,'自身或友方伤害标记','当前summary含烬自身伤害，命中前4秒标记仍需真实伤害来源和同目标条件；不能因tooltip文字偏友方而删除自身标记依赖。');
 pending(x,'禁锢控制与低语增速','禁锢1.25/1.5/1.75/2/2.25秒、标记4秒及低语移动速度联动需要控制和被动状态能力；当前只有眩晕目录，不伪造禁锢或假根状态。','系统');
 pending(x,'施放时序与冷却起算','当前castTime=.75、spellCastTime=.25并存；不猜射击到达和冷却起点，成本与冷却仅保留公共参数。','来源');
 exclude(x,'队友协助及沿途非英雄单位','原文MinionMod只修正小兵，未被首英雄伤害或P/E标记关系引用；撤minion_damage_ratio，保留原文。队友伤害触发和沿途多单位后置；自身伤害、E陷阱标记及触发低语加速仍保留。');
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
 data(x,'ADRatio','attack_damage_ratio','完美谢幕攻击力系数（口径待核）');
 const calc=x.p.mSpellCalculations;
 const part=calc.DamageCalc.mFormulaParts?.[1];
 if(part?.mStat!==2||part?.mDataValue!=='ADRatio')throw Error('JhinR攻击力来源不符');
 runtime(x,'current_attack_damage_value','完美谢幕本次攻击力输入（口径待核）','DamageCalc节点mStat=2但mStatFormula省略，ADRatio没有同版本TotalADRatio名称或精确正文佐证，不默认总AD/额外AD或0。');
 pending(x,'完美谢幕攻击力取值口径','当前根缺mStatFormula且无具名TotalADRatio或明确中文说明；基础端点用无默认攻击力输入，未接到TOTAL属性。','来源');
 literal(x,'one','倍率基准值',1,'MaxIncreaseCalc为DamageCalc×(1+3)=基础伤害×4；只用于明确最大端点。','mSpellCalculations.MaxIncreaseCalc');
 literal(x,'shot_count','完美谢幕子弹数',4,'官方说明与当前技能根均明确4颗超级子弹；每发实际命中由同一引导过程供给。','official.tooltip + current root');
 proof(x,'mSpellCalculations.DamageCalc/MaxIncreaseCalc',calc,'基础64/128/192+.25×未确认总/额外口径的攻击力；最大端点为基础×4，目标已损生命到倍率的连续函数未显式。');
 formula(x,'base_damage','完美谢幕基础子弹伤害',add(pn('base_damage'),mul(pn('attack_damage_ratio'),pn('current_attack_damage_value'))),'64/128/192 +.25×外部已核攻击力输入；输入口径未绑定，这是每颗子弹的未增幅端点。');
 formula(x,'maximum_damage','完美谢幕最大端点伤害',mul(fval('base_damage'),add(pn('one'),pn('missing_health_max_amp'))),'MaxIncreaseCalc明确为基础×4，仅表示目标已损生命增幅的最大端点。');
 pending(x,'已损生命连续增幅','当前只证基础端点与×4最大端点；目标已损生命到倍率的函数未显式，不能猜线性插值或把每发固定为最大伤害。','来源');
 pending(x,'四发引导与第四发暴击','四发逐发实际命中、最小1秒间隔、第四发倍率2、减速80%持续.5秒及伤害资格需同一引导过程；不将第四发再套通常暴击伤害。','未接线');
 pending(x,'四发伤害资格','基础端点和第四发倍率不证明其独立暴击、法术护盾或吸血资格；当前未建伤害结果。','来源');
 pending(x,'完美谢幕减速字典','当前目录只有眩晕，80%减速.5秒没有可用减速字典；保留参数而不伪造控制效果。','系统');
 pending(x,'成本、引导与冷却起算','R基础成本与冷却已复用；固定位置、引导退出、子弹到达和冷却起点未核，不创建猜测过程。','来源');
 exclude(x,'多目标穿透和空间弹道','本轮保留单一敌方英雄命中所需端点和控制参数；小兵/野怪穿透、其他目标拦截和空间路径后置。');
}
