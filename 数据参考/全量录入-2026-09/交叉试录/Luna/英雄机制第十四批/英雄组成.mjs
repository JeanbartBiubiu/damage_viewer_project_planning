import {plan,common,literal,formula,pending,exclude,statEffect,effect,result,val,fval,op,pn,life} from './候选.mjs';
import {start,datum,fixed,input,calc,sourceOnly} from './计算树候选.mjs';

const plus=(a,b)=>op('ADD',a,b),times=(a,b)=>op('MULTIPLY',a,b),min=(a,b)=>op('MIN',a,b),max=(a,b)=>op('MAX',a,b);
const d=(x,source,key,name,scale=1,unit='')=>datum(x,source,key,name,{scale,unit});
const fact=(x,key,name,value,why)=>fixed(x,key,name,value,why,'当前绑定中文正文；原文见source.currentBoundText');
function resource(x,key,name,value,attributeKey,operation,why){effect(x,key,name,[result('resource',name,'RESOURCE_CHANGE','SOURCE',value,{attributeKey,operation})],null,why+'；仅独立效果，没有默认施放、命中或初始化触发。');}
function standard(x,energy=false){
 common(x,{mana:!energy});
 if(energy){const a=x.s.official.cost,b=x.p.manaValues?.values?.slice(0,x.c.maxLevel);if(a.some(v=>v!==0)){if(!b||a.some((v,i)=>v!==b[i]))throw Error('能量成本来源不符');literal(x,'energy_cost','基础能量消耗',a,'官方资源类型为能量；官方cost与当前manaValues逐级一致，字段名不改变资源身份。','official.partype=能量 + official.cost + manaValues.values');resource(x,'energy_cost','施放能量消耗',val('energy_cost'),'energy','CONSUME','只保存基础能量消耗。');}else x.c.proofs.push({source:'official.cost',values:a,excluded:true,semantic:'成本全零，只保留来源，不创建资源变更。'});}
 pending(x,'施放与实际命中接线','只保存有证独立组成；实际施放、命中、状态资格和运行输入还未接线，不创建空过程或无条件初始化。');
}
function damage(x,source,key,name,why){const ast=calc(x,source,key,name,why);pending(x,'伤害结果：'+key,'当前计算树已存数学关系；暴击、吸血、法术护盾和实际命中资格未完整取证，不填默认DAMAGE结果或空绑定命中动作。','来源');return ast;}
function rest(x,explicit={}){
 for(const v of x.p.DataValues??[]){if(x.dataMap.has(v.name))continue;if(x.c.proofs.some(p=>p.source==='DataValues.'+v.name))continue;
  if(explicit[v.name])sourceOnly(x,'DataValues.'+v.name,explicit[v.name][1],explicit[v.name][0]);
  else sourceOnly(x,'DataValues.'+v.name,'原字段没有当前1V1数值消费或含义证据，完整原值保留，不能据字段名自动创建正常组成。');
 }
 for(const k of Object.keys(x.p.mSpellCalculations??{})){if(x.c.proofs.some(p=>p.source==='mSpellCalculations.'+k))continue;sourceOnly(x,'mSpellCalculations.'+k,'当前绑定的其他计算完整留源；与已存表达式的适用关系未核清，不重复或猜分支。');}
}

