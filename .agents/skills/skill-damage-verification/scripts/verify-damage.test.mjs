import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { calculatePlan, compareResults, evaluateArithmetic } from './verify-damage.mjs';

function plan() {
  return {
    basis: '合成数值规则：无防御或其他修正，一笔伤害先消耗护盾再扣生命。',
    cases: [{
      id: 'normal',
      inputs: { attack: 80, hp: 80, shield: 40 },
      steps: [
        { name: 'damage', expression: '60 + 0.5 * attack' },
        { name: 'absorbed', expression: 'min(shield, damage)' },
        { name: 'loss', expression: 'min(hp, max(0, damage - absorbed))' },
      ],
      checks: [
        { pointer: '/complete', value: true },
        { pointer: '/records', measure: 'length', expression: '1' },
        { pointer: '/records/0/timeMs', expression: '250' },
        { pointer: '/records/0/source', value: 'skill-example' },
        { pointer: '/records/0/postDefenseDamage', expression: 'damage', comparison: 'amount' },
        { pointer: '/records/0/shieldAbsorbed', expression: 'absorbed', comparison: 'amount' },
        { pointer: '/records/0/actualHpLoss', expression: 'loss', comparison: 'amount' },
        { pointer: '/remainingHp', expression: 'hp - loss', comparison: 'amount' },
      ],
    }],
  };
}

function result() {
  return {
    complete: true,
    records: [{ timeMs: 250, source: 'skill-example', postDefenseDamage: 100, shieldAbsorbed: 40, actualHpLoss: 60 }],
    remainingHp: 20,
  };
}

function compare(raw, expected = calculatePlan(plan())) {
  return compareResults(expected, [{ id: 'normal', result: raw }]);
}

test('不要求资料元信息，直接采用给定预期或执行给定算式', () => {
  const expected = calculatePlan({ cases: [{
    id: 'ready-text',
    inputs: { attack: 80 },
    checks: [
      { pointer: '/complete', value: true },
      { pointer: '/amount', value: 100, comparison: 'amount' },
      { pointer: '/amount', expression: '60 + 0.5 * attack', comparison: 'amount' },
      { pointer: '/timeMs', value: 250 },
    ],
  }] });
  const actual = { complete: true, amount: 100, timeMs: 250 };
  assert.equal(compareResults(expected, [{ id: 'ready-text', result: actual }]).pass, true);
  assert.equal(compareResults(expected, [{ id: 'ready-text', result: { ...actual, timeMs: 251 } }]).pass, false);
  assert.throws(() => calculatePlan(null), /计划必须是对象/);
});

test('按数学优先级执行分步公式、负指数与有限函数', () => {
  const values = new Map([['attack', 80]]);
  assert.equal(evaluateArithmetic('60 + 0.5 * attack', values), 100);
  assert.equal(evaluateArithmetic('-2 ** 2 + 2 ** -2'), -3.75);
  assert.equal(evaluateArithmetic('2 ** 3 ** 2'), 512);
  assert.equal(evaluateArithmetic('min(7, max(2, 5)) + floor(1.9) + ceil(.2) + abs(-3) + round(1.6) + pow(2, 3)'), 20);
  assert.equal(evaluateArithmetic('1e2 + .5e1 - 7 % 4'), 102);
  const expected = calculatePlan(plan());
  assert.deepEqual(expected.cases[0].values, { attack: 80, hp: 80, shield: 40, damage: 100, absorbed: 40, loss: 60 });
  assert.equal(compare(result(), expected).pass, true);
});

test('拒绝任意代码、未知输入、除零、畸形算式与非有限值', () => {
  for (const expression of [
    'process.exit()', 'Math.max(1, 2)', '1; 2', 'unknown + 1', '1 / 0', '1 % 0',
    'pow(10, 400)', '1e999', 'min()', 'abs(1, 2)', '1 +', '(1 + 2', '1 2', '',
  ]) assert.throws(() => evaluateArithmetic(expression), undefined, expression);
  const invalid = plan();
  invalid.cases[0].inputs.attack = null;
  assert.throws(() => calculatePlan(invalid), /有限数值/);
});

test('金额容差有限，次数、来源与时刻不能靠总额相同通过', () => {
  const close = result();
  close.records[0].postDefenseDamage += 5e-8;
  assert.equal(compare(close).pass, true);
  const outside = result();
  outside.records[0].postDefenseDamage += 2e-7;
  assert.equal(compare(outside).pass, false);
  const late = result();
  late.records[0].timeMs = 251;
  assert.equal(compare(late).pass, false);
  const otherSource = result();
  otherSource.records[0].source = 'another-skill';
  assert.equal(compare(otherSource).pass, false);
  const extra = result();
  extra.records.push({ ...extra.records[0], postDefenseDamage: 0 });
  assert.equal(compare(extra).pass, false);
});

