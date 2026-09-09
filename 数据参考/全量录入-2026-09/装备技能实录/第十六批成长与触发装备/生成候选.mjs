import { existsSync as finalVersionExists } from 'node:fs';
if(finalVersionExists(new URL('./主审最终版本.json',import.meta.url)))throw Error('本批最终候选已实录冻结，旧生成器不能覆盖；纠错应另建有界版本。');
import assert from 'node:assert/strict';
import {
  source,
  before,
  selectedIds,
  base,
  clean,
  dataRows,
  parameterNode,
  attributeNode,
  operation,
  param,
  runtime,
  formula,
  note,
  omitted,
  pending,
  proof,
  output
} from './候选工具.mjs';

if (process.argv.length > 2) throw Error('第十六批候选生成器不接受参数，也不包含业务写入口');

const sourceById = new Map(source.objects.map(object => [object.id, object]));
let currentCandidate = null;

const root = id => {
  const object = sourceById.get(id);
  assert.ok(object, `冻结来源缺少装备 ${id}`);
  return object;
};

function value(object, id, key, accepted) {
  const rows = dataRows(object, key);
  assert.ok(rows.length, `${object.path}/${key} 缺少原始数据值`);
  assert.ok(rows.every(row => Number.isFinite(row.mValue)), `${object.path}/${key} 含缺失值`);
  const actual = accepted ?? clean(rows[0].mValue);
  assert.ok(Number.isFinite(actual), `${object.path}/${key} 候选值必须为数值`);
  assert.ok(rows.every(row => clean(row.mValue) === actual), `${object.path}/${key} 值不一致`);
  assert.ok(currentCandidate, '数据值读取必须在候选对象上下文中进行');
  proof(currentCandidate, `/Items~1${id}/mDataValues/${key}`, actual, rows);
  return actual;
}

function sourceOnlyValue(candidate, object, id, key, reason) {
  const rows = dataRows(object, key);
  assert.ok(rows.length, `${object.path}/${key} 缺少原始数据值`);
  assert.ok(rows.every(row => Number.isFinite(row.mValue)), `${object.path}/${key} 含缺失值`);
  const accepted = clean(rows[0].mValue);
  assert.ok(rows.every(row => clean(row.mValue) === accepted), `${object.path}/${key} 值不一致`);
  proof(candidate, `/Items~1${id}/mDataValues/${key}`, { value: accepted, usage: '仅来源证据', reason }, rows);
  return accepted;
}

function missingValue(candidate, object, id, key, accepted = '缺失，不填0') {
  const rows = dataRows(object, key);
  assert.equal(rows.length, 1, `${object.path}/${key} 缺失记录数量不为1`);
  assert.equal(Object.hasOwn(rows[0], 'mValue'), false, `${object.path}/${key} 出现未授权数值`);
  proof(candidate, `/Items~1${id}/mDataValues/${key}`, accepted, rows);
}

function bound(candidate, id, field, textPattern, accepted) {
  const binding = candidate.source.bindings[field];
  assert.ok(binding?.text, `${candidate.skillKey} 缺少绑定文本 ${field}`);
  if (textPattern) assert.match(binding.text, textPattern);
  proof(candidate, `/Items~1${id}/mItemDataClient/mTooltipData/mLocKeys/${field}`, accepted ?? binding.text, binding);
  return binding;
}

function calculation(candidate, id, key, check, accepted) {
  const raw = root(id).object.mItemCalculations?.[key];
  assert.ok(raw, `${id} 缺少计算式 ${key}`);
  check(raw);
  proof(candidate, `/Items~1${id}/mItemCalculations/${key}`, accepted, raw);
  return raw;
}

function sourceDefinition(candidate, key, accepted) {
  const definition = source.boundDefinitions[key];
  assert.ok(definition, `冻结来源缺少绑定定义 ${key}`);
  proof(candidate, `/boundDefinitions/${key}`, accepted ?? definition.text, definition);
  return definition;
}

function sameValue(sourceObject, id, first, second) {
  const a = value(sourceObject, id, first);
  const b = value(sourceObject, id, second);
  assert.equal(a, b, `${sourceObject.path}/${first} 与 ${second} 不一致`);
  return a;
}

const objects = [];

{
  const item = root(2510);
  const object = base(2510, 'passive', '咒刃', '保留施放技能后下一次攻击的额外魔法伤害、治疗和额外攻击特效说明，以及客户端计算树的四个系数。两个缺省 StatBy 节点按已核同版本旁证映射为SOURCE ability_power TOTAL；mStat=2、mStatFormula=1和mStat=12、mStatFormula=2仍使用显式输入。攻击消费、重复攻击特效和治疗时点尚未接线。');
  currentCandidate = object;
  const spellbladeCooldown = sameValue(item, 2510, 'SpellbladeCooldown', 'Cooldown');
  const damage = calculation(object, 2510, 'SpellbladeDamage', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].__type, 'StatByCoefficientCalculationPart');
    assert.equal(raw.mFormulaParts[0].mStat, 2);
    assert.equal(raw.mFormulaParts[0].mStatFormula, 1);
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), 0.75);
    assert.equal(raw.mFormulaParts[1].__type, 'StatByCoefficientCalculationPart');
    assert.equal(Object.hasOwn(raw.mFormulaParts[1], 'mStat'), false);
    assert.equal(Object.hasOwn(raw.mFormulaParts[1], 'mStatFormula'), false);
    assert.equal(clean(raw.mFormulaParts[1].mCoefficient), 0.1);
  }, { parts: [{ mStat: 2, mStatFormula: 1, coefficient: 0.75 }, { mStat: '省略', mStatFormula: '省略', coefficient: 0.1 }] });
  const healing = calculation(object, 2510, 'SpellbladeHealing', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].__type, 'StatByCoefficientCalculationPart');
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStat'), false);
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStatFormula'), false);
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), 0.1);
    assert.equal(raw.mFormulaParts[1].__type, 'StatByCoefficientCalculationPart');
    assert.equal(raw.mFormulaParts[1].mStat, 12);
    assert.equal(raw.mFormulaParts[1].mStatFormula, 2);
    assert.equal(clean(raw.mFormulaParts[1].mCoefficient), 0.03);
  }, { parts: [{ mStat: '省略', mStatFormula: '省略', coefficient: 0.1 }, { mStat: 12, mStatFormula: 2, coefficient: 0.03 }] });
  param(object, 'spellblade_cooldown_ms', '咒刃冷却', spellbladeCooldown * 1000, '客户端SpellbladeCooldown与Cooldown均为1.5秒，换算为1500毫秒；冷却消费仍待接线。');
  param(object, 'spellblade_damage_mstat2_formula1_ratio', '咒刃伤害第一缩放系数', 0.75, 'SpellbladeDamage第一项为mStat=2、mStatFormula=1、系数0.75；当前只保存系数。');
  runtime(object, 'spellblade_damage_mstat2_formula1_input', '咒刃伤害第一缩放输入', '非负小数显式输入；mStat=2且mStatFormula=1在本批不映射为总攻击力。');
  param(object, 'spellblade_damage_default_ratio', '咒刃伤害第二缩放系数', 0.1, 'SpellbladeDamage第二项缺省mStat和mStatFormula；按已核同版本三类旧StatBy法强旁证映射SOURCE ability_power TOTAL，保留0.1系数。');
  param(object, 'spellblade_healing_default_ratio', '咒刃治疗第一缩放系数', 0.1, 'SpellbladeHealing第一项缺省mStat和mStatFormula；按已核同版本三类旧StatBy法强旁证映射SOURCE ability_power TOTAL，保留0.1系数。');
  param(object, 'spellblade_healing_mstat12_formula2_ratio', '咒刃治疗第二缩放系数', 0.03, 'SpellbladeHealing第二项为mStat=12、mStatFormula=2、系数0.03；当前不把mStat=12补成生命值。');
  runtime(object, 'spellblade_healing_mstat12_formula2_input', '咒刃治疗第二缩放输入', '非负小数显式输入；mStat=12且mStatFormula=2的属性归属待核。');
  formula(object, 'spellblade_damage_value', '咒刃额外魔法伤害值', '0.75×mStat=2、mStatFormula=1显式输入 + 0.1×SOURCE ability_power TOTAL；缺省 StatBy 节点的法强映射有同版本旁证。', operation('ADD', operation('MULTIPLY', parameterNode('spellblade_damage_mstat2_formula1_ratio'), parameterNode('spellblade_damage_mstat2_formula1_input')), operation('MULTIPLY', parameterNode('spellblade_damage_default_ratio'), attributeNode('SOURCE', 'ability_power', 'TOTAL'))));
  formula(object, 'spellblade_healing_value', '咒刃自身治疗值', '0.1×SOURCE ability_power TOTAL + 0.03×mStat=12、mStatFormula=2显式输入；后一个节点属性归属仍待核。', operation('ADD', operation('MULTIPLY', parameterNode('spellblade_healing_default_ratio'), attributeNode('SOURCE', 'ability_power', 'TOTAL')), operation('MULTIPLY', parameterNode('spellblade_healing_mstat12_formula2_ratio'), parameterNode('spellblade_healing_mstat12_formula2_input'))));
  bound(object, 2510, 'keyTooltip', /施放技能后.*下一次攻击.*额外魔法伤害.*治疗你自身/);
  const onHit = sourceDefinition(object, 'Item_Keyword_OnHit');
  assert.match(onHit.text, /攻击特效/);
  proof(object, '/Items~12510/mItemCalculations/SpellbladeDamage+SpellbladeHealing', { damage: damage.mFormulaParts, healing: healing.mFormulaParts }, { damage, healing });
  note(object, '来源待核', '咒刃计算属性', 'mStat=2、mStatFormula=1和mStat=12、mStatFormula=2的属性口径仍待核；两个缺省 StatBy 节点按已核同版本三类旧StatBy法强旁证映射SOURCE ability_power TOTAL，不扩展其他枚举。');
  note(object, '尚未接线', '技能后下一次攻击', '技能施放资格、下一次攻击消费、攻击特效额外施加、伤害和治疗同次时序均未接线。');
  omitted(object, 'effect', 'spellblade_damage_healing_on_next_attack', '计算值已保存，触发事件与结果时序尚未确证。');
  pending(object, '咒刃攻击事件', '待补技能命中或施放来源、一次性消费、额外攻击特效是否递归和治疗取值时点。');
  objects.push(object);
}

