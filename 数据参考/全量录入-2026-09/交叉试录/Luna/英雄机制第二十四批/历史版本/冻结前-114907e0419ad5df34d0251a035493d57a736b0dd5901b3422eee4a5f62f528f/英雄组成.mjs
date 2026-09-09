import {
  plan, begin, common, data, literal, runtime, unknownCurve, formula,
  pending, exclude, excludeData, requireCalc, markCalc, sourceProof, result, effect,
  val, fval, pn, attr, op, add, mul, fixed, life, behavior, finish
} from './候选.mjs';

const instances = [];
const start = skillKey => {
  const value = begin(skillKey);
  instances.push(value);
  return value;
};
const P = key => pn(key);
const AD = () => attr('attack_damage', 'SOURCE', 'TOTAL');
const BAD = () => attr('attack_damage', 'SOURCE', 'BONUS');
const AP = () => attr('ability_power', 'SOURCE', 'TOTAL');
const HP = () => attr('hp', 'SOURCE', 'TOTAL');
const BHP = () => attr('hp', 'SOURCE', 'BONUS');
const MR = () => attr('magic_resistance', 'SOURCE', 'BONUS');
const TARGET_HP = () => attr('hp', 'TARGET', 'TOTAL');
const ms = (x, source, key, name, description) =>
  data(x, source, key, name, { scale: 1000, unit: '秒转毫秒', integer: true, description });
const ratio = (x, source, key, name, description) =>
  data(x, source, key, name, { scale: 1, unit: '比例', description });
const percent = (x, source, key, name, description) =>
  data(x, source, key, name, { scale: 0.01, unit: '百分数点转比例', description });
const negativeRatio = (x, source, key, name, description) =>
  data(x, source, key, name, { scale: -1, unit: '负移动修正转正减速幅度', description });
const noteDamage = (x, key) =>
  pending(x, '伤害结果：' + key, '只保存当前根计算树和正文可独立定义的数学量；命中资格、目标选择、抗性和实际伤害结果尚未接线，不创建即时伤害。', '来源');
const noteHeal = (x, key) =>
  pending(x, '治疗结果：' + key, '只保存当前根计算树和正文可独立定义的治疗数学量；治疗时点、目标和实际治疗结果尚未接线，不创建直接治疗。', '来源');
const standard = (x, options = {}) => {
  common(x, options.common ?? {});
  pending(x, '施放、命中和事件接线', '本候选只保存确定参数、数学关系和少量自身组成；实际施放、命中、强化资格、控制与运行输入尚未接线。');
};

function shieldEffect(x, key, name, formulaKey, durationKey, description, decayMode = 'NONE') {
  effect(x, key, name, [
    result('shield', name, 'NORMAL_SHIELD', 'SOURCE', fval(formulaKey), { absorbedDamageTypeKey: null, decayMode }, behavior)
  ], life(P(durationKey)), description + '；仅表示独立护盾组成，施放资格和实际吸收尚未接线。');
}

function attributeEffect(x, key, name, value, attributeKey, durationKey, description) {
  effect(x, key, name, [
    result('attribute', name, 'ATTRIBUTE_CHANGE', 'SOURCE', value, {
      attributeKey,
      operation: 'INCREASE',
      modifierZoneKey: 'attribute_flat_add'
    }, behavior)
  ], durationKey ? life(P(durationKey)) : null, description + '；触发、应用和取消条件尚未接线。');
}

