import assert from 'node:assert/strict';
import {
  source,
  before,
  selectedIds,
  base,
  clean,
  data,
  dataRows,
  numberCalculation,
  parameterNode,
  attributeNode,
  operation,
  param,
  runtime,
  characterLevel,
  formula,
  note,
  omitted,
  pending,
  proof,
  output
} from './候选工具.mjs';

if (process.argv.length > 2) throw Error('第十五批候选生成器不接受参数，也不包含业务写入口');

const sourceById = new Map(source.objects.map(object => [object.id, object]));
let currentCandidate = null;
const root = id => {
  const object = sourceById.get(id);
  assert.ok(object, `冻结来源缺少装备 ${id}`);
  return object;
};

function value(object, id, key, accepted = data(object, key)) {
  const rows = dataRows(object, key);
  assert.ok(rows.length, `${object.path}/${key} 缺少原始数据值`);
  assert.ok(rows.every(row => Number.isFinite(row.mValue)), `${object.path}/${key} 含缺失值`);
  assert.ok(rows.every(row => clean(row.mValue) === accepted), `${object.path}/${key} 值不一致`);
  assert.ok(currentCandidate, '数据值读取必须在候选对象上下文中进行');
  proof(currentCandidate, `/Items~1${id}/mDataValues/${key}`, accepted, rows);
  return accepted;
}

function sourceOnlyValue(object, id, key, reason) {
  const sourceObject = root(id);
  const rows = dataRows(sourceObject, key);
  assert.ok(rows.length, `${sourceObject.path}/${key} 缺少原始数据值`);
  assert.ok(rows.every(row => Number.isFinite(row.mValue)), `${sourceObject.path}/${key} 含缺失值`);
  const accepted = clean(rows[0].mValue);
  assert.ok(rows.every(row => clean(row.mValue) === accepted), `${sourceObject.path}/${key} 值不一致`);
  proof(object, `/Items~1${id}/mDataValues/${key}`, { value: accepted, usage: '仅来源证据', reason }, rows);
  return accepted;
}

function missingValue(object, id, key, accepted) {
  const rows = dataRows(object, key);
  assert.ok(rows.length, `${object.path}/${key} 缺少应保留的缺失字段`);
  assert.ok(rows.every(row => !Object.hasOwn(row, 'mValue')), `${object.path}/${key} 出现未授权数值`);
  proof(object, `/Items~1${id}/mDataValues/${key}`, accepted, rows);
}

function bound(object, id, field, textPattern, accepted = object.source.bindings[field]?.text) {
  const binding = object.source.bindings[field];
  assert.ok(binding?.text, `${object.skillKey} 缺少绑定文本 ${field}`);
  if (textPattern) assert.match(binding.text, textPattern);
  proof(object, `/Items~1${id}/mItemDataClient/mTooltipData/mLocKeys/${field}`, accepted, binding);
  return binding;
}

function calculation(object, id, key, check, accepted) {
  const raw = root(id).object.mItemCalculations?.[key];
  assert.ok(raw, `${id} 缺少计算式 ${key}`);
  check(raw);
  proof(object, `/Items~1${id}/mItemCalculations/${key}`, accepted, raw);
  return raw;
}

function unboundCalculation(object, id, key, raw, check, accepted) {
  check(raw);
  proof(object, `/Items~1${id}/mItemCalculations/${key}`, accepted, raw);
}

const objects = [];

{
  const item = root(2503);
  const object = base(2503, 'passive', '邪焰与黯炎', '保留伤害型技能每秒20与3秒持续，以及客户端0.02缩放系数和每个受影响目标4%法术强度比例。缩放属性由显式小数输入提供，mStat缺失不命名为法术强度；客户端节拍字段只作来源记录，单位和绑定用途未证实，不构造持续伤害节拍或黯炎触发规则。');
  currentCandidate = object;
  const burn = calculation(object, 2503, 'BurnDamagePerSecondCalc', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].mDataValue, 'BurnFlatDamagePerSecond');
    assert.equal(raw.mFormulaParts[1].mDataValue, 'APRatio');
    assert.equal(raw.mFormulaParts[1].__type, 'StatByNamedDataValueCalculationPart');
    assert.equal(Object.hasOwn(raw.mFormulaParts[1], 'mStat'), false, 'mStat缺失不得补法强');
  }, { base: 20, coefficient: 0.02, statistic: '未提供', operation: 'base + coefficient × explicit runtime input' });
  const ratio = value(item, 2503, 'APRatio');
  const duration = value(item, 2503, 'BurnDuration');
  const tick = sourceOnlyValue(object, 2503, 'TickFrequency', '客户端字段数值为0.5，但单位和当前绑定用途未证实，不进入正常参数。');
  const stack = value(item, 2503, 'APPerStack');
  param(object, 'burn_flat_damage_per_second', '邪焰固定每秒伤害', value(item, 2503, 'BurnFlatDamagePerSecond'), '当前BurnDamagePerSecondCalc第一项BurnFlatDamagePerSecond；单位为每秒伤害。');
  param(object, 'burn_scaling_ratio', '邪焰未定属性缩放比例', ratio, '当前APRatio=0.02；对应计算节点mStat缺失，只保存系数，不把它命名为法术强度比例。');
  runtime(object, 'burn_scaling_stat_value', '邪焰缩放属性显式输入', '非负小数输入；来源应在运行时明确mStat对应的属性后提供。mStat在当前客户端节点中缺失，不能默认法术强度或缺失为0。');
  param(object, 'burn_duration_seconds', '邪焰持续时间', duration, '当前BurnDuration=3秒；只保存文本明确的持续时间，不表示已经建立周期执行。');
  param(object, 'ability_power_per_affected_target_ratio', '黯炎每个受影响目标法术强度比例', stack, '当前APPerStack=0.04，绑定文本明确为每个受影响单位4%法术强度；影响资格、层数上限和撤销时点待核。');
  formula(object, 'burn_damage_per_second', '邪焰每秒伤害值', '20 + 0.02 × 显式缩放属性输入；只表达客户端计算形状，不指定mStat属性。', operation('ADD', parameterNode('burn_flat_damage_per_second'), operation('MULTIPLY', parameterNode('burn_scaling_ratio'), parameterNode('burn_scaling_stat_value'))));
  bound(object, 2503, 'keyTooltip', /伤害型技能造成每秒/);
  bound(object, 2503, 'keyTooltipExtendedRules', /对小兵造成每秒/);
  proof(object, '/Items~12503/mDataValues/APRatio', { value: ratio, mStat: '省略' }, dataRows(item, 'APRatio'));
  proof(object, '/Items~12503/mDataValues/BurnDuration+TickFrequency', { durationSeconds: duration, sourceTickFrequencyValue: tick, sourceTickFrequencyUnit: '未证实' }, [dataRows(item, 'BurnDuration'), dataRows(item, 'TickFrequency')]);
  note(object, '范围外', '小兵与野怪分支', '客户端扩展文本另有小兵、野怪每秒数值；本轮候选只处理装备对单个英雄的本体资料，保留原始对象和扩展绑定，不把非英雄分支接入。');
  note(object, '来源待核', 'mStat属性归属', 'BurnDamagePerSecondCalc和相关分支的StatByNamedDataValueCalculationPart没有mStat；只保存系数与显式输入，不能补成法术强度。');
  note(object, '来源待核', '持续伤害节拍', 'TickFrequency数值为0.5，但单位和当前绑定用途未证实；不能据此确定首次执行、跳数、边界或周期消费。');
  note(object, '尚未接线', '邪焰触发与黯炎层数', '伤害型技能资格、英雄/野怪筛选、装备自身伤害递归、每目标层数和法术强度效果撤销均未接线；不创建空触发规则。');
  omitted(object, 'effect', 'burn_damage', '触发事件、目标筛选和节拍尚未确证，只有参数与显式输入公式进入正常候选。');
  omitted(object, 'parameter', 'tick_frequency', '客户端字段有数值但单位和绑定用途未证实，只保留原始来源证据。');
  pending(object, '邪焰合法来源与周期', '待补技能伤害事件、首跳/后续跳、持续结束及自身递归门禁。');
  pending(object, '黯炎层数与属性效果', '待补受影响目标身份、层数上限、离开影响后的撤销和重复装备处理。');
  objects.push(object);
}

