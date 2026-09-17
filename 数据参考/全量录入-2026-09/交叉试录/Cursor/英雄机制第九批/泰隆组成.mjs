import {begin,common,data,literal,runtime,formula,requireCalc,interpolation,pn,attr,add,mul,val,fval,effect,result,damagePending,healPending,statEffect,pending,exclude,excludeData} from './候选.mjs';

// P：保留创伤叠层和三层后的持续伤害总量；实际普攻触发由真实攻击事件提供。
{
  const x=begin('talon_p');
  excludeData(x,'MonsterMod','仅大型野怪流血伤害折算；本批不新增非英雄参数。');
  data(x,'StackDuration','stack_duration_ms','创伤层持续时间（毫秒）',{scale:1000});
  data(x,'BleedDuration','bleed_duration_ms','流血持续时间（毫秒）',{scale:1000});
  data(x,'BonusADRatio','bonus_ad_ratio','流血额外攻击力倍率');
  const bleed=requireCalc(x,'BleedDamage').mFormulaParts;
  if(bleed?.[0]?.__type!=='ByCharLevelInterpolationCalculationPart'||bleed?.[1]?.mStat!==2||bleed?.[1]?.mStatFormula!==2||bleed?.[1]?.mDataValue!=='BonusADRatio')throw Error('泰隆P流血树字段不符');
  interpolation(x,'bleed_base_damage_by_level','流血角色等级基础伤害',bleed[0]);
  x.c.proofs.push({source:'mSpellCalculations.BleedDamage.mFormulaParts[1]',raw:bleed[1],semantic:'mStat=2/mStatFormula=2按既有已核对映射为额外攻击力'});
  formula(x,'bleed_damage','刀锋之末持续物理伤害总量',add(pn('bleed_base_damage_by_level'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'流血总量为外供的实际等级基础伤害+2.1×额外攻击力；源端点80/280留证但不猜整曲线；只表示2秒总量，不拆未给出的周期。');
  damagePending(x,'bleed_damage','刀锋之末持续物理伤害','bleed_damage','physics',{delivery:'BASIC_ATTACK',block:null,description:'三层创伤后的独立持续物理伤害总量；实际普攻触发与持续周期未接线。'});
  pending(x,'创伤层叠加与流血触发','技能对英雄可叠至3层、每层6秒；带3层目标被泰隆攻击才开始2秒流血。叠层归属、刷新/消费和攻击命中事件未接线，不把技能施放当作流血触发。');
  pending(x,'流血周期与法术护盾资格','根只给2秒总持续和总伤害公式，没有周期节拍；持续伤害的每次结算、护盾消费与吸血边界待系统核对。','系统');
  exclude(x,'大型野怪流血折算','MonsterMod只用于大型野怪；本批的一名敌方英雄使用完整流血公式。');
}

// Q：保留远程跃击、近战暴击、击杀治疗和冷却返还；距离和击杀因果不自动选择。
{
  const x=begin('talon_q');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','诺克萨斯式外交基础伤害');
  data(x,'BonusADRatio','bonus_ad_ratio','诺克萨斯式外交额外攻击力倍率');
  data(x,'EnhancedDamageMod','enhanced_damage_multiplier','近战暴击基础倍率');
  data(x,'CooldownRefund','cooldown_refund_ratio','击杀后冷却返还比例');
  const leap=requireCalc(x,'LeapDamage').mFormulaParts;
  if(leap?.[0]?.mDataValue!=='BaseDamage'||leap?.[1]?.mStat!==2||leap?.[1]?.mStatFormula!==2||leap?.[1]?.mDataValue!=='BonusADRatio')throw Error('泰隆Q跃击树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.LeapDamage.mFormulaParts[1]',raw:leap[1],semantic:'mStat=2/mStatFormula=2按既有已核对映射为额外攻击力'});
  const critical=requireCalc(x,'CriticalDamage');
  if(critical?.mModifiedGameCalculation!=='LeapDamage'||critical?.mMultiplier?.mSubparts?.[0]?.mDataValue!=='EnhancedDamageMod'||critical?.mMultiplier?.mSubparts?.[1]?.mStat!==9||critical?.mMultiplier?.mSubparts?.[1]?.mStatFormula!==2)throw Error('泰隆Q近战暴击树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.CriticalDamage',raw:critical,semantic:'近战倍率为EnhancedDamageMod+mStat9×1；mStat9具体属性不在本候选猜测'});
  runtime(x,'current_critical_stat_value','诺克萨斯式外交近战暴击属性值','CriticalDamage使用mStat=9/mStatFormula=2；根未提供其属性名称或枚举，不能猜作暴击率或暴击伤害。');
  interpolation(x,'kill_heal_by_level','击杀后角色等级治疗量',requireCalc(x,'TotalHealing').mFormulaParts?.[0]);
  formula(x,'leap_damage','诺克萨斯式外交跃击物理伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'LeapDamage=65/85/105/125/145+1.0×额外攻击力；数值按DataValues索引1至5展开，只表示远程目标分支。');
  formula(x,'critical_damage','诺克萨斯式外交近战暴击物理伤害',mul(add(pn('enhanced_damage_multiplier'),pn('current_critical_stat_value')),add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS')))),'CriticalDamage=(EnhancedDamageMod+mStat9)×LeapDamage；表达式内联跃击计算树，mStat9取运行时输入，不改写为默认暴击值。');
  damagePending(x,'leap_hit','诺克萨斯式外交跃击实际物理伤害','leap_damage','physics',{description:'远程距离分支独立物理伤害；近战暴击分支不与其自动叠加。'});
  damagePending(x,'critical_hit','诺克萨斯式外交近战暴击实际物理伤害','critical_damage','physics',{description:'近战距离分支独立物理伤害；真实距离和暴击属性由外部事件提供。'});
  pending(x,'击杀治疗资格与等级值','当前原文明确Q击杀目标后回复生命；kill_heal_by_level为无默认实际等级治疗量输入，不是已生成公式。真实击杀归因和治疗时点未接线，不创建瞬时治疗结果。','来源');
  pending(x,'远程/近战分支与P联动','近战范围内转为暴击，远程则跃向目标；两种伤害不能同时执行。Q命中是否给刀锋之末叠层和攻击事件归属待跨技能接线。');
  pending(x,'击杀治疗与冷却返还因果','官方明确只有本次Q击杀目标才回复生命和返还50%冷却；不连接任意击杀或施放事件。');
  pending(x,'击杀冷却返还单位','COOLDOWN_CHANGE只接收毫秒，不能直接消费0.5比例；返还基数及实际毫秒未核，当前只保留50%事实参数。','系统');
  pending(x,'近战暴击属性枚举','mStat9/mStatFormula2未给属性名称；使用运行时输入并保留完整乘法树，缺失不填0。','来源');
}

// W：保存来回两段单目标伤害；返回路径和减速是空间/控制接线。
{
  const x=begin('talon_w');
  common(x,{cast:true});
  data(x,'InitialBaseDamage','initial_base_damage','斩草除根初始基础物理伤害');
  data(x,'ReturnBaseDamage','return_base_damage','斩草除根返回基础物理伤害');
  data(x,'MovespeedSlow','slow_ratio','返回刀刃减速比例');
  data(x,'SlowDuration','slow_duration_ms','返回刀刃减速持续（毫秒）',{scale:1000});
  data(x,'ReturnDelay','return_delay_ms','刀刃返回延迟（毫秒）',{scale:1000});
  excludeData(x,'MonsterDamageMod','仅野怪伤害折算；本批不新增非英雄参数。');
  data(x,'InitialBonusADRatio','initial_bonus_ad_ratio','初始刀刃额外攻击力倍率');
  data(x,'ReturnBonusADRatio','return_bonus_ad_ratio','返回刀刃额外攻击力倍率');
  const initial=requireCalc(x,'TotalInitialDamage').mFormulaParts;
  const back=requireCalc(x,'TotalReturnDamage').mFormulaParts;
  if(initial?.[0]?.mDataValue!=='InitialBaseDamage'||initial?.[1]?.mStat!==2||initial?.[1]?.mStatFormula!==2||initial?.[1]?.mDataValue!=='InitialBonusADRatio')throw Error('泰隆W初始树字段不符');
  if(back?.[0]?.mDataValue!=='ReturnBaseDamage'||back?.[1]?.mStat!==2||back?.[1]?.mStatFormula!==2||back?.[1]?.mDataValue!=='ReturnBonusADRatio')throw Error('泰隆W返回树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.TotalInitialDamage/TotalReturnDamage.mFormulaParts[1]',raw:{initial:initial[1],return:back[1]},semantic:'两段均为mStat2/mStatFormula2额外攻击力'});
  formula(x,'initial_damage','斩草除根初始刀刃物理伤害',add(pn('initial_base_damage'),mul(pn('initial_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'InitialBaseDamage+0.4×额外攻击力；只表示初始穿过当前目标的一次命中。');
  formula(x,'return_damage','斩草除根返回刀刃物理伤害',add(pn('return_base_damage'),mul(pn('return_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'ReturnBaseDamage+0.9×额外攻击力；只表示返回刀刃的一次命中。');
  damagePending(x,'initial_hit','斩草除根初始实际物理伤害','initial_damage','physics',{description:'初始刀刃独立物理伤害；不替代返回刀刃命中。'});
  damagePending(x,'return_hit','斩草除根返回实际物理伤害','return_damage','physics',{description:'返回刀刃独立物理伤害；只在返回刀刃真实穿过当前目标时执行。'});
  pending(x,'返回路径、命中次数与减速','官方只给初始与返回两段单目标伤害及返回减速；返回延迟、空间路径、每段命中和减速结果/护盾资格待接线，不让施放过程自动打中。','系统');
  pending(x,'W与刀锋之末联动','W技能命中英雄应参与P创伤层；每段命中是否分别计层及先后关系待跨技能核对，当前不自动触发P。');
  exclude(x,'野怪伤害折算与多目标路径','MonsterDamageMod只保留来源参数；多目标刀刃路径和野怪专用值本批后置，当前目标两段伤害公式保留。');
}

// E：根技能零冷却只属于包装技能；纯地形翻越没有本批范围内的因果战斗行为。
{
  const x=begin('talon_e');
  excludeData(x,'WallCD','同一地形再次翻越锁定仅属于纯地形空间执行；本批不新增E正常组成。');
  excludeData(x,'WallJumpDistance','翻越最大距离仅属于纯地形空间执行；本批不新增E正常组成。');
  excludeData(x,'WallLockoutWidth','同一地形锁定宽度仅属于纯地形空间执行；本批不新增E正常组成。');
  excludeData(x,'DisplayCD','翻墙显示冷却仅属于纯地形表现；本批不新增E正常组成。');
  x.c.proofs.push({source:'mLocKeys.keyCooldown + root.Cooldown',raw:{key:'Spell_Cooldown_TAlonE',text:'@f1@秒冷却',rootCooldown:x.p.Cooldown},excluded:true,semantic:'根Cooldown为包装技能0冷却；真实同一地形再次翻越限制只留根来源证据，本批不新增E正常组成。'});
  pending(x,'地形身份与再次翻越锁定','E只能翻越最近合资格地形/建筑，且同一地区WallCD内不能重复翻越；需要地形身份、边界和实际移动事件，当前不生成空间位移。','系统');
  exclude(x,'纯空间翻越路径','距离、最近地形搜索、建筑碰撞、路径动画和显示冷却属于纯空间执行；本批不新增E正常组成，根绑定值只留来源证据。');
}

// R：保存初始/返回刀刃伤害与移动速度；隐身、刀刃路径和攻击取消由真实事件接线。
{
  const x=begin('talon_r');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','暗影突袭每段基础物理伤害');
  data(x,'MoveSpeed','move_speed_ratio','暗影突袭额外移动速度比例');
  data(x,'Duration','duration_ms','暗影突袭隐身持续时间（毫秒）',{scale:1000});
  const damageCalc=requireCalc(x,'Damage').mFormulaParts;
  if(damageCalc?.[0]?.mDataValue!=='BaseDamage'||damageCalc?.[1]?.mStat!==2||damageCalc?.[1]?.mStatFormula!==2||damageCalc?.[1]?.mCoefficient!==1)throw Error('泰隆R伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.Damage.mFormulaParts[1]',raw:damageCalc[1],semantic:'mStat2/mStatFormula2为额外攻击力，倍率1'});
  formula(x,'blade_damage','暗影突袭每段物理伤害',add(pn('base_damage'),attr('attack_damage','SOURCE','BONUS')),'Damage=90/135/180+1.0×额外攻击力；数值按DataValues索引1至3展开，初始散出与返回汇聚各是独立实际命中事件。');
  damagePending(x,'outward_blade_hit','暗影突袭初始刀刃实际物理伤害','blade_damage','physics',{description:'初始散出刀刃独立物理伤害；不自动生成刀刃路径命中。'});
  damagePending(x,'return_blade_hit','暗影突袭返回刀刃实际物理伤害','blade_damage','physics',{description:'隐身结束或被攻击/Q取消后的返回刀刃独立物理伤害；真实返回目标由事件提供。'});
  statEffect(x,'move_speed','暗影突袭额外移动速度',val('move_speed_ratio'),'move_speed_percent',{duration:val('duration_ms'),description:'仅在暗影突袭实际激活期间提供额外移速；隐身结束不由该属性自动推断。'});
  pending(x,'隐身与取消方式','官方明确2.5秒隐身、攻击或Q可提前取消并改变刀刃返回目标；隐身状态、取消事件和法术护盾资格待系统核对，当前不以纯视觉替代状态。','系统');
  pending(x,'两段刀刃路径与单目标命中','初始散出与返回各造成一次Damage；刀刃移动、多目标筛选、至少一枚刀刃命中条件和返回目标待空间事件，当前只保留一名敌方英雄的两段公式。');
  pending(x,'R与刀锋之末联动','R每段真实命中是否给P创伤层、攻击/Q取消时的目标归属待跨技能接线，不自动生成P触发。');
  exclude(x,'多目标刀刃与纯视觉路径','刀刃扩散/汇聚空间路径、隐身视觉和多目标选取后置；初始/返回单目标伤害和移速持续保留。');
}