// 凯南：资源为能量；印记跨技能、强化攻击和延长时长均保留资格。
{
 const x=start('kennen_p');d(x,'EnergyRestore','energy_restore','三层触发能量回复');d(x,'StunDuration','stun_duration_ms','首次晕眩时长（毫秒）',1000,'毫秒');d(x,'ReducedStunDuration','repeated_stun_duration_ms','重复晕眩时长（毫秒）',1000,'毫秒');d(x,'MarkDuration','mark_duration_ms','印记持续时间（毫秒）',1000,'毫秒');d(x,'DiminishingReturnDuration','repeat_window_ms','重复晕眩窗口（毫秒）',1000,'毫秒');fact(x,'trigger_stacks','晕眩所需层数',3,'当前正文明确3层触发。');resource(x,'energy_restore','印记触发能量回复',val('energy_restore'),'energy','RESTORE','仅已核三层触发时回复25能量，不由普通命中默认触发。');pending(x,'跨技能印记与重复晕眩','Q/W/E/R各自实际施加、3层消耗、6秒重复晕眩窗与控制资格待接；不丢弃印记依赖。');rest(x);
}
{
 const x=start('kennen_q');standard(x,true);d(x,'BaseDamage','base_damage','基础魔法伤害');damage(x,'TotalDamage','damage','千鸟伤害','第一个实际命中敌人的魔法伤害；印记依赖另接。');rest(x);
}
{
 const x=start('kennen_w');standard(x,true);d(x,'bADRatio','bonus_ad_ratio','额外攻击力系数');x.dataMap.set('BADRatio',x.dataMap.get('bADRatio'));x.c.proofs.push({source:'计算引用BADRatio与DataValues.bADRatio',semantic:'本槽仅此一个忽略大小写匹配项；参数取原字段bADRatio，不推广其他名称别名。'});d(x,'BaseOnHitDamage','passive_base_damage','强化攻击基础伤害');d(x,'BaseDamageActive','active_base_damage','主动基础伤害');d(x,'APRatioActive','active_ap_ratio','主动法强系数');fact(x,'attack_trigger_count','强化攻击序号',5,'当前正文每第5次攻击附加攻击特效。');damage(x,'TotalDamagePassive','passive_damage','强化攻击附加伤害','本槽额外AD节点2/2已证；不是总AD。');damage(x,'TotalDamageActive','active_damage','主动伤害','已带印记目标或当前R内目标的主动分支；资格不默认。');damage(x,'TotalDamagePassiveCrit','critical_passive_damage','强化攻击暴击分支伤害','当前正文明确此分支可暴击；9/2属性口径仍用无默认输入，不猜额外暴伤枚举。');pending(x,'建筑攻击叠层与R内自动命中资格','对建筑攻击可叠强化攻击但不消耗，影响战前层数故保留依赖；R内目标免印记要求，不据此创建无条件命中。');rest(x);
}
{
 const x=start('kennen_e');standard(x,true);d(x,'BaseDamage','base_damage','基础魔法伤害');d(x,'EnergyRefund','energy_refund','至少伤害一名敌人后的能量回复');d(x,'MovementSpeed','move_speed_ratio','闪电形态移速加成比例');d(x,'DurationAsBall','ball_duration_ms','闪电形态最长时间（毫秒）',1000,'毫秒');d(x,'TotalAS','bonus_attack_speed_ratio','结束后额外攻速比例');d(x,'DurationAfterBall','after_duration_ms','结束后基础增益时长（毫秒）',1000,'毫秒');d(x,'CritDurationBonus','critical_extension_ms','每次暴击延长时长（毫秒）',1000,'毫秒');damage(x,'TotalDamage','damage','雷铠伤害','当前正文TotalDamage绑定BaseDamage索引1..5=80..240；不采用旧mEffectAmount及官方effect=85..245。');pending(x,'同源旧数组数值冲突','根mEffectAmount[0]与官方effect[1]为85/125/165/205/245，但当前中文引用计算树BaseDamage为80/120/160/200/240；来源全留，采用当前具名绑定，不混合旧数组。','来源');
 const n=input(x,'confirmed_critical_extension_count','已核符合条件的暴击延长次数','整数且非负；只计离开闪电形态后的有效增益期内暴击。真实事件与剩余时长更新未接，不默认0。','INTEGER'),zero=fact(x,'zero','计数下限',0,'计数不能负；用于明确边界，不是输入默认值。');
 formula(x,'capped_after_duration_ms','含上限的增益总时长（毫秒）',plus(pn('after_duration_ms'),min(times(max(n,zero),pn('critical_extension_ms')),pn('after_duration_ms'))),'当前长文明确延长部分不得超过初始时长；总时长=初始4秒+MIN(实际有效次数×1秒,4秒)，不表示按此总时长重复刷新。');
 statEffect(x,'ball_move_speed','闪电形态移速加成',val('move_speed_ratio'),'move_speed_percent',{duration:val('ball_duration_ms'),description:'进入后最长2秒，实际提前结束必须撤除；1表示100%，不用面板移速作为固定加算。'});
 statEffect(x,'after_attack_speed','闪电形态结束后攻速',val('bonus_attack_speed_ratio'),'bonus_attack_speed_percent',{duration:val('after_duration_ms'),description:'仅表达离开闪电形态后初始4秒的额外攻速。暴击延长事件、累计延长上限及真实剩余时长更新尚未接线；总时长上限公式仅保留算术，不作为此效果持续时间或每次暴击的刷新值，不默认满档延长。'});resource(x,'energy_refund','雷铠命中能量回复',val('energy_refund'),'energy','RESTORE','至少对一名敌人造成伤害才回复40，不能每穿过一个敌人回复。');
 rest(x,{DamageToMinions:['范围外','仅小兵/野怪承伤折减，当前英雄伤害不用；能量回复敌人资格仍保留。'],DamageRadius:['范围外','纯接触几何；实际触碰由已核目标资格提供。'],defenses:['来源','字段无values且当前正文无抗性收益，不把省略当0或旧版本抗性。'],linger:['来源','0.15秒残留未有当前属性/伤害应用说明，不能混入已知2秒或4秒增益。']});
}
{
 const x=start('kennen_r');standard(x,true);for(const [s,k,n,scale]of [['BaseDamage','base_tick_damage','每次命中基础伤害'],['APRatio','ap_ratio','法强系数'],['DamageAmp','successive_damage_ratio','后续命中提升比例'],['KennenRTickRate','tick_interval_ms','原周期间隔（毫秒）',1000],['KennenRDefenses','bonus_resistances','护甲与魔抗增加'],['KennenRDuration','duration_ms','风暴持续时间（毫秒）',1000]])d(x,s,k,n,scale??1);damage(x,'PerTickDamageCalculated','base_tick_damage','未叠后续加成的单次伤害','本式每次伤害，不把3秒持续总伤当单跳。');fact(x,'maximum_marks','本次R最多施加印记',3,'当前长文敌人只会被这个技能施加3层印记。');statEffect(x,'armor','风暴护甲',val('bonus_resistances'),'armor',{duration:val('duration_ms')});statEffect(x,'magic_resistance','风暴魔法抗性',val('bonus_resistances'),'magic_resistance',{duration:val('duration_ms')});pending(x,'后续伤害与周期首跳','每次后续命中提升10%的合并顺序、实际首跳/末跳与被动印记最多3层分别待接；不由3秒/0.5秒直接造6跳结果。','来源');rest(x);
}