test('缺字段、空值、未完成运行或空场景不能伪装成功', () => {
  const missing = result();
  delete missing.records[0].actualHpLoss;
  assert.throws(() => compare(missing), /缺少字段/);
  const empty = result();
  empty.records[0].actualHpLoss = null;
  assert.throws(() => compare(empty), /对照值/);
  const incomplete = result();
  incomplete.complete = false;
  assert.equal(compare(incomplete).pass, false);
  assert.throws(() => calculatePlan({ basis: 'test', cases: [] }), /场景不能为空/);
  const noChecks = plan();
  noChecks.cases[0].checks = [];
  assert.throws(() => calculatePlan(noChecks), /没有对照项/);
  assert.throws(() => compareResults(calculatePlan(plan()), []), /场景数量/);
});

test('明确不触发的场景可精确检查零条事件，而非跳过检查', () => {
  const inactive = calculatePlan({
    basis: '合成规则：条件不成立不产生伤害事件。',
    cases: [{ id: 'inactive', checks: [{ pointer: '/records', measure: 'length', expression: '0' }, { pointer: '/complete', value: true }] }],
  });
  assert.equal(compareResults(inactive, [{ id: 'inactive', result: { records: [], complete: true } }]).pass, true);
  assert.equal(compareResults(inactive, [{ id: 'inactive', result: { records: [{}], complete: true } }]).pass, false);
});

test('拒绝重复场景、重写变量及手改的计算结果', () => {
  const duplicate = plan();
  duplicate.cases.push(structuredClone(duplicate.cases[0]));
  assert.throws(() => calculatePlan(duplicate), /重复场景/);
  const duplicateVariable = plan();
  duplicateVariable.cases[0].steps.push({ name: 'damage', expression: '0' });
  assert.throws(() => calculatePlan(duplicateVariable), /变量重复/);
  const expected = calculatePlan(plan());
  expected.cases[0].checks[4].expected = 999;
  assert.throws(() => compare(result(), expected), /不能手改/);
  assert.throws(() => compareResults(calculatePlan(plan()), [{ id: 'other', result: result() }]), /缺少实际场景/);
});

test('字段路径转义正确，不把不存在的键或错误结构当成数值', () => {
  const expected = calculatePlan({ basis: '合成路径规则', cases: [{ id: 'keys', checks: [{ pointer: '/a~1b/~0count', expression: '2' }] }] });
  assert.equal(compareResults(expected, [{ id: 'keys', result: { 'a/b': { '~count': 2 } } }]).pass, true);
  assert.throws(() => compareResults(expected, [{ id: 'keys', result: {} }]), /缺少字段/);
  const badPath = plan();
  badPath.cases[0].checks[0].pointer = '/bad~2';
  assert.throws(() => calculatePlan(badPath), /转义/);
  const notArray = result();
  notArray.records = { length: 1 };
  assert.throws(() => compare(notArray), /需要数组/);
});

test('命令两阶段读原始文件、绑定摘要、失败退出并保护已有证据', t => {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'damage-skill-verification-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), temporaryRoot);
    assert.ok(basename(directory).startsWith('damage-skill-verification-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const tool = fileURLToPath(new URL('./verify-damage.mjs', import.meta.url));
  const write = (name, data) => writeFileSync(join(directory, name), `${JSON.stringify(data)}\n`);
  const run = args => spawnSync(process.execPath, [tool, ...args], { cwd: directory, encoding: 'utf8' });
  write('plan.json', plan());
  const calculate = ['calculate', '--plan', 'plan.json', '--output', 'expected.json'];
  const calculated = run(calculate);
  assert.equal(calculated.status, 0, calculated.stderr);
  const originalExpected = readFileSync(join(directory, 'expected.json'));
  write('normal.wasm.json', result());
  write('results.json', { cases: [{ id: 'normal', file: 'normal.wasm.json' }] });
  const compareArgs = ['compare', '--expected', 'expected.json', '--actual', 'results.json', '--output', 'report.json'];
  const compared = run(compareArgs);
  assert.equal(compared.status, 0, compared.stderr);
  const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
  assert.equal(report.pass, true);
  assert.equal(report.actualFiles[0].sha256, createHash('sha256').update(readFileSync(join(directory, 'normal.wasm.json'))).digest('hex'));
  assert.equal(report.expectedSha256, createHash('sha256').update(originalExpected).digest('hex'));
  const later = result();
  later.records[0].timeMs = 251;
  write('normal.wasm.json', later);
  const failed = run([...compareArgs.slice(0, -1), 'failure.json']);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(JSON.parse(readFileSync(join(directory, 'failure.json'), 'utf8')).pass, false);
  const originalReport = readFileSync(join(directory, 'report.json'));
  assert.equal(run(compareArgs).status, 1);
  assert.deepEqual(readFileSync(join(directory, 'report.json')), originalReport);
  const changedPlan = plan();
  changedPlan.cases[0].inputs.attack = 90;
  write('plan.json', changedPlan);
  assert.equal(run(calculate).status, 1);
  assert.deepEqual(readFileSync(join(directory, 'expected.json')), originalExpected);
  write('results.json', { cases: [{ id: 'normal', file: 'missing.json' }] });
  assert.equal(run([...compareArgs.slice(0, -1), 'missing-report.json']).status, 1);
});
