import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const ledger = JSON.parse(fs.readFileSync(path.join(here, '../阶段进度.json'), 'utf8'));
const heroes = ledger.heroes.priorityScope.batches.flatMap(batch => batch.heroes);
assert.equal(heroes.length, 50);
assert(heroes.some(hero => hero.characterKey === 'champion_janna' && hero.skillKeys.includes('janna_e')));
const previous = JSON.parse(fs.readFileSync(path.join(here, '../交叉试录/五项自施技能消耗冷却补录/04-写入前现值.json'), 'utf8'));
const routes = Object.keys(previous.values).filter(route => route.includes('janna'));
const token = crypto.randomUUID(), values = {}, audit = [];
async function read(route) {
  if (Object.hasOwn(values, route)) return values[route];
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token },
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, route);
  values[route] = await response.json();
  audit.push({ method: 'GET', route, status: response.status });
  return values[route];
}
for (const route of routes) await read(route);
for (const [collection, key] of [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internal-states', 'stateKey'], ['trigger-rules', 'ruleKey']]) {
  const route = '/skills/janna_e/' + collection;
  const list = await read(route);
  assert(Array.isArray(list), route);
  for (const item of list) await read(route + '/' + encodeURIComponent(item[key]));
}
const sourcePaths = [
  '数据参考/全量录入-2026-09/英雄/原始资料/en_US/champion/Janna.json',
  '数据参考/全量录入-2026-09/英雄/原始资料/zh_CN/champion/Janna.json',
  '数据参考/全量录入-2026-09/技能公共参数实录/客户端原文/Janna.json.gz',
  '数据参考/全量录入-2026-09/四项自施来源复核/自施目标补证-2026-09-19.json'
];
const sources = sourcePaths.map(file => ({ path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }));
const dir = path.join(here, '迦娜护盾存续准备');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, '01-现值与来源只读准备.json'), JSON.stringify({
  at: new Date().toISOString(), skillKey: 'janna_e', characterKey: 'champion_janna', inSelected50: true,
  capabilityQuestion: '现有护盾与攻击力增益能否绑定同一指定护盾的存续，提前破裂或到期时不留下攻击力增益',
  businessWrites: 0, pageWriteApproved: false,
  boundary: '先做真实页面表达能力验证；不更改原护盾期限、公式、自施资格、过程或规则，不把固定时长增益冒充护盾存续资格',
  independentGETs: audit.length, sources, audit, values
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ independentGETs: audit.length, inSelected50: true, businessWrites: 0,
  effects: values['/skills/janna_e/effects'].length, rules: values['/skills/janna_e/trigger-rules'].length,
  processes: values['/skills/janna_e/processes'].length,
  shield: values['/skills/janna_e/effects/self_shield'],
  attackDamageFormula: values['/skills/janna_e/formulas/total_attack_damage_bonus']
}));
