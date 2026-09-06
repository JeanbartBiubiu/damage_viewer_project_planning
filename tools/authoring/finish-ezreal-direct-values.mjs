import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// 只读预览：node tools/authoring/finish-ezreal-direct-values.mjs --preview --port 8080 --run preview-20260906
// 已核准原始目标后由负责人执行：同命令改为 --apply，并增加 --confirm-original-lol。
// 每次执行重新获取快照；失败不回滚、不续跑，也不复用或覆盖已有证据目录。
const args = process.argv.slice(2);
const mode = args[0];
assert.ok(['--preview', '--apply', '--self-test'].includes(mode), '必须明确选择 --preview、--apply 或 --self-test');
const options = new Map();
for (let i = 1; i < args.length; i++) {
  const key = args[i];
  assert.ok(['--port', '--run', '--confirm-original-lol', '--snapshot'].includes(key) && !options.has(key), '未知或重复参数');
  options.set(key, key === '--confirm-original-lol' ? true : args[++i]);
}
const heroes = ['ez_p', 'ez_q', 'ez_w', 'ez_e', 'ez_r'];
const parts = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey',
  'internal-states': 'stateKey', processes: 'processKey', 'trigger-rules': 'ruleKey' };
const pure = {
  ez_p: { attack_speed_per_stack: 'stack_attack_speed_ratio', duration_value_ms: 'duration_ms', max_stacks_value: 'max_stacks', application_stacks_value: 'application_stacks' },
  ez_q: { cooldown_duration_ms: 'cooldown_ms', mana_cost_value: 'mana_cost', cooldown_reduction_value_ms: 'cooldown_reduction_ms', cast_time_value_ms: 'cast_time_ms', full_efficiency_value: 'full_efficiency' },
  ez_w: { cooldown_duration_ms: 'cooldown_ms', mana_cost_value: 'mana_cost', mark_duration_value_ms: 'mark_duration_ms', max_stacks_value: 'max_stacks', application_stacks_value: 'application_stacks', mana_restore_base_value: 'mana_restore_base', cast_time_value_ms: 'cast_time_ms', zero_value: 'zero_value' },
  ez_e: { cooldown_duration_ms: 'cooldown_ms', mana_cost_value: 'mana_cost', cast_time_value_ms: 'cast_time_ms' },
  ez_r: { cooldown_duration_ms: 'cooldown_ms', mana_cost_value: 'mana_cost', cast_time_value_ms: 'cast_time_ms' },
};
const keepFormulas = { ez_p: [], ez_q: ['damage'], ez_w: ['damage', 'mana_restore_total'], ez_e: ['damage'], ez_r: ['champion_damage', 'minion_monster_damage'] };
const deleteParameters = { ez_p: [], ez_q: ['missing_health_ratio', 'current_stacks', 'character_scale'], ez_w: ['zero_value'], ez_e: [], ez_r: ['target_range'] };

function requireThat(value, message) { if (!value) throw new Error(message); }
function same(actual, expected, location) { requireThat(canonical(actual) === canonical(expected), `数据不符合计划：${location}`); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex'); }
function decimal(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  assert.ok(match, '非法十进制数值');
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); exponent++; }
  return match[1] + digits + 'e' + exponent;
}
function parseExact(text) {
  // Node 20 的普通 JSON 解析可能丢精度；任何不能按原数值写回的输入均在写入前拒绝。
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)) {
    if (token[1] !== undefined) {
      const number = Number(token[1]);
      requireThat(Number.isFinite(number) && decimal(token[1]) === decimal(JSON.stringify(number)), '响应含普通 JSON 工具不能精确保留的数值，停止整理');
    }
  }
  return JSON.parse(text);
}
function selfTest() {
  same(parseExact('{"zero":0,"fraction":0.15,"exponent":1e-7,"text":"9007199254740993"}'),
    { zero: 0, fraction: 0.15, exponent: 1e-7, text: '9007199254740993' }, '数值保真自检');
  for (const text of ['9007199254740993', '0.10000000000000000000000001', '1e-9999', '1e9999']) assert.throws(() => parseExact(text));
  same(decimal('100.00'), decimal('1e2'), '十进制正规化');
  const sample = { x: [{ kind: 'FORMULA', formulaKey: 'f' }] };
  same(referenceSites(sample, 'formulaKey', 'f'), [['x', 0]], '引用路径扫描');
}
selfTest();
if (mode === '--self-test') {
  if (options.has('--snapshot')) {
    const saved = parseExact(await fs.readFile(options.get('--snapshot'), 'utf8'));
    checkPlanGuards(saved, buildPlan(saved));
  }
  console.log(JSON.stringify({ selfTests: 'passed', planGuards: options.has('--snapshot') ? 5 : 0, networkRequests: 0 }));
  process.exit(0);
}
assert.ok(!options.has('--snapshot'), '--snapshot 只供自检读取证据，不得用于实际整理');