// 雪人骑士：努努
{
  const x = start('nunu_p');
  common(x, { cooldown: false, mana: false });
  const duration = ms(x, 'BloodBoilBaseDuration', 'buff_duration_ms', '弗雷尔卓德的召唤增益持续时间（毫秒）', '当前根BloodBoilBaseDuration；同时作用于努努和符合条件的附近友军，候选只保存来源自身收益。');
  const asRatio = ratio(x, 'ASIncrease', 'attack_speed_ratio', '弗雷尔卓德的召唤攻击速度比例', '当前根ASIncrease；正文明确努努和一名附近友军获得攻击速度，1表示100%。');
  const msRatio = ratio(x, 'MSIncrease', 'move_speed_ratio', '弗雷尔卓德的召唤移动速度比例', '当前根MSIncrease；正文明确努努和一名附近友军获得移动速度，1表示100%。');
  literal(x, 'per_target_trigger_cooldown_ms', '弗雷尔卓德的召唤每目标触发冷却（毫秒）', 10000, '扩展正文明确该增益每个目标10秒内只触发一次；持续时间可叠加但当前生命周期枚举没有延长时长模式。', 'Spell_NunuPassive_TooltipExtendedBelowLine');
  excludeData(x, 'ADRatioForAOE', '正文明确额外伤害作用于附近的其他敌人；这是周围目标专用分支，不进入1对1英雄自身目标候选。');
  markCalc(x, 'CleaveDamage', '原树完整留源但按正文属于附近其他敌人的周围攻击分支，本候选不生成周围攻击伤害公式。');
  excludeData(x, 'MonsterRadius', '仅大野怪碰撞半径几何字段，不是1对1英雄伤害数值。');
  excludeData(x, 'LargeRadius', '仅大型目标碰撞半径几何字段，不是1对1英雄伤害数值。');
  exclude(x, '附近其他敌人与附近友军分支', '当前正文明确周围攻击只作用于附近的其他敌人，增益还会选择一名附近友军；两者都不是1对1自身目标技能结果，本批逐支排除。');
  pending(x, '自身增益叠加与每目标触发', '正文明确自身攻击速度、移动速度收益、持续时间可叠加且每目标10秒内只触发一次；当前生命周期只有刷新、保留剩余和独立三种模式，没有延长时长语义，暂不生成两个属性效果。', '系统');
  void duration; void asRatio; void msRatio;
}
{
  const x = start('nunu_q');
  standard(x);
  excludeData(x, 'MonsterMinionDamage', '仅小兵和野怪专用真实伤害；本候选保留英雄目标魔法伤害，不把非英雄伤害混入1对1英雄分支。');
  const baseHeal = data(x, 'BaseHealing', 'base_healing', '吞噬基础回复量', '当前根MonsterHealing基础项；治疗数学量保留，实际治疗不创建。');
  const bonusHpRatio = ratio(x, 'PercentageOfBonusHP', 'bonus_hp_healing_ratio', '吞噬额外生命值回复比例', '当前根MonsterHealing和TotalChampionDamage的mStat=12、mStatFormula=2；按已证窄口径绑定来源额外生命值。');
  const champHealScalar = ratio(x, 'ChampionHealingScalar', 'champion_healing_scalar', '吞噬英雄目标回复倍率', '当前根ChampionHealing的mMultiplier；直接复用为英雄目标回复倍率。');
  const lowHealthThreshold = ratio(x, 'LowHealthThreshhold', 'low_health_threshold_ratio', '吞噬低生命值阈值', '当前正文按LowHealthThreshhold×100显示；保留0至1比例。');
  const lowHealthScalar = ratio(x, 'LowHealthHealingScalar', 'low_health_healing_scalar', '吞噬低生命值回复提升比例', '当前正文按LowHealthHealingScalar×100显示；保留0至1比例。');
  const lowHealthMultiplier = literal(x, 'low_health_champion_multiplier', '低生命资格成立时的英雄回复倍率', 1.5, '当前正文明确低于阈值时回复增加50%；倍率为1+LowHealthHealingScalar，即1.5，仅在低生命资格成立时使用。', 'Spell_NunuQAbility_Tooltip');
  const bonusHpDamage = ratio(x, 'BonusMaxHPDamage', 'bonus_hp_damage_ratio', '吞噬英雄目标额外生命值伤害比例', '当前根TotalChampionDamage的mStat=12、mStatFormula=2；按已证窄口径绑定来源额外生命值。');
  const champApRatio = ratio(x, 'ChampDamageAPRatio', 'champion_damage_ap_ratio', '吞噬英雄目标法强比例', '当前根TotalChampionDamage省略mStat字段但正文为英雄目标魔法伤害；按当前法术强度窄口径保留。');
  const monsterHealApRatio = ratio(x, 'MonsterHealingAPRatio', 'monster_healing_ap_ratio', '吞噬回复法强比例', '当前根MonsterHealing省略mStat字段；按当前法术强度窄口径保留，实际拥有者待运行核对。');
  const monsterHealingExpression = add(add(baseHeal, mul(bonusHpRatio, BHP())), mul(monsterHealApRatio, AP()));
  const championHealingExpression = mul(P('champion_healing_scalar'), monsterHealingExpression);
  formula(x, 'monster_healing', '吞噬基础回复数学量', monsterHealingExpression, 'MonsterHealing = BaseHealing + PercentageOfBonusHP×来源额外生命值 + MonsterHealingAPRatio×来源法术强度；作为英雄回复倍率的基础量，不创建治疗结果。');
  formula(x, 'champion_damage', '吞噬英雄目标魔法伤害数学量', add(add(data(x, 'ChampionDamage', 'champion_base_damage', '吞噬英雄目标基础魔法伤害', '当前根TotalChampionDamage基础项。'), mul(bonusHpDamage, BHP())), mul(champApRatio, AP())), 'TotalChampionDamage = ChampionDamage + BonusMaxHPDamage×来源额外生命值 + ChampDamageAPRatio×来源法术强度；不创建即时伤害。');
  formula(x, 'champion_healing', '吞噬英雄目标回复数学量', championHealingExpression, 'ChampionHealing = ChampionHealingScalar×MonsterHealing；低生命资格和实际治疗尚未接线。');
  formula(x, 'low_health_champion_healing', '低生命资格成立时的英雄回复数学量', mul(P('low_health_champion_multiplier'), championHealingExpression), '低生命资格成立时的英雄回复 = 1.5×ChampionHealing；LowHealthHealingScalar=0.5只在正文资格成立时转成该倍率，不创建治疗结果。');
  noteDamage(x, 'champion_damage');
  noteHeal(x, 'monster_healing');
  noteHeal(x, 'champion_healing');
  noteHeal(x, 'low_health_champion_healing');
  markCalc(x, 'MonsterHealing', '回复基础树完整展开，保留额外生命值和法强两项。');
  markCalc(x, 'TotalChampionDamage', '英雄目标伤害树完整展开，保留额外生命值和法强两项。');
  markCalc(x, 'ChampionHealing', '保留mMultiplier=ChampionHealingScalar并单独展开英雄回复数学量。');
  pending(x, '低生命值回复资格', '正文明确努努和威朗普低于阈值时回复提升；阈值、LowHealthHealingScalar和1.5倍数学量已保存，实际生命比例资格事件和治疗时点未接线。', '系统');
}
{
  const x = start('nunu_w');
  standard(x);
  excludeData(x, 'MonsterCollisionRadiusScalar', '仅大型野怪碰撞半径修正，不是英雄目标伤害组成。');
  excludeData(x, 'MonsterImpactRadiusScalar', '仅大型野怪碰撞半径修正，不是英雄目标伤害组成。');
  const base = data(x, 'BaseDamage', 'base_damage', '史上最大雪球基础魔法伤害', '当前根MaximumSnowballDamage基础项。');
  const maxDamageTime = ms(x, 'MaxDamageTime', 'max_damage_time_ms', '史上最大雪球达到最高伤害时间（毫秒）', '当前根MaxDamageTime；不把它解释为命中周期。');
  const maxDamageScalar = ratio(x, 'MaxDamageScalar', 'max_damage_scalar', '史上最大雪球最高伤害倍率', '当前根数据字段MaxDamageScalar；保存原始倍率，不重复建直通公式。');
  const maxDuration = ms(x, 'MaxDuration', 'max_duration_ms', '史上最大雪球最长持续时间（毫秒）', '当前根MaxDuration；滚动过程持续上限。');
  const baseKnockup = ms(x, 'BaseKnockupDuration', 'base_knockup_duration_ms', '史上最大雪球基础击飞持续时间（毫秒）', '当前根MaximumStunDuration基础项。');
  const extraKnockup = ms(x, 'AdditionalKnockupOverTime', 'additional_knockup_over_time_ms', '史上最大雪球随滚动击飞增量（毫秒）', '当前根AdditionalKnockupOverTime；根MaximumStunDuration实际消费的是AdditionalStunDurationOverTime，两者分开保存。');
  const extraStun = ms(x, 'AdditionalStunDurationOverTime', 'additional_stun_duration_ms', '史上最大雪球随滚动额外控制时间（毫秒）', '当前根MaximumStunDuration第二项。');
  const minimumDistance = ratio(x, 'NoImpactDamageScalar', 'minimum_distance_damage_scalar', '史上最大雪球最低滚动距离伤害倍率', '当前根NoImpactSnowballDamage的mMultiplier；当前正文把它作为滚动距离伤害下界，不把它解释为固定提前释放伤害。');
  const maxRoll = data(x, 'MaximumSnowballRollDistance', 'maximum_roll_distance', '史上最大雪球最大滚动距离', '当前根MaximumSnowballRollDistance。');
  const minRoll = data(x, 'MinimumSnowballRollDistance', 'minimum_roll_distance', '史上最大雪球最小滚动距离', '当前根MinimumSnowballRollDistance。');
  const slow = negativeRatio(x, 'SlowAmount', 'slow_ratio', '史上最大雪球减速比例', '当前根SlowAmount为负移动速度修正；按负值取正幅度，避免把负修正称为负减速。');
  const slowDuration = ms(x, 'SlowDuration', 'slow_duration_ms', '史上最大雪球减速持续时间（毫秒）', '当前根SlowDuration。');
  const minRadius = data(x, 'MinimumSnowballRadius', 'minimum_snowball_radius', '史上最大雪球最小半径', '当前根MinimumSnowballRadius。');
  const maxRadius = data(x, 'MaximumSnowballRadius', 'maximum_snowball_radius', '史上最大雪球最大半径', '当前根MaximumSnowballRadius。');
  const initialSpeed = data(x, 'AdditionalStartingSpeed', 'additional_starting_speed', '史上最大雪球额外初速度', '当前根AdditionalStartingSpeed。');
  const speedPerLevel = data(x, 'AdditionalSpeedPerLevel', 'additional_speed_per_level', '史上最大雪球每级额外速度', '当前根AdditionalSpeedPerLevel；数值保存，不猜等级算法。');
  const speedCapPerLevel = data(x, 'AdditionalSpeedCapPerLevel', 'additional_speed_cap_per_level', '史上最大雪球每级额外速度上限', '当前根AdditionalSpeedCapPerLevel；数值保存，不猜等级算法。');
  const missileSpeed = data(x, 'MinimumSnowballMissileSpeed', 'minimum_missile_speed', '史上最大雪球最小飞行速度', '当前根MinimumSnowballMissileSpeed。');
  const largeTime = ms(x, 'LargeSnowballTime', 'large_snowball_time_ms', '史上最大雪球大型判定时间（毫秒）', '当前根LargeSnowballTime。');
  const mediumTime = ms(x, 'MediumSnowballTime', 'medium_snowball_time_ms', '史上最大雪球中型判定时间（毫秒）', '当前根MediumSnowballTime。');
  const largeWidth = data(x, 'LargeSnowballMissileWidth', 'large_missile_width', '史上最大雪球大型飞行宽度', '当前根LargeSnowballMissileWidth。');
  const mediumWidth = data(x, 'MediumSnowballMissileWidth', 'medium_missile_width', '史上最大雪球中型飞行宽度', '当前根MediumSnowballMissileWidth。');
  const smallWidth = data(x, 'SmallSnowballMissileWidth', 'small_missile_width', '史上最大雪球小型飞行宽度', '当前根SmallSnowballMissileWidth。');
  const apRatio = ratio(x, 'MaximumAPRatio', 'maximum_ap_ratio', '史上最大雪球最高伤害法强比例', '当前根MaximumSnowballDamage的mCoefficient关联DataValue，按法术强度窄口径保留。');
  const maximumDamageExpression = add(base, mul(apRatio, AP()));
  formula(x, 'maximum_damage', '史上最大雪球最高魔法伤害数学量', maximumDamageExpression, 'MaximumSnowballDamage = BaseDamage + MaximumAPRatio×来源法术强度。');
  formula(x, 'minimum_distance_damage', '史上最大雪球最低滚动距离魔法伤害数学量', mul(minimumDistance, maximumDamageExpression), 'NoImpactSnowballDamage = NoImpactDamageScalar×MaximumSnowballDamage；当前正文将其用于滚动距离伤害下界，具体距离连续关系和命中时点仍待接线。');
  formula(x, 'maximum_stun_duration_ms', '史上最大雪球最高击飞时间', add(baseKnockup, extraStun), 'MaximumStunDuration = BaseKnockupDuration + AdditionalStunDurationOverTime；按源树保留毫秒单位。');
  noteDamage(x, 'maximum_damage');
  noteDamage(x, 'minimum_distance_damage');
  markCalc(x, 'MaximumSnowballDamage', '最高伤害树已展开；mCoefficient按当前法术强度语义保留。');
  markCalc(x, 'NoImpactSnowballDamage', '完整保留mMultiplier=NoImpactDamageScalar的最低滚动距离端点分支，不称为固定提前释放伤害。');
  markCalc(x, 'MaximumStunDuration', '最高控制时间树已展开；不把滚动时间误作伤害周期。');
  pending(x, '滚动距离、碰撞与再施放', '正文明确雪球随距离增长、碰撞英雄或大型野怪并可提前再次施放；距离到伤害的连续关系、碰撞资格和事件时点尚未接线。', '系统');
  void maxDamageTime; void maxDamageScalar; void maxDuration; void extraKnockup; void slow; void slowDuration;
  void maxRoll; void minRoll; void minRadius; void maxRadius; void initialSpeed; void speedPerLevel; void speedCapPerLevel;
  void missileSpeed; void largeTime; void mediumTime; void largeWidth; void mediumWidth; void smallWidth;
}
{
  const x = start('nunu_e');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '雪球飞射单团基础魔法伤害', '当前根TotalSnowballDamage基础项。');
  const slow = negativeRatio(x, 'SlowAmount', 'slow_ratio', '雪球飞射减速比例', '当前中文正文使用SlowAmount×-100%显示；按负值取正比例。');
  const slowDuration = ms(x, 'SlowDuration', 'slow_duration_ms', '雪球飞射减速持续时间（毫秒）', '当前根SlowDuration。');
  const rootDamage = data(x, 'RootDamage', 'root_base_damage', '雪球飞射禁锢额外基础魔法伤害', '当前根TotalRootDamage基础项。');
  const totalDuration = ms(x, 'TotalSpellDuration', 'total_spell_duration_ms', '雪球飞射完成时间（毫秒）', '当前根TotalSpellDuration；不创建自动过程。');
  const delay = ms(x, 'DelayBetweenSnowballs', 'delay_between_snowballs_ms', '雪球飞射两团之间延迟（毫秒）', '当前根DelayBetweenSnowballs；不把延迟当伤害周期。');
  const coneLength = data(x, 'SplashConeLength', 'splash_cone_length', '雪球飞射溅射锥长度', '当前根SplashConeLength。');
  const coneAngle = data(x, 'SplashConeAngle', 'splash_cone_angle', '雪球飞射溅射锥角度', '当前根SplashConeAngle。');
  const apSnowball = literal(x, 'snowball_ap_ratio', '雪球飞射单团法强比例', 0.12, '当前根TotalSnowballDamage的mCoefficient=0.12；无mStat字段但当前技能正文为魔法伤害，按来源法术强度窄口径绑定。', 'mSpellCalculations.TotalSnowballDamage');
  const apRoot = literal(x, 'root_ap_ratio', '雪球飞射禁锢额外法强比例', 0.8, '当前根TotalRootDamage的mCoefficient=0.8；按来源法术强度窄口径绑定。', 'mSpellCalculations.TotalRootDamage');
  const rootDuration = unknownCurve(x, 'root_duration_ms', '雪球飞射禁锢持续时间（毫秒）', requireCalc(x, 'RootDuration'), 'mSpellCalculations.RootDuration', '当前根只给角色等级0.5至1.5秒插值节点；未知等级求值不猜，实际值无默认由运行输入提供。', 'INTEGER');
  formula(x, 'snowball_damage', '雪球飞射单团魔法伤害数学量', add(base, mul(apSnowball, AP())), 'TotalSnowballDamage = BaseDamage + 0.12×来源法术强度；三团命中同一目标的次数由事件接线处理。');
  formula(x, 'root_damage', '雪球飞射禁锢额外魔法伤害数学量', add(rootDamage, mul(apRoot, AP())), 'TotalRootDamage = RootDamage + 0.8×来源法术强度；完成时间和禁锢资格尚未接线。');
  literal(x, 'snowball_count', '雪球飞射雪球数量', 3, '当前官方中文正文明确投掷3团雪球。', 'Spell_NunuEAbility_Tooltip');
  literal(x, 'recast_count', '雪球飞射额外再施放次数', 2, '当前官方中文正文明确至多再次施放2次。', 'Spell_NunuEAbility_Tooltip');
  noteDamage(x, 'snowball_damage');
  noteDamage(x, 'root_damage');
  markCalc(x, 'TotalSnowballDamage', '单团伤害树已展开；保留三团同目标命中关系为数量参数。');
  markCalc(x, 'TotalRootDamage', '额外伤害树已展开。');
  markCalc(x, 'RootDuration', '保留角色等级插值原树，不猜等级算法和默认值。');
  pending(x, '三团命中与完成后禁锢', '正文明确三团同目标、最多两次再施放和完成后禁锢已被减速敌人；命中计数、目标资格、禁锢事件尚未接线。', '系统');
  void slow; void slowDuration; void totalDuration; void delay; void coneLength; void coneAngle; void rootDuration;
}
{
  const x = start('nunu_r');
  standard(x);
  const baseDamage = data(x, 'BaseDamage', 'base_damage', '绝对零度最高基础魔法伤害', '当前根MaximumDamage基础项。');
  const slowStart = negativeRatio(x, 'SlowStartAmount', 'slow_start_ratio', '绝对零度初始减速比例', '当前中文正文使用SlowStartAmount×-100%显示；按负值取正比例。');
  const maxSlow = negativeRatio(x, 'MaxSlowAmount', 'max_slow_ratio', '绝对零度最大减速比例', '当前中文正文使用MaxSlowAmount×-100%显示；按负值取正比例。');
  const channel = ms(x, 'ChannelDuration', 'channel_duration_ms', '绝对零度最大引导时间（毫秒）', '当前根ChannelDuration。');
  const slowDuration = ms(x, 'SlowDuration', 'slow_duration_ms', '绝对零度减速持续时间（毫秒）', '当前根SlowDuration。');
  const shieldDuration = ms(x, 'MaxShieldDuration', 'max_shield_duration_ms', '绝对零度护盾最大持续时间（毫秒）', '当前根MaxShieldDuration；与3秒衰减时间分开保存，不把衰减时长当护盾总时长。');
  const shieldDecay = ms(x, 'ShieldDecayDuration', 'shield_decay_duration_ms', '绝对零度护盾衰减时间（毫秒）', '当前根ShieldDecayDuration；衰减阶段尚无可复用的生命周期分段语义。');
  const shieldBase = data(x, 'BaseShieldAmount', 'base_shield_amount', '绝对零度基础护盾值', '当前根TotalShieldAmount基础项。');
  const shieldHpRatio = ratio(x, 'ShieldBonusHealthPercent', 'shield_bonus_hp_ratio', '绝对零度额外生命值护盾比例', '当前根TotalShieldAmount的mStat=12、mStatFormula=2；按已证窄口径绑定来源额外生命值。');
  const shieldApRatio = literal(x, 'shield_ap_ratio', '绝对零度护盾法强比例', 1.5, '当前根TotalShieldAmount的无mStat mCoefficient=1.5；按当前法术强度语义保留，来源所有者字段待运行核对。', 'mSpellCalculations.TotalShieldAmount');
  const apRatio = literal(x, 'damage_ap_ratio', '绝对零度最高伤害法强比例', 3, '当前根MaximumDamage的无mStat mCoefficient=3；按当前法术强度语义保留。', 'mSpellCalculations.MaximumDamage');
  formula(x, 'shield_amount', '绝对零度引导护盾数学量', add(add(shieldBase, mul(shieldHpRatio, BHP())), mul(P('shield_ap_ratio'), AP())), 'TotalShieldAmount = BaseShieldAmount + ShieldBonusHealthPercent×来源额外生命值 + 1.5×来源法术强度；护盾分段衰减不在此公式内。');
  const maximumDamageExpression = add(baseDamage, mul(P('damage_ap_ratio'), AP()));
  formula(x, 'maximum_damage', '绝对零度最高魔法伤害数学量', maximumDamageExpression, 'MaximumDamage = BaseDamage + 3×来源法术强度；引导时间到伤害的连续关系尚未接线。');
  noteDamage(x, 'maximum_damage');
  markCalc(x, 'TotalShieldAmount', '护盾树已展开额外生命值和法强两项；保留mStatFormula=2。');
  markCalc(x, 'MaximumDamage', '最高伤害树已展开。');
  markCalc(x, 'MinDamage', '当前根MinDamage仅为tooltipOnly且当前绑定正文未消费；只留原树证据，不生成半伤公式。');
  pending(x, '引导时长、护盾衰减与最低伤害显示分支', '正文明确至多3秒引导、引导期间护盾并在之后3秒衰减；当前效果生命周期不能同时表达引导阶段和之后衰减阶段。MinDamage仅为tooltipOnly且正文未消费，本候选不把0.5倍称为提前结束固定伤害。', '系统');
  void slowStart; void maxSlow; void channel; void slowDuration; void shieldDuration; void shieldDecay;
}

