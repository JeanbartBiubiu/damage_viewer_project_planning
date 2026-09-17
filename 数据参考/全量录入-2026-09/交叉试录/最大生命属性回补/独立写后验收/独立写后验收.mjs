import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), batch = path.dirname(here);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(batch, name)));
const planBytes = fs.readFileSync(path.join(batch, '可审查请求.json'));
assert.equal(sha(planBytes), '685ec3c446fbb5d5c80098ac335e9fa4279f1ac62960c6fbb785ee07d8035106');
const plan = JSON.parse(planBytes), original = read('写前现值.json');
assert.equal(original.reads.length, 17);
const originalHashes = Object.fromEntries(['可审查请求.json', '写前现值.json', '实际回补结果.json', '实际流水.jsonl'].map(name => [name, sha(fs.readFileSync(path.join(batch, name)))]));
const auth = process.env.HP12_VERIFY_TOKEN; assert.ok(auth, '缺少本地只读认证');
const report = { startedAt: new Date().toISOString(), planSha256: sha(planBytes), businessWrites: 0, reads: [], checks: [], math: [], errors: [] };
const run = new Date().toISOString().replace(/[-:.TZ]/g, '');
const output = path.join(here, `实际17路由-${run}.json`);
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
function equal(name, a, b) { assert.deepEqual(a, b, name); report.checks.push({ name, passed: true }); }
const current = new Map(), old = new Map(original.reads.map(r => [r.route, r.actual]));
try {
  for (const r of original.reads) {
    const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + r.route, { headers: { Authorization: 'Bearer ' + auth }, signal: AbortSignal.timeout(30000) });
    const actual = await response.json();
    report.reads.push({ at: new Date().toISOString(), method: 'GET', route: r.route, status: response.status, actual }); current.set(r.route, actual); save();
    equal(`独立状态 ${r.route}`, response.status, r.route.endsWith('/parameters/actual_mstat12_formula0') ? 404 : 200);
  }
  const deleted = plan.requests.find(r => r.method === 'DELETE').route;
  const changes = new Map(plan.requests.filter(r => r.method === 'PUT').map(r => [r.route, r.body]));
  for (const r of original.reads) {
    if (r.route === deleted) continue;
    const actual = current.get(r.route);
    let expected = structuredClone(r.actual);
    if (changes.has(r.route)) {
      expected = { ...expected, ...changes.get(r.route) };
      if (Object.hasOwn(expected, 'updatedAt')) { assert.ok(typeof actual.updatedAt === 'string'); expected.updatedAt = actual.updatedAt; }
    } else if (Array.isArray(expected)) {
      // 以原列表的字段集合构造期望。表达式只存在详情时，不把它塞进摘要。
      const stableKey = r.route.endsWith('/parameters') ? 'parameterKey' : r.route.endsWith('/formulas') ? 'formulaKey' : null;
      if (stableKey) expected = expected.filter(row => `${r.route}/${row[stableKey]}` !== deleted).map(row => {
        const patch = changes.get(`${r.route}/${row[stableKey]}`); if (!patch) return row;
        const answer = { ...row };
        for (const [key, value] of Object.entries(patch)) if (Object.hasOwn(row, key)) answer[key] = value;
        if (Object.hasOwn(row, 'updatedAt')) answer.updatedAt = actual.find(v => v[stableKey] === row[stableKey]).updatedAt;
        return answer;
      });
    }
    equal(`完整值或原有列表投影 ${r.route}`, actual, expected);
  }
  const root = '/skills/item_3181_passive';
  equal('最终参数集合4', current.get(root + '/parameters').map(r => r.parameterKey).sort(), ['attacks_required', 'base_ad_ratio', 'mstat12_formula0_ratio', 'ranged_damage_multiplier'].sort());
  equal('最终公式集合2', current.get(root + '/formulas').map(r => r.formulaKey).sort(), ['melee_bonus_damage', 'ranged_bonus_damage']);
  for (const kind of ['effects', 'processes', 'internal-states', 'trigger-rules']) equal(`动作集合保持空 ${kind}`, current.get(root + '/' + kind), []);
  const actualP = new Map(current.get(root + '/parameters').map(p => [p.parameterKey, current.get(root + '/parameters/' + p.parameterKey)]));
  const actualF = new Map(current.get(root + '/formulas').map(f => [f.formulaKey, current.get(root + '/formulas/' + f.formulaKey)]));
  function walk(v, action) { if (v && typeof v === 'object') { action(v); for (const child of Object.values(v)) if (child && typeof child === 'object') walk(child, action); } }
  for (const f of actualF.values()) walk(f.expression, node => { assert.ok(!(node.nodeType === 'PARAMETER' && node.parameterKey === 'actual_mstat12_formula0')); if (node.nodeType === 'PARAMETER') assert.ok(actualP.has(node.parameterKey)); });
  report.checks.push({ name: '实际两公式无已删输入且所有参数引用有效', passed: true });
  function evaluate(node, attrs) {
    if (node.nodeType === 'PARAMETER') { const p = actualP.get(node.parameterKey); assert.equal(p.valueMode, 'FIXED'); return p.fixedValue; }
    if (node.nodeType === 'ATTRIBUTE') { const key = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`; if (!Object.hasOwn(attrs, key)) throw new Error('缺属性 ' + key); return attrs[key]; }
    assert.equal(node.nodeType, 'OPERATION'); const v = node.operands.map(n => evaluate(n, attrs));
    if (node.operation === 'ADD') return v.reduce((a, b) => a + b, 0); if (node.operation === 'MULTIPLY') return v.reduce((a, b) => a * b, 1); throw new Error('非法运算');
  }
  function changeHP(node, owner, kind) {
    if (node?.nodeType === 'ATTRIBUTE' && node.attributeKey === 'hp') return { ...node, attributeOwner: owner, attributeValueKind: kind };
    return node && typeof node === 'object' ? Array.isArray(node) ? node.map(v => changeHP(v, owner, kind)) : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, changeHP(v, owner, kind)])) : node;
  }
  for (const sample of [{ baseAD: 100, hp: 2000, bonusHP: 800, currentHP: 500, targetHP: 3000, melee: 220, ranged: 154 }, { baseAD: 80, hp: 1234.5, bonusHP: 334.5, currentHP: 200, targetHP: 2500, melee: 157.725, ranged: 110.4075 }]) {
    const attrs = { 'SOURCE/attack_damage/BASE': sample.baseAD, 'SOURCE/hp/TOTAL': sample.hp, 'SOURCE/hp/BONUS': sample.bonusHP, 'SOURCE/hp/CURRENT': sample.currentHP, 'TARGET/hp/TOTAL': sample.targetHP };
    for (const f of actualF.values()) {
      const value = evaluate(f.expression, attrs), expected = f.formulaKey.startsWith('melee') ? sample.melee : sample.ranged;
      assert.ok(Math.abs(value - expected) < 1e-9);
      const counters = [['SOURCE', 'BONUS'], ['SOURCE', 'CURRENT'], ['TARGET', 'TOTAL']].map(([owner, kind]) => ({ owner, kind, hypotheticalWrong: evaluate(changeHP(f.expression, owner, kind), attrs) }));
      assert.ok(counters.every(c => Math.abs(c.hypotheticalWrong - value) > 1e-6));
      report.math.push({ formulaKey: f.formulaKey, sample, actual: value, expected, counterfactualSubstitutions: counters, passed: true, inputSource: '本次实际4参数2公式GET，不从候选求值' });
    }
  }
  let missingError;
  try { evaluate(actualF.get('melee_bonus_damage').expression, { 'SOURCE/attack_damage/BASE': 100, 'SOURCE/hp/CURRENT': 500 }); } catch (e) { missingError = e.message; }
  equal('当前生命不能填充缺失的最大生命', missingError, '缺属性 SOURCE/hp/TOTAL');
  for (const [name, value] of Object.entries(originalHashes)) equal('根负责人原证据未改 ' + name, sha(fs.readFileSync(path.join(batch, name))), value);
  report.summary = { status: 'PASS', actualGET: 17, expected200: 16, expectedDeleted404: 1, parameters: 4, formulas: 2, unchangedEmptyActionCollections: 4, mathCases: 4, wrongHPKindCases: 12, missingTotalHPRejected: true, sourceImageAndRelationUnchanged: true, onlyAuthorizedFieldsChanged: true, businessWrites: 0 };
  report.finishedAt = new Date().toISOString(); save();
  const conclusion = { at: report.finishedAt, status: 'PASS', planSha256: sha(planBytes), ...report.summary, actualReadFile: path.basename(output), actualReadSha256: sha(fs.readFileSync(output)), originalEvidenceSha256: originalHashes, boundary: '当前17次GET与静态独立数学；没有业务写、浏览器或战斗执行。原已失败报告与流水保持；未重放5请求。' };
  fs.writeFileSync(path.join(here, '独立写后结论.json'), JSON.stringify(conclusion, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...report.summary, reportSha256: sha(fs.readFileSync(path.join(here, '独立写后结论.json'))) }));
} catch (e) { report.errors.push({ name: e.name, message: e.message }); save(); console.error(JSON.stringify({ error: e.message, getCount: report.reads.length })); process.exitCode = 1; }
