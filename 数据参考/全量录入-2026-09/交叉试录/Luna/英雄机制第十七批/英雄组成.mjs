import {
  plan, common, data, literal, runtime, unknownCurve, formula, pending, exclude, excludeData,
  requireCalc, markCalc, sourceProof, statEffect, resourceEffect, effect, result, val, fval,
  pn, attr, op, add, sub, mul, div, min, max, life, behavior, finish
} from './候选.mjs';

const instances = [];
const start = skillKey => {
  const value = begin(skillKey);
  instances.push(value);
  return value;
};

import { begin } from './候选.mjs';

const P = key => pn(key);
const AP = () => attr('ability_power', 'SOURCE', 'TOTAL');
const sourceBonusHp = () => attr('hp', 'SOURCE', 'BONUS');
const one = (x, key = 'one') => literal(x, key, '单位倍率1', 1, '公式需要的单位倍率；不是额外机制或等级值。', '公式单位值');
const plus = (...items) => add(...items);
const times = (left, right) => mul(left, right);
const ratio = (x, key, name, value, why) => literal(x, key, name, value, why, '当前正文或计算树明确比例');
const ms = (x, source, key, name) => data(x, source, key, name, { scale: 1000, unit: '秒转毫秒' });
const pct = (x, source, key, name) => data(x, source, key, name, { scale: 0.01, unit: '百分数点转比例' });
const noteDamage = (x, key) => pending(x, '伤害结果：' + key, '只保存本技能独立数学量；没有完整命中、护盾、暴击、吸血与结果资格证据，不创建DAMAGE或自动命中。', '来源');
const noteHeal = (x, key) => pending(x, '治疗结果：' + key, '只保存本技能独立数学量；没有实际治疗时点和DIRECT_HEAL资格证据，不创建瞬时治疗结果。', '来源');

function standard(x, options = {}) {
  if (options.common !== false) common(x, options.commonOptions ?? {});
  pending(x, '施放与事件接线', '本候选只保存确定的参数、数学关系和少量自身/资源组成；实际施放、命中、状态、触发与运行输入尚未接线。');
}

function shieldEffect(x, key, name, formulaKey, durationKey, description) {
  effect(
    x,
    key,
    name,
    [result('shield', name, 'NORMAL_SHIELD', 'SOURCE', fval(formulaKey), { absorbedDamageTypeKey: null, decayMode: 'NONE' }, behavior)],
    life(P(durationKey)),
    description + '；只表达可独立定义的自身护盾，危险温度分支和实际触发尚未接线。'
  );
}