// 维克兹：研究状态决定R伤害类型；所有周期总量都保留原口径。
{
 const x=start('velkoz_p');d(x,'Duration','stack_duration_ms','解构层持续时间（毫秒）',1000);d(x,'MaxStacks','trigger_stacks','消耗层数');damage(x,'TotalDamage','true_damage','解构真实伤害','实际等级项外供；原插值35..180不展开。');pending(x,'研究与攻击刷新','3层消耗并造成真实伤害；普攻仅刷新持续时间不加层；研究资格被R消费，不能省略跨技能依赖。');rest(x);
}
{
 const x=start('velkoz_q');standard(x);d(x,'BaseDamage','base_damage','基础魔法伤害');d(x,'PassiveStacksToAdd','passive_stacks','实际命中施加解构层数');d(x,'SlowAmount','initial_slow_ratio','初始减速比例');d(x,'SlowDuration','slow_duration_ms','衰减减速持续时间（毫秒）',1000);d(x,'TooltipManaRefund','kill_mana_restore','每击杀单位回复法力');damage(x,'TotalDamage','damage','等离子伤害','对实际命中目标的魔法伤害。');resource(x,'kill_mana_restore','击杀单位法力回复',val('kill_mana_restore'),'mana','RESTORE','当前正文与当前TooltipManaRefund给出20/22.5/25/27.5/30法力；非英雄击杀影响自身战前状态，保留。');pending(x,'衰减减速与分裂命中','减速衰减算法未证，不能把70%固定持续整段；分裂几何不入数值，但同一目标有效命中资格仍待接。','来源');rest(x,{ManaRefund:['来源','0.5与显示回复量为基础cost一半一致；原文本直接引用TooltipManaRefund，不擅自改为实际修改后成本或双算回复。'],SplitTelegraphTime:['范围外','分裂提示用时，不是已证伤害或控制时点。']});
}
{
 const x=start('velkoz_w');standard(x);d(x,'BaseInitialDamage','initial_base_damage','第一段基础伤害');d(x,'BaseSecondaryDamage','secondary_base_damage','第二段基础伤害');d(x,'PassiveStacksToAdd','passive_stacks','每次有效伤害解构层数');damage(x,'InitialDamage','initial_damage','裂隙第一段伤害','第一段独立伤害，保留与第二段区别。');damage(x,'SecondaryDamage','secondary_damage','裂隙第二段伤害','第二段独立伤害，不合并成一次命中。');fact(x,'max_charges','最大充能',2,'当前中英文目录与根mMaxAmmo全2一致。');input(x,'confirmed_recharge_ms','已核实际充能时间（毫秒）','根mAmmoRechargeTime有7项19/18/17/16/15/14/14；本批未证明其技能索引，不能凭数组形状取头或跳头，不默认。');x.c.proofs.push({source:'mAmmoRechargeTime',raw:x.p.mAmmoRechargeTime,sourcePending:true,semantic:'保存未证充能索引，不与1.5秒施放间隔混淆。'});pending(x,'第二段延迟及充能接线','当前正文只说随后喷发，原effect6=0.5没有当前具名时间绑定；不猜爆发延迟。实际充能与消耗没有空过程。','来源');rest(x);
}
{
 const x=start('velkoz_e');standard(x);d(x,'BaseDamage','base_damage','基础魔法伤害');d(x,'APRatio','ap_ratio','法强系数');d(x,'PassiveStacksToAdd','passive_stacks','解构层数');d(x,'StunDuration','airborne_duration_ms','控制持续时间（毫秒）',1000);d(x,'MinDetonationTime','min_detonation_ms','原最短爆炸延迟（毫秒）',1000);d(x,'MaxDetonationTime','max_detonation_ms','原最长爆炸延迟（毫秒）',1000);damage(x,'TotalDamage','damage','构造分解伤害','近处击退和其他目标击飞分别保留条件，不因源码名StunDuration改成晕眩。');pending(x,'控制分支和距离延迟','近处击退/远处击飞决定控制分支；爆炸延迟只有端点，无距离算法，不线性展开。','来源');rest(x,{MoveDistance:['范围外','击退空间距离不进入本批数值；击退资格仍保留。']});
}
{
 const x=start('velkoz_r');standard(x);d(x,'PassiveStacksToAddPerTick','passive_stacks_per_tick','每次实际叠层事件施加层数');const raw=x.p.mEffectAmount[0].value.slice(1,4);if(JSON.stringify(raw)!==JSON.stringify(x.s.official.effect[1]))throw Error('维克兹R第一效果数组未交叉');literal(x,'base_total_damage','完整射线基础总伤害',raw,'原EffectValueCalculationPart.mEffectIndex=1，mEffectAmount第1项技能索引1..3与官方e1逐级一致。','mEffectAmount[0].value + official.effect[1]');x.effectMap=new Map([[1,'base_total_damage']]);const slow=x.p.mEffectAmount[2].value.slice(1,4);if(JSON.stringify(slow)!==JSON.stringify(x.s.official.effect[3]))throw Error('维克兹R减速未交叉');literal(x,'slow_ratio','射线减速比例',slow.map(v=>v*.01),'当前正文Effect3Amount%与官方e3对应20百分比点，转换为0.2比例。','mEffectAmount[2].value + official.effect[3]');fact(x,'damage_duration_ms','正文持续造成伤害时间（毫秒）',2500,'当前正文明确2.5秒里持续造成共该总伤害。');damage(x,'TotalDamage','total_damage','完整射线总伤害','此式是完整2.5秒总量；魔法/真实由目标近期被P伤害资格决定，不生成一次瞬时伤害。');pending(x,'引导根时长与伤害周期','mChannelDuration为2.6秒而正文伤害持续2.5秒；不合并二者，不由叠层字段猜周期。研究资格的“近期”准确窗口未具名，不能用旧Effect2或Effect6的7擅定。','来源');rest(x);
}