{
  const item = root(2512);
  const object = base(2512, 'passive', '守夜与开战弹幕', '保留30点终极技能急速，以及终极技能施放后8秒内最多3次攻击的50%攻击速度、必暴和80%常规暴击伤害；若原本会暴击再产生15%额外真实伤害。触发、攻击计数、暴击判定和冷却消费尚未接线。');
  currentCandidate = object;
  const ultimateHaste = value(item, 2512, 'UltimateHaste');
  const cooldown = value(item, 2512, 'Cooldown');
  const duration = value(item, 2512, 'Duration');
  const trueDamage = value(item, 2512, 'BonusTrueDamage');
  const attackSpeed = value(item, 2512, 'BonusAS');
  const attacks = value(item, 2512, 'NumberOfAttacks');
  const critModifier = value(item, 2512, 'CritModifier');
  bound(object, 2512, 'keyTooltip', /施放你的终极技能后.*@Duration@秒.*@NumberOfAttacks@次攻击/);
  const cooldownDefinition = sourceDefinition(object, 'Item_Cooldown');
  assert.match(cooldownDefinition.text, /Cooldown/);
  param(object, 'ultimate_haste', '守夜终极技能急速', ultimateHaste, '当前UltimateHaste=30。');
  param(object, 'barrage_cooldown_ms', '开战弹幕冷却', cooldown * 1000, '当前Cooldown=45秒，换算为45000毫秒；冷却起算和消费待接线。');
  param(object, 'barrage_duration_ms', '开战弹幕持续时间', duration * 1000, '当前Duration=8秒，换算为8000毫秒。');
  param(object, 'barrage_extra_true_damage_ratio', '开战弹幕额外真实伤害比例', trueDamage, '当前BonusTrueDamage=0.15，即15%小数比例。');
  param(object, 'barrage_attack_speed_ratio', '开战弹幕额外攻击速度比例', attackSpeed, '当前BonusAS=0.5，即50%小数比例。');
  param(object, 'barrage_attack_count', '开战弹幕攻击次数', attacks, '当前NumberOfAttacks=3。');
  param(object, 'barrage_critical_damage_ratio', '开战弹幕常规暴击伤害比例', critModifier, '当前CritModifier=0.8，即80%常规暴击伤害。');
  formula(object, 'barrage_attack_speed_bonus', '开战弹幕攻击速度结果', '施放终极技能后的攻击速度比例，具体应用窗口由触发状态决定。', parameterNode('barrage_attack_speed_ratio'));
  formula(object, 'barrage_critical_damage_result', '开战弹幕暴击伤害结果', '使用80%常规暴击伤害比例，具体暴击覆盖方式由攻击事件决定。', parameterNode('barrage_critical_damage_ratio'));
  formula(object, 'barrage_extra_true_damage_result', '开战弹幕额外真实伤害结果', '原本会暴击时使用15%额外真实伤害比例，资格判定未在公式内假定。', parameterNode('barrage_extra_true_damage_ratio'));
  note(object, '来源待核', 'Item_Cooldown实际消费', '绑定模板只提供45秒数值和通用冷却占位，没有给出冷却起点、重置或与攻击次数状态的关系。');
  note(object, '尚未接线', '终极技能后的攻击状态', '终极技能施放事件、8秒窗口、三次攻击计数、必暴覆盖、原本会暴击判定和真实伤害结果均未接线。');
  omitted(object, 'effect', 'barrage_attack_state', '静态数值和结果公式已保存，攻击状态和条件真实伤害尚未确证。');
  pending(object, '开战弹幕状态', '待补终极技能事件、攻击计数和持续时间的先后顺序，以及必暴与常规暴击伤害的组合。');
  objects.push(object);
}

{
  const item = root(2517);
  const object = base(2517, 'passive', '饥馑与盛宴', '保留基于SOURCE attack_damage BONUS的近战5+13%和远程5+10%技能急速、击杀后15%全能吸血、8秒持续和3秒伤害窗口。两个哈希键与近远程占位已由同版本具名旁证精确对应；击杀事件、攻击类型分支和共享状态尚未接线。');
  currentCandidate = object;
  const omnivamp = value(item, 2517, 'OmnivampOnTakedown');
  const duration = value(item, 2517, 'OmnivampDuration');
  const takedownWindow = value(item, 2517, 'TakedownWindow');
  const split = item.object.StringCalculations?.HasteFromAD;
  assert.deepEqual(split, { MeleeResult: '@HasteFromADMelee@', RangedResult: '@HasteFromADRanged@', DefaultResult: '@HasteFromADMelee@', __type: '{4750ceb6}' });
  const meleeCalc = calculation(object, 2517, '{e4d9f16b}', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].__type, 'NumberCalculationPart');
    assert.equal(raw.mFormulaParts[0].mNumber, 5);
    assert.equal(raw.mFormulaParts[1].__type, 'StatByCoefficientCalculationPart');
    assert.equal(raw.mFormulaParts[1].mStat, 2);
    assert.equal(raw.mFormulaParts[1].mStatFormula, 2);
    assert.equal(clean(raw.mFormulaParts[1].mCoefficient), 0.13);
  }, { variant: '近战占位', base: 5, mStat: 2, mStatFormula: 2, coefficient: 0.13 });
  const rangedCalc = calculation(object, 2517, '{87892572}', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].__type, 'NumberCalculationPart');
    assert.equal(raw.mFormulaParts[0].mNumber, 5);
    assert.equal(raw.mFormulaParts[1].__type, 'StatByCoefficientCalculationPart');
    assert.equal(raw.mFormulaParts[1].mStat, 2);
    assert.equal(raw.mFormulaParts[1].mStatFormula, 2);
    assert.equal(clean(raw.mFormulaParts[1].mCoefficient), 0.1);
  }, { variant: '远程占位', base: 5, mStat: 2, mStatFormula: 2, coefficient: 0.1 });
  param(object, 'haste_base', '饥馑技能急速基础值', 5, '两个客户端计算式均以NumberCalculationPart=5开始。');
  param(object, 'melee_haste_bonus_attack_damage_ratio', '近战额外攻击力技能急速比例', 0.13, '近战占位计算式系数0.13；绑定文本明确技能急速基于额外攻击力。');
  param(object, 'ranged_haste_bonus_attack_damage_ratio', '远程额外攻击力技能急速比例', 0.1, '远程占位计算式系数0.10；绑定文本明确技能急速基于额外攻击力。');
  param(object, 'takedown_omnivamp_ratio', '盛宴击杀后全能吸血比例', omnivamp, '当前OmnivampOnTakedown=0.15，即15%小数比例。');
  param(object, 'takedown_omnivamp_duration_ms', '盛宴全能吸血持续时间', duration * 1000, '当前OmnivampDuration=8秒，换算为8000毫秒。');
  param(object, 'takedown_damage_window_ms', '盛宴击杀前伤害窗口', takedownWindow * 1000, '当前TakedownWindow=3秒，换算为3000毫秒。');
  formula(object, 'melee_haste_from_bonus_attack_damage', '近战饥馑技能急速', '5 + 0.13×SOURCE attack_damage BONUS；同版本具名旁证将{e4d9f16b}精确对应近战HasteFromADMelee。', operation('ADD', parameterNode('haste_base'), operation('MULTIPLY', parameterNode('melee_haste_bonus_attack_damage_ratio'), attributeNode('SOURCE', 'attack_damage', 'BONUS'))));
  formula(object, 'ranged_haste_from_bonus_attack_damage', '远程饥馑技能急速', '5 + 0.10×SOURCE attack_damage BONUS；同版本具名旁证将{87892572}精确对应远程HasteFromADRanged。', operation('ADD', parameterNode('haste_base'), operation('MULTIPLY', parameterNode('ranged_haste_bonus_attack_damage_ratio'), attributeNode('SOURCE', 'attack_damage', 'BONUS'))));
  bound(object, 2517, 'keyTooltip', /获得@HasteFromAD@技能急速/);
  bound(object, 2517, 'keyTooltip', /过去@TakedownWindow@秒内曾被你造成过伤害/);
  proof(object, '/Items~12517/StringCalculations/HasteFromAD', split, split);
  proof(object, '/Items~12517/mItemCalculations/HasteFromAD', { melee: meleeCalc, ranged: rangedCalc }, { meleeCalc, rangedCalc });
  note(object, '来源待核', '饥馑分支与属性口径', '同版本具名旁证已将{e4d9f16b}对应HasteFromADMelee、{87892572}对应HasteFromADRanged，且绑定正文明确为额外攻击力；本候选绑定SOURCE attack_damage BONUS，默认分支沿StringCalculations使用近战结果。');
  note(object, '尚未接线', '盛宴击杀与全能吸血', '过去3秒伤害记录、英雄阵亡事件、击杀与助攻关系、8秒状态刷新和全能吸血结果均未接线。');
  omitted(object, 'effect', 'takedown_omnivamp', '静态比例和窗口已保存，击杀事件与状态生命周期尚未确证。');
  pending(object, '饥馑与盛宴状态', '待补攻击类型分支、伤害记录、英雄阵亡和全能吸血状态消费；额外攻击力属性与两个哈希对应已具备旁证。');
  objects.push(object);
}

