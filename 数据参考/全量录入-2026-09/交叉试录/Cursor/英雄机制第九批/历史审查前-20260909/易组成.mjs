import {begin,common,data,literal,runtime,formula,requireCalc,pn,attr,add,mul,val,fval,fixed,effect,result,damagePending,healPending,statEffect,pending,exclude,excludeData} from './候选.mjs';

// 易：被动第二段仍是一次普通攻击；只保存实际攻击命中所需的附加量，不制造攻击事件。
{
  const x=begin('masteryi_p');
  data(x,'StackDuration','stack_duration_ms','双重打击层数保存时间（毫秒）',{scale:1000});
  data(x,'AttackCount','attack_count','触发双重打击所需连续攻击次数');
  const part=requireCalc(x,'TotalDamage').mFormulaParts?.[0];
  if(part?.mStat!==2||part.mCoefficient==null||part.mStatFormula!=null)throw Error('易P第二段计算树属性字段不符');
  literal(x,'second_attack_ratio','第二段攻击力倍率',Math.round(part.mCoefficient*1e6)/1e6,'当前TotalDamage为mStat=2且省略mStatFormula；按通用计算树证据将默认mStatFormula=0映射为总攻击力。','mSpellCalculations.TotalDamage');
  formula(x,'second_attack_damage','双重打击第二段额外物理伤害',mul(pn('second_attack_ratio'),attr('attack_damage','SOURCE','TOTAL')),'当前TotalDamage为0.5×总攻击力；第二段按官方扩展说明仍算一次常规攻击，可暴击并施加攻击特效。');
  damagePending(x,'second_attack_hit','双重打击第二段实际攻击附加伤害','second_attack_damage','physics',{delivery:'BASIC_ATTACK',block:null,description:'只保留第四次攻击产生的第二段附加物理伤害；实际攻击命中与暴击/攻击特效由外部事件提供。'});
  pending(x,'连续攻击计数与第二段消费','每第四次连续攻击才触发第二段，层数刷新与实际普通攻击命中顺序未接线；本候选不把任意技能命中或施放当作普通攻击。');
  pending(x,'第二段的法术护盾与攻击特效边界','官方扩展明确第二段可暴击并施加攻击特效；当前命中/护盾消费边界仍待运行系统按普通攻击事件核对。','系统');
}

