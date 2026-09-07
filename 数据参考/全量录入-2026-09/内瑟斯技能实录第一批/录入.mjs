import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, '../技能公共参数实录');
const index = JSON.parse(fs.readFileSync(path.join(sourceDir, '技能来源索引.json')));
const source = index.heroes.find(h => h.championId === 'Nasus');
const bytes = gunzipSync(fs.readFileSync(path.join(sourceDir, source.client.path)));
const sha = b => createHash('sha256').update(b).digest('hex');
assert.equal(sha(bytes), source.client.sha256);
const officialBytes = fs.readFileSync(path.join(sourceDir, source.official.path));
assert.equal(sha(officialBytes), source.official.sha256);
const raw = JSON.parse(bytes);
const clean = n => Math.round(n * 1e6) / 1e6;
const spell = slot => raw[source.skills.find(s => s.slot === slot).clientPath].mSpell;
const proof = [];
function values(slot, name, count, expected, scale = 1) {
  const s = spell(slot);
  const n = s.DataValues.findIndex(v => v.name === name);
  assert.ok(n >= 0, slot + name);
  const original = s.DataValues[n].values;
  const picked = original.slice(1, count + 1).map(v => clean(v * scale));
  assert.deepEqual(picked, expected, slot + name);
  proof.push({ slot, path: source.skills.find(s => s.slot === slot).clientPath,
    pointer: `mSpell/DataValues/${n}/values`, name, original, offset: 1, scale, picked });
  return picked;
}
const rankMap = a => Object.fromEntries(a.map((v, i) => [i + 1, v]));
function parameter(parameterKey, name, val, description, mode) {
  const array = Array.isArray(val);
  const fixed = array && val.every(v => v === val[0]) && mode !== 'CHARACTER_LEVEL';
  return { parameterKey, name, valueType: (array ? val : [val]).every(Number.isInteger) ? 'INTEGER' : 'DECIMAL',
    valueMode: mode ?? (array && !fixed ? 'SKILL_LEVEL' : 'FIXED'),
    fixedValue: fixed ? val[0] : array || mode === 'RUNTIME_INPUT' ? null : val,
    levelValues: array && !fixed ? rankMap(val) : null, description, sortOrder: 10 };
}
const p = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
const a = (owner, key) => ({ nodeType: 'ATTRIBUTE', attributeOwner: owner, attributeKey: key, attributeValueKind: 'TOTAL' });
const op = (operation, left, right) => ({ nodeType: 'OPERATION', operation, operands: [left, right] });
const pv = parameterKey => ({ kind: 'PARAMETER', parameterKey });
const fv = formulaKey => ({ kind: 'FORMULA', formulaKey });
const fixed = value => ({ kind: 'FIXED', value });
const formula = (formulaKey, name, expression, description) => ({ formulaKey, name, expression, description, sortOrder: 10 });
const valueRule = value => ({ value, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null });
const lifecycle = duration => ({ durationValue: duration, maxStacksValue: fixed(1), applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: duration ? 'REFRESH_ALL' : null,
  expiryMode: duration ? 'ALL_AT_ONCE' : 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null });
const persistent = dynamic => ({ moment: 'PERSISTENT', valueReadMode: dynamic ? 'MOMENT_EVALUATION' : 'APPLICATION_SNAPSHOT',
  stackValueMode: 'SHARED', reapplicationValueMode: dynamic ? null : 'REPLACE', periodicExecutionMode: null });
const result = (resultKey, name, resultType, target, value, detail, behavior = null) => ({ resultKey, name, resultType, target,
  description: null, sortOrder: 10, lifecycleBehavior: behavior, spellShieldBlockScope: null, valueRule: valueRule(value), detail });