const port = options.get('--port');
assert.ok(['8080', '8081'].includes(port), '必须明确指定本机端口 8080 或 8081');
assert.ok(mode !== '--apply' || port !== '8080' || options.get('--confirm-original-lol') === true, '原始目标写入需要明确的 --confirm-original-lol');
const run = options.get('--run');
assert.ok(typeof run === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(run), '必须指定新的 --run 证据标识');
const base = `http://127.0.0.1:${port}/api/admin/games/lol`;
const directory = new URL(`../../output/authoring-simplification/direct-values-${run}/`, import.meta.url);
await fs.mkdir(directory); // 不复用已有目录，避免失败后盲目重放或覆盖证据。
const events = [];
const writes = [];
const startedAt = new Date().toISOString();
let before;
let plan;
async function evidence(name, value) { await fs.writeFile(new URL(name, directory), JSON.stringify(value, null, 2)); }
async function call(method, path, body, expected = 200) {
  requireThat(method === 'GET' || mode === '--apply', '只读预览不能写入');
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const raw = await response.text();
  events.push({ method, path, status: response.status });
  requireThat(response.status === expected, `${method} ${path} 返回 ${response.status}，期望 ${expected}`);
  return raw ? parseExact(raw) : null;
}
function items(response, path) {
  if (Array.isArray(response)) return response;
  requireThat(response && Array.isArray(response.items) && response.total === response.items.length, `列表不完整：${path}`);
  return response.items;
}
function imageEvidence(value) {
  if (Array.isArray(value)) return value.map(imageEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => key === 'imageBase64'
    ? ['imageBase64Sha256', item === null ? null : hash(item)] : [key, imageEvidence(item)]));
}
async function snapshot() {
  const snapshot = { gameId: 'lol', resources: {}, skills: {}, characterAttributes: {}, equipmentAttributes: {},
    characterSkillRelations: {}, equipmentSkillRelations: {}, representativeImages: {} };
  for (const resource of ['characters', 'attributes', 'equipment', 'skills', 'skill-categories', 'damage-types', 'modifier-zones', 'statuses', 'level-config', 'images']) {
    const response = await call('GET', '/' + resource);
    if (resource !== 'level-config') items(response, resource);
    snapshot.resources[resource] = imageEvidence(response);
  }
  for (const skill of items(snapshot.resources.skills, 'skills')) {
    const key = skill.skillKey;
    const path = '/skills/' + encodeURIComponent(key);
    snapshot.skills[key] = { skill: await call('GET', path) };
    for (const [resource, keyField] of Object.entries(parts)) {
      const summaries = items(await call('GET', path + '/' + resource), path + '/' + resource);
      snapshot.skills[key][resource] = [];
      for (const summary of summaries) snapshot.skills[key][resource].push(await call('GET', path + '/' + resource + '/' + encodeURIComponent(summary[keyField])));
    }
  }
  for (const [resource, keyField, attributes, relations] of [
    ['characters', 'characterKey', 'characterAttributes', 'characterSkillRelations'],
    ['equipment', 'equipmentKey', 'equipmentAttributes', 'equipmentSkillRelations'],
  ]) {
    for (const item of items(snapshot.resources[resource], resource)) {
      const key = item[keyField];
      snapshot[attributes][key] = await call('GET', `/${resource}/${encodeURIComponent(key)}/attributes`);
      snapshot[relations][key] = await call('GET', `/${resource === 'characters' ? 'character' : 'equipment'}-skill-relations?${keyField}=${encodeURIComponent(key)}`);
      items(snapshot[relations][key], relations);
    }
  }
  const imageSources = [''];
  for (const [resource, keyField] of [['characters', 'characterKey'], ['attributes', 'attributeKey'], ['equipment', 'equipmentKey'], ['skills', 'skillKey'], ['statuses', 'statusKey']]) {
    for (const item of items(snapshot.resources[resource], resource)) imageSources.push(`/${resource}/${encodeURIComponent(item[keyField])}`);
  }
  for (const [skillKey, skill] of Object.entries(snapshot.skills)) for (const effect of skill.effects) imageSources.push(`/skills/${skillKey}/effects/${effect.effectKey}`);
  for (const source of imageSources) snapshot.representativeImages[source || '/'] = imageEvidence(await call('GET', source + '/representative-image'));
  return snapshot;
}
function referenceSites(value, field, key, path = [], root = true) {
  if (!value || typeof value !== 'object') return [];
  const found = !root && !Array.isArray(value) && value[field] === key ? [path] : [];
  for (const [name, child] of Object.entries(value)) if (child && typeof child === 'object') found.push(...referenceSites(child, field, key, [...path, Array.isArray(value) ? Number(name) : name], false));
  return found;
}
function references(snapshot, skillKey, field, key) {
  const result = [];
  for (const [resource, keyField] of Object.entries(parts)) for (const object of snapshot.skills[skillKey][resource]) {
    for (const path of referenceSites(object, field, key)) result.push({ resource, objectKey: object[keyField], path });
  }
  return result;
}
function object(snapshot, skill, resource, key) {
  const matches = snapshot.skills[skill]?.[resource]?.filter(item => item[parts[resource]] === key);
  requireThat(matches?.length === 1, `对象缺失或重复：${skill}/${resource}/${key}`);
  return matches[0];
}
function locate(value, path) { return path.reduce((item, key) => { requireThat(item != null && Object.hasOwn(item, key), '目标字段已变化'); return item[key]; }, value); }
function set(value, path, replacement) { locate(value, path.slice(0, -1))[path.at(-1)] = replacement; }
function selectPath(value, selectors) {
  const path = [];
  for (const selector of selectors) {
    if (typeof selector === 'string') path.push(selector);
    else {
      const list = locate(value, path);
      requireThat(Array.isArray(list), '目标子项不是数组');
      const matches = list.flatMap((item, i) => item[selector.field] === selector.key ? [i] : []);
      requireThat(matches.length === 1, `目标子项缺失或重复：${selector.key}`);
      path.push(matches[0]);
    }
  }
  locate(value, path);
  return path;
}
function buildPlan(before) {
  const expected = structuredClone(before);
  const changes = [];
  const removals = [];
  const result = key => ({ field: 'resultKey', key });
  const step = key => ({ field: 'stepKey', key });
  function change(skill, resource, key, selectors, formulaKey) {
    const current = object(before, skill, resource, key);
    const path = selectPath(current, selectors);
    const previous = { kind: 'FORMULA', formulaKey };
    const next = { kind: 'PARAMETER', parameterKey: pure[skill][formulaKey] };
    requireThat(next.parameterKey, '未列入纯参数转换');
    same(locate(current, path), previous, `${skill}/${resource}/${key}/${path.join('/')}`);
    changes.push({ skillKey: skill, resource, objectKey: key, path, before: previous, after: next });
    set(object(expected, skill, resource, key), path, next);
  }
  change('ez_p', 'effects', 'rising_spell_force', ['results', result('attack_speed_gain'), 'valueRule', 'value'], 'attack_speed_per_stack');
  for (const [field, formula] of [['durationValue', 'duration_value_ms'], ['maxStacksValue', 'max_stacks_value'], ['applicationStacksValue', 'application_stacks_value']]) change('ez_p', 'effects', 'rising_spell_force', ['lifecycle', field], formula);
  for (const skill of ['ez_q', 'ez_w', 'ez_e', 'ez_r']) change(skill, 'effects', 'mana_cost', ['results', result('consume_mana'), 'valueRule', 'value'], 'mana_cost_value');
  change('ez_q', 'effects', 'primary_hit', ['results', result('reduce_cooldowns'), 'valueRule', 'value'], 'cooldown_reduction_value_ms');
  for (const vampType of ['LIFE_STEAL', 'OMNIVAMP', 'PHYSICAL_VAMP']) change('ez_q', 'effects', 'primary_hit', ['results', result('physical_damage'), 'detail', 'vampRules', { field: 'vampType', key: vampType }, 'efficiencyValue'], 'full_efficiency_value');
  for (const skill of ['ez_w', 'ez_e', 'ez_r']) {
    change(skill, 'processes', 'cast', ['cooldown', 'durationValue'], 'cooldown_duration_ms');
    change(skill, 'processes', 'cast', ['steps', step('cast_time'), 'detail', 'delayValue'], 'cast_time_value_ms');
  }
  for (const [field, formula] of [['durationValue', 'mark_duration_value_ms'], ['maxStacksValue', 'max_stacks_value'], ['applicationStacksValue', 'application_stacks_value']]) change('ez_w', 'effects', 'essence_flux_mark', ['lifecycle', field], formula);
  requireThat(changes.length === 21 && new Set(changes.map(item => item.skillKey + '/' + item.before.formulaKey)).size === 19, '转换数量变化');
  let formulaCount = 0;
  let parameterCount = 0;
  for (const skill of heroes) {
    const previous = before.skills[skill];
    requireThat(previous, `技能缺失：${skill}`);
    formulaCount += previous.formulas.length;
    parameterCount += previous.parameters.length;
    const deleteFormulas = [...Object.keys(pure[skill]), ...(skill === 'ez_q' ? ['missing_health_damage', 'stack_scaled_damage'] : [])];
    same(previous.formulas.map(item => item.formulaKey).sort(), [...deleteFormulas, ...keepFormulas[skill]].sort(), `${skill} 完整公式目录`);
    for (const [formulaKey, parameterKey] of Object.entries(pure[skill])) {
      same(object(before, skill, 'formulas', formulaKey).expression, { nodeType: 'PARAMETER', parameterKey }, `${skill}/${formulaKey} 纯参数树`);
      const expectedReferences = changes.filter(item => item.skillKey === skill && item.before.formulaKey === formulaKey).map(item => ({ resource: item.resource, objectKey: item.objectKey, path: item.path }));
      same(references(before, skill, 'formulaKey', formulaKey).map(canonical).sort(), expectedReferences.map(canonical).sort(), `${skill}/${formulaKey} 引用落点`);
      if (expectedReferences.length) requireThat(object(before, skill, 'parameters', parameterKey).valueMode !== 'RUNTIME_INPUT', '纯中转目标不应引入动态参数');
    }
    for (const formulaKey of deleteFormulas) {
      requireThat(references(expected, skill, 'formulaKey', formulaKey).length === 0, `删除公式仍有引用：${skill}/${formulaKey}`);
      removals.push({ skillKey: skill, resource: 'formulas', objectKey: formulaKey });
    }
    expected.skills[skill].formulas = previous.formulas.filter(item => !deleteFormulas.includes(item.formulaKey));
  }
  requireThat(formulaCount === 31 && parameterCount === 57, `执行前数量变化：公式 ${formulaCount}，参数 ${parameterCount}，要求 31/57`);
  same(object(before, 'ez_q', 'formulas', 'missing_health_damage').expression,
    { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'MISSING' }, { nodeType: 'PARAMETER', parameterKey: 'missing_health_ratio' }] }, 'Q 已损失生命值演示公式');
  same(object(before, 'ez_q', 'formulas', 'stack_scaled_damage').expression,
    { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'PARAMETER', parameterKey: 'current_stacks' }, { nodeType: 'PARAMETER', parameterKey: 'base_damage' }] }, 'Q 层数演示公式');
  const parameterShapes = {
    'ez_q/missing_health_ratio': { valueMode: 'FIXED', valueType: 'DECIMAL', fixedValue: 0.15, levelValues: null },
    'ez_q/current_stacks': { valueMode: 'RUNTIME_INPUT', valueType: 'INTEGER', fixedValue: null, levelValues: null },
    'ez_q/character_scale': { valueMode: 'CHARACTER_LEVEL', valueType: 'DECIMAL', fixedValue: null, levelValues: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, i + 1])) },
    'ez_w/zero_value': { valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: 0, levelValues: null },
    'ez_r/target_range': { valueMode: 'FIXED', valueType: 'DECIMAL', fixedValue: 25000, levelValues: null },
  };
  for (const skill of heroes) {
    for (const parameterKey of deleteParameters[skill]) {
      const parameter = object(before, skill, 'parameters', parameterKey);
      const shape = Object.fromEntries(['valueMode', 'valueType', 'fixedValue', 'levelValues'].map(field => [field, parameter[field]]));
      same(shape, parameterShapes[skill + '/' + parameterKey], '演示参数值已变化：' + skill + '/' + parameterKey);
      requireThat(references(expected, skill, 'parameterKey', parameterKey).length === 0, `删除参数仍有引用：${skill}/${parameterKey}`);
      removals.push({ skillKey: skill, resource: 'parameters', objectKey: parameterKey });
    }
    expected.skills[skill].parameters = expected.skills[skill].parameters.filter(item => !deleteParameters[skill].includes(item.parameterKey));
  }
  const updated = [...new Map(changes.map(item => [item.skillKey + '/' + item.resource + '/' + item.objectKey, { skillKey: item.skillKey, resource: item.resource, objectKey: item.objectKey }])).values()];
  for (const item of updated) requestBody(object(expected, item.skillKey, item.resource, item.objectKey), item.resource);
  const restored = structuredClone(expected);
  for (const item of changes) set(object(restored, item.skillKey, item.resource, item.objectKey), item.path, item.before);
  for (const skill of heroes) for (const resource of ['formulas', 'parameters']) restored.skills[skill][resource] = structuredClone(before.skills[skill][resource]);
  same(restored, before, '计划不允许修改其他数据、图片、时点或顺序');
  requireThat(removals.filter(item => item.resource === 'formulas').length === 25 && removals.filter(item => item.resource === 'parameters').length === 5, '删除数量变化');
  requireThat(heroes.reduce((n, key) => n + expected.skills[key].formulas.length, 0) === 6 && heroes.reduce((n, key) => n + expected.skills[key].parameters.length, 0) === 52, '目标数量变化');
  return { changes, updated, removals, expected };
}
function requestBody(value, resource) {
  const fields = resource === 'effects' ? ['name', 'description', 'sortOrder', 'lifecycle', 'results']
    : ['name', 'activationType', 'description', 'sortOrder', 'cooldown', 'steps', 'effectBindings', 'stateOperations'];
  same(Object.keys(value).filter(key => !['gameId', 'skillKey', parts[resource], 'createdAt', 'updatedAt'].includes(key)).sort(), [...fields].sort(), '父对象接口字段变化');
  return Object.fromEntries(fields.map(field => [field, value[field]]));
}
function acceptUpdatedAt(actual, wanted, location) {
  requireThat(typeof actual.updatedAt === 'string' && Number.isFinite(Date.parse(actual.updatedAt)), '写入回读缺少更新时间：' + location);
  same({ ...actual, updatedAt: wanted.updatedAt }, wanted, location);
}
function checkPlanGuards(snapshot, planned) {
  assert.throws(() => buildPlan(planned.expected), '已完成状态不得重放');
  const badFormula = structuredClone(snapshot);
  object(badFormula, 'ez_p', 'formulas', 'attack_speed_per_stack').expression = { nodeType: 'PARAMETER', parameterKey: 'duration_ms' };
  assert.throws(() => buildPlan(badFormula), '纯中转公式内容改变必须拒绝');
  const extraReference = structuredClone(snapshot);
  object(extraReference, 'ez_q', 'effects', 'mana_cost').unexpected = { kind: 'FORMULA', formulaKey: 'full_efficiency_value' };
  assert.throws(() => buildPlan(extraReference), '意外公式引用必须拒绝');
  const usedParameter = structuredClone(snapshot);
  object(usedParameter, 'ez_q', 'formulas', 'damage').expression = { nodeType: 'PARAMETER', parameterKey: 'character_scale' };
  assert.throws(() => buildPlan(usedParameter), '仍被引用的演示参数必须拒绝');
  const extraParameter = structuredClone(snapshot);
  extraParameter.skills.ez_q.parameters.push({ parameterKey: 'unexpected' });
  assert.throws(() => buildPlan(extraParameter), '数量发生变化必须拒绝');
}
async function persistIntent(entry) { writes.push({ ...entry, state: 'started' }); await evidence('writes.json', writes); }
async function finishWrite() { writes.at(-1).state = 'read_back_verified'; await evidence('writes.json', writes); }

