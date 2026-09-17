import {begin,common,data,literal,runtime,formula,requireCalc,interpolation,breakpoints,pn,attr,op,add,mul,val,fval,effect,result,damagePending,healPending,statEffect,pending,exclude,excludeData} from './候选.mjs';

// 被动：只保存强化所需的计数、时限和各技能分支参数；不凭空生成“下一技能已强化”事件。
{
  const x=begin('pantheon_p');
  data(x,'ActionsToEmpower','actions_to_empower','强化下一个基础技能所需技能或攻击次数');
  x.c.proofs.push({source:'DataValues.PhalanxDuration',raw:x.p.DataValues?.find(v=>v.name==='PhalanxDuration'),sourcePending:true,semantic:'当前普通模式绑定只证明ActionsToEmpower；本字段消费链未证，不按字段名推护盾、强化Q或脱战规则。'});
  x.c.proofs.push({source:'DataValues.QDamageAmp',raw:x.p.DataValues?.find(v=>v.name==='QDamageAmp'),sourcePending:true,semantic:'当前普通模式绑定只证明ActionsToEmpower；本字段消费链未证，不按字段名推护盾、强化Q或脱战规则。'});
  x.c.proofs.push({source:'DataValues.QDamageAmpMelee',raw:x.p.DataValues?.find(v=>v.name==='QDamageAmpMelee'),sourcePending:true,semantic:'当前普通模式绑定只证明ActionsToEmpower；本字段消费链未证，不按字段名推护盾、强化Q或脱战规则。'});
  x.c.proofs.push({source:'DataValues.OutOfCombatTimer',raw:x.p.DataValues?.find(v=>v.name==='OutOfCombatTimer'),sourcePending:true,semantic:'当前普通模式绑定只证明ActionsToEmpower；本字段消费链未证，不按字段名推护盾、强化Q或脱战规则。'});
  x.c.proofs.push({source:'DataValues.QExtraAttacks',raw:x.p.DataValues?.find(v=>v.name==='QExtraAttacks'),sourcePending:true,semantic:'当前普通模式绑定只证明ActionsToEmpower；本字段消费链未证，不按字段名推护盾、强化Q或脱战规则。'});
  x.c.proofs.push({source:'DataValues.CritThreshold',raw:x.p.DataValues?.find(v=>v.name==='CritThreshold'),sourcePending:true,semantic:'当前普通模式绑定只证明ActionsToEmpower；本字段消费链未证，不按字段名推护盾、强化Q或脱战规则。'});
  runtime(x,'current_empower_actions','当前已计入强化的技能或攻击次数','只接受当前潘森被动计数实例的真实次数；不能默认已满ActionsToEmpower，也不能把普通施放规则当作计数事件。','INTEGER');
  pending(x,'强化计数与下一个技能消费','官方明确5次技能或攻击后强化下一个基础技能；实际计数来源、满层与强化消费需跨技能事件接线。');
  pending(x,'六个原根字段当前用途未证','PhalanxDuration、QDamageAmp、QDamageAmpMelee、OutOfCombatTimer、QExtraAttacks、CritThreshold只有原根字段；当前普通模式消费链未取得，保留原值资料，不纳入正常参数。','来源');
  pending(x,'P与Q/W/E/R的强化关系','Q额外伤害、W三次攻击、E强化后抗性/移速以及R使P准备就绪均跨技能读取；本被动槽只保存明确计数，不复制各技能伤害。');
}