{
  const item = root(2520);
  const object = base(2520, 'passive', '成型炸药与破坏', '保留对英雄或史诗级野怪技能伤害的50+1.5×mStat29计算形状；史诗级野怪或防御塔专用的破坏支路按本批约定仅归档来源，不进入正常参数或公式。英雄支路的近远程匿名倍率用显式输入；技能目标筛选、击杀资格和冷却消费尚未接线。');
  currentCandidate = object;
  sourceOnlyValue(object, item, 2520, 'LethalityAmount', '22点穿甲已由装备属性现值保护；技能候选不重复提交直接属性。');
  const cooldown = value(item, 2520, 'Cooldown');
  const takedownWindow = sourceOnlyValue(object, item, 2520, 'TakedownWindow', '史诗级野怪或防御塔专用破坏支路的击杀记录窗口按本批约定仅作来源归档。');
  const rangeModifier = sourceOnlyValue(object, item, 2520, 'RangeModifier', '客户端字段有0.8，但DamageCalc的匿名远程倍率没有直接绑定名称，保留来源不直接映射。');
  const dotDuration = sourceOnlyValue(object, item, 2520, 'DoTDuration', '史诗级野怪或防御塔专用破坏支路的持续时间按本批约定仅作来源归档，不推导持续伤害节拍。');
  const buffDuration = sourceOnlyValue(object, item, 2520, 'BuffDuration', '史诗级野怪或防御塔专用破坏支路的状态持续时间按本批约定仅作来源归档。');
  const abilityRangeModifier = sourceOnlyValue(object, item, 2520, 'AbilityDamageRangeMod', '客户端字段有0.5，但AbilityDamageCalc的匿名远程倍率没有直接绑定名称，保留来源不直接映射。');
  const damageCalc = calculation(object, 2520, 'DamageCalc', raw => {
    assert.equal(raw.__type, '{e9a3c91d}');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].__type, 'NumberCalculationPart');
    assert.equal(raw.mFormulaParts[0].mNumber, 300);
    assert.equal(raw.mFormulaParts[1].__type, 'StatByCoefficientCalculationPart');
    assert.equal(raw.mFormulaParts[1].mStat, 29);
    assert.equal(clean(raw.mFormulaParts[1].mCoefficient), 25);
    assert.deepEqual(raw.mRangedMultiplier, { mDataValue: '{a99340ef}', __type: 'NamedDataValueCalculationPart' });
  }, { base: 300, mStat: 29, coefficient: 25, rangedMultiplier: '{a99340ef}' });
  const abilityDamageCalc = calculation(object, 2520, 'AbilityDamageCalc', raw => {
    assert.equal(raw.__type, '{e9a3c91d}');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].__type, 'NumberCalculationPart');
    assert.equal(raw.mFormulaParts[0].mNumber, 50);
    assert.equal(raw.mFormulaParts[1].__type, 'StatByCoefficientCalculationPart');
    assert.equal(raw.mFormulaParts[1].mStat, 29);
    assert.equal(clean(raw.mFormulaParts[1].mCoefficient), 1.5);
    assert.deepEqual(raw.mRangedMultiplier, { mDataValue: '{d62bdfef}', __type: 'NamedDataValueCalculationPart' });
  }, { base: 50, mStat: 29, coefficient: 1.5, rangedMultiplier: '{d62bdfef}' });
  param(object, 'ability_damage_cooldown_ms', '成型炸药冷却', cooldown * 1000, '当前Cooldown=20秒，换算为20000毫秒；触发消费仍待接线。');
  param(object, 'ability_damage_base', '成型炸药基础真实伤害', 50, 'AbilityDamageCalc第一项NumberCalculationPart=50，官方展开的0不覆盖客户端计算树。');
  param(object, 'ability_damage_mstat29_ratio', '成型炸药mStat29系数', 1.5, 'AbilityDamageCalc第二项mStat=29、系数1.5；mStat属性归属待核。');
  runtime(object, 'ability_damage_mstat29_input', '成型炸药mStat29输入', '非负小数显式输入；当前来源没有把mStat=29映射到管理属性。');
  runtime(object, 'ability_damage_ranged_multiplier_input', '成型炸药远程倍率输入', '非负小数显式输入；原始树引用匿名哈希{d62bdfef}，不默认1或0.5。');
  formula(object, 'ability_damage_value', '成型炸药技能伤害值', '(50 + 1.5×显式mStat29输入)×显式远程倍率；英雄或史诗级野怪资格和实际倍率选择待接线。', operation('MULTIPLY', operation('ADD', parameterNode('ability_damage_base'), operation('MULTIPLY', parameterNode('ability_damage_mstat29_ratio'), parameterNode('ability_damage_mstat29_input'))), parameterNode('ability_damage_ranged_multiplier_input')));
  bound(object, 2520, 'keyTooltip', /对一个英雄或史诗级野怪造成技能伤害/);
  bound(object, 2520, 'keyTooltip', /史诗级野怪或防御塔的下一次攻击.*@DoTDuration@秒/);
  proof(object, '/Items~12520/mDataValues/RangeModifier+AbilityDamageRangeMod+TakedownWindow+BuffDuration+DoTDuration', { damage: rangeModifier, abilityDamage: abilityRangeModifier, takedownWindow, buffDuration, dotDuration, usage: '破坏支路仅来源归档，匿名倍率未直连' }, [dataRows(item, 'RangeModifier'), dataRows(item, 'AbilityDamageRangeMod'), dataRows(item, 'TakedownWindow'), dataRows(item, 'BuffDuration'), dataRows(item, 'DoTDuration')]);
  note(object, '范围外', '史诗级野怪与防御塔支路', '破坏效果只在拥有蓄意破坏时作用于史诗级野怪或防御塔的下一次攻击；本轮不把该持续真实伤害并入英雄单目标攻击。');
  note(object, '来源待核', 'mStat29与匿名远程倍率', '两个客户端计算树使用mStat=29和匿名NamedDataValueCalculationPart；字段名RangeModifier与AbilityDamageRangeMod只作来源旁证，不直接替匿名哈希作映射。');
  note(object, '尚未接线', '成型炸药技能触发', '英雄或史诗级野怪技能伤害筛选、技能命中事件、远程倍率选择和冷却消费均未接线。');
  omitted(object, 'effect', 'destruction_damage_branch', '史诗级野怪或防御塔专用破坏支路按本批约定排除；原始DamageCalc、击杀窗口、状态持续和持续伤害时间仅保留来源证据。');
  omitted(object, 'effect', 'ability_damage_trigger', '成型炸药计算值已保存，技能命中资格与事件时序尚未确证。');
  pending(object, '成型炸药技能伤害', '待补英雄或史诗级野怪目标判定、技能伤害事件、远程倍率哈希和冷却消费。');
  objects.push(object);
}

