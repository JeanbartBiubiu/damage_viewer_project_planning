import {begin,common,data,literal,parameter,formula,pn,attr,add,mul,fval,damage,hit,runtime,pending,exclude} from './英雄工具.mjs';

function proof(x,source,raw,semantic){x.c.proofs.push({source,raw,semantic});}
function levelCurve(x,key,name,part){
 if(part?.__type!=='ByCharLevelBreakpointsCalculationPart')throw Error('Caitlyn等级曲线节点不符');
 const values=Array.from({length:18},(_,i)=>{let v=part.mLevel1Value;for(const b of part.mBreakpoints??[])if(i+1>=b.mLevel)v+=b.mAdditionalBonusAtThisLevel??0;return Math.round(v*1e6)/1e6;});
 parameter(x,key,name,values,'当前计算式的角色等级断点，取1至18级；19级及以后不计本批已覆盖。','CHARACTER_LEVEL');
 x.c.proofs.push({parameterKey:key,source:'mSpellCalculations角色等级断点',raw:part,values});
}

{
 const x=begin('caitlyn_p');
 const calc=x.p.mSpellCalculations.HeadShotBonusDamage;
 const outer=calc.mFormulaParts?.[0];
 if(outer?.mStat!==2||outer?.__type!=='StatBySubPartCalculationPart')throw Error('CaitlynP总攻击力节点不符');
 const parts=outer.mSubpart?.mSubparts??[];
 if(parts[0]?.__type!=='ByCharLevelBreakpointsCalculationPart'||parts[1]?.__type!=='ProductOfSubPartsCalculationPart')throw Error('CaitlynP爆头子式不符');
 data(x,'CriticalStrikeScaling','critical_strike_scaling','爆头暴击几率折算系数');
 data(x,'AttacksPerHeadshot','attacks_per_headshot','普通攻击触发爆头所需次数');
 data(x,'BrushStackBonus','brush_stack_bonus','草丛攻击额外计数');
 levelCurve(x,'level_bonus_ratio','爆头等级基础攻击力倍率',parts[0]);
 literal(x,'one','暴击倍率基准值',1,'当前角色根暴击倍率为2；计算树中的暴击倍率减1在无额外暴击伤害时等于1。','CharacterRecords.Root.critDamageMultiplier + mSpellCalculations.HeadShotBonusDamage');
 proof(x,'mSpellCalculations.HeadShotBonusDamage',outer,'mStat=2为攻击力；嵌套mStat=8为暴击几率、mStat=9并接减1为暴击倍率减一。未把被动额外伤害再加一份普通攻击。');
 formula(x,'headshot_bonus_damage','爆头额外物理伤害',mul(attr('attack_damage','SOURCE','TOTAL'),add(pn('level_bonus_ratio'),mul(mul(attr('critical_strike_chance'),pn('critical_strike_scaling')),add(pn('one'),attr('critical_strike_damage_bonus_percent'))))),'总攻击力×（等级基础.6/.8/1.0 + 暴击几率×1×（暴击倍率−1））；这是普通攻击之外的额外部分。');
 formula(x,'brush_attack_total','草丛一次攻击计数',add(pn('one'),pn('brush_stack_bonus')),'草丛攻击按1+BrushStackBonus计数；普通攻击计数消费时点另行接线。');
 pending(x,'爆头计数与实际攻击消费','每5次攻击、草丛计数以及命中后的爆头消费需要真实普通攻击事件；本轮不把被动施放或任意技能命中伪装成攻击。');
 pending(x,'陷阱与绳网强化爆头','陷阱或绳网目标的额外爆头与双倍距离依赖对应技能真实状态；当前只保留P基础公式，不提前叠加W额外量。');
 exclude(x,'非英雄单位与建筑特殊上限','TowerCap和小兵额外伤害不在本轮一名敌方英雄范围内；P的英雄额外伤害公式及跨技能依赖保留。');
}

