import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 只从冻结候选生成请求意图；本脚本不访问接口，也不发业务请求。
const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesOf = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(bytesOf(name));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const candidateFile = '完整候选.json';
const candidateVersionFile = '候选版本.json';
const snapshotFile = '写前现值.json';
const expectedCandidateSha256 = '82909b66781b24fba50b7777cc01d7a511479eb0bb20e25a340b789014c3cf8b';
const order = ['nunu', 'sejuani', 'sion', 'volibear'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const writableKinds = new Set(['parameters', 'formulas', 'effects']);
const allowedNodeTypes = new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']);
const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
const immutable = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const failures = [];
const fail = message => failures.push(message);

const candidateBytes = bytesOf(candidateFile);
const candidate = JSON.parse(candidateBytes);
const versionBytes = bytesOf(candidateVersionFile);
const version = JSON.parse(versionBytes);
const snapshotBytes = bytesOf(snapshotFile);
const snapshot = JSON.parse(snapshotBytes);
if (sha256(candidateBytes) !== expectedCandidateSha256) fail(`候选散列变化：${sha256(candidateBytes)}`);
if (!equal(Object.keys(candidate.skills ?? {}), order)) fail('候选技能位不是固定20项');
if (snapshot.summary?.errorCount !== 0 || snapshot.summary?.requestCount !== 173 || snapshot.summary?.compositionCount !== 29 || snapshot.summary?.detailCount !== 29) fail('写前现值不是173请求、29组成、29详情、0失败');

const reuse = new Set((candidate.meta?.reuseReport?.publicParameters ?? []).map(item => `${item.skillKey}/${item.parameterKey}`));
if (reuse.size !== 29) fail(`复用参数数目不是29：${reuse.size}`);
const entries = [];
const candidateKeys = new Set();
const sourceHashNames = [
  candidateFile,
  candidateVersionFile,
  snapshotFile,
  '根绑定与数值证据.json',
  '补充文本证据.json',
  '来源冻结/来源与哈希汇总.json',
  '来源冻结/主技能数值展开.json',
  '来源冻结/主技能原始展开.json',
  '候选.mjs',
  '英雄组成.mjs',
  '生成候选.mjs',
  '独立数学核对.mjs',
  '独立数学核对.json',
];

function walk(node, at, parameterKeys) {
  if (!node || typeof node !== 'object') { fail(`公式节点为空：${at}`); return; }
  if (!allowedNodeTypes.has(node.nodeType)) { fail(`公式节点类型非法：${at}/${node.nodeType}`); return; }
  if (node.nodeType === 'PARAMETER' && (!node.parameterKey || !parameterKeys.has(node.parameterKey))) fail(`公式引用未定义参数：${at}`);
  if (node.nodeType === 'ATTRIBUTE') {
    if (!['SOURCE', 'TARGET'].includes(node.attributeOwner)) fail(`公式属性归属非法：${at}`);
    if (!['TOTAL', 'BASE', 'BONUS'].includes(node.attributeValueKind)) fail(`公式属性值类非法：${at}`);
  }
  if (node.nodeType === 'OPERATION') {
    if (!allowedOperations.has(node.operation) || !Array.isArray(node.operands) || node.operands.length !== 2) fail(`公式必须是允许的二元运算：${at}`);
    for (const [index, child] of (node.operands ?? []).entries()) walk(child, `${at}.operands[${index}]`, parameterKeys);
  }
}

function walkAny(value, callback, at = '$') {
  if (!value || typeof value !== 'object') return;
  callback(value, at);
  for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') walkAny(child, callback, `${at}.${key}`);
}

for (const skillKey of order) {
  const skill = candidate.skills?.[skillKey];
  if (!skill) { fail(`缺少技能位：${skillKey}`); continue; }
  for (const [kind, idField, endpoint] of kinds) {
    const rows = skill.write?.[kind];
    if (!Array.isArray(rows)) { fail(`组成不是数组：${skillKey}/${kind}`); continue; }
    if (!writableKinds.has(kind) && rows.length) fail(`本批不应写入${skillKey}/${kind}`);
    for (const body of rows) {
      const stableKey = body?.[idField];
      if (typeof stableKey !== 'string' || !stableKey) { fail(`缺少稳定键：${skillKey}/${kind}`); continue; }
      const key = `${skillKey}/${kind}/${stableKey}`;
      if (candidateKeys.has(key)) fail(`候选键重复：${key}`);
      candidateKeys.add(key);
      if (kind === 'parameters') {
        if (body.valueType === 'INTEGER') {
          const values = body.valueMode === 'FIXED' ? [body.fixedValue] : body.valueMode === 'SKILL_LEVEL' ? Object.values(body.levelValues ?? {}) : [];
          if (values.some(value => !Number.isInteger(Number(value)))) fail(`整数参数含非整数：${key}`);
          if (stableKey.endsWith('_ms') && values.some(value => Number(value) < 0)) fail(`毫秒参数含负数：${key}`);
        }
      }
      if (kind === 'formulas') walk(body.expression, `${key}.expression`, new Set((skill.write.parameters ?? []).map(item => item.parameterKey)));
      if (kind === 'effects') walkAny(body, (node, at) => {
        if (node.resultType === 'DAMAGE' || node.resultType === 'DIRECT_HEAL') fail(`效果含禁止结果：${key}${at}`);
        if (node.moment === 'MOMENT_EVALUATION' || node.valueMode === 'RUNTIME_INPUT' || node.mode === 'RUNTIME_INPUT') fail(`效果间接含运行输入或瞬时求值：${key}${at}`);
      });
      if (writableKinds.has(kind) && !(kind === 'parameters' && reuse.has(`${skillKey}/${stableKey}`))) entries.push({ sequence: entries.length + 1, method: 'POST', skillKey, kind, stableKey, route: `/skills/${encodeURIComponent(skillKey)}/${endpoint}`, detailRoute: `/skills/${encodeURIComponent(skillKey)}/${endpoint}/${encodeURIComponent(stableKey)}`, body, bodySha256: sha256(jsonBytes(body)) });
    }
  }
  const existing = snapshot.skills?.[skillKey]?.components?.parameters?.items ?? [];
  for (const row of existing) {
    const key = `${skillKey}/${row.parameterKey}`;
    if (!reuse.has(key)) fail(`现有参数未列入复用清单：${key}`);
    const candidateParameter = skill.write.parameters.find(item => item.parameterKey === row.parameterKey);
    for (const field of ['valueType', 'valueMode', 'fixedValue', 'levelValues']) if (!candidateParameter || !equal(candidateParameter[field], row[field])) fail(`复用参数值不一致：${key}/${field}`);
  }
}

const candidateCounts = Object.fromEntries(kinds.map(([kind]) => [kind, order.reduce((sum, skillKey) => sum + (candidate.skills?.[skillKey]?.write?.[kind]?.length ?? 0), 0)]));
const newCounts = Object.fromEntries(kinds.map(([kind]) => [kind, entries.filter(item => item.kind === kind).length]));
if (!equal(candidateCounts, { parameters: 229, formulas: 38, effects: 19, processes: 0, internalStates: 0, triggerRules: 0 })) fail(`候选计数不符：${JSON.stringify(candidateCounts)}`);
if (!equal(newCounts, { parameters: 200, formulas: 38, effects: 19, processes: 0, internalStates: 0, triggerRules: 0 })) fail(`新增计数不符：${JSON.stringify(newCounts)}`);
if (entries.length !== 257) fail(`POST意图应为257条：${entries.length}`);
if (failures.length) throw Error(failures.join('\n'));

const sourceHashes = Object.fromEntries(sourceHashNames.map(name => [name, sha256(bytesOf(name))]));
const plan = {
  schemaVersion: 1,
  mode: '第二十四批受保护写入请求意图；默认只读，未发送业务请求',
  gameId: 'lol',
  apiBase: 'http://127.0.0.1:8080/api/admin/games/lol',
  sourceVersion: 'client16.17/official16.17.1',
  candidateSha256: sha256(candidateBytes),
  candidateVersionSha256: sha256(versionBytes),
  candidateInternalPlanSha256: version.planSha256,
  snapshotSha256: sha256(snapshotBytes),
  sourceHashes,
  skills: order,
  reuseParameters: [...reuse].sort().map(key => { const [skillKey, parameterKey] = key.split('/'); return { skillKey, parameterKey }; }),
  candidateCounts,
  newCounts,
  plannedPostCount: entries.length,
  policy: {
    parameterPosts: '只发送不在29项复用清单中的200项参数；复用参数只做完整字段保护，不发送更新。',
    formulaPosts: '发送38项公式；OPERATION必须为允许的二元运算。',
    effectPosts: '发送19项效果；不发送过程、内部状态、触发规则。',
    protected: '技能主体、目录、既有参数、公式、效果、过程、内部状态、触发规则和其它现值均不更新；逐项POST后立即GET确认，未知响应停止。',
  },
  requests: entries,
};
const planPath = path.join(here, '写入请求计划.json');
if (fs.existsSync(planPath)) throw Error('写入请求计划.json已存在，拒绝覆盖');
fs.writeFileSync(planPath, jsonBytes(plan), { flag: 'wx' });
console.log(JSON.stringify({ file: '写入请求计划.json', sha256: sha256(jsonBytes(plan)), candidateSha256: plan.candidateSha256, candidateVersionSha256: plan.candidateVersionSha256, candidateInternalPlanSha256: plan.candidateInternalPlanSha256, candidateCounts, newCounts, reusedParameters: reuse.size, plannedPostCount: entries.length, apiWrites: 0 }, null, 2));