// Q：保留秒放、蓄力、低生命值替代分支以及P强化的完整算术；小兵/野怪和后续目标减伤后置。
{
  const x=begin('pantheon_q');
  common(x,{cast:true,channelDuration:true});
  data(x,'HoldDamage','hold_base_damage','蓄力长枪基础伤害');
  data(x,'TapDamage','tap_base_damage','秒放长枪基础伤害');
  data(x,'CritHealthThreshold','execute_health_threshold','低生命值替代分支阈值');
  excludeData(x,'HoldRange','纯投掷距离参数；本批只保留当前一名敌方英雄的数值关系，不新增空间参数。');
  excludeData(x,'DamageFalloff','仅后续目标折算；本批不新增多目标参数。');
  data(x,'TapCooldownRefund','tap_cooldown_refund_ratio','秒放返还冷却比例');
  pending(x,'秒放冷却返还单位','原文明确返还60%冷却，但当前COOLDOWN_CHANGE仅接收毫秒；返还实际基数及急速关系未证，保留比例，不构造比例直接减毫秒效果。','系统');
  data(x,'HoldExecuteDamage','hold_execute_base_damage','蓄力低生命值基础伤害');
  data(x,'SelfSlow','self_slow_ratio','蓄力自身减速比例');
  data(x,'MinTimeHoldCast','minimum_hold_time_ms','蓄力最低施法时间（毫秒）',{scale:1000});
  excludeData(x,'MinionDamageMod','仅小兵专用伤害折算；本批不新增非英雄参数。');
  data(x,'ExecuteBaseDamage','execute_base_damage','低生命值替代基础伤害');
  excludeData(x,'MonsterDamageMod','仅野怪专用伤害折算；本批不新增非英雄参数。');
  const hold=requireCalc(x,'HoldDamageCalc').mFormulaParts;
  const tap=requireCalc(x,'TapDamageCalc').mFormulaParts;
  if(hold?.[0]?.mDataValue!=='HoldDamage'||hold?.[1]?.mStat!==2||hold?.[1]?.mStatFormula!==2||Math.abs(hold[1].mCoefficient-1.15)>1e-4||hold?.[2]?.mStat!=null||hold?.[2]?.mCoefficient!==.5)throw Error('潘森Q蓄力树字段不符');
  if(tap?.[0]?.mDataValue!=='TapDamage'||tap?.[1]?.mStat!==2||tap?.[1]?.mStatFormula!==2||Math.abs(tap[1].mCoefficient-1.15)>1e-4)throw Error('潘森Q秒放树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.HoldDamageCalc.mFormulaParts',raw:hold,semantic:'前两项为基础+1.15额外攻击力，第三项StatByCoefficient未显式填写mStat/mStatFormula；按通用计算树证据默认值0映射为法强'});
  x.c.proofs.push({source:'mSpellCalculations.TapDamageCalc.mFormulaParts',raw:tap,semantic:'mStat=2/mStatFormula=2按既有已核对映射为额外攻击力'});
  literal(x,'half','蓄力法强项系数',.5,'当前HoldDamageCalc第三项明确为0.5；该StatByCoefficient节点默认mStat/mStatFormula为0，按通用计算树证据映射为法强。','mSpellCalculations.HoldDamageCalc.mFormulaParts[2]');
  const empowered=requireCalc(x,'EmpoweredDamageCalc').mFormulaParts;
  if(empowered?.[0]?.__type!=='ByCharLevelInterpolationCalculationPart'||empowered?.[1]?.mStat!==2||empowered?.[1]?.mStatFormula!==2)throw Error('潘森Q强化树字段不符');
  interpolation(x,'empowered_base_damage_by_level','强化Q角色等级基础伤害',empowered[0]);
  x.c.proofs.push({source:'mSpellCalculations.EmpoweredDamageCalc.mFormulaParts[1]',raw:empowered[1],semantic:'强化Q额外攻击力项为mStat2/mStatFormula2'});
  const execute=requireCalc(x,'ExecuteDamageCalcModified').mFormulaParts;
  if(execute?.[0]?.__type!=='SumOfSubPartsCalculationPart'||execute?.[1]?.mStat!==2||execute?.[1]?.mStatFormula!==2)throw Error('潘森Q处决树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.ExecuteDamageCalcModified.mFormulaParts',raw:execute,semantic:'低生命值替代树为HoldDamage+HoldExecuteDamage+2.3额外攻击力'});
  literal(x,'execute_bonus_ad_ratio','低生命值替代额外攻击力倍率',Math.round(execute[1].mCoefficient*1e6)/1e6,'当前ExecuteDamageCalcModified明确使用2.3额外攻击力。','mSpellCalculations.ExecuteDamageCalcModified.mFormulaParts[1]');
  literal(x,'hold_bonus_ad_ratio','蓄力与秒放额外攻击力倍率',Math.round(hold[1].mCoefficient*1e6)/1e6,'当前HoldDamageCalc/TapDamageCalc明确使用1.15额外攻击力。','mSpellCalculations.HoldDamageCalc/TapDamageCalc');
  formula(x,'hold_damage','蓄力长枪首个目标物理伤害',add(add(pn('hold_base_damage'),mul(pn('hold_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),mul(pn('half'),attr('ability_power','SOURCE','TOTAL'))),'HoldDamage+1.15×额外攻击力+0.5×法强；第三项默认mStat/mStatFormula为0的映射由通用计算树证据支持。');
  formula(x,'tap_damage','秒放长枪物理伤害',add(pn('tap_base_damage'),mul(pn('hold_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'TapDamage+1.15×额外攻击力；只表示秒放单个命中目标。');
  formula(x,'execute_damage','低生命值替代物理伤害',add(add(pn('hold_base_damage'),pn('hold_execute_base_damage')),mul(pn('execute_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'ExecuteDamageCalcModified=HoldDamage+HoldExecuteDamage+2.3×额外攻击力；仅在目标生命低于阈值的真实分支使用。');
  formula(x,'empowered_damage','矢志不退强化Q额外物理伤害',add(pn('empowered_base_damage_by_level'),mul(pn('hold_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'强化Q额外伤害为外供的实际等级基础值+1.15×额外攻击力；源端点20/240留证，未推定等级曲线；与基础Q分支的消费关系待P接线。');
  damagePending(x,'tap_hit','秒放长枪实际物理伤害','tap_damage','physics',{description:'秒放分支独立物理伤害；不与蓄力、低生命值和强化分支同时自动执行。'});
  damagePending(x,'hold_hit','蓄力长枪实际物理伤害','hold_damage','physics',{description:'蓄力首个目标独立物理伤害；后续目标折算和真实蓄力命中另行接线。'});
  damagePending(x,'execute_hit','低生命值替代实际物理伤害','execute_damage','physics',{description:'仅低于执行阈值时的替代物理伤害；不由候选自动判断目标生命。'});
  damagePending(x,'empowered_hit','矢志不退强化Q实际额外物理伤害','empowered_damage','physics',{description:'只保存强化Q额外伤害；基础Q与强化分支不在此规则中重复生成。'});
  pending(x,'秒放/蓄力/处决分支与真实命中','Q有0.35秒最低蓄力、0.8秒引导、20%生命阈值和后续目标折算；当前候选保存所有公式与参数，不用施放过程自动命中或自动选择低生命值分支。');
  pending(x,'矢志不退强化消费','强化Q额外伤害需由P计数满后由下一基础技能消费；远程/近战增幅参数来自P但当前源未给出接线规则，不重复叠加。');
  pending(x,'Q自身减速与冷却返还资格','SelfSlow已保存但减速结果类型及法术护盾资格待系统核对；TapCooldownRefund只保存比例参数，真实秒放完成条件和返还毫秒值未接线。','系统');
  exclude(x,'小兵与野怪伤害折算','MinionDamageMod和MonsterDamageMod仅保留来源参数；本批一名敌方英雄不套用专用支路。');
  exclude(x,'蓄力后续目标与空间投掷路径','后续目标伤害折算和投掷距离属于多目标/空间执行；首个当前敌方英雄的伤害公式与低生命值依赖保留。');
}

  // W：保留跃击伤害、眩晕期限和强化三次攻击；同版具名旁证只为本节点确认额外生命属性。
{
  const x=begin('pantheon_w');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','斗盾跃击基础伤害');
  data(x,'StunDuration','stun_duration_ms','跃击眩晕持续（毫秒）',{scale:1000});
  data(x,'BuffDuration','empowered_attack_window_ms','强化攻击窗口（毫秒）',{scale:1000});
  data(x,'EmpoweredNumHits','empowered_num_hits','强化攻击命中次数');
  data(x,'EmpoweredDamageMult','empowered_damage_multiplier','强化攻击根倍率原值');
  data(x,'MaxHealthDamage','max_health_damage_ratio','目标最大生命伤害比例');
  excludeData(x,'MonsterDamageCap','仅野怪伤害上限；本批不新增非英雄参数。');
  excludeData(x,'MonsterDamageMin','仅野怪伤害下限；本批不新增非英雄参数。');
  data(x,'MaxHealthPer100AP','max_health_per_100_ap_ratio','每100法强增加最大生命比例');
  const normal=requireCalc(x,'DamageCalc').mFormulaParts;
  if(normal?.[0]?.mDataValue!=='BaseDamage'||normal?.[1]?.mStat!=null||normal?.[1]?.mStatFormula!=null||normal?.[1]?.mCoefficient!==1)throw Error('潘森W普通伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.DamageCalc.mFormulaParts[1]',raw:normal[1],semantic:'StatByCoefficient未显式填写mStat/mStatFormula；按通用计算树证据默认值0映射为法强'});
  const empowered=requireCalc(x,'{1b016817}').mFormulaParts?.[0];
  if(empowered?.mStat!==2||empowered?.mSubpart?.__type!=='ByCharLevelInterpolationCalculationPart')throw Error('潘森W强化伤害树字段不符');
  interpolation(x,'empowered_attack_ratio_by_level','强化攻击角色等级倍率',empowered.mSubpart);
  x.c.proofs.push({source:'mSpellCalculations.{1b016817}.mFormulaParts[0]',raw:empowered,semantic:'mStat=2且省略mStatFormula；按通用计算树证据将默认mStatFormula=0映射为总攻击力'});
  const maxHealth=requireCalc(x,'MaxHealthDamageCalc').mFormulaParts;
  if(maxHealth?.[0]?.mDataValue!=='MaxHealthDamage'||maxHealth?.[1]?.mStat!==12||maxHealth?.[1]?.mStatFormula!==2||maxHealth?.[2]?.mDataValue!=='MaxHealthPer100AP')throw Error('潘森W最大生命树字段不符');
  const maxHealthCoefficient=Math.round(maxHealth[1].mCoefficient*1e6)/1e6;
  x.c.proofs.push({source:'mSpellCalculations.MaxHealthDamageCalc.mFormulaParts',raw:maxHealth,semantic:'当前W第二项为mStat12/mStatFormula2、系数0.00004；同版具名旁证中的相同组合明确绑定HealthRatio并由中文长说明写明额外生命，因此本节点映射为SOURCE.hp.BONUS。MaxHealthPer100AP仍按通用计算树默认mStat/mStatFormula=0映射为法强。'});
  x.c.proofs.push({source:'planning/数据参考/全量录入-2026-09/API实录/符文客户端数值补证/当前69项数值来源.json#entries[38](id=8439余震).object.mScript.mSpellScriptData.mCalculations.DamageCalc.mFormulaParts[1]',raw:{mStat:12,mStatFormula:2,mDataValue:'HealthRatio',__type:'StatByNamedDataValueCalculationPart'},values:[0.07999999821186066],semantic:'同版具名节点将mStat12/mStatFormula2绑定HealthRatio；同对象中文长说明明确为“你8%的额外生命值”。该旁证只覆盖本W相同组合，不推广到其他mStat12节点。'});
  literal(x,'max_health_bonus_hp_ratio','最大生命伤害额外生命系数',maxHealthCoefficient,'当前MaxHealthDamageCalc明确存在0.00004×mStat12/mStatFormula2；同版具名HealthRatio旁证确认该组合取SOURCE.hp.BONUS。','mSpellCalculations.MaxHealthDamageCalc.mFormulaParts[1] + 同版具名HealthRatio旁证');
  formula(x,'damage_calc','斗盾跃击原始伤害计算',add(pn('base_damage'),attr('ability_power','SOURCE','TOTAL')),'DamageCalc=BaseDamage+法强；StatByCoefficient默认mStat/mStatFormula为0的映射由通用计算树证据支持。');
  formula(x,'max_health_damage_ratio_calc','斗盾跃击最大生命伤害比例',add(add(pn('max_health_damage_ratio'),mul(pn('max_health_bonus_hp_ratio'),attr('hp','SOURCE','BONUS'))),mul(pn('max_health_per_100_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'MaxHealthDamage+0.00004×自身额外生命+MaxHealthPer100AP×法强；相同mStat12/mStatFormula2组合的SOURCE.hp.BONUS映射由同版具名HealthRatio旁证支持，结果是目标最大生命比例。');
  formula(x,'jump_damage','斗盾跃击当前敌方英雄物理伤害',mul(add(add(pn('max_health_damage_ratio'),mul(pn('max_health_bonus_hp_ratio'),attr('hp','SOURCE','BONUS'))),mul(pn('max_health_per_100_ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),attr('hp','TARGET','TOTAL')),'以官方主提示的最大生命比例为当前英雄跃击伤害；表达式内联最大生命比例计算树和本W已确认的额外生命项，野怪上下限另行排除。');
  formula(x,'empowered_damage','矢志不退强化三次攻击总物理伤害',mul(pn('empowered_num_hits'),mul(pn('empowered_attack_ratio_by_level'),attr('attack_damage','SOURCE','TOTAL'))),'EmpoweredDamageMultCalcModified=3×角色等级倍率×总攻击力；mStat2且省略mStatFormula的映射由通用计算树证据支持。');
  damagePending(x,'jump_hit','斗盾跃击实际物理伤害','jump_damage','physics',{description:'一名敌方英雄的跃击主伤害；眩晕和低生命/野怪支路单独核对。'});
  damagePending(x,'empowered_attack_hit','矢志不退强化攻击实际物理伤害','empowered_damage','physics',{delivery:'BASIC_ATTACK',block:null,description:'只保存强化后下一次攻击的三段总物理伤害；真实攻击事件和P消费未接线。'});
  pending(x,'跃击眩晕与目标命中','W命中后眩晕1秒；法术护盾阻挡范围、跃击目标合法性和控制消费待系统核对，当前不把施放开始当命中。','系统');
  pending(x,'最大生命伤害属性映射边界','本W MaxHealthDamageCalc的mStat12/mStatFormula2已由同版余震HealthRatio具名旁证映射为SOURCE.hp.BONUS；该旁证只覆盖本W相同组合，不推广至E ResistsCalc等其他mStat12节点。','来源');
  pending(x,'强化三次攻击与P计数','强化分支需P满层后由W消费，BuffDuration仅保存窗口；三次攻击发生时点、普通攻击本体叠加及攻击附效待真实攻击事件。');
  exclude(x,'小兵与野怪上下限','MonsterDamageMin/Cap仅用于非英雄单位，本批只保留一名敌方英雄的最大生命伤害。');
}

// E：保留当前绑定的盾击、持续伤害、强化移速和抗性关系；未绑定治疗与强化伤害只保留来源。
{
  const x=begin('pantheon_e');
  common(x,{cast:true,channelDuration:true});
  data(x,'ShieldDuration','shield_duration_ms','神佑枪阵持续时间（毫秒）',{scale:1000});
  const missing=x.p.DataValues?.find(v=>v.name==='SelfSlowAmount');
  x.c.proofs.push({parameterKey:'self_slow_ratio',source:'DataValues.SelfSlowAmount',raw:missing,missingValues:!Array.isArray(missing?.values),semantic:'当前字段没有values；按要求不补0或默认减速'});
  pending(x,'自身减速字段缺值','SelfSlowAmount对象存在但没有values；当前候选不生成self_slow_ratio参数，也不把缺失当作0。','来源');
  data(x,'AttacksPerSecond','attacks_per_second','盾阵持续戳刺频率原值');
  data(x,'ShieldBaseDamage','shield_base_damage','盾击基础物理伤害');
  excludeData(x,'SpearStrikesRadius','纯持续戳刺空间范围；本批不新增空间参数。');
  excludeData(x,'ShieldSwipeRadius','纯盾击空间范围；本批不新增空间参数。');
  excludeData(x,'MinionDamageReduction','仅小兵伤害折算；本批不新增非英雄参数。');
  data(x,'RecastLockout','recast_lockout_ms','再次施放锁定时间（毫秒）',{scale:1000});
  data(x,'SpeedDuration','speed_duration_ms','强化移速持续（毫秒）',{scale:1000});
  data(x,'SpeedAmount','speed_ratio','强化移动速度比例');
  data(x,'ResistsDuration','resists_duration_ms','强化双抗持续（毫秒）',{scale:1000});
  const damageCalc=requireCalc(x,'DamageCalc').mFormulaParts?.[0];
  if(damageCalc?.mStat!==2||damageCalc?.mStatFormula!=null)throw Error('潘森E持续伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.DamageCalc.mFormulaParts[0]',raw:damageCalc,semantic:'mStat=2且省略mStatFormula；按通用计算树证据将默认mStatFormula=0映射为总攻击力'});
  const shield=requireCalc(x,'ShieldDamageCalc').mFormulaParts;
  if(shield?.[0]?.mDataValue!=='ShieldBaseDamage'||shield?.[1]?.mStat!==2||shield?.[1]?.mStatFormula!==2)throw Error('潘森E盾击树字段不符');
  literal(x,'shield_bonus_ad_ratio','神佑枪阵盾击额外攻击力倍率',Math.round(shield[1].mCoefficient*1e6)/1e6,'ShieldDamageCalc明确为基础伤害+1.5额外攻击力。','mSpellCalculations.ShieldDamageCalc.mFormulaParts[1]');
  for(const key of ['HealCalc','EmpoweredDamageCalc']){
    x.c.proofs.push({source:'mSpellCalculations.'+key,raw:requireCalc(x,key),sourcePending:true,semantic:'原根计算树保留；当前中文绑定无此计算引用，普通模式消费资格未证，未生成正常参数或公式。'});
    pending(x,'当前未绑定计算：'+key,'只保留原始完整树；不能从字段名推定当前治疗或强化伤害玩法，需补普通模式消费引用。','来源');
  }
  const resists=requireCalc(x,'ResistsCalc').mFormulaParts;
  if(resists?.[0]?.__type!=='ByCharLevelInterpolationCalculationPart'||resists?.[1]?.mStat!==12||resists?.[1]?.mStatFormula!==2)throw Error('潘森E抗性树字段不符');
  interpolation(x,'resists_base_by_level','神佑枪阵角色等级基础双抗',resists[0]);
  literal(x,'resists_bonus_stat_ratio','神佑枪阵抗性未解码属性倍率',Math.round(resists[1].mCoefficient*1e6)/1e6,'ResistsCalc明确为等级基础双抗+0.025×未解码mStat12。','mSpellCalculations.ResistsCalc.mFormulaParts[1]');
  runtime(x,'current_resists_stat_value','神佑枪阵抗性未解码属性值','ResistsCalc的mStat12/mStatFormula2未在当前候选绑定具体属性；不猜最大生命或法强。');
  literal(x,'shield_channel_tick_ratio','神佑枪阵内部每次戳刺倍率',.167,'当前匿名计算树{e62bc5e9}只给0.167倍DamageCalc；保留原值，不据此推导完整周期次数。','mSpellCalculations.{e62bc5e9}.mMultiplier');
  formula(x,'spear_strike_damage','神佑枪阵持续期间总物理伤害',attr('attack_damage','SOURCE','TOTAL'),'当前绑定中文明确在持续期间造成DamageCalc总物理伤害，等于总攻击力；这是持续阶段总量，不能逐次戳刺重复执行该总量。周期分配与提前结束折算未证。');
  formula(x,'shield_damage','神佑枪阵盾击物理伤害',add(pn('shield_base_damage'),mul(pn('shield_bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'ShieldDamageCalc=ShieldBaseDamage+1.5×额外攻击力。');
  formula(x,'resists_amount','矢志不退强化双抗量',add(pn('resists_base_by_level'),mul(pn('resists_bonus_stat_ratio'),pn('current_resists_stat_value'))),'ResistsCalc=角色等级基础双抗+0.025×未解码属性输入。');
  damagePending(x,'spear_strike_hit','神佑枪阵持续阶段总物理伤害','spear_strike_damage','physics',{description:'持续阶段总量；周期分配和提前结束折算未证，不能在每次戳刺重复执行总量。'});
  damagePending(x,'shield_swipe_hit','神佑枪阵盾击实际物理伤害','shield_damage','physics',{description:'引导结束或提前结束后的真实盾击伤害；不与持续戳刺自动合并。'});
  statEffect(x,'empowered_move_speed','矢志不退强化移动速度',val('speed_ratio'),'move_speed_percent',{duration:val('speed_duration_ms'),description:'仅在强化盾击真实完成后应用1.5秒移速；不在普通E施放时无条件应用。'});
  pending(x,'朝向伤害免疫与塔例外','官方明确架盾期间免疫来自所选方向伤害且防御塔除外；需要方向、伤害来源和护盾阻挡系统，不能用普通伤害减免或无条件全身免疫代替。','系统');
  pending(x,'持续戳刺周期与提前结束','AttacksPerSecond=4、引导1.5秒、匿名0.167倍率均已保存；首击、最后一击、真实每次命中和再次施放0.3秒锁定需要事件时序，未猜成固定6次。');
  pending(x,'强化抗性接线','ResistsCalc保留合法数学关系，等级项与mStat12属性项均需外供；实际P强化消费和双抗结果待接线。HealCalc因当前消费资格未证仅留来源。','系统');
  pending(x,'强化移速应用时点','SpeedAmount/SpeedDuration已保存；只在真实强化盾击完成后应用，当前未把普通E过程绑定到该效果。');
  exclude(x,'小兵伤害折算与防御塔例外','MinionDamageReduction及防御塔免疫例外只适用于非本批一名敌方英雄的专用支路；当前英雄戳刺/盾击伤害公式保留。');
}

// R：保留落点魔法伤害、空投长枪与被动护甲穿透参数；飞行、范围和减速由空间/控制系统接入。
{
  const x=begin('pantheon_r');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','大荒星陨落点基础魔法伤害');
  data(x,'EdgeDamageReduction','edge_damage_reduction_ratio','落点边缘伤害折算比例');
  excludeData(x,'Radius','纯落点空间范围；本批不新增空间参数。');
  excludeData(x,'SweetSpotRadius','纯长枪空间范围；本批不新增空间参数。');
  data(x,'CancelCooldown','cancel_cooldown_ms','取消相关冷却（毫秒）',{scale:1000});
  data(x,'SpearSlow','spear_slow_ratio','空投长枪减速比例');
  data(x,'SpearSlowDuration','spear_slow_duration_ms','空投长枪减速持续（毫秒）',{scale:1000});
  data(x,'ArmorPenetration','armor_penetration_ratio','大荒星陨被动护甲穿透比例');
  data(x,'APRatio','ap_ratio','大荒星陨法术强度系数原值');
  const damageCalc=requireCalc(x,'DamageCalc').mFormulaParts;
  if(damageCalc?.[0]?.mDataValue!=='BaseDamage'||damageCalc?.[1]?.mDataValue!=='APRatio'||damageCalc?.[1]?.mStat!=null)throw Error('潘森R伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.DamageCalc.mFormulaParts[1]',raw:damageCalc[1],semantic:'具名APRatio节点未显式给mStat/mStatFormula；按通用计算树证据默认值0映射为法强'});
  runtime(x,'pantheon_q_hold_damage_value','空投长枪引用Q蓄力伤害值','官方文本明确R空投长枪引用PantheonQ HoldDamageCalc；只接受同次Q计算树已确认的数值，暂不复制或猜跨技能取值时点。');
  literal(x,'one','边缘最低伤害计算单位值',1,'用于复现MinDamage的1−EdgeDamageReduction。','mSpellCalculations.MinDamage');
  formula(x,'edge_damage_floor_ratio','落点边缘最低伤害比例',op('SUBTRACT',pn('one'),pn('edge_damage_reduction_ratio')),'边缘伤害为完整伤害减去EdgeDamageReduction后的最低比例；只作为边缘分支算式，不自动选择位置。');
  formula(x,'landing_damage','大荒星陨落点魔法伤害',add(pn('base_damage'),mul(pn('ap_ratio'),attr('ability_power','SOURCE','TOTAL'))),'DamageCalc=BaseDamage+APRatio×法强；落点边缘使用EdgeDamageReduction分支。');
  formula(x,'edge_landing_damage','大荒星陨边缘最低魔法伤害',mul(op('SUBTRACT',pn('one'),pn('edge_damage_reduction_ratio')),add(pn('base_damage'),mul(pn('ap_ratio'),attr('ability_power','SOURCE','TOTAL')))),'MinDamage为DamageCalc×(1−EdgeDamageReduction)；表达式内联落点伤害和边缘折算树，只作为边缘分支算式，不自动选择位置。');
  formula(x,'spear_damage','大荒星陨空投长枪物理伤害',pn('pantheon_q_hold_damage_value'),'R文本直接引用PantheonQ HoldDamageCalc；跨技能数值和命中时点待真实接线。');
  damagePending(x,'landing_hit','大荒星陨落点实际魔法伤害','landing_damage','magic',{description:'落点当前目标独立魔法伤害；落点边缘折算由真实位置输入选择。'});
  damagePending(x,'spear_hit','大荒星陨空投长枪实际物理伤害','spear_damage','physics',{description:'空投长枪引用Q蓄力树的独立物理伤害；不复制Q基础公式或自动命中。'});
  pending(x,'长枪减速与护甲穿透','SpearSlow/SpearSlowDuration及ArmorPenetration已保存；减速结果、被动穿透属性和法术护盾资格待系统核对。','系统');
  pending(x,'R对P与Q的跨技能依赖','R会使矢志不退准备就绪，空投长枪引用Q HoldDamageCalc；需同次施放的跨技能快照和强化消费，当前使用运行时Q数值输入。');
  pending(x,'落点与飞行分阶段','飞行、落点边缘/中心、长枪直线和多目标范围属于空间执行；当前一名敌方英雄的两段伤害算式保留，不生成传送或范围命中。');
  exclude(x,'纯飞行空间与多目标选取','空中移动、落点范围、多目标命中选择以及直线路径属于空间/多目标支路，本批后置；当前目标伤害和跨技能引用保留。');
}
