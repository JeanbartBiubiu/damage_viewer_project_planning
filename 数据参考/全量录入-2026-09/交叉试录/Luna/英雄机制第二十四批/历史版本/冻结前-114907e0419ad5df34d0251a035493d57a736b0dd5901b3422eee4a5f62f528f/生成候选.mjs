import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';

const here = new URL('./', import.meta.url);
if (fs.existsSync(new URL('冻结候选锁.json', here))) throw Error('本批已有冻结锁，禁止覆盖候选。');

import { plan } from './候选.mjs';
import './英雄组成.mjs';

const snapshotBytes = fs.readFileSync(new URL('写前现值.json', here));
const snapshot = JSON.parse(snapshotBytes);
const order = ['nunu', 'sejuani', 'sion', 'volibear'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => hero + '_' + slot));
if (!equal(Object.keys(plan.skills), order)) throw Error('候选必须精确覆盖20个固定技能位');
if (snapshot.summary?.errorCount !== 0 || snapshot.summary?.requestCount !== 173 || snapshot.summary?.compositionCount !== 29 || snapshot.summary?.detailCount !== 29) {
  throw Error('写前GET证据不是173请求、29组成、29详情、0失败，禁止生成候选。');
}

const immutable = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const reuse = [];
const metadataDifferences = [];
const coverage = [];
const allowedAttrs = new Set(['ability_power', 'attack_damage', 'hp', 'armor', 'magic_resistance']);
const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);

function walk(value, callback, path = '$') {
  if (!value || typeof value !== 'object') return;
  callback(value, path);
  for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') walk(child, callback, path + '.' + key);
}

function validateExpression(expression, path, parameterKeys) {
  walk(expression, (node, at) => {
    if (!node.nodeType) return;
    if (!['PARAMETER', 'ATTRIBUTE', 'OPERATION'].includes(node.nodeType)) throw Error('公式出现非法节点 ' + path + at);
    if (node.nodeType === 'PARAMETER' && !parameterKeys.has(node.parameterKey)) throw Error('公式引用未定义参数 ' + path + at);
    if (node.nodeType === 'ATTRIBUTE' && !allowedAttrs.has(node.attributeKey)) throw Error('公式属性不在本批窄口径内 ' + path + at);
    if (node.nodeType === 'OPERATION') {
      if (!allowedOperations.has(node.operation)) throw Error('公式运算不受支持 ' + path + at);
      if (!Array.isArray(node.operands) || node.operands.length !== 2) throw Error('公式必须使用二元运算 ' + path + at);
    }
  });
}

function assertNonNegativeTime(candidate) {
  for (const parameter of candidate.write.parameters) {
    if (!parameter.parameterKey.endsWith('_ms')) continue;
    if (parameter.valueType !== 'INTEGER') throw Error('毫秒参数必须为整数类型 ' + candidate.skillKey + '/' + parameter.parameterKey);
    const values = parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : [];
    if (values.some(value => Number(value) < 0 || !Number.isInteger(Number(value)))) throw Error('毫秒参数必须为非负整数 ' + candidate.skillKey + '/' + parameter.parameterKey);
  }
}