// 北地之怒：瑟庄妮
{
  const x = start('sejuani_p');
  common(x, { cooldown: false, mana: false });
  const frostDuration = ms(x, 'FrostArmorDuration', 'frost_armor_duration_ms', '北地之怒冰霜护甲受击后持续时间（毫秒）', '当前根FrostArmorDuration。');
  excludeData(x, 'EpicMonsterCap', '仅史诗野怪伤害上限；不进入英雄目标分支。');
  const armorRatio = ratio(x, 'BonusArmorRatio', 'bonus_armor_ratio', '北地之怒额外护甲比例', '当前根TotalArmorTooltip的mStat=1、mStatFormula=2；来源额外护甲语义由根树明确，按护甲属性绑定。');
  const mrRatio = ratio(x, 'BonusMRRatio', 'bonus_mr_ratio', '北地之怒额外魔抗比例', '当前根TotalMRTooltip的mStat=6、mStatFormula=2；按已证窄口径绑定来源额外魔法抗性。');
  const armorBase = data(x, 'BonusArmorBase', 'bonus_armor_base', '北地之怒基础额外护甲', '当前根TotalArmorTooltip基础项。');
  const mrBase = data(x, 'BonusMRBase', 'bonus_mr_base', '北地之怒基础额外魔法抗性', '当前根TotalMRTooltip基础项。');
  const hpDamageRatio = ratio(x, 'PercentHPDamageBase', 'stunned_target_max_hp_damage_ratio', '北地之怒破甲护甲目标最大生命值伤害比例', '当前根PercentHPDamage仅给比例；正文明确击碎冰霜护甲后对被晕眩敌人造成巨量魔法伤害，目标最大生命值由运行时提供。');
  const sourceBonusArmor = (() => { runtime(x, 'source_bonus_armor', '北地之怒来源额外护甲（运行输入）', '当前根TotalArmorTooltip使用mStat=1、mStatFormula=2；本批没有共享窄证确认该选择器，实际来源额外护甲由运行时提供，不默认。'); return P('source_bonus_armor'); })();
  formula(x, 'frost_armor_amount', '北地之怒额外护甲数学量', add(armorBase, mul(armorRatio, sourceBonusArmor)), 'TotalArmorTooltip = BonusArmorBase + BonusArmorRatio×来源额外护甲运行输入；mStat=1、mStatFormula=2的选择器不在本批猜测。');
  formula(x, 'frost_mr_amount', '北地之怒额外魔抗数学量', add(mrBase, mul(mrRatio, MR())), 'TotalMRTooltip = BonusMRBase + BonusMRRatio×来源额外魔法抗性；应用时增加魔抗。');
  const targetHp = (() => { runtime(x, 'target_max_health', '被晕眩目标最大生命值', '北地之怒正文把破甲伤害绑定目标最大生命值；目标属性由运行时提供，不默认。'); return P('target_max_health'); })();
  formula(x, 'armor_break_damage', '北地之怒破甲后魔法伤害数学量', mul(hpDamageRatio, targetHp), 'PercentHPDamage×目标最大生命值；击碎资格和实际伤害结果尚未接线。');
  const ooc = unknownCurve(x, 'frost_armor_ooc_ms', '北地之怒脱战获得冰霜护甲时间（毫秒）', requireCalc(x, 'FrostArmorOOC'), 'mSpellCalculations.FrostArmorOOC', '当前根只给角色等级12秒至6秒插值节点；未知等级求值不猜，实际值无默认由运行输入提供。', 'INTEGER');
  noteDamage(x, 'armor_break_damage');
  markCalc(x, 'PercentHPDamage', '保留冰霜护甲击碎伤害比例树，目标最大生命值作为无默认运行输入。');
  markCalc(x, 'TotalArmorTooltip', '护甲树完整展开mStat=1、mStatFormula=2。');
  markCalc(x, 'TotalMRTooltip', '魔抗树完整展开mStat=6、mStatFormula=2。');
  markCalc(x, 'FrostArmorOOC', '保留角色等级脱战时间插值原树，不猜等级算法。');
  pending(x, '脱战、受击和冰霜护甲属性应用', '正文明确脱战获得、受伤后冰霜护甲保留3000毫秒以及攻击被晕眩敌人击碎；3000毫秒是受伤后的保留尾段，不是获得护甲后的通用生命周期。触发、取消、属性应用、目标资格和伤害事件尚未接线。', '系统');
  void frostDuration; void ooc; void sourceBonusArmor;
}
{
  const x = start('sejuani_q');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '极寒突袭基础魔法伤害', '当前根TotalDamageTooltip基础项。');
  const apRatio = ratio(x, 'APRatio', 'ap_ratio', '极寒突袭法强比例', '当前根TotalDamageTooltip第二项；按当前法术强度窄口径绑定。');
  const maxDistance = data(x, 'MaxTravelDistance', 'max_travel_distance', '极寒突袭最大冲锋距离', '当前根MaxTravelDistance。');
  const dashSpeed = data(x, 'DashSpeed', 'dash_speed', '极寒突袭冲锋速度', '当前根DashSpeed。');
  const knockup = ms(x, 'KnockupDurationTOOLTIPONLY', 'knockup_duration_ms', '极寒突袭击飞持续时间（毫秒）', '当前根KnockupDurationTOOLTIPONLY；仅保存明确控制参数，不创建控制状态。');
  formula(x, 'total_damage', '极寒突袭魔法伤害数学量', add(base, mul(apRatio, AP())), 'TotalDamageTooltip = BaseDamage + APRatio×来源法术强度。');
  noteDamage(x, 'total_damage');
  markCalc(x, 'TotalDamageTooltip', '伤害树已展开。');
  pending(x, '首个英雄命中停止', '正文明确冲锋命中一名敌方英雄后停止；冲锋过程、首个目标和控制结果尚未接线。', '系统');
  void maxDistance; void dashSpeed; void knockup;
}
{
  const x = start('sejuani_w');
  standard(x);
  const slow = ratio(x, 'SlowAmount', 'slow_ratio', '凛冬之怒减速比例', '当前根SlowAmount；正文明确暂时减速，保留0至1比例。');
  const slowDuration = ms(x, 'SlowDuration', 'slow_duration_ms', '凛冬之怒减速持续时间（毫秒）', '当前根SlowDuration。');
  const baseOne = data(x, 'BaseDamageOne', 'first_hit_base_damage', '凛冬之怒第一段基础物理伤害', '当前根FirstHitDamageTooltip基础项。');
  const baseTwo = data(x, 'BaseDamageTwo', 'second_hit_base_damage', '凛冬之怒第二段基础物理伤害', '当前根SecondHitDamageTooltip基础项。');
  const apOne = ratio(x, 'APRatioOne', 'first_hit_ap_ratio', '凛冬之怒第一段法强比例', '当前根FirstHitDamageTooltip第二项；按当前法术强度窄口径绑定。');
  const apTwo = ratio(x, 'APRatioTwo', 'second_hit_ap_ratio', '凛冬之怒第二段法强比例', '当前根SecondHitDamageTooltip第二项；按当前法术强度窄口径绑定。');
  const hpOne = ratio(x, 'HPRatioOne', 'first_hit_hp_ratio', '凛冬之怒第一段生命值比例', '当前根FirstHitDamageTooltip的mStat=12无mStatFormula；正文为自身生命值收益，按来源总生命值绑定并保留待核。');
  const hpTwo = ratio(x, 'HPRatioTwo', 'second_hit_hp_ratio', '凛冬之怒第二段生命值比例', '当前根SecondHitDamageTooltip的mStat=12无mStatFormula；按来源总生命值绑定并保留待核。');
  formula(x, 'first_hit_damage', '凛冬之怒第一段物理伤害数学量', add(add(baseOne, mul(apOne, AP())), mul(hpOne, HP())), 'FirstHitDamageTooltip = BaseDamageOne + APRatioOne×来源法术强度 + HPRatioOne×来源总生命值；mStat无mStatFormula按正文最大生命值语义绑定。');
  formula(x, 'second_hit_damage', '凛冬之怒第二段物理伤害数学量', add(add(baseTwo, mul(apTwo, AP())), mul(hpTwo, HP())), 'SecondHitDamageTooltip = BaseDamageTwo + APRatioTwo×来源法术强度 + HPRatioTwo×来源总生命值；两段同一目标关系待接线。');
  noteDamage(x, 'first_hit_damage');
  noteDamage(x, 'second_hit_damage');
  markCalc(x, 'FirstHitDamageTooltip', '第一段伤害树完整展开，保留mStat=12原始语义。');
  markCalc(x, 'SecondHitDamageTooltip', '第二段伤害树完整展开，保留mStat=12原始语义。');
  pending(x, '两段挥击和永冻层数', '正文明确两段挥击、两段都施加永冻并对小兵野怪有击退；两段同目标命中和被动层数事件尚未接线。', '系统');
  exclude(x, '小兵野怪击退', '仅非英雄目标控制分支；两段对英雄目标的伤害和减速参数保留。');
  void slow; void slowDuration;
}
{
  const x = start('sejuani_e');
  standard(x);
  const cd = ms(x, 'PerChampionCD', 'per_champion_cooldown_ms', '永冻领域每名英雄目标冷却（毫秒）', '当前根PerChampionCD；这是每目标应用限制，不把它当施放冷却。');
  const base = data(x, 'BaseDamage', 'base_damage', '永冻领域基础魔法伤害', '当前根TotalDamage基础项。');
  const apRatio = ratio(x, 'APRatio', 'ap_ratio', '永冻领域法强比例', '当前根TotalDamage第二项；按当前法术强度窄口径绑定。');
  const cc = ms(x, 'CCDuration', 'stun_duration_ms', '永冻领域晕眩持续时间（毫秒）', '当前根CCDuration。');
  const stacks = data(x, 'MaxStacks', 'max_stacks', '永冻领域所需霜冻层数', '当前根MaxStacks；正文明确4层。');
  const stackDuration = ms(x, 'StackDuration', 'stack_duration_ms', '永冻领域层数持续时间（毫秒）', '当前根StackDuration。');
  const aura = data(x, 'AuraRange', 'aura_range', '永冻领域近战友军范围', '当前根AuraRange；保留范围输入，不创建目标枚举。');
  formula(x, 'total_damage', '永冻领域魔法伤害数学量', add(base, mul(apRatio, AP())), 'TotalDamage = BaseDamage + APRatio×来源法术强度。');
  noteDamage(x, 'total_damage');
  markCalc(x, 'TotalDamage', '伤害树已展开。');
  pending(x, '霜冻层数和主动冻结', '正文明确附近近战友军攻击施加层数，4层后主动造成伤害并晕眩；层数状态、目标资格和控制事件尚未接线。', '系统');
  void cd; void cc; void stacks; void stackDuration; void aura;
}
{
  const x = start('sejuani_r');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '极冰寒狱普通基础魔法伤害', '当前根MinorDamageTooltip基础项。');
  const empoweredBase = data(x, 'EmpoweredBaseDamage', 'empowered_base_damage', '极冰寒狱强化基础魔法伤害', '当前根TotalDamageTooltip基础项。');
  const baseStun = ms(x, 'BaseStunDuration', 'base_stun_duration_ms', '极冰寒狱普通晕眩持续时间（毫秒）', '当前根BaseStunDuration。');
  const zoneDuration = ms(x, 'ZoneDuration', 'zone_duration_ms', '极冰寒狱冰风暴持续时间（毫秒）', '当前根ZoneDuration。');
  const explosionSlow = percent(x, 'ExplosionSlowAmount', 'explosion_slow_ratio', '极冰寒狱爆炸减速比例', '当前官方正文以ExplosionSlowAmount%显示；百分数点转为0至1比例。');
  const explosionSlowDuration = ms(x, 'ExplosionSlowDuration', 'explosion_slow_duration_ms', '极冰寒狱爆炸减速持续时间（毫秒）', '当前根ExplosionSlowDuration。');
  const empoweredStun = ms(x, 'EmpoweredStunDuration', 'empowered_stun_duration_ms', '极冰寒狱强化晕眩持续时间（毫秒）', '当前根EmpoweredStunDuration。');
  const zoneSlow = percent(x, 'ZoneSlowAmount', 'zone_slow_ratio', '极冰寒狱冰风暴减速比例', '当前根ZoneSlowAmount为百分数点；转为0至1比例，作为区域辅助参数。');
  const apMinor = literal(x, 'minor_ap_ratio', '极冰寒狱普通法强比例', 0.4, '当前根MinorDamageTooltip的无mStat mCoefficient=0.4；按当前法术强度窄口径绑定。', 'mSpellCalculations.MinorDamageTooltip');
  const apEmpowered = literal(x, 'empowered_ap_ratio', '极冰寒狱强化法强比例', 0.8, '当前根TotalDamageTooltip的无mStat mCoefficient=0.8；按当前法术强度窄口径绑定。', 'mSpellCalculations.TotalDamageTooltip');
  literal(x, 'empowered_distance_threshold_ratio', '极冰寒狱强化飞行距离阈值', 0.25, '当前官方中文正文明确套索飞行至少最大距离25%时进入强化分支。', 'Spell_SejuaniRAbility_Tooltip');
  formula(x, 'minor_damage', '极冰寒狱普通魔法伤害数学量', add(base, mul(P('minor_ap_ratio'), AP())), 'MinorDamageTooltip = BaseDamage + 0.4×来源法术强度。');
  formula(x, 'empowered_damage', '极冰寒狱强化魔法伤害数学量', add(empoweredBase, mul(P('empowered_ap_ratio'), AP())), 'TotalDamageTooltip = EmpoweredBaseDamage + 0.8×来源法术强度；强化分支保留，不把套索距离默认化。');
  noteDamage(x, 'minor_damage');
  noteDamage(x, 'empowered_damage');
  markCalc(x, 'MinorDamageTooltip', '普通伤害树已展开。');
  markCalc(x, 'TotalDamageTooltip', '强化伤害树已展开。');
  pending(x, '首个英雄、飞行距离和冰风暴', '正文明确命中第一个英雄、飞行距离至少25%进入强化、生成区域并影响受影响敌人；飞行距离、目标选择和区域事件尚未接线。', '系统');
  void baseStun; void zoneDuration; void explosionSlow; void explosionSlowDuration; void empoweredStun; void zoneSlow;
}