// Q：保留单目标首击、后续击与暴击树；多目标选取和不可选取移动留在空间接线。
{
  const x=begin('masteryi_q');
  common(x,{cast:true});
  data(x,'SubsequentHitMultiplier','subsequent_hit_ratio','后续击打伤害比例');
  data(x,'BaseDamage','base_damage','阿尔法突袭基础伤害');
  data(x,'AttackDamageRatio','attack_damage_ratio','攻击力系数');
  data(x,'BonusCritDamageRatio','bonus_crit_damage_ratio','暴击额外伤害系数');
  data(x,'BaseBasicAttackCDR','basic_attack_cdr_seconds','普通攻击减少冷却时间（秒）');
  data(x,'AlphaStrikeBounces','alpha_strike_bounces','最多命中目标数');
  data(x,'BaseOnHitMultiplier','on_hit_ratio','攻击附伤承受比例');
  const total=requireCalc(x,'TotalDamage').mFormulaParts;
  if(total?.[0]?.mDataValue!=='BaseDamage'||total?.[1]?.mStat!==2||total?.[1]?.mDataValue!=='AttackDamageRatio'||total?.[1]?.mStatFormula!=null)throw Error('易Q总伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.TotalDamage.mFormulaParts[1]',raw:total[1],semantic:'mStat=2且省略mStatFormula；按通用计算树证据将默认mStatFormula=0映射为总攻击力'});
  runtime(x,'current_critical_stat_value','阿尔法突袭暴击计算所需属性值','CritBonus与SingleCritTotalDamage使用mStat=9，根未给出该枚举语义；只接受实际暴击计算输入，不能猜作暴击率或暴击伤害。');
  runtime(x,'current_cooldown_multiplier','普通攻击减少Q冷却的当前倍率','BasicAttackCDR含CooldownMultiplierCalculationPart但没有固定值；只接受当前普通攻击冷却修正输入，缺失不填0。');
  literal(x,'one','计算树加法单位值',1,'用于复现SingleTotalDamage中的数字1。','mSpellCalculations.SingleTotalDamage');
  literal(x,'minus_one','计算树减一单位值',-1,'用于复现CritBonus中的数字−1。','mSpellCalculations.CritBonus');
  formula(x,'alpha_damage','阿尔法突袭一次首击物理伤害',add(pn('base_damage'),mul(pn('attack_damage_ratio'),attr('attack_damage','SOURCE','TOTAL'))),'当前TotalDamage=BaseDamage+AttackDamageRatio×总攻击力；首击基础物理伤害。');
  formula(x,'subsequent_damage','阿尔法突袭后续击打物理伤害',mul(pn('subsequent_hit_ratio'),add(pn('base_damage'),mul(pn('attack_damage_ratio'),attr('attack_damage','SOURCE','TOTAL')))),'SubesquentDamage按首击总量乘SubsequentHitMultiplier；表达式内联首击计算树，不把后续击打误作新的完整首击。');
  formula(x,'single_damage','单目标阿尔法突袭最大基础物理伤害',mul(add(pn('one'),mul(pn('subsequent_hit_ratio'),add(pn('alpha_strike_bounces'),pn('minus_one')))),add(pn('base_damage'),mul(pn('attack_damage_ratio'),attr('attack_damage','SOURCE','TOTAL')))),'SingleTotalDamage树为[1+后续比例×(AlphaStrikeBounces−1)]×TotalDamage；表达式内联首击计算树，仅保留单目标重复击打上限，不扩展到多目标。');
  formula(x,'critical_bonus','阿尔法突袭一次暴击额外物理伤害',mul(mul(pn('bonus_crit_damage_ratio'),add(pn('current_critical_stat_value'),pn('minus_one'))),add(pn('base_damage'),mul(pn('attack_damage_ratio'),attr('attack_damage','SOURCE','TOTAL')))),'CritBonus树为BonusCritDamageRatio×(未解码mStat9−1)×TotalDamage；表达式内联首击计算树，只保存公式，不宣称mStat9具体枚举。');
  formula(x,'single_critical_damage','单目标阿尔法突袭最大暴击物理伤害',mul(mul(pn('bonus_crit_damage_ratio'),pn('current_critical_stat_value')),mul(add(pn('one'),mul(pn('subsequent_hit_ratio'),add(pn('alpha_strike_bounces'),pn('minus_one')))),add(pn('base_damage'),mul(pn('attack_damage_ratio'),attr('attack_damage','SOURCE','TOTAL'))))),'SingleCritTotalDamage树的乘区为BonusCritDamageRatio×mStat9；表达式内联单目标击打和首击计算树，mStat9口径由运行时输入提供。');
  formula(x,'basic_attack_cooldown_reduction','普通攻击减少阿尔法突袭冷却时间',mul(pn('basic_attack_cdr_seconds'),pn('current_cooldown_multiplier')),'BasicAttackCDR=BaseBasicAttackCDR×当前CooldownMultiplier；不把每次普通攻击固定扣除写死为1秒。');
  damagePending(x,'alpha_strike_hit','阿尔法突袭首击实际物理伤害','alpha_damage','physics',{description:'独立首击伤害；实际命中、后续击打、暴击及攻击附伤分支分别由真实事件选择。'});
  effect(x,'basic_attack_cooldown_reduction','普通攻击减少阿尔法突袭冷却',[result('reduce_q_cooldown','减少阿尔法突袭冷却','COOLDOWN_CHANGE','SOURCE',fval('basic_attack_cooldown_reduction'),{affectedSkillScope:{mode:'SKILLS',skillKeys:['masteryi_q'],skillCategoryKeys:[]},operation:'REDUCE'})],null,'只在普通攻击真实命中后消费；本候选保留效果和计算树，不自动触发。');
  pending(x,'后续击打、暴击与攻击附伤','官方明确最多四名目标、无其他目标时可重复击打同一目标，且Q可暴击并施加75%攻击附伤；当前只保留公式，后续命中次数、单目标分支和护盾/攻击特效消费待接真实事件。');
  pending(x,'不可选取与初始目标旁出现','不可选取、目标附近出现和多目标优先级需要空间及状态系统；不因此删除当前目标的一次伤害公式。','系统');
  excludeData(x,'BonusMonsterDamage','仅野怪额外伤害；本批不新增非英雄参数。');
  exclude(x,'野怪额外伤害','BonusMonsterDamage仅用于野怪支路，本批的一名敌方英雄不套用该额外量。');
  exclude(x,'多目标穿梭与位置选择','最多四目标、传送到初始目标旁和多目标重复选择属于空间/多目标执行；单目标伤害、后续比例与跨技能冷却依赖保留。');
}

