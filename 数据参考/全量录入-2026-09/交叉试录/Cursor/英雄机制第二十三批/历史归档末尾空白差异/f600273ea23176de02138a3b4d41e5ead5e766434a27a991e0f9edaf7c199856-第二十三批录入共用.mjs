import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repo = 'C:/project/damage_web_dev';
export const batchDir = path.join(repo, '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十三批');
export const inputDir = path.join(repo, '.agents/artifacts/hero23-cursor-entry-20260909');
export const revisionDir = path.dirname(fileURLToPath(import.meta.url));
export const apiRoot = 'http://127.0.0.1:8080/api/admin/games/lol';

export const expected = Object.freeze({
  candidateSha256: '772528a5abd0ec24285f4db64f7cb03b5c6415a106aa83fbb7ffe40b651d3358',
  planSha256: 'ba31f93dee47c0ce73128cb1d1e94283c74c00aae4a5d42791dbbfbff84c3169',
  sourceManifestSha256: '9ce4a9e55a1057d34906e8669750632af6ba234be7453cbd9e829bab22184e39',
  protectedStateSha256: '0a6e5be2f04ea0ebf4b6421223b27fe2215e9ff6bb2df0b80e4c2095054e152c',
  protectionSnapshotSha256: '74372b237e786367ccfbc0feaeb5e4bec0c0f35668915a5c9927f7f84fd2d417',
  sourceBindingSha256: '96aa039bb2e14a0f4ba5841f13a5a56c4ae3bc068e55023f904f396f19808b34',
  inputVersionSha256: '0ab4777628d9facd5f4e86745767157b63e2f0cec626cc07ba48b5194e5863d2',
  candidateParameterCount: 90,
  newParameterIntentCount: 81,
  reusedPublicParameterCount: 9,
  formulaCount: 22,
  effectCount: 6,
  postIntentCount: 109,
  protectedGETCount: 97,
});

export const skillKeys = Object.freeze([
  'amumu_p', 'amumu_q', 'amumu_w', 'amumu_e', 'amumu_r',
  'zac_p', 'zac_q', 'zac_w', 'zac_e', 'zac_r',
]);

export const kinds = Object.freeze([
  { kind: 'parameters', api: 'parameters', id: 'parameterKey' },
  { kind: 'formulas', api: 'formulas', id: 'formulaKey' },
  { kind: 'effects', api: 'effects', id: 'effectKey' },
  { kind: 'processes', api: 'processes', id: 'processKey' },
  { kind: 'internalStates', api: 'internal-states', id: 'stateKey' },
  { kind: 'triggerRules', api: 'trigger-rules', id: 'ruleKey' },
]);

const keyedArrays = Object.freeze({
  results: 'resultKey',
  steps: 'stepKey',
  effectBindings: 'bindingKey',
  stateOperations: 'operationKey',
  conditionGroups: 'groupKey',
  conditions: 'conditionKey',
  actions: 'actionKey',
});
const identityFields = new Set(['createdAt', 'updatedAt', 'gameId', 'skillKey']);

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const readBytes = file => fs.readFileSync(file);
export const hashFile = file => sha256(readBytes(file));
export const readJson = file => JSON.parse(readBytes(file));
export const clone = value => JSON.parse(JSON.stringify(value));
export const assert = (condition, message, detail) => {
  if (!condition) throw new Error(detail === undefined ? message : message + '：' + JSON.stringify(detail));
};

export function diff(expectedValue, actualValue, at = '') {
  if (Object.is(expectedValue, actualValue)) return null;
  if (expectedValue === null || actualValue === null ||
      typeof expectedValue !== 'object' || typeof actualValue !== 'object') {
    return { at, expected: expectedValue, actual: actualValue };
  }
  if (Array.isArray(expectedValue) || Array.isArray(actualValue)) {
    if (!Array.isArray(expectedValue) || !Array.isArray(actualValue) ||
        expectedValue.length !== actualValue.length) {
      return { at, expected: expectedValue, actual: actualValue };
    }
    for (let index = 0; index < expectedValue.length; index += 1) {
      const found = diff(expectedValue[index], actualValue[index], at + '[' + index + ']');
      if (found) return found;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(expectedValue), ...Object.keys(actualValue)])].sort();
  for (const key of keys) {
    if (!(key in expectedValue) || !(key in actualValue)) {
      return { at: at + '.' + key, expectedPresent: key in expectedValue, actualPresent: key in actualValue };
    }
    const found = diff(expectedValue[key], actualValue[key], at + '.' + key);
    if (found) return found;
  }
  return null;
}