// 弗拉基米尔
{
  const x = start('vladimir_p');
  data(x, 'HPforAP', 'bonus_health_required_per_ability_power', '每1法术强度所需额外生命值');
  data(x, 'APRatioBonusHP', 'bonus_health_per_ability_power', '每1法术强度提供的额外生命值');
  const bonusHp = (() => {
    runtime(x, 'source_bonus_health_before_passive', '被动计算用额外生命值输入', '只表示被动计算前已确认的额外生命值，不能用被动自身增加的生命值回填。');
    return P('source_bonus_health_before_passive');
  })();
  const baseAp = (() => {
    runtime(x, 'source_ability_power_before_passive', '被动计算用法术强度输入', '只表示被动计算前已确认的法术强度，不能用被动自身增加的法术强度回填。');
    return P('source_ability_power_before_passive');
  })();
  formula(x, 'ability_power_from_bonus_health', '额外生命值转法术强度', div(bonusHp, P('bonus_health_required_per_ability_power')), '按正文口径计算额外生命值提供的法术强度；输入只取被动前数值，禁止递归。');
  formula(x, 'bonus_health_from_ability_power', '法术强度转额外生命值', times(baseAp, P('bonus_health_per_ability_power')), '按正文口径计算法术强度提供的额外生命值；输入只取被动前数值，禁止递归。');
  markCalc(x, 'ApproximateAPBonusAvoidingRecursion', '客户端明确提供避免自我循环的法术强度估算树；候选改用带资格输入的两条独立关系，不自动反馈。');
  markCalc(x, 'ApproximateHPBonusAvoidingRecursion', '客户端明确提供避免自我循环的生命值估算树；候选改用带资格输入的两条独立关系，不自动反馈。');
  pending(x, '额外属性归属与被动叠加', '额外生命值与法术强度的基础快照、取整和装备/效果归属仍需运行时接线；本候选不初始化或循环修正。');
  finish(x);
}
{
  const x = start('vladimir_q');
  standard(x);
  const baseDamage = data(x, 'BaseDamage', 'base_damage', '基础魔法伤害');
  const baseHeal = data(x, 'BaseHeal', 'base_heal', '基础生命回复');
  const apRatio = data(x, 'HealAPRatio', 'heal_ap_ratio', '基础治疗法强系数');
  ratio(x, 'damage_ap_ratio', '基础伤害法强系数', 0.6, '当前根BaseDamageTooltip树明确为基础伤害加0.6倍法强。');
  pct(x, 'DamagePercentAmp', 'empowered_damage_bonus_ratio', '强化伤害额外比例');
  ms(x, 'FrenzyDuration', 'empowered_window_ms', '强化下一次施放窗口（毫秒）');
  literal(x, 'q2_move_speed_duration_ms', '两次施放后的移速持续（毫秒）', 500, '当前中文正文明确该移速持续0.5秒。', '当前绑定中文正文');
  sourceProof(x, '当前绑定中文扩展正文.empowered_minion_heal_ratio', 0.3, '小兵强化治疗效能为30%属于本轮小兵治疗外支路；不生成专用参数。', { excluded: true });
  runtime(x, 'missing_health_for_empowered_heal', '强化治疗用已损失生命值输入', '当前正文只说明按已损失生命值加成；缺少运行时输入时不能默认0。');
  const missingHealth = P('missing_health_for_empowered_heal');
  const baseDamageFormula = plus(baseDamage, times(P('damage_ap_ratio'), AP()));
  formula(x, 'base_damage', '基础鲜血转换魔法伤害', baseDamageFormula, 'BaseDamageTooltip = BaseDamage + 0.6×法强；只保留数学量，不创建命中伤害结果。');
  formula(x, 'base_heal', '基础鲜血转换生命回复', plus(baseHeal, times(apRatio, AP())), 'BaseHealTooltip = BaseHeal + HealAPRatio×法强；只保留数学量，不创建瞬时治疗。');
  formula(x, 'empowered_damage', '强化鲜血转换魔法伤害', times(plus(one(x), P('empowered_damage_bonus_ratio')), baseDamageFormula), 'EmpoweredDamageTooltip = (1 + DamagePercentAmp)×基础伤害；强化资格待接线。');
  const empoweredBase = unknownCurve(
    x,
    'empowered_heal_base',
    '强化治疗固定部分',
    requireCalc(x, '{097cda4f}'),
    'mSpellCalculations.{097cda4f}',
    '客户端只给出30至200的等级插值节点；等级求值未证，实际值外供且无默认。'
  );
  ratio(x, 'empowered_missing_health_base_ratio', '强化治疗已损失生命基础比例', 0.05, 'EmpoweredHealPercent树明确为0.01×5的5%基础比例。');
  data(x, 'Empowered___HealPer100AP_0_1_', 'empowered_missing_health_per_ap_ratio', '强化治疗每点法强的已损失生命比例', { scale: 0.01, unit: '原树再次乘0.01后的比例' });
  formula(
    x,
    'empowered_heal',
    '强化鲜血转换生命回复',
    plus(empoweredBase, times(plus(P('empowered_missing_health_base_ratio'), times(P('empowered_missing_health_per_ap_ratio'), AP())), missingHealth)),
    'EmpoweredHealTooltip + EmpoweredHealPercent×已损失生命值；等级插值固定部分和运行输入均不设默认。'
  );
  runtime(x, 'q2_move_speed_percent_points', '两次施放后的移动速度百分数点', 'MovementSpeedOnQ2为角色等级断点节点；候选不猜等级曲线，外供原始显示百分数点。');
  markCalc(x, 'BaseDamageTooltip', '基础伤害树已在候选中内联。');
  markCalc(x, 'BaseHealTooltip', '基础治疗树已在候选中内联。');
  markCalc(x, 'EmpoweredDamageTooltip', '强化伤害树已在候选中内联。');
  markCalc(x, 'EmpoweredHealPercentTooltip', '强化治疗比例树已在候选中内联。');
  markCalc(x, 'EmpoweredHealTooltip', '强化治疗固定等级节点保留为无默认外供值。');
  markCalc(x, 'MovementSpeedOnQ2', '两次施放后的移速等级断点只留来源和外供输入。');
  noteDamage(x, 'base_damage');
  noteDamage(x, 'empowered_damage');
  noteHeal(x, 'base_heal');
  noteHeal(x, 'empowered_heal');
  pending(x, '强化资格与目标选择', '资源槽充满、两次施放计数、下一次强化、单一目标和小兵效能分支尚未接线；不自动触发强化或治疗。', '系统');
  finish(x);
}
{
  const x = start('vladimir_w');
  standard(x);
  const baseDamage = data(x, 'BaseDamage', 'base_damage', '血池每次伤害基础值');
  const hpRatio = data(x, 'BonusHealthRatio', 'bonus_health_ratio', '额外生命值伤害系数');
  excludeData(x, 'MinionHealingMod', '小兵治疗效能比例属于本轮范围外支路；本候选只保留正常单一敌人回复数学。');
  data(x, 'HealthCost', 'health_cost_ratio', '当前生命值消耗比例');
  data(x, 'MoveSpeedMod', 'enemy_slow_ratio', '血池内敌方减速比例', { scale: -1, unit: '负减速修正转为正比例' });
  data(x, 'VampPercent', 'vamp_ratio', '每次命中生命回复比例');
  data(x, 'HasteBoost', 'self_move_speed_ratio', '自身持续衰减移速起始比例');
  ms(x, 'HasteDuration', 'haste_duration_ms', '自身移速持续（毫秒）');
  literal(x, 'pool_duration_ms', '血池持续（毫秒）', 2000, '当前中文正文明确持续2秒；不能与减速/吸血命中节拍混为一项。', '当前绑定中文正文');
  runtime(x, 'source_current_hp_for_cost', '施放时当前生命值输入', '血池消耗按施放时当前生命值计算；缺输入不能默认0。');
  const cost = times(P('health_cost_ratio'), P('source_current_hp_for_cost'));
  formula(x, 'pool_damage', '血池每次命中魔法伤害', plus(baseDamage, times(hpRatio, sourceBonusHp())), 'TotalDamage = BaseDamage + BonusHealthRatio×来源额外生命值；保留单次数学量，不创建周期伤害。');
  formula(x, 'pool_heal', '血池每次命中生命回复', times(P('vamp_ratio'), plus(baseDamage, times(hpRatio, sourceBonusHp()))), 'TotalHeal = VampPercent×TotalDamage；不创建瞬时治疗结果。');
  formula(x, 'health_cost', '血池当前生命值消耗', cost, 'HealthCost×施放时当前生命值；资源扣除时点与施放资格待接线。');
  resourceEffect(x, 'health_cost', '血池生命值消耗', fval('health_cost'), 'hp', 'CONSUME', '仅记录非即时资源组成；不创建过程，不在一次候选生成时自动扣除。');
  markCalc(x, 'TotalDamage', '血池总伤害树已内联额外生命值窄口径。');
  markCalc(x, 'TotalHeal', '血池总治疗树已内联吸血比例。');
  noteDamage(x, 'pool_damage');
  noteHeal(x, 'pool_heal');
  pending(x, '不可被选取、幽灵与持续节拍', '不可被选取属于1v1相关系统待接；纯碰撞幽灵效果、持续伤害和每命中一个敌人的回复需要状态、周期和命中事件。本候选只保留持续时间、单次量和资源代价。', '系统');
  finish(x);
}
{
  const x = start('vladimir_e');
  standard(x);
  const baseDamage = data(x, 'BaseDamage', 'min_damage_base', '蓄力初始基础魔法伤害');
  const maxDamage = data(x, 'BaseMaxDamage', 'max_damage_base', '蓄力满层基础魔法伤害');
  pct(x, 'SlowPercent', 'slow_ratio', '蓄力命中减速比例');
  pct(x, 'MaxHealthCost', 'max_health_cost_ratio', '蓄力最大生命值消耗比例');
  pct(x, 'TotalMaxHPDamage', 'max_health_damage_ratio', '蓄力最大生命值伤害比例');
  ms(x, 'MaxChannelTime', 'max_channel_duration_ms', '最大蓄力时间（毫秒）');
  ms(x, 'TimetoRampMaxDamage', 'max_damage_ramp_ms', '达到满伤害所需蓄力时间（毫秒）');
  ratio(x, 'min_damage_health_ratio', '初始伤害生命值系数', 0.015, 'MinDamageTooltip树明确的来源生命值系数；来源输入不绑定猜测。');
  ratio(x, 'min_damage_ap_ratio', '初始伤害法强系数', 0.35, 'MinDamageTooltip树明确的法强系数。');
  ratio(x, 'max_damage_ap_ratio', '满蓄力伤害法强系数', 0.8, 'MaxDamageTooltip树明确的法强系数。');
  runtime(x, 'source_max_health_for_charge', '蓄力计算用来源最大生命值输入', 'Min/Max/ChargeHealth树的生命值节点缺少可安全复用的系统枚举；外供真实最大生命值，不默认0。');
  const maxHealth = P('source_max_health_for_charge');
  formula(x, 'min_damage', '初始蓄力魔法伤害', plus(baseDamage, times(P('min_damage_health_ratio'), maxHealth), times(P('min_damage_ap_ratio'), AP())), 'MinDamageTooltip = BaseDamage + 0.015×来源最大生命值 + 0.35×法强。');
  formula(x, 'max_damage', '满蓄力魔法伤害', plus(maxDamage, times(P('max_health_damage_ratio'), maxHealth), times(P('max_damage_ap_ratio'), AP())), 'MaxDamageTooltip = BaseMaxDamage + 0.06×来源最大生命值 + 0.8×法强。');
  formula(x, 'charge_health_cost', '蓄力最大生命值消耗', times(P('max_health_cost_ratio'), maxHealth), 'ChargeHealthTooltip = MaxHealthCost×来源最大生命值；缺输入不默认0。');
  resourceEffect(x, 'max_health_cost', '蓄力生命值消耗', fval('charge_health_cost'), 'hp', 'CONSUME', '只表达明确的非即时资源代价；蓄力中断、自动释放和扣除时点未接线。');
  markCalc(x, 'MinDamageTooltip', '初始伤害树已内联来源生命值和法强窄口径。');
  markCalc(x, 'MaxDamageTooltip', '满蓄力伤害树已内联来源生命值和法强窄口径。');
  markCalc(x, 'ChargeHealthTooltip', '蓄力生命值消耗树已内联，不将缺失输入当零。');
  noteDamage(x, 'min_damage');
  noteDamage(x, 'max_damage');
  pending(x, '蓄力阶段与自动释放', '正文明确最大蓄力1.5秒、至少1秒获得减速；阶段命中、蓄力中断和实际消耗时点未接线，不创建过程或触发。');
  finish(x);
}
{
  const x = start('vladimir_r');
  standard(x);
  const baseDamage = data(x, 'BaseDamage', 'base_damage', '血之瘟疫基础魔法伤害');
  pct(x, 'DamageAmp', 'damage_amp_ratio', '血之瘟疫易伤额外比例');
  ms(x, 'Duration', 'damage_amp_duration_ms', '易伤持续（毫秒）');
  data(x, 'VampPercentFirstChamp', 'first_champion_heal_ratio', '首个英雄回复比例', { scale: 0.01, unit: '百分数点转比例' });
  excludeData(x, 'VampPercentAdditionalChamp', '额外英雄命中回复属于本轮多目标外支路；保留首个英雄回复数学，不为额外命中新增专用参数。');
  ratio(x, 'damage_ap_ratio', '血之瘟疫法强系数', 0.7, 'Damage树明确的法强系数。');
  const damage = plus(baseDamage, times(P('damage_ap_ratio'), AP()));
  formula(x, 'damage', '血之瘟疫魔法伤害', damage, 'Damage = BaseDamage + 0.7×法强；不创建瞬时伤害结果。');
  formula(x, 'first_champion_heal', '首个英雄命中回复量', times(P('first_champion_heal_ratio'), damage), '首个英雄回复100%伤害；只保留数学量。');
  markCalc(x, 'Damage', '血之瘟疫伤害树已内联法强系数。');
  sourceProof(x, 'mSpellCalculations.SecondaryHealingTooltip', requireCalc(x, 'SecondaryHealingTooltip'), '额外英雄命中回复计算树保留来源；本轮不创建多目标专用公式。', { excluded: true });
  noteDamage(x, 'damage');
  noteHeal(x, 'first_champion_heal');
  pending(x, '易伤与首个英雄回复', '正文的易伤持续、延迟爆发、首个英雄判断和回复事件未接线；额外英雄命中回复属于本轮范围外支路。');
  finish(x);
}