// 吉格斯：塔伤排除，施法减少被动冷却、同目标后续地雷折减保留。
{
 const x=start('ziggs_p');d(x,'APRatio','ap_ratio','法强系数');damage(x,'TotalDamage','damage','一触即发附加伤害','等级断点项外供，不采用旧mEffectAmount35..305。');const seconds=calc(x,'SpellCdr','cooldown_reduction_seconds','施法减少被动冷却秒数','原断点求值未知，保存实际秒数输入；不默认为4/5/6阈值表。');const thousand=fact(x,'milliseconds_per_second','每秒毫秒数',1000,'秒换毫秒单位恒等。');formula(x,'cooldown_reduction_ms','施法减少被动冷却毫秒数',times(seconds,thousand),'实际已核秒数×1000；不是百分比冷却缩减。');const a=x.p.Cooldown.values;if(!a.every(v=>v===12))throw Error('被动冷却非固定12');literal(x,'cooldown_ms','被动基础冷却（毫秒）',12000,'当前根Cooldown所有项12，正文引用Cooldown；无等级索引歧义。','Cooldown.values全值12 + 当前正文');pending(x,'普攻与施法减少被动冷却','被动攻击资格和每施法减少时间待接，不能无条件初始化；未知秒数未供不得当0。');sourceOnly(x,'mSpellCalculations.StructureDamage','只对建筑的伤害倍率不进入当前英雄伤害，原始计算留存。','范围外');rest(x,{StructureDamageRatio:['范围外','仅建筑1.75倍率；不用于英雄。']});
}
{
 const x=start('ziggs_q');standard(x);d(x,'BaseDamage','base_damage','基础伤害');d(x,'APRatio','ap_ratio','逐技能等级法强系数');damage(x,'TotalDamage','damage','弹跳炸弹伤害','当前APRatio按技能级为0.6/0.65/0.7/0.75/0.8，非固定0.65。');rest(x,Object.fromEntries(['MaxRange','MaxRangeFirstBounce','MaxRangeSecondBounce','BombTriggerRange','ExplosionRadius','BoundingBoxTrigger'].map(k=>[k,['范围外','纯弹道/触发几何；命中已外供，不改变本公式伤害。']])));
}
{
 const x=start('ziggs_w');standard(x);d(x,'BaseDamage','base_damage','基础魔法伤害');d(x,'BombDuration','bomb_duration_ms','最迟自动引爆时间（毫秒）',1000);damage(x,'TotalDamage','damage','定点爆破伤害','可提前再次施放引爆；敌人伤害与击退、自身无伤击退分别留资格。');pending(x,'引爆和自益位移','提前再施放或4秒到期引爆，吉格斯自身位移不受伤；不把未知控制持续时间当0。');rest(x,Object.fromEntries([['TurretDestroyPercent',['范围外','仅敌方防御塔斩杀阈值，当前英雄不可使用。']],['CherryBonusHaste',['范围外','非普通模式专用字段，当前根普通模式正文未消费。']],...['KnockbackSpeed','KnockbackGravity','KnockbackDistance','ExplosionRadius','KnockbackDistanceAlly'].map(k=>[k,['范围外','纯位移/爆炸几何，不进入数值组成；当前英雄击退资格另留。']]),...['PerceptionBubbleRadius','PerceptionBubbleDuration'].map(k=>[k,['范围外','感知视野用途，不构成当前1V1伤害参数。']])]));
}
{
 const x=start('ziggs_e');standard(x);d(x,'APRatioPerMine','ap_ratio','每颗地雷法强系数');d(x,'DamagePerMine','base_damage','首颗地雷基础伤害');d(x,'SubsequentMineDamageMod','subsequent_damage_ratio','同目标后续地雷保留比例');d(x,'Slow','slow_ratio','减速幅度比例',-1);d(x,'SlowDuration','slow_duration_ms','减速持续时间（毫秒）',1000);d(x,'MineDuration','mine_duration_ms','地雷持续时间（毫秒）',1000);damage(x,'TotalDamage','first_mine_damage','同目标首颗地雷伤害','单颗完整伤害；不猜触发地雷总数。');damage(x,'ReducedDamage','subsequent_mine_damage','同目标后续单颗地雷伤害','每颗后续伤害是首颗的0.4倍，非减少0.4或范围外多目标。');pending(x,'同目标地雷计数与减速','首颗/后续资格、每次有效触发与减速合并口径未接；地雷总数不默认。');rest(x,{TriggerRange:['范围外','纯触发半径。'],MinePerceptionBubbleSize:['范围外','感知范围，不改变当前英雄伤害。']});
}
{
 const x=start('ziggs_r');standard(x);d(x,'BaseDamage','base_damage','中心基础伤害');d(x,'APRatio','ap_ratio','法强系数');d(x,'OuterRingModifier','outer_ring_ratio','边缘伤害保留比例');damage(x,'EmpoweredDamage','center_damage','中心伤害','中心区域资格外供。');damage(x,'BlastDamage','outer_damage','边缘伤害','同一目标在边缘时的0.65倍伤害，不能把区域分支删成多目标。');pending(x,'中心与边缘资格','两种伤害互斥；飞行距离到落地时点未取证。');rest(x,{MaximumRadius:['范围外','纯外圈几何。'],EmpoweredRadius:['范围外','纯中心几何；中心/边缘伤害分支保留。']});
}