{
  const item = root(2523);
  const object = base(2523, 'passive', '高倍望远镜与奥术瞄准', '保留攻击额外伤害随敌我距离变化、500码达到10%上限的两个已证端点；来源没有计算树，不能把端点擅自插值为线性公式。击杀后8秒获得100额外攻击距离和3秒伤害记录窗口仅作来源归档，距离读取、攻击资格、击杀事件和状态刷新尚未接线。');
  currentCandidate = object;
  const extraRange = sourceOnlyValue(object, item, 2523, 'ExtraRange', '奥术瞄准的额外攻击距离属于空间/状态支路，本轮仅保留来源证据。');
  const takedownWindow = sourceOnlyValue(object, item, 2523, 'TakedownWindow', '奥术瞄准的击杀前伤害窗口属于未接线资格条件，本轮仅保留来源证据。');
  const duration = sourceOnlyValue(object, item, 2523, 'Duration', '奥术瞄准的额外攻击距离持续时间属于空间/状态支路，本轮仅保留来源证据。');
  const maxRange = value(item, 2523, 'MaxRange');
  const maxDamageAmp = value(item, 2523, 'MaxDamageAmp');
  param(object, 'telescope_max_range', '高倍望远镜达到上限的距离', maxRange, '当前MaxRange=500码；距离输入按来源码值提供。');
  param(object, 'telescope_max_damage_amp_ratio', '高倍望远镜最大额外伤害比例', maxDamageAmp, '当前MaxDamageAmp=0.1，绑定文本明确500码达到10%；保存为0.1小数比例，完整距离函数未证。');
  bound(object, 2523, 'keyTooltip', /攻击造成至多@MaxDamageAmp\*100@%额外伤害.*@MaxRange@码/);
  bound(object, 2523, 'keyTooltip', /在@TakedownWindow@秒内造成过伤害.*@Duration@秒.*@ExtraRange@额外攻击距离/);
  note(object, '来源待核', '距离伤害完整函数', '绑定说明只给出距离越远伤害越高、500码达到10%的端点，没有mItemCalculations或其他计算树证明中间曲线；本候选不生成距离输入、线性比例或外供斜率。');
  note(object, '范围外', '奥术瞄准额外攻击距离', '额外攻击距离、击杀记录窗口和持续时间属于空间/状态支路，本轮只保留来源，不作为正常1V1数值组成。');
  note(object, '尚未接线', '高倍望远镜攻击资格', '攻击事件、距离读取时点、额外伤害施加、英雄击杀筛选和状态刷新均未接线。');
  omitted(object, 'effect', 'distance_damage_function', '仅有500码/10%端点，完整距离到伤害函数未证，不能按线性关系补公式。');
  omitted(object, 'effect', 'range_buff_branch', '额外攻击距离支路属于空间/状态范围，本轮仅保留来源证据。');
  pending(object, '高倍望远镜距离资格', '待补攻击目标资格、距离读取时点和500码至10%之间的真实计算函数；奥术瞄准击杀状态另需运行时接线。');
  objects.push(object);
}

{
  const item = root(2524);
  const object = base(2524, 'passive', '嘹亮旋律', '保留减速或定身敌方英雄后持续8秒的移动速度20；附近友军（包括自己）的攻速支路、范围字段和匿名计算节点仅作来源归档，缺失冷却不填补。控制触发、本人的状态和移动速度应用尚未接线。');
  currentCandidate = object;
  const cooldownRows = dataRows(item, 'Cooldown');
  assert.equal(cooldownRows.length, 1);
  assert.equal(Object.hasOwn(cooldownRows[0], 'mValue'), false);
  missingValue(object, item, 2524, 'Cooldown');
  const detectRange = sourceOnlyValue(object, item, 2524, 'EnemyDetectRange', '400是敌方检测空间字段，本轮不把它写成单目标效果参数。');
  const duration = value(item, 2524, 'Duration');
  const meleeAttackSpeed = sourceOnlyValue(object, item, 2524, 'MeleeAuraAttackSpeed', '附近友军（包括自己）的团队攻速支路按本批队友/范围边界仅保留来源证据。');
  const auraRange = sourceOnlyValue(object, item, 2524, 'AuraRange', '900是附近友军空间字段，本轮只保留来源依据。');
  const asDuration = sourceOnlyValue(object, item, 2524, 'ASDuration', '团队攻速支路的1秒效果时间按本批队友/范围边界仅保留来源证据。');
  const moveSpeed = value(item, 2524, 'MoveSpeed');
  const rangedMultiplier = sourceOnlyValue(object, item, 2524, 'RangedAttackSpeedMultiplier', '团队攻速远程倍率按本批队友/范围边界仅保留来源证据，匿名哈希未直接映射。');
  const buffDurationCalc = calculation(object, 2524, 'BuffDuration', raw => {
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.deepEqual(raw.mFormulaParts[0], { mDataValue: 'Duration', __type: 'NamedDataValueCalculationPart' });
    assert.deepEqual(raw.mRangedMultiplier, { mNumber: 0.5, __type: 'NumberCalculationPart' });
  }, { source: 'Duration', rangedMultiplier: 0.5, sourceOnly: true });
  const auraCalc = calculation(object, 2524, 'AuraAttackSpeed', raw => {
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.deepEqual(raw.mFormulaParts[0], { mDataValue: '{eb8d750f}', __type: 'NamedDataValueCalculationPart' });
    assert.deepEqual(raw.mRangedMultiplier, { mDataValue: '{ca6deae2}', __type: 'NamedDataValueCalculationPart' });
    assert.equal(raw.mDisplayAsPercent, true);
  }, { source: '{eb8d750f}', rangedMultiplier: '{ca6deae2}', sourceOnly: true });
  param(object, 'melody_duration_ms', '嘹亮旋律持续时间', duration * 1000, '当前Duration=8秒，换算为8000毫秒。');
  param(object, 'melody_move_speed', '嘹亮旋律移动速度', moveSpeed, '当前MoveSpeed=20。');
  bound(object, 2524, 'keyTooltip', /减速.*定身.*敌方英雄.*持续@BuffDuration@秒/);
  bound(object, 2524, 'keyKeywordDefinitions', /Item_KeywordDefinition_Slow.*Item_KeywordDefinition_Immobilize/);
  const slow = sourceDefinition(object, 'Item_KeywordDefinition_Slow');
  const immobilize = sourceDefinition(object, 'Item_KeywordDefinition_Immobilize');
  assert.match(slow.text, /减速/);
  assert.match(immobilize.text, /定身/);
  proof(object, '/Items~12524/mDataValues/EnemyDetectRange+AuraRange', { enemyDetectRange: detectRange, auraRange, usage: '仅空间来源证据' }, [dataRows(item, 'EnemyDetectRange'), dataRows(item, 'AuraRange')]);
  proof(object, '/Items~12524/mItemCalculations/BuffDuration+AuraAttackSpeed', { buffDurationCalc, auraCalc }, { buffDurationCalc, auraCalc });
  note(object, '范围外', '检测与友军范围', 'EnemyDetectRange=400和AuraRange=900是检测或附近友军空间条件；本轮不把范围数值误写为伤害或属性加成。');
  note(object, '来源待核', '冷却与匿名攻速计算', 'Cooldown字段缺少mValue；BuffDuration有远程0.5倍率，AuraAttackSpeed引用两个匿名哈希，当前没有直接定义可确定其完整近远程结果。');
  note(object, '范围外', '附近友军团队攻速', 'AuraRange=900、MeleeAuraAttackSpeed=0.3、ASDuration=1和RangedAttackSpeedMultiplier约0.667属于附近友军（包括自己）的空间/队友支路，本轮只保留来源证据。');
  note(object, '尚未接线', '减速/定身触发与本人状态', '控制事件、8秒状态、本人移动速度应用和冷却消费均未接线。');
  omitted(object, 'parameter', 'cooldown', '源字段没有mValue，不能填0或推算冷却。');
  omitted(object, 'effect', 'ally_attack_speed_aura', '附近友军团队攻速支路属于本批队友/范围边界，仅保留来源证据。');
  omitted(object, 'effect', 'melody_self_state', '本人控制触发、8秒状态、移动速度应用和冷却消费尚未确证。');
  pending(object, '嘹亮旋律本人状态', '待补控制事件、本人状态刷新、移动速度应用和冷却消费；团队攻速支路不进入本轮正常候选。');
  objects.push(object);
}