// 斯维因
{
  const x = start('swain_p');
  data(x, 'SoulCollectionRange', 'soul_collection_range', '魂屑收集范围');
  data(x, 'HealthIncrement', 'max_health_per_soul', '每个魂屑增加最大生命值');
  literal(x, 'soul_heal_ratio', '每个魂屑回复最大生命比例', 0.06, '当前中文正文明确每个魂屑回复6%最大生命值。', '当前绑定中文正文');
  runtime(x, 'soul_shard_count', '魂屑数量输入', '魂屑是战前和战斗中累积的进度；实际数量外供，不初始化。', 'INTEGER');
  runtime(x, 'source_max_health_for_soul', '魂屑治疗用来源最大生命值', '治疗数学量需要真实最大生命值；缺输入不能默认0。');
  formula(x, 'soul_bonus_max_health', '魂屑增加最大生命值', times(P('soul_shard_count'), P('max_health_per_soul')), 'MaxHealthGained = 魂屑数量×每魂屑生命值；不创建自动叠层或属性初始化。');
  formula(x, 'soul_heal_amount', '魂屑回复生命量', times(P('soul_heal_ratio'), P('source_max_health_for_soul')), 'PassiveHealCalculated = 6%×来源最大生命值；不创建瞬时治疗结果。');
  markCalc(x, 'PassiveHealPercent', '被动治疗比例来源为6%固定插值端点。');
  markCalc(x, 'PassiveHealCalculated', '被动治疗树只保留带来源最大生命输入的数学量。');
  markCalc(x, 'MaxHealthGained', '被动最大生命树依赖魂屑计数；候选不把计数写成状态。');
  noteHeal(x, 'soul_heal_amount');
  pending(x, '魂屑产生与收集', 'W命中、E拉回和附近英雄死亡等事件会产生魂屑；事件顺序、收集和战前累积不在本批接线。');
  finish(x);
}
{
  const x = start('swain_q');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '解脱之触基础魔法伤害');
  const firstRatio = data(x, 'FirstBoltAPRatio', 'first_bolt_ap_ratio', '第一道恶魔之力法强系数');
  const extraRatio = data(x, 'ExtraBoltRatio', 'extra_bolt_ratio', '额外射线相对首道伤害比例');
  data(x, 'BoundaryCheckRange', 'bolt_boundary_range', '射线边界距离');
  data(x, 'MaxDamageMultiTOOLTIP', 'max_damage_multiplier', '近距离最大伤害倍率');
  literal(x, 'bolt_count', '射线数量', 5, '当前官方中文正文明确最多发射5道射线。', '当前绑定官方中文正文');
  const initial = plus(base, times(firstRatio, AP()));
  formula(x, 'initial_damage', '第一道射线魔法伤害', initial, 'InitialDamage = BaseDamage + FirstBoltAPRatio×法强；只保存数学量。');
  formula(x, 'extra_bolt_damage', '每道额外射线魔法伤害', times(P('extra_bolt_ratio'), initial), 'ExtraBoltDamage = ExtraBoltRatio×第一道射线伤害；不把多道命中合并为瞬时结果。');
  formula(x, 'max_damage', '近距离最大射线魔法伤害', times(P('max_damage_multiplier'), initial), 'MaxDamage = MaxDamageMulti×第一道射线伤害；最大值只是距离分支算例。');
  markCalc(x, 'InitialDamage', '第一道射线树已内联法强系数。');
  markCalc(x, 'ExtraBoltDamage', '额外射线树已内联相对倍率。');
  markCalc(x, 'MaxDamage', '近距离最大伤害树已内联倍率。');
  noteDamage(x, 'initial_damage');
  noteDamage(x, 'extra_bolt_damage');
  noteDamage(x, 'max_damage');
  pending(x, '射线几何与目标命中', '射线数量、近距离边界和多道射线命中顺序待接线；本候选不创建范围命中或伤害结果。');
  finish(x);
}
{
  const x = start('swain_w');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '帝国视界基础魔法伤害');
  const apRatio = data(x, 'APRatio', 'ap_ratio', '帝国视界法强系数');
  excludeData(x, 'MinionMod', '小兵伤害属于本轮范围外支路；本候选只保留正常单一英雄命中数学。');
  data(x, 'Slow', 'slow_ratio', '帝国视界减速比例', { scale: -1, unit: '负值修正转为正比例' });
  ms(x, 'SlowDuration', 'slow_duration_ms', '减速持续（毫秒）');
  ms(x, 'RevealDuration', 'reveal_duration_ms', '显形持续（毫秒）');
  data(x, 'EffectRadius', 'effect_radius', '技能效果半径');
  excludeData(x, 'VisionRadius', '视野半径属于本轮纯显形视野外支路；不生成专用参数。');
  literal(x, 'soul_shard_per_champion_hit', '命中英雄产生魂屑数量', 1, '当前中文正文明确命中英雄会产生1个魂屑；实际魂屑事件待接线。', '当前绑定中文正文');
  const damage = plus(base, times(apRatio, AP()));
  formula(x, 'damage', '帝国视界魔法伤害', damage, 'TotalDamage = BaseDamage + APRatio×法强；不创建伤害结果。');
  markCalc(x, 'TotalDamage', '帝国视界伤害树已内联法强。');
  sourceProof(x, 'mSpellCalculations.MinionDamage', requireCalc(x, 'MinionDamage'), '小兵伤害计算树保留来源；本轮不创建小兵专用公式。', { excluded: true });
  noteDamage(x, 'damage');
  pending(x, '远程命中、显形和魂屑事件', '目标命中、单一英雄魂屑产生、显形与减速的实际事件尚未接线；小兵伤害属于本轮范围外支路，只保留正常单一英雄收益。');
  finish(x);
}
{
  const x = start('swain_e');
  standard(x);
  const base = data(x, 'E2Damage', 'secondary_damage_base', '永不复行爆炸基础魔法伤害');
  const apRatio = data(x, 'E2Ratio', 'secondary_ap_ratio', '永不复行爆炸法强系数');
  ms(x, 'RootDuration', 'root_duration_ms', '禁锢持续（毫秒）');
  data(x, 'PullDistance', 'pull_distance', '拉回距离');
  data(x, 'CooldownRefund', 'cooldown_refund_ratio', '命中拉回后的冷却返还比例');
  data(x, 'ExplosionRadius', 'explosion_radius', '爆炸半径');
  literal(x, 'soul_shard_per_pulled_champion', '拉回英雄产生魂屑数量', 1, '当前中文正文明确拉回英雄会产生1个魂屑；实际事件待接线。', '当前绑定中文正文');
  formula(x, 'secondary_damage', '永不复行爆炸魔法伤害', plus(base, times(apRatio, AP())), 'SecondaryDamage = E2Damage + E2Ratio×法强；只保存数学量，不创建伤害结果。');
  markCalc(x, 'SecondaryDamage', '永不复行爆炸树已内联法强系数。');
  noteDamage(x, 'secondary_damage');
  pending(x, '拉回、禁锢与返还', '首次命中、拉回英雄、禁锢和冷却返还的事件顺序尚未接线；不创建控制结果或自动返还。');
  finish(x);
}
{
  const x = start('swain_r');
  standard(x);
  const dpsBase = data(x, 'DamagePerSecond', 'damage_per_second_base', '恶魔升华每秒基础魔法伤害');
  const dpsRatio = data(x, 'DamageAPRatio', 'damage_per_second_ap_ratio', '每秒伤害法强系数');
  const healBase = data(x, 'HealPerSecond', 'heal_per_second_base', '恶魔升华每秒基础回复');
  const healAp = data(x, 'HealAPRatio', 'heal_ap_ratio', '每秒回复法强系数');
  const healHp = data(x, 'HealHPRatio', 'heal_bonus_health_ratio', '每秒回复额外生命值系数');
  excludeData(x, 'MinionMonsterHealReduction', '非英雄目标治疗比例属于本轮兵野治疗外支路；本候选只保留正常单一英雄回复数学。');
  data(x, 'DemonPowerMax', 'demon_power_max', '恶魔能量上限');
  data(x, 'DemonPowerDegen', 'demon_power_degen_per_second', '恶魔能量衰减速度');
  data(x, 'DemonPowerRegen', 'demon_power_regen_per_second', '恶魔能量回复速度');
  const flareBase = data(x, 'DemonflareDamageBase', 'demonflare_base_damage', '恶魔耀光基础魔法伤害');
  const flareRatio = data(x, 'DemonflareDamageRatio', 'demonflare_ap_ratio', '恶魔耀光法强系数');
  data(x, 'DemonflareSlowAmount', 'demonflare_slow_ratio', '恶魔耀光减速比例');
  ms(x, 'DemonflareSlowDuration', 'demonflare_slow_duration_ms', '恶魔耀光减速持续（毫秒）');
  ms(x, 'AmpTime', 'demonflare_amp_duration_ms', '恶魔耀光强化持续（毫秒）');
  data(x, 'DegenAmpAmount', 'demon_power_degen_amp', '强化期间恶魔能量额外衰减');
  ms(x, 'DemonflareCastDelay', 'demonflare_cast_delay_ms', '恶魔耀光施放延迟（毫秒）');
  data(x, 'MaxDemonflareCast', 'demonflare_cast_limit', '恶魔耀光施放限制值');
  ms(x, 'TimeBetweenTicks', 'damage_tick_interval_ms', '持续量节拍（毫秒）');
  ms(x, 'DemonflareCooldownTooltip', 'demonflare_cooldown_ms', '恶魔耀光冷却（毫秒）');
  runtime(x, 'source_bonus_health_for_swain_r', '恶魔升华回复用来源额外生命值', 'HealHPRatio节点的属性选择器未完整提供；外供已核的来源额外生命值，不默认0。');
  const damage = plus(dpsBase, times(dpsRatio, AP()));
  const healing = plus(healBase, times(healAp, AP()), times(healHp, P('source_bonus_health_for_swain_r')));
  formula(x, 'damage_per_second', '恶魔升华每秒魔法伤害', damage, 'DamageCalc = DamagePerSecond + DamageAPRatio×法强；保存每秒量，不创建周期伤害。');
  formula(x, 'healing_per_second', '恶魔升华每秒生命回复', healing, 'HealingCalc = HealPerSecond + HealAPRatio×法强 + HealHPRatio×来源额外生命值；不创建周期治疗。');
  formula(x, 'demonflare_damage', '恶魔耀光魔法伤害', plus(flareBase, times(flareRatio, AP())), 'DemonflareDamageTotal = DemonflareDamageBase + DemonflareDamageRatio×法强。');
  markCalc(x, 'DamageCalc', '恶魔升华持续伤害树已内联法强。');
  markCalc(x, 'HealingCalc', '恶魔升华持续回复树已内联来源额外生命值输入。');
  markCalc(x, 'DemonflareDamageTotal', '恶魔耀光伤害树已内联法强。');
  sourceProof(x, 'mSpellCalculations.MinionMonsterHeal', requireCalc(x, 'MinionMonsterHeal'), '非英雄目标回复计算树保留来源；本轮不创建兵野治疗公式。', { excluded: true });
  noteDamage(x, 'damage_per_second');
  noteDamage(x, 'demonflare_damage');
  noteHeal(x, 'healing_per_second');
  pending(x, '恶魔升华变形、能量与周期', '保留自身技能、单一英雄收益和魂屑战前进度；兵野回复属于本轮范围外支路。变形视觉、恶魔能量事件、每秒节拍、耀光触发和退出条件尚未接线，不把视觉变形当作完整替换状态。');
  finish(x);
}