function normalize(value, parentKey = '') {
  if (Array.isArray(value)) {
    const result = value.map(item => normalize(item, parentKey));
    const id = keyedArrays[parentKey];
    if (id && result.every(item => item && typeof item === 'object' && typeof item[id] === 'string')) {
      return result.toSorted((left, right) => String(left[id]).localeCompare(String(right[id])));
    }
    return result;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !identityFields.has(key))
      .map(([key, child]) => [key, normalize(child, key)]));
  }
  return value;
}

export const businessDiff = (expectedValue, actualValue) =>
  diff(normalize(expectedValue), normalize(actualValue));

export function collectionRoute(skillKey, kind) {
  const item = kinds.find(entry => entry.kind === kind);
  assert(item, '未知组成类型', kind);
  return '/skills/' + skillKey + '/' + item.api;
}

export function detailRoute(skillKey, kind, stableKey) {
  return collectionRoute(skillKey, kind) + '/' + encodeURIComponent(stableKey);
}

export function parseComponentRoute(route) {
  let match = route.match(/^\/skills\/(amumu_[pqwer]|zac_[pqwer])\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/);
  if (match) {
    const item = kinds.find(entry => entry.api === match[2]);
    return { skillKey: match[1], kind: item.kind, api: item.api, collection: true };
  }
  match = route.match(/^\/skills\/(amumu_[pqwer]|zac_[pqwer])\/(parameters|formulas|effects|processes|internal-states|trigger-rules)\/([^/?]+)$/);
  if (match) {
    const item = kinds.find(entry => entry.api === match[2]);
    return { skillKey: match[1], kind: item.kind, api: item.api, stableKey: decodeURIComponent(match[3]), collection: false };
  }
  return null;
}

export function loadFrozen() {
  const candidatePath = path.join(revisionDir, '完整候选.json');
  const planPath = path.join(revisionDir, '按顺序缺项POST意图计划.json');
  const sourcePath = path.join(revisionDir, '来源与范围.json');
  const versionPath = path.join(revisionDir, '候选版本.json');
  const statePath = path.join(revisionDir, '现值与保护摘要.json');
  const protectionPath = path.join(batchDir, '写前原始保护快照.json');
  const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
  const inputVersionPath = path.join(inputDir, '输入版本.json');
  const candidateBytes = readBytes(candidatePath);
  const planBytes = readBytes(planPath);
  const sourceBytes = readBytes(sourcePath);
  const stateBytes = readBytes(statePath);
  const protectionBytes = readBytes(protectionPath);
  const sourceBindingBytes = readBytes(sourceBindingPath);
  const inputVersionBytes = readBytes(inputVersionPath);
  assert(sha256(candidateBytes) === expected.candidateSha256, '候选文件散列变化', { actual: sha256(candidateBytes), expected: expected.candidateSha256 });
  assert(sha256(planBytes) === expected.planSha256, '请求计划散列变化', { actual: sha256(planBytes), expected: expected.planSha256 });
  assert(sha256(sourceBytes) === expected.sourceManifestSha256, '来源清单散列变化', { actual: sha256(sourceBytes), expected: expected.sourceManifestSha256 });
  assert(sha256(stateBytes) === expected.protectedStateSha256, '现值保护摘要散列变化', { actual: sha256(stateBytes), expected: expected.protectedStateSha256 });
  assert(sha256(protectionBytes) === expected.protectionSnapshotSha256, '完整保护快照散列变化', { actual: sha256(protectionBytes), expected: expected.protectionSnapshotSha256 });
  assert(sha256(sourceBindingBytes) === expected.sourceBindingSha256, '冻结来源绑定散列变化', { actual: sha256(sourceBindingBytes), expected: expected.sourceBindingSha256 });
  assert(sha256(inputVersionBytes) === expected.inputVersionSha256, '输入版本散列变化', { actual: sha256(inputVersionBytes), expected: expected.inputVersionSha256 });
  const candidate = JSON.parse(candidateBytes);
  const plan = JSON.parse(planBytes);
  const source = JSON.parse(sourceBytes);
  const version = JSON.parse(readBytes(versionPath));
  const protectedState = JSON.parse(stateBytes);
  const protection = JSON.parse(protectionBytes);
  const sourceBinding = JSON.parse(sourceBindingBytes);
  const inputVersion = JSON.parse(inputVersionBytes);
  assert(version.candidateSha256 === expected.candidateSha256 &&
    version.planSha256 === expected.planSha256 &&
    version.sourceManifestSha256 === expected.sourceManifestSha256 &&
    version.protectedStateSha256 === expected.protectedStateSha256, '版本登记与冻结文件不一致');
  assert(candidate.meta?.apiWrites === 0 && plan.apiWrites === 0, '冻结输入已经包含业务写入');
  assert(candidate.meta?.sourceBindingSha256 === expected.sourceBindingSha256, '候选来源绑定散列不一致');
  assert(candidate.meta?.protectionSnapshotGETs === expected.protectedGETCount, '候选保护读取数量不一致');
  assert(Array.isArray(plan.intents) && plan.count === expected.postIntentCount &&
    plan.intents.length === expected.postIntentCount, '请求意图数量不一致');
  assert(Array.isArray(protection.requests) && protection.requests.length === expected.protectedGETCount, '保护快照读取数量不一致');
  assert(inputVersion.apiWrites === 0 && inputVersion.GETs === expected.protectedGETCount, '输入版本含写入或读取数量漂移');
  return {
    paths: { candidatePath, planPath, sourcePath, versionPath, statePath, protectionPath, sourceBindingPath, inputVersionPath },
    hashes: {
      candidate: sha256(candidateBytes),
      plan: sha256(planBytes),
      sourceManifest: sha256(sourceBytes),
      protectedState: sha256(stateBytes),
      protectionSnapshot: sha256(protectionBytes),
      sourceBinding: sha256(sourceBindingBytes),
      inputVersion: sha256(inputVersionBytes),
    },
    candidate,
    plan,
    source,
    version,
    protectedState,
    protection,
    sourceBinding,
    inputVersion,
  };
}