// W：治疗总量与减伤节点保留；引导、逐次治疗、资源持续消耗及暂停其他技能需要真实过程。
{
  const x=begin('masteryi_w');
  common(x,{cast:true,channelDuration:false});
  data(x,'BaseHeal','base_heal','冥想基础总治疗');
  data(x,'HealDuration','heal_duration_ms','治疗持续时间（毫秒）',{scale:1000});
  data(x,'MaxMissingHealthPercent','max_missing_health_ratio','已损失生命治疗提升上限比例');
  data(x,'TickFrequency','heal_tick_interval_ms','治疗周期原值（毫秒）',{scale:1000});
  data(x,'DamageReduction','damage_reduction_ratio','引导后常规伤害减免比例');
  const towerMod=x.p.DataValues?.find(v=>v.name==='DamageReductionTowerMod');
  x.c.proofs.push({source:'DataValues.DamageReductionTowerMod',raw:towerMod,excluded:true,semantic:'仅防御塔伤害折算；留根来源证据，不新增候选参数或公式。'});
  data(x,'BaseManaCost','base_mana_cost','根额外记录的基础法力消耗');
  data(x,'PercentManaCostPerSecond','mana_cost_per_second_ratio','每秒最大法力消耗比例');
  data(x,'InitialExtraDR','initial_extra_damage_reduction_ratio','最初阶段额外伤害减免比例');
  data(x,'InitialExtraDRDuration','initial_extra_reduction_duration_ms','最初额外减伤持续（毫秒）',{scale:1000});
  data(x,'DRLinger','damage_reduction_linger_ms','减伤延续时间（毫秒）',{scale:1000});
  const total=requireCalc(x,'TotalHeal').mFormulaParts;
  if(total?.[0]?.mDataValue!=='BaseHeal'||total?.[1]?.mCoefficient!==1||total?.[1]?.mStat!=null)throw Error('易W治疗树未知节点被误解码');
  x.c.proofs.push({source:'mSpellCalculations.TotalHeal.mFormulaParts[1]',raw:total[1],semantic:'StatByCoefficient未显式填写mStat/mStatFormula；按通用计算树证据默认值0映射为法强'});
  const initial=requireCalc(x,'InitialDR').mFormulaParts?.[0];
  if(!initial?.mSubparts?.some(p=>p.mDataValue==='DamageReduction')||!initial.mSubparts?.some(p=>p.mDataValue==='InitialExtraDR'))throw Error('易W初始减伤树字段不符');
  runtime(x,'current_missing_health_heal_multiplier','当前已损失生命治疗乘数','官方只给最多按已损失生命提升至MaxMissingHealthPercent，未在当前树中给出实际换算；只接受实际乘数，缺失不补默认。');
  runtime(x,'current_max_mana_value','本次持续法力消耗所需最大法力值','PercentManaCostPerSecond是最大法力百分比；只接受当次最大法力输入，不借用当前法力或猜属性枚举。');
  formula(x,'total_heal_before_missing_health','冥想基础总治疗',add(pn('base_heal'),attr('ability_power','SOURCE','TOTAL')),'TotalHeal=BaseHeal+法强；StatByCoefficient默认mStat/mStatFormula为0的映射由通用计算树证据支持。');
  formula(x,'total_heal','按已损失生命调整的冥想总治疗',mul(add(pn('base_heal'),attr('ability_power','SOURCE','TOTAL')),pn('current_missing_health_heal_multiplier')),'总治疗再乘实际已损失生命治疗乘数；表达式内联基础总治疗，乘数必须由运行时按MaxMissingHealthPercent验证，不能默认线性或填0。');
  formula(x,'initial_damage_reduction','冥想最初阶段伤害减免',add(pn('damage_reduction_ratio'),pn('initial_extra_damage_reduction_ratio')),'InitialDR由DamageReduction+InitialExtraDR组成。');
  formula(x,'normal_damage_reduction','冥想常规伤害减免',pn('damage_reduction_ratio'),'引导初始额外阶段结束后使用DamageReduction。');
  formula(x,'mana_drain_per_second','冥想每秒持续法力消耗',mul(pn('mana_cost_per_second_ratio'),pn('current_max_mana_value')),'每秒消耗6%最大法力；周期边界和取消时点仍待真实引导事件。');
  healPending(x,'meditate_heal_total','冥想持续治疗总量','total_heal');
  pending(x,'引导治疗周期与中断','官方明确4秒持续治疗、0.5秒周期并会因移动或攻击结束引导；当前候选只保存总量、周期、引导期限和法力基础成本，未伪造每个周期或取消事件。');
  pending(x,'减伤作用范围与法术护盾资格','InitialDR、常规DR、DRLinger和防御塔折算均已保留为公式；减伤属性在当前目录/结果类型中的绑定以及来自技能、普通攻击、真实伤害的消费边界待系统核对。','系统');
  pending(x,'双重打击充能与其他技能暂停','W引导会给P充能并暂停E/R持续时长，属于跨技能状态和时间冻结；保留依赖，不把W过程无条件接入P/E/R。');
  exclude(x,'防御塔专用减伤支路','DamageReductionTowerMod仅用于防御塔来源，本批的一名敌方英雄不套用建筑伤害分支。');
}