// 兰博
{
  const x = start('rumble_p');
  data(x, 'OverheatDuration', 'overheat_duration_ms', '过热持续（毫秒）', { scale: 1000, unit: '秒转毫秒' });
  data(x, 'DangerZoneHeat', 'danger_zone_heat', '危险温度阈值');
  data(x, 'OverheatingHeat', 'overheating_heat', '过热阈值');
  data(x, 'OverheatPercBonusDamage', 'overheat_bonus_damage_ratio', '过热额外伤害比例');
  excludeData(x, 'MonsterCap', '过热攻击野怪上限属于本轮野怪专用外支路；本候选只保留正常过热攻击数学。');
  data(x, 'HeatDecayPerS', 'heat_decay_per_second', '每秒热量变化');
  const totalBase = unknownCurve(x, 'overheat_attack_base_damage', '过热攻击额外基础伤害', requireCalc(x, 'TotalBaseDamage'), 'mSpellCalculations.TotalBaseDamage', '客户端只提供等级插值节点；未知等级不猜线性。');
  const attackSpeed = unknownCurve(x, 'overheat_attack_speed_ratio', '过热攻击速度加成', requireCalc(x, 'OverheatAS'), 'mSpellCalculations.OverheatAS', '客户端只提供角色等级成长节点；实际等级值外供。');
  sourceProof(x, 'mSpellCalculations.MonsterCapScaling', requireCalc(x, 'MonsterCapScaling'), '过热攻击野怪上限计算树保留来源；本轮不创建野怪专用参数。', { excluded: true });
  ratio(x, 'overheat_attack_ap_ratio', '过热攻击法强系数', 0.25, 'TotalBaseDamage树明确含0.25×法强。');
  formula(x, 'overheat_attack_damage', '过热攻击额外魔法伤害', plus(totalBase, times(P('overheat_attack_ap_ratio'), AP())), 'TotalBaseDamage = 等级基础项 + 0.25×法强；过热触发条件不在公式中自动推导。');
  markCalc(x, 'TotalBaseDamage', '过热攻击基础等级节点保留为外供值，法强项已内联。');
  markCalc(x, 'OverheatAS', '过热攻击速度等级节点只保留外供输入。');
  noteDamage(x, 'overheat_attack_damage');
  pending(x, '热量资源与过热事件', '热量、危险温度、过热阈值和衰减是技能专属资源；当前属性目录没有heat，不能借mana伪装，也不创建自动沉默、攻击速度或攻击附伤过程。');
  exclude(x, '自我沉默和自动过热攻击', '需要热量状态、触发和普攻事件，本批只保留热量数值及独立攻击数学量。');
  finish(x);
}
{
  const x = start('rumble_q');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '纵火盛宴基础魔法伤害');
  const minion = data(x, 'MinionMod', 'minion_damage_ratio', '小兵伤害比例');
  const healthDamage = data(x, 'HealthDamage', 'max_health_damage_ratio', '每秒最大生命伤害比例');
  const apRatio = data(x, 'APRatio', 'ap_ratio', '纵火盛宴法强系数');
  const overheat = data(x, 'OverheatMulti', 'overheat_damage_multiplier', '危险温度伤害倍率');
  ms(x, 'FlamespitterDuration', 'flamespitter_duration_ms', '火焰喷射持续（毫秒）');
  data(x, 'DebuffTicks', 'debuff_tick_count', '灼烧减益节拍数量');
  ms(x, 'TickRate', 'tick_interval_ms', '伤害节拍（毫秒）');
  data(x, 'TotalTicks', 'total_tick_count', '总节拍数量');
  data(x, 'InitialHeatCost', 'initial_heat_cost', '首次施放热量消耗');
  ms(x, 'BurnDuration', 'burn_duration_ms', '灼烧持续（毫秒）');
  const flat = plus(base, times(apRatio, AP()));
  formula(x, 'flat_damage', '纵火盛宴每次基础魔法伤害', flat, 'FlatDamage = BaseDamage + APRatio×法强；不创建周期伤害结果。');
  formula(x, 'minion_damage', '纵火盛宴小兵每次魔法伤害', times(minion, flat), 'MinionDamage = MinionMod×FlatDamage；保留明确小兵目标分支。');
  formula(x, 'empowered_damage', '危险温度纵火盛宴每次魔法伤害', times(P('overheat_damage_multiplier'), flat), 'EmpoweredDamage = OverheatMulti×FlatDamage；危险温度资格待接线。');
  formula(x, 'empowered_health_damage_ratio', '危险温度最大生命伤害比例', times(P('overheat_damage_multiplier'), P('max_health_damage_ratio')), 'EmpoweredHealth = OverheatMulti×HealthDamage；只保留比例。');
  sourceProof(x, 'mSpellCalculations.MonsterCap', requireCalc(x, 'MonsterCap'), '纵火盛宴野怪伤害上限计算树保留来源；本轮不创建野怪专用参数。', { excluded: true });
  markCalc(x, 'FlatDamage', '纵火盛宴基础伤害树已内联法强。');
  markCalc(x, 'MinionDamage', '纵火盛宴小兵分支已内联比例。');
  markCalc(x, 'EmpoweredDamage', '危险温度伤害树已内联倍率。');
  markCalc(x, 'EmpoweredHealth', '危险温度最大生命比例树已内联倍率。');
  noteDamage(x, 'flat_damage');
  noteDamage(x, 'minion_damage');
  noteDamage(x, 'empowered_damage');
  pending(x, '热量分支与火焰节拍', '火焰总持续、节拍和危险温度需要热量和目标事件；本候选不把节拍折算成一次总伤害，也不创建热量消耗效果。');
  finish(x);
}
{
  const x = start('rumble_w');
  standard(x);
  data(x, 'HeatCost', 'heat_cost', '破碎护盾热量消耗');
  const base = data(x, 'BaseShield', 'base_shield', '破碎护盾基础值');
  const healthRatio = data(x, 'HealthShield', 'health_shield_ratio', '来源生命值护盾系数');
  const moveSpeed = data(x, 'MoveSpeed', 'move_speed_ratio', '破碎护盾移速比例');
  const apRatio = data(x, 'APRatio', 'shield_ap_ratio', '破碎护盾法强系数');
  ms(x, 'ShieldDuration', 'shield_duration_ms', '护盾持续（毫秒）');
  ms(x, 'MoveSpeedDuration', 'move_speed_duration_ms', '移速持续（毫秒）');
  ratio(x, 'empowered_shield_multiplier', '危险温度护盾倍率', 1.5, '当前根EmpoweredShield树明确危险温度护盾为普通值1.5倍。');
  ratio(x, 'empowered_move_speed_multiplier', '危险温度移速倍率', 1.5, '当前根EmpoweredMS树明确危险温度移速为普通值1.5倍。');
  runtime(x, 'source_health_for_shield', '护盾计算用来源生命值输入', '当前HealthShield树的属性选择器没有完整所有者和值类型证据；外供实际来源生命值，不默认0。');
  const shield = plus(base, times(apRatio, AP()), times(healthRatio, P('source_health_for_shield')));
  formula(x, 'shield_amount', '普通破碎护盾值', shield, 'TotalShield = BaseShield + APRatio×法强 + HealthShield×来源生命值；缺输入不默认0。');
  formula(x, 'empowered_shield_amount', '危险温度破碎护盾值', times(P('empowered_shield_multiplier'), shield), 'EmpoweredShield = 1.5×普通护盾；危险温度资格待接线。');
  formula(x, 'empowered_move_speed_ratio', '危险温度破碎护盾移速比例', times(P('empowered_move_speed_multiplier'), P('move_speed_ratio')), 'EmpoweredMS = 1.5×普通移速比例。');
  shieldEffect(x, 'shield', '普通破碎护盾自身护盾', 'shield_amount', 'shield_duration_ms', '当前正文明确自身获得护盾');
  shieldEffect(x, 'empowered_shield', '危险温度破碎护盾自身护盾', 'empowered_shield_amount', 'shield_duration_ms', '当前正文明确危险温度强化护盾');
  statEffect(x, 'move_speed', '普通破碎护盾自身移速', val('move_speed_ratio'), 'move_speed_percent', { duration: P('move_speed_duration_ms'), description: '当前正文明确普通破碎护盾提供自身移动速度；危险温度资格和实际施放尚未接线。' });
  statEffect(x, 'empowered_move_speed', '危险温度破碎护盾自身移速', fval('empowered_move_speed_ratio'), 'move_speed_percent', { duration: P('move_speed_duration_ms'), description: '当前正文明确危险温度强化移速；不借mana表示热量，也不自动触发。' });
  markCalc(x, 'TotalShield', '普通护盾树已内联来源生命值外供输入。');
  markCalc(x, 'EmpoweredShield', '强化护盾树已内联1.5倍关系。');
  markCalc(x, 'EmpoweredMS', '强化移速树已内联1.5倍关系。');
  pending(x, '热量分支与护盾资格', '危险温度、热量消耗和施放事件未接线；效果是独立定义的自身组成，不表示无条件同时应用普通与强化分支。', '系统');
  finish(x);
}
{
  const x = start('rumble_e');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '电子鱼叉基础魔法伤害');
  data(x, 'FirstCastHeatCost', 'first_cast_heat_cost', '第一次鱼叉热量消耗');
  data(x, 'PercMagicPen', 'magic_penetration_ratio', '普通鱼叉魔法穿透比例');
  data(x, 'EnhancedMagicPen', 'enhanced_magic_penetration_ratio', '强化鱼叉魔法穿透比例');
  ms(x, 'ShredDuration', 'magic_resistance_shred_duration_ms', '魔抗削减持续（毫秒）');
  ms(x, 'SlowDuration', 'slow_duration_ms', '减速持续（毫秒）');
  pct(x, 'BaseSlowAmount', 'slow_ratio', '普通鱼叉减速比例');
  pct(x, 'EmpoweredSlowAmount', 'enhanced_slow_ratio', '强化鱼叉减速比例');
  ratio(x, 'ap_ratio', '电子鱼叉法强系数', 0.5, '当前根TotalDamage树明确的法强系数。');
  ratio(x, 'empowered_damage_multiplier', '强化电子鱼叉伤害倍率', 1.5, '当前根EmpDamage树明确强化伤害为普通值1.5倍。');
  const damage = plus(base, times(P('ap_ratio'), AP()));
  formula(x, 'damage', '电子鱼叉魔法伤害', damage, 'TotalDamage = BaseDamage + 0.5×法强。');
  formula(x, 'empowered_damage', '强化电子鱼叉魔法伤害', times(P('empowered_damage_multiplier'), damage), 'EmpDamage = 1.5×TotalDamage；强化资格待接线。');
  sourceProof(x, 'DataValues.SecondCastHeatCost', null, '客户端当前根没有第二次鱼叉热量字段；缺失不补默认值。', { sourcePending: true });
  pending(x, '第二次鱼叉和弹药恢复', '当前根未提供SecondCastHeatCost、AmmoRechargeTime和MaxAmmo的可核值；不把第一次热量消耗外推到第二次，不创建弹药状态。', '来源');
  markCalc(x, 'TotalDamage', '电子鱼叉普通伤害树已内联法强。');
  markCalc(x, 'EmpDamage', '电子鱼叉强化伤害树已内联1.5倍。');
  noteDamage(x, 'damage');
  noteDamage(x, 'empowered_damage');
  pending(x, '魔抗削减和减速事件', '单次鱼叉命中、强化分支、魔抗削减及减速目标事件尚未接线；只保留数值。');
  finish(x);
}
{
  const x = start('rumble_r');
  standard(x);
  data(x, 'NumMissiles', 'missile_count', '鱼叉数量');
  ms(x, 'TrailDuration', 'trail_duration_ms', '恒温灼烧轨迹持续（毫秒）');
  ms(x, 'TickRate', 'tick_interval_ms', '轨迹伤害节拍（毫秒）');
  pct(x, 'SlowAmount', 'slow_ratio', '恒温灼烧减速比例');
  const dpsBase = data(x, 'BaseDamagePerSecond', 'damage_per_second_base', '轨迹每秒基础魔法伤害');
  ms(x, 'MaxBurnSeconds', 'max_burn_duration_ms', '最大灼烧持续（毫秒）');
  ms(x, 'BurnLingerTime', 'burn_linger_ms', '灼烧残留持续（毫秒）');
  ratio(x, 'damage_ap_ratio', '轨迹每秒法强系数', 0.35, '当前根DamagePerSecond树明确的法强系数。');
  const dps = plus(dpsBase, times(P('damage_ap_ratio'), AP()));
  formula(x, 'damage_per_second', '恒温灼烧每秒魔法伤害', dps, 'DamagePerSecond = BaseDamagePerSecond + 0.35×法强；保存每秒量。');
  markCalc(x, 'DamagePerSecond', '轨迹每秒伤害树已内联法强。');
  markCalc(x, 'TotalDamage', '客户端总量树只作显示参考，本候选明确不用于结果效果。');
  noteDamage(x, 'damage_per_second');
  pending(x, '轨迹命中、节拍和热量', 'R轨迹放置、方向、范围命中与0.25秒节拍尚未接线；冷却参数不作为伤害tick，不折算总量结果。');
  finish(x);
}