function validateExpression(node, skillKey, formulaKey, parameterKeys, operations) {
  assert(node && typeof node === 'object', '公式节点缺失', { skillKey, formulaKey });
  if (node.nodeType === 'PARAMETER') {
    assert(typeof node.parameterKey === 'string' && parameterKeys.has(node.parameterKey),
      '公式引用未定义参数', { skillKey, formulaKey, parameterKey: node.parameterKey });
    return;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    assert(['SOURCE', 'TARGET'].includes(node.attributeOwner), '公式属性主体非法', { skillKey, formulaKey, node });
    assert(['TOTAL', 'BASE', 'BONUS'].includes(node.attributeValueKind), '公式属性值类型非法', { skillKey, formulaKey, node });
    assert(typeof node.attributeKey === 'string', '公式属性键缺失', { skillKey, formulaKey });
    return;
  }
  assert(node.nodeType === 'OPERATION' && Array.isArray(node.operands) &&
    node.operands.length === 2, '公式操作必须恰有两个操作数', { skillKey, formulaKey, node });
  assert(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation),
    '公式操作未审核运算', { skillKey, formulaKey, operation: node.operation });
  operations.push({ skillKey, formulaKey, operation: node.operation, operandCount: node.operands.length });
  for (const child of node.operands) validateExpression(child, skillKey, formulaKey, parameterKeys, operations);
}