{
  const item = root(2508);
  const object = base(2508, 'passive', '激燃', '保留伤害型技能带来的每秒5额外魔法伤害和3秒持续，并用5×3=15表达英雄总量。总量公式不决定跳频、首次执行或触发资格；客户端节拍字段只作来源记录，单位和绑定用途未证实；野怪额外45只保留在来源，不并入本轮英雄候选。');
  currentCandidate = object;
  const perSecond = value(item, 2508, 'BurnFlatDamagePerSecond');
  const duration = value(item, 2508, 'BurnDuration');
  const tick = sourceOnlyValue(object, 2508, 'TickFrequency', '客户端字段数值为0.5，但单位和当前绑定用途未证实，不进入正常参数。');
  value(item, 2508, 'MonsterDamageBonus');
  param(object, 'damage_per_second', '激燃每秒额外魔法伤害', perSecond, '当前BurnFlatDamagePerSecond=5；绑定说明明确每秒伤害。');
  param(object, 'damage_duration_seconds', '激燃伤害持续时间', duration, '当前BurnDuration=3秒；仅用于独立总量算例，不构造周期规则。');
  formula(object, 'total_damage', '激燃持续期间总伤害', '5每秒 × 3秒 = 15；仅表达来源文本明确的总量，不代表运行时已建立持续伤害效果。', operation('MULTIPLY', parameterNode('damage_per_second'), parameterNode('damage_duration_seconds')));
  bound(object, 2508, 'keyTooltip', /在@BurnDuration@秒里持续造成/);
  proof(object, '/Items~12508/mDataValues/MonsterDamageBonus', '45为野怪额外总量，仅作范围外来源证据', dataRows(item, 'MonsterDamageBonus'));
  note(object, '范围外', '野怪额外伤害', '绑定文本明确对野怪另有45额外魔法伤害；本轮按英雄单目标范围保存15总量，不扩展非英雄目标。');
  note(object, '来源待核', '持续伤害的事件与节拍', '5每秒和3秒总量已明确；TickFrequency数值为0.5但单位和绑定用途未证实，合法技能伤害、首次执行、周期边界及是否可重叠仍未确证。');
  note(object, '尚未接线', '激燃触发与伤害执行', '不因总量公式创建技能命中事件、周期过程或装备伤害效果。');
  omitted(object, 'effect', 'burn_damage', '当前仅有总量公式；触发和跳伤规则未确证。');
  omitted(object, 'parameter', 'tick_frequency', '客户端字段有数值但单位和绑定用途未证实，只保留原始来源证据。');
  pending(object, '激燃合法触发', '待补伤害型技能事件、持续执行及与其他灼烧效果的消费关系。');
  objects.push(object);
}