{
  const item = root(2526);
  const object = base(2526, 'passive', '和谐与法力流', '保留法力流8秒充能窗口、最大5层、每次4点最大法力值、英雄命中翻倍和累计360点最大法力值后转变为歌之权冠；和谐计算保留0.005×能力资源得到的百分数点结果（资源1000得到5%）。充能事件、层数消费、转变时点和能力资源属性映射尚未接线。');
  currentCandidate = object;
  const chargeCooldown = value(item, 2526, 'ManaChargeAmmoCD');
  const maxAmmo = value(item, 2526, 'ManaChargeMaxAmmo');
  const manaPerCharge = value(item, 2526, 'ManaPerCharge');
  const maxMana = value(item, 2526, 'MaxMana');
  const internalCooldown = sourceOnlyValue(object, item, 2526, 'InternalCDPerCastID', '客户端值为6.5，但当前绑定说明未确认单位、事件归属和是否为业务冷却，不转换成毫秒。');
  const bonusHsp = calculation(object, 2526, 'BonusHSPCalc', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStat'), false);
    assert.equal(raw.mFormulaParts[0].mStatFormula, 2);
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), 0.005);
  }, { coefficient: 0.005, mStat: '省略', mStatFormula: 2, resource: '显式输入' });
  param(object, 'mana_flow_charge_window_ms', '法力流充能窗口', chargeCooldown * 1000, '当前ManaChargeAmmoCD=8秒，换算为8000毫秒；不从窗口推导周期。');
  param(object, 'mana_flow_max_stacks', '法力流最大层数', maxAmmo, '当前ManaChargeMaxAmmo=5。');
  param(object, 'mana_flow_mana_per_charge', '法力流每次增加最大法力值', manaPerCharge, '当前ManaPerCharge=4；说明明确英雄命中时翻倍。');
  param(object, 'mana_flow_hero_hit_multiplier', '法力流英雄命中倍率', 2, '当前绑定说明明确对英雄时翻倍，只保存2倍，不把目标筛选写成默认触发。');
  param(object, 'mana_flow_transform_threshold', '法力流转变最大法力阈值', maxMana, '当前MaxMana=360；这是法力流累计增加的阈值，不把角色总最大法力或装备固定法力误当成此值。');
  param(object, 'harmony_resource_percent_point_coefficient', '和谐每点能力资源治疗和护盾强度百分数点系数', 0.005, 'BonusHSPCalc系数约0.005；计算结果单位为百分数点，资源1000得到5%，不是0.05小数比例；能力资源属性未由当前树直接给出。');
  runtime(object, 'harmony_resource_input', '和谐能力资源输入', '非负小数显式输入；当前节点缺少mStat，不能默认法术强度或最大法力。');
  formula(object, 'harmony_heal_shield_strength_percent_points', '和谐治疗和护盾强度百分数点', '0.005×显式能力资源输入，结果单位为百分数点；若后续转成0至1比例，必须再除以100。', operation('MULTIPLY', parameterNode('harmony_resource_percent_point_coefficient'), parameterNode('harmony_resource_input')));
  formula(object, 'mana_flow_normal_hit_gain', '法力流普通命中增加', '单次符合条件的命中增加4点最大法力；命中事件和窗口消费不在公式内假定。', parameterNode('mana_flow_mana_per_charge'));
  formula(object, 'mana_flow_hero_hit_gain', '法力流英雄命中增加', '英雄目标符合条件时4×2=8点最大法力；目标筛选仍待接线。', operation('MULTIPLY', parameterNode('mana_flow_mana_per_charge'), parameterNode('mana_flow_hero_hit_multiplier')));
  bound(object, 2526, 'keyTooltip', /获得@BonusHSPCalc@%治疗和护盾强度/);
  bound(object, 2526, 'keyTooltip', /@ManaChargeAmmoCD@秒.*最大@ManaChargeMaxAmmo@层.*@ManaPerCharge@最大法力值.*对英雄时翻倍/);
  bound(object, 2526, 'keyTooltip', /@MaxMana@最大法力值.*歌之权冠/);
  proof(object, '/Items~12526/mItemCalculations/BonusHSPCalc', { raw: bonusHsp, internalCDPerCastID: internalCooldown }, { bonusHsp, internalCooldown });
  proof(object, '/Items~12526/specialRecipe', '当前对象没有specialRecipe；升级目标由绑定文本直接指向item_2530', { path: item.path, tooltip: object.source.bindings.keyTooltip.text });
  object.crossSkillDependencies = [{ equipmentKey: 'item_2530', relation: '当前绑定文本明确累计最大法力达到360后转变为歌之权冠；本批只保留关系提示，不复制目标数值或生命周期。' }];
  note(object, '来源待核', '和谐能力资源属性与单位', 'AbilityResourceByCoefficientCalculationPart系数0.005且缺少mStat；按绑定文本后置%解释为百分数点，资源1000输出5%，当前不把能力资源擅自映射为法术强度或最大法力。');
  note(object, '尚未接线', '法力流充能和升级', '技能命中来源、英雄翻倍、8秒充能窗口、5层上限、累计法力持久化和转变为2530的时点均未接线。');
  omitted(object, 'effect', 'harmony_strength', '能力资源属性归属和装备生效时点尚未确证。');
  omitted(object, 'internalState', 'mana_flow_stacks', '层数状态和充能消费尚未形成可安全提交的状态结构。');
  pending(object, '法力流成长', '待补命中事件、充能层数、英雄目标翻倍、累计法力和item_2530转变关系。');
  objects.push(object);
}

{
  const item = root(2530);
  const object = base(2530, 'passive', '和谐与和音', '保留自身和谐0.005×能力资源得到的百分数点结果（资源1000得到5%）。只治疗第三方最低生命友军的和音整支（比例、前3秒资格、附近范围和每秒治疗）按本批约定仅归档来源，不进入正常参数、公式或后续待接项。');
  currentCandidate = object;
  const percentManaToHeal = sourceOnlyValue(object, item, 2530, 'PercentManaToHeal', '客户端字段为0.01，但当前根说明绑定ManaToHeal计算树且没有直接引用此字段，保留来源不替换计算系数。');
  const allyRange = sourceOnlyValue(object, item, 2530, 'AllyRangeCheck', '900是附近友军空间字段，本轮保留来源，不把它写成自我治疗范围。');
  const allyCombatDuration = sourceOnlyValue(object, item, 2530, 'AllyCombatDuration', '第三方最低生命友军和音支路的前3秒资格按本批约定仅作来源归档。');
  const bonusHsp = calculation(object, 2530, 'BonusHSPCalc', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStat'), false);
    assert.equal(raw.mFormulaParts[0].mStatFormula, 2);
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), 0.005);
  }, { coefficient: 0.005, mStat: '省略', mStatFormula: 2, resource: '显式输入' });
  const manaToHeal = calculation(object, 2530, 'ManaToHeal', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStat'), false);
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStatFormula'), false);
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), 0.008);
  }, { coefficient: 0.008, mStat: '省略', mStatFormula: '省略', resource: '显式输入' });
  param(object, 'harmony_resource_percent_point_coefficient', '歌之权冠每点能力资源治疗和护盾强度百分数点系数', 0.005, 'BonusHSPCalc系数约0.005；计算结果单位为百分数点，资源1000得到5%，不是0.05小数比例；能力资源属性未由当前树直接给出。');
  runtime(object, 'harmony_resource_input', '歌之权冠和谐能力资源输入', '非负小数显式输入；当前节点缺少mStat，不能默认法术强度或最大法力。');
  formula(object, 'harmony_heal_shield_strength_percent_points', '歌之权冠和谐治疗和护盾强度百分数点', '0.005×显式能力资源输入，结果单位为百分数点；若后续转成0至1比例，必须再除以100。', operation('MULTIPLY', parameterNode('harmony_resource_percent_point_coefficient'), parameterNode('harmony_resource_input')));
  bound(object, 2530, 'keyTooltip', /获得@BonusHSPCalc@%治疗和护盾强度/);
  bound(object, 2530, 'keyTooltip', /前@AllyCombatDuration@秒提供过治疗或护盾.*每秒治疗附近生命值最低的那个友军@ManaToHeal@/);
  proof(object, '/Items~12530/mItemCalculations/BonusHSPCalc+ManaToHeal', { bonusHsp, manaToHeal, percentManaToHeal, allyRange }, { bonusHsp, manaToHeal, percentManaToHeal, allyRange });
  proof(object, '/Items~12530/specialRecipe', 2526, { specialRecipe: item.object.specialRecipe, tooltip: object.source.bindings.keyTooltip.text });
  object.crossSkillDependencies = [{ equipmentKey: 'item_2526', relation: '客户端specialRecipe=2526，且绑定文本为2526达到360最大法力后转变的目标；本批不复制2526充能数值。' }];
  note(object, '来源待核', '和谐能力资源与单位', 'BonusHSPCalc系数0.005且缺少mStat；绑定文本后置%表示百分数点，资源1000输出5%，若供0至1比例属性须除以100；PercentManaToHeal=0.01和ManaToHeal=0.008仅作为和音支路来源证据。');
  note(object, '范围外', '和音第三方最低生命友军支路', '和音明确治疗附近生命值最低的友军；比例、前3秒治疗/护盾资格、战斗状态、每秒节拍和900码附近筛选均按本批约定只保留来源，不进入系统待接。');
  note(object, '尚未接线', '自身和谐生效', '自身治疗和护盾强度属性的生效时点及能力资源动态读取尚未接线。');
  omitted(object, 'effect', 'ally_lowest_health_heal_branch', '第三方最低生命友军和音整支按本批约定排除，原始资格、比例、范围和计算树仅保留来源证据。');
  omitted(object, 'parameter', 'ally_combat_duration', '和音前3秒友军资格按本批约定仅保留来源证据。');
  objects.push(object);
}