export function validateFrozen(frozen) {
  const { candidate, plan } = frozen;
  const actualSkillKeys = Object.keys(candidate.skills ?? {});
  assert(JSON.stringify(actualSkillKeys) === JSON.stringify(skillKeys), '技能槽顺序或数量不符', actualSkillKeys);
  assert(Array.isArray(candidate.reusedPublicParameters) &&
    candidate.reusedPublicParameters.length === expected.reusedPublicParameterCount, '复用参数数量不符');
  const reusedSet = new Set(candidate.reusedPublicParameters.map(item => item.skillKey + '/' + item.parameterKey));
  assert(reusedSet.size === expected.reusedPublicParameterCount, '复用参数存在重复');
  const operationChecks = [];
  const intentKeys = new Set();
  let parameterCount = 0;
  let formulaCount = 0;
  let effectCount = 0;
  let reusedCount = 0;
  let newParameterIntents = 0;
  for (const skillKey of skillKeys) {
    const record = candidate.skills[skillKey];
    assert(record?.skillKey === skillKey, '技能记录键不一致', skillKey);
    for (const item of kinds) {
      const list = record.write?.[item.kind];
      assert(Array.isArray(list), '候选组成列表缺失', { skillKey, kind: item.kind });
      const ids = list.map(value => value[item.id]);
      assert(ids.every(value => typeof value === 'string') && new Set(ids).size === ids.length,
        '组成稳定键不合法或重复', { skillKey, kind: item.kind });
      if (item.kind === 'parameters') {
        parameterCount += list.length;
        for (const parameter of list) {
          if (parameter.valueMode === 'RUNTIME_INPUT') {
            assert(parameter.fixedValue === null && parameter.levelValues === null,
              '运行输入不允许默认值', { skillKey, parameterKey: parameter.parameterKey });
          }
          if (parameter.valueType === 'INTEGER') {
            if (parameter.valueMode === 'FIXED') assert(Number.isInteger(parameter.fixedValue), '整数固定值不是整数', { skillKey, parameter });
            if (parameter.valueMode === 'SKILL_LEVEL') {
              for (const [level, value] of Object.entries(parameter.levelValues ?? {})) {
                assert(Number.isInteger(value), '整数等级值不是整数', { skillKey, parameterKey: parameter.parameterKey, level, value });
              }
            }
          }
          if (reusedSet.has(skillKey + '/' + parameter.parameterKey)) reusedCount += 1;
        }
      }
      if (item.kind === 'formulas') {
        formulaCount += list.length;
        const parameterKeys = new Set(record.write.parameters.map(value => value.parameterKey));
        for (const formula of list) validateExpression(formula.expression, skillKey, formula.formulaKey, parameterKeys, operationChecks);
      }
      if (item.kind === 'effects') {
        effectCount += list.length;
        for (const effect of list) for (const result of effect.results ?? []) {
          assert(!['DAMAGE', 'DIRECT_HEAL', 'MOMENT_EVALUATION'].includes(result.resultType),
            '候选包含禁止结果类型', { skillKey, effectKey: effect.effectKey, resultType: result.resultType });
        }
      }
      if (['processes', 'internalStates', 'triggerRules'].includes(item.kind)) {
        assert(list.length === 0, '候选包含未授权运行结构', { skillKey, kind: item.kind });
      }
    }
    assert(record.write.parameters.length >= 0, '参数列表异常', skillKey);
  }
  assert(parameterCount === expected.candidateParameterCount, '候选参数总数不符', parameterCount);
  assert(formulaCount === expected.formulaCount, '候选公式总数不符', formulaCount);
  assert(effectCount === expected.effectCount, '候选效果总数不符', effectCount);
  assert(reusedCount === expected.reusedPublicParameterCount, '候选复用参数未逐项匹配', reusedCount);
  assert(candidate.postIntents && JSON.stringify(candidate.postIntents) === JSON.stringify(plan.intents),
    '候选请求意图与计划不一致');
  for (const intent of plan.intents) {
    const item = kinds.find(value => value.kind === intent.kind);
    assert(item && intent.method === 'POST' && intent.route === collectionRoute(intent.skillKey, intent.kind),
      '请求超出三类组成范围', intent);
    assert(intent.stableKey === intent.body?.[item.id], '请求稳定键与载荷不一致', intent);
    assert(!intentKeys.has(intent.skillKey + '/' + intent.kind + '/' + intent.stableKey),
      '请求意图重复', intent);
    intentKeys.add(intent.skillKey + '/' + intent.kind + '/' + intent.stableKey);
    if (intent.kind === 'parameters' && !reusedSet.has(intent.skillKey + '/' + intent.stableKey)) newParameterIntents += 1;
  }
  assert(newParameterIntents === expected.newParameterIntentCount, '新增参数意图数量不符', newParameterIntents);
  assert(plan.intents.length === expected.postIntentCount, '计划请求数量不符');
  assert(operationChecks.length > 0 && operationChecks.every(value => value.operandCount === 2), '公式二元结构检查失败');
  return {
    skills: skillKeys.length,
    parameterCount,
    newParameterIntents,
    reusedPublicParameters: reusedCount,
    formulaCount,
    effectCount,
    postIntents: plan.intents.length,
    binaryOperationCount: operationChecks.length,
    operationChecks,
  };
}

function checkRoute(route) {
  assert(typeof route === 'string' && route.startsWith('/') &&
    !route.includes('://') && !route.includes('..') && !route.includes('#'),
    '接口路径不安全', route);
}