{
  const item = root(3118);
  const object = base(3118, 'passive', '憎恨之雾', '保留20点终极技能急速、3秒地面持续、10点魔法抗性削减和地面伤害计算值。伤害使用显式未定属性输入，mStat缺失不补法术强度；地面范围字段只作来源依据，不进入单目标数值参数；每秒/每跳节拍、半径动态和终极技能命中规则保持缺口。');
  currentCandidate = object;
  const ratio = value(item, 3118, 'APRatio');
  const baseDamage = value(item, 3118, 'BaseDamage');
  const duration = value(item, 3118, 'GroundDuration');
  const haste = value(item, 3118, 'UltimateHaste');
  const aoeSize = sourceOnlyValue(object, 3118, 'AOESize', '客户端范围字段数值为250，但本轮只保留空间来源依据，不进入单目标正常参数。');
  const maxRadius = sourceOnlyValue(object, 3118, 'MaxRadius', '客户端范围字段数值为550，但本轮只保留空间来源依据，不进入单目标正常参数。');
  calculation(object, 3118, 'GroundBurnDamagePerTickTooltipOnly', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].mDataValue, 'BaseDamage');
    assert.equal(raw.mFormulaParts[1].mDataValue, 'APRatio');
    assert.equal(Object.hasOwn(raw.mFormulaParts[1], 'mStat'), false, 'mStat缺失不得补法强');
  }, { base: baseDamage, coefficient: ratio, statistic: '未提供', label: 'GroundBurnDamagePerTickTooltipOnly' });
  const shred = numberCalculation(item, 'MagicResistanceShred');
  param(object, 'ultimate_haste', '蔑视终极技能急速', haste, '当前绑定UltimateHaste=20；该项是终极技能急速，不与装备已有技能急速合并。');
  param(object, 'ground_duration_ms', '憎恨之雾地面持续时间', duration * 1000, '当前GroundDuration=3秒，换算3000毫秒；仅保存时间，不表示已建立周期执行。');
  param(object, 'ground_base_damage', '憎恨之雾基础伤害', baseDamage, '当前GroundBurnDamagePerTickTooltipOnly第一项BaseDamage=60。');
  param(object, 'ground_damage_scaling_ratio', '憎恨之雾未定属性缩放比例', ratio, '当前APRatio=0.05；计算节点mStat缺失，只保存系数，不命名为法术强度比例。');
  runtime(object, 'ground_damage_scaling_stat_value', '憎恨之雾缩放属性显式输入', '非负小数输入；运行时须先明确mStat对应属性。当前来源没有提供属性编号，不能默认法术强度或缺失为0。');
  param(object, 'magic_resistance_shred', '憎恨之雾魔法抗性削减', shred, '当前MagicResistanceShred计算式为NumberCalculationPart=10。');
  formula(object, 'ground_burn_damage_value', '憎恨之雾地面伤害值', '60 + 0.05 × 显式缩放属性输入；只表达计算值，不指定每秒或每跳节拍。', operation('ADD', parameterNode('ground_base_damage'), operation('MULTIPLY', parameterNode('ground_damage_scaling_ratio'), parameterNode('ground_damage_scaling_stat_value'))));
  bound(object, 3118, 'keyTooltip', /用你的终极技能对一个英雄造成伤害时/);
  bound(object, 3118, 'keyTooltipExtendedRules', /半径会基于造成的伤害值来提升/);
  proof(object, '/Items~13118/mItemCalculations/MagicResistanceShred', shred, item.object.mItemCalculations.MagicResistanceShred);
  note(object, '范围外', '普通攻击触发', '绑定扩展规则明确普攻不能触发憎恨之雾；本候选不创建普通攻击入口。');
  note(object, '来源待核', 'mStat与持续伤害节拍', 'GroundBurnDamagePerTickTooltipOnly的mStat缺失，且当前对象没有可靠周期字段；不补法强、不把每秒文本硬写成周期执行。');
  note(object, '来源待核', '地面范围动态关系', 'AOESize与MaxRadius是客户端字段，绑定规则只说明半径随造成伤害提升，未给出转换公式和单位语义。');
  note(object, '尚未接线', '终极技能命中与地面执行', '终极技能对英雄造成伤害、地面创建、魔抗削减持续和伤害递归均未接线。');
  omitted(object, 'effect', 'ground_burn_and_shred', '触发、周期与动态范围尚未确证，只有参数与显式输入伤害值公式进入候选。');
  omitted(object, 'parameter', 'ground_aoe_size', '纯空间范围字段只保留来源依据，不进入单目标正常参数。');
  omitted(object, 'parameter', 'ground_max_radius', '纯空间范围字段只保留来源依据，不进入单目标正常参数。');
  pending(object, '憎恨之雾事件', '待补终极技能伤害来源、目标英雄筛选、地面持续与周期边界。');
  objects.push(object);
}

{
  const item = root(3152);
  const object = base(3152, 'active', '超音速', '保留主动50秒冷却和魔法弹计算值100+0.1×显式缩放属性输入。当前FireboltDamage的mStat缺失，不把系数命名为法术强度；冲刺、魔法弹命中与无法穿过地形的规则保持未接线。');
  currentCandidate = object;
  const ratio = value(item, 3152, 'APRatio');
  const baseDamage = value(item, 3152, 'BaseDamage');
  const cooldown = value(item, 3152, 'Cooldown');
  calculation(object, 3152, 'FireboltDamage', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].mDataValue, 'BaseDamage');
    assert.equal(raw.mFormulaParts[1].mDataValue, 'APRatio');
    assert.equal(Object.hasOwn(raw.mFormulaParts[1], 'mStat'), false, 'mStat缺失不得补法强');
  }, { base: baseDamage, coefficient: ratio, statistic: '未提供' });
  param(object, 'cooldown_ms', '超音速主动冷却', cooldown * 1000, '当前Cooldown=50秒，换算50000毫秒；主动冷却数值已确定，冷却起点和消费仍待规则接线。');
  param(object, 'firebolt_base_damage', '超音速魔法弹基础伤害', baseDamage, '当前FireboltDamage第一项BaseDamage=100。');
  param(object, 'firebolt_scaling_ratio', '超音速未定属性缩放比例', ratio, '当前APRatio=0.1；计算节点mStat缺失，只保存系数。');
  runtime(object, 'firebolt_scaling_stat_value', '超音速缩放属性显式输入', '非负小数输入；运行时须先明确mStat属性，不能默认法术强度或缺失为0。');
  formula(object, 'firebolt_damage', '超音速魔法弹伤害', '100 + 0.1 × 显式缩放属性输入；不表达魔法弹数量、命中和主动过程。', operation('ADD', parameterNode('firebolt_base_damage'), operation('MULTIPLY', parameterNode('firebolt_scaling_ratio'), parameterNode('firebolt_scaling_stat_value'))));
  bound(object, 3152, 'keyActive', /朝着目标方向冲刺/);
  bound(object, 3152, 'keyTooltipExtendedRules', /无法穿过地形/);
  note(object, '来源待核', 'mStat属性归属', 'FireboltDamage的StatByNamedDataValueCalculationPart没有mStat；候选只接受显式属性输入，不补法强。');
  note(object, '尚未接线', '主动施放与魔法弹命中', '冲刺方向、魔法弹数量、目标命中、法术护盾资格和冷却消费均未接线。');
  omitted(object, 'effect', 'firebolt_damage', '主动命中与护盾资格尚未确证，不能建立无触发伤害效果。');
  pending(object, '超音速主动过程', '待补施放、冲刺空间限制、魔法弹命中和冷却起点。');
  objects.push(object);
}