{
  const item = root(3040);
  const object = base(3040, 'passive', '敬畏与救主灵刃', '保留按最大法力值获得0.02比例法术强度、生命值低于30%阈值、持续3秒护盾、90秒冷却和0.18能力资源护盾系数。法力转法术强度使用绑定文字明确的SOURCE mana TOTAL；护盾基数使用显式资源输入，资格、冷却消费和护盾吸收尚未接线。');
  currentCandidate = object;
  const apFromMana = value(item, 3040, 'APFromMana');
  const threshold = value(item, 3040, 'HealthThreshold');
  const shieldDuration = value(item, 3040, 'ShieldDuration');
  const lifelineCooldown = sameValue(item, 3040, 'LifelineCooldown', 'Cooldown');
  const shield = calculation(object, 3040, 'ShieldValue', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStat'), false);
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStatFormula'), false);
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), 0.18);
  }, { coefficient: 0.18, resource: '显式输入' });
  const bonusAp = calculation(object, 3040, 'BonusAPCalc', raw => {
    assert.equal(raw.tooltipOnly, true);
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(Object.hasOwn(raw.mFormulaParts[0], 'mStat'), false);
    assert.equal(raw.mFormulaParts[0].mStatFormula, 2);
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), 0.02);
  }, { coefficient: 0.02, resource: 'SOURCE mana TOTAL', tooltipOnly: true });
  param(object, 'bonus_ap_from_max_mana_ratio', '敬畏最大法力转法术强度比例', apFromMana, '当前APFromMana=0.02，绑定文本明确结果为法术强度，基数为最大法力值。');
  param(object, 'lifeline_health_threshold_ratio', '救主灵刃生命值阈值', threshold, '当前HealthThreshold=0.3，即生命值低于30%。');
  param(object, 'lifeline_shield_duration_ms', '救主灵刃护盾持续时间', shieldDuration * 1000, '当前ShieldDuration=3秒，换算为3000毫秒。');
  param(object, 'lifeline_cooldown_ms', '救主灵刃冷却', lifelineCooldown * 1000, '当前LifelineCooldown与Cooldown均为90秒，换算为90000毫秒。');
  param(object, 'lifeline_shield_resource_ratio', '救主灵刃护盾资源系数', 0.18, 'ShieldValue系数约0.18；能力资源属性缺失，护盾基数使用显式输入。');
  runtime(object, 'lifeline_shield_resource_input', '救主灵刃护盾资源输入', '非负小数显式输入；ShieldValue缺少mStat和mStatFormula，不能默认最大法力或生命值。');
  formula(object, 'bonus_ap_from_max_mana', '敬畏最大法力转法术强度', 'SOURCE mana TOTAL×0.02；直接装备法力属性只作为现值保护，不重复写入。', operation('MULTIPLY', attributeNode('SOURCE', 'mana', 'TOTAL'), parameterNode('bonus_ap_from_max_mana_ratio')));
  formula(object, 'lifeline_shield_value', '救主灵刃护盾值', '0.18×显式能力资源输入；护盾基数属性待核。', operation('MULTIPLY', parameterNode('lifeline_shield_resource_ratio'), parameterNode('lifeline_shield_resource_input')));
  bound(object, 3040, 'keyTooltip', /获得<scaleAP>@BonusAPCalc@法术强度/);
  bound(object, 3040, 'keyTooltip', /生命值跌到@HealthThreshold\*100@%以下.*@ShieldDuration@秒.*@ShieldValue@护盾值/);
  proof(object, '/Items~13040/mItemCalculations/BonusAPCalc+ShieldValue', { bonusAp, shield }, { bonusAp, shield });
  proof(object, '/Items~13040/specialRecipe', 3003, { specialRecipe: item.object.specialRecipe, tooltip: object.source.bindings.keyTooltip.text });
  object.crossSkillDependencies = [{ equipmentKey: 'item_3003', relation: '客户端specialRecipe=3003；本批只记录成长来源，不引入未选对象数值。' }];
  note(object, '来源待核', '护盾能力资源属性', 'ShieldValue使用能力资源系数0.18且缺少mStat；当前只以显式输入保存，不把它擅自映射为最大法力或最大生命。');
  note(object, '尚未接线', '救主灵刃护盾触发', '受到伤害后生命值低于30%的严格判定、护盾授予时点、90秒冷却、护盾吸收和法术护盾资格均未接线。');
  omitted(object, 'effect', 'lifeline_shield', '阈值、冷却消费和护盾生命周期尚未确证。');
  pending(object, '救主灵刃', '待补伤害后阈值判定、护盾基数属性、冷却和护盾消费。');
  objects.push(object);
}