for (const skillKey of order) {
  const candidate = plan.skills[skillKey];
  const old = snapshot.skills[skillKey];
  if (!old || old.subject?.status !== 200) throw Error('缺写前技能主体 ' + skillKey);
  for (const [kind, value] of Object.entries(old.components ?? {})) {
    if (kind !== 'parameters' && value.items.length) throw Error('已有非参数组成，不能推空 ' + skillKey + '/' + kind);
  }

  for (const oldParam of old.components.parameters.items) {
    const body = Object.fromEntries(Object.entries(oldParam).filter(([field]) => !immutable.has(field)));
    const index = candidate.write.parameters.findIndex(value => value.parameterKey === oldParam.parameterKey);
    if (index >= 0) {
      const current = candidate.write.parameters[index];
      for (const field of ['valueType', 'valueMode', 'fixedValue', 'levelValues']) if (!equal(current[field], oldParam[field])) throw Error('已有参数数值不一致 ' + skillKey + '/' + oldParam.parameterKey + '/' + field);
      const fields = Object.keys(body).filter(field => !equal(body[field], current[field]));
      if (fields.length) metadataDifferences.push({ skillKey, parameterKey: oldParam.parameterKey, fields, policy: '完整复用原公共参数，不发更新请求' });
      candidate.write.parameters[index] = body;
    } else {
      candidate.write.parameters.unshift(body);
    }
    reuse.push({ skillKey, parameterKey: oldParam.parameterKey });
  }

  const parameterKeys = new Set(candidate.write.parameters.map(item => item.parameterKey));
  if (parameterKeys.size !== candidate.write.parameters.length) throw Error('候选参数键重复 ' + skillKey);
  for (const formula of candidate.write.formulas) validateExpression(formula.expression, skillKey + '/' + formula.formulaKey, parameterKeys);
  for (const effect of candidate.write.effects) {
    if (effect.lifecycle?.moment === 'MOMENT_EVALUATION') throw Error('效果使用禁止的MOMENT_EVALUATION ' + skillKey + '/' + effect.effectKey);
    walk(effect, (node, at) => {
      if (node.valueMode === 'RUNTIME_INPUT' || node.mode === 'RUNTIME_INPUT') throw Error('效果间接引用RUNTIME_INPUT ' + skillKey + '/' + effect.effectKey + at);
      if (node.resultType === 'DAMAGE' || node.resultType === 'DIRECT_HEAL') throw Error('本批禁止即时伤害或治疗效果 ' + skillKey + '/' + effect.effectKey);
    });
  }
  for (const [kind, rows] of Object.entries(candidate.write)) {
    const keys = new Set();
    for (const row of rows) {
      const key = row.parameterKey ?? row.formulaKey ?? row.effectKey ?? row.processKey ?? row.stateKey ?? row.ruleKey;
      if (!key) throw Error('组成缺稳定键 ' + skillKey + '/' + kind);
      if (keys.has(key)) throw Error('组成重复键 ' + skillKey + '/' + kind + '/' + key);
      keys.add(key);
    }
  }
  assertNonNegativeTime(candidate);
  candidate.reusedParameters = reuse.filter(item => item.skillKey === skillKey).map(item => item.parameterKey);
  candidate.disposition = {
    范围外: candidate.excluded,
    来源待核: candidate.pending.filter(item => item.kind === '来源'),
    系统缺口: candidate.pending.filter(item => item.kind === '系统'),
    尚未接线: candidate.pending.filter(item => !['来源', '系统'].includes(item.kind))
  };
  candidate.status = '确定组成候选；未保存、未接线和范围外分支不表示完整战斗机制';
  coverage.push({ skillKey, parameters: candidate.write.parameters.length, formulas: candidate.write.formulas.length, effects: candidate.write.effects.length, processes: candidate.write.processes.length, internalStates: candidate.write.internalStates.length, triggerRules: candidate.write.triggerRules.length, pending: candidate.pending.length, excluded: candidate.excluded.length });
}

plan.meta.generatedAt = new Date().toISOString();
plan.meta.apiWrites = 0;
plan.meta.reuseReport = {
  publicParameters: reuse,
  preservedMetadataDifferences: metadataDifferences,
  originalSnapshotSha256: createHash('sha256').update(snapshotBytes).digest('hex')
};

const bytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n');
fs.writeFileSync(new URL('完整候选.json', here), bytes);
const fileSha256 = createHash('sha256').update(bytes).digest('hex');
const planSha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const kinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
const counts = Object.fromEntries(kinds.map(kind => [kind, order.reduce((sum, skillKey) => sum + plan.skills[skillKey].write[kind].length, 0)]));
const report = { generatedAt: plan.meta.generatedAt, fileSha256, planSha256, skills: order.length, order, reusedParameters: reuse.length, preservedMetadataDifferences: metadataDifferences, counts, coverage, apiWrites: 0, source: 'client16.17/official16.17.1', snapshotSha256: plan.meta.reuseReport.originalSnapshotSha256 };
fs.writeFileSync(new URL('候选版本.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ fileSha256, planSha256, skills: order.length, reusedParameters: reuse.length, counts, apiWrites: 0 }, null, 2));