{
  const item = root(6660);
  const object = base(6660, 'passive', '献祭', '保留客户端文本明确的3秒持续、每跳15和每秒1次的DPS展示公式；325范围只作空间来源依据。客户端Cooldown=12未被当前绑定说明使用，不录为冷却；TicksPerSecond=1只用于展示DPS，不推导总跳数、周期过程或45总伤害。');
  currentCandidate = object;
  const range = sourceOnlyValue(object, 6660, 'Range', '客户端范围字段数值为325，本轮只保留空间来源依据，不进入单目标正常参数。');
  const duration = value(item, 6660, 'AuraDuration');
  const tps = value(item, 6660, 'TicksPerSecond');
  const damagePerTick = numberCalculation(item, 'DamagePerTick');
  const dps = calculation(object, 6660, 'DPS', raw => {
    assert.equal(raw.__type, 'GameCalculationModified');
    assert.equal(raw.mModifiedGameCalculation, 'DamagePerTick');
    assert.equal(raw.mMultiplier?.mDataValue, 'TicksPerSecond');
  }, { damagePerTick, ticksPerSecond: tps, displayDps: damagePerTick * tps });
  param(object, 'aura_duration_ms', '献祭文本持续时间', duration * 1000, '当前AuraDuration=3秒，换算3000毫秒；只保存文本持续时间。');
  param(object, 'damage_per_tick', '献祭每跳伤害', damagePerTick, '当前DamagePerTick为NumberCalculationPart=15。');
  param(object, 'ticks_per_second', '献祭DPS展示频率', tps, '当前TicksPerSecond=1；仅作为DPS展示乘数，不代表运行时已确认周期。');
  formula(object, 'display_dps', '献祭DPS展示值', '15 × 1 = 15；只用于客户端DPS展示，不能据此生成总伤害或冷却。', operation('MULTIPLY', parameterNode('damage_per_tick'), parameterNode('ticks_per_second')));
  bound(object, 6660, 'keyTooltip', /每秒对附近敌人造成/);
  bound(object, 6660, 'keyTooltipExtended', /对小兵造成的伤害提升/);
  proof(object, '/Items~16660/mDataValues/Cooldown', '当前Cooldown=12未被绑定说明引用，未录为冷却', dataRows(item, 'Cooldown'));
  proof(object, '/Items~16660/mItemCalculations/DamagePerTick', damagePerTick, item.object.mItemCalculations.DamagePerTick);
  note(object, '范围外', '小兵与野怪倍率', '扩展说明另有小兵50%和野怪100%提升；本轮保存英雄单目标展示值，不把非英雄倍率接入。');
  note(object, '来源待核', 'Cooldown字段用途', 'Cooldown=12在当前绑定说明中没有引用；按当前对象不能把未绑定字段解释为被动冷却。');
  note(object, '来源待核', '持续伤害节拍', 'TicksPerSecond=1只参与DPS展示计算；首次执行、总跳数、持续边界和承受/造成伤害事件尚未确证。');
  note(object, '尚未接线', '献祭触发与附近目标', '承受或造成伤害的合法事件、范围目标筛选、周期执行和递归排除均未接线。');
  omitted(object, 'parameter', 'cooldown_ms', 'Cooldown=12未由当前keyTooltip或其直接模板引用，不能录为冷却。');
  omitted(object, 'parameter', 'aura_range', '纯空间范围字段只保留来源依据，不进入单目标正常参数。');
  omitted(object, 'effect', 'immolate_damage', '周期和目标筛选未确证，只有每跳与DPS展示参数进入候选。');
  pending(object, '献祭周期', '待补触发事件、首次跳、周期结束、总跳数与装备伤害递归门禁。');
  objects.push(object);
}

{
  const item = root(6655);
  const object = base(6655, 'passive', '回声', '保留12秒冷却、每道回声75+0.05×显式缩放属性输入、6道最大充能、剩余5道各按20%伤害，独立总倍率为1+5×0.2=2。0.2是剩余回声伤害比例，绝不是20%减伤；650弹道范围只作空间来源依据；mStat缺失不补法强。');
  currentCandidate = object;
  const ratio = value(item, 6655, 'APRatio');
  const baseDamage = value(item, 6655, 'BaseDamage');
  const cooldown = value(item, 6655, 'Cooldown');
  const charges = value(item, 6655, 'MaxCharges');
  const repeatRatio = value(item, 6655, 'RepeatDamageReduction');
  const missileRange = sourceOnlyValue(object, 6655, 'MissileRange', '客户端弹道范围字段数值为650，本轮只保留空间来源依据，不进入单目标正常参数。');
  calculation(object, 6655, 'Damage', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].mDataValue, 'BaseDamage');
    assert.equal(raw.mFormulaParts[1].mDataValue, 'APRatio');
    assert.equal(Object.hasOwn(raw.mFormulaParts[1], 'mStat'), false, 'mStat缺失不得补法强');
  }, { base: baseDamage, coefficient: ratio, statistic: '未提供' });
  const maxCalc = calculation(object, 6655, 'SingleTargetMax', raw => {
    assert.equal(raw.__type, 'GameCalculationModified');
    assert.equal(raw.mModifiedGameCalculation, 'Damage');
    assert.equal(raw.mMultiplier?.mNumber, 2);
  }, { multiplier: 2, derivation: '1 + (6 - 1) × 0.2 = 2' });
  param(object, 'cooldown_ms', '回声冷却', cooldown * 1000, '当前Cooldown=12秒，换算12000毫秒；冷却消费和合法技能伤害事件待接线。');
  param(object, 'echo_base_damage', '回声单道基础伤害', baseDamage, '当前Damage第一项BaseDamage=75。');
  param(object, 'echo_scaling_ratio', '回声未定属性缩放比例', ratio, '当前APRatio=0.05；Damage节点mStat缺失，只保存系数。');
  runtime(object, 'echo_scaling_stat_value', '回声缩放属性显式输入', '非负小数输入；运行时须先明确mStat属性，不能默认法术强度或缺失为0。');
  param(object, 'max_echo_charges', '回声最大道数', charges, '当前MaxCharges=6；首道与剩余道数分别核算。');
  param(object, 'remaining_echo_count', '回声剩余道数', charges - 1, '由当前MaxCharges=6明确得到剩余5道；不把首道重复计入。');
  param(object, 'repeat_echo_damage_ratio', '剩余回声单道伤害比例', repeatRatio, '当前RepeatDamageReduction=0.2；绑定文本称剩余回声造成20%伤害，不是减伤参数。');
  param(object, 'single_target_multiplier', '单目标最大回声总倍率', maxCalc.mMultiplier.mNumber, '当前SingleTargetMax直接以2倍引用Damage；独立推导为1+5×0.2=2。');
  formula(object, 'echo_damage', '单道回声伤害', '75 + 0.05 × 显式缩放属性输入；只保存计算值。', operation('ADD', parameterNode('echo_base_damage'), operation('MULTIPLY', parameterNode('echo_scaling_ratio'), parameterNode('echo_scaling_stat_value'))));
  formula(object, 'remaining_echo_total_ratio', '剩余回声总伤害比例', '5 × 0.2 = 1；该结果加上首道1份后得到总倍率2。', operation('MULTIPLY', parameterNode('remaining_echo_count'), parameterNode('repeat_echo_damage_ratio')));
  formula(object, 'single_target_max_damage', '单目标最大回声伤害', '单道伤害 × 2；2由首道1份加剩余5道各20%独立得到。', operation('MULTIPLY', operation('ADD', parameterNode('echo_base_damage'), operation('MULTIPLY', parameterNode('echo_scaling_ratio'), parameterNode('echo_scaling_stat_value'))), parameterNode('single_target_multiplier')));
  bound(object, 6655, 'keyTooltip', /剩余回声会对主要目标发射/);
  bound(object, 6655, 'keyTooltip', /@RepeatDamageReduction\*100@%伤害/);
  proof(object, '/Items~16655/mDataValues/MaxCharges+RepeatDamageReduction', { maxCharges: charges, remaining: charges - 1, ratio: repeatRatio, totalMultiplier: 2 }, [dataRows(item, 'MaxCharges'), dataRows(item, 'RepeatDamageReduction')]);
  note(object, '来源待核', 'mStat属性归属', 'Damage的StatByNamedDataValueCalculationPart没有mStat；回声候选使用显式输入，不补法强。');
  note(object, '来源待核', '目标与充能消费', '6道回声的首道命中、附近目标分发、剩余道数消费和每道目标选择尚未由当前接口规则确证。');
  note(object, '尚未接线', '技能伤害触发与冷却', '伤害型技能资格、12秒冷却、同次处理、法术护盾资格和装备伤害递归均未接线。');
  omitted(object, 'effect', 'echo_damage', '触发、道数消费与多目标分发未确证，只有单道和单目标总倍率公式进入候选。');
  omitted(object, 'parameter', 'missile_range', '纯空间弹道字段只保留来源依据，不进入单目标正常参数。');
  pending(object, '回声事件与分发', '待补技能命中事件、弹道目标选择、剩余5道消费、冷却和递归门禁。');
  objects.push(object);
}