{
 const x=begin('caitlyn_q');common(x);
 data(x,'BaseDamage','base_damage','和平使者首目标基础物理伤害');
 data(x,'SecondaryMult','secondary_damage_ratio','和平使者后续目标伤害比例');
 data(x,'tADRatio','total_ad_ratio','和平使者总攻击力系数');
 const part=x.p.mSpellCalculations.InitialDamage.mFormulaParts?.[1];
 if(part?.mStat!==2||part?.mSubpart?.mDataValue!=='tADRatio')throw Error('CaitlynQ总攻击力来源不符');
 proof(x,'mSpellCalculations.InitialDamage.mFormulaParts.1',part,'当前tADRatio具名总攻击力子节点；使用索引1起的50/90/130/170/210基础数组，不使用索引0旧值。');
 formula(x,'initial_damage','和平使者首个目标物理伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),'50/90/130/170/210 +1.25/1.45/1.65/1.85/2.05总攻击力；只保留一名英雄首目标。');
 formula(x,'secondary_damage','和平使者后续目标伤害',mul(pn('secondary_damage_ratio'),fval('initial_damage')),'后续目标为首目标完整算式×.6；多目标穿透执行不在本轮绑定。');
 damage(x,'initial_damage','和平使者首目标命中伤害','initial_damage','physics');
 hit(x,'initial_damage');
 pending(x,'施放时序与冷却起算','主根有.625秒spellCastTime和1秒spellTotalTime；本轮只保留基础成本、冷却和首目标公式，不猜射击到达或冷却起算时点。');
 pending(x,'陷阱显形全额伤害','W显形目标不受后续伤害衰减的条件依赖W真实陷阱状态；不把任何Q命中都当作陷阱目标。');
 exclude(x,'后续单位穿透与空间路径','只保留1V1首个英雄目标；子弹展开、后续目标筛选及空间路径后置，不删除首目标伤害。');
}

{
 const x=begin('caitlyn_w');
 data(x,'BaseDamage','trap_headshot_base_damage','约德尔诱捕器强化爆头基础物理伤害');
 data(x,'ADRatio','trap_headshot_ad_ratio','约德尔诱捕器强化爆头额外攻击力系数');
 const part=x.p.mSpellCalculations.HeadShotBonusDamage.mFormulaParts?.[1];
 if(part?.mStat!==2||part?.mStatFormula!==2||part?.mDataValue!=='ADRatio')throw Error('CaitlynW爆头攻击力来源不符');
 proof(x,'mSpellCalculations.HeadShotBonusDamage.mFormulaParts.1',part,'陷阱强化爆头的显式额外攻击力节点为mStat=2、mStatFormula=2、ADRatio=.3。');
 formula(x,'trap_headshot_bonus_damage','陷阱强化爆头额外物理伤害',add(pn('trap_headshot_base_damage'),mul(pn('trap_headshot_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'35/80/125/170/215 +.3额外攻击力；这是P爆头的附加量，不再加普通攻击本体。');
 pending(x,'陷阱踩中与爆头消费','陷阱设置、充能、存续、首个英雄踩中和强化爆头消费需要真实陷阱状态；当前只保留有明确来源的强化公式。');
 pending(x,'禁锢与真实视野','踩中后的1.5秒禁锢和3秒真实视野需要控制与视野能力，当前目录没有禁锢字典，不用眩晕或空字段替代。');
 exclude(x,'独立陷阱实体和空间执行','按本批范围跳过陷阱实体、触发空间和多陷阱选择；P相关强化爆头及其依赖保留。');
}

{
 const x=begin('caitlyn_e');common(x);
 data(x,'Damage','base_damage','90口径绳网基础魔法伤害');
 data(x,'SlowDuration','slow_duration_ms','绳网减速持续（毫秒）',{scale:1000});
 data(x,'SlowAmount','slow_ratio','绳网减速比例',{scale:.01});
 const part=x.p.mSpellCalculations.NetDamage.mFormulaParts?.[1];
 if(part?.__type!=='StatByCoefficientCalculationPart'||Math.abs(part.mCoefficient-.8)>1e-6)throw Error('CaitlynE省略属性系数不符');
 literal(x,'unresolved_scaling_coefficient','绳网未解码属性系数',.8,'NetDamage第二项系数为.8，但mStat/mStatFormula省略；不自动当作法强。','mSpellCalculations.NetDamage');
 runtime(x,'unresolved_scaling_attribute','绳网未解码属性输入','当前NetDamage的.8属性节点未提供mStat/mStatFormula；待同版本属性枚举核对后绑定，不能猜法强或填0。');
 proof(x,'mSpellCalculations.NetDamage',part,'保留明确.8系数和未解码输入；mStat省略不作法强默认。');
 formula(x,'net_damage','90口径绳网命中魔法伤害',add(pn('base_damage'),mul(pn('unresolved_scaling_coefficient'),pn('unresolved_scaling_attribute'))),'80/130/180/230/280 +.8×未解码属性输入；完整公式可独立核算，属性口径未绑定。');
 damage(x,'net_damage','90口径绳网命中伤害','net_damage','magic');
 hit(x,'net_damage');
 pending(x,'未解码属性与法术护盾资格','绳网第二项属性及其法术护盾、吸血资格未确证；保留输入和公式，不把未解码节点当法强或未知0。');
 pending(x,'减速和反冲接线','50%减速1秒及对自身反冲需要真实命中与位移控制；当前目录没有减速字典，不以眩晕替代。');
 exclude(x,'反冲空间路径','凯特琳自身后推方向和距离属于空间执行后置；首目标魔法伤害与控制依赖保留。');
}

{
 const x=begin('caitlyn_r');common(x);
 data(x,'RBaseDamage','base_damage','让子弹飞基础物理伤害');
 data(x,'RADRatio','total_ad_ratio','让子弹飞总攻击力系数');
 data(x,'CriticalStrikeModifier','crit_damage_scaling','让子弹飞暴击几率增幅系数');
 const calc=x.p.mSpellCalculations.RTotalDamage;
 const parts=calc.mFormulaParts??[];
 if(parts[1]?.mStat!==2||parts[1]?.mStatFormula!==2||parts[1]?.mDataValue!=='RADRatio')throw Error('CaitlynR总攻击力来源不符');
 proof(x,'mSpellCalculations.RTotalDamage',calc,'基础300/475/650+1总攻击力后，完整和式再乘1+暴击几率×.3×(暴击倍率−1)；乘数作用整次伤害。');
 literal(x,'one','暴击倍率基准值',1,'当前角色根暴击倍率为2；暴击倍率减1用1+额外暴击伤害比例表达。','CharacterRecords.Root.critDamageMultiplier');
 formula(x,'raw_damage','让子弹飞未计暴击增幅伤害',add(pn('base_damage'),mul(pn('total_ad_ratio'),attr('attack_damage','SOURCE','TOTAL'))),'300/475/650 +1.0总攻击力。');
 formula(x,'crit_damage_multiplier','让子弹飞暴击几率期望倍率',add(pn('one'),mul(mul(attr('critical_strike_chance'),pn('crit_damage_scaling')),add(pn('one'),attr('critical_strike_damage_bonus_percent')))),'1 + 暴击几率×.3×（暴击倍率−1）；这是完整和式的确定性倍率，不再把R当随机普通暴击。');
 formula(x,'damage','让子弹飞完整物理伤害',mul(fval('raw_damage'),fval('crit_damage_multiplier')),'完整RTotalDamage：基础和式先形成，再统一乘暴击几率增幅。');
 damage(x,'damage','让子弹飞命中伤害','damage','physics');
 hit(x,'damage');
 pending(x,'引导、锁定与冷却起算','当前mCastTime=.375、spellTotalTime=1且有引导；目标锁定、引导持续、子弹到达和冷却起点未确证，不创建猜测过程。');
 pending(x,'暴击和拦截资格','R伤害受暴击几率与暴击伤害加成影响；实际暴击期望口径、法术护盾和第三方拦截需要真实命中上下文，当前不添加额外拦截事件。');
 exclude(x,'多敌方英雄拦截与弹道空间','本轮一名敌方英雄只保留目标命中伤害；其他敌人拦截、全局弹道路径和引导期间真实视野后置。');
}