// 泽拉斯：非英雄恢复不能按范围外删掉；距离端点不猜线性。
{
 const x=start('xerath_p');d(x,'CooldownKillRefund','kill_cooldown_reduction_ms','每击杀单位减少冷却（毫秒）',1000);fact(x,'cooldown_ms','法力澎湃冷却（毫秒）',16000,'当前正文每过16秒。');calc(x,'MinionManaRestoreTT','non_champion_mana_restore','攻击非英雄的法力回复','原角色等级断点算法未证，实际等级基础回复外供；包括小兵、野怪和建筑，影响自身战前状态。');calc(x,'ChampionManaRestoreTT','champion_mana_restore','攻击英雄的法力回复','当前具名计算是非英雄回复量×2；不默认角色等级表。');resource(x,'non_champion_restore','非英雄攻击法力回复',fval('non_champion_mana_restore'),'mana','RESTORE','只有被动可用时对小兵、野怪或建筑的攻击；不能每次普攻默认回复。');resource(x,'champion_restore','英雄攻击法力回复',fval('champion_mana_restore'),'mana','RESTORE','只有被动可用时对英雄的攻击；等级实际值未供不得用0。');pending(x,'周期与击杀缩冷却','16秒可用性、每击杀单位减少3.5秒与目标类别由真实事件决定，未创建默认初始化或自动普攻动作。');rest(x);
}
{
 const x=start('xerath_q');standard(x);d(x,'BaseDamage','base_damage','基础伤害');d(x,'ManaRefundFail','unreleased_refund_ratio','未释放时返还实际消耗比例');damage(x,'TooltipTotalDamage','damage','奥能脉冲伤害','当前释放时伤害；不把蓄力时间当伤害倍率。');const spent=input(x,'actual_mana_spent','这次蓄力实际已消耗法力','来源写返还一半消耗，须提供这次真实已扣金额，不默认用基础mana_cost代替。');formula(x,'unreleased_mana_refund','未释放时法力返还',times(spent,pn('unreleased_refund_ratio')),'只在光束未释放时返还实际消耗的0.5。');resource(x,'unreleased_refund','未释放法力返还',fval('unreleased_mana_refund'),'mana','REFUND','只在实际未释放取消时适用，与施放基础成本分开。');const actual=input(x,'actual_self_slow_ratio','当前蓄力阶段实际自身减速比例','渐增算法/间隔未证，实际非负幅度外供，不按RampingSlow值推每秒。'),cap=fact(x,'max_self_slow_ratio','自身减速上限比例',.5,'当前正文明确至多50%。'),zero=fact(x,'zero','幅度下限',0,'减速幅度非负，用于上限公式边界，不是输入默认。');formula(x,'capped_self_slow_ratio','含明确上限的自身减速比例',min(max(actual,zero),cap),'最终幅度夹在0至0.5；尚无确证减速合并区，不将它当普通移速加成减算。');pending(x,'蓄力时长和渐增算法','ChargeTime=4秒、mChannelDuration=3秒，当前正文没有数值时长，不能静默挑一个；逐步减速仅50%上限已证。','来源');rest(x,{ChargeTime:['来源','4秒与根引导3秒不同，不能作为统一实际蓄力时长。'],StartingSelfSlow:['来源','原-0.2保留，符号/起始应用过程未完整取证。'],RampingSlow:['来源','0.1没有时间单位算法证据，不推每秒增长。'],RectangleWidth:['范围外','纯弹道宽度。'],StartRangePercent:['范围外','仅蓄力射程几何。'],RangeGrowthMult:['范围外','仅蓄力射程几何。']});
}
{
 const x=start('xerath_w');standard(x);d(x,'BaseDamage','base_damage','边缘基础伤害');d(x,'SweetSpotMultiplier','center_damage_multiplier','中心伤害倍率');d(x,'SlowAmount','normal_slow_ratio','普通减速比例');d(x,'SweetSpotSlowAmount','center_initial_slow_ratio','中心初始减速比例');d(x,'SlowDuration','slow_duration_ms','减速持续时间（毫秒）',1000);d(x,'DamageDelay','damage_delay_ms','原伤害延迟（毫秒）',1000);damage(x,'TotalDamage','normal_damage','普通伤害','非中心分支。');damage(x,'SweetSpotTotalDamage','center_damage','中心伤害','严格乘当前1.667，不改成5/3。');pending(x,'中心衰减减速','当前长文说明中心减速持续衰减到25%，实际衰减算法/时间步长未证；不固定最高幅度整段生效。','来源');rest(x,{MultiplicativeSlowDecayRate:['来源','0.8乘法衰减字段无时间步长证据，不生成离散或指数曲线。']});
}
{
 const x=start('xerath_e');standard(x);d(x,'BaseDamage','base_damage','基础伤害');d(x,'MinStunDuration','min_stun_ms','晕眩下限（毫秒）',1000);d(x,'MaxStunDuration','max_stun_ms','晕眩上限（毫秒）',1000);damage(x,'TooltipTotalDamage','damage','冲击法球伤害','第一个实际命中目标。');const n=input(x,'confirmed_distance_stun_ms','实际距离对应晕眩时长（毫秒）','距离到时长的完整算法没有原计算树，实际已核毫秒数外供，不用字段名0.17和端点拼线性。');formula(x,'bounded_stun_ms','含当前上下限的晕眩时长（毫秒）',min(max(n,pn('min_stun_ms')),pn('max_stun_ms')),'当前正文至少0.75秒、至多2.25秒；最终夹限后用于后续控制配置。');pending(x,'晕眩实际结果','距离求值、法术护盾及控制资格未接，不创建空命中动作或固定最大晕眩。');rest(x,{Range:['范围外','纯射程上限；实际距离算法另待证。'],StunScaling_RoughAverageWillBeThisNumber_Every100RangeForTheAdditionalStun_AddedTo_5_:['来源','名字含rough average且与现最小0.75口径未证明，不能猜距离线性。']});
}
{
 const x=start('xerath_r');standard(x);d(x,'BaseDamage','base_damage','每次炮击基础伤害');d(x,'RampBaseDamage','ramp_base_damage','每次有效英雄命中额外基础伤害');d(x,'Duration','duration_ms','引导时长（毫秒）',1000);d(x,'NumberOfShots','maximum_shots','本次R最多炮击次数');d(x,'CDPerShot','between_shots_ms','炮击间隔（毫秒）',1000);d(x,'FailCastRefund','unused_cooldown_reduction_ratio','完全未再次施放时冷却降低比例');damage(x,'TooltipTotalDamage','base_shot_damage','单次未叠加炮击伤害','每次基础伤害，不把全部弹药相乘当必然命中。');damage(x,'RampDamageCalc','extra_champion_hit_damage','每次有效英雄命中额外伤害','额外部分是20/25/30+0.05AP；实际累计、同次或下次适用与目标关系留待核。');const count=input(x,'actual_recasts','本次实际再次施放次数','整数非负，实际由本次R提供，不默认打满弹药。','INTEGER'),zero=fact(x,'zero','次数下限',0,'计数下限，不是输入默认。');formula(x,'capped_recasts','受本次上限约束的实际炮击次数',min(max(count,zero),pn('maximum_shots')),'本次最多4/5/6次；上限进入最终数值，不只写说明。');pending(x,'连续命中与未开炮缩冷却','当前描述给每次额外伤害，但增层发生顺序与累计消费未完整证明，不猜当前层数；完全未再次施放才冷却降低50%，比例不写成毫秒效果。','来源');rest(x,{AoESize:['范围外','纯爆炸半径，单目标伤害保留。']});
}

// 已知规则所需的场景实值属于未接线；未知等级/属性/时间算法仍单列来源待核。
for(const [skillKey,key]of [['kennen_e','confirmed_critical_extension_count'],['xerath_q','actual_mana_spent'],['xerath_r','actual_recasts']]){
 const row=plan.skills[skillKey].pending.find(p=>p.component==='实际输入：'+key);if(!row)throw Error('缺实际输入记录');row.kind='配置';
}
if(Object.keys(plan.skills).length!==20)throw Error('必须覆盖20槽');
