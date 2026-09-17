import {
  plan, begin, common, data, effectData, literal, runtime, unknownCurve, formula,
  pending, exclude, excludeData, requireCalc, markCalc, sourceProof, result, effect,
  val, fval, pn, attr, add, mul, fixed, life, behavior, ammoData, ammoCount, finish
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
const ms = (x, source, key, name, description) => data(x, source, key, name, { scale: 1000, unit: '秒转毫秒', description });
const ratioData = (x, source, key, name, description) => data(x, source, key, name, { scale: 0.01, unit: '百分数点转比例', description });
const noteDamage = (x, key) => pending(x, '伤害结果：' + key, '只保存当前根计算树可独立定义的数学量；命中资格、目标选择、抗性和实际伤害结果尚未接线，不创建即时伤害。', '来源');
const noteHeal = (x, key) => pending(x, '治疗结果：' + key, '只保存当前根或正文可独立定义的治疗数学量；治疗时点、目标和实际治疗结果尚未接线。', '来源');
const standard = (x, options = {}) => {
  common(x, options.common ?? {});
  pending(x, '施放、命中和事件接线', '本候选只保存确定参数、数学关系和少量自身组成；实际施放、命中、强化资格、控制与运行输入尚未接线。');
};

function shieldEffect(x, key, name, formulaKey, durationKey, description) {
  effect(x, key, name, [
    result('shield', name, 'NORMAL_SHIELD', 'SOURCE', fval(formulaKey), { absorbedDamageTypeKey: null, decayMode: 'NONE' }, behavior)
  ], life(P(durationKey)), description + '；仅表示独立护盾组成，施放资格和实际吸收尚未接线。');
}

// 放逐之刃
{
  const x = start('riven_p');
  data(x, 'Charges', 'charge_max', '符文之刃最大充能层数');
  literal(x, 'charge_duration_ms', '充能持续时间（毫秒）', 6000, '当前绑定中文正文明确每层充能持续6秒。', 'Spell_RivenPassive_Tooltip');
  const ratio = unknownCurve(x, 'passive_damage_ratio', '充能攻击额外伤害攻击力比例', requireCalc(x, 'TotalDamage'), 'mSpellCalculations.TotalDamage', '客户端只给出角色等级30%至45%的断点插值树；等级求值不在本批猜测，实际比例无默认由运行输入提供。');
  formula(x, 'passive_damage', '符文之刃额外物理伤害', mul(ratio, AD()), '额外伤害 = 角色等级求值的伤害比例×来源总攻击力；每次攻击消耗一层和暴击资格待事件接线。');
  markCalc(x, 'TotalDamage', '保留客户端角色等级伤害比例树；候选只展开攻击力乘法。');
  noteDamage(x, 'passive_damage');
  excludeData(x, 'TowerRatio', '仅建筑物专用的额外伤害修正；不进入1对1英雄技能候选。');
  excludeData(x, 'MonsterBonusDamage', '仅野怪专用的额外伤害；不扩大到英雄目标分支。');
  pending(x, '充能产生、消耗与失效', '技能施放产生充能、攻击消耗充能和6秒失效需要运行状态；本批保留层数上限与持续时间，不创建内部状态或自动触发。', '系统');
  finish(x);
}
{
  const x = start('riven_q');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '折翼之舞基础物理伤害');
  const ratio = data(x, 'ADRatio', 'ad_ratio', '折翼之舞攻击力系数');
  formula(x, 'first_slash_damage', '折翼之舞单段物理伤害', add(base, mul(ratio, AD())), 'FirstSlashDamage = BaseDamage + ADRatio×来源总攻击力；三段展示值相同，不复制三条直通公式。');
  literal(x, 'recast_count', '折翼之舞总段数', 3, '当前官方中文正文明确技能最多重新激活3次，第三段效果不同。', 'Spell_RivenTriCleave_Tooltip');
  literal(x, 'third_recast_knockup_duration_ms', '第三段击飞持续时间（毫秒）', 750, '当前绑定中文正文明确第三段造成0.75秒击飞。', 'Spell_RivenTriCleave_Tooltip');
  markCalc(x, 'FirstSlashDamage', '三次施放均引用同一个当前根 FirstSlashDamage 树；第三段控制单独留参数。');
  noteDamage(x, 'first_slash_damage');
  pending(x, '三段再施放时窗和第三段控制', '当前正文明确最多三段和第三段击飞，但没有可安全复用的再施放时窗字段；不把冷却参数当再施放间隔，不创建击飞状态。', '来源');
  exclude(x, '最后一段穿过地形', '仅移动几何分支，与1对1伤害组成无关；当前候选保留技能主体而不创建位移过程。');
  finish(x);
}
{
  const x = start('riven_w');
  standard(x);
  const base = data(x, 'BaseDamage', 'base_damage', '震魂怒吼基础物理伤害');
  const stun = ms(x, 'StunDuration', 'stun_duration_ms', '震魂怒吼晕眩持续时间');
  formula(x, 'total_damage', '震魂怒吼物理伤害', add(base, BAD()), '当前根TotalDamage的mStat=2、mStatFormula=2对应来源额外攻击力；只保存独立数学量。');
  markCalc(x, 'TotalDamage', '客户端TotalDamage的1倍额外攻击力关系已展开，保留mStatFormula=2。');
  noteDamage(x, 'total_damage');
  pending(x, '范围命中与晕眩', '正文明确附近敌人和晕眩持续时间；范围命中、目标资格与控制结果尚未接线。', '系统');
  void stun;
  finish(x);
}
{
  const x = start('riven_e');
  standard(x);
  const shield = data(x, 'ShieldAmount', 'shield_base', '勇往直前基础护盾');
  const duration = ms(x, 'ShieldDuration', 'shield_duration_ms', '勇往直前护盾持续时间');
  literal(x, 'shield_ad_ratio', '勇往直前护盾攻击力系数', 1.1, '当前根 TotalShield 计算树明确护盾为 ShieldAmount + 1.1×来源总攻击力。', 'mSpellCalculations.TotalShield');
  formula(x, 'total_shield', '勇往直前护盾值', add(shield, mul(P('shield_ad_ratio'), BAD())), '当前根TotalShield的mStat=2、mStatFormula=2对应来源额外攻击力；TotalShield = ShieldAmount + 1.1×来源额外攻击力。');
  shieldEffect(x, 'shield', '勇往直前自身护盾', 'total_shield', 'shield_duration_ms', '当前绑定中文正文明确冲刺后获得1.5秒护盾');
  markCalc(x, 'TotalShield', '护盾计算树已展开来源额外攻击力系数，保留mStatFormula=2。');
  pending(x, '冲刺与护盾触发', '正文明确冲刺和护盾持续时间；冲刺距离、不可穿地形和实际施放触发尚未接线。');
  excludeData(x, 'BaseShieldAmount', '当前根 TotalShield 只消费 ShieldAmount；未消费的旧基础字段不另建重复参数。');
  void duration;
  finish(x);
}
{
  const x = start('riven_r');
  standard(x);
  const minBase = data(x, 'MinBase', 'wind_slash_min_base', '疾风斩最低基础物理伤害');
  const maxBase = data(x, 'MaxBase', 'wind_slash_max_base', '疾风斩最高基础物理伤害');
  const duration = ms(x, 'Duration', 'blade_empower_duration_ms', '放逐之锋强化持续时间');
  const adRatio = data(x, 'PercentBonusAD', 'bonus_ad_ratio', '放逐之锋额外攻击力比例');
  const range = data(x, 'TooltipAttackRange', 'attack_range_bonus', '放逐之锋额外攻击距离');
  literal(x, 'wind_slash_recast_count', '疾风斩可再施放次数', 1, '当前绑定中文正文明确放逐之锋期间可以再施放一次疾风斩；这是第二阶段次数，不与强化持续时间混用。', 'Spell_RivenFengShuiEngine_Tooltip');
  literal(x, 'wind_slash_min_ad_ratio', '疾风斩最低攻击力系数', 0.55, '当前根MinDamage的mStat=2、mStatFormula=2对应来源额外攻击力系数。', 'mSpellCalculations.MinDamage');
  literal(x, 'wind_slash_max_ad_ratio', '疾风斩最高攻击力系数', 1.65, '当前根MaxDamage的mStat=2、mStatFormula=2对应来源额外攻击力系数。', 'mSpellCalculations.MaxDamage');
  formula(x, 'bonus_attack_damage', '放逐之锋额外攻击力', mul(adRatio, AD()), 'BonusAD = PercentBonusAD×来源总攻击力；实际强化触发待接线。');
  formula(x, 'wind_slash_min_damage', '疾风斩最低物理伤害', add(minBase, mul(P('wind_slash_min_ad_ratio'), BAD())), 'MinDamage = MinBase + 0.55×来源额外攻击力；目标已损生命值的实际区间规则未出现在当前根树。');
  formula(x, 'wind_slash_max_damage', '疾风斩最高物理伤害', add(maxBase, mul(P('wind_slash_max_ad_ratio'), BAD())), 'MaxDamage = MaxBase + 1.65×来源额外攻击力；目标已损生命值的实际区间规则未出现在当前根树。');
  effect(x, 'attack_damage_bonus', '放逐之锋自身攻击力提升', [result('attribute', '额外攻击力', 'ATTRIBUTE_CHANGE', 'SOURCE', val('bonus_ad_ratio'), { attributeKey: 'attack_damage', operation: 'INCREASE', modifierZoneKey: 'attribute_percent_bonus' }, behavior)], life(P('blade_empower_duration_ms')), '当前正文明确强化期间获得额外攻击力；实际施放触发尚未接线。');
  effect(x, 'attack_range_bonus', '放逐之锋自身攻击距离提升', [result('attribute', '额外攻击距离', 'ATTRIBUTE_CHANGE', 'SOURCE', val('attack_range_bonus'), { attributeKey: 'attack_range', operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' }, behavior)], life(P('blade_empower_duration_ms')), '当前正文明确强化期间获得额外攻击距离；实际施放触发尚未接线。');
  markCalc(x, 'MinDamage', '疾风斩最低伤害树已展开，mStatFormula=2对应额外攻击力。');
  markCalc(x, 'MaxDamage', '疾风斩最高伤害树已展开，mStatFormula=2对应额外攻击力。');
  markCalc(x, 'BonusAD', '放逐之锋攻击力树已展开。');
  noteDamage(x, 'wind_slash_min_damage');
  noteDamage(x, 'wind_slash_max_damage');
  pending(x, '强化持续与疾风斩再施放', '正文明确15秒强化期间可再施放一次，伤害依据目标已损生命值；当前根没有可安全绑定的已损生命值曲线和再施放事件，不猜线性关系或次数。', '系统');
  void duration;
  void range;
  finish(x);
}

// 暗裔剑魔
{
  const x = start('aatrox_p');
  const damageRatio = unknownCurve(x, 'passive_damage_max_health_ratio', '赐死剑气目标最大生命值伤害比例', requireCalc(x, 'PDamage'), 'mSpellCalculations.PDamage', '客户端只给出角色等级4%至10%的百分比断点插值树；等级求值不猜，实际比例无默认由运行输入提供。');
  const targetMaxHp = (() => { runtime(x, 'target_max_health', '赐死剑气目标最大生命值', '当前正文明确伤害基于目标最大生命值；目标属性所有者由运行时提供，不默认0。'); return P('target_max_health'); })();
  const healingRatio = data(x, 'PHealingRatio', 'passive_healing_damage_ratio', '赐死剑气实际伤害回复比例');
  runtime(x, 'passive_actual_damage', '赐死剑气本次实际命中伤害', '正文明确回复PHealingRatio×100%的实际伤害值；由本次命中结算提供，不采用最大生命值折前量，不设默认。');
  formula(x, 'passive_damage', '赐死剑气最大生命值魔法伤害', mul(targetMaxHp, damageRatio), 'PDamage 为目标最大生命值比例；只保存数学量，不创建命中伤害。');
  formula(x, 'passive_healing', '赐死剑气实际伤害回复量', mul(P('passive_actual_damage'), healingRatio), '正文明确回复PHealingRatio×100%的实际命中伤害值；消费无默认的本次命中结算输入，与目标最大生命值伤害式分开。');
  const cooldown = unknownCurve(x, 'passive_cooldown_ms', '赐死剑气被动冷却（实际值外供）', requireCalc(x, 'PCooldown'), 'mSpellCalculations.PCooldown', '客户端只给出角色等级22至10秒的断点插值树；等级求值不猜，实际冷却无默认。');
  runtime(x, 'champion_hit_cooldown_reduction_ms', '命中英雄或大型野怪的冷却缩短（毫秒）', '当前正文明确每次相关攻击或技能命中缩短2秒；多目标只缩短一次的事件待接线。');
  runtime(x, 'q_edge_cooldown_reduction_ms', '暗裔利刃边缘命中的冷却缩短（毫秒）', '当前正文明确用暗裔利刃边缘命中缩短4秒；资格和优先级待接线。');
  x.c.write.parameters.find(p => p.parameterKey === 'champion_hit_cooldown_reduction_ms').fixedValue = 2000;
  x.c.write.parameters.find(p => p.parameterKey === 'champion_hit_cooldown_reduction_ms').valueMode = 'FIXED';
  x.c.write.parameters.find(p => p.parameterKey === 'champion_hit_cooldown_reduction_ms').valueType = 'INTEGER';
  x.c.write.parameters.find(p => p.parameterKey === 'champion_hit_cooldown_reduction_ms').levelValues = null;
  x.c.write.parameters.find(p => p.parameterKey === 'q_edge_cooldown_reduction_ms').fixedValue = 4000;
  x.c.write.parameters.find(p => p.parameterKey === 'q_edge_cooldown_reduction_ms').valueMode = 'FIXED';
  x.c.write.parameters.find(p => p.parameterKey === 'q_edge_cooldown_reduction_ms').valueType = 'INTEGER';
  x.c.write.parameters.find(p => p.parameterKey === 'q_edge_cooldown_reduction_ms').levelValues = null;
  x.c.proofs.push({ parameterKey: 'champion_hit_cooldown_reduction_ms', source: 'Spell_AatroxPassive_Tooltip', values: [2000] });
  x.c.proofs.push({ parameterKey: 'q_edge_cooldown_reduction_ms', source: 'Spell_AatroxPassive_Tooltip', values: [4000] });
  markCalc(x, 'PDamage', '保留角色等级百分比树并展开目标最大生命值关系。');
  markCalc(x, 'PCooldown', '保留角色等级被动冷却树，不将冷却字段变成伤害周期。');
  sourceProof(x, 'mSpellCalculations.MonsterDamageCap', requireCalc(x, 'MonsterDamageCap'), '仅野怪伤害上限分支，逐支排除。', { excluded: true });
  noteDamage(x, 'passive_damage');
  noteHeal(x, 'passive_healing');
  pending(x, '被动充能、攻击消费和冷却事件', '每过一段时间的充能、下一次攻击消费、命中英雄/大型野怪缩短和多目标只算一次需要运行事件；不创建自动触发。', '系统');
  excludeData(x, 'PHealingMinionMod', '小兵治疗专用比例；不进入英雄目标分支。');
  excludeData(x, 'PStructureCap', '建筑物专用上限；不进入英雄目标分支。');
  void cooldown;
  finish(x);
}
{
  const x = start('aatrox_q');
  standard(x);
  const base = data(x, 'QBaseDamage', 'base_damage', '暗裔利刃基础物理伤害');
  const ratio = data(x, 'QTotalADRatio', 'total_ad_ratio', '暗裔利刃总攻击力系数');
  const knockup = ms(x, 'QKnockupDuration', 'edge_knockup_duration_ms', '暗裔利刃边缘击飞持续时间');
  const ramp = data(x, 'QRampBonus', 'recast_damage_bonus_ratio', '暗裔利刃每段再施放伤害增幅');
  literal(x, 'edge_damage_multiplier', '暗裔利刃边缘伤害倍率', 1.75, '当前根 QEdgeDamage 使用1 + QSweetSpotBonus，且QSweetSpotBonus为0.75；保留为一条派生倍率。', 'mSpellCalculations.QEdgeDamage');
  formula(x, 'q_damage', '暗裔利刃普通段物理伤害', add(base, mul(ratio, AD())), 'QDamage = QBaseDamage + QTotalADRatio×来源总攻击力。');
  formula(x, 'q_edge_damage', '暗裔利刃边缘物理伤害', mul(P('edge_damage_multiplier'), add(base, mul(ratio, AD()))), 'QEdgeDamage = 1.75×QDamage；边缘击飞目标资格待接线。');
  markCalc(x, 'QDamage', '普通段伤害树已展开。');
  markCalc(x, 'QEdgeDamage', '边缘倍率保留根树的1+0.75修正。');
  noteDamage(x, 'q_damage');
  noteDamage(x, 'q_edge_damage');
  pending(x, '三段再施放、边缘和击飞', '当前正文明确可再施放两段且每段比上一段多25%；本候选保留增幅参数，不猜累计方式，不把冷却当再施放时窗，也不创建控制状态。', '系统');
  sourceProof(x, 'DataValues.QSweetSpotBonus', (x.p.DataValues ?? []).find(v => v.name === 'QSweetSpotBonus')?.values ?? null, 'QEdgeDamage 已将当前树的1+0.75合并为单一边缘倍率，避免重复直通字段。', { derived: true });
  excludeData(x, 'QMonsterBonus', '仅野怪额外伤害分支；不进入英雄目标分支。');
  sourceProof(x, 'mSpellCalculations.QMinionDamage', requireCalc(x, 'QMinionDamage'), '仅小兵专用伤害分支，逐支排除。', { excluded: true });
  void knockup;
  void ramp;
  finish(x);
}
{
  const x = start('aatrox_w');
  standard(x);
  const base = data(x, 'WBaseDamage', 'base_damage', '恶火束链基础物理伤害');
  const ratio = data(x, 'WTotalADRatio', 'total_ad_ratio', '恶火束链总攻击力系数');
  const slow = data(x, 'WSlowPercentage', 'slow_ratio', '恶火束链减速比例', { scale: -1, unit: '按正文WSlowPercentage×-100%转为正减速比例' });
  const duration = ms(x, 'WSlowDuration', 'slow_duration_ms', '恶火束链减速持续时间');
  formula(x, 'w_damage', '恶火束链物理伤害', add(base, mul(ratio, AD())), 'WDamage = WBaseDamage + WTotalADRatio×来源总攻击力。');
  markCalc(x, 'WDamage', '锁链伤害树已展开。');
  noteDamage(x, 'w_damage');
  pending(x, '首个目标、区域离开和第二次等额伤害', '当前正文明确只取命中的第一个敌人，英雄和大型野怪不离开区域会被拖回并再次受到等额伤害；区域、目标类别、等待时长和第二次命中事件尚未接线。', '系统');
  excludeData(x, 'WBonusADRatio', '当前根 WDamage 消费 WTotalADRatio；同值旧字段不另建重复参数。');
  void slow;
  void duration;
  finish(x);
}
{
  const x = start('aatrox_e');
  standard(x);
  const baseRatio = data(x, 'ESpellVamp', 'base_healing_ratio', '暗影冲决基础治疗效果比例', { scale: 0.01, unit: '正文百分数点转比例' });
  const statRatio = data(x, 'EVampHPRatio', 'bonus_healing_ratio_per_unresolved_stat', '暗影冲决未映射统计项治疗比例');
  markCalc(x, 'TotalEVamp', '保留根树的0.01乘数、ESpellVamp和mStat12统计项；只落地正文可直接对应的基础治疗比例，未安全映射统计项不猜属性。');
  pending(x, '额外治疗统计项归属', 'TotalEVamp 还包含 mStat=12、mStatFormula=2 与 EVampHPRatio；当前API属性窄口径没有可证明的统计枚举归属，因此不绑定攻击力或生命值，不造完整总比例公式。', '来源');
  pending(x, '被动治疗和主动突进', '正文明确对英雄造成伤害时的被动治疗及主动突进；治疗资格、目标、突进几何和前摇期间接线尚未完成。', '系统');
  excludeData(x, 'ESpellVampEmpowered', '当前正文和TotalEVamp未给出独立强化版消费；保留原始字段，不按字段名创建重复参数。');
  void baseRatio;
  void statRatio;
  finish(x);
}
{
  const x = start('aatrox_r');
  standard(x);
  const duration = ms(x, 'RDuration', 'form_duration_ms', '大灭形态持续时间');
  const move = data(x, 'RMovementSpeedBonus', 'movement_speed_bonus_ratio', '大灭移动速度加成比例');
  const adAmp = data(x, 'RTotalADAmp', 'attack_damage_amp_ratio', '大灭攻击力提升比例');
  const healing = data(x, 'RHealingAmp', 'healing_amp_ratio', '大灭自我治疗效果提升比例');
  const extension = ms(x, 'RExtension', 'takedown_extension_ms', '参与击杀后的持续延长时间');
  effect(x, 'attack_damage_amp', '大灭自身攻击力提升', [result('attribute', '攻击力提升', 'ATTRIBUTE_CHANGE', 'SOURCE', val('attack_damage_amp_ratio'), { attributeKey: 'attack_damage', operation: 'INCREASE', modifierZoneKey: 'attribute_percent_bonus' }, behavior)], life(P('form_duration_ms')), '当前正文明确形态期间提升攻击力；参与击杀刷新和持续上限待接线。');
  pending(x, '移动速度参数', '正文明确的移动速度加成会持续衰减；候选只保留RMovementSpeedBonus参数，不创建恒定速度效果。');
  pending(x, '移动速度衰减和击杀延长', '正文明确移动速度持续衰减、参与击杀后延长并刷新移动速度；衰减曲线、上限和事件尚未接线，不创建过程或周期。', '系统');
  pending(x, '自我治疗效果属性', '治疗提升比例已保留，但当前属性目录没有已证的治疗效果属性键；不擅自映射或创建即时治疗。', '来源');
  excludeData(x, 'RFXExtraDuration', '表现层额外时长，当前1对1数值候选不接入视觉过程。');
  excludeData(x, 'RPercentBloodWellToBoostToMax', '实现层血池到最大增益的内部比例，当前正文未给出可独立接线的效果曲线。');
  excludeData(x, 'RBonusADRange', '当前正文未引用该旧字段；只保留根原始字段，不按字段名扩展属性。');
  excludeData(x, 'RFearRadius', '仅附近小兵恐惧的目标范围；逐支排除非英雄目标效果。');
  excludeData(x, 'RMinionFearDuration', '仅小兵恐惧持续时间；逐支排除非英雄目标效果。');
  excludeData(x, 'RChampionFearDuration', '当前正文未引用的恐惧字段；不把字段名当现行英雄效果证据。');
  void duration;
  void move;
  void healing;
  void extension;
  finish(x);
}

// 傲之追猎者
{
  const x = start('rengar_p');
  data(x, 'MaxFerocity', 'max_ferocity', '残暴值上限');
  ms(x, 'InCombatTimer', 'out_of_combat_reset_ms', '脱离战斗后残暴值清除时间');
  ms(x, 'EmpoweredMSDuration', 'empowered_move_speed_duration_ms', '强化技能后的移动速度持续时间');
  data(x, 'LeapFerocityGeneration', 'leap_ferocity_gain', '跃击生成残暴值');
  unknownCurve(x, 'empowered_move_speed_ratio', '强化技能后的移动速度比例', requireCalc(x, 'EmpoweredMS'), 'mSpellCalculations.EmpoweredMS', '客户端给出角色等级断点的移动速度百分比树；等级求值无默认，不猜断点算法。');
  literal(x, 'non_ultimate_ferocity_gain', '非终极技能生成残暴值', 1, '当前绑定中文正文明确施放一个非终极技能生成1点残暴值。', 'Spell_RengarPassive_Tooltip');
  runtime(x, 'ferocity_at_cast', '施放时残暴值', '残暴值是独立资源，实际施放时由运行时提供；不映射成法力、不设默认。', 'INTEGER');
  runtime(x, 'bonetooth_necklace_attack_damage', '骨齿项链攻击力加成', '独特参与击杀会提升骨齿项链提供的攻击力；当前正文没有层数曲线或当前总值，由运行时提供，不设默认。');
  runtime(x, 'khazix_takedown_attack_damage', '击杀卡兹克额外攻击力', '扩展正文明确击杀卡兹克后获得额外攻击力；数值和与骨齿项链总加成的关系由运行时提供，不设默认。');
  const textEntry = key => x.c.source.currentBoundText?.keys?.[key] ?? null;
  sourceProof(x, 'Spell_RengarPassive_Tooltip', textEntry('keyTooltip'), '当前正文明确独特参与击杀提升骨齿项链攻击力；数值、层数和事件待补。');
  sourceProof(x, 'Spell_RengarPassive_TooltipExtended', textEntry('keyTooltipExtended'), '扩展正文明确击杀卡兹克后获得额外攻击力；数值和事件待补。');
  markCalc(x, 'EmpoweredMS', '强化移动速度保留角色等级断点树。');
  pending(x, '残暴值、强化资格和骨齿项链', '非终极技能与跃击生成残暴值、满层强化下一技能、强化后移速和独特击杀战利品需要运行事件；骨齿项链攻击力与击杀卡兹克额外攻击力已分别保留为无默认运行输入，本批不造残暴值属性、内部状态或自动触发。', '系统');
  excludeData(x, 'InCombatTimerVisual', '仅显示层脱战计时字段；使用InCombatTimer作为唯一数值来源。');
  excludeData(x, 'RengarPassiveRangeIncrease', '当前正文未给出可独立接线的攻击范围属性效果；不按字段名扩展。');
  excludeData(x, 'BonusLeapRange', '当前正文未给出可独立接线的跃击距离公式；不按字段名扩展。');
  finish(x);
}
{
  const x = start('rengar_q');
  common(x, { cooldown: false, mana: false });
  ammoData(x, 'ammo_recharge_time_ms', '弹药恢复时间（毫秒）');
  ammoCount(x);
  literal(x, 'ferocity_gain', '残忍无情生成残暴值', 1, '当前绑定中文正文明确施放技能产生1点残暴值；不是法力消耗。', 'Spell_RengarQ_Tooltip');
  runtime(x, 'ferocity_at_cast', '施放时残暴值', '满层强化资格由运行时提供；残暴值不是法力，不设默认。', 'INTEGER');
  const base = data(x, 'BaseDamage', 'base_damage', '残忍无情额外攻击基础伤害');
  const baseRatio = data(x, 'BaseADRatio', 'base_ad_ratio', '残忍无情额外攻击力系数');
  const empoweredRatio = data(x, 'EmpoweredADRatio', 'empowered_ad_ratio', '强化残忍无情攻击力系数');
  const asDuration = ms(x, 'ASDuration', 'empowered_attack_speed_duration_ms', '强化残忍无情攻击速度持续时间');
  const asBonus = data(x, 'ASBonus', 'attack_speed_bonus_percent_points', '残忍无情攻击速度加成百分数点');
  const buffDuration = ms(x, 'BuffDuration', 'attack_speed_buff_duration_ms', '残忍无情攻击速度效果持续时间');
  const empoweredBase = unknownCurve(x, 'empowered_q_level_base_damage', '强化残忍无情角色等级基础伤害', requireCalc(x, '{d4a43abe}').mFormulaParts?.[0], 'mSpellCalculations.{d4a43abe}.mFormulaParts[0]', '客户端只给出角色等级初值、每级增量和9级断点；等级求值不猜，实际基础值无默认。');
  const empoweredAs = unknownCurve(x, 'empowered_attack_speed_percent_points', '强化残忍无情攻击速度百分数点', requireCalc(x, 'EmpoweredQAS'), 'mSpellCalculations.EmpoweredQAS', '客户端包含0.01乘数与角色等级断点；不丢弃乘数，也不猜等级求值。');
  formula(x, 'q_total_damage', '残忍无情第一次攻击物理伤害', add(base, AD(), mul(baseRatio, AD())), 'QTotalDamage = BaseDamage + 1×来源总攻击力 + BaseADRatio×来源总攻击力。');
  formula(x, 'empowered_q_total_damage', '强化残忍无情第一次攻击物理伤害', add(empoweredBase, AD(), mul(empoweredRatio, AD())), 'EmpoweredQTotalDamage = 角色等级基础值 + 1×来源总攻击力 + EmpoweredADRatio×来源总攻击力；强化资格待接线。');
  markCalc(x, 'QTotalDamage', '普通完整攻击伤害树已展开。');
  markCalc(x, 'EmpoweredQTotalDamage', '强化完整攻击伤害树保留无默认角色等级基础值。');
  noteDamage(x, 'q_total_damage');
  noteDamage(x, 'empowered_q_total_damage');
  pending(x, '下两次攻击、满层强化和攻击速度', '当前正文明确普通技能影响下两次攻击、满层强化第一次攻击与持续攻击速度；攻击次数消费、残暴值资格和强化移动速度事件尚未接线。', '系统');
  excludeData(x, 'BaseADRatioTooltip', '仅百分数点展示字段；BaseADRatio 已作为唯一公式来源。');
  excludeData(x, 'TowerMod', '仅建筑物额外伤害修正；不进入英雄目标分支。');
  void asDuration;
  void asBonus;
  void buffDuration;
  void empoweredAs;
  finish(x);
}
{
  const x = start('rengar_w');
  common(x, { cooldown: false, mana: false });
  ammoData(x, 'ammo_recharge_time_ms', '弹药恢复时间（毫秒）');
  ammoCount(x);
  literal(x, 'ferocity_gain', '战争咆哮生成残暴值', 1, '当前绑定中文正文明确施放技能产生1点残暴值；不是法力消耗。', 'Spell_RengarW_Tooltip');
  runtime(x, 'ferocity_at_cast', '施放时残暴值', '满层强化资格由运行时提供；残暴值不是法力，不设默认。', 'INTEGER');
  const base = data(x, 'BaseDamage', 'base_damage', '战争咆哮基础魔法伤害');
  const apRatio = data(x, 'APRatio', 'ap_ratio', '战争咆哮法术强度系数');
  const empoweredApRatio = data(x, 'EmpoweredAPRatio', 'empowered_ap_ratio', '强化战争咆哮法术强度系数');
  const healRatio = ratioData(x, 'DamagePercentageHealed', 'recent_damage_heal_ratio', '近期伤害回复比例', '正文明确回复前1.5秒受到伤害的50%；百分数点按正文换算为比例。');
  const healingWindow = ms(x, 'HealingWindow', 'healing_window_ms', '近期伤害统计窗口');
  const empoweredBase = unknownCurve(x, 'empowered_w_level_base_damage', '强化战争咆哮角色等级基础伤害', requireCalc(x, 'TotalDamageEmpowered').mFormulaParts?.[0], 'mSpellCalculations.TotalDamageEmpowered.mFormulaParts[0]', '客户端只给出角色等级值数组；不猜角色等级索引和求值算法，实际基础值无默认。');
  runtime(x, 'recent_damage_taken', '近期受到的伤害', '治疗数学量需要前1.5秒实际受到的伤害；由运行时提供，不默认0。');
  formula(x, 'total_damage', '战争咆哮魔法伤害', add(base, mul(apRatio, AP())), 'TotalDamage = BaseDamage + APRatio×来源总法术强度。');
  formula(x, 'total_damage_empowered', '强化战争咆哮魔法伤害', add(empoweredBase, mul(empoweredApRatio, AP())), 'TotalDamageEmpowered = 角色等级基础值 + EmpoweredAPRatio×来源总法术强度。');
  formula(x, 'recent_damage_heal', '战争咆哮近期伤害回复量', mul(P('recent_damage_taken'), healRatio), '回复量 = 前1.5秒受到的实际伤害×50%；只保存治疗数学量。');
  markCalc(x, 'TotalDamage', '普通伤害树已展开。');
  markCalc(x, 'TotalDamageEmpowered', '强化伤害树保留角色等级数组和法强系数。');
  noteDamage(x, 'total_damage');
  noteDamage(x, 'total_damage_empowered');
  noteHeal(x, 'recent_damage_heal');
  pending(x, '近期伤害记录、净化和强化资格', '正文明确前1.5秒受到伤害的回复与强化版净化控制；记录窗口、目标类别、净化事件和残暴值资格尚未接线。', '系统');
  excludeData(x, 'MonsterHealingMod', '仅野怪治疗比例分支；不进入英雄目标分支。');
  sourceProof(x, 'mSpellCalculations.BonusMonsterDamage', requireCalc(x, 'BonusMonsterDamage'), '仅野怪额外伤害分支，逐支排除。', { excluded: true });
  finish(x);
}
{
  const x = start('rengar_e');
  common(x, { cooldown: false, mana: false });
  ammoData(x, 'ammo_recharge_time_ms', '弹药恢复时间（毫秒）');
  ammoCount(x);
  literal(x, 'ferocity_gain', '套索打击生成残暴值', 1, '当前绑定中文正文明确施放技能产生1点残暴值；不是法力消耗。', 'Spell_RengarE_Tooltip');
  runtime(x, 'ferocity_at_cast', '施放时残暴值', '满层强化资格由运行时提供；残暴值不是法力，不设默认。', 'INTEGER');
  const base = data(x, 'BaseDamage', 'base_damage', '套索打击基础物理伤害');
  const ratio = data(x, 'BonusADRatio', 'bonus_ad_ratio', '套索打击额外攻击力系数');
  const slow = data(x, 'SlowAmount', 'slow_percent_points', '套索打击减速百分数点');
  const cc = ms(x, 'CCDuration', 'crowd_control_duration_ms', '套索打击控制持续时间');
  const empoweredBase = unknownCurve(x, 'empowered_e_level_base_damage', '强化套索打击角色等级基础伤害', requireCalc(x, 'TotalEmpoweredDamage').mFormulaParts?.[0], 'mSpellCalculations.TotalEmpoweredDamage.mFormulaParts[0]', '客户端只给出角色等级初值、每级增量和断点；等级求值不猜，实际基础值无默认。');
  formula(x, 'total_damage', '套索打击物理伤害', add(base, mul(ratio, BAD())), '当前根TotalDamage的mStat=2、mStatFormula=2对应来源额外攻击力；TotalDamage = BaseDamage + BonusADRatio×来源额外攻击力。');
  formula(x, 'total_empowered_damage', '强化套索打击物理伤害', add(empoweredBase, mul(ratio, BAD())), '当前根TotalEmpoweredDamage的mStat=2、mStatFormula=2对应来源额外攻击力；TotalEmpoweredDamage = 角色等级基础值 + BonusADRatio×来源额外攻击力。');
  markCalc(x, 'TotalDamage', '普通套索伤害树已展开，保留mStatFormula=2。');
  markCalc(x, 'TotalEmpoweredDamage', '强化套索伤害树保留无默认角色等级基础值和mStatFormula=2。');
  noteDamage(x, 'total_damage');
  noteDamage(x, 'total_empowered_damage');
  pending(x, '首个敌人、减速和强化禁锢', '当前正文明确命中第一个敌人、减速，以及满层时禁锢；状态目录没有可证明的禁锢状态键，目标和控制事件尚未接线。显形持续时间是纯视野分支，已逐支排除。', '系统');
  excludeData(x, 'RevealDuration', '仅显形持续时间的纯视野分支；不进入1对1数值候选。');
  void slow;
  void cc;
  finish(x);
}
{
  const x = start('rengar_r');
  standard(x);
  const stealth = ms(x, 'StealthDuration', 'stealth_duration_ms', '狩猎律动持续时间');
  const detect = data(x, 'EnemyDetectionRange', 'enemy_detection_range', '最近敌方英雄侦测范围');
  const reveal = data(x, 'SelfRevealRange', 'self_reveal_range', '自身显形范围');
  const move = data(x, 'StealthMS', 'movement_speed_percent_points', '狩猎律动移动速度加成百分数点');
  const fade = ms(x, 'FadeTime', 'fade_time_ms', '进入伪装前等待时间');
  const shred = data(x, 'ArmorShred', 'armor_shred_points', '跃击目标固定护甲削减点数');
  const shredDuration = ms(x, 'ArmorShredDuration', 'armor_shred_duration_ms', '目标护甲削减持续时间');
  const leapRange = data(x, 'LeapRange', 'leap_range', '狩猎律动跃击距离');
  markCalc(x, 'BonusDamage', '跃击额外伤害树已展开1倍总攻击力。');
  pending(x, '跃击额外伤害显示', '当前根 BonusDamage 只是1倍总攻击力的直通显示树；为避免重复建立单属性直通公式，本候选仅保留来源证据。', '来源');
  pending(x, '伪装资格、最近目标和护甲削减', '正文明确侦测最近敌方英雄、延迟伪装、敌方侦测范围和自身显形范围会影响伪装资格；这些范围参数不是单纯展示视野，但当前状态目录没有可安全映射的伪装状态。目标选择、护甲削减事件和跃击后结束技能尚未接线。自身真实视野范围是纯视野分支，已逐支排除。', '系统');
  excludeData(x, 'SelfVisionRange', '仅自身真实视野范围的纯视野分支；不进入1对1数值候选。');
  void stealth;
  void detect;
  void reveal;
  void move;
  void fade;
  void shred;
  void shredDuration;
  void leapRange;
  finish(x);
}

// 虚空掠夺者
{
  const x = start('khazix_p');
  runtime(x, 'unseen_by_enemy', '未被敌方队伍看见', '无形威胁需要当前视野资格；由运行时提供，不设默认。', 'INTEGER');
  runtime(x, 'isolated_target_eligible', '孤立无援目标资格', '孤立无援由附近没有友军判定；由运行时提供，不默认孤立。', 'INTEGER');
  const slow = data(x, 'SlowAmount', 'slow_ratio', '无形威胁减速比例');
  const duration = ms(x, 'SlowDuration', 'slow_duration_ms', '无形威胁减速持续时间');
  const range = data(x, 'IsolationRange', 'isolation_range', '孤立无援判定范围');
  const adRatio = data(x, 'BonusADRatio', 'bonus_ad_ratio', '无形威胁攻击力系数');
  const base = unknownCurve(x, 'passive_level_base_damage', '无形威胁角色等级基础伤害', requireCalc(x, 'TotalDamage').mFormulaParts?.[0], 'mSpellCalculations.TotalDamage.mFormulaParts[0]', '客户端给出角色等级基础伤害数组；本批不把它猜成技能等级或线性曲线，实际值无默认。');
  formula(x, 'passive_damage', '无形威胁额外魔法伤害', add(base, mul(adRatio, BAD())), '当前根TotalDamage的mStat=2、mStatFormula=2对应来源额外攻击力；TotalDamage = 角色等级基础伤害 + BonusADRatio×来源额外攻击力；隐身、英雄目标和孤立资格待接线。');
  markCalc(x, 'TotalDamage', '被动伤害树保留角色等级基础值和mStatFormula=2的额外攻击力比例。');
  noteDamage(x, 'passive_damage');
  pending(x, '视野、下一次攻击和孤立判定', '正文明确未被敌方看见时下一次对英雄攻击触发，附近没有友军的敌人获得孤立标记；视野、攻击消费和唯一目标资格尚未接线，不创建触发规则。', '系统');
  void slow;
  void duration;
  void range;
  finish(x);
}
{
  const x = start('khazix_q');
  standard(x);
  const base = effectData(x, 1, 'base_damage', '品尝恐惧基础物理伤害');
  const ratio = data(x, 'BonusADRatio', 'bonus_ad_ratio', '品尝恐惧攻击力系数');
  const cdr = data(x, 'EvolutionIsolationCDRPercentage', 'evolved_isolated_cooldown_refund_percent_points', '进化收割利爪孤立目标冷却返还百分数点');
  runtime(x, 'isolated_target_eligible', '孤立无援目标资格', '孤立目标由运行时判定；不默认孤立或唯一敌人。', 'INTEGER');
  runtime(x, 'evolution_selected', '战前进化选择', '进化是战前选择；由运行时提供，不默认已进化，也不把条件缓冲名当成永久状态。', 'INTEGER');
  literal(x, 'isolated_damage_multiplier', '孤立目标品尝恐惧伤害倍率', 2.1, '当前根 IsoDamage 明确使用2.1倍修改器；只在运行时确认孤立资格后使用。', 'mSpellCalculations.IsoDamage');
  formula(x, 'base_damage', '品尝恐惧普通物理伤害', add(base, mul(ratio, BAD())), '当前根BaseDamage的mStat=2、mStatFormula=2对应来源额外攻击力；BaseDamage = mEffectAmount[1] + BonusADRatio×来源额外攻击力。');
  formula(x, 'isolated_damage', '品尝恐惧孤立目标物理伤害', mul(P('isolated_damage_multiplier'), add(base, mul(ratio, BAD()))), 'IsoDamage = 2.1×BaseDamage；基础树使用来源额外攻击力，孤立资格由运行时提供，不设默认。');
  markCalc(x, 'BaseDamage', '基础伤害树已展开效果值和mStatFormula=2的额外攻击力比例。');
  markCalc(x, 'IsoDamage', '孤立目标倍率保留根树的2.1修改器。');
  markCalc(x, 'IsEvolved', '进化条件树保留来源；候选使用无默认战前选择输入。');
  noteDamage(x, 'base_damage');
  noteDamage(x, 'isolated_damage');
  pending(x, '进化、孤立冷却返还与距离', '正文明确进化收割利爪在孤立目标时返还部分冷却并增加普攻/Q距离；返还时点、距离值和战前选择接线尚未完成。', '系统');
  void cdr;
  finish(x);
}
{
  const x = start('khazix_w');
  standard(x);
  const base = effectData(x, 1, 'base_damage', '虚空突刺基础物理伤害');
  const healBase = data(x, 'BaseHeal', 'base_heal', '虚空突刺基础生命回复');
  const healRatio = data(x, 'HealAPRatio', 'heal_ap_ratio', '虚空突刺生命回复法强系数');
  const slow = data(x, 'SlowPercentage', 'slow_percent_points', '进化刺鞘普通减速百分数点');
  const slowDuration = ms(x, 'SlowDuration', 'slow_duration_ms', '进化刺鞘普通减速持续时间');
  const isolatedSlow = data(x, 'IsolatedSlowPercentage', 'isolated_slow_percent_points', '孤立目标额外减速百分数点');
  const isolatedDuration = ms(x, 'IsolatedSlowDuration', 'isolated_slow_duration_ms', '孤立目标额外减速持续时间');
  runtime(x, 'self_inside_burst_radius', '施放者位于爆炸范围内', '虚空突刺回复需要施放者处于爆炸范围内；由运行时提供，不默认。', 'INTEGER');
  runtime(x, 'isolated_target_eligible', '孤立无援目标资格', '孤立目标由运行时判定；不默认孤立。', 'INTEGER');
  runtime(x, 'evolution_selected', '战前进化选择', '进化是战前选择；由运行时提供，不默认已进化。', 'INTEGER');
  formula(x, 'base_damage', '虚空突刺物理伤害', add(base, BAD()), '当前根BaseDamage的mStat=2、mStatFormula=2对应来源额外攻击力；BaseDamage = mEffectAmount[1] + 1×来源额外攻击力。');
  formula(x, 'heal_amount', '虚空突刺生命回复量', add(healBase, mul(healRatio, AP())), 'HealAmount = BaseHeal + HealAPRatio×来源总法术强度；只保存治疗数学量。');
  markCalc(x, 'BaseDamage', '基础伤害树已展开效果值和mStatFormula=2的1倍额外攻击力。');
  markCalc(x, 'HealAmount', '生命回复树已展开基础值和法强系数。');
  markCalc(x, 'IsEvolved', '进化条件树保留来源；候选使用无默认战前选择输入。');
  noteDamage(x, 'base_damage');
  noteHeal(x, 'heal_amount');
  pending(x, '爆炸范围、自身回复、三尖刺和显形', '正文明确自身在爆炸范围内回复，进化后发射三根尖刺、减速并使英雄显形；范围命中、孤立额外减速、控制状态和战前选择尚未接线。', '系统');
  void slow;
  void slowDuration;
  void isolatedSlow;
  void isolatedDuration;
  finish(x);
}
{
  const x = start('khazix_e');
  standard(x);
  const base = effectData(x, 1, 'base_damage', '跃击基础物理伤害');
  const ratio = data(x, 'ADRatio', 'ad_ratio', '跃击攻击力系数');
  const evolvedRange = data(x, 'EvolvedLeapRange', 'evolved_leap_range', '进化虫翼跃击距离');
  literal(x, 'evolved_leap_bonus_range', '进化虫翼额外跃击距离', 200, '当前官方中文正文明确进化虫翼使跃击距离提升200。', 'Spell_KhazixE_Summary');
  runtime(x, 'evolution_selected', '战前进化选择', '进化是战前选择；由运行时提供，不默认已进化。', 'INTEGER');
  formula(x, 'total_damage', '跃击物理伤害', add(base, mul(ratio, BAD())), '当前根TotalDamage的mStat=2、mStatFormula=2对应来源额外攻击力；TotalDamage = mEffectAmount[1] + ADRatio×来源额外攻击力。');
  markCalc(x, 'TotalDamage', '跃击伤害树已展开效果值和mStatFormula=2的额外攻击力系数。');
  markCalc(x, 'IsEvolved', '进化条件树保留来源；候选使用无默认战前选择输入。');
  noteDamage(x, 'total_damage');
  pending(x, '进化距离与击杀助攻重置', '正文明确进化后距离增加200，并在击杀和助攻时重置冷却；重置事件、距离基准和战前选择尚未接线。', '系统');
  void evolvedRange;
  finish(x);
}
{
  const x = start('khazix_r');
  standard(x);
  const stealth = ms(x, 'StealthDuration', 'stealth_duration_ms', '虚空来袭普通隐身持续时间');
  const window = ms(x, 'RecastWindow', 'recast_window_ms', '虚空来袭再施放窗口');
  const move = data(x, 'BonusMovementSpeedPercent', 'movement_speed_bonus_ratio', '虚空来袭移动速度加成比例');
  const evolutions = data(x, 'EvolutionsAvailable', 'evolutions_available', '当前等级可用进化数量');
  const evolvedStealth = ms(x, 'EvolvedStealthDuration', 'evolved_stealth_duration_ms', '进化动态遮蔽隐身持续时间');
  const recastCd = ms(x, 'RecastCD', 'recast_cooldown_ms', '虚空来袭再次使用间隔');
  const casts = data(x, 'NumberOfCasts', 'normal_cast_count', '虚空来袭普通使用次数');
  const evolvedCasts = data(x, 'EvolvedNumberOfCasts', 'evolved_cast_count', '进化动态遮蔽使用次数');
  runtime(x, 'evolution_selected', '战前进化选择', '每级可选一项进化；由运行时提供，不默认动态遮蔽已选。', 'INTEGER');
  markCalc(x, 'IsEvolved', '隐身与额外使用次数的进化条件树保留来源；候选不造隐身状态。');
  pending(x, '进化选择、隐身、无形威胁和额外使用', '正文明确每级允许选择一项进化，施放触发无形威胁和移速，动态遮蔽增加隐身持续和使用次数；战前选择、隐身状态、被动触发和再施放事件尚未接线。', '系统');
  void stealth;
  void window;
  void move;
  void evolutions;
  void evolvedStealth;
  void recastCd;
  void casts;
  void evolvedCasts;
  finish(x);
}

for (const value of instances) {
  if (!plan.skills[value.c.skillKey]) throw Error('技能没有写入计划 ' + value.c.skillKey);
}