const effect = (effectKey, name, life, results, description) => ({ effectKey, name, lifecycle: life, results, description, sortOrder: 10 });
const attr = (key, name, attributeKey, parameterKey, dynamic = false) => result(key, name, 'ATTRIBUTE_CHANGE', 'SOURCE', pv(parameterKey),
  { attributeKey, operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' }, persistent(dynamic));
const batch = ['P', 'Q', 'W', 'E', 'R'].map(slot => ({ slot, skillKey: 'nasus_' + slot.toLowerCase(),
  maxLevel: slot === 'P' ? 1 : slot === 'R' ? 3 : 5, parameters: [], formulas: [], effects: [], processes: [], gaps: [] }));
const [P, Q, W, E, R] = batch;

const curve = spell('P').mSpellCalculations.LifestealTooltip.mFormulaParts[0];
assert.equal(curve.mLevel1Value, 10);
assert.deepEqual(curve.mBreakpoints.map(x => [x.mLevel, x.mAdditionalBonusAtThisLevel]), [[7, 5], [13, 5]]);
const lifesteal = Array.from({ length: 18 }, (_, i) => (curve.mLevel1Value + curve.mBreakpoints.filter(b => i + 1 >= b.mLevel).reduce((sum, b) => sum + b.mAdditionalBonusAtThisLevel, 0)) / 100);
P.parameters.push(parameter('life_steal_ratio', '生命偷取增加比例', lifesteal, '客户端 LifestealTooltip：1～6级10%，7～12级15%，13～18级20%；增加百分点。', 'CHARACTER_LEVEL'));
P.effects.push(effect('soul_eater_lifesteal', '吞噬灵魂生命偷取', lifecycle(null),
  [attr('lifesteal', '增加生命偷取百分点', 'life_steal_percent', 'life_steal_ratio', true)],
  '无限期自身属性效果，按当前角色等级读取。没有初始化事件挂接，不表示已自动生效；并非直接治疗。'));
P.gaps.push('现有管理结构缺少来源初始化完成事件；随等级读取已经可表达，不必新增等级变化事件。');

Q.parameters.push(parameter('base_bonus_damage', 'Q 基础额外伤害', values('Q', 'BonusDamage', 5, [40, 60, 80, 100, 120]), '角色根引用 NasusQ，不采用残留 SiphoningStrike 对象。'),
  parameter('buff_duration_ms', '强化攻击窗口（毫秒）', values('Q', 'BuffDuration', 5, [10000, 10000, 10000, 10000, 10000], 1000), 'BuffDuration 秒转毫秒。'),
  parameter('champion_kill_stack_gain', 'Q 击杀英雄增加的伤害点数', values('Q', 'BigStacks', 5, [10, 10, 10, 10, 10]), '累计的是伤害点数，不是击杀次数；仅保留一对一相关来源。'),
  { ...parameter('q_stack_damage', '累计汲魂额外伤害点数', null, '原计算 NasusQStacks 计数；由录入或计算输入提供，永久增长与击杀归属尚未接线。', 'RUNTIME_INPUT'), valueType: 'INTEGER' });
Q.formulas.push(formula('bonus_damage', 'Q 普通命中额外伤害', op('ADD', p('base_bonus_damage'), p('q_stack_damage')),
  '只计算普通命中的额外部分，不重复叠加基础普攻攻击力。原完整树另含总攻击力；暴击分支只放大攻击力与基础额外伤害，累计伤害不一起放大。'));
Q.gaps.push('强化一次普攻的步骤已有结构；需要确认消费时点。', '基础额外伤害沿用同次普攻暴击判定的关系当前缺失；累计伤害不暴击。未将整个额外部分统一标为可暴击或不可暴击。', '永久计数和击杀归属待接线；小兵、野怪计数增长分支按本轮范围跳过。');

W.parameters.push(parameter('slow_start_ratio', '初始减速比例', values('W', 'SlowBase', 5, [.35, .35, .35, .35, .35], .01), '起始减速35%，不是移速减少0.35点。'),
  parameter('slow_max_ratio', '结束前最大减速比例', values('W', 'MaxSlowTooltipOnly', 5, [.47, .59, .71, .83, .95], .01), '渐进减速终点；更新时间未补证。'),
  parameter('attack_speed_slow_multiplier', '攻速降低与减速的比例', values('W', 'AttackSpeedSlowMult', 5, [.75, .75, .75, .75, .75]), '官方说明：降低攻击速度的比例为当前减速比例的75%。'),
  parameter('duration_ms', '枯萎持续时间（毫秒）', values('W', 'Duration', 5, [5000, 5000, 5000, 5000, 5000], 1000), '持续5秒，不能据此推断每次更新时间。'));
W.formulas.push(formula('initial_attack_speed_slow_ratio', '初始攻击速度降低比例', op('MULTIPLY', p('slow_start_ratio'), p('attack_speed_slow_multiplier')), '初始26.25%；仅端点数值，未建立完整减速控制。'),
  formula('max_attack_speed_slow_ratio', '结束前攻击速度降低比例', op('MULTIPLY', p('slow_max_ratio'), p('attack_speed_slow_multiplier')), '结束前35.25/44.25/53.25/62.25/71.25%；未将端点当全程值。'));
W.gaps.push('SlowPerTick 本地缺少执行间隔和首次更新时间；不推成连续线性或每秒刷新。', '控制类别、强度与生命周期的结构化绑定缺口另统一修正，不代用眩晕或普通负移速。');

assert.equal(clean(spell('E').mSpellCalculations.InitialDamage.mFormulaParts[1].mCoefficient), .6);
assert.equal(clean(spell('E').mSpellCalculations.TotalDotDamage.mFormulaParts[1].mCoefficient), .12);
E.parameters.push(parameter('initial_base_damage', '初始魔法伤害基础值', values('E', 'InitialHitDamage', 5, [50, 80, 110, 140, 170]), 'InitialHitDamage 当前主对象。'),
  parameter('initial_ap_ratio', '初始伤害法强比例', .6, 'InitialDamage 计算式 Stat 法术强度系数。'),
  parameter('damage_per_second_base', '每秒魔法伤害基础值', values('E', 'DamagePerTick', 5, [10, 16, 22, 28, 34]), '官方升级提示明确为每秒伤害；名称含Tick不证明周期频率。'),
  parameter('damage_per_second_ap_ratio', '每秒伤害法强比例', .12, 'TotalDotDamage 计算式对应每秒部分系数；全程总量还需乘5。'),
  parameter('duration_ms', '灵魂烈焰持续时间（毫秒）', values('E', 'Duration', 5, [5000, 5000, 5000, 5000, 5000], 1000), '场地持续5秒，停留不足不能结算完整5秒。'),
  parameter('armor_reduction_ratio', '目标护甲降低比例', values('E', 'ArmorShredPercent', 5, [.30, .35, .40, .45, .50], -1), '原值为负；这里保存降低比例的正数，目标护甲削减，不是来源穿透。'));
E.formulas.push(formula('initial_damage', '灵魂烈焰初始魔法伤害', op('ADD', p('initial_base_damage'), op('MULTIPLY', p('initial_ap_ratio'), a('SOURCE', 'ability_power'))), '一次实际初始命中50/80/110/140/170加60%法强。'),
  formula('damage_per_second', '灵魂烈焰每秒魔法伤害', op('ADD', p('damage_per_second_base'), op('MULTIPLY', p('damage_per_second_ap_ratio'), a('SOURCE', 'ability_power'))), '每秒量，不作为每次Tick或一次立即伤害直接执行。'));
E.effects.push(effect('initial_damage', '灵魂烈焰初始伤害', null,
  [result('damage', '初始魔法伤害', 'DAMAGE', 'TARGET', fv('initial_damage'), { damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: [] })],
  '只保存独立伤害组成，未挂接必定命中；法术护盾与吸血交互待补，空项不是不受影响的证据。'));
E.gaps.push('周期频率、第一次结算时间、离开后的伤害/削甲解除时间待补证。', '初始命中和持续削甲的护盾交互另补，尚未挂接命中规则。');

assert.equal(clean(spell('R').mSpellCalculations.DamageCalc.mFormulaParts[1].mCoefficient), .0001);
R.parameters.push(parameter('bonus_health', '沙漠死神增加最大生命值', values('R', 'BonusHealth', 3, [300, 450, 600]), '最大生命值属性加成，不额外推定立即治疗。'),
  parameter('bonus_resistance', '沙漠死神增加双抗', values('R', 'InitialResistGain', 3, [40, 55, 70]), '护甲和魔法抗性分别固定加算。'),
  parameter('max_health_damage_ratio_per_second', '每秒目标最大生命伤害比例', values('R', 'AOEDamagePercent', 3, [.03, .04, .05]), '官方英文明确目标最大生命值口径。'),
  parameter('ap_ratio_per_second', '每秒最大生命伤害法强系数', .0001, '每100法强增加1个百分点最大生命伤害；系数本身为0.0001。'),
  parameter('duration_ms', '沙漠死神持续时间（毫秒）', values('R', 'Duration', 3, [15000, 15000, 15000], 1000), '持续15秒。'),
  parameter('q_cooldown_reduction_ratio', '期间 Q 基础冷却缩短比例', values('R', 'QCDR', 3, [.5, .5, .5]), '基础冷却减半，不是50点技能急速或剩余冷却减固定毫秒。'));
R.formulas.push(formula('damage_per_second', '沙漠死神每秒魔法伤害', op('MULTIPLY',
  op('ADD', p('max_health_damage_ratio_per_second'), op('MULTIPLY', p('ap_ratio_per_second'), a('SOURCE', 'ability_power'))), a('TARGET', 'hp')),
  '每秒量乘目标最大生命值；不将每秒量直接用于0.5秒一次的结算。客户端240上限适用目标不明，不给英雄伤害加该上限。'));
R.effects.push(effect('fury_attributes', '沙漠死神自身属性', lifecycle(pv('duration_ms')),
  // 同排序值的结果回读按稳定键排序；这三项独立属性加算不依赖执行先后。
  [attr('armor', '增加护甲', 'armor', 'bonus_resistance'), attr('health', '增加最大生命值', 'hp', 'bonus_health'), attr('magic_resistance', '增加魔法抗性', 'magic_resistance', 'bonus_resistance')],
  '自身持续15秒的三项属性加成；未把增加最大生命视作额外治疗，施加时点与 Q 冷却修正另接。'));
R.gaps.push('TickRate=0.5 已有来源，首次结算时点和完整次数尚需补证。', 'Q 临时冷却可用已有标记、窗口与条件过程组合，不记为结构完全无法表达；在 Q 强化过程补齐后接线。', '体型、范围等空间支路按既定范围跳过。');

for (const entry of [W, E, R]) {
  assert.equal(spell(entry.slot).spellCastTime, .25);
  entry.parameters.push(parameter('cast_time_ms', '施法时间（毫秒）', 250, '当前主技能 spellCastTime=0.25秒；Q 的攻击施法字段不套用普通施法时长。'));
}
for (const entry of [Q, W, E, R]) entry.effects.push(effect('mana_cost', '施放法力消耗', null,
  [result('consume_mana', '消耗法力', 'RESOURCE_CHANGE', 'SOURCE', pv('mana_cost'), { attributeKey: 'mana', operation: 'CONSUME' })],
  '复用公共参数批次已保存的 mana_cost，实际扣除时点由过程绑定决定。'));
for (const entry of [W, E, R]) entry.processes.push({ processKey: 'cast', name: '施法与法力消耗', activationType: 'ACTIVE', sortOrder: 10,
  description: '仅普通施法延迟、开始冷却与法力消耗，不用施法结束替代实际命中。伤害或持续属性效果独立保留。',
  cooldown: { durationValue: pv('cooldown_ms'), startMoment: { momentType: 'PROCESS_START', stepKey: null } },
  steps: [{ stepKey: 'cast_time', name: '施法时间', description: null, sortOrder: 10, stepType: 'DELAY', detail: { delayValue: pv('cast_time_ms') } }],
  effectBindings: [{ bindingKey: 'mana_cost', effectKey: 'mana_cost', sortOrder: 10, moment: { momentType: 'PROCESS_START', stepKey: null } }], stateOperations: [] });

const candidate = { generatedAt: new Date().toISOString(), source, proof, passiveCurve: curve,
  skills: batch, status: '部分录入；可证明组成，不等于完整机制', runtimeValidation: '未执行' };
fs.writeFileSync(path.join(here, '录入候选.json'), JSON.stringify(candidate, null, 2) + '\n');
const apply = process.argv.includes('--apply');
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
async function request(endpoint, body) {
  const response = await fetch(base + endpoint, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer local-entry', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok && response.status !== 404) throw new Error(`${endpoint}: ${response.status} ${JSON.stringify(data)}`);
  return { status: response.status, data };
}
const project = (actual, expected) => expected && typeof expected === 'object'
  ? Array.isArray(expected) ? actual?.map((v, i) => project(v, expected[i]))
    : Object.fromEntries(Object.keys(expected).map(k => [k, project(actual?.[k], expected[k])])) : actual;
const report = { observedAt: new Date().toISOString(), mode: apply ? '补缺实录' : '只读复核',
  sourceSha256: source.client.sha256, records: [], missing: [], conflicts: [], passed: false, runtimeValidation: '未执行' };
const save = () => fs.writeFileSync(path.join(here, apply ? '实录回读.json' : '独立核对.json'), JSON.stringify(report, null, 2) + '\n');
const tasks = [];
for (const entry of batch) {
  const owner = await request('/skills/' + entry.skillKey);
  assert.equal(owner.status, 200);
  assert.equal(owner.data.maxLevel, entry.maxLevel);
  for (const type of ['parameters', 'formulas', 'effects', 'processes']) {
    const key = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey' }[type];
    for (const expected of entry[type]) {
      const endpoint = `/skills/${entry.skillKey}/${type}/${expected[key]}`;
      const current = await request(endpoint);
      if (current.status === 200) {
        try { assert.deepEqual(project(current.data, expected), expected); }
        catch { report.conflicts.push(endpoint); }
      }
      tasks.push({ skillKey: entry.skillKey, type, endpoint, expected });
    }
  }
}
save();
assert.equal(report.conflicts.length, 0, '现值冲突，未开始写入');
for (const task of tasks) {
  let found = await request(task.endpoint);
  let action = '保留已有一致值';
  if (found.status === 404) {
    if (!apply) { report.missing.push(task.endpoint); save(); continue; }
    const created = await request(`/skills/${task.skillKey}/${task.type}`, task.expected);
    assert.ok(created.status >= 200 && created.status < 300);
    action = '新增';
  } else assert.deepEqual(project(found.data, task.expected), task.expected);
  found = await request(task.endpoint);
  assert.equal(found.status, 200);
  assert.deepEqual(project(found.data, task.expected), task.expected, task.endpoint);
  report.records.push({ ...task, actual: found.data, action, matches: true, checkedAt: new Date().toISOString() });
  save();
}
report.counts = Object.fromEntries(['parameters', 'formulas', 'effects', 'processes'].map(type => [type, report.records.filter(r => r.type === type).length]));
report.passed = report.records.length === tasks.length && report.missing.length === 0;
save();
console.log(JSON.stringify({ counts: report.counts, passed: report.passed, missing: report.missing.length, conflicts: report.conflicts.length }));