export function appendDurable(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const descriptor = fs.openSync(file, 'a');
  try {
    fs.writeSync(descriptor, JSON.stringify(value) + '\n', undefined, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, file);
}

export function createRequester({ allowPost = false, journalPath = null } = {}) {
  const events = [];
  let sequence = 0;
  const token = process.env.HERO23_API_TOKEN || process.env.GEAR23_API_TOKEN || 'local-entry';
  const request = async (route, { method = 'GET', body = undefined, phase = '读取' } = {}) => {
    checkRoute(route);
    assert(method === 'GET' || method === 'POST', '只允许读取或计划新增', method);
    if (method === 'POST') {
      assert(allowPost, '当前只读；没有业务写入授权');
      assert(/^\/skills\/(?:amumu|zac)_[pqwer]\/(?:parameters|formulas|effects)$/.test(route),
        'POST超出本批三类技能组成范围', route);
    }
    const id = ++sequence;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const beginning = { id, at: startedAt, phase: '请求开始', method, route, ...(body === undefined ? {} : { body }) };
    if (journalPath) appendDurable(journalPath, beginning);
    let result;
    try {
      const response = await fetch(apiRoot + route, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(method === 'POST' ? 20000 : 15000),
      });
      const raw = await response.text();
      let data = null;
      let parseError = false;
      try { data = raw === '' ? null : JSON.parse(raw); } catch { parseError = true; }
      result = {
        id,
        at: new Date().toISOString(),
        phase,
        method,
        route,
        status: response.status,
        ok: response.ok && !parseError,
        elapsedMs: Date.now() - started,
        ...(parseError
          ? { parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: sha256(raw) }
          : { data }),
      };
    } catch (error) {
      result = {
        id,
        at: new Date().toISOString(),
        phase,
        method,
        route,
        status: null,
        ok: false,
        elapsedMs: Date.now() - started,
        error: error.name + ': ' + error.message,
      };
    }
    events.push(result);
    if (journalPath) appendDurable(journalPath, { ...result, phase: '请求结束' });
    return result;
  };
  return { request, events };
}

export async function checkProtected(protection, request) {
  const checks = [];
  for (const old of protection.requests) {
    const current = await request(old.route, { method: 'GET', phase: '保护读取' });
    const mismatch = current.status !== old.status
      ? { status: { expected: old.status, actual: current.status } }
      : diff(old.data, current.data);
    checks.push({
      route: old.route,
      expectedStatus: old.status,
      actualStatus: current.status,
      match: mismatch === null,
      diff: mismatch,
    });
  }
  return {
    planned: protection.requests.length,
    actual: checks.length,
    matched: checks.filter(value => value.match).length,
    conflicts: checks.filter(value => !value.match && value.actualStatus !== null && value.actualStatus === value.expectedStatus).length,
    errors: checks.filter(value => !value.match && (value.actualStatus === null || value.actualStatus !== value.expectedStatus)).length,
    checks,
  };
}

export async function checkPlannedTargets(plan, request) {
  const checks = [];
  for (const intent of plan.intents) {
    const item = kinds.find(value => value.kind === intent.kind);
    const route = detailRoute(intent.skillKey, intent.kind, intent.stableKey);
    const current = await request(route, { method: 'GET', phase: '新增目标读取' });
    let state = 'ERROR';
    let mismatch = null;
    if (current.status === 404) state = 'MISSING';
    else if (current.status === 200) {
      mismatch = businessDiff(intent.body, current.data);
      state = mismatch === null ? 'SAME' : 'CONFLICT';
    }
    checks.push({
      skillKey: intent.skillKey,
      kind: intent.kind,
      stableKey: intent.stableKey,
      idField: item.id,
      collectionRoute: intent.route,
      route,
      status: current.status,
      state,
      diff: mismatch,
    });
  }
  return {
    planned: checks.length,
    missing: checks.filter(value => value.state === 'MISSING').length,
    same: checks.filter(value => value.state === 'SAME').length,
    conflicts: checks.filter(value => value.state === 'CONFLICT').length,
    errors: checks.filter(value => value.state === 'ERROR').length,
    checks,
  };
}

export function protectedListRoutes(protection) {
  return protection.requests.filter(value => parseComponentRoute(value.route)?.collection);
}

export function targetMap(plan) {
  const map = new Map();
  for (const intent of plan.intents) map.set(intent.skillKey + '/' + intent.kind + '/' + intent.stableKey, intent);
  return map;
}
