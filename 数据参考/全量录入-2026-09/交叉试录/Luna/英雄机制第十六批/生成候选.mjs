import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as eq } from 'node:util';

const here = new URL('./', import.meta.url);
if (fs.existsSync(new URL('冻结候选锁.json', here))) throw Error('本批已有冻结锁，禁止覆盖候选。');

import { plan } from './候选.mjs';
import './英雄组成.mjs';

const snapshotBytes = fs.readFileSync(new URL('写前现值.json', here));
const snapshot = JSON.parse(snapshotBytes);
const order = ['malzahar', 'anivia', 'lissandra', 'karthus'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
if (!eq(Object.keys(plan.skills), order)) throw Error('候选必须精确覆盖20个固定技能位');
if (snapshot.summary?.errorCount !== 0 || snapshot.summary?.requestCount !== 166) throw Error('写前GET证据不是166/166成功，禁止生成候选');

const immutable = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const reuse = [];
const metadataDifferences = [];
const coverage = [];
const allowedAttrs = new Set(['ability_power', 'attack_damage']);

function walk(node, fn, path = '$') {
  if (!node || typeof node !== 'object') return;
  fn(node, path);
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') walk(value, fn, `${path}.${key}`);
  }
}

function validateExpression(expression, path) {
  walk(expression, (node, at) => {
    if (!node.nodeType) return;
    if (!['PARAMETER', 'ATTRIBUTE', 'OPERATION'].includes(node.nodeType)) throw Error(`表达式出现非法节点 ${path}${at}`);
    if (node.nodeType === 'ATTRIBUTE' && !allowedAttrs.has(node.attributeKey)) throw Error(`表达式属性未在本批窄口径内 ${path}${at}`);
    if (node.nodeType === 'OPERATION' && !['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation)) throw Error(`表达式运算不受支持 ${path}${at}`);
  });
}

for (const key of order) {
  const candidate = plan.skills[key];
  const old = snapshot.skills[key];
  if (!old || old.subject.status !== 200) throw Error(`缺写前技能主体 ${key}`);
  for (const [kind, value] of Object.entries(old.components)) {
    if (kind !== 'parameters' && value.items.length) throw Error(`已有非参数组成，不能推空 ${key}/${kind}`);
  }

  for (const oldParam of old.components.parameters.items) {
    const body = Object.fromEntries(Object.entries(oldParam).filter(([field]) => !immutable.has(field)));
    const index = candidate.write.parameters.findIndex(value => value.parameterKey === oldParam.parameterKey);
    if (index >= 0) {
      if (!['valueType', 'valueMode', 'fixedValue', 'levelValues'].every(field => eq(candidate.write.parameters[index][field], oldParam[field]))) {
        throw Error(`已有参数数值不一致 ${key}/${oldParam.parameterKey}`);
      }
      const fields = Object.keys(body).filter(field => !eq(body[field], candidate.write.parameters[index][field]));
      if (fields.length) metadataDifferences.push({ skillKey: key, parameterKey: oldParam.parameterKey, fields, policy: '完整复用原公参，不发更新请求' });
      candidate.write.parameters[index] = body;
    } else {
      candidate.write.parameters.unshift(body);
    }
    reuse.push({ skillKey: key, parameterKey: oldParam.parameterKey });
  }

  for (const formula of candidate.write.formulas) validateExpression(formula.expression, `${key}/${formula.formulaKey}`);
  for (const effect of candidate.write.effects) {
    if (effect.lifecycle?.moment === 'MOMENT_EVALUATION') throw Error(`效果使用了禁止的MOMENT_EVALUATION ${key}/${effect.effectKey}`);
    walk(effect, (node, at) => {
      if (node.valueMode === 'RUNTIME_INPUT' || node.mode === 'RUNTIME_INPUT') throw Error(`效果间接引用RUNTIME_INPUT ${key}/${effect.effectKey}${at}`);
      if (node.resultType === 'DAMAGE' || node.resultType === 'DIRECT_HEAL') throw Error(`本批禁止造即时伤害/治疗效果 ${key}/${effect.effectKey}`);
    });
  }
  const ids = new Set();
  for (const [kind, list] of Object.entries(candidate.write)) {
    for (const row of list) {
      const id = row.parameterKey ?? row.formulaKey ?? row.effectKey ?? row.processKey ?? row.stateKey ?? row.ruleKey;
      if (!id) throw Error(`组成缺稳定键 ${key}/${kind}`);
      const scoped = `${kind}:${id}`;
      if (ids.has(scoped)) throw Error(`组成重复键 ${key}/${scoped}`);
      ids.add(scoped);
    }
  }
  candidate.reusedParameters = reuse.filter(value => value.skillKey === key).map(value => value.parameterKey);
  candidate.disposition = {
    范围外: candidate.excluded,
    来源待核: candidate.pending.filter(value => value.kind === '来源'),
    系统缺口: candidate.pending.filter(value => value.kind === '系统'),
    尚未接线: candidate.pending.filter(value => !['来源', '系统'].includes(value.kind))
  };
  candidate.status = '确定组成候选；未保存、未接线和范围外分支不表示完整战斗机制';
  coverage.push({ skillKey: key, parameters: candidate.write.parameters.length, formulas: candidate.write.formulas.length, effects: candidate.write.effects.length, processes: candidate.write.processes.length, internalStates: candidate.write.internalStates.length, triggerRules: candidate.write.triggerRules.length, pending: candidate.pending.length, excluded: candidate.excluded.length });
}

plan.meta.generatedAt = new Date().toISOString();
plan.meta.apiWrites = 0;
plan.meta.executor = '第十六批由Codex执行代理准备；仅来源与当前GET候选，未业务写入';
plan.meta.reuseReport = {
  publicParameters: reuse,
  preservedMetadataDifferences: metadataDifferences,
  originalSnapshotSha256: createHash('sha256').update(snapshotBytes).digest('hex')
};

const bytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n');
fs.writeFileSync(new URL('完整候选.json', here), bytes);
const fileSha256 = createHash('sha256').update(bytes).digest('hex');
const planSha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const counts = Object.fromEntries(Object.keys(plan.skills[order[0]].write).map(kind => [kind, order.reduce((sum, skillKey) => sum + plan.skills[skillKey].write[kind].length, 0)]));
const report = { generatedAt: plan.meta.generatedAt, fileSha256, planSha256, skills: order.length, order, reusedParameters: reuse.length, preservedMetadataDifferences: metadataDifferences, counts, coverage, apiWrites: 0, source: 'client16.17/official16.17.1' };
fs.writeFileSync(new URL('候选版本.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ fileSha256, planSha256, skills: order.length, reusedParameters: reuse.length, counts, apiWrites: 0 }, null, 2));