{
  const item = root(3042);
  const object = base(3042, 'passive', '敬畏与冲击', '保留2%最大法力值转额外攻击力、1.2%最大法力值攻击特效伤害、伤害型技能远程3%与近战4%最大法力值伤害，以及客户端远程施法分支1/2。所有法力公式使用SOURCE mana TOTAL；AbilityTADRatio缺失不填0，6.5锁定值只保留来源。');
  currentCandidate = object;
  const bonusAdRatio = value(item, 3042, 'BonusADManaRatioTOOLTIPONLY');
  const onHitRatio = value(item, 3042, 'OnHitManaRatioTOOLTIPONLY');
  const rangedRatio = value(item, 3042, 'AbilityManaRatioRangedTOOLTIPONLY');
  missingValue(object, item, 3042, 'AbilityTADRatio');
  const lockout = sourceOnlyValue(object, item, 3042, 'PerCastIDLockout', '客户端值为6.5，但当前绑定文本未确认单位、事件类型和是否为技能共享锁定，不换算毫秒。');
  const meleeRatio = value(item, 3042, 'AbilityManaRatioMeleeTOOLTIPONLY');
  const bonusAd = calculation(object, 3042, 'BonusADFromMana', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), bonusAdRatio);
  }, { coefficient: bonusAdRatio, resource: 'SOURCE mana TOTAL' });
  const onHit = calculation(object, 3042, 'OnHitDamage', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), onHitRatio);
  }, { coefficient: onHitRatio, resource: 'SOURCE mana TOTAL' });
  const melee = calculation(object, 3042, 'MeleeItemCalcValue', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), meleeRatio);
  }, { coefficient: meleeRatio, resource: 'SOURCE mana TOTAL', variant: '近战' });
  const ranged = calculation(object, 3042, 'RangedItemCalcValue', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'AbilityResourceByCoefficientCalculationPart');
    assert.equal(clean(raw.mFormulaParts[0].mCoefficient), rangedRatio);
  }, { coefficient: rangedRatio, resource: 'SOURCE mana TOTAL', variant: '远程' });
  const champRange = item.object.mItemCalculations.ChampRange;
  assert.equal(champRange.__type, 'GameCalculationConditional');
  assert.equal(champRange.mConditionalCalculationRequirements.__type, 'IsRangedCastRequirement');
  assert.equal(champRange.mSimpleTooltipCalculationDisplay, 5);
  assert.equal(champRange.mExpandedTooltipCalculationDisplay, 5);
  const defaultRange = item.object.mItemCalculations['{792cf56b}'];
  const rangedRange = item.object.mItemCalculations['{06387172}'];
  assert.equal(defaultRange.mFormulaParts[0].mNumber, 1);
  assert.equal(rangedRange.mFormulaParts[0].mNumber, 2);
  proof(object, '/Items~13042/mItemCalculations/ChampRange', { requirement: 'IsRangedCastRequirement', default: 1, ranged: 2 }, { champRange, defaultRange, rangedRange });
  param(object, 'bonus_ad_from_max_mana_ratio', '敬畏最大法力转额外攻击力比例', bonusAdRatio, '绑定扩展文本明确为2%最大法力值额外攻击力。');
  param(object, 'on_hit_max_mana_damage_ratio', '冲击攻击特效最大法力值比例', onHitRatio, '绑定扩展文本明确为1.2%最大法力值额外物理伤害。');
  param(object, 'ranged_ability_max_mana_damage_ratio', '冲击远程技能最大法力值比例', rangedRatio, '绑定扩展文本明确远程伤害型技能使用3%最大法力值。');
  param(object, 'melee_ability_max_mana_damage_ratio', '冲击近战技能最大法力值比例', meleeRatio, '绑定扩展文本明确近战伤害型技能使用4%最大法力值。');
  param(object, 'champ_range_default_value', '冲击默认施法距离分支值', 1, 'ChampRange默认计算树为1；不把它当成伤害倍率。');
  param(object, 'champ_range_ranged_value', '冲击远程施法距离分支值', 2, 'ChampRange的IsRangedCastRequirement分支为2；不在公式外假定施法类型。');
  formula(object, 'bonus_attack_damage_from_max_mana', '敬畏最大法力转额外攻击力', '最大法力值×2%比例；直接装备法力属性只作为现值保护。', operation('MULTIPLY', attributeNode('SOURCE', 'mana', 'TOTAL'), parameterNode('bonus_ad_from_max_mana_ratio')));
  formula(object, 'on_hit_damage_from_max_mana', '冲击攻击特效伤害', '最大法力值×1.2%比例；英雄目标与攻击特效资格尚未接线。', operation('MULTIPLY', attributeNode('SOURCE', 'mana', 'TOTAL'), parameterNode('on_hit_max_mana_damage_ratio')));
  formula(object, 'melee_ability_damage_from_max_mana', '冲击近战技能伤害', '最大法力值×4%比例；仅表达近战分支数值。', operation('MULTIPLY', attributeNode('SOURCE', 'mana', 'TOTAL'), parameterNode('melee_ability_max_mana_damage_ratio')));
  formula(object, 'ranged_ability_damage_from_max_mana', '冲击远程技能伤害', '最大法力值×3%比例；仅表达远程分支数值。', operation('MULTIPLY', attributeNode('SOURCE', 'mana', 'TOTAL'), parameterNode('ranged_ability_max_mana_damage_ratio')));
  formula(object, 'champ_range_default', '冲击默认施法分支', '未满足IsRangedCastRequirement时使用1；条件判断由运行时提供。', parameterNode('champ_range_default_value'));
  formula(object, 'champ_range_ranged', '冲击远程施法分支', '满足IsRangedCastRequirement时使用2；条件判断由运行时提供。', parameterNode('champ_range_ranged_value'));
  bound(object, 3042, 'keyTooltip', /攻击会对英雄造成额外.*@OnHitDamage@.*伤害型技能.*Item_Melee_Ranged_Split/);
  bound(object, 3042, 'keyTooltipExternal', /@BonusADManaRatioTOOLTIPONLY\*100@%最大法力值.*@OnHitManaRatioTOOLTIPONLY\*100@%最大法力值.*@AbilityManaRatioRangedTOOLTIPONLY\*100@% - @AbilityManaRatioMeleeTOOLTIPONLY\*100@%/);
  proof(object, '/Items~13042/mDataValues/PerCastIDLockout', '6.5，仅来源证据，不填默认冷却', { value: lockout, raw: dataRows(item, 'PerCastIDLockout') });
  proof(object, '/Items~13042/mItemCalculations/BonusADFromMana+OnHitDamage+MeleeItemCalcValue+RangedItemCalcValue', { bonusAd, onHit, melee, ranged }, { bonusAd, onHit, melee, ranged });
  note(object, '来源待核', 'AbilityTADRatio与锁定值', 'AbilityTADRatio记录没有mValue，不能补0；PerCastIDLockout=6.5的单位和事件归属未证，不能写成6500毫秒冷却。');
  note(object, '尚未接线', '敬畏与冲击事件', '装备生效属性、英雄目标、攻击特效、伤害型技能判定、每次施法锁定和远近程分支选择均未接线。');
  omitted(object, 'parameter', 'ability_tad_ratio', '来源字段缺少mValue，不填0。');
  omitted(object, 'parameter', 'per_cast_id_lockout', '值有来源但单位与事件归属未证，只保留原始证据。');
  omitted(object, 'effect', 'on_hit_and_ability_damage', '命中、英雄筛选、远近程条件和锁定消费尚未确证。');
  pending(object, '冲击法力效果', '待补最大法力动态读取、攻击特效和技能事件身份、英雄目标筛选、每次施法锁定与远近程条件。');
  object.crossSkillDependencies = [{ equipmentKey: 'item_3004', relation: '客户端specialRecipe=3004；本批不引入未选基础形态数值，保留成长来源提示。' }];
  objects.push(object);
}

{
  const item = root(3073);
  const object = base(3073, 'passive', '海克斯充能与过载', '保留30点终极技能急速、终极技能施放后持续8秒的近战50%/远程35%攻击速度和近战20%/远程14%移动速度。客户端另有未沿当前绑定说明使用的MovementSpeedBonus=0.2，仅作来源证据；终极技能事件、近远程选择和状态刷新尚未接线。');
  currentCandidate = object;
  const ultimateHaste = value(item, 3073, 'UltimateHaste');
  const movementSpeedBonus = sourceOnlyValue(object, item, 3073, 'MovementSpeedBonus', '客户端字段为0.2，但当前绑定文本通过BonusMS近远程分支显示，未直接绑定此字段。');
  const hasteDuration = value(item, 3073, 'HasteDuration');
  const cooldown = value(item, 3073, 'Cooldown');
  const rangedAs = value(item, 3073, 'BonusASRanged') / 100;
  const meleeAs = value(item, 3073, 'BonusASMelee') / 100;
  const rangedMs = value(item, 3073, 'BonusMSRanged') / 100;
  const meleeMs = value(item, 3073, 'BonusMSMelee') / 100;
  const split = item.object.StringCalculations;
  assert.deepEqual(split.BonusAS, { MeleeResult: '@BonusASMelee@', RangedResult: '@BonusASRanged@', DefaultResult: '@BonusASMelee@', __type: '{4750ceb6}' });
  assert.deepEqual(split.BonusMS, { MeleeResult: '@BonusMSMelee@', RangedResult: '@BonusMSRanged@', DefaultResult: '@BonusMSMelee@', __type: '{4750ceb6}' });
  param(object, 'overload_ultimate_haste', '海克斯充能终极技能急速', ultimateHaste, '当前UltimateHaste=30。');
  param(object, 'overload_duration_ms', '过载持续时间', hasteDuration * 1000, '当前HasteDuration=8秒，换算为8000毫秒。');
  param(object, 'overload_cooldown_ms', '过载冷却', cooldown * 1000, '当前Cooldown=30秒，换算为30000毫秒；冷却消费待接线。');
  param(object, 'melee_attack_speed_bonus_ratio', '过载近战攻击速度比例', meleeAs, '当前BonusASMelee=50，按绑定文本百分数换算为0.5小数比例。');
  param(object, 'ranged_attack_speed_bonus_ratio', '过载远程攻击速度比例', rangedAs, '当前BonusASRanged=35，按绑定文本百分数换算为0.35小数比例。');
  param(object, 'melee_move_speed_bonus_ratio', '过载近战移动速度比例', meleeMs, '当前BonusMSMelee=20，按绑定文本百分数换算为0.2小数比例。');
  param(object, 'ranged_move_speed_bonus_ratio', '过载远程移动速度比例', rangedMs, '当前BonusMSRanged=14，按绑定文本百分数换算为0.14小数比例。');
  formula(object, 'overload_melee_attack_speed_bonus', '过载近战攻击速度结果', '近战分支使用0.5小数比例；分支选择由运行时攻击类型提供。', parameterNode('melee_attack_speed_bonus_ratio'));
  formula(object, 'overload_ranged_attack_speed_bonus', '过载远程攻击速度结果', '远程分支使用0.35小数比例；分支选择由运行时攻击类型提供。', parameterNode('ranged_attack_speed_bonus_ratio'));
  formula(object, 'overload_melee_move_speed_bonus', '过载近战移动速度结果', '近战分支使用0.2小数比例；分支选择由运行时攻击类型提供。', parameterNode('melee_move_speed_bonus_ratio'));
  formula(object, 'overload_ranged_move_speed_bonus', '过载远程移动速度结果', '远程分支使用0.14小数比例；分支选择由运行时攻击类型提供。', parameterNode('ranged_move_speed_bonus_ratio'));
  bound(object, 3073, 'keyTooltip', /施放你的终极技能后.*@HasteDuration@秒.*@BonusAS@%攻击速度.*@BonusMS@%移动速度/);
  proof(object, '/Items~13073/StringCalculations/BonusAS+BonusMS', split, split);
  proof(object, '/Items~13073/mDataValues/MovementSpeedBonus', { value: movementSpeedBonus, usage: '仅来源证据', reason: '当前根说明使用BonusMS近远程分支' }, dataRows(item, 'MovementSpeedBonus'));
  note(object, '来源待核', '未绑定MovementSpeedBonus', 'MovementSpeedBonus=0.2未沿当前根说明直接绑定；候选采用StringCalculations的BonusMS近远程分支值，不把两个来源字段无条件叠加。');
  note(object, '尚未接线', '过载终极技能状态', '终极技能施放事件、持续8秒、近远程选择、攻击速度与移动速度应用和30秒冷却均未接线。');
  omitted(object, 'effect', 'overload_stat_bonuses', '静态分支数值已保存，状态触发和刷新尚未确证。');
  pending(object, '过载状态', '待补终极技能事件、攻击类型分支、状态生命周期和冷却消费。');
  objects.push(object);
}