// 亡灵战神：赛恩
{
  const x = start('sion_p');
  common(x, { cooldown: false, mana: false });
  const lifesteal = ratio(x, 'Lifesteal', 'death_lifesteal_ratio', '死亡荣耀生命偷取比例', '当前根Lifesteal；正文明确死亡后攻击获得生命偷取，保留1表示100%。');
  const maxHpRatio = ratio(x, 'PercentMaxHP', 'death_attack_target_max_hp_ratio', '死亡荣耀目标最大生命值额外伤害比例', '当前根PercentMaxHP；正文明确死亡后每次攻击按目标最大生命值造成额外伤害。');
  const targetHp = (() => { runtime(x, 'target_max_health', '死亡荣耀目标最大生命值', '死亡后攻击额外伤害绑定目标最大生命值；目标属性由运行时提供，不默认。'); return P('target_max_health'); })();
  formula(x, 'death_attack_extra_damage', '死亡荣耀攻击额外伤害数学量', mul(maxHpRatio, targetHp), '额外伤害 = PercentMaxHP×目标最大生命值；死亡状态、攻击资格和实际命中尚未接线。');
  noteDamage(x, 'death_attack_extra_damage');
  excludeData(x, 'NonChampCap', '仅非英雄目标上限；英雄目标额外伤害分支保留。');
  excludeData(x, 'StructureMod', '仅建筑物伤害修正；不进入英雄目标分支。');
  exclude(x, '死亡冲动替换技能组', '当前中文正文明确死亡后所有技能替换为死亡冲动；本候选不实现替换后的完整技能组，只保留死亡状态下已明确的攻击额外伤害和生命偷取参数。');
  pending(x, '死亡后继续攻击与生命衰减', '正文明确被击杀后短时间继续攻击、生命快速衰减、生命偷取和攻击额外伤害；死亡状态、持续时长、攻击速度和生命衰减事件尚未接线，已保留数值不冒称死亡冲动替换技能组实现。', '系统');
  void lifesteal;
}
{
  const x = start('sion_q');
  standard(x);
  const minRatio = ratio(x, 'ADRatioMin', 'minimum_ad_ratio', '残虐猛击最低总攻击力比例', '当前根MinDamageTotal的mStat=2无mStatFormula；按正文物理伤害绑定来源总攻击力。');
  const maxRatio = ratio(x, 'ADRatioMax', 'maximum_ad_ratio', '残虐猛击最高总攻击力比例', '当前根MaxDamageTotal的mStat=2无mStatFormula；按正文物理伤害绑定来源总攻击力。');
  const lowBase = data(x, 'LowDamage', 'minimum_base_damage', '残虐猛击最低基础物理伤害', '当前根MinDamageTotal基础项。');
  const highBase = data(x, 'HighDamage', 'maximum_base_damage', '残虐猛击最高基础物理伤害', '当前根MaxDamageTotal基础项。');
  const baseStun = ms(x, 'BaseStunTime', 'base_stun_duration_ms', '残虐猛击基础晕眩时间（毫秒）', '当前根BaseStunTime；正文明确最长2.25秒，单独保存。');
  const slow = negativeRatio(x, 'SlowAmount', 'slow_ratio', '残虐猛击减速比例', '当前根SlowAmount为负移动速度修正；正文只写暂时减速，取正幅度并保留来源说明。');
  const charge = (() => {
    const raw = Array.isArray(x.p.mChannelDuration) ? x.p.mChannelDuration.slice(1, x.c.maxLevel + 1) : null;
    if (!raw || raw.length !== x.c.maxLevel) throw Error('残虐猛击蓄力时长缺失');
    return literal(x, 'charge_duration_ms', '残虐猛击最大蓄力时间（毫秒）', raw.map(value => Math.round(Number(value) * 1000)), '当前根channelDuration；正文明确最多2秒蓄力。', 'mSpell.channelDuration');
  })();
  formula(x, 'minimum_damage', '残虐猛击最低物理伤害数学量', add(lowBase, mul(minRatio, AD())), 'MinDamageTotal = LowDamage + ADRatioMin×来源总攻击力。');
  formula(x, 'maximum_damage', '残虐猛击最高物理伤害数学量', add(highBase, mul(maxRatio, AD())), 'MaxDamageTotal = HighDamage + ADRatioMax×来源总攻击力。');
  literal(x, 'knockup_charge_threshold_ms', '残虐猛击击飞所需蓄力时间（毫秒）', 1000, '当前官方中文正文明确蓄力至少1秒时附加击飞。', 'Spell_SionQAbility_Tooltip');
  literal(x, 'maximum_stun_duration_ms', '残虐猛击最高晕眩时间（毫秒）', 2250, '当前官方中文正文明确最长晕眩2.25秒；不把基础1.25秒和最高值混为同一参数。', 'Spell_SionQAbility_Tooltip');
  noteDamage(x, 'minimum_damage');
  noteDamage(x, 'maximum_damage');
  markCalc(x, 'MinDamageTotal', '最低伤害树已展开；mStat=2无mStatFormula按正文总攻击力语义绑定。');
  markCalc(x, 'MaxDamageTotal', '最高伤害树已展开；mStat=2无mStatFormula按正文总攻击力语义绑定。');
  excludeData(x, 'MinionRatio', '小兵专用伤害比例，不进入英雄目标分支。');
  excludeData(x, 'MonsterRatio', '野怪专用伤害比例，不进入英雄目标分支。');
  pending(x, '蓄力、释放和控制', '正文明确最多2秒蓄力、至少1秒附加击飞并按蓄力时间增加晕眩；蓄力时长到伤害和控制的连续关系、命中事件尚未接线。', '系统');
  void slow; void charge; void baseStun;
}
{
  const x = start('sion_w');
  standard(x);
  const shieldHp = ratio(x, 'ShieldPercentHealthTooltip', 'shield_max_hp_ratio', '灵魂熔炉护盾最大生命值比例', '当前根TotalShield的mStat=12无mStatFormula；正文明确最大生命值，绑定来源总生命值。');
  excludeData(x, 'DamagePercentHealthTooltip', '当前根旧显示字段未被爆炸伤害计算树消费；正文主技能伤害比例使用MaxHPDamageRatio，本字段不进入候选。');
  const hpChamp = data(x, 'HPPerChampKill', 'hp_per_champion_kill', '灵魂熔炉参与击杀英雄或大型单位获得生命值', '当前根HPPerChampKill；保留明确前置成长，不创建自动叠层。');
  const hpKill = data(x, 'HPPerKill', 'hp_per_kill', '灵魂熔炉普通击杀获得生命值', '当前根HPPerKill；保留非英雄前置进度，不创建自动叠层。');
  const hpLarge = data(x, 'HPPerLargeKill', 'hp_per_large_kill', '灵魂熔炉大型单位击杀获得生命值', '当前根HPPerLargeKill；保留非英雄前置进度，不创建自动叠层。');
  const shieldAp = ratio(x, 'ShieldAPRatio', 'shield_ap_ratio', '灵魂熔炉护盾法强比例', '当前根TotalShield第二项；按当前法术强度窄口径绑定。');
  const damageAp = ratio(x, 'DamageAPRatio', 'damage_ap_ratio', '灵魂熔炉爆炸法强比例', '当前根TotalDamage第二项；按当前法术强度窄口径绑定。');
  const shieldBase = data(x, 'BaseShield', 'base_shield', '灵魂熔炉基础护盾值', '当前根TotalShield基础项。');
  const damageBase = data(x, 'BaseDamage', 'base_damage', '灵魂熔炉基础魔法伤害', '当前根TotalDamage基础项。');
  const maxHpDamage = percent(x, 'MaxHPDamageRatio', 'max_hp_damage_ratio', '灵魂熔炉爆炸目标最大生命值伤害比例', '当前官方中文正文显示MaxHPDamageRatio×100%；百分数点转为比例。');
  const recast = ms(x, 'DetonateRecastCooldown', 'detonate_recast_cooldown_ms', '灵魂熔炉引爆可再施放等待时间（毫秒）', '当前根DetonateRecastCooldown。');
  const duration = ms(x, 'ShieldDuration', 'shield_duration_ms', '灵魂熔炉护盾持续时间（毫秒）', '当前根ShieldDuration；正文明确6秒。');
  const targetHp = (() => { runtime(x, 'target_max_health', '灵魂熔炉目标最大生命值', '正文明确爆炸伤害外加目标最大生命值比例；目标属性由运行时提供，不默认。'); return P('target_max_health'); })();
  formula(x, 'total_shield', '灵魂熔炉护盾数学量', add(add(shieldBase, mul(shieldAp, AP())), mul(shieldHp, HP())), 'TotalShield = BaseShield + ShieldAPRatio×来源法术强度 + ShieldPercentHealthTooltip×来源总生命值。');
  formula(x, 'total_damage', '灵魂熔炉爆炸魔法伤害数学量', add(add(damageBase, mul(damageAp, AP())), mul(maxHpDamage, targetHp)), '完整正文伤害 = BaseDamage + DamageAPRatio×来源法术强度 + MaxHPDamageRatio×目标最大生命值；不创建即时伤害。');
  shieldEffect(x, 'shield', '灵魂熔炉自身护盾', 'total_shield', 'shield_duration_ms', '当前正文明确主动获得持续6秒护盾。');
  noteDamage(x, 'total_damage');
  markCalc(x, 'TotalShield', '护盾树完整展开总生命值和法强两项。');
  markCalc(x, 'TotalDamage', '根树基础伤害和法强已展开，正文额外目标最大生命值比例另并入完整数学量。');
  pending(x, '击杀成长和三秒再施放', '正文明确击杀获得最大生命值、护盾持续6秒且3秒后可引爆；击杀类别、成长状态、再施放资格和爆炸事件尚未接线。', '系统');
  void hpChamp; void hpKill; void hpLarge; void recast; void duration;
}
{
  const x = start('sion_e');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '杀手怒吼基础魔法伤害', '当前根TotalDamage基础项。');
  const slow = percent(x, 'SlowAmount', 'slow_ratio', '杀手怒吼减速比例', '当前官方中文正文以SlowAmount%显示；百分数点转为比例。');
  const armorShred = percent(x, 'ArmorShred', 'armor_shred_ratio', '杀手怒吼护甲削减比例', '当前官方中文正文以ArmorShred%显示；百分数点转为比例。');
  const slowDuration = ms(x, 'SlowDuration', 'slow_duration_ms', '杀手怒吼减速持续时间（毫秒）', '当前根SlowDuration。');
  const armorDuration = ms(x, 'ArmorShredDuration', 'armor_shred_duration_ms', '杀手怒吼护甲削减持续时间（毫秒）', '当前根ArmorShredDuration。');
  const apRatio = ratio(x, 'APRatio', 'ap_ratio', '杀手怒吼法强比例', '当前根TotalDamage第二项；按当前法术强度窄口径绑定。');
  formula(x, 'total_damage', '杀手怒吼魔法伤害数学量', add(base, mul(apRatio, AP())), 'TotalDamage = BaseDamage + APRatio×来源法术强度。');
  noteDamage(x, 'total_damage');
  markCalc(x, 'TotalDamage', '伤害树已展开。');
  pending(x, '第一个目标和护甲削减', '正文明确冲击波只对第一个敌人造成伤害、减速和护甲削减；目标选择和属性削减应用尚未接线。', '系统');
  exclude(x, '小兵野怪击退及沿途传播', '仅非英雄命中后的击退、沿途等额伤害和效果传播；保留主技能第一个目标的混合伤害和控制参数。');
  void slow; void armorShred; void slowDuration; void armorDuration;
}
{
  const x = start('sion_r');
  standard(x);
  const minBase = data(x, 'MinDamage', 'minimum_base_damage', '蛮横冲撞最低基础物理伤害', '当前根MinDamageTotal基础项。');
  const maxBase = data(x, 'MaxDamage', 'maximum_base_damage', '蛮横冲撞最高基础物理伤害', '当前根MaxDamageTotal基础项。');
  const slow = percent(x, 'SlowAmount', 'slow_ratio', '蛮横冲撞减速比例', '当前官方中文正文以SlowAmount%显示；百分数点转为比例。');
  excludeData(x, 'MinionDamagePercent', '仅小兵伤害专用比例；不进入英雄目标分支。');
  const minStun = ms(x, 'MinStunDuration', 'minimum_stun_duration_ms', '蛮横冲撞最低晕眩持续时间（毫秒）', '当前根MinStunDuration。');
  const maxStun = ms(x, 'MaxStunDuration', 'maximum_stun_duration_ms', '蛮横冲撞最高晕眩持续时间（毫秒）', '当前根MaxStunDuration。');
  const speedCap = data(x, 'MoveSpeedCap', 'move_speed_cap', '蛮横冲撞移动速度上限', '当前根MoveSpeedCap。');
  const channel = (() => {
    const raw = Array.isArray(x.p.mChannelDuration) ? x.p.mChannelDuration.slice(1, x.c.maxLevel + 1) : null;
    if (!raw || raw.length !== x.c.maxLevel) throw Error('蛮横冲撞冲锋时长缺失');
    return literal(x, 'charge_duration_ms', '蛮横冲撞最大冲锋时间（毫秒）', raw.map(value => Math.round(Number(value) * 1000)), '当前根channelDuration；官方中文正文明确不可阻挡冲锋8秒。', 'mSpell.channelDuration');
  })();
  const minAd = literal(x, 'minimum_bonus_ad_ratio', '蛮横冲撞最低额外攻击力比例', 0.6, '当前根MinDamageTotal的mStat=2、mStatFormula=2且mCoefficient=0.6；按已证窄口径绑定来源额外攻击力。', 'mSpellCalculations.MinDamageTotal');
  const maxAd = literal(x, 'maximum_bonus_ad_ratio', '蛮横冲撞最高额外攻击力比例', 1.2, '当前根MaxDamageTotal的mStat=2、mStatFormula=2且mCoefficient=1.2；按已证窄口径绑定来源额外攻击力。', 'mSpellCalculations.MaxDamageTotal');
  formula(x, 'minimum_damage', '蛮横冲撞最低物理伤害数学量', add(minBase, mul(minAd, BAD())), 'MinDamageTotal = MinDamage + 0.6×来源额外攻击力。');
  formula(x, 'maximum_damage', '蛮横冲撞最高物理伤害数学量', add(maxBase, mul(maxAd, BAD())), 'MaxDamageTotal = MaxDamage + 1.2×来源额外攻击力。');
  noteDamage(x, 'minimum_damage');
  noteDamage(x, 'maximum_damage');
  markCalc(x, 'MinDamageTotal', '最低伤害树完整展开mStat=2、mStatFormula=2。');
  markCalc(x, 'MaxDamageTotal', '最高伤害树完整展开mStat=2、mStatFormula=2。');
  pending(x, '冲锋距离、碰撞和再施放', '正文明确不可阻挡冲锋、可调整方向、碰撞英雄或墙体或再次施放后停止，伤害和控制取行进距离；距离到伤害的连续关系、目标选择和事件尚未接线。', '系统');
  void slow; void minStun; void maxStun; void speedCap; void channel;
}

