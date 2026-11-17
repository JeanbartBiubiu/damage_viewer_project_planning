#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const COLLECTIONS = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey',
  processes: 'processKey', internalStates: 'stateKey', triggerRules: 'ruleKey' };
const CHANGE_COLLECTIONS = { PARAMETER: 'parameters', FORMULA: 'formulas', EFFECT: 'effects',
  PROCESS: 'processes', INTERNAL_STATE: 'internalStates', TRIGGER_RULE: 'triggerRules' };
const TIMES = ['createdAt', 'updatedAt'];
const RULE_FIELDS = ['name', 'description', 'sortOrder', 'eventSource', 'conditionGroups', 'actions',
  'perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse'];
const COMMON = ['gameId', 'skillKey', 'name', 'description', 'sortOrder'];
const SKILL_WRITE_FIELDS = ['name', 'description', 'maxLevel', 'status', 'sortOrder', 'skillCategoryKeys'];
const ROW_FIELDS = {
  parameters: [...COMMON, 'parameterKey', 'valueType', 'valueMode', 'fixedValue', 'levelValues'],
  formulas: [...COMMON, 'formulaKey', 'expression'],
  effects: [...COMMON, 'effectKey', 'lifecycle', 'results'],
  processes: [...COMMON, 'processKey', 'activationType', 'cooldown', 'steps', 'effectBindings', 'stateOperations'],
  internalStates: [...COMMON, 'stateKey', 'stateType', 'scope', 'detail'],
  triggerRules: ['ruleKey', ...RULE_FIELDS]
};
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (where, reason) => { throw new Error(`${where}: ${reason}`); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function object(value, required, where, optional = []) {
  if (!isObject(value)) fail(where, '必须是完整对象');
  for (const key of required) if (!own(value, key)) fail(`${where}.${key}`, '缺少字段');
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) fail(`${where}.${key}`, '未知字段');
  return value;
}
function string(value, where) {
  if (typeof value !== 'string' || !value.trim()) fail(where, '必须是非空字符串');
  return value;
}
function stableKey(value, where) {
  if (typeof value !== 'string' || !KEY.test(value)) fail(where, '需要合法稳定标识');
  return value;
}
function digest(value, where) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(where, '需要64位SHA256');
  return value;
}
function array(value, where) {
  if (!Array.isArray(value)) fail(where, '必须是数组');
  return value;
}
function json(value, where, depth = 0) {
  if (depth > 128) fail(where, 'JSON嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach((item, index) => json(item, `${where}[${index}]`, depth + 1)); return; }
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(where, '不是普通JSON值');
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(where, '包含不允许的对象属性');
    json(item, `${where}.${key}`, depth + 1);
  }
}
function namedRows(rows, key, where) {
  const seen = new Set();
  for (const [index, row] of array(rows, where).entries()) {
    if (!isObject(row)) fail(`${where}[${index}]`, '必须是对象');
    stableKey(row[key], `${where}[${index}].${key}`);
    if (seen.has(row[key])) fail(where, `重复${key}`);
    seen.add(row[key]);
  }
}
function rule(value, where, includeKey) {
  object(value, includeKey ? ['ruleKey', ...RULE_FIELDS] : RULE_FIELDS, where, includeKey ? TIMES : []);
  if (includeKey) stableKey(value.ruleKey, `${where}.ruleKey`);
  string(value.name, `${where}.name`);
  if (value.description !== null && typeof value.description !== 'string') fail(`${where}.description`, '需要字符串或null');
  if (!Number.isSafeInteger(value.sortOrder) || value.sortOrder < 0 || value.sortOrder > 999999) fail(`${where}.sortOrder`, '需要0～999999整数');
  object(value.eventSource, ['eventType', 'detail'], `${where}.eventSource`);
  string(value.eventSource.eventType, `${where}.eventSource.eventType`);
  if (!isObject(value.eventSource.detail)) fail(`${where}.eventSource.detail`, '必须是对象');
  namedRows(value.conditionGroups, 'groupKey', `${where}.conditionGroups`);
  for (const [index, group] of value.conditionGroups.entries()) {
    object(group, ['groupKey', 'name', 'sortOrder', 'conditions'], `${where}.conditionGroups[${index}]`);
    namedRows(group.conditions, 'conditionKey', `${where}.conditionGroups[${index}].conditions`);
  }
  namedRows(value.actions, 'actionKey', `${where}.actions`);
  if (!value.actions.length) fail(`${where}.actions`, '至少需要一个动作');
  for (const [index, action] of value.actions.entries()) {
    const actionPath = `${where}.actions[${index}]`;
    object(action, ['actionKey', 'name', 'actionType', 'detail', 'sortOrder', 'targetContext', 'runtimeInputBindings', 'resultModifiers'], actionPath);
    if (!isObject(action.detail)) fail(`${actionPath}.detail`, '必须是对象');
    array(action.runtimeInputBindings, `${actionPath}.runtimeInputBindings`);
    array(action.resultModifiers, `${actionPath}.resultModifiers`);
  }
  for (const field of ['perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse']) {
    if (value[field] !== null && !isObject(value[field])) fail(`${where}.${field}`, '需要对象或null');
  }
}