try {
  before = await snapshot();
  await evidence('before.json', before);
  plan = buildPlan(before);
  checkPlanGuards(before, plan);
  const report = { changedFields: plan.changes.length, pureFormulasInUse: 19, updatedObjects: plan.updated.length,
    deletedFormulas: 25, deletedParameters: 5, formulasBefore: 31, formulasAfter: 6, parametersBefore: 57, parametersAfter: 52,
    changes: plan.changes, removals: plan.removals, planGuardSelfTests: 5, runtimeExecuted: false };
  await evidence('plan.json', report);
  await evidence('expected.json', plan.expected);
  // 预览允许负责人继续页面录入，仅提供本次读取的计划；写入前必须完成一致性核对。
  // 多个 HTTP 请求不是数据库整体事务；实际执行期间由负责人停止其他编辑。
  if (mode === '--apply') {
    same(await snapshot(), before, '预检期间数据发生变化，请停止其他编辑后使用新的证据标识重试');
    for (const item of plan.updated) {
      const path = `/skills/${item.skillKey}/${item.resource}/${item.objectKey}`;
      const original = object(before, item.skillKey, item.resource, item.objectKey);
      const wanted = object(plan.expected, item.skillKey, item.resource, item.objectKey);
      same(await call('GET', path), original, '写入前父对象已变化：' + path);
      const body = requestBody(wanted, item.resource);
      await persistIntent({ method: 'PUT', path });
      acceptUpdatedAt(await call('PUT', path, body), wanted, '保存响应：' + path);
      const actual = await call('GET', path);
      acceptUpdatedAt(actual, wanted, '保存回读：' + path);
      wanted.updatedAt = actual.updatedAt;
      await finishWrite();
    }
    // 先完整核对全部 21 处保存及旁路数据，再执行删除；公式全部删除完才开始删除参数。
    const expectedBeforeDeletion = structuredClone(plan.expected);
    for (const skill of heroes) for (const resource of ['formulas', 'parameters']) expectedBeforeDeletion.skills[skill][resource] = before.skills[skill][resource];
    same(await snapshot(), expectedBeforeDeletion, '删除前完整快照与指定取值修改不一致');
    for (const item of plan.removals) {
      const path = `/skills/${item.skillKey}/${item.resource}/${item.objectKey}`;
      same(await call('GET', path), object(before, item.skillKey, item.resource, item.objectKey), '删除对象已变化：' + path);
      await persistIntent({ method: 'DELETE', path });
      await call('DELETE', path, undefined, 204); // 引用保护由现有服务执行，失败立即终止。
      await call('GET', path, undefined, 404);
      await finishWrite();
    }
  }
  const after = mode === '--apply' ? await snapshot() : null;
  if (after) {
    await evidence('after.json', after);
    same(after, plan.expected, '结束后完整快照存在计划外差异');
  }
  const result = { startedAt, finishedAt: new Date().toISOString(), mode, port, status: 'passed',
    beforeHash: hash(before), afterHash: after ? hash(after) : null, writes: writes.length, requests: events.length,
    previewReadOnly: mode === '--preview', fullAfterComparison: mode === '--apply', ...report };
  await evidence('result.json', result);
  await evidence('events.json', events);
  console.log(JSON.stringify({ status: result.status, mode, port, writes: writes.length, changedFields: 21, updatedObjects: plan.updated.length,
    deletedFormulas: 25, deletedParameters: 5, evidence: directory.pathname, previewReadOnly: result.previewReadOnly }));
} catch (error) {
  if (writes.length) { try { await evidence('after-failed.json', await snapshot()); } catch { /* 保留写入日志，不能把读取失败视为通过。 */ } }
  await evidence('events.json', events);
  await evidence('result.json', { startedAt, finishedAt: new Date().toISOString(), mode, port, status: 'failed', writes,
    reason: String(error.message).slice(0, 500), runtimeExecuted: false });
  console.error(JSON.stringify({ status: 'failed', writes: writes.length, reason: String(error.message).slice(0, 300), evidence: directory.pathname }));
  process.exitCode = 1;
}