// 奥瑞利安·索尔
{
  const x = start('aurelionsol_p');
  const qRatio = data(x, 'QMaxHealthTrueDamagePerStack', 'q_bonus_max_health_damage_ratio_per_stardust', 'Q每层星尘额外最大生命伤害比例');
  const executeBase = pct(x, 'BaseExecutionThreshold', 'execute_base_threshold_ratio', 'E处决基础生命阈值');
  const executeGrowth = pct(x, 'ExecutionGrowthPerBreakpoint', 'execute_growth_per_stardust_ratio', '每层星尘处决阈值增量');
  runtime(x, 'stardust_count', '星尘数量输入', '星尘是战前和战斗中累积的进度；数量由外部提供，不初始化或自动叠加。', 'INTEGER');
  formula(x, 'q_bonus_max_health_damage_ratio', 'Q每层星尘额外最大生命伤害比例', times(P('stardust_count'), qRatio), 'QPassiveScaling = 星尘数量×每层最大生命伤害比例；只保留单英雄可命中分支的被动量。');
  formula(x, 'e_execute_threshold_ratio', 'E当前处决生命阈值', plus(executeBase, times(P('stardust_count'), executeGrowth)), 'EPassiveScalingExecute = 基础阈值 + 星尘数量×每层增量；最终目标生命输入和处决结果待接线。');
  markCalc(x, 'QPassiveScaling', 'Q星尘成长树已内联星尘数量输入。');
  markCalc(x, 'EPassiveScalingExecute', 'E处决阈值成长树已内联星尘数量输入。');
  markCalc(x, 'ExecuteHealthThreshold', '处决阈值树保留来源；候选不造处决结果。');
  pending(x, '星尘产生与消费', '星尘来自命中、范围内单位和战前进度；事件、消费和等级断点尚未接线，不创建自动累积或状态。');
  finish(x);
}
{
  const x = start('aurelionsol_q');
  standard(x, { commonOptions: { mana: false } });
  data(x, 'AngularDegreesPerSec', 'beam_rotation_degree_per_second', '星河冲荡旋转角速度');
  data(x, 'BeamWidth', 'beam_width', '星河冲荡光束宽度');
  literal(x, 'max_channel_duration_ms', '最大引导时间（毫秒）', 3250, '当前正文和根树明确普通Q最大引导3.25秒；根DataValues高等级的9999是飞行分支占位，单独留源不作为普通Q时长。', '当前绑定中文正文与mSpellCalculations');
  excludeData(x, 'MaxChannelDuration', '原DataValues同时含普通Q的3.25秒和飞行分支9999占位；本候选不把飞行分支值并入普通Q等级曲线。');
  ms(x, 'BurstAfter', 'burst_after_ms', '达到爆发条件所需时间（毫秒）');
  data(x, 'ManaCostPerSecond', 'mana_cost_per_second', '每秒法力消耗');
  const dpsBase = data(x, 'RankDamagePerSecond', 'damage_per_second_base', '每秒基础魔法伤害');
  const dpsRatio = data(x, 'APPerSecond', 'damage_per_second_ap_ratio', '每秒伤害法强系数');
  const burstBase = data(x, 'RankBurstDamage', 'burst_base_damage', '爆发基础魔法伤害');
  const burstRatio = data(x, 'BurstAPRatio', 'burst_ap_ratio', '爆发法强系数');
  data(x, 'BeamSegments', 'beam_segment_count', '光束分段数量');
  ms(x, 'WProcCooldown', 'w_proc_cooldown_ms', 'W触发Q额外伤害冷却（毫秒）');
  data(x, 'QMassStolen', 'q_mass_stolen', 'Q命中英雄获得星尘');
  data(x, 'DistancePerMass', 'distance_per_mass', '每单位星尘飞行距离');
  const qTrueRatio = data(x, 'QMaxHealthTrueDamagePerStack', 'bonus_max_health_damage_ratio_per_stardust', '每层星尘额外最大生命伤害比例');
  excludeData(x, 'MonsterDamageCap', '野怪百分比伤害上限属于本轮兵野专用外支路；本候选只保留单一英雄命中数学。');
  excludeData(x, 'AOEModifier', '附近敌人范围伤害比例属于本轮多目标分摊外支路；本候选只保留首个单一敌人命中数学。');
  runtime(x, 'stardust_count', 'Q计算用星尘数量', 'Q被动成长由战前进度提供；不自动叠加或初始化。', 'INTEGER');
  runtime(x, 'target_max_health', 'Q计算用目标最大生命值', 'Q额外最大生命魔法伤害按目标最大生命值计算；缺输入不能默认0。');
  const dps = plus(dpsBase, times(dpsRatio, AP()));
  const burst = plus(burstBase, times(burstRatio, AP()));
  const bonusRatio = times(P('stardust_count'), qTrueRatio);
  formula(x, 'damage_per_second', '星河冲荡每秒魔法伤害', dps, 'DamagePerSecond = RankDamagePerSecond + APPerSecond×法强；保存每秒量，不创建周期伤害。');
  formula(x, 'burst_damage', '星河冲荡爆发魔法伤害', burst, 'BurstDamage = RankBurstDamage + BurstAPRatio×法强；不创建瞬时伤害结果。');
  formula(x, 'bonus_max_health_magic_damage_ratio', '星尘额外最大生命魔法伤害比例', bonusRatio, 'BurstBonusTrueDamageToChamps = 星尘数量×每层最大生命伤害比例；当前正文明确该值用于最大生命值的魔法伤害。');
  formula(x, 'bonus_max_health_magic_damage_amount', '星尘额外最大生命魔法伤害量', times(P('target_max_health'), bonusRatio), '额外最大生命魔法伤害量 = 目标最大生命值×星尘比例；单一英雄目标输入缺失时不默认0。');
  unknownCurve(x, 'level_based_range', '星河冲荡等级射程', requireCalc(x, 'LevelBasedRangeScaling'), 'mSpellCalculations.LevelBasedRangeScaling', '客户端只给等级节点，射程实际值外供，不猜线性曲线。');
  resourceEffect(x, 'mana_per_second', '星河冲荡每秒法力消耗', val('mana_cost_per_second'), 'mana', 'CONSUME', '只记录每秒资源量；周期扣除、引导资格和中断时点尚未接线，不由一次施放自动扣除。');
  markCalc(x, 'DamagePerSecond', '星河冲荡每秒伤害树已内联法强。');
  markCalc(x, 'BurstDamage', '星河冲荡爆发伤害树已内联法强。');
  markCalc(x, 'BurstBonusTrueDamageToChamps', '星尘额外最大生命魔法伤害树已内联星尘输入；当前正文明确伤害类型为魔法伤害。');
  markCalc(x, 'LevelBasedRangeScaling', '等级射程只保留无默认外供值。');
  noteDamage(x, 'damage_per_second');
  noteDamage(x, 'burst_damage');
  noteDamage(x, 'bonus_max_health_magic_damage_amount');
  pending(x, '引导、爆发与星尘', '每秒资源扣除、持续引导、达到1秒爆发、W触发冷却和单一英雄命中尚未接线；Q不是一次普通法力消耗，不能用mana_cost代替每秒资源。');
  finish(x);
}
{
  const x = start('aurelionsol_w');
  standard(x);
  data(x, 'TrueDamageBonus', 'q_damage_bonus_ratio', 'W期间Q额外伤害比例');
  data(x, 'BaseMS', 'base_dash_speed', '基础飞行速度');
  data(x, 'BaseCruiseMS', 'base_cruise_speed', '基础巡航速度');
  data(x, 'DistancePerMass', 'distance_per_stardust', '每单位星尘位移距离');
  ms(x, 'ResetWindow', 'reset_window_ms', '击杀后重置窗口（毫秒）');
  pct(x, 'TooltipTakedownCooldownMultiplier', 'takedown_cooldown_refund_ratio', '击杀后的冷却返还比例');
  ms(x, 'FakeCastTime', 'fake_cast_time_ms', '伪施法时间（毫秒）');
  data(x, 'OverrideECastRange', 'e_cast_range_override', 'E施法距离覆盖值');
  excludeData(x, 'TakedownCooldownMultiplier', '原始剩余冷却倍率与正文90%返还重复；本候选保留已明确的返还比例，避免两条直通值形成重复组成。');
  excludeData(x, 'CD', '当前计算树未消费的旧冷却显示字段；公共cooldown_ms保留官方冷却，不把该字段再当技能冷却。');
  runtime(x, 'dash_speed_stat', 'W飞行速度计算输入', 'DashSpeed树的统计选择器未能安全映射到属性枚举；外供真实输入，不默认0。');
  formula(x, 'dash_speed', '星穹流丽飞行速度', plus(P('base_dash_speed'), P('dash_speed_stat')), 'DashSpeed = BaseMS + 当前根统计输入；不造位移过程或自动速度属性。');
  markCalc(x, 'DashSpeed', '飞行速度树已用无默认统计输入展开。');
  pending(x, '飞行、击杀重置与星尘', '飞行位移、W击杀重置、星尘距离和E施法距离的实际事件尚未接线；保留非即时数值，不创建位移状态。');
  finish(x);
}
{
  const x = start('aurelionsol_e');
  standard(x);
  data(x, 'ChampionMassPerSecond', 'champion_mass_per_second', '范围内英雄每秒星尘进度');
  data(x, 'MinionMassDeath', 'minion_mass_on_death', '小兵死亡星尘进度');
  data(x, 'LargeMinionCountBonus', 'large_minion_mass_bonus', '大型小兵额外星尘进度');
  data(x, 'LargeMonsterCountBonus', 'large_monster_mass_bonus', '大型野怪额外星尘进度');
  data(x, 'ChampionCountBonus', 'champion_mass_bonus', '英雄额外星尘进度');
  data(x, 'EpicMonsterCountBonus', 'epic_monster_mass_bonus', '史诗野怪额外星尘进度');
  data(x, 'StartingRadius', 'starting_radius', '星芒凝汇初始半径');
  data(x, 'StartingInnerRadius', 'starting_inner_radius', '星芒凝汇初始内圈半径');
  excludeData(x, 'GrowthBreakPoint', '星尘成长断点属于当前未消费的内部断点元数据；本候选不把它扩成无消费者公式。');
  data(x, 'StartingGravity', 'starting_gravity', '初始引力');
  data(x, 'NonChampGravity', 'non_champion_gravity', '非英雄目标引力');
  ms(x, 'Duration', 'duration_ms', '星芒凝汇持续（毫秒）');
  const dpsBase = data(x, 'BaseDamagePerSecond', 'damage_per_second_base', '每秒基础魔法伤害');
  const dpsRatio = data(x, 'DamageperSecondAPRatio', 'damage_per_second_ap_ratio', '每秒伤害法强系数');
  const executeBase = pct(x, 'BaseExecutionThreshold', 'execute_base_threshold_ratio', '基础处决生命阈值');
  excludeData(x, 'OuterRadiusAreaPerStack', '外圈面积增量只进入含ResultModifier的几何树；修饰语义未核，不在本轮生成不完整面积公式。');
  excludeData(x, 'InnerRadiusAreaPerStack', '内圈面积增量当前没有可独立消费的候选公式；随未核几何树留源待补。');
  excludeData(x, 'PI', '圆周率只服务于当前含ResultModifier的几何树；本轮不把内部常量单独作为无消费者参数。');
  excludeData(x, 'InversePI', '圆周率倒数只服务于当前含ResultModifier的几何树；本轮不把内部常量单独作为无消费者参数。');
  const executeGrowth = pct(x, 'ExecutionGrowthPerBreakpoint', 'execute_growth_per_stardust_ratio', '每层星尘处决阈值增量');
  runtime(x, 'stardust_count', 'E计算用星尘数量', '星尘为战前和战斗中进度；实际数量外供，不自动累积。', 'INTEGER');
  const count = P('stardust_count');
  const dps = plus(dpsBase, times(dpsRatio, AP()));
  formula(x, 'damage_per_second', '星芒凝汇每秒魔法伤害', dps, 'DamagePerSecond = BaseDamagePerSecond + DamageperSecondAPRatio×法强；保存每秒量，不创建周期伤害。');
  formula(x, 'current_execute_threshold_ratio', '星芒凝汇当前处决生命阈值', plus(executeBase, times(count, executeGrowth)), 'CurrentExecutionThreshold = 基础阈值 + 星尘数量×成长增量；正文直接在该值后追加百分号，基础5%与每层0.026个百分点统一换算为比例；不创建处决结果。');
  unknownCurve(x, 'level_based_range', '星芒凝汇等级射程', requireCalc(x, 'LevelBasedRangeScaling'), 'mSpellCalculations.LevelBasedRangeScaling', '客户端只给等级节点，实际射程外供，不猜曲线。');
  sourceProof(x, 'DataValues.GravityIncPerBreakpoint', null, '客户端当前根没有GravityIncPerBreakpoint值；缺失不补默认。', { sourcePending: true });
  markCalc(x, 'DamagePerSecond', '星芒凝汇每秒伤害树已内联法强。');
  markCalc(x, 'CurrentExecutionThreshold', '星芒凝汇处决阈值树已内联星尘数量；当前根树不标百分数显示，候选按正文百分号统一换算为比例。');
  sourceProof(x, 'mSpellCalculations.{5dfac189}', requireCalc(x, '{5dfac189}'), '星芒凝汇外圈几何树含ResultModifier，修饰语义未核；本轮不生成面积公式。', { sourcePending: true });
  sourceProof(x, 'mSpellCalculations.{94f76880}', requireCalc(x, '{94f76880}'), '星芒凝汇内圈几何修饰树依赖未核外圈树；本轮不生成面积公式。', { sourcePending: true });
  noteDamage(x, 'damage_per_second');
  pending(x, '星尘吸收、引力、面积与处决', '英雄命中、单位死亡、引力、范围目标和处决资格尚未接线；含ResultModifier的面积树修饰语义未核，金币经验、纯视觉、多目标分摊和独立召唤不进入本候选。');
  finish(x);
}
{
  const x = start('aurelionsol_r');
  standard(x);
  data(x, 'CalamityStacks', 'calamity_stardust_cost', '灾厄形态所需星尘');
  data(x, 'StartingRadius', 'starting_radius', '星天落瀑初始半径');
  data(x, 'SkiesDescendStartingRadius', 'skies_descend_radius', '天穹陨落初始半径');
  data(x, 'CalamitySizeBonus', 'calamity_size_multiplier', '灾厄形态范围倍率');
  data(x, 'MassStolen', 'mass_stolen', '命中英雄获得星尘');
  const base = data(x, 'BaseDamage', 'base_damage', '星天落瀑基础魔法伤害');
  const apRatio = data(x, 'APRatio', 'ap_ratio', '星天落瀑法强系数');
  ms(x, 'StunDuration', 'stun_duration_ms', '晕眩持续（毫秒）');
  const r2Ratio = data(x, 'R2DamageRatio', 'r2_damage_ratio', '天穹陨落伤害倍率');
  const shockRatio = data(x, 'ShockwaveDamageRatio', 'shockwave_damage_ratio', '冲击波伤害倍率');
  data(x, 'ShockwaveSlow', 'shockwave_slow_ratio', '冲击波减速比例');
  excludeData(x, 'AreaPerPassiveStack', '范围面积增量只进入含ResultModifier的几何树；修饰语义未核，本轮不生成不完整面积公式。');
  excludeData(x, 'PI', '圆周率只服务于当前含ResultModifier的几何树；本轮不把内部常量单独作为无消费者参数。');
  excludeData(x, 'InversePI', '圆周率倒数只服务于当前含ResultModifier的几何树；本轮不把内部常量单独作为无消费者参数。');
  runtime(x, 'stardust_count', 'R计算用星尘数量', 'R范围和升级资格依赖星尘进度；实际数量外供，不自动累积。', 'INTEGER');
  const damage = plus(base, times(apRatio, AP()));
  formula(x, 'damage', '星天落瀑魔法伤害', damage, 'MaxDamageTooltip = BaseDamage + APRatio×法强；只保留单一英雄可命中数学量。');
  formula(x, 'skies_descend_damage', '天穹陨落魔法伤害', times(P('r2_damage_ratio'), damage), 'R2Damage = R2DamageRatio×基础星天落瀑伤害；升级资格待接线。');
  formula(x, 'shockwave_damage', '天穹陨落冲击波魔法伤害', times(P('shockwave_damage_ratio'), damage), 'ShockwaveDamage = ShockwaveDamageRatio×基础星天落瀑伤害；不创建伤害结果。');
  markCalc(x, 'MaxDamageTooltip', '星天落瀑基础伤害树已内联法强。');
  markCalc(x, 'R2Damage', '天穹陨落伤害树已内联倍率。');
  markCalc(x, 'ShockwaveDamage', '冲击波伤害树已内联倍率。');
  sourceProof(x, 'mSpellCalculations.{1d7ce9ef}', requireCalc(x, '{1d7ce9ef}'), '星天落瀑范围几何树含ResultModifier，修饰语义未核；本轮不生成面积公式。', { sourcePending: true });
  noteDamage(x, 'damage');
  noteDamage(x, 'skies_descend_damage');
  noteDamage(x, 'shockwave_damage');
  pending(x, '星尘升级、范围与冲击波', '75星尘升级、英雄命中获得5星尘、含ResultModifier的灾厄范围几何树和冲击波控制事件尚未接线；保留自身技能和单一英雄命中数学，不造完整变形或自动触发。');
  finish(x);
}

for (const item of instances) {
  if (!plan.skills[item.c.skillKey]) throw Error('技能没有写入计划 ' + item.c.skillKey);
}