{
  const item = root(3094);
  const object = base(3094, 'passive', '神射手', '保留盈能攻击额外40魔法伤害；35%额外攻击距离和150码额外距离上限只作空间来源依据。盈能生成、攻击命中和攻击距离计算未接线，不把固定距离上限写成无条件属性效果。');
  currentCandidate = object;
  const rangeRatio = sourceOnlyValue(object, 3094, 'RangePercentIncrease', '客户端额外攻击距离比例数值为0.35，本轮只保留空间来源依据，不进入单目标正常参数。');
  const maxRange = sourceOnlyValue(object, 3094, 'MaxRangeIncrease', '客户端额外攻击距离上限数值为150，本轮只保留空间来源依据，不进入单目标正常参数。');
  const damage = value(item, 3094, 'BonusDamage');
  param(object, 'energized_magic_damage', '神射手额外魔法伤害', damage, '当前BonusDamage=40；绑定说明明确作用于盈能攻击。');
  bound(object, 3094, 'keyTooltip', /盈能攻击/);
  bound(object, 3094, 'keyTooltipExtended', /不能多于@MaxRangeIncrease@码/);
  note(object, '来源待核', '攻击距离计算基数', '当前资料给出比例和150码上限，但未给出基础距离取值、取整和最终裁决顺序，未创建范围公式。');
  note(object, '尚未接线', '盈能攻击与额外伤害', '移动/攻击生成盈能、充能消费、攻击命中和额外魔法伤害触发均未接线。');
  omitted(object, 'effect', 'energized_attack_damage', '盈能攻击合法事件和攻击特效资格未确证。');
  omitted(object, 'parameter', 'energized_attack_range_ratio', '纯空间攻击距离字段只保留来源依据，不进入单目标正常参数。');
  omitted(object, 'parameter', 'energized_attack_range_cap', '纯空间攻击距离字段只保留来源依据，不进入单目标正常参数。');
  pending(object, '神射手攻击事件', '待补盈能生成、消费、攻击距离上限与额外魔法伤害结果。');
  objects.push(object);
}

{
  const item = root(3095);
  const object = base(3095, 'passive', '弩箭', '按当前根真实绑定的Item_3095_Tooltip_Kiwi保存盈能攻击100额外魔法伤害、45%移动速度和1.5秒持续。客户端根名称、普通装备身份和属性均与岚切一致，不因绑定键含Kiwi排除；官方模板中的0不覆盖客户端根计算100。');
  currentCandidate = object;
  const speed = value(item, 3095, 'BuffStrength');
  const duration = value(item, 3095, 'BuffDuration');
  const damage = numberCalculation(item, 'TotalProcDamage');
  const tooltip = bound(object, 3095, 'keyTooltip', /盈能攻击/);
  assert.equal(tooltip.key, 'item_3095_tooltip_kiwi', '岚切必须保留当前根真实绑定');
  const current = before.objects.find(entry => entry.equipmentKey === 'item_3095');
  assert.equal(current.records.find(entry => entry.route === '/equipment/item_3095').data.name, '岚切');
  assert.equal(current.records.find(entry => entry.route === '/equipment/item_3095/attributes').data.attributeValues.attack_damage, 50);
  param(object, 'energized_magic_damage', '弩箭额外魔法伤害', damage, '当前TotalProcDamage为NumberCalculationPart=100；绑定根文本明确额外魔法伤害。');
  param(object, 'move_speed_ratio', '弩箭移动速度比例', speed, '当前BuffStrength=0.45，绑定文本明确为45%移动速度。');
  param(object, 'move_speed_duration_ms', '弩箭移动速度持续时间', duration * 1000, '当前BuffDuration=1.5秒，换算1500毫秒。');
  const energizedDefinition = source.boundDefinitions.Item_KeywordDefinition_Energized;
  assert.equal(energizedDefinition?.text, '<keyword>盈能</keyword>：移动和攻击将生成一次<keyword>盈能攻击</keyword>。');
  bound(object, 3095, 'keyKeywordDefinitions', /Item_KeywordDefinition_Energized/);
  proof(object, '/boundDefinitions/Item_KeywordDefinition_Energized', energizedDefinition.text, energizedDefinition);
  proof(object, '/Items~13095/identity', { boundTooltipKey: tooltip.key, sourceName: object.equipmentName, currentEquipmentName: '岚切', currentAttackDamage: 50, officialTemplateDamage: 0, clientRootDamage: damage }, { tooltip, currentEquipment: current.records.find(entry => entry.route === '/equipment/item_3095').data, currentAttributes: current.records.find(entry => entry.route === '/equipment/item_3095/attributes').data, officialDescription: item.official.description });
  proof(object, '/Items~13095/mItemCalculations/TotalProcDamage', damage, item.object.mItemCalculations.TotalProcDamage);
  note(object, '来源待核', '官方模板值与客户端根值', '官方16.17.1展开说明显示0额外魔法伤害，当前客户端根的TotalProcDamage明确为100且真实绑定文本为Item_3095_Tooltip_Kiwi；本候选保留两份证据，按当前根保存100，不以模板0覆盖。');
  note(object, '尚未接线', '盈能攻击触发与移动速度效果', '盈能生成、攻击消费、目标命中、额外魔法伤害和移动速度授予均未接线。');
  omitted(object, 'effect', 'energized_attack_and_move_speed', '当前绑定明确数值但合法攻击事件和效果时序未确证。');
  pending(object, '弩箭与盈能', '待补盈能生成/消费、伤害与移速结果的同次处理和刷新。');
  objects.push(object);
}