// 雷霆咆哮：沃利贝尔
{
  const x = start('volibear_p');
  common(x, { cooldown: false, mana: false });
  excludeData(x, 'PDamageRatio', '当前根PDamageRatio未被ChainLightningDamage计算树消费；原始被动伤害比例只留证据，不与实际使用的APRatio混用。');
  const ratioDamage = ratio(x, 'APRatio', 'passive_ap_ratio', '狂雷渐起额外魔法伤害法强比例', '当前根ChainLightningDamage第二项；按当前法术强度窄口径绑定。');
  const maxStacks = data(x, 'BounceCounterMax', 'bounce_counter_max', '狂雷渐起最大弹跳或层数上限', '当前根BounceCounterMax；正文明确攻击最终影响附近敌人，实际层数语义留待系统核对。');
  const buffDuration = ms(x, 'BuffDuration', 'buff_duration_ms', '狂雷渐起增益持续时间（毫秒）', '当前根BuffDuration。');
  const attackSpeed = ratio(x, 'PAttackSpeed', 'attack_speed_per_stack_ratio', '狂雷渐起每层攻击速度比例', '当前根PAttackSpeed；正文明确攻击和技能提供攻击速度，1表示100%。');
  const attackSpeedApRatio = literal(x, 'attack_speed_ap_ratio', '狂雷渐起每层攻击速度法强比例', 0.0003, '当前根AttackSpeedCalc省略属性选择器但给出mCoefficient=0.0003；按已有窄证绑定来源法术强度，不推广到其他省略属性树。', 'mSpellCalculations.AttackSpeedCalc');
  const attackSpeedStacks = (() => { runtime(x, 'attack_speed_stacks', '狂雷渐起当前攻击速度层数（运行输入）', '实际层数由运行时以整数提供；当前根BounceCounterMax给出5层上限，不补默认层数。', 'INTEGER'); return P('attack_speed_stacks'); })();
  const levelBase = unknownCurve(x, 'chain_lightning_base_damage', '狂雷渐起额外魔法伤害等级基础值', requireCalc(x, 'ChainLightningDamage'), 'mSpellCalculations.ChainLightningDamage.mFormulaParts[0]', '当前根只给角色等级1起点、每级值和4/7/14断点；等级求值不猜，实际基础值无默认由运行输入提供。');
  formula(x, 'chain_lightning_damage', '狂雷渐起额外魔法伤害数学量', add(levelBase, mul(ratioDamage, AP())), 'ChainLightningDamage = 角色等级求值的基础值 + APRatio×来源法术强度；弹跳目标和攻击事件尚未接线。');
  const attackSpeedPerStackExpression = add(attackSpeed, mul(P('attack_speed_ap_ratio'), AP()));
  formula(x, 'attack_speed_per_stack', '狂雷渐起每层攻击速度数学量', attackSpeedPerStackExpression, '每层攻击速度 = PAttackSpeed + 0.0003×来源法术强度；省略属性选择器按已有窄证取法强。');
  formula(x, 'attack_speed_total', '狂雷渐起当前层数总攻击速度数学量', mul(op('MIN', attackSpeedStacks, P('bounce_counter_max')), attackSpeedPerStackExpression), '当前层数总攻击速度 = MIN(运行输入层数,BounceCounterMax)×(PAttackSpeed + 0.0003×来源法术强度)；层数为运行输入整数，5层上限进入公式，负数仍由调用方拒绝。');
  noteDamage(x, 'chain_lightning_damage');
  markCalc(x, 'ChainLightningDamage', '保留角色等级断点树并展开法强项；不猜等级插值。');
  markCalc(x, 'AttackSpeedCalc', '原始攻击速度计算树另含无owner的mCoefficient=0.0003；不把未知属性乘数猜成法强，保留来源待核。');
  markCalc(x, '{ebe98aa3}', '原始tooltipOnly攻击速度树另含mCoefficient=0.04；仅留源，不复制直通显示公式。');
  pending(x, '攻击速度层数和闪电弹跳', '正文明确攻击和技能提供攻击速度并使攻击最终对附近敌人造成额外魔法伤害；层数计数、刷新、0至5整数层数输入、弹跳目标和攻击事件尚未接线。每层法强项已按已有窄证展开，不把层数或APRatio猜成事件。', '系统');
  void maxStacks; void buffDuration;
}
{
  const x = start('volibear_q');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '擂首一击基础物理伤害', '当前根CalculatedDamage基础项。');
  const minSpeed = ratio(x, 'MinSpeed', 'minimum_speed_ratio', '擂首一击最低移动速度比例', '当前根MinSpeed；正文按比例显示，1表示100%。');
  const maxSpeed = ratio(x, 'MaxSpeed', 'maximum_speed_ratio', '擂首一击最高移动速度比例', '当前根MaxSpeed；正文按比例显示，1表示100%。');
  const duration = ms(x, 'Duration', 'buff_duration_ms', '擂首一击增益持续时间（毫秒）', '当前根Duration。');
  const stun = ms(x, 'StunDuration', 'stun_duration_ms', '擂首一击晕眩持续时间（毫秒）', '当前根StunDuration。');
  const bonusAd = ratio(x, 'BonusADRatio', 'bonus_ad_ratio', '擂首一击额外攻击力比例', '当前根CalculatedDamage和ADRatioTooltip的mStat=2、mStatFormula=2；按已证窄口径绑定来源额外攻击力。');
  const range = data(x, 'BonusRange', 'bonus_attack_range', '擂首一击额外攻击距离', '当前根BonusRange。');
  formula(x, 'calculated_damage', '擂首一击物理伤害数学量', add(add(base, AD()), mul(bonusAd, BAD())), 'CalculatedDamage = BaseDamage + 来源总攻击力 + BonusADRatio×来源额外攻击力；完整保留mStat=2无formula和mStatFormula=2两项。');
  noteDamage(x, 'calculated_damage');
  markCalc(x, 'CalculatedDamage', '伤害树完整展开总攻击力和额外攻击力两项。');
  markCalc(x, 'ADRatioTooltip', '仅显示额外攻击力参数，候选不重复创建直通公式。');
  markCalc(x, 'MinSpeedCalc', '仅显示MinSpeed参数，候选不重复创建直通公式。');
  markCalc(x, 'MaxSpeedCalc', '仅显示MaxSpeed参数，候选不重复创建直通公式。');
  markCalc(x, '{10404951}', '保留重复顺序树原字节，不创建第二份相同公式。');
  pending(x, '下一次攻击和被打断刷新', '正文明确激活后下一次攻击伤害并晕眩，朝向敌方英雄时速度翻倍，被定身可提前结束并刷新冷却；资格、朝向和攻击事件尚未接线。', '系统');
  void minSpeed; void maxSpeed; void duration; void stun; void range;
}
{
  const x = start('volibear_w');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '暴怒撕咬基础物理伤害', '当前根TotalDamage基础项。');
  const heal = ratio(x, 'HealPercent', 'missing_health_heal_ratio', '暴怒撕咬已损生命值回复比例', '当前根PercentMissingHealthHealingRatio直接显示HealPercent；按0至1比例保留，不重复建直通公式。');
  const bonusHp = ratio(x, 'BonusHealthRatio', 'bonus_hp_ratio', '暴怒撕咬额外生命值伤害比例', '当前根TotalDamage的mStat=12、mStatFormula=2；按已证窄口径绑定来源额外生命值。');
  const markDuration = ms(x, 'MarkDuration', 'mark_duration_ms', '暴怒撕咬标记持续时间（毫秒）', '当前根MarkDuration。');
  const multiplier = ratio(x, 'W2DamageMultiplier', 'second_cast_damage_multiplier', '暴怒撕咬第二次施放基础倍率', '当前根EmpoweredDamage的mMultiplier第一项。');
  const baseHeal = data(x, 'BaseHeal', 'base_heal', '暴怒撕咬第二次施放基础回复量', '当前正文明确第二次施放回复基础生命值。');
  excludeData(x, 'MinionAndMonsterMod', '当前正文该字段只修正小兵治疗效能；不进入英雄目标伤害或回复数学量，英雄目标第二次施放伤害仍保留。');
  const bonusAdMultiplier = ratio(x, 'W2BonusADDamageMultiplier', 'second_cast_bonus_ad_multiplier', '暴怒撕咬第二次施放额外攻击力倍率增量', '当前根EmpoweredDamage的mStat=2、mStatFormula=2第二项；按已证窄口径绑定来源额外攻击力。');
  const totalAdRatio = literal(x, 'total_ad_ratio', '暴怒撕咬总攻击力比例', 1.1, '当前根TotalDamage的mStat=2无mStatFormula且mCoefficient=1.1；按来源总攻击力语义绑定。', 'mSpellCalculations.TotalDamage');
  const totalDamageExpression = add(add(base, mul(P('total_ad_ratio'), AD())), mul(bonusHp, BHP()));
  formula(x, 'total_damage', '暴怒撕咬首次物理伤害数学量', totalDamageExpression, 'TotalDamage = BaseDamage + 1.1×来源总攻击力 + BonusHealthRatio×来源额外生命值。');
  formula(x, 'empowered_damage', '暴怒撕咬第二次施放物理伤害数学量', mul(add(multiplier, mul(bonusAdMultiplier, BAD())), totalDamageExpression), 'EmpoweredDamage = (W2DamageMultiplier + W2BonusADDamageMultiplier×来源额外攻击力)×TotalDamage；完整保留根mMultiplier及其mSubparts。');
  const missingHealth = (() => { runtime(x, 'source_missing_health', '暴怒撕咬施放者已损失生命值', '正文明确第二次施放回复基础值加已损生命值比例；当前值由运行时提供，不默认。'); return P('source_missing_health'); })();
  formula(x, 'empowered_healing', '暴怒撕咬第二次施放回复数学量', add(baseHeal, mul(heal, missingHealth)), '第二次回复 = BaseHeal + HealPercent×施放者已损失生命值；不创建直接治疗效果。');
  noteDamage(x, 'total_damage');
  noteDamage(x, 'empowered_damage');
  noteHeal(x, 'empowered_healing');
  markCalc(x, 'TotalDamage', '首次伤害树完整展开总攻击力、额外生命值和mStatFormula=2。');
  markCalc(x, 'EmpoweredDamage', '第二次施放完整保留mMultiplier=SumOfSubParts(W2DamageMultiplier,额外攻击力项)。');
  markCalc(x, 'PercentMissingHealthHealingRatio', '仅显示HealPercent，候选使用正文补充的已损生命值输入构造回复数学量。');
  pending(x, '标记再施放和回复时点', '正文明确同一标记目标再次施放会提高伤害并回复；标记资格、再施放事件、已损生命值读取时点和治疗结果尚未接线。', '系统');
  void markDuration;
}
{
  const x = start('volibear_e');
  standard(x);
  const slow = ratio(x, 'SlowAmount', 'slow_ratio', '霹天雳地减速比例', '当前官方中文正文使用SlowAmount×100%显示；保留0至1比例。');
  const base = data(x, 'BaseDamage', 'base_damage', '霹天雳地基础魔法伤害', '当前根CalculatedDamage和TotalDamageTooltip基础项。');
  const targetHpRatio = ratio(x, 'PercentDamage', 'target_max_hp_damage_ratio', '霹天雳地目标最大生命值伤害比例', '当前官方中文正文使用PercentDamage×100%最大生命值；保留0至1比例。');
  const shieldHpRatio = ratio(x, 'ShieldAmount', 'shield_max_hp_ratio', '霹天雳地护盾最大生命值比例', '当前根ShieldValue的mStat=12子项；正文明确最大生命值，绑定来源总生命值。');
  excludeData(x, 'MonsterDamageCapBase', '仅野怪伤害上限基础字段；英雄目标完整伤害保留。');
  const shieldDuration = ms(x, 'ShieldDuration', 'shield_duration_ms', '霹天雳地护盾持续时间（毫秒）', '当前根ShieldDuration。');
  const apRatio = ratio(x, 'APRatio', 'damage_ap_ratio', '霹天雳地伤害法强比例', '当前根CalculatedDamage和TotalDamageTooltip第二项；按当前法术强度窄口径绑定。');
  const shieldApRatio = ratio(x, 'ShieldAPRatio', 'shield_ap_ratio', '霹天雳地护盾法强比例', '当前根ShieldValue第二项；按当前法术强度窄口径绑定。');
  const slowDuration = ms(x, 'SlowDuration', 'slow_duration_ms', '霹天雳地减速持续时间（毫秒）', '当前根SlowDuration。');
  const targetHp = (() => { runtime(x, 'target_max_health', '霹天雳地目标最大生命值', '正文明确伤害包含目标最大生命值比例；目标属性由运行时提供，不默认。'); return P('target_max_health'); })();
  formula(x, 'total_damage', '霹天雳地目标魔法伤害数学量', add(add(base, mul(apRatio, AP())), mul(targetHpRatio, targetHp)), '完整正文伤害 = BaseDamage + APRatio×来源法术强度 + PercentDamage×目标最大生命值；不创建即时伤害。');
  formula(x, 'shield_value', '霹天雳地自身护盾数学量', add(mul(shieldHpRatio, HP()), mul(shieldApRatio, AP())), 'ShieldValue = ShieldAmount×来源总生命值 + ShieldAPRatio×来源法术强度。');
  shieldEffect(x, 'shield', '霹天雳地落点自身护盾', 'shield_value', 'shield_duration_ms', '当前正文明确自身在闪电落点区域内获得护盾。');
  noteDamage(x, 'total_damage');
  markCalc(x, 'ShieldValue', '护盾树完整展开总生命值和法强两项。');
  markCalc(x, 'CalculatedDamage', '根基础伤害和法强树已展开；正文目标最大生命值比例另并入完整数学量。');
  markCalc(x, 'TotalDamageTooltip', '根显示树与CalculatedDamage相同，不重复创建直通公式。');
  markCalc(x, 'APRatioTooltip', '仅显示法强比例，候选不重复创建直通公式。');
  markCalc(x, 'ShieldAPRatioTooltip', '仅显示护盾法强比例，候选不重复创建直通公式。');
  markCalc(x, 'MonsterDamageCap', '仅野怪伤害上限树，逐支排除。');
  pending(x, '落点、自身区域和减速', '正文明确落点敌人受伤减速且自身在区域内获得护盾；区域命中、目标选择和护盾触发尚未接线。', '系统');
  void slow; void slowDuration;
}
{
  const x = start('volibear_r');
  standard(x);
  const sweetBase = data(x, 'SweetSpotDamage', 'sweet_spot_base_damage', '天声震落压中敌人基础物理伤害', '当前根SweetSpotDamageTooltip和{4402b0fa}基础项。');
  const dashSpeed = data(x, 'DashSpeed', 'dash_speed', '天声震落跳跃速度', '当前根DashSpeed。');
  const transformDuration = ms(x, 'TransformDuration', 'transform_duration_ms', '天声震落强化持续时间（毫秒）', '当前根TransformDuration；保留自身强化时长，不把变形当完整替换技能组。');
  const health = data(x, 'HealthAmount', 'health_gain', '天声震落自身生命值增益', '当前根{d9a2963e}和正文HealthAmount；保留自身强化数值，具体属性应用待系统核对。');
  excludeData(x, 'TowerDamage', '仅建筑物专用伤害基础值；英雄目标压中伤害保留。');
  const slow = ratio(x, 'SlowAmount', 'slow_ratio', '天声震落减速比例', '当前官方中文正文使用SlowAmount×100%显示；保留0至1比例。');
  const slowDuration = ms(x, 'SlowDuration', 'slow_duration_ms', '天声震落减速衰减持续时间（毫秒）', '当前根SlowDuration；正文明确减速在1秒内持续衰减。');
  const range = data(x, 'BonusAttackRange', 'bonus_attack_range', '天声震落额外攻击距离', '当前根BonusAttackRange；正文明确强化期间获得攻击距离。');
  const apRatio = ratio(x, 'APRatio', 'ap_ratio', '天声震落压中法强比例', '当前根SweetSpotDamageTooltip第二项；按当前法术强度窄口径绑定。');
  const bonusAdRatio = literal(x, 'bonus_ad_ratio', '天声震落压中额外攻击力比例', 2.5, '当前根SweetSpotDamageTooltip和ADRatio的mStat=2、mStatFormula=2、mCoefficient=2.5；按已证窄口径绑定来源额外攻击力。', 'mSpellCalculations.ADRatio');
  formula(x, 'sweet_spot_damage', '天声震落压中敌人物理伤害数学量', add(add(sweetBase, mul(P('ap_ratio'), AP())), mul(P('bonus_ad_ratio'), BAD())), 'SweetSpotDamageTooltip = SweetSpotDamage + APRatio×来源法术强度 + 2.5×来源额外攻击力；保留压中英雄目标分支。');
  attributeEffect(x, 'attack_range', '天声震落自身额外攻击距离', val('bonus_attack_range'), 'attack_range', 'transform_duration_ms', '正文明确变形期间获得额外攻击距离。');
  noteDamage(x, 'sweet_spot_damage');
  markCalc(x, 'ADRatio', '保留2.5倍额外攻击力原树，不重复创建直通公式。');
  markCalc(x, '{4402b0fa}', '压中伤害树完整展开法强和额外攻击力两项。');
  markCalc(x, 'APRatioTooltip', '仅显示法强比例，候选不重复创建直通公式。');
  markCalc(x, 'SweetSpotDamageTooltip', '压中敌人树已展开，保留英雄目标分支。');
  markCalc(x, 'TowerDamageTooltip', '建筑物专用伤害树，逐支排除。');
  markCalc(x, '{d9a2963e}', '保留自身生命值增益原树和正文数值；属性应用语义待系统核对。');
  excludeData(x, 'TowerDisableDuration', '仅建筑物失效时长；不进入英雄目标分支。');
  pending(x, '跳跃、压中区域和生命值增益', '正文明确变形、跳跃、获得生命值和攻击距离、压中敌人造成伤害并减速；跳跃命中、直接压中资格、减速衰减、生命值增益应用和建筑物分支尚未接线。', '系统');
  void dashSpeed; void transformDuration; void health; void slow; void slowDuration; void range;
}

for (const instance of instances) finish(instance);
