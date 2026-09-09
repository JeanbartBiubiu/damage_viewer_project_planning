import {
  plan,
  formula,
  common,
  pending,
  exclude,
  excludeData,
  markCalc,
  sourceProof,
  resourceEffect,
  finish
} from './候选.mjs';
import {
  start as makeStart,
  datum,
  fixed,
  input,
  curve,
  attr,
  op
} from './计算树候选.mjs';

const instances = [];
function start(key) {
  const x = makeStart(key);
  instances.push(x);
  return x;
}

const add = (...xs) => xs.reduce((a, b) => op('ADD', a, b));
const mul = (a, b) => op('MULTIPLY', a, b);
const min = (a, b) => op('MIN', a, b);
const max = (a, b) => op('MAX', a, b);
const p = key => ({ nodeType: 'PARAMETER', parameterKey: key });
const ap = () => attr('ability_power', 'SOURCE', 'TOTAL');
const bonusAd = () => attr('attack_damage', 'SOURCE', 'BONUS');
const totalAd = () => attr('attack_damage', 'SOURCE', 'TOTAL');
const constant = (x, key, name, value, why, source) => onceFixed(x, key, name, value, why, source);

function onceFixed(x, key, name, value, why, source) {
  if (!x.c.write.parameters.some(v => v.parameterKey === key)) fixed(x, key, name, value, why, source);
  return p(key);
}

plan.meta.scope = '玛尔扎哈、艾尼维亚、丽桑卓、卡尔萨斯各 P/Q/W/E/R；共20个技能位。保留可独立核验的本技能数值、混合技能自身收益、单一敌人分支、非英雄前置进度和法力依赖；独立召唤物、完整变形、独立冰奴、纯冰墙及死亡灵体路径按本批范围排除。';
plan.meta.unitPolicy = '数值单位以当前正文和计算树为准：文本写“*100”或百分号的字段保留来源比例或百分数点，正文/树没有比例换算时不凭字段名加减0.01；秒字段仅在绑定到毫秒参数时乘1000。角色等级断点与插值不猜补，未知实际值使用RUNTIME_INPUT且无默认值。';
plan.meta.attributeBoundary = '法强和攻击力仅按当前同版本计算树的窄口径留候选；省略统计选择器的具名节点保留来源待核。玛尔扎哈R的最大生命比例节点不擅自绑定hp，丽桑卓R缺失生命治疗输入由实际运行输入提供，不借字段名补所有者或枚举。';