{
  const item = root(3087);
  const object = base(3087, 'passive', '电火花与电疗', '保留盈能攻击对英雄60和普通攻击额外9层盈能；500范围、非英雄90和最多目标数只作空间、多目标或非英雄来源依据。次级弹射目标才接受附带攻击特效，不能把它套到主目标；BounceDelay缺值保持缺口，不填0。');
  currentCandidate = object;
  const range = sourceOnlyValue(object, 3087, 'BounceRange', '客户端弹射范围字段数值为500，本轮只保留空间来源依据，不进入单目标正常参数。');
  const bonusStacks = value(item, 3087, 'BonusEnergizedStacks');
  const championDamage = value(item, 3087, 'ChainDamage');
  const nonChampionDamage = sourceOnlyValue(object, 3087, 'NonChampChainDamage', '客户端非英雄连锁伤害数值为90，本轮只保留非英雄来源依据，不进入英雄单目标正常参数。');
  const missingDelay = dataRows(item, 'BounceDelay');
  assert.equal(missingDelay.length, 1);
  assert.equal(Object.hasOwn(missingDelay[0], 'mValue'), false);
  const bounceCount = item.object.mItemCalculations.BounceCount;
  assert.equal(bounceCount.__type, 'GameCalculation');
  const part = bounceCount.mFormulaParts[0];
  assert.equal(part.__type, 'ByCharLevelBreakpointsCalculationPart');
  assert.equal(part.mLevel1Value, 4);
  assert.deepEqual(part.mBreakpoints.map(row => [row.mLevel, row.mAdditionalBonusAtThisLevel]), [[6, 1], [10, 1], [14, 1], [20, 1]]);
  param(object, 'bonus_energized_stacks', '电疗额外盈能层数', bonusStacks, '当前BonusEnergizedStacks=9；普通攻击事件尚未接线。');
  param(object, 'champion_chain_damage', '电火花对英雄连锁伤害', championDamage, '当前ChainDamage=60；本候选不把次级弹射攻击特效套到主目标。');
  bound(object, 3087, 'keyTooltip', /附带.*攻击特效.*次级弹射目标/);
  bound(object, 3087, 'keyTooltip', /最多.*个目标/);
  proof(object, '/Items~13087/mItemCalculations/BounceCount', { level1: 4, breakpoints: [[6, 1], [10, 1], [14, 1], [20, 1]], usage: '仅多目标来源依据' }, bounceCount);
  proof(object, '/Items~13087/mDataValues/BounceDelay', '缺失，不等于0', missingDelay);
  note(object, '来源待核', '弹射范围', 'BounceRange=500是空间字段，本轮只保留来源依据，不进入单目标正常参数。');
  note(object, '范围外', '非英雄连锁伤害', 'NonChampChainDamage=90只属于非英雄支路，本轮不进入英雄单目标正常参数。');
  note(object, '范围外', '多目标数量', 'BounceCount的等级断点只属于多目标分发；本轮保留原始计算节点和断点，不生成角色等级参数。');
  note(object, '系统缺口', '主目标攻击特效', '绑定文本明确攻击特效只到次级弹射目标；当前能力不适用于主目标，不能把它写成主目标效果，也不把链条伤害重复算入主目标。');
  note(object, '来源待核', 'BounceDelay', '当前数据值没有mValue；不能把缺失延迟写成0毫秒。');
  note(object, '尚未接线', '盈能连锁与目标分发', '盈能生成、普通攻击额外层数、主次目标选择、连锁顺序和攻击特效消费均未接线。');
  omitted(object, 'parameter', 'bounce_delay_ms', '源字段缺少数值，保留缺失证据，不填0。');
  omitted(object, 'parameter', 'bounce_range', '纯空间范围字段只保留来源依据，不进入单目标正常参数。');
  omitted(object, 'parameter', 'non_champion_chain_damage', '非英雄支路数值只保留来源依据，不进入英雄单目标正常参数。');
  omitted(object, 'parameter', 'bounce_count_by_character_level', '多目标数量只保留原始断点来源，不从缺少的初始斜率树猜角色等级表。');
  omitted(object, 'effect', 'chain_damage', '多目标与次级攻击特效资格尚未确证，只有静态参数进入候选。');
  pending(object, '电火花连锁', '待补主次目标分发、延迟、盈能消费和次级攻击特效边界。');
  objects.push(object);
}

{
  const item = root(3147);
  const object = base(3147, 'passive', '癫狂', '保留与敌方英雄作战时每完整1秒增加2%额外伤害、上限6%以及3个完整间隔达到上限的明确数值。使用无默认值的已完成间隔整数输入和MIN公式；未完成间隔不加成，BuffCounterDuration=3不解释为脱战衰减、刷新或冷却。');
  currentCandidate = object;
  const perSecond = value(item, 3147, 'DamageIncreasePerSecond');
  const maximum = value(item, 3147, 'DamageIncreaseMax');
  const combatSeconds = value(item, 3147, 'SecondsInCombat');
  const counterDuration = value(item, 3147, 'BuffCounterDuration');
  param(object, 'damage_increase_per_second_ratio', '癫狂每秒额外伤害比例', perSecond, '当前DamageIncreasePerSecond=0.02，即每秒2%比例。');
  param(object, 'damage_increase_max_ratio', '癫狂额外伤害上限比例', maximum, '当前DamageIncreaseMax=0.06，即上限6%比例。');
  param(object, 'combat_seconds_to_cap', '癫狂达到上限所需完整战斗间隔数', combatSeconds, '当前SecondsInCombat=3；表示每完整1秒间隔增加2%且3个完整间隔达到6%，不解释脱战计时。');
  param(object, 'completed_combat_intervals', '癫狂已完成战斗间隔输入', null, '无默认值的非负整数输入；每完成一个完整1秒间隔才增加2%，未完成间隔不加成，必须由已核实的与敌方英雄作战计时提供。', { valueMode: 'RUNTIME_INPUT', valueType: 'INTEGER' });
  formula(object, 'damage_increase_ratio', '癫狂当前额外伤害比例', 'MIN(已完成完整战斗间隔数×0.02，0.06)；未完成间隔不加成，不建立战斗事件或脱战衰减。', operation('MIN', operation('MULTIPLY', parameterNode('completed_combat_intervals'), parameterNode('damage_increase_per_second_ratio')), parameterNode('damage_increase_max_ratio')));
  bound(object, 3147, 'keyTooltip', /每过1秒/);
  proof(object, '/Items~13147/mDataValues/BuffCounterDuration', '3但用途未确证，未解释为脱战衰减', dataRows(item, 'BuffCounterDuration'));
  note(object, '来源待核', 'BuffCounterDuration用途', 'BuffCounterDuration=3没有说明起算、刷新、脱战保留或消退方式；不能推成脱战3秒衰减。');
  note(object, '来源待核', '额外伤害计算区', '当前文字证明每秒比例和6%上限，但未给出额外伤害施加阶段、减伤前后区间和同类效果组合。');
  note(object, '尚未接线', '英雄战斗计时与刷新', '对敌方英雄作战事件、每秒增长、达到上限、脱战处理和额外伤害结果均未接线。');
  omitted(object, 'effect', 'damage_increase', '伤害区和战斗事件尚未确证，只有显式输入比例公式进入候选。');
  pending(object, '癫狂计时', '待补合法战斗事件、每秒计时、脱战和重新进入战斗的状态处理。');
  objects.push(object);
}

