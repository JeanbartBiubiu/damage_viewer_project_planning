import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidateBytes = await readFile(path.join(here, '完整候选.json'));
const candidate = JSON.parse(candidateBytes);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const subjects = new Map(candidate.objects.map(object => [object.skillKey, object]));
const checks = [];

function subject(skillKey) {
  const object = subjects.get(skillKey);
  assert.ok(object, `缺少候选技能 ${skillKey}`);
  return object.apiPayload;
}

function parameter(skill, parameterKey) {
  const row = skill.parameters.find(item => item.parameterKey === parameterKey);
  assert.ok(row, `缺少参数 ${parameterKey}`);
  return row;
}

function numeric(node, skill, inputs, attributes) {
  if (node.nodeType === 'PARAMETER') {
    const row = parameter(skill, node.parameterKey);
    if (row.valueMode === 'FIXED') return row.fixedValue;
    assert.equal(row.valueMode, 'RUNTIME_INPUT', `${node.parameterKey} 必须由显式输入提供`);
    assert.ok(Object.hasOwn(inputs, node.parameterKey), `算例缺少输入 ${node.parameterKey}`);
    assert.ok(Number.isFinite(inputs[node.parameterKey]), `算例输入 ${node.parameterKey} 必须为数值`);
    return inputs[node.parameterKey];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const value = attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    assert.ok(Number.isFinite(value), `算例缺少属性 ${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
    return value;
  }
  assert.equal(node.nodeType, 'OPERATION');
  const values = node.operands.map(operand => numeric(operand, skill, inputs, attributes));
  if (node.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
  if (node.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
  if (node.operation === 'MIN') return Math.min(...values);
  if (node.operation === 'MAX') return Math.max(...values);
  if (node.operation === 'SUBTRACT') return values.slice(1).reduce((result, value) => result - value, values[0]);
  throw Error(`未支持的运算 ${node.operation}`);
}

function calculate(skillKey, formulaKey, inputs = {}, attributes = {}) {
  const skill = subject(skillKey);
  const row = skill.formulas.find(formula => formula.formulaKey === formulaKey);
  assert.ok(row, `缺少公式 ${skillKey}/${formulaKey}`);
  return numeric(row.expression, skill, inputs, attributes);
}

function check(name, actual, expected, detail = {}) {
  const match = Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1e-9;
  checks.push({ name, actual, expected, match, ...detail });
  assert.equal(match, true, `${name} 算例不通过：${actual} !== ${expected}`);
}

function fixedCheck(skillKey, parameterKey, expected) {
  const row = parameter(subject(skillKey), parameterKey);
  assert.equal(row.valueMode, 'FIXED');
  check(`${skillKey}/${parameterKey}`, row.fixedValue, expected, { kind: 'fixed-parameter' });
}

for (const [key, value] of [
  ['item_2503_passive/burn_flat_damage_per_second', 20],
  ['item_2503_passive/burn_scaling_ratio', 0.02],
  ['item_2503_passive/burn_duration_seconds', 3],
  ['item_2508_passive/damage_per_second', 5],
  ['item_2508_passive/damage_duration_seconds', 3],
  ['item_3118_passive/ultimate_haste', 20],
  ['item_3118_passive/ground_duration_ms', 3000],
  ['item_3118_passive/magic_resistance_shred', 10],
  ['item_3152_active/cooldown_ms', 50000],
  ['item_6660_passive/aura_range', 325],
  ['item_6660_passive/aura_duration_ms', 3000],
  ['item_6660_passive/damage_per_tick', 15],
  ['item_6660_passive/ticks_per_second', 1],
  ['item_6655_passive/cooldown_ms', 12000],
  ['item_6655_passive/max_echo_charges', 6],
  ['item_6655_passive/remaining_echo_count', 5],
  ['item_6655_passive/repeat_echo_damage_ratio', 0.2],
  ['item_6655_passive/single_target_multiplier', 2],
  ['item_3094_passive/energized_magic_damage', 40],
  ['item_3094_passive/energized_attack_range_ratio', 0.35],
  ['item_3094_passive/energized_attack_range_cap', 150],
  ['item_3095_passive/energized_magic_damage', 100],
  ['item_3095_passive/move_speed_ratio', 0.45],
  ['item_3095_passive/move_speed_duration_ms', 1500],
  ['item_3087_passive/bounce_range', 500],
  ['item_3087_passive/bonus_energized_stacks', 9],
  ['item_3087_passive/champion_chain_damage', 60],
  ['item_3087_passive/non_champion_chain_damage', 90],
  ['item_3147_passive/damage_increase_per_second_ratio', 0.02],
  ['item_3147_passive/damage_increase_max_ratio', 0.06],
  ['item_3147_passive/combat_seconds_to_cap', 3],
  ['item_6699_passive/melee_current_hp_damage_ratio', 0.09],
  ['item_6699_passive/ranged_current_hp_damage_ratio', 0.07],
  ['item_6699_passive/melee_bonus_lethality', 15],
  ['item_6699_passive/ranged_bonus_lethality', 12],
  ['item_6699_passive/bonus_lethality_duration_ms', 4000],
  ['item_4646_passive/damage_window_ms', 2500],
  ['item_4646_passive/damage_threshold_ratio', 0.25],
  ['item_4646_passive/squall_delay_ms', 2000],
  ['item_4646_passive/cooldown_ms', 30000],
  ['item_4646_passive/ranged_squall_damage_multiplier', 1]
]) {
  const [skillKey, parameterKey] = key.split('/');
  fixedCheck(skillKey, parameterKey, value);
}

for (const [input, expected] of [[0, 20], [100, 22], [500, 30]]) {
  check(`item_2503_passive/burn_damage_per_second/${input}`, calculate('item_2503_passive', 'burn_damage_per_second', { burn_scaling_stat_value: input }), expected, { input: { burn_scaling_stat_value: input }, boundary: 'mStat省略，显式输入' });
}
check('item_2508_passive/total_damage', calculate('item_2508_passive', 'total_damage'), 15, { derivation: '5 × 3' });
for (const [input, expected] of [[0, 60], [100, 65], [200, 70]]) {
  check(`item_3118_passive/ground_burn_damage_value/${input}`, calculate('item_3118_passive', 'ground_burn_damage_value', { ground_damage_scaling_stat_value: input }), expected, { input: { ground_damage_scaling_stat_value: input }, boundary: 'mStat省略，显式输入' });
}
for (const [input, expected] of [[0, 100], [100, 110]]) {
  check(`item_3152_active/firebolt_damage/${input}`, calculate('item_3152_active', 'firebolt_damage', { firebolt_scaling_stat_value: input }), expected, { input: { firebolt_scaling_stat_value: input }, boundary: 'mStat省略，显式输入' });
}
check('item_6660_passive/display_dps', calculate('item_6660_passive', 'display_dps'), 15, { derivation: '15 × 1；仅DPS展示' });
for (const [input, expectedEcho, expectedMax] of [[0, 75, 150], [100, 80, 160], [500, 100, 200]]) {
  const values = { echo_scaling_stat_value: input };
  check(`item_6655_passive/echo_damage/${input}`, calculate('item_6655_passive', 'echo_damage', values), expectedEcho, { input: values, boundary: 'mStat省略，显式输入' });
  check(`item_6655_passive/single_target_max_damage/${input}`, calculate('item_6655_passive', 'single_target_max_damage', values), expectedMax, { input: values, derivation: '首道1份 + 剩余5道 × 20% = 2份' });
}
check('item_6655_passive/remaining_echo_total_ratio', calculate('item_6655_passive', 'remaining_echo_total_ratio'), 1, { derivation: '5 × 0.2；不是减伤20%' });
for (const [input, expected] of [[0, 0], [1, 0.02], [2, 0.04], [3, 0.06], [4, 0.06]]) {
  check(`item_3147_passive/damage_increase_ratio/${input}`, calculate('item_3147_passive', 'damage_increase_ratio', { elapsed_combat_seconds: input }), expected, { input: { elapsed_combat_seconds: input }, boundary: '显式战斗秒数；不解释脱战' });
}
for (const [hp, expectedMelee, expectedRanged] of [[0, 0, 0], [100, 9, 7], [1000, 90, 70]]) {
  const attributes = { TARGET: { hp: { CURRENT: hp } } };
  check(`item_6699_passive/melee_current_hp_damage/${hp}`, calculate('item_6699_passive', 'melee_current_hp_damage', {}, attributes), expectedMelee, { attributes, boundary: 'StringCalculations近远程动态拆分' });
  check(`item_6699_passive/ranged_current_hp_damage/${hp}`, calculate('item_6699_passive', 'ranged_current_hp_damage', {}, attributes), expectedRanged, { attributes, boundary: 'StringCalculations近远程动态拆分' });
}
for (const [input, expected] of [[0, 125], [100, 135]]) {
  const values = { squall_scaling_stat_value: input };
  check(`item_4646_passive/melee_squall_damage/${input}`, calculate('item_4646_passive', 'melee_squall_damage', values), expected, { input: values, boundary: 'mStat省略，显式输入' });
  check(`item_4646_passive/ranged_squall_damage/${input}`, calculate('item_4646_passive', 'ranged_squall_damage', values), expected, { input: values, boundary: 'RangedProcDamageMod=1' });
}

const output = {
  at: new Date().toISOString(),
  candidateSha256: sha256(candidateBytes),
  boundary: '独立读取候选参数与公式；显式输入仅用于验证公式算术，不表示API、事件或战斗运行时已接线。',
  checks,
  failures: checks.filter(check => !check.match),
  totals: { checks: checks.length, failures: checks.filter(check => !check.match).length }
};
await writeFile(path.join(here, '独立数值核对.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ candidateSha256: output.candidateSha256, checks: output.totals.checks, failures: output.totals.failures }));