// 玛尔扎哈
{
  const x = start('malzahar_p');
  datum(x, 'DRPercent', 'damage_reduction_percent', '伤害减免百分数点', { unit: '%；正文直接显示 @DRPercent@%，保留90，不再乘0.01' });
  datum(x, 'LingerDuration', 'damage_reduction_linger_ms', '受击后减伤持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  curve(x, 'shield_cooldown_seconds', '被动护盾冷却（秒，实际等级值外供）', x.p.mSpellCalculations.ShieldCooldown.mFormulaParts[0], 'mSpellCalculations.ShieldCooldown.mFormulaParts[0]', '原树只有角色等级断点，当前没有把等级曲线猜展开为固定1至18级。');
  exclude(x, '独立虚空护盾触发与重置过程', '被动触发条件、受击重置和护盾完整状态过程依赖事件；保留减伤值、持续和冷却原树，不造触发过程。');
  pending(x, '虚空护盾实际事件', '正文说明受伤会使冷却重新开始且小兵伤害不减伤也不触发；事件来源、同一命中重置时点和护盾状态待运行时接线。', '系统');
}
{
  const x = start('malzahar_q');
  common(x);
  const base = datum(x, 'BaseDamage', 'base_damage', '基础魔法伤害');
  datum(x, 'SilenceDuration', 'silence_duration_ms', '沉默持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  excludeData(x, 'DelayPostCast', '当前中文绑定文本和候选计算树没有消费该字段；仅留原始证据，不按字段名补命中时点。');
  // 公式系数来自 TotalDamageTooltip.mFormulaParts[1]；固定系数直接写入树，不建立无意义的中转参数。
  const ratio = constant(x, 'ap_ratio_constant', '法强倍率', 0.55, 'TotalDamageTooltip树直接给出0.55；固定系数进入公式。', 'mSpellCalculations.TotalDamageTooltip.mFormulaParts[1]');
  formula(x, 'damage', '虚空召唤魔法伤害', add(p('base_damage'), mul(ratio, ap())), 'TotalDamageTooltip = BaseDamage + 0.55×法强；当前树的StatByCoefficient无独立运行输入。');
  markCalc(x, 'TotalDamageTooltip', '保留基础伤害与0.55法强计算树；法强映射为当前版本窄口径。');
  pending(x, '虚空召唤命中与沉默范围', '直线命中、范围内目标筛选和沉默时点未接事件；只保留本技能的数学量。', '系统');
}
{
  const x = start('malzahar_w');
  common(x);
  const stackCap = datum(x, 'StackCap', 'stack_cap', '虚灵层数上限');
  datum(x, 'VoidlingDuration', 'voidling_duration_ms', '虚灵存续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  const voidlingBase = datum(x, 'VoidlingBaseDamage', 'voidling_base_damage', '虚灵每次攻击基础伤害');
  datum(x, 'LaneMinionMod', 'lane_minion_ratio', '对线小兵伤害比例', { unit: '正文为 @LaneMinionMod*100@%，保留原始比例3，不再乘0.01' });
  datum(x, 'EpicMonsterMod', 'epic_monster_ratio', '史诗野怪伤害比例', { unit: '正文为 @EpicMonsterMod*100@%，保留原始比例0.5，不再乘0.01' });
  const adRatio = datum(x, 'ADRatio', 'bonus_ad_ratio', '虚灵额外攻击力倍率');
  const apRatio = datum(x, 'APRatio', 'ap_ratio', '虚灵法强倍率');
  excludeData(x, 'SummonDelay', '当前绑定正文没有该字段占位，也没有独立命中消费；仅留原始证据。');
  excludeData(x, 'StackDuration', '当前绑定正文没有层持续占位，技能树也未消费该字段；仅留原始证据。');
  excludeData(x, 'MaxStacks', '当前正文使用StackCap；旧MaxStacks字段不作为现行能力证据。');
  const levelScaling = curve(x, 'voidling_level_scaling', '虚灵等级成长项（实际值外供）', x.p.mSpellCalculations['{c2505620}'].mFormulaParts[0], 'mSpellCalculations.{c2505620}.mFormulaParts[0]', '原树为角色等级插值5至64.5；未知等级算法不插值展开。');
  const hit = add(voidlingBase, levelScaling, mul(adRatio, bonusAd()), mul(apRatio, ap()));
  formula(x, 'voidling_hit_damage', '虚灵每次攻击伤害', hit, 'VoidlingBonusDamageTooltip = VoidlingBaseDamage + 等级成长项 + ADRatio×额外攻击力 + APRatio×法强；mStat=2、mStatFormula=2的攻击力映射已按同版本窄口径保留。');
  markCalc(x, 'VoidlingBonusDamageTooltip', '保留完整虚灵攻击树；省略mStat的AP节点只按本版本同名树窄口径映射法强。');
  sourceProof(x, 'mSpellCalculations.VoidlingBonusDamageTooltip.mFormulaParts[2]', x.p.mSpellCalculations.VoidlingBonusDamageTooltip.mFormulaParts[2], 'mStat=2且mStatFormula=2，保留为SOURCE/BONUS攻击力的窄口径证据。');
  sourceProof(x, 'mSpellCalculations.VoidlingBonusDamageTooltip.mFormulaParts[3]', x.p.mSpellCalculations.VoidlingBonusDamageTooltip.mFormulaParts[3], '节点省略统计选择器；与本版本同技能文本绑定APRatio的窄口径映射，仍留来源待运行核。');
  const actualStacks = input(x, 'actual_stack_count', '本次主动施放实际虚灵层数', '必须由本来源当次施放提供；先封顶到0至StackCap，不默认满层。', 'INTEGER');
  const zero = onceFixed(x, 'zero', '零', 0, '层数下限；用于明确上限和下限进入公式。', '候选约束');
  const one = onceFixed(x, 'one', '一', 1, '主动施放基础虚灵数量；来自正文“召唤1只”。', '官方中文说明');
  const capped = min(max(actualStacks, zero), stackCap);
  formula(x, 'capped_stack_count', '封顶后的虚灵层数', capped, '实际层数按MAX(实际值,0)再MIN(StackCap,结果)；越界输入不继续外推。');
  formula(x, 'summon_count', '主动施放虚灵数量', add(one, capped), '正文“召唤1只，每层再增加1只”；上限StackCap明确进入最终数量公式。');
  exclude(x, '独立虚灵实体、攻击过程和召唤物生命周期', '本批不创建独立召唤物实体、周期攻击或触发规则；保留混合技能自身层数上限、数量公式和每次攻击数学量。');
  pending(x, '虚灵实际召唤与攻击事件', '虚灵是独立召唤物，数量消费、生命周期、攻击频率和目标选择按用户范围后置；当前候选不凭周期字段制造伤害。', '系统');
}
{
  const x = start('malzahar_e');
  common(x);
  const base = datum(x, 'BaseDamage', 'base_damage', '基础魔法伤害');
  datum(x, 'Duration', 'duration_ms', '感染持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  excludeData(x, 'SecondsPerTick', '当前正文只消费总持续和总伤害；不将节拍字段改造成周期伤害。');
  excludeData(x, 'UnnamedEffectAmount2', '根字段没有有效值，也没有现行中文绑定。');
  const ratio = constant(x, 'ap_ratio_constant', '法强倍率', 0.8, 'TotalDamage树直接给出0.8；固定系数进入公式。', 'mSpellCalculations.TotalDamage.mFormulaParts[1]');
  formula(x, 'damage', '虚空先知持续总魔法伤害', add(base, mul(ratio, ap())), 'TotalDamage = BaseDamage + 0.8×法强；当前候选保存总量关系，不创建瞬时或周期伤害。');
  markCalc(x, 'TotalDamage', '保留E总伤害计算树与0.8法强系数。');
  markCalc(x, 'ManaRestore', 'AbilityResourceByCoefficientCalculationPart当前无可绑定资源输入；留原树和待核，不生成间接运行输入公式。');
  curve(x, 'minion_execute_threshold', '小兵处决阈值（实际等级值外供）', x.p.mSpellCalculations.MinionExecuteThreshold.mFormulaParts[0], 'mSpellCalculations.MinionExecuteThreshold.mFormulaParts[0]', '原树有等级1值、每级初始增量和12级断点；未知算法不展开。');
  pending(x, '感染传播、刷新和击杀回蓝', 'Q/R刷新、目标死亡传播和小兵处决属于真实事件；ManaRestore树只有资源系数且缺当前资源输入，保留资源依赖与来源待核。', '系统');
}
{
  const x = start('malzahar_r');
  common(x);
  const beamBase = datum(x, 'BeamDamage', 'beam_base_damage', '压制光束基础伤害');
  const beamRatio = datum(x, 'BeamAPRatio', 'beam_ap_ratio', '压制光束法强倍率');
  excludeData(x, 'BeamDamageTicks', '当前正文只显示总伤害占位，候选不把次数字段变成周期结果。');
  excludeData(x, 'SuppressDuration', '当前绑定正文使用CCDuration；SuppressionDuration只作原始留证，避免Q/R字段残留误绑。');
  excludeData(x, 'NeutralMonsterDamageCap', '当前正文无史诗野怪数值绑定，单一英雄范围不使用该字段。');
  const poolDuration = datum(x, 'PoolDuration', 'pool_duration_ms', '虚空区域持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  excludeData(x, 'ZoneDuration', '当前正文使用PoolDuration；ZoneDuration只作原始留证。');
  const maxHealthDamage = datum(x, 'MaxHealthDamage', 'max_health_damage_percent', '区域最大生命伤害百分数点', { unit: '正文/树以百分数显示，保留原始1至7，不乘0.01' });
  const maxHealthRatio = datum(x, 'MaxHealthRatio', 'max_health_ratio', '区域最大生命法强倍率', { unit: '原始0.005比例；不按字段名再乘0.01；目标最大生命所有者仍待核' });
  excludeData(x, 'BeamTetherRange', '当前中文绑定没有距离占位；只留根字段。');
  const ccDuration = datum(x, 'CCDuration', 'cc_duration_ms', '压制持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  const beam = add(beamBase, mul(beamRatio, ap()));
  formula(x, 'beam_damage', '压制光束魔法伤害', beam, 'TotalDamageTooltip = BeamDamage + BeamAPRatio×法强；同版本具名树窄口径映射法强。');
  markCalc(x, 'TotalDamageTooltip', '保留压制光束总伤害树。');
  const zonePart = add(maxHealthDamage, mul(maxHealthRatio, ap()));
  const zoneMultiplier = constant(x, 'zone_multiplier', '区域计算乘数', 0.05, 'ZoneDamageTooltip树明确给出0.05乘数。', 'mSpellCalculations.ZoneDamageTooltip.mMultiplier');
  formula(x, 'zone_damage_ratio', '虚空区域最大生命伤害比例', mul(zoneMultiplier, zonePart), 'ZoneDamageTooltip = 0.05×(MaxHealthDamage + MaxHealthRatio×法强)；MaxHealthRatio节点未提供mStat，不擅自绑定目标hp或所有者。');
  markCalc(x, 'ZoneDamageTooltip', '保留区域乘数0.05和最大生命数值原树；最大生命属性口径待核。');
  pending(x, '压制与区域实际伤害时点', 'R的压制、区域重叠和中断位移需要事件与周期时点；不以BeamDamageTicks或PoolDuration制造瞬时/周期伤害效果。', '系统');
}

// 艾尼维亚
{
  const x = start('anivia_p');
  datum(x, 'Cooldown', 'egg_cooldown_ms', '被动重生冷却（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  const resists = curve(x, 'bonus_resists', '蛋形态额外双抗（实际等级值外供）', x.p.mSpellCalculations.BonusResists.mFormulaParts[0], 'mSpellCalculations.BonusResists.mFormulaParts[0]', '原树从-40并带5/8/12/15级断点；未知等级算法不展开。');
  const minusOne = onceFixed(x, 'minus_one', '负一', -1, 'BonusResistsTooltip原树的固定乘数。', 'mSpellCalculations.BonusResistsTooltip.mMultiplier');
  formula(x, 'bonus_resists_display', '蛋形态双抗显示值', mul(minusOne, resists), 'BonusResistsTooltip为-1×BonusResists；保留内部树关系，不把负号改成属性枚举。');
  markCalc(x, 'BonusResistsTooltip', '保留修改树-1×BonusResists。');
  // 中文说明明确“存活6秒后复活”，保留静态时长，但不创建完整变形过程。
  onceFixed(x, 'revive_survival_ms', '蛋形态复活等待（毫秒）', 6000, '官方中文说明明确存活6秒后复活。', 'official.passive.description');
  exclude(x, '完整蛋形态变形、复活、受击与目标选择', '完整变形按本批范围后置；保留冷却、双抗原树和6秒静态进度，供后续运行时接线。');
  pending(x, '蛋形态真实复活结果', '致死转蛋、蛋形态生命值、受击事件和复活资格未接；不将被动名称当作完整状态能力。', '系统');
}
{
  const x = start('anivia_q');
  common(x);
  const passBase = datum(x, 'PassthroughBaseDamage', 'passthrough_base_damage', '穿行基础魔法伤害');
  const explosionBase = datum(x, 'ExplosionBaseDamage', 'explosion_base_damage', '爆炸基础魔法伤害');
  datum(x, 'StunDuration', 'stun_duration_ms', '爆炸眩晕持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  datum(x, 'SlowDuration', 'slow_duration_ms', '穿行减速持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  const passRatio = constant(x, 'passthrough_ap_ratio', '穿行法强倍率', 0.25, 'TotalPassthroughDamage树直接给出0.25。', 'mSpellCalculations.TotalPassthroughDamage.mFormulaParts[1]');
  const explosionRatio = constant(x, 'explosion_ap_ratio', '爆炸法强倍率', 0.45, 'TotalExplosionDamage树直接给出0.45。', 'mSpellCalculations.TotalExplosionDamage.mFormulaParts[1]');
  formula(x, 'passthrough_damage', '寒冰闪耀穿行伤害', add(passBase, mul(passRatio, ap())), 'TotalPassthroughDamage = PassthroughBaseDamage + 0.25×法强。');
  formula(x, 'explosion_damage', '寒冰闪耀爆炸伤害', add(explosionBase, mul(explosionRatio, ap())), 'TotalExplosionDamage = ExplosionBaseDamage + 0.45×法强。');
  markCalc(x, 'TotalPassthroughDamage', '保留穿行伤害树。');
  markCalc(x, 'TotalExplosionDamage', '保留爆炸伤害树。');
  pending(x, '飞行路径、重施放、眩晕与冰冻条件', 'Q可重施放引爆，穿行与爆炸是不同命中时点；减速百分比来自R的共享文本占位，实际状态和命中事件待接。', '系统');
}
{
  const x = start('anivia_w');
  common(x);
  datum(x, 'WallDuration', 'wall_duration_ms', '冰墙持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  datum(x, 'WallWidth', 'wall_width', '冰墙宽度');
  excludeData(x, 'WallChunks', '当前正文不消费分段数量；纯冰墙路径按范围排除。');
  excludeData(x, 'ChampPushDistance', '当前正文不消费英雄推动距离；纯冰墙路径按范围排除。');
  excludeData(x, 'NonChampPushDistance', '当前正文不消费非英雄推动距离；纯冰墙路径按范围排除。');
  exclude(x, '纯冰墙空间、阻挡、推动与消失过程', '按本批范围排除独立冰墙路径；保留技能自身冷却、法力、宽度和持续这类候选值。');
  pending(x, '冰墙空间接线', '阻挡与推动需要地图空间和对象类别；本候选不以WallChunks或距离字段造过程。', '系统');
}
{
  const x = start('anivia_e');
  common(x);
  const base = datum(x, 'BaseDamage', 'base_damage', '基础魔法伤害');
  const ratio = constant(x, 'ap_ratio_constant', '法强倍率', 0.55, 'TotalDamage树直接给出0.55。', 'mSpellCalculations.TotalDamage.mFormulaParts[1]');
  const normal = add(base, mul(ratio, ap()));
  formula(x, 'damage', '寒霜之触魔法伤害', normal, 'TotalDamage = BaseDamage + 0.55×法强。');
  const empoweredMultiplier = constant(x, 'empowered_multiplier', '强化伤害倍率', 2, 'EmpoweredDamage修改树明确为2倍。', 'mSpellCalculations.EmpoweredDamage.mMultiplier');
  formula(x, 'empowered_damage', '冰冻目标强化魔法伤害', mul(empoweredMultiplier, normal), 'EmpoweredDamage为2×TotalDamage；只保留混合技能自身收益，不创建冰冻状态来源。');
  markCalc(x, 'TotalDamage', '保留普通E伤害树。');
  markCalc(x, 'EmpoweredDamage', '保留2倍强化修改树。');
  pending(x, '冰冻资格与强化消费', '强化伤害依赖目标是否处于冰冻状态；该资格来源和命中顺序未接，不能默认每次E都按2倍。', '系统');
}
{
  const x = start('anivia_r');
  common(x);
  const dpsBase = datum(x, 'DamagePerSecond', 'damage_per_second_base', '风暴每秒基础魔法伤害');
  datum(x, 'ManaCostPerSecond', 'mana_cost_per_second', '风暴每秒法力消耗');
  datum(x, 'SlowAmount', 'slow_amount_percent', '风暴减速百分数点', { unit: '正文写@SlowAmount@%，保留20/30/40等百分数点，不乘0.01' });
  datum(x, 'GrowthTime', 'growth_time_ms', '风暴成形时间（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  const extraSlow = datum(x, 'AdditionalSlowPercentAtMax', 'additional_slow_ratio_at_max', '完全成形额外减速比例', { unit: '原始0.5比例；树为加1后乘减速' });
  datum(x, 'SlowPercentEmpoweredTT', 'empowered_slow_percent', '完全成形减速显示百分数点', { unit: '正文写百分号，保留来源百分数点' });
  excludeData(x, 'BonusMultiplier', '当前正文和计算树没有消费；不因字段名生成300倍伤害。');
  excludeData(x, 'TickRate', '当前候选不创建周期伤害；仅留节拍字段。');
  excludeData(x, 'ChillDuration', '当前中文绑定没有独立数值占位；冰冻资格待事件。');
  excludeData(x, 'SlowDurationAtMaxMultiplier', '当前树使用AdditionalSlowPercentAtMax+1，避免把另一字段当作现行算法。');
  excludeData(x, 'LeashWarning', '空间离开警告未消费。');
  excludeData(x, 'LeashBreak', '空间离开中止未消费。');
  excludeData(x, 'MinCooldown', '当前正文和候选树无消费；不把0/1字段当冷却能力。');
  const dpsRatio = constant(x, 'ap_ratio_constant', '每秒法强倍率', 0.125, 'TotalDamagePerSecond树直接给出0.125。', 'mSpellCalculations.TotalDamagePerSecond.mFormulaParts[1]');
  const dps = add(dpsBase, mul(dpsRatio, ap()));
  formula(x, 'damage_per_second', '冰风暴每秒魔法伤害', dps, 'TotalDamagePerSecond = DamagePerSecond + 0.125×法强；保存每秒量，不创建周期效果。');
  const one = constant(x, 'one', '一', 1, 'EnhancedSlow树中的固定加1。', 'mSpellCalculations.EnhancedSlow.mMultiplier');
  formula(x, 'enhanced_slow', '完全成形减速比例', mul(p('slow_amount_percent'), add(extraSlow, one)), 'EnhancedSlow = SlowAmount×(AdditionalSlowPercentAtMax+1)；原始减速字段是正文百分数点，比例加成为0.5。');
  const empoweredDpsMultiplier = constant(x, 'empowered_dps_multiplier', '完全成形伤害倍率', 3, 'EmpoweredDamagePerSecondTooltipOnly修改树明确为3倍。', 'mSpellCalculations.EmpoweredDamagePerSecondTooltipOnly.mMultiplier');
  formula(x, 'empowered_damage_per_second', '完全成形每秒魔法伤害', mul(empoweredDpsMultiplier, dps), 'EmpoweredDamagePerSecondTooltipOnly为3×TotalDamagePerSecond；不创建周期伤害。');
  markCalc(x, 'TotalDamagePerSecond', '保留风暴每秒伤害树。');
  markCalc(x, 'EnhancedSlow', '保留完全成形减速修改树。');
  markCalc(x, 'EmpoweredDamagePerSecondTooltipOnly', '保留3倍完全成形伤害修改树。');
  pending(x, '风暴成长、减速、离开区域和每秒节拍', '保留每秒数值与每秒法力依赖；实际半秒节拍、成长状态、冰冻资格和离开区域事件待运行时接线，不造周期伤害。', '系统');
}

// 丽桑卓
{
  const x = start('lissandra_p');
  const move = datum(x, 'MoveSpeedMod', 'ice_servant_slow_ratio', '冰奴减速比例', { unit: '正文为@MoveSpeedMod*-100@%，保留-0.25，不乘0.01' });
  datum(x, 'ExplosionDelay', 'ice_servant_explosion_delay_ms', '冰奴爆炸等待（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  excludeData(x, 'Range', '独立冰奴范围检测按本批范围排除。');
  excludeData(x, 'Radius', '独立冰奴爆炸范围按本批范围排除。');
  const base = curve(x, 'ice_servant_base_damage', '冰奴爆炸基础伤害（等级值外供）', x.p.mSpellCalculations.TotalDamage.mFormulaParts[0], 'mSpellCalculations.TotalDamage.mFormulaParts[0]', '原树有1至6级每级增长与13级后断点；未知等级算法不展开。');
  const ratio = constant(x, 'ap_ratio_constant', '法强倍率', 0.5, 'TotalDamage树直接给出0.5。', 'mSpellCalculations.TotalDamage.mFormulaParts[1]');
  const damage = add(base, mul(ratio, ap()));
  formula(x, 'ice_servant_damage', '冰奴爆炸魔法伤害', damage, 'TotalDamage = 等级基础项 + 0.5×法强；独立冰奴实体与触发按范围排除，混合技能伤害数值保留。');
  markCalc(x, 'TotalDamage', '保留冰奴爆炸原树与0.5法强系数。');
  exclude(x, '独立冰封奴仆实体、死亡触发和范围搜索', '独立冰奴属于本批范围外；保留其混合技能自身减速、延迟和伤害数值。');
  pending(x, '冰奴来源和实际爆炸', '附近敌人死亡才生成，4秒后爆炸；真实死亡归因、目标范围和爆炸事件待接，不把静态延迟写成周期伤害。', '系统');
}
{
  const x = start('lissandra_q');
  common(x);
  const damageBase = datum(x, 'damage', 'base_damage', '寒冰碎片基础魔法伤害');
  datum(x, 'slowDuration', 'slow_duration_ms', '减速持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  datum(x, 'slowPercentage', 'slow_ratio', '减速比例', { unit: '正文为@slowPercentage*-100@%，保留负比例，不乘0.01' });
  excludeData(x, 'SlowDuration', '与slowDuration重复且当前正文使用小写字段；保留来源不重复建参数。');
  excludeData(x, 'SlowPercentage', '与slowPercentage重复且当前正文使用小写字段；保留来源不重复建参数。');
  const ratio = constant(x, 'ap_ratio_constant', '法强倍率', 0.75, 'TotalDamage树直接给出0.75。', 'mSpellCalculations.TotalDamage.mFormulaParts[1]');
  formula(x, 'damage', '寒冰碎片魔法伤害', add(damageBase, mul(ratio, ap())), 'TotalDamage = damage + 0.75×法强。');
  markCalc(x, 'TotalDamage', '保留Q伤害树。');
  pending(x, '首个目标后方碎片和实际减速', 'Q命中首个目标后向后方扩散；单一敌人保留自身伤害和减速，路径与穿透对象事件待接。', '系统');
}
{
  const x = start('lissandra_w');
  common(x);
  const base = datum(x, 'BaseDamage', 'base_damage', '冰脉驱役基础魔法伤害');
  datum(x, 'SnareDuration', 'snare_duration_ms', '禁锢持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  excludeData(x, 'TargetsToHit', '当前单一目标正文和计算树没有消费命中对象上限。');
  excludeData(x, 'FreeCastCD', '当前正文没有独立占位，且不是现行基础冷却字段。');
  const ratio = constant(x, 'ap_ratio_constant', '法强倍率', 0.7, 'TotalDamage树直接给出0.7。', 'mSpellCalculations.TotalDamage.mFormulaParts[1]');
  formula(x, 'damage', '冰脉驱役魔法伤害', add(base, mul(ratio, ap())), 'TotalDamage = BaseDamage + 0.7×法强。');
  markCalc(x, 'TotalDamage', '保留W伤害树。');
  pending(x, '范围束缚和合法命中', 'W为自身周围范围技能；单一敌人伤害、禁锢数值保留，范围命中与状态时点待接。', '系统');
}
{
  const x = start('lissandra_e');
  common(x);
  const base = datum(x, 'BaseDamage', 'base_damage', '冰川之径基础魔法伤害');
  const ratio = constant(x, 'ap_ratio_constant', '法强倍率', 0.6, 'TotalDamage树直接给出0.6。', 'mSpellCalculations.TotalDamage.mFormulaParts[1]');
  formula(x, 'damage', '冰川之径魔法伤害', add(base, mul(ratio, ap())), 'TotalDamage = BaseDamage + 0.6×法强。');
  markCalc(x, 'TotalDamage', '保留E伤害树。');
  pending(x, '根字段与官方冷却差异及重施放传送', '当前根冷却字段与官方逐级冷却不一致，候选保留官方基础值并留差异；传送重施放和路径状态待接。', '来源');
  pending(x, '冰川之径实际命中', 'E的路径伤害和重施放传送是不同阶段；单一敌人数值保留，不把传送过程当命中。', '系统');
}
{
  const x = start('lissandra_r');
  common(x);
  const apRatio = datum(x, 'APRatio', 'ap_ratio', '冰封陵墓法强倍率');
  const base = datum(x, 'BaseDamage', 'base_damage', '冰封陵墓基础魔法伤害');
  datum(x, 'SlowAmount', 'slow_ratio', '区域减速比例', { unit: '正文为@SlowAmount*-100@%，保留负比例，不乘0.01' });
  datum(x, 'SlowDuration', 'slow_duration_ms', '区域减速持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  datum(x, 'EnemyCastDuration', 'enemy_stun_duration_ms', '对敌人眩晕持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  datum(x, 'SelfCastDuration', 'self_stasis_duration_ms', '自身凝滞持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  datum(x, 'SelfCastFlatHeal', 'self_heal_flat', '自身施放基础治疗');
  datum(x, 'SelfCastMissingHPRatio', 'self_heal_missing_hp_percent', '每缺失生命提升治疗百分数点', { unit: '正文写百分号，保留1，不乘0.01' });
  datum(x, 'SelfCastMissingHPPerAbove', 'self_heal_missing_hp_per_above_percent', '每段缺失生命百分数点', { unit: '正文写百分号，保留1，不乘0.01' });
  excludeData(x, 'StartingAoESize', '当前中文绑定没有尺寸占位；不将其当范围命中证明。');
  const missingHpRatio = datum(x, 'PercentMissingHPRatio', 'missing_hp_ratio', '缺失生命治疗倍率', { unit: '原始0.55比例；节点未提供属性选择器，实际缺失生命由运行输入提供' });
  const damage = add(base, mul(apRatio, ap()));
  formula(x, 'damage', '冰封陵墓对敌魔法伤害', damage, 'CalculatedDamage = BaseDamage + APRatio×法强；省略统计选择器的具名节点按当前版本窄口径映射法强。');
  const missingHealth = input(x, 'actual_missing_health', '施放时实际缺失生命', '必须由自身施放瞬间提供；原树未给属性所有者和枚举，不设置默认值。');
  formula(x, 'self_heal', '自身施放治疗量', add({ nodeType: 'PARAMETER', parameterKey: 'self_heal_flat' }, mul(missingHealth, missingHpRatio)), 'HealAmount = SelfCastFlatHeal + 实际缺失生命×PercentMissingHPRatio；实际输入直接进入公式。');
  markCalc(x, 'CalculatedDamage', '保留R对敌伤害树。');
  markCalc(x, 'HealAmount', '保留R治疗树；缺失生命属性所有者未在原节点给出，改为显式运行输入。');
  sourceProof(x, 'mSpellCalculations.CalculatedDamage.mFormulaParts[1]', x.p.mSpellCalculations.CalculatedDamage.mFormulaParts[1], '具名APRatio节点省略统计选择器；仅留当前版本法强窄口径映射。');
  sourceProof(x, 'mSpellCalculations.HealAmount.mFormulaParts[1]', x.p.mSpellCalculations.HealAmount.mFormulaParts[1], '具名PercentMissingHPRatio节点省略统计选择器；不据字段名绑定hp或所有者。');
  pending(x, '敌方眩晕、自身凝滞、区域减速和位移中断', '目标分支、重施放、自身施放资格、区域范围和中断时点待接；保留混合技能伤害、治疗数值与资源依赖。', '系统');
}

// 卡尔萨斯
{
  const x = start('karthus_p');
  datum(x, 'PassiveDuration', 'death_recast_window_ms', '死亡后施法窗口（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  exclude(x, '死亡灵体完整变形、免费施法和资源过程', '完整变形按本批范围后置；保留正文明确的7秒窗口，等待独立死亡状态与施法资格接线。');
  pending(x, '死亡后免费施法事件', '死亡、技能继续可用、法力消耗豁免和窗口结束均依赖完整变形状态；本批不造过程或触发。', '系统');
}
{
  const x = start('karthus_q');
  common(x, { cooldown: false, mana: true, cast: true });
  const base = datum(x, 'BaseDamage', 'base_damage', '荒芜基础魔法伤害');
  const apRatio = datum(x, 'APRatio', 'ap_ratio', '荒芜法强倍率');
  excludeData(x, 'MonsterMod', '当前中文绑定和计算树没有消费野怪倍率；单一英雄范围不绑定。');
  const qDamage = add(base, mul(apRatio, ap()));
  formula(x, 'damage', '荒芜魔法伤害', qDamage, 'QDamage = BaseDamage + APRatio×法强；保留具名AP窄口径映射。');
  const singleMultiplier = constant(x, 'single_target_multiplier', '单一目标倍率', 2, 'QSingleTargetDamage修改树明确为2倍。', 'mSpellCalculations.QSingleTargetDamage.mMultiplier');
  formula(x, 'single_target_damage', '荒芜单一敌人魔法伤害', mul(singleMultiplier, qDamage), 'QSingleTargetDamage为2×QDamage；是否只有一个敌人由实际目标数量输入决定。');
  const targetCount = input(x, 'actual_target_count', '本次荒芜命中的实际目标数量', '必须由当前命中事件提供；只有数量严格为1才能选择双倍分支，不默认单一目标。', 'INTEGER');
  formula(x, 'single_target_eligibility_lower_bound', '单一目标下限约束', max(targetCount, onceFixed(x, 'one', '一', 1, '目标数量至少为1。', '候选约束')), '负例约束只用于说明目标数量不能为负；实际是否唯一仍由命中事件判定。');
  markCalc(x, 'QDamage', '保留Q基础计算树。');
  markCalc(x, 'QSingleTargetDamage', '保留单一敌人2倍修改树。');
  pending(x, '单一目标判定与延迟爆发', '文本要求只有一个敌人时伤害翻倍；候选保留实际目标数量输入，但未造命中/延迟过程。');
  pending(x, 'AMMORECHARGETIME版本字段', '当前正文引用keyCooldown中的AMMORECHARGETIME，但当前计算树和DataValues没有对应消费；只留待核，不按字段名建现行能力参数。', '来源');
}
{
  const x = start('karthus_w');
  common(x);
  datum(x, 'MagicResistShred', 'magic_resist_shred_percent', '墙体魔抗削减百分数点', { unit: '正文写百分号，保留25，不乘0.01' });
  datum(x, 'TT_WallWidth', 'wall_width', '墙体宽度');
  datum(x, 'SlowPercent', 'slow_percent', '墙体减速百分数点', { unit: '正文写百分号，保留30至80等百分数点，不乘0.01' });
  datum(x, 'WallDuration', 'wall_duration_ms', '墙体持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  datum(x, 'DebuffDuration', 'debuff_duration_ms', '穿墙减益持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  pending(x, '穿墙事件、减益衰减和目标离开', 'W不是纯冰墙数值：保留魔抗削减、减速和持续，但穿越判定、减速衰减与刷新时点待接；不以墙体空间字段创建命中。', '系统');
}
{
  const x = start('karthus_e');
  common(x, { cooldown: false, mana: true, cast: true });
  const dpsBase = datum(x, 'DamagePerSecond', 'damage_per_second_base', '污染每秒基础魔法伤害');
  const apRatio = datum(x, 'APRatioPerSecond', 'ap_ratio_per_second', '污染每秒法强倍率');
  datum(x, 'ManaRestoreOnKill', 'mana_restore_on_kill', '击杀单位回复法力');
  const tick = Number(x.p.cooldownTime?.[0]);
  if (Number.isFinite(tick)) {
    onceFixed(x, 'damage_tick_interval_ms', '伤害/资源节拍（毫秒）', Math.round(tick * 1000), '当前根CooldownTime[0]为0.5秒；只留来源节拍，不生成周期效果。', 'mSpell.cooldownTime[0]');
  } else {
    pending(x, '污染节拍字段缺失', '当前根没有可用CooldownTime[0]，不补写0或猜测周期。', '来源');
  }
  const dps = add(dpsBase, mul(apRatio, ap()));
  formula(x, 'damage_per_second', '污染每秒魔法伤害', dps, 'TotalDPS = DamagePerSecond + APRatioPerSecond×法强；保留每秒量，不创建周期伤害。');
  const quarterMultiplier = constant(x, 'quarter_multiplier', '四分之一倍率', 0.25, '原树{57456bbc}明确为0.25倍。', 'mSpellCalculations.{57456bbc}.mMultiplier');
  formula(x, 'quarter_damage_per_second', '污染四分之一每秒量核对', mul(quarterMultiplier, dps), '原树{57456bbc}=0.25×TotalDPS；仅作为来源树核对，不创建瞬时伤害。');
  resourceEffect(x, 'mana_restore_on_kill', '击杀单位回复法力', 'mana_restore_on_kill', 'RESTORE', '正文明确击杀单位恢复法力；候选保留数值资源结果，但击杀事件和单位类别待接。');
  markCalc(x, 'TotalDPS', '保留污染每秒伤害树。');
  markCalc(x, '{57456bbc}', '保留四分之一修改树；不误当作另一种独立瞬时伤害。');
  pending(x, '污染光环周期与击杀回蓝事件', '实际每半秒结算、离开区域、击杀单位和资源恢复资格待运行时接线；不把tick字段变成未证实的周期效果。', '系统');
}
{
  const x = start('karthus_r');
  common(x);
  const base = datum(x, 'BaseDamage', 'base_damage', '安魂曲基础魔法伤害');
  const apRatio = datum(x, 'APRatio', 'ap_ratio', '安魂曲法强倍率');
  onceFixed(x, 'channel_duration_ms', '引导时长（毫秒）', 3000, '官方中文说明明确引导3秒后对所有敌方英雄造成伤害。', 'official.description');
  formula(x, 'damage', '安魂曲魔法伤害', add(base, mul(apRatio, ap())), 'TotalDamage = BaseDamage + APRatio×法强；全图英雄目标和引导过程待接。');
  markCalc(x, 'TotalDamage', '保留R全局伤害树。');
  pending(x, '安魂曲引导、中断和全体英雄命中', '引导3秒、全体敌方英雄、距离无关和中断资格需要运行时事件；只保留来源明确的时长、伤害和法力。', '系统');
}

for (const x of instances) finish(x);

for (const x of Object.values(plan.skills)) {
  const seen = new Set();
  for (const [kind, list] of Object.entries(x.write)) {
    for (const row of list) {
      const key = row.parameterKey ?? row.formulaKey ?? row.effectKey ?? row.processKey ?? row.stateKey ?? row.ruleKey;
      const scopedKey = key ? `${kind}:${key}` : null;
      if (scopedKey && seen.has(scopedKey)) throw Error('重复稳定键 '+x.skillKey+'/'+scopedKey);
      if (scopedKey) seen.add(scopedKey);
    }
  }
  x.status = x.pending.length ? '已准备可核数学组成；事件、等级算法和范围外分支仍待系统接线' : '已准备本轮范围组成；须独立GET确认保存';
}

console.log(JSON.stringify({skills:Object.keys(plan.skills),counts:Object.fromEntries(Object.entries(plan.skills).map(([k,v])=>[k,Object.fromEntries(Object.entries(v.write).map(([kind,list])=>[kind,list.length]))]))},null,2));