{
  const item = root(6699);
  const object = base(6699, 'passive', '苍穹', '按客户端StringCalculations明确的动态拆分保存：近战目标当前生命值9%、远程7%的额外物理伤害；近战额外穿甲15、远程12，持续4秒。公式读取目标当前生命值，动态映射不凭字段名猜测；基础10穿甲属于原装备直接属性，不重复施加。');
  currentCandidate = object;
  const meleeHp = value(item, 6699, 'PercentCurrentHPMelee') / 100;
  const rangedHp = value(item, 6699, 'PercentCurrentHPRanged') / 100;
  const meleeLethality = value(item, 6699, 'LethalityBonusModMelee');
  const rangedLethality = value(item, 6699, 'LethalityBonusModRanged');
  const duration = value(item, 6699, 'LethalityBonusDuration');
  const split = item.object.StringCalculations;
  assert.deepEqual(split.PercentHPMeleeRangedSplit, {
    MeleeResult: '@PercentCurrentHPMelee@',
    RangedResult: '@PercentCurrentHPRanged@',
    DefaultResult: '@PercentCurrentHPMelee@',
    __type: '{4750ceb6}'
  });
  assert.deepEqual(split.LethalityBonusModMeleeRangedSplit, {
    MeleeResult: '@LethalityBonusModMelee@',
    RangedResult: '@LethalityBonusModRanged@',
    DefaultResult: '@LethalityBonusModMelee@',
    __type: '{4750ceb6}'
  });
  param(object, 'melee_current_hp_damage_ratio', '近战盈能当前生命值伤害比例', meleeHp, 'StringCalculations的MeleeResult明确绑定PercentCurrentHPMelee=9，换算为0.09；基数为目标当前生命值。');
  param(object, 'ranged_current_hp_damage_ratio', '远程盈能当前生命值伤害比例', rangedHp, 'StringCalculations的RangedResult明确绑定PercentCurrentHPRanged=7，换算为0.07；基数为目标当前生命值。');
  param(object, 'melee_bonus_lethality', '近战额外穿甲', meleeLethality, 'StringCalculations的MeleeResult明确绑定LethalityBonusModMelee=15。');
  param(object, 'ranged_bonus_lethality', '远程额外穿甲', rangedLethality, 'StringCalculations的RangedResult明确绑定LethalityBonusModRanged=12。');
  param(object, 'bonus_lethality_duration_ms', '额外穿甲持续时间', duration * 1000, '当前LethalityBonusDuration=4秒，换算4000毫秒。');
  formula(object, 'melee_current_hp_damage', '近战当前生命值额外伤害', '目标当前生命值 × 0.09；仅表达动态数值，不建立盈能攻击触发。', operation('MULTIPLY', attributeNode('TARGET', 'hp', 'CURRENT'), parameterNode('melee_current_hp_damage_ratio')));
  formula(object, 'ranged_current_hp_damage', '远程当前生命值额外伤害', '目标当前生命值 × 0.07；仅表达动态数值，不建立盈能攻击触发。', operation('MULTIPLY', attributeNode('TARGET', 'hp', 'CURRENT'), parameterNode('ranged_current_hp_damage_ratio')));
  bound(object, 6699, 'keyTooltip', /目标当前生命值/);
  proof(object, '/Items~16699/StringCalculations/PercentHPMeleeRangedSplit', { melee: '@PercentCurrentHPMelee@', ranged: '@PercentCurrentHPRanged@', default: '@PercentCurrentHPMelee@' }, split.PercentHPMeleeRangedSplit);
  proof(object, '/Items~16699/StringCalculations/LethalityBonusModMeleeRangedSplit', { melee: '@LethalityBonusModMelee@', ranged: '@LethalityBonusModRanged@', default: '@LethalityBonusModMelee@' }, split.LethalityBonusModMeleeRangedSplit);
  proof(object, '/Items~16699/mDataValues/Melee+Ranged', { meleeHpRatio: meleeHp, rangedHpRatio: rangedHp, meleeLethality, rangedLethality, durationSeconds: duration }, [dataRows(item, 'PercentCurrentHPMelee'), dataRows(item, 'PercentCurrentHPRanged'), dataRows(item, 'LethalityBonusModMelee'), dataRows(item, 'LethalityBonusModRanged'), dataRows(item, 'LethalityBonusDuration')]);
  note(object, '范围外', '非英雄封顶值', '扩展文本另有非英雄伤害封顶200；本轮按英雄单目标保存，不创建非英雄封顶规则。');
  note(object, '来源待核', '动态拆分默认分支', 'StringCalculations已明确近战、远程及默认绑定；默认分支仍需运行时攻击类型提供，不能仅凭参数名选择分支。');
  note(object, '尚未接线', '盈能攻击与穿甲状态', '技能伤害触发盈能、攻击消费、当前生命值读取时点、额外穿甲4秒状态和物理伤害结果均未接线。');
  omitted(object, 'effect', 'sky_damage_and_lethality', '攻击触发、目标当前生命值读取时点与穿甲状态尚未确证，只有动态公式进入候选。');
  pending(object, '苍穹动态状态', '待补近远程选择、盈能生成/消费、当前生命值取值时点和4秒穿甲刷新。');
  objects.push(object);
}