{
  const item = root(3083);
  const object = base(3083, 'passive', '狂徒之心与狂徒之活力', '保留2000额外生命值门槛、受到英雄伤害后8秒等待、0.015生命值计算系数、提示文本×2和12%装备生命值转额外生命值。客户端SecondsPerHeal=0.5与绑定文本“每秒”存在节拍冲突，仅作来源证据，不构造0.5秒周期；mStat=12基数使用显式输入。');
  currentCandidate = object;
  const maxHealthRatio = value(item, 3083, 'MaxHealthRatio');
  const secondsPerHeal = sourceOnlyValue(object, item, 3083, 'SecondsPerHeal', '客户端字段为0.5，但当前绑定文本明确每秒回复；单位和首次执行未解决，不进入正常参数。');
  const healthThreshold = value(item, 3083, 'HealthThreshold');
  const championTimer = value(item, 3083, 'OOCTimerChampion');
  const nonHeroTimer = value(item, 3083, 'OOCTimer');
  const hpAmp = value(item, 3083, 'HPAmp');
  const totalHealing = calculation(object, 3083, 'TotalHealing', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 1);
    assert.equal(raw.mFormulaParts[0].__type, 'StatByNamedDataValueCalculationPart');
    assert.equal(raw.mFormulaParts[0].mStat, 12);
    assert.equal(raw.mFormulaParts[0].mDataValue, 'MaxHealthRatio');
  }, { mStat: 12, mDataValue: 'MaxHealthRatio', coefficient: maxHealthRatio, statistic: '显式输入' });
  const tooltipCalc = item.object.mItemCalculations.TotalHealingTooltip;
  assert.deepEqual(tooltipCalc, { mMultiplier: { mNumber: 2, __type: 'NumberCalculationPart' }, mModifiedGameCalculation: 'TotalHealing', __type: 'GameCalculationModified' });
  proof(object, '/Items~13083/mItemCalculations/TotalHealingTooltip', { multiplier: 2, source: 'TotalHealing' }, tooltipCalc);
  param(object, 'warmog_health_threshold', '狂徒之心额外生命值门槛', healthThreshold, '当前HealthThreshold=2000。');
  param(object, 'warmog_no_champion_damage_duration_ms', '狂徒之心英雄脱战等待时间', championTimer * 1000, '当前OOCTimerChampion=8秒，换算为8000毫秒；只保存等待时间。');
  param(object, 'warmog_healing_ratio', '狂徒之心生命值计算比例', maxHealthRatio, '当前MaxHealthRatio=0.015；mStat=12基数使用显式输入。');
  param(object, 'warmog_tooltip_multiplier', '狂徒之心提示倍率', 2, 'TotalHealingTooltip明确使用×2；不改变客户端基础计算树。');
  runtime(object, 'warmog_healing_stat_input', '狂徒之心mStat12输入', '非负小数显式输入；mStat=12属性归属和取值口径待核，不能默认最大生命或额外生命。');
  param(object, 'warmog_equipment_health_ratio', '狂徒之活力装备生命值比例', hpAmp, '当前HPAmp=0.12，绑定文本明确按装备生命值的12%计算。');
  runtime(object, 'warmog_equipment_health_input', '狂徒之活力装备生命值输入', '非负小数显式输入；输入应对应装备生命值，不把持有者总生命值误作装备生命值。');
  formula(object, 'warmog_base_healing_value', '狂徒之心基础治疗值', '0.015×显式mStat12输入；只保存计算形状。', operation('MULTIPLY', parameterNode('warmog_healing_ratio'), parameterNode('warmog_healing_stat_input')));
  formula(object, 'warmog_tooltip_healing_value', '狂徒之心提示治疗值', '0.015×显式mStat12输入×2；实际每秒周期未由公式决定。', operation('MULTIPLY', operation('MULTIPLY', parameterNode('warmog_healing_ratio'), parameterNode('warmog_healing_stat_input')), parameterNode('warmog_tooltip_multiplier')));
  formula(object, 'warmog_bonus_health_from_equipment', '狂徒之活力额外生命值', '装备生命值输入×0.12；不把装备直接属性再次提交。', operation('MULTIPLY', parameterNode('warmog_equipment_health_input'), parameterNode('warmog_equipment_health_ratio')));
  bound(object, 3083, 'keyTooltip', /@HealthThreshold@额外生命值.*@OOCTimerChampion@秒内没有受到伤害.*每秒回复.*@TotalHealingTooltip@/);
  bound(object, 3083, 'keyTooltipExtendedRules', /非英雄单位的伤害.*@OOCTimer@秒/);
  proof(object, '/Items~13083/mDataValues/SecondsPerHeal+OOCTimer', { secondsPerHeal, nonHeroTimer, textCadence: '每秒', usage: '节拍冲突来源证据' }, [dataRows(item, 'SecondsPerHeal'), dataRows(item, 'OOCTimer')]);
  note(object, '来源待核', '持续治疗节拍与mStat12', 'SecondsPerHeal=0.5与绑定文本每秒不一致，且TotalHealing的mStat=12基数未直接绑定；不把0.5写成周期，不把mStat=12补成最大或额外生命。');
  note(object, '范围外', '非英雄伤害失能', '扩展规则明确非英雄单位伤害使狂徒之心失能3秒；本轮只保存来源，不把该非英雄分支并入英雄1V1效果。');
  note(object, '尚未接线', '狂徒之心资格与周期', '额外生命门槛、英雄脱战等待、每秒治疗、非英雄失能、治疗上限和狂徒之活力属性结果均未接线。');
  omitted(object, 'parameter', 'seconds_per_heal', '客户端字段与绑定文本节拍冲突，只保留来源证据。');
  omitted(object, 'effect', 'warmog_healing_and_health_amp', '资格、周期和属性基数尚未确证，只有显式输入公式进入候选。');
  pending(object, '狂徒之心状态', '待补mStat12属性口径、英雄/非英雄伤害计时、首跳与周期边界和额外生命属性应用。');
  objects.push(object);
}

assert.equal(objects.length, selectedIds.length, '候选技能数量必须等于12');
const payload = await output(objects);
assert.equal(payload.totals.equipment, 12);
assert.equal(payload.totals.skills, 12);
console.log(JSON.stringify({
  file: '完整候选.json',
  totals: payload.totals,
  skills: objects.map(object => ({ equipmentKey: object.equipmentKey, skillKey: object.skillKey, parameters: object.apiPayload.parameters.length, formulas: object.apiPayload.formulas.length, omitted: object.omittedComponents.length, pending: object.pendingComponents.length })),
  currentEvidenceAt: before.at,
  sourceEvidenceAt: source.generatedAt
}));