/** 只检查完整聚合读取的结构；业务细则仍由现行后端校验，不在脚本补默认值。 */
export function validateConfiguration(value, gameId, skillKey, where = 'configuration') {
  json(value, where);
  object(value, ['skill', ...Object.keys(COLLECTIONS), 'baseDigest'], where);
  digest(value.baseDigest, `${where}.baseDigest`);
  object(value.skill, [...COMMON, 'maxLevel', 'status', 'skillCategoryKeys'], `${where}.skill`, TIMES);
  if (value.skill.gameId !== gameId || value.skill.skillKey !== skillKey) fail(`${where}.skill`, '游戏或技能身份不符');
  string(value.skill.name, `${where}.skill.name`);
  if (!Number.isSafeInteger(value.skill.maxLevel) || value.skill.maxLevel < 1) fail(`${where}.skill.maxLevel`, '需要正整数');
  if (!['ENABLED', 'DISABLED'].includes(value.skill.status)) fail(`${where}.skill.status`, '非法状态');
  array(value.skill.skillCategoryKeys, `${where}.skill.skillCategoryKeys`).forEach(key => stableKey(key, `${where}.skill.skillCategoryKeys`));
  for (const [collection, key] of Object.entries(COLLECTIONS)) {
    namedRows(value[collection], key, `${where}.${collection}`);
    for (const [index, row] of value[collection].entries()) {
      const rowPath = `${where}.${collection}[${index}]`;
      object(row, ROW_FIELDS[collection], rowPath, TIMES);
      if (collection === 'triggerRules') { rule(row, rowPath, true); continue; }
      if (row.gameId !== gameId || row.skillKey !== skillKey) fail(rowPath, '组成身份不符');
      for (const field of ({ effects: ['results'], processes: ['steps', 'effectBindings', 'stateOperations'] }[collection] ?? [])) array(row[field], `${rowPath}.${field}`);
      if (collection === 'effects') for (const [resultIndex, result] of row.results.entries()) {
        if (!isObject(result?.detail)) continue;
        if (own(result.detail, 'attackDamageRole')) {
          const rolePath = `${rowPath}.results[${resultIndex}].detail.attackDamageRole`;
          if (result.resultType !== 'DAMAGE' || !['PRIMARY', 'REPLACE_PRIMARY'].includes(result.detail.attackDamageRole)) {
            fail(rolePath, '普攻伤害角色仅允许伤害结果的PRIMARY或REPLACE_PRIMARY；普通伤害省略字段');
          }
        }
        if (own(result.detail, 'spellShieldFollowResult')) {
          const followPath = `${rowPath}.results[${resultIndex}].detail.spellShieldFollowResult`;
          const follow = object(result.detail.spellShieldFollowResult, ['skillKey', 'effectKey', 'resultKey'], followPath);
          for (const key of ['skillKey', 'effectKey', 'resultKey']) stableKey(follow[key], `${followPath}.${key}`);
          if (result.resultType !== 'DAMAGE' || result.target !== 'TARGET' || result.lifecycleBehavior !== null
            || result.spellShieldBlockScope !== null || own(result.detail, 'attackDamageRole')) {
            fail(followPath, '跟随只允许自身不判盾、非主体的即时目标伤害');
          }
        }
      }
      if (collection === 'formulas' && !isObject(row.expression)) fail(`${rowPath}.expression`, '必须是完整公式对象');
    }
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
const canonicalText = value => JSON.stringify(canonical(value));
/** 响应摘要、实体服务时间及两类明确可空过程字段按现行读写契约比较。 */
export function businessConfiguration(value) {
  const result = clone(value);
  delete result.baseDigest;
  for (const time of TIMES) delete result.skill[time];
  for (const collection of Object.keys(COLLECTIONS)) for (const row of result[collection]) for (const time of TIMES) delete row[time];
  // 只在真实 DTO 路径规范空值；不对任意业务 JSON 省略空字段。
  for (const processRow of result.processes) {
    // SkillProcessStepRequestDeserializer 将省略与 null 都读成 Boolean null，响应保留 null。
    for (const step of processRow.steps ?? []) if (isObject(step) && step.occupiesAction === null) delete step.occupiesAction;
    // SkillProcessMoment 对 null 失败原因使用 NON_NULL。
    const moments = [processRow.cooldown?.startMoment,
      ...(processRow.effectBindings ?? []).map(binding => binding.moment),
      ...(processRow.stateOperations ?? []).map(operation => operation.moment)];
    for (const moment of moments) if (isObject(moment) && moment.failureReason === null) delete moment.failureReason;
  }
  // PROCESS_MOMENT 事件明细复用同一个 SkillProcessMoment DTO，仅此明确路径同样省略 null。
  for (const rule of result.triggerRules) if (rule.eventSource?.eventType === 'PROCESS_MOMENT') {
    const moment = rule.eventSource.detail?.moment;
    if (isObject(moment) && moment.failureReason === null) delete moment.failureReason;
  }
  return result;
}
export function sameConfiguration(first, second) {
  return canonicalText(businessConfiguration(first)) === canonicalText(businessConfiguration(second));
}

export function validatePlan(plan) {
  json(plan, 'plan');
  object(plan, ['schemaVersion', 'gameId', 'items'], 'plan');
  if (plan.schemaVersion !== 'skill-configuration-plan-v1') fail('plan.schemaVersion', '不支持的计划版本');
  stableKey(plan.gameId, 'plan.gameId');
  if (!array(plan.items, 'plan.items').length) fail('plan.items', '至少一个技能');
  const skills = new Set();
  for (const [index, item] of plan.items.entries()) {
    const where = `plan.items[${index}]`;
    object(item, ['skillKey', 'before', 'expected', 'request', 'sourceEvidence'], where);
    stableKey(item.skillKey, `${where}.skillKey`);
    if (skills.has(item.skillKey)) fail(where, '技能重复');
    skills.add(item.skillKey);
    validateConfiguration(item.before, plan.gameId, item.skillKey, `${where}.before`);
    validateConfiguration(item.expected, plan.gameId, item.skillKey, `${where}.expected`);
    object(item.request, ['baseDigest', 'changes'], `${where}.request`, ['skill']);
    if (item.request.baseDigest !== item.before.baseDigest) fail(`${where}.request.baseDigest`, '不等于冻结基线摘要');
    const changes = array(item.request.changes, `${where}.request.changes`);
    const projected = clone(item.before);
    if (own(item.request, 'skill')) {
      object(item.request.skill, SKILL_WRITE_FIELDS, `${where}.request.skill`);
      Object.assign(projected.skill, clone(item.request.skill));
      validateConfiguration(projected, plan.gameId, item.skillKey, `${where}.request.skillProjection`);
      if (canonicalText(projected.skill) === canonicalText(item.before.skill)) fail(`${where}.request.skill`, '未改变主体业务字段');
    } else if (!changes.length) fail(`${where}.request.changes`, '没有变更');
    const changedObjects = new Set();
    for (const [changeIndex, change] of changes.entries()) {
      const changePath = `${where}.request.changes[${changeIndex}]`;
      object(change, ['objectType', 'operation', 'key', 'value'], changePath);
      const collection = own(CHANGE_COLLECTIONS, change.objectType) ? CHANGE_COLLECTIONS[change.objectType] : null;
      if (!collection || !['CREATE', 'UPDATE', 'DELETE'].includes(change.operation)) fail(changePath, '仅允许六种技能组成的CREATE、UPDATE或DELETE');
      stableKey(change.key, `${changePath}.key`);
      const identity = `${change.objectType}/${change.key}`;
      if (changedObjects.has(identity)) fail(changePath, '同一对象重复');
      changedObjects.add(identity);
      const keyField = COLLECTIONS[collection];
      const creating = change.operation === 'CREATE';
      const position = projected[collection].findIndex(row => row[keyField] === change.key);
      if (creating && position >= 0) fail(`${changePath}.key`, '新增对象已经存在');
      if (!creating && position < 0) fail(`${changePath}.key`, '原对象不存在');
      if (change.operation === 'DELETE') {
        if (change.value !== null) fail(`${changePath}.value`, '删除操作必须明确为null');
        projected[collection].splice(position, 1);
        continue;
      }
      const writeFields = ROW_FIELDS[collection].filter(field => !['gameId', 'skillKey'].includes(field)
        && (creating || field !== keyField));
      object(change.value, writeFields, `${changePath}.value`);
      if (creating && change.value[keyField] !== change.key) fail(`${changePath}.value.${keyField}`, '新增值标识必须等于变更键');
      if (collection === 'triggerRules') rule(change.value, `${changePath}.value`, creating);
      const currentRow = creating ? {} : projected[collection][position];
      const replacement = { ...(collection === 'triggerRules' ? {} : { gameId: plan.gameId, skillKey: item.skillKey }),
        [keyField]: change.key, ...clone(change.value),
        ...Object.fromEntries(TIMES.filter(time => own(currentRow, time)).map(time => [time, currentRow[time]])) };
      if (canonicalText(currentRow) === canonicalText(replacement)) fail(changePath, '未改变业务字段');
      if (creating) projected[collection].push(replacement);
      else projected[collection][position] = replacement;
    }
    // 管理聚合按组成稳定键排序回读；只整理六个根集合，嵌套业务顺序保持。
    for (const [collection, key] of Object.entries(COLLECTIONS)) projected[collection].sort((a, b) =>
      a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
    if (!sameConfiguration(projected, item.expected)) fail(`${where}.expected`, '与PATCH投影不一致，包含未声明修改或丢失字段');
    if (!array(item.sourceEvidence, `${where}.sourceEvidence`).length) fail(`${where}.sourceEvidence`, '缺少冻结来源');
    for (const [sourceIndex, source] of item.sourceEvidence.entries()) {
      const sourcePath = `${where}.sourceEvidence[${sourceIndex}]`;
      object(source, ['path', 'sha256', 'note'], sourcePath);
      string(source.path, `${sourcePath}.path`);
      if (source.path.includes('\0') || /^[a-z][a-z0-9+.-]*:\/\//i.test(source.path)) fail(`${sourcePath}.path`, '必须是本地冻结来源文件');
      digest(source.sha256, `${sourcePath}.sha256`);
      string(source.note, `${sourcePath}.note`);
    }
  }
  return plan;
}

/** 从完整基线及候选生成现行聚合差分，不读取接口、不写数据或替调用者授权删除。 */
export function buildSkillPlanItem(before, expected, sourceEvidence, authorizedDeletes = []) {
  const gameId = before?.skill?.gameId, skillKey = before?.skill?.skillKey;
  validateConfiguration(before, gameId, skillKey, 'before');
  validateConfiguration(expected, gameId, skillKey, 'expected');
  const allowed = new Set();
  for (const [index, entry] of array(authorizedDeletes, 'authorizedDeletes').entries()) {
    object(entry, ['objectType', 'key'], `authorizedDeletes[${index}]`);
    if (!own(CHANGE_COLLECTIONS, entry.objectType)) fail('authorizedDeletes', '未知组成类型');
    stableKey(entry.key, 'authorizedDeletes.key');
    const identity = `${entry.objectType}/${entry.key}`;
    if (allowed.has(identity)) fail('authorizedDeletes', '重复删除声明');
    allowed.add(identity);
  }
  const candidate = clone(expected), changes = [], deleted = new Set();
  const fields = (row, names) => Object.fromEntries(names.map(name => [name, clone(row[name])]));
  for (const [objectType, collection] of Object.entries(CHANGE_COLLECTIONS)) {
    const id = COLLECTIONS[collection], writable = ROW_FIELDS[collection].filter(field => !['gameId', 'skillKey', id].includes(field));
    const previous = new Map(before[collection].map(row => [row[id], row]));
    const next = new Map(candidate[collection].map(row => [row[id], row]));
    candidate[collection].sort((a, b) => a[id] < b[id] ? -1 : a[id] > b[id] ? 1 : 0);
    for (const row of candidate[collection]) {
      const old = previous.get(row[id]), value = fields(row, writable);
      if (old && canonicalText(fields(old, writable)) === canonicalText(value)) continue;
      changes.push({ objectType, operation: old ? 'UPDATE' : 'CREATE', key: row[id],
        value: old ? value : { [id]: row[id], ...value } });
    }
    for (const old of before[collection]) if (!next.has(old[id])) {
      const identity = `${objectType}/${old[id]}`;
      if (!allowed.has(identity)) fail(identity, '完整候选移除了原组成，缺少明确删除声明');
      deleted.add(identity);
      changes.push({ objectType, operation: 'DELETE', key: old[id], value: null });
    }
  }
  if ([...allowed].some(identity => !deleted.has(identity))) fail('authorizedDeletes', '声明未对应本次实际删除');
  const skill = fields(candidate.skill, SKILL_WRITE_FIELDS);
  const request = { baseDigest: before.baseDigest, changes,
    ...(canonicalText(skill) === canonicalText(fields(before.skill, SKILL_WRITE_FIELDS)) ? {} : { skill }) };
  const item = { skillKey, before: clone(before), expected: candidate, request, sourceEvidence: clone(sourceEvidence) };
  validatePlan({ schemaVersion: 'skill-configuration-plan-v1', gameId, items: [item] });
  return item;
}

function apiBase(value) {
  if (typeof value !== 'string' || value.trim() !== value || /[\s\\]/.test(value)) fail('api-base', '非法地址');
  let url;
  try { url = new URL(value); } catch { fail('api-base', '非法地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(url.pathname)) fail('api-base', '只允许无凭据和查询串的HTTP(S)基址');
  return url.toString().replace(/\/$/, '');
}
function authoringAuthentication(env, apply) {
  const session = env.DAMAGE_AUTHORING_SESSION;
  const csrf = env.DAMAGE_AUTHORING_CSRF;
  for (const [name, value] of [['DAMAGE_AUTHORING_SESSION', session], ['DAMAGE_AUTHORING_CSRF', csrf]]) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail(name, '需要当前已授权会话的43位网址安全编码值');
  }
  const source = env.DAMAGE_AUTHORING_ORIGIN;
  if (typeof source !== 'string' || !/^https?:\/\/[^/?#]+\/?$/.test(source) || /[\s\\]/.test(source)) {
    fail('DAMAGE_AUTHORING_ORIGIN', '需要服务允许的HTTP(S)来源地址');
  }
  let origin;
  try { origin = new URL(source); } catch { fail('DAMAGE_AUTHORING_ORIGIN', '非法来源地址'); }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    fail('DAMAGE_AUTHORING_ORIGIN', '来源不能包含凭据、路径、查询或片段');
  }
  const batch = env.DAMAGE_AUTHORING_BATCH;
  if (apply && (typeof batch !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(batch))) {
    fail('DAMAGE_AUTHORING_BATCH', '正式写入需要已验证、已登记并打开维护窗口的批次编号');
  }
  return { session, csrf, origin: origin.origin, batch };
}
const credentialValues = env => [env.DAMAGE_AUTHORING_SESSION, env.DAMAGE_AUTHORING_CSRF]
  .filter(value => typeof value === 'string' && value);
function redact(value, secrets) {
  if (typeof value === 'string') {
    const hidden = secrets.reduce((text, secret) => text.split(secret).join('[已隐藏凭据]'), value);
    return hidden.replace(/\bBearer\s+[^\s,;"']+/gi, '鉴权信息已隐藏');
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/^(?:headers?|authorization|proxyAuthorization|set-cookie|cookies?|password|passwd|secret|apiKey|api_key|accessToken|refreshToken|bearerToken|adminToken|token|sessionCookie|csrfToken|DAMAGE_AUTHORING_SESSION|DAMAGE_AUTHORING_CSRF)$/i.test(key))
    .map(([key, item]) => [redact(key, secrets), redact(item, secrets)]));
}
const safeError = (error, secrets) => redact(error instanceof Error ? error.message : String(error), secrets);

const DEFAULT_TIMEOUT_MS = 60000;

/** 会话凭据与来源仅从env取得；fetchImpl只供本地传输测试；timeoutMs覆盖响应头和完整响应体读取。 */
export async function runSkillPlan({ apiBase: suppliedBase, planPath, outputDir, apply = false, env = process.env,
  fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const authentication = authoringAuthentication(env, apply);
  const secrets = credentialValues(env);
  const base = apiBase(suppliedBase);
  if (typeof planPath !== 'string' || !planPath || typeof outputDir !== 'string' || !outputDir) fail('paths', '必须明确提供plan和output-dir');
  await mkdir(path.resolve(outputDir), { recursive: true });
  const attemptDir = path.resolve(outputDir, `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(attemptDir);
  const save = (filename, value) => writeFile(path.resolve(attemptDir, filename), `${JSON.stringify(redact(value, secrets), null, 2)}\n`, { flag: 'wx' });
  const summary = { schemaVersion: 'skill-configuration-attempt-v1', mode: apply ? 'apply' : 'dry-run', attemptDir,
    startedAt: new Date().toISOString(), timeoutMs, passed: false, patchCount: 0, items: [], error: null };
  async function exchange(method, url, body) {
    try {
      const response = await fetchImpl(url, { method, headers: {
        Cookie: `__Host-damage-maint-session=${authentication.session}; __Host-damage-maint-csrf=${authentication.csrf}`,
        Origin: authentication.origin, 'X-Damage-Client': 'web',
        ...(method === 'PATCH' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': authentication.csrf,
          'X-Damage-Maintenance-Batch': authentication.batch } : {}) },
        ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();
      let data;
      let jsonError = false;
      try { data = JSON.parse(text); } catch { jsonError = true; data = { unparsedText: text }; }
      return { status: response.status, ok: response.ok, jsonError, body: data };
    } catch (error) { return { status: null, ok: false, error: safeError(error, secrets) }; }
  }
  function checkedRead(reply, gameId, skillKey, label) {
    if (!reply.ok || reply.jsonError) fail(label, `读取失败（HTTP ${reply.status ?? '结果不明'}）`);
    return validateConfiguration(reply.body, gameId, skillKey, label);
  }
  try {
    const raw = await readFile(path.resolve(planPath));
    summary.planSHA256 = hash(raw);
    const plan = validatePlan(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
    summary.gameId = plan.gameId;
    // 整批计划与来源先核对；任何静态问题都不能让前面对象先写入。
    const sourceProofs = [];
    for (const item of plan.items) for (const source of item.sourceEvidence) {
      const resolved = path.resolve(path.dirname(path.resolve(planPath)), source.path);
      const resolvedReal = await realpath(resolved);
      const file = await stat(resolvedReal);
      if (!file.isFile() || file.size === 0) fail('sourceEvidence', '冻结来源不是非空文件');
      const actualSHA256 = hash(await readFile(resolvedReal));
      if (actualSHA256 !== source.sha256.toLowerCase()) fail('sourceEvidence', '冻结来源摘要不符');
      sourceProofs.push({ skillKey: item.skillKey, path: source.path, resolvedPath: resolvedReal, sha256: actualSHA256, note: source.note });
    }
    await save('plan.json', plan);
    await save('sources.json', sourceProofs);
    for (const [index, item] of plan.items.entries()) {
      const subdirectory = `${String(index + 1).padStart(4, '0')}-${item.skillKey}`;
      await mkdir(path.resolve(attemptDir, subdirectory));
      await save(`${subdirectory}/planned-before.json`, item.before);
      await save(`${subdirectory}/expected.json`, item.expected);
      await save(`${subdirectory}/request.json`, item.request);
      await save(`${subdirectory}/source-evidence.json`, sourceProofs.filter(source => source.skillKey === item.skillKey));
      summary.items.push({ skillKey: item.skillKey, directory: subdirectory, status: 'not-attempted', patchCount: 0, landed: false });
    }
    for (const [index, item] of plan.items.entries()) {
      const result = summary.items[index];
      const subdirectory = result.directory;
      result.status = 'reading';
      try {
        const url = `${base}/api/admin/games/${encodeURIComponent(plan.gameId)}/skills/${encodeURIComponent(item.skillKey)}/configuration`;
        const beforeReply = await exchange('GET', url);
        await save(`${subdirectory}/before-response.json`, beforeReply);
        const current = checkedRead(beforeReply, plan.gameId, item.skillKey, 'before');
        await save(`${subdirectory}/before.json`, current);
        if (sameConfiguration(current, item.expected)) {
          result.status = 'skipped-already-applied'; result.landed = true;
          await save(`${subdirectory}/after.json`, current);
          continue;
        }
        if (current.baseDigest !== item.before.baseDigest || !sameConfiguration(current, item.before)) {
          result.status = 'blocked-drift'; fail(item.skillKey, '当前完整配置或摘要已漂移，停止本批');
        }
        if (!apply) { result.status = 'dry-run-ready'; continue; }
        // 意图先落盘；PATCH只调用一次。后续任何结果都不换摘要、不重放。
        await save(`${subdirectory}/patch-intent.json`, { method: 'PATCH', skillKey: item.skillKey, at: new Date().toISOString() });
        summary.patchCount++; result.patchCount++;
        const patchReply = await exchange('PATCH', url, item.request);
        const afterReply = await exchange('GET', url);
        await save(`${subdirectory}/patch-response.json`, patchReply);
        await save(`${subdirectory}/after-response.json`, afterReply);
        let after;
        try { after = checkedRead(afterReply, plan.gameId, item.skillKey, 'after'); }
        catch (error) { result.status = 'blocked-readback'; throw error; }
        await save(`${subdirectory}/after.json`, after);
        result.landed = sameConfiguration(after, item.expected);
        if (patchReply.status >= 400 && patchReply.status < 500) {
          result.status = 'blocked-http-rejection'; fail(item.skillKey, `PATCH明确拒绝（HTTP ${patchReply.status}），已回读并停止本批`);
        }
        if (!result.landed) {
          result.status = 'blocked-unconfirmed'; fail(item.skillKey, '独立回读未等于完整expected；结果不明，停止本批且不重放');
        }
        if (patchReply.status === null || patchReply.status >= 500) result.status = 'applied-confirmed-after-uncertain';
        else {
          try {
            const responseConfiguration = checkedRead(patchReply, plan.gameId, item.skillKey, 'patch-response');
            if (!sameConfiguration(responseConfiguration, item.expected)) fail('patch-response', '完整配置不等于expected');
          } catch (error) { result.status = 'blocked-response-contract'; throw error; }
          result.status = 'applied';
        }
      } catch (error) {
        if (result.status === 'reading') result.status = 'blocked-read';
        result.error = safeError(error, secrets);
        throw error;
      } finally { await save(`${subdirectory}/status.json`, result); }
    }
    summary.passed = true;
  } catch (error) { summary.error = safeError(error, secrets); }
  for (const result of summary.items) if (result.status === 'not-attempted') await save(`${result.directory}/status.json`, result);
  summary.finishedAt = new Date().toISOString();
  await save('summary.json', summary);
  return summary;
}

export function parseCli(argv) {
  const options = { apply: false };
  const flags = { '--api-base': 'apiBase', '--plan': 'planPath', '--output-dir': 'outputDir', '--timeout-ms': 'timeoutMs' };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--apply') { if (options.apply) fail('args', '重复--apply'); options.apply = true; continue; }
    const key = flags[flag];
    if (!key || own(options, key) || !argv[index + 1] || argv[index + 1].startsWith('--')) fail('args', '未知、重复或缺值的参数');
    options[key] = argv[++index];
  }
  if (!options.apiBase || !options.planPath || !options.outputDir) fail('args', '需要--api-base --plan --output-dir [--timeout-ms <毫秒>] [--apply]');
  if (own(options, 'timeoutMs')) {
    const parsed = Number(options.timeoutMs);
    if (!/^\d+$/.test(options.timeoutMs) || !Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 300000) {
      fail('args', '--timeout-ms必须是1000至300000之间的安全整数');
    }
    options.timeoutMs = parsed;
  } else options.timeoutMs = DEFAULT_TIMEOUT_MS;
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('node apply-skill-plan.mjs --api-base http://127.0.0.1:8080 --plan <plan.json> --output-dir <evidence-directory> [--timeout-ms <1000..300000>] [--apply]\n会话与防伪值仅取DAMAGE_AUTHORING_SESSION、DAMAGE_AUTHORING_CSRF；允许的来源取DAMAGE_AUTHORING_ORIGIN，不使用旧令牌。默认只读，每次创建独立attempt目录。\n超时默认60000毫秒，包含完整响应体读取；写入结果不明时只独立回读，未确认完整expected即停批，不自动重发。');
  } else {
    try {
      const summary = await runSkillPlan(parseCli(process.argv.slice(2)));
      console.log(JSON.stringify(redact({ mode: summary.mode, passed: summary.passed, attemptDir: summary.attemptDir,
        patchCount: summary.patchCount, items: summary.items.map(({ skillKey, status }) => ({ skillKey, status })), error: summary.error }, credentialValues(process.env))));
      if (!summary.passed) process.exitCode = 1;
    } catch (error) { console.error(safeError(error, credentialValues(process.env))); process.exitCode = 1; }
  }
}