{
  const item = root(4646);
  const object = base(4646, 'passive', '风暴掠袭与风啸', '保留2.5秒伤害窗口、25%最大生命值阈值、2秒延迟、30秒冷却和当前根文本绑定的SquallDamage风啸伤害。缩放属性显式输入，mStat缺失不补法术强度；RangedProcDamageMod与RangedItemCalcValue虽有来源字段但未沿当前根文本绑定，不进入额外远程分支；GoldReward、ProcMoveSpeedAmount缺值不补0。');
  currentCandidate = object;
  const window = value(item, 4646, 'WindowDuration');
  const cooldown = value(item, 4646, 'Cooldown');
  const delay = value(item, 4646, 'DelayDuration');
  const ratio = value(item, 4646, 'APRatio');
  const threshold = value(item, 4646, 'DamageThreshold');
  sourceOnlyValue(object, 4646, 'RangedProcDamageMod', '客户端字段数值为1，但当前根文本没有绑定该字段，不进入正常参数或远程分支。');
  const baseDamage = value(item, 4646, 'BaseDamage');
  const missingGold = dataRows(item, 'GoldReward');
  const missingMove = dataRows(item, 'ProcMoveSpeedAmount');
  assert.equal(missingGold.length, 1);
  assert.equal(missingMove.length, 1);
  assert.equal(Object.hasOwn(missingGold[0], 'mValue'), false);
  assert.equal(Object.hasOwn(missingMove[0], 'mValue'), false);
  calculation(object, 4646, 'SquallDamage', raw => {
    assert.equal(raw.__type, 'GameCalculation');
    assert.equal(raw.mFormulaParts?.length, 2);
    assert.equal(raw.mFormulaParts[0].mDataValue, 'BaseDamage');
    assert.equal(raw.mFormulaParts[1].mDataValue, 'APRatio');
    assert.equal(Object.hasOwn(raw.mFormulaParts[1], 'mStat'), false, 'mStat缺失不得补法强');
  }, { base: baseDamage, coefficient: ratio, statistic: '未提供', boundBy: 'keyTooltip中的SquallDamage' });
  const meleeCalc = item.object.mItemCalculations.MeleeItemCalcValue;
  assert.ok(meleeCalc, 'MeleeItemCalcValue缺少来源计算式');
  proof(object, '/Items~14646/mItemCalculations/MeleeItemCalcValue', '存在但当前根文本未直接绑定，不进入正常候选', meleeCalc);
  const rangedCalc = item.object.mItemCalculations.RangedItemCalcValue;
  assert.ok(rangedCalc, 'RangedItemCalcValue缺少来源计算式');
  proof(object, '/Items~14646/mItemCalculations/RangedItemCalcValue', '存在但当前根文本未绑定，不进入正常候选', rangedCalc);
  param(object, 'damage_window_ms', '风暴掠袭伤害窗口', window * 1000, '当前WindowDuration=2.5秒，换算2500毫秒。');
  param(object, 'damage_threshold_ratio', '风暴掠袭最大生命值阈值比例', threshold, '当前DamageThreshold=0.25，绑定文本明确为25%最大生命值。');
  param(object, 'squall_delay_ms', '风啸延迟', delay * 1000, '当前DelayDuration=2秒，换算2000毫秒。');
  param(object, 'cooldown_ms', '风暴掠袭冷却', cooldown * 1000, '当前Cooldown=30秒，换算30000毫秒；触发消费仍待接线。');
  param(object, 'squall_base_damage', '风啸基础伤害', baseDamage, '当前MeleeItemCalcValue和SquallDamage第一项BaseDamage=125。');
  param(object, 'squall_scaling_ratio', '风啸未定属性缩放比例', ratio, '当前APRatio=0.1；计算节点mStat缺失，只保存系数。');
  runtime(object, 'squall_scaling_stat_value', '风啸缩放属性显式输入', '非负小数输入；运行时须先明确mStat属性，不能默认法术强度或缺失为0。');
  formula(object, 'squall_damage', '风啸伤害', '当前根文本绑定的SquallDamage：125 + 0.1 × 显式缩放属性输入；仅保存延迟后的数值计算。', operation('ADD', parameterNode('squall_base_damage'), operation('MULTIPLY', parameterNode('squall_scaling_ratio'), parameterNode('squall_scaling_stat_value'))));
  const tooltip = bound(object, 4646, 'keyTooltip', /在@WindowDuration@秒内/);
  assert.match(tooltip.text, /@SquallDamage@/, '风啸公式必须沿当前根文本绑定');
  bound(object, 4646, 'keyTooltip', /在@DelayDuration@秒后/);
  proof(object, '/Items~14646/mDataValues/GoldReward+ProcMoveSpeedAmount', '两字段缺失，当前根无金币/移速绑定，不补0', [missingGold, missingMove]);
  note(object, '范围外', '金币与移动速度奖励', '当前根绑定文本只有伤害阈值和2秒后SquallDamage风啸伤害；没有金币或移速绑定，缺值不补0，也不从未绑定字段创建结果。');
  note(object, '来源待核', 'mStat属性归属与远程分支', '当前根文本绑定的SquallDamage缩放部分没有mStat；候选使用显式输入，不补法强。RangedProcDamageMod与RangedItemCalcValue没有沿当前根文本绑定，已保留来源证据但不进入候选。');
  note(object, '尚未接线', '阈值、延迟与冷却触发', '2.5秒窗口内累计伤害、英雄最大生命值阈值、风啸施加、目标提前阵亡的附近伤害、30秒冷却和法术护盾资格均未接线。');
  omitted(object, 'parameter', 'gold_reward/proc_move_speed_amount', '来源字段缺少mValue且当前根文本未绑定，不填0。');
  omitted(object, 'parameter', 'ranged_squall_damage_multiplier', 'RangedProcDamageMod=1和RangedItemCalcValue未沿当前根文本绑定，不进入额外远程分支。');
  omitted(object, 'effect', 'squall_damage', '触发阈值、延迟与目标死亡分支尚未确证，只有当前根文本绑定的SquallDamage数值公式进入候选。');
  pending(object, '风暴掠袭事件', '待补累计伤害窗口、最大生命值阈值、延迟、目标死亡分发和冷却消费。');
  objects.push(object);
}

assert.equal(objects.length, selectedIds.length, '候选技能数量必须等于12');
const payload = await output(objects);
assert.equal(payload.totals.equipment, 12);
assert.equal(payload.totals.skills, 12);
console.log(JSON.stringify({
  file: '完整候选.json',
  totals: payload.totals,
  skills: objects.map(object => ({ equipmentKey: object.equipmentKey, skillKey: object.skillKey, parameters: object.apiPayload.parameters.length, formulas: object.apiPayload.formulas.length })),
  currentEvidenceAt: before.at,
  sourceEvidenceAt: source.generatedAt
}));