// E：只保存真实普通攻击附加真实伤害；持续时间和Q/W/R暂停关系留待攻击事件。
{
  const x=begin('masteryi_e');
  common(x,{cast:true});
  data(x,'BaseDamage','base_damage','无极剑道基础真实伤害');
  data(x,'ADRatio','bonus_ad_ratio','无极剑道额外攻击力倍率');
  data(x,'Duration','duration_ms','无极剑道持续时间（毫秒）',{scale:1000});
  data(x,'LegacySwordVFXDuration','legacy_sword_vfx_duration_ms','旧剑光表现持续（毫秒）',{scale:1000});
  const parts=requireCalc(x,'TotalDamage').mFormulaParts;
  if(parts?.[0]?.mDataValue!=='BaseDamage'||parts?.[1]?.mStat!==2||parts?.[1]?.mStatFormula!==2||parts?.[1]?.mDataValue!=='ADRatio')throw Error('易E伤害树字段不符');
  x.c.proofs.push({source:'mSpellCalculations.TotalDamage.mFormulaParts[1]',raw:parts[1],semantic:'mStat=2/mStatFormula=2按既有已核对映射为额外攻击力；没有套用省略枚举'});
  formula(x,'on_hit_true_damage','无极剑道普通攻击附加真实伤害',add(pn('base_damage'),mul(pn('bonus_ad_ratio'),attr('attack_damage','SOURCE','BONUS'))),'当前TotalDamage=BaseDamage+0.35×额外攻击力；只作为普通攻击附加真实伤害保存。');
  damagePending(x,'on_hit_true_damage','无极剑道普通攻击附加真实伤害','on_hit_true_damage','real',{delivery:'BASIC_ATTACK',block:null,description:'独立普通攻击附加真实伤害；E施放本身不造成命中，实际攻击事件另行消费。'});
  pending(x,'无极剑道持续与普通攻击消费','效果持续5秒，真实普通攻击才消费附加伤害；当前候选不把施放事件当攻击命中，也未把附加伤害重复叠加到Q命中。');
  pending(x,'E持续时长暂停','官方明确阿尔法突袭和冥想期间暂停E持续时间；暂停/恢复属于跨技能时钟状态，未用普通刷新或重新施放替代。');
  exclude(x,'旧剑光表现时长','LegacySwordVFXDuration只记录表现用时长，不作为伤害或增益生命周期。');
}

// R：攻速/移速自益可独立保存；减速免疫、击杀延长与普通技能冷却返还留待状态事件。
{
  const x=begin('masteryi_r');
  common(x,{cast:true});
  data(x,'RDuration','duration_ms','高原血统持续时间（毫秒）',{scale:1000});
  data(x,'RASBonus','attack_speed_ratio','高原血统额外攻击速度比例',{scale:.01});
  data(x,'RMSBonus','move_speed_ratio','高原血统额外移动速度比例',{scale:.01});
  data(x,'RKillAssistExtension','kill_assist_extension_ms','参与击杀延长持续时间（毫秒）',{scale:1000});
  data(x,'RCooldownRefund','basic_cooldown_refund_ratio','参与击杀后普通技能冷却减少比例');
  statEffect(x,'attack_speed','高原血统额外攻击速度',val('attack_speed_ratio'),'bonus_attack_speed_percent',{duration:val('duration_ms'),description:'仅在高原血统实际激活期间提供额外攻速；击杀延长和Q/W/E暂停另行接线。'});
  statEffect(x,'move_speed','高原血统额外移动速度',val('move_speed_ratio'),'move_speed_percent',{duration:val('duration_ms'),description:'仅在高原血统实际激活期间提供额外移速；不把空间位移当作该属性。'});
  effect(x,'basic_cooldown_refund','参与击杀后普通技能冷却减少',[result('refund','减少普通技能冷却','COOLDOWN_CHANGE','SOURCE',val('basic_cooldown_refund_ratio'),{affectedSkillScope:{mode:'SKILLS',skillKeys:['masteryi_q','masteryi_w','masteryi_e'],skillCategoryKeys:[]},operation:'REDUCE'})],null,'仅在高原血统期间参与击杀真实英雄事件后消费；候选不由任意KILL自动触发。');
  pending(x,'减速免疫','官方明确主动期间免疫减速；当前控制/免疫结果类型和来源位置条件待系统核对，不能以移速属性变化代替。','系统');
  pending(x,'参与击杀延长R与普通技能冷却返还','参与击杀会延长R持续7秒并减少Q/W/E剩余冷却70%；需要真实击杀归因、激活窗口、剩余冷却快照和与W/E暂停的时序，当前只保留参数及独立冷却效果。');
  pending(x,'R期间暂停与W/E联动','官方扩展明确Q和W期间暂停R持续时间；与E持续暂停共享时钟规则，未构造无条件延长或刷新。');
}
